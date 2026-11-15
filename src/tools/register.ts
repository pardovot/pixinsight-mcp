import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodRawShape } from "zod";
import { errorContent } from "./content.js";

type StrictSchema<Shape extends ZodRawShape> = ReturnType<typeof z.strictObject<Shape>>;

export type ToolHandler<Shape extends ZodRawShape> = (args: z.output<StrictSchema<Shape>>) => Promise<CallToolResult>;

/**
 * Registers a tool whose arguments are a strict object, so a misspelled or unknown argument is
 * rejected instead of dropped while the call runs with defaults. A thrown error becomes an error
 * result the assistant can read.
 */
export function registerTool<Shape extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  shape: Shape,
  handler: ToolHandler<Shape>,
): void {
  const inputSchema = z.strictObject(shape);
  server.registerTool<ZodRawShape, StrictSchema<Shape>>(name, { description, inputSchema }, async (args) => {
    try {
      return await handler(args);
    } catch (error: unknown) {
      return errorContent(error);
    }
  });
}
