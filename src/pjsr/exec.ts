import type { BridgeClient } from "../bridge/client.js";

/**
 * run_script-delivered tools: the TS side builds a self-contained PJSR IIFE whose
 * final expression is JSON.stringify(result), sends it through the generic
 * run_script bridge command, and parses outputs.returnValue back into an object.
 *
 * Convention for the PJSR bodies (src/pjsr/measure-*.ts, render.ts):
 *   - wrap everything in (function(){ ... })(), the watcher evals in its own
 *     scope and bare `var`s would leak;
 *   - use only standard PJSR APIs (View.viewById, Image selections), never the
 *     watcher's internal helpers, keeps the bodies promotion-ready as embedded
 *     handlers if run_script delivery ever shows a problem;
 *   - on failure return JSON.stringify({error: "..."}) instead of throwing, so
 *     the error arrives structured rather than as a bridge Script error string.
 */
export async function execPjsrJson(
  bridge: BridgeClient,
  code: string,
  timeoutMs?: number
): Promise<any> {
  const result = await bridge.sendCommand(
    "run_script",
    "__script__",
    { code },
    timeoutMs ? { timeoutMs } : undefined
  );
  if (result.status === "error") throw new Error(result.error.message);
  const raw = (result as any).outputs?.returnValue ?? "";
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`PJSR returned non-JSON: ${String(raw).slice(0, 400)}`);
  }
  if (parsed && typeof parsed === "object" && parsed.error) throw new Error(parsed.error);
  return parsed;
}

export function jsonErrorContent(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

export function jsonContent(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}
