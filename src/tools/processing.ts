import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";
import { textContent } from "./content.js";
import { registerTool } from "./register.js";

const processIdField = z.string().describe("Process class name, e.g. 'BlurXTerminator'");

export function registerProcessingTools(server: McpServer, bridge: BridgeClient): void {
  registerTool(server,
    "run_process",
    "Run any PixInsight process by its class name (e.g. BlurXTerminator, " +
      "AutomaticBackgroundExtractor, PixelMath). This is the general mechanism, there are no " +
      "process specific tools.\n" +
      "METHOD (do this, don't run blindly):\n" +
      "1. First call get_process_parameters(processId) to see settings + defaults, and " +
      "reason about what they mean (recall or check pixinsight.com/doc).\n" +
      "2. Watch for no-op output defaults: some processes only make a side product unless " +
      "you configure output. E.g. AutomaticBackgroundExtractor defaults to targetCorrection=0 " +
      "(no correction), to actually correct the image pass { targetCorrection: 1, replaceTarget: true }.\n" +
      "3. Pick settings from measuring THIS image (get_image_statistics and the measurement tools), not fixed defaults.\n" +
      "4. After running, ALWAYS re-measure. If stats are byte-identical to before, it was a no-op, " +
      "stop and fix the output config; do not build the next step on it.\n" +
      "Unknown setting names are rejected (checked against get_process_parameters).",
    {
      processId: processIdField,
      viewId: z.string().optional().describe("Target view id (omit for a global process)"),
      settings: z.record(z.string(), z.unknown()).optional()
        .describe("Process parameters as { name: value } (see get_process_parameters)"),
    },
    async ({ processId, viewId, settings }) => {
      const result = await bridge.call("run_process", { processId, settings: settings ?? {} },
        { targetView: viewId ?? null });
      if (result.status === "error") throw new Error(result.error.message);
      return textContent(result.message || `${processId} executed${viewId ? ` on **${viewId}**` : " (global)"}`);
    },
  );

  registerTool(server,
    "get_process_parameters",
    "List the settable parameters (and their default values) of a PixInsight process, " +
      "so you know what 'settings' run_process accepts.",
    { processId: processIdField },
    async ({ processId }) => {
      const { parameters } = await bridge.request<{ parameters: Record<string, unknown> }>(
        "get_process_parameters", { processId });
      const lines = Object.entries(parameters).map(([name, value]) => `- ${name} = ${JSON.stringify(value)}`);
      return textContent(`**${processId}** parameters:\n${lines.join("\n")}`);
    },
  );
}
