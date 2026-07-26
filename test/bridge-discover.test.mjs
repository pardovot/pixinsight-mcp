// Instance discovery: liveness from heartbeat mtime, identity from JSON.
// No PixInsight required, we play the watcher by writing heartbeat files.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverInstances, LIVE_WINDOW_MS } from "../build/bridge/discover.js";

async function freshBase(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "pi-mcp-disc-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return base;
}

// Write <base>/<dir>/heartbeat.json and backdate its mtime by ageMs.
async function writeHeartbeat(base, dir, payload, ageMs = 0) {
  const d = path.join(base, dir);
  await fs.mkdir(d, { recursive: true });
  const hb = path.join(d, "heartbeat.json");
  await fs.writeFile(hb, JSON.stringify(payload));
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    await fs.utimes(hb, when, when);
  }
}

test("empty/absent base: no instances", async (t) => {
  const base = await freshBase(t);
  assert.deepEqual(await discoverInstances(Date.now(), base), []);
  assert.deepEqual(await discoverInstances(Date.now(), path.join(base, "nope")), []);
});

test("fresh heartbeat is live; slot + identity parsed", async (t) => {
  const base = await freshBase(t);
  await writeHeartbeat(base, "bridge", { slot: 1, pid: 123, version: "1.3.2" });
  const [i] = await discoverInstances(Date.now(), base);
  assert.equal(i.slot, 1);
  assert.equal(i.live, true);
  assert.equal(i.pid, 123);
  assert.equal(i.version, "1.3.2");
});

test("stale heartbeat (older than the window) is down", async (t) => {
  const base = await freshBase(t);
  await writeHeartbeat(base, "bridge-2", { slot: 2 }, LIVE_WINDOW_MS + 2000);
  const [i] = await discoverInstances(Date.now(), base);
  assert.equal(i.slot, 2);
  assert.equal(i.live, false);
});

test("bridge dir without a heartbeat is down, not skipped", async (t) => {
  const base = await freshBase(t);
  await fs.mkdir(path.join(base, "bridge"), { recursive: true });
  const [i] = await discoverInstances(Date.now(), base);
  assert.equal(i.slot, 1);
  assert.equal(i.live, false);
  assert.equal(i.ageMs, null);
});

test("multiple instances: sorted by slot, mixed live/down", async (t) => {
  const base = await freshBase(t);
  await writeHeartbeat(base, "bridge", { slot: 1 });
  await writeHeartbeat(base, "bridge-2", { slot: 2 }, LIVE_WINDOW_MS + 5000);
  await writeHeartbeat(base, "bridge-3", { slot: 3 });
  const infos = await discoverInstances(Date.now(), base);
  assert.deepEqual(infos.map((i) => i.slot), [1, 2, 3]);
  assert.deepEqual(infos.map((i) => i.live), [true, false, true]);
});

test("non-bridge dirs are ignored", async (t) => {
  const base = await freshBase(t);
  await writeHeartbeat(base, "bridge", { slot: 1 });
  await fs.mkdir(path.join(base, "logs"), { recursive: true });
  await fs.mkdir(path.join(base, "bridge-notanumber"), { recursive: true });
  const infos = await discoverInstances(Date.now(), base);
  assert.deepEqual(infos.map((i) => i.slot), [1]);
});
