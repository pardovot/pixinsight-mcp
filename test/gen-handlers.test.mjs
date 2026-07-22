// gen-handlers guard — the embedded-handler generation must keep working and
// stay under MSVC's string-literal limits.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "../module/gen-handlers.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watcherSource = path.join(repoRoot, "pjsr", "pixinsight-mcp-watcher.js");

test("watcher source contains both sentinels", async () => {
  const src = await fs.readFile(watcherSource, "utf8");
  assert.ok(src.includes("__MCP_HANDLERS_BEGIN__"), "BEGIN sentinel missing");
  assert.ok(src.includes("__MCP_HANDLERS_END__"), "END sentinel missing");
});

test("no watcher source line exceeds MSVC's ~16 KB literal cap", async () => {
  const src = await fs.readFile(watcherSource, "utf8");
  for (const [i, line] of src.split(/\r?\n/).entries()) {
    assert.ok(line.length <= 15_000, `line ${i + 1} is ${line.length} chars (> 15000)`);
  }
});

test("generated header has the embed symbol, handlers, and guards", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-mcp-genh-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const out = path.join(dir, "BridgeHandlersJS.h");

  const { output, lines } = generate(out);
  assert.equal(output, out);
  assert.ok(lines > 0);

  const header = await fs.readFile(out, "utf8");
  assert.ok(header.includes("MCP_HANDLERS_JS"), "embed symbol missing");
  assert.ok(header.includes("function handleListOpenImages"), "first handler missing");
  assert.ok(header.includes("function dispatchCommand"), "dispatcher missing");
  assert.ok(header.trimEnd().endsWith("#endif"), "include guard end missing");
});
