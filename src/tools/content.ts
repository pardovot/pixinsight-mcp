import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function textContent(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function jsonContent(value: unknown): CallToolResult {
  return textContent(JSON.stringify(value, null, 2));
}

export function errorContent(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}
