// Bridge-dir resolution: the server half of the multi-instance slot convention
// (src/types.ts resolveBridgeDir). Must stay in lockstep with the C++ module
// (BridgePoller::ResolveBridgeDir) and the PJSR watcher (resolveBridgeSlot).
import test from "node:test";
import assert from "node:assert/strict";
import { resolveBridgeDir } from "../build/types.js";

function withEnv(vars, fn) {
  const keys = ["PIXINSIGHT_MCP_BRIDGE_DIR", "PIXINSIGHT_MCP_INSTANCE"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) process.env[k] = v;
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("default (no env): slot 1 keeps the historical path", () => {
  withEnv({}, () => assert.equal(resolveBridgeDir(), "~/.pixinsight-mcp/bridge"));
});

test("PIXINSIGHT_MCP_INSTANCE=1 stays on the historical path (back-compat)", () => {
  withEnv({ PIXINSIGHT_MCP_INSTANCE: "1" }, () =>
    assert.equal(resolveBridgeDir(), "~/.pixinsight-mcp/bridge"));
});

test("PIXINSIGHT_MCP_INSTANCE=N>1 gets the per-slot suffix", () => {
  withEnv({ PIXINSIGHT_MCP_INSTANCE: "2" }, () =>
    assert.equal(resolveBridgeDir(), "~/.pixinsight-mcp/bridge-2"));
});

test("explicit PIXINSIGHT_MCP_BRIDGE_DIR wins over the instance slot", () => {
  withEnv({ PIXINSIGHT_MCP_BRIDGE_DIR: "/tmp/custom-bridge", PIXINSIGHT_MCP_INSTANCE: "3" }, () =>
    assert.equal(resolveBridgeDir(), "/tmp/custom-bridge"));
});

test("junk instance value falls back to slot 1", () => {
  withEnv({ PIXINSIGHT_MCP_INSTANCE: "nope" }, () =>
    assert.equal(resolveBridgeDir(), "~/.pixinsight-mcp/bridge"));
});
