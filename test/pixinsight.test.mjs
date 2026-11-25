// The command that starts PixInsight (src/pixinsight.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { launchCommand, pixinsightExecutable } from "../build/pixinsight.js";

function withLaunchOverride(value, callback) {
  const saved = process.env.PIXINSIGHT_MCP_LAUNCH;
  try {
    if (value === undefined) delete process.env.PIXINSIGHT_MCP_LAUNCH;
    else process.env.PIXINSIGHT_MCP_LAUNCH = value;
    return callback();
  } finally {
    if (saved === undefined) delete process.env.PIXINSIGHT_MCP_LAUNCH;
    else process.env.PIXINSIGHT_MCP_LAUNCH = saved;
  }
}

test("PixInsight starts from its executable, in a slot when one is given", () => {
  withLaunchOverride(undefined, () => {
    assert.deepEqual(launchCommand(null), { command: pixinsightExecutable(), args: [], shell: false });
    assert.deepEqual(launchCommand(2), { command: pixinsightExecutable(), args: ["-n=2"], shell: false });
  });
});

test("PIXINSIGHT_MCP_LAUNCH replaces the executable with a shell command, which takes the slot argument", () => {
  withLaunchOverride('"/opt/tools/start pixinsight.sh"', () => {
    assert.deepEqual(launchCommand(null), { command: '"/opt/tools/start pixinsight.sh"', args: [], shell: true });
    assert.deepEqual(launchCommand(3), { command: '"/opt/tools/start pixinsight.sh" -n=3', args: [], shell: true });
  });
});
