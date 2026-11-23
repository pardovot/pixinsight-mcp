import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";
import { textContent } from "./content.js";
import { identifierField, viewIdField } from "./fields.js";
import { registerTool } from "./register.js";

// Two ways back: undo and redo walk PixInsight's own history, which is bounded, and a process
// that spawns a second window (StarXTerminator) reverts only on the target. A snapshot is a
// named hidden copy that survives any number of later steps, and restoring it is undoable.

interface HistoryState {
  historyIndex: number;
  canUndo: boolean;
  canRedo: boolean;
}

interface HistoryStep {
  index: number;
  processId: string;
  inner: string[] | null;
  settings: string[];
  applied: boolean;
  current: boolean;
}

const DEFAULT_SETTINGS_LINES = 12;
const MAX_SETTINGS_LINES = 200;

const describeState = (state: HistoryState) =>
  `index=${state.historyIndex}, canUndo=${state.canUndo}, canRedo=${state.canRedo}`;

function formatStep(step: HistoryStep): string {
  let head = `[${step.index}] ${step.processId}`;
  if (step.inner?.length) head += ` {${step.inner.join(", ")}}`;
  const flags = [step.current ? "CURRENT" : "", step.applied ? "" : "redoable, not applied"].filter(Boolean);
  if (flags.length) head += `  <${flags.join(", ")}>`;
  return [head, ...step.settings.map((line) => `      ${line}`)].join("\n");
}

export function registerHistoryTools(server: McpServer, bridge: BridgeClient): void {
  registerTool(server,
    "get_history",
    "Report a view's process history position: current index and whether undo/redo " +
      "are possible. Use canUndo before calling undo, and to verify a revert landed.",
    { viewId: viewIdField },
    async ({ viewId }) => {
      const state = await bridge.request<HistoryState>("get_history", { viewId });
      return textContent(`**${viewId}** history: ${describeState(state)}`);
    },
  );

  registerTool(server,
    "get_full_history",
    "List a view's full process history: every step's process name and its settings, what " +
      "the GUI History Explorer shows, plus the settings it hides. Read only, no undo/redo and " +
      "no pixel change. Step 0 is the base (integration), steps ahead of the current index are " +
      "flagged redoable. PixInsight prunes the redo branch when a process is applied after an " +
      "undo, so pruned steps never appear here.",
    {
      viewId: viewIdField,
      maxParamLines: z.number().int().min(1).max(MAX_SETTINGS_LINES).default(DEFAULT_SETTINGS_LINES)
        .describe("Max settings lines shown per step before truncating"),
    },
    async ({ viewId, maxParamLines }) => {
      const history = await bridge.request<HistoryState & { stepCount: number; steps: HistoryStep[] }>(
        "get_full_history", { viewId, maxParamLines });
      const header = `**${viewId}** history: ${history.stepCount} step(s) after the base, ${describeState(history)}`;
      return textContent([header, ...history.steps.map(formatStep)].join("\n"));
    },
  );

  registerTool(server,
    "undo",
    "Revert the last N steps of a view's process history (PixInsight's own undo). Stops early " +
      "if the history runs out. For a durable checkpoint you control, prefer snapshot/restore.",
    {
      viewId: viewIdField,
      steps: z.number().int().min(1).default(1).describe("Number of history steps to undo"),
    },
    async ({ viewId, steps }) => {
      const result = await bridge.request<HistoryState & { undone: number }>("undo", { viewId, steps });
      const exhausted = result.undone < steps ? ` (history exhausted after ${result.undone})` : "";
      return textContent(`Undid ${result.undone} step(s) on **${viewId}**${exhausted}. Now ${describeState(result)}.`);
    },
  );

  registerTool(server,
    "redo",
    "Replay the next N steps forward in a view's process history (companion to undo).",
    {
      viewId: viewIdField,
      steps: z.number().int().min(1).default(1).describe("Number of history steps to redo"),
    },
    async ({ viewId, steps }) => {
      const result = await bridge.request<HistoryState & { redone: number }>("redo", { viewId, steps });
      return textContent(`Redid ${result.redone} step(s) on **${viewId}**. Now ${describeState(result)}.`);
    },
  );

  registerTool(server,
    "snapshot",
    "Checkpoint a view into a hidden duplicate window you can restore later. Take one " +
      "before a risky or irreversible step (e.g. StarXTerminator). Reusing a snapshotId " +
      "overwrites that snapshot, and the id of a visible image is refused. The snapshot stays " +
      "open (hidden) until you close_image it.",
    {
      viewId: viewIdField,
      snapshotId: identifierField.optional().describe("Name for the snapshot window (default '<viewId>_snap')"),
    },
    async ({ viewId, snapshotId }) => {
      const snapshot = await bridge.request<{ snapshotId: string; width: number; height: number; channels: number }>(
        "snapshot", { viewId, snapshotId });
      return textContent(
        `Snapshot **${snapshot.snapshotId}** taken from **${viewId}** ` +
        `(${snapshot.width}x${snapshot.height}, ${snapshot.channels}ch). ` +
        `Restore with restore(viewId="${viewId}", snapshotId="${snapshot.snapshotId}").`);
    },
  );

  registerTool(server,
    "restore",
    "Restore a snapshot's pixels back into a view. Geometry must match. The restore is " +
      "itself registered as an undoable history step.",
    {
      viewId: viewIdField,
      snapshotId: z.string().describe("Snapshot window id from a prior snapshot() call"),
    },
    async ({ viewId, snapshotId }) => {
      const restored = await bridge.request<{ historyIndex: number }>("restore", { viewId, snapshotId });
      return textContent(
        `Restored **${viewId}** from snapshot **${snapshotId}** (now history index=${restored.historyIndex}, undo to reverse).`);
    },
  );
}
