import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodRawShape } from "zod";
import { runInCallContext, type CallContext } from "../bridge/call-context.js";
import { errorContent } from "./content.js";

type StrictSchema<Shape extends ZodRawShape> = ReturnType<typeof z.strictObject<Shape>>;

export type ToolHandler<Shape extends ZodRawShape> = (args: z.output<StrictSchema<Shape>>) => Promise<CallToolResult>;

/**
 * Registers a tool whose arguments are a strict object, so a misspelled or unknown argument is
 * rejected instead of dropped while the call runs with defaults. A thrown error becomes an error
 * result the assistant can read. The handler's bridge calls see the request's cancellation signal
 * and, when the client asked for progress, a way to report it.
 */
export function registerTool<Shape extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  shape: Shape,
  handler: ToolHandler<Shape>,
): void {
  const inputSchema = z.strictObject(shape);
  server.registerTool<ZodRawShape, StrictSchema<Shape>>(name, { description, inputSchema }, async (args, extra) => {
    const progressToken = extra._meta?.progressToken;
    const context: CallContext = { signal: extra.signal };
    if (progressToken !== undefined)
      context.reportProgress = (progress, message) =>
        extra.sendNotification({ method: "notifications/progress", params: { progressToken, progress, message } });
    try {
      return await runInCallContext(context, () => handler(args));
    } catch (error: unknown) {
      return errorContent(error);
    }
  });
}
