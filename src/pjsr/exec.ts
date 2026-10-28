import type { BridgeClient } from "../bridge/client.js";

/**
 * Runs a handler-section verb (measurement, rendering) and returns its
 * outputs.result. The verb's code lives in the module, only data is sent.
 */
export async function execHandler(
  bridge: BridgeClient,
  tool: string,
  parameters: Record<string, unknown>,
  timeoutMs?: number
): Promise<Record<string, unknown>> {
  const result = await bridge.sendCommand(tool, tool, parameters, timeoutMs ? { timeoutMs } : undefined);
  if (result.status === "error") throw new Error(result.error.message);
  const outputs = (result as { outputs?: { result?: unknown } }).outputs;
  if (!outputs || outputs.result === undefined) throw new Error(`${tool} returned no result`);
  return outputs.result as Record<string, unknown>;
}

export function jsonErrorContent(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

export function jsonContent(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}
