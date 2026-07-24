import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";

/**
 * Reproducibility export.
 *
 * A processing session has two artifacts worth persisting:
 *   - per-section ProcessContainer `.xpsm` icons (narrow, one per image/section) -
 *     e.g. a `linear` container on the master, a `starless` container on the starless,
 *     a `stars` container on the stars layer;
 *   - one whole-session `replay.js` (empty -> exact final state), authored from the
 *     same process definitions (see result-tests/.../replay.js for the reference).
 *
 * This tool covers the first. PixInsight's scripting API CANNOT create process icons
 * (`writeIcon` only overwrites an existing GUI icon), but a `.xpsm` is plain XML we can
 * write directly; opening it in PixInsight materialises the icon. The watcher handler
 * (`handleExportContainer`) reads a view's process-history slice and emits the container.
 *
 * IMPORTANT, capture LIVE, per section: `view.processing` resets on save+reopen, and
 * `createNewImage` outputs start with empty history. Call this at each section boundary
 * while the view is still the live processed view, not after reopening from disk.
 *
 * Logic lives in the watcher handler (project rule: "handler logic in ONE place, the JS").
 */
export function registerExportTools(server: McpServer, bridge: BridgeClient): void {

  function errorContent(message: string) {
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  }

  server.tool(
    "export_container",
    "Write a loadable PixInsight ProcessContainer .xpsm from a view's process-history slice " +
      "(the icon appears when you open the file in PixInsight). Use per section: point it at the " +
      "live processed view and, optionally, a [fromIndex,toIndex) range to isolate one section " +
      "(linear / starless / stars / recombine). CAPTURE LIVE, view.processing resets on " +
      "save+reopen and createNewImage outputs start empty, so export before saving/closing the view.",
    {
      viewId: z.string().describe("View ID whose process history to export"),
      outputPath: z.string().describe("Absolute path to write the .xpsm file to"),
      iconName: z.string().default("ProcessContainer")
        .describe("Name of the container icon shown in PixInsight (e.g. 'RhoOph_Starless')"),
      fromIndex: z.number().int().min(0).optional()
        .describe("First history step to include (default 0 = start of this view's history)"),
      toIndex: z.number().int().min(0).optional()
        .describe("End of the slice, exclusive (default = full history length)"),
    },
    async ({ viewId, outputPath, iconName, fromIndex, toIndex }) => {
      const result = await bridge.sendCommand("export_container", "__internal__", {
        viewId, outputPath, iconName, fromIndex, toIndex,
      });
      if (result.status === "error") return errorContent(result.error.message);
      const o = (result as any).outputs ?? {};
      return {
        content: [{
          type: "text" as const,
          text: `Wrote container **${iconName}** (${o.count} process(es): ${(o.processes ?? []).join(", ")}) ` +
            `from ${viewId}[${o.fromIndex}..${o.toIndex}) to ${o.path}. Open it in PixInsight to load the icon.`,
        }],
      };
    }
  );
}
