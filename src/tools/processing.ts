import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";
import {
  checkProcessCall,
  deadParamsFor,
  formatBlocks,
  formatNotes,
  formatWarnings,
  overrideEnabled,
} from "../facts/guard.js";
import { textContent } from "./content.js";
import { registerTool } from "./register.js";
import { formatScriptRun, parseScriptSettings, SCRIPT_PROCESS_ID, SCRIPT_SETTINGS_HELP, type ScriptRunOutputs } from "./script.js";

const processIdField = z.string().describe("Process class name, e.g. 'BlurXTerminator'");

export function registerProcessingTools(server: McpServer, bridge: BridgeClient): void {
  registerTool(server,
    "run_process",
    "Run any PixInsight process by its class name (e.g. BlurXTerminator, " +
      "AutomaticBackgroundExtractor, PixelMath). This is the general mechanism, there are no " +
      "process specific tools.\n" +
      "Method, in place of running blindly:\n" +
      "1. First call get_process_parameters(processId) to see settings and defaults, and " +
      "reason about what they mean (recall or check pixinsight.com/doc).\n" +
      "2. Watch for output defaults that do nothing: some processes only make a side product unless " +
      "you configure output. E.g. AutomaticBackgroundExtractor defaults to targetCorrection=0 " +
      "(no correction), to actually correct the image pass { targetCorrection: 1, replaceTarget: true }.\n" +
      "3. Pick settings from measuring this image (get_image_statistics and the measurement tools), not fixed defaults.\n" +
      "4. After running, always measure again. Stats byte identical to before mean the process did nothing, " +
      "so stop and fix the output config before building the next step on it.\n" +
      "Unknown setting names are rejected (checked against get_process_parameters).\n" +
      "processId 'Script' runs a script file (Script menu scripts included) with no user interaction, " +
      "see get_process_parameters('Script').",
    {
      processId: processIdField,
      viewId: z.string().optional().describe("Target view id (omit for a global process)"),
      settings: z.record(z.string(), z.unknown()).optional()
        .describe("Process parameters as { name: value } (see get_process_parameters)"),
    },
    async ({ processId, viewId, settings = {} }) => {
      if (processId === SCRIPT_PROCESS_ID) {
        const script = parseScriptSettings(settings);
        const result = await bridge.call<ScriptRunOutputs>("run_script", {
          filePath: script.filePath, parameters: script.parameters, dialogs: script.dialogs,
          answers: script.answers, inspect: script.inspect,
        }, { targetView: viewId ?? null, script: { path: script.filePath, arguments: script.arguments } });
        if (result.status === "error") throw new Error(result.error.message);
        return textContent(formatScriptRun(result.message ?? "Script ran", result.outputs));
      }

      // Verified defects are refused before the call reaches PixInsight. Some hang the
      // application, and the ones that do nothing would return success with an unchanged image.
      const { blocks, warnings } = checkProcessCall({ processId, viewId, settings });
      if (blocks.length > 0 && !overrideEnabled()) throw new Error(formatBlocks(processId, blocks));

      const result = await bridge.call("run_process", { processId, settings }, { targetView: viewId ?? null });
      if (result.status === "error") throw new Error(result.error.message);
      const summary = result.message || `${processId} executed${viewId ? ` on **${viewId}**` : " (global)"}`;
      return textContent(summary + (warnings.length > 0 ? formatWarnings(warnings) : ""));
    },
  );

  registerTool(server,
    "get_process_parameters",
    "List the settable parameters (and their default values) of a PixInsight process, " +
      "so you know what 'settings' run_process accepts.",
    { processId: processIdField },
    async ({ processId }) => {
      if (processId === SCRIPT_PROCESS_ID) return textContent(SCRIPT_SETTINGS_HELP);
      const { parameters } = await bridge.request<{ parameters: Record<string, unknown> }>(
        "get_process_parameters", { processId });
      // Introspection lists dead aliases as ordinary parameters, so they are marked here.
      const dead = deadParamsFor(processId);
      const lines = Object.entries(parameters).map(([name, value]) => {
        const fact = dead.get(name.toLowerCase());
        const mark = fact ? `   [dead, ${fact.id}: setting this is refused, ${fact.fix ?? "no effect"}]` : "";
        return `- ${name} = ${JSON.stringify(value)}${mark}`;
      });
      return textContent(`**${processId}** parameters:\n${lines.join("\n")}${formatNotes(processId)}`);
    },
  );
}
