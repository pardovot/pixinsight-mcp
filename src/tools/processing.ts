import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";

function processResult(result: any, successMsg: string) {
  if (result.status === "error") {
    return {
      content: [{ type: "text" as const, text: `Error: ${result.error.message}` }],
      isError: true,
    };
  }
  const msg = result.message || successMsg;
  return {
    content: [{ type: "text" as const, text: msg }],
  };
}

export function registerProcessingTools(server: McpServer, bridge: BridgeClient): void {

  // run_pixelmath
  server.tool(
    "run_pixelmath",
    "Execute a PixelMath expression on an image",
    {
      expression: z.string().describe("Math expression (e.g. '$T * 0.5')"),
      expression1: z.string().optional().describe("Green channel expression (if different)"),
      expression2: z.string().optional().describe("Blue channel expression (if different)"),
      targetViewId: z.string().optional().describe("Apply to this view in-place"),
      createNewImage: z.boolean().default(false).describe("Create a new image instead"),
      newImageId: z.string().optional().describe("ID for new image"),
    },
    async (params) => {
      const result = await bridge.sendCommand("run_pixelmath", "PixelMath", {
        expression: params.expression,
        expression1: params.expression1 ?? "",
        expression2: params.expression2 ?? "",
        useSingleExpression: !params.expression1 && !params.expression2,
        createNewImage: params.createNewImage,
        newImageId: params.newImageId ?? "",
      }, {
        executeMethod: params.targetViewId ? "executeOn" : "executeGlobal",
        targetView: params.targetViewId,
      });
      return processResult(result, `PixelMath executed: ${params.expression}`);
    }
  );

  // run_process — generic: run ANY PixInsight process by name
  server.tool(
    "run_process",
    "Run any PixInsight process by its class name (e.g. BlurXTerminator, " +
      "AutomaticBackgroundExtractor, PixelMath). This is the general mechanism — prefer " +
      "it over process-specific tools.\n" +
      "METHOD (do this, don't run blindly):\n" +
      "1. First call get_process_parameters(processId) to see settings + defaults, and " +
      "reason about what they mean (recall or check pixinsight.com/doc).\n" +
      "2. Watch for no-op output defaults: some processes only make a side product unless " +
      "you configure output. E.g. AutomaticBackgroundExtractor defaults to targetCorrection=0 " +
      "(no correction) — to actually correct the image pass { targetCorrection: 1, replaceTarget: true }.\n" +
      "3. Pick settings from measuring THIS image (get_image_statistics / run_script), not fixed defaults.\n" +
      "4. After running, ALWAYS re-measure. If stats are byte-identical to before, it was a no-op — " +
      "stop and fix the output config; do not build the next step on it.\n" +
      "Unknown setting names are rejected (checked against get_process_parameters).",
    {
      processId: z.string().describe("Process class name, e.g. 'BlurXTerminator'"),
      viewId: z.string().optional().describe("Target view id (omit for a global process)"),
      settings: z.record(z.any()).optional().describe("Process parameters as { name: value } (see get_process_parameters)"),
    },
    async ({ processId, viewId, settings }) => {
      const result = await bridge.sendCommand("run_process", processId, {
        processId,
        settings: settings ?? {},
      }, viewId ? { executeMethod: "executeOn", targetView: viewId } : { executeMethod: "executeGlobal" });
      return processResult(result, `${processId} executed${viewId ? ` on **${viewId}**` : " (global)"}`);
    }
  );

  // get_process_parameters — introspect a process's settable parameters + defaults
  server.tool(
    "get_process_parameters",
    "List the settable parameters (and their default values) of a PixInsight process, " +
      "so you know what 'settings' run_process accepts.",
    {
      processId: z.string().describe("Process class name, e.g. 'BlurXTerminator'"),
    },
    async ({ processId }) => {
      const result = await bridge.sendCommand("get_process_parameters", processId, { processId });
      if (result.status === "error") {
        return { content: [{ type: "text" as const, text: `Error: ${result.error.message}` }], isError: true };
      }
      const params = (result as any).outputs?.parameters ?? {};
      const lines = Object.keys(params).map((k) => `- ${k} = ${JSON.stringify(params[k])}`).join("\n");
      return { content: [{ type: "text" as const, text: `**${processId}** parameters:\n${lines}` }] };
    }
  );

  // run_script
  server.tool(
    "run_script",
    "Execute arbitrary PJSR code inside PixInsight (escape hatch for anything not covered by " +
      "specific tools). Returns the script's final expression value (not console output).",
    {
      code: z.string().describe("PJSR JavaScript code to execute"),
    },
    async ({ code }) => {
      const result = await bridge.sendCommand("run_script", "__script__", { code });
      if (result.status === "error") {
        return {
          content: [{ type: "text" as const, text: `Script error: ${result.error.message}` }],
          isError: true,
        };
      }
      const output = (result as any).outputs?.returnValue ?? (result as any).message ?? "Script executed.";
      return {
        content: [{ type: "text" as const, text: output }],
      };
    }
  );
}
