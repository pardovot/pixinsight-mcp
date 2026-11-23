import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";
import { textContent } from "./content.js";
import { identifierField, viewIdField } from "./fields.js";
import { registerTool } from "./register.js";

interface ExportedContainer {
  path: string;
  count: number;
  processes: string[];
  fromIndex: number;
  toIndex: number;
  /** Parameters left out as <Process>.<parameter>, which load with the process's defaults. */
  skipped: string[];
}

export function registerExportTools(server: McpServer, bridge: BridgeClient): void {
  registerTool(server,
    "export_container",
    "Write a loadable PixInsight ProcessContainer .xpsm from a slice of a view's process history " +
      "(the icon appears when you open the file in PixInsight). Point it at the live processed " +
      "view, optionally with a [fromIndex,toIndex) range to isolate one section. Export before " +
      "saving or closing the view: view.processing resets when a file is saved and reopened, and " +
      "createNewImage outputs start with an empty history.",
    {
      viewId: viewIdField,
      outputPath: z.string().describe("Absolute path to write the .xpsm file to"),
      iconName: identifierField.default("ProcessContainer").describe("Name of the container icon shown in PixInsight"),
      fromIndex: z.number().int().min(0).optional()
        .describe("First history step to include (default 0 = start of this view's history)"),
      toIndex: z.number().int().min(0).optional()
        .describe("End of the slice, exclusive (default = full history length)"),
    },
    async ({ viewId, outputPath, iconName, fromIndex, toIndex }) => {
      const exported = await bridge.request<ExportedContainer>(
        "export_container", { viewId, outputPath, iconName, fromIndex, toIndex });
      const skipped = exported.skipped.length
        ? ` Parameters that could not be written and load with their defaults: ${exported.skipped.join(", ")}.`
        : "";
      return textContent(
        `Wrote container **${iconName}** (${exported.count} process(es): ${exported.processes.join(", ")}) ` +
        `from ${viewId}[${exported.fromIndex}..${exported.toIndex}) to ${exported.path}. ` +
        `Open it in PixInsight to load the icon.${skipped}`);
    },
  );
}
