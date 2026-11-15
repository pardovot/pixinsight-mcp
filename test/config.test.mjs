// Bridge configuration from the environment (src/config.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveBridgeDir, resolveInstance } from "../build/config.js";

const DEFAULT_BRIDGE_DIR = join(homedir(), ".pixinsight-mcp", "bridge");

function withEnv(vars, callback) {
  const keys = ["PIXINSIGHT_MCP_BRIDGE_DIR", "PIXINSIGHT_MCP_INSTANCE"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    for (const [key, value] of Object.entries(vars)) process.env[key] = value;
    return callback();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("default bridge dir is under the home directory", () => {
  withEnv({}, () => assert.equal(resolveBridgeDir(), DEFAULT_BRIDGE_DIR));
});

test("PIXINSIGHT_MCP_BRIDGE_DIR overrides the bridge dir", () => {
  withEnv({ PIXINSIGHT_MCP_BRIDGE_DIR: "/srv/custom-bridge" }, () =>
    assert.equal(resolveBridgeDir(), "/srv/custom-bridge"));
});

test("a leading ~/ in the bridge dir is expanded", () => {
  withEnv({ PIXINSIGHT_MCP_BRIDGE_DIR: "~/elsewhere" }, () =>
    assert.equal(resolveBridgeDir(), join(homedir(), "elsewhere")));
});

test("no instance env targets the first running instance", () => {
  withEnv({}, () => assert.equal(resolveInstance(), null));
});

test("PIXINSIGHT_MCP_INSTANCE=N pins slot N", () => {
  withEnv({ PIXINSIGHT_MCP_INSTANCE: "2" }, () => assert.equal(resolveInstance(), 2));
});

test("junk or out of range instance values are ignored", () => {
  for (const value of ["nope", "0", "257"])
    withEnv({ PIXINSIGHT_MCP_INSTANCE: value }, () => assert.equal(resolveInstance(), null));
});
