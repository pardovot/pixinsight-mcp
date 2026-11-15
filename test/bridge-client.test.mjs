// BridgeClient tests without PixInsight. Each test gets its own bridge dir and
// plays PixInsight's part by writing result files, the dispatcher is a stub.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BridgeClient } from "../build/bridge/client.js";

async function makeBridge(context, { dispatch = async () => {}, ...config } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pixinsight-mcp-test-"));
  context.after(() => fs.rm(dir, { recursive: true, force: true }));
  const client = new BridgeClient({ bridgeDir: dir, pollIntervalMs: 25, defaultTimeoutMs: 3000, ...config }, { dispatch });
  await client.ensureDirectories();
  return { client, dir, commands: path.join(dir, "commands"), results: path.join(dir, "results") };
}

/** The command the client wrote, once it appears. */
async function waitForCommand(commandsDir) {
  for (let attempt = 0; attempt < 200; ++attempt) {
    const names = (await fs.readdir(commandsDir)).filter((name) => name.endsWith(".json"));
    if (names.length) return JSON.parse(await fs.readFile(path.join(commandsDir, names[0]), "utf8"));
    await delay(10);
  }
  throw new Error("no command file appeared");
}

function successFor(command, extra = {}) {
  return JSON.stringify({ id: command.id, status: "success", duration_ms: 1, outputs: {}, message: "ok", ...extra });
}

test("a result file resolves the call and is removed", async (context) => {
  const { client, commands, results } = await makeBridge(context);
  const pending = client.call("list_open_images");
  const command = await waitForCommand(commands);
  await fs.writeFile(path.join(results, `${command.id}.json`), successFor(command, { message: "done" }));
  const result = await pending;
  assert.equal(result.status, "success");
  assert.equal(result.message, "done");
  assert.deepEqual(await fs.readdir(results), []);
  assert.deepEqual(await fs.readdir(commands), []);
});

test("the command file carries verb, parameters and target view", async (context) => {
  const { client, commands, results } = await makeBridge(context);
  const pending = client.call("run_process", { processId: "Invert" }, { targetView: "M106" });
  const command = await waitForCommand(commands);
  assert.equal(command.tool, "run_process");
  assert.deepEqual(command.parameters, { processId: "Invert" });
  assert.equal(command.targetView, "M106");
  assert.ok(!Number.isNaN(Date.parse(command.timestamp)));
  await fs.writeFile(path.join(results, `${command.id}.json`), successFor(command));
  await pending;
});

test("a global call has a null target view", async (context) => {
  const { client, commands, results } = await makeBridge(context);
  const pending = client.call("run_process", { processId: "PixelMath" });
  const command = await waitForCommand(commands);
  assert.equal(command.targetView, null);
  await fs.writeFile(path.join(results, `${command.id}.json`), successFor(command));
  await pending;
});

test("a result that stays unparseable fails as MalformedResult, well before the timeout", async (context) => {
  const { client, commands, results } = await makeBridge(context, { defaultTimeoutMs: 10_000 });
  const pending = client.call("get_noise", { viewId: "M106" });
  const command = await waitForCommand(commands);
  await fs.writeFile(path.join(results, `${command.id}.json`), "not json {{{");
  const started = Date.now();
  const result = await pending;
  assert.equal(result.status, "error");
  assert.equal(result.error.type, "MalformedResult");
  assert.ok(Date.now() - started < 8000);
});

test("a partial write completed within the grace window succeeds", async (context) => {
  const { client, commands, results } = await makeBridge(context, { defaultTimeoutMs: 10_000 });
  const pending = client.call("get_noise", { viewId: "M106" });
  const command = await waitForCommand(commands);
  const resultPath = path.join(results, `${command.id}.json`);
  const full = successFor(command, { message: "completed" });
  await fs.writeFile(resultPath, full.slice(0, 20));
  await delay(500);
  await fs.writeFile(resultPath, full);
  const result = await pending;
  assert.equal(result.status, "success");
  assert.equal(result.message, "completed");
});

test("a dispatch failure becomes an error result and leaves no files", async (context) => {
  const { client, dir } = await makeBridge(context, {
    dispatch: async () => { throw new Error("PixInsight is not running."); },
  });
  const result = await client.call("list_open_images");
  assert.equal(result.status, "error");
  assert.equal(result.error.type, "DispatchError");
  assert.match(result.error.message, /not running/);
  for (const sub of ["commands", "scripts", "results"])
    assert.deepEqual(await fs.readdir(path.join(dir, sub)), []);
});

test("no result before the timeout gives a Timeout error", async (context) => {
  const { client } = await makeBridge(context);
  const result = await client.call("list_open_images", {}, { timeoutMs: 300 });
  assert.equal(result.status, "error");
  assert.equal(result.error.type, "Timeout");
});

test("the instance starts from config and can be switched", async (context) => {
  const { client } = await makeBridge(context, { instance: null });
  assert.equal(client.getInstance(), null);
  client.setInstance(2);
  assert.equal(client.getInstance(), 2);
});

test("cleanStaleFiles removes files older than ten minutes in every bridge folder", async (context) => {
  const { client, dir } = await makeBridge(context);
  const old = new Date(Date.now() - 20 * 60_000);
  const files = [
    ["commands", "old.json", true], ["commands", "old.json.tmp", true], ["commands", "fresh.json", false],
    ["scripts", "old.js", true], ["scripts", "fresh.js", false],
    ["results", "old.json", true], ["results", "fresh.json", false],
  ];
  for (const [sub, name, stale] of files) {
    const filePath = path.join(dir, sub, name);
    await fs.writeFile(filePath, "{}");
    if (stale) await fs.utimes(filePath, old, old);
  }
  assert.equal(await client.cleanStaleFiles(), 4);
  for (const sub of ["commands", "scripts", "results"]) {
    const remaining = await fs.readdir(path.join(dir, sub));
    assert.ok(remaining.every((name) => name.startsWith("fresh")), `${sub}: ${remaining}`);
  }
});
