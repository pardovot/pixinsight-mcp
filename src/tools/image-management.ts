import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { execPjsrJson } from "../pjsr/exec.js";

/**
 * Save a view via PJSR so we can pass XISF format hints, which the module's
 * `save_image` handler cannot (it calls the 5-arg saveAs). Measured on a
 * 6159x7396 float RGB master: 521.7 MB uncompressed -> 384.2 MB with zlib+sh.
 * Byte shuffling is the load-bearing part for float data; an EMPTY hints string
 * means "format defaults", NOT "no compression", so we always pass it explicitly.
 * The hint is XISF-only, other writers reject an unknown codec hint.
 */
function saveScript(
  viewId: string,
  filePath: string,
  overwrite: boolean,
  compression: string
): string {
  const id = JSON.stringify(viewId);
  const out = JSON.stringify(filePath);
  const codec = JSON.stringify(compression);
  return `(function(){
  var w = ImageWindow.windowById(${id});
  if (!w || w.isNull) throw new Error("Image not found: " + ${id});
  var path = ${out};
  if (File.exists(path) && !${overwrite ? "true" : "false"})
     throw new Error("File already exists (set overwrite=true): " + path);
  // ALWAYS emit an explicit codec for XISF. Empty hints means "format defaults", and those
  // defaults are SESSION-MUTABLE: a previous saveAs with a codec hint changes them, so an
  // empty-hint save silently inherits it (probed live: "" gave 16.95 MB, then 12.07 MB after
  // one zlib+sh save of the same image). Explicit hints keep file sizes deterministic.
  var isXisf = /\\.xisf$/i.test(path);
  var codec = ${codec};
  var hints = isXisf ? ("compression-codec " + codec) : "";
  w.saveAs(path, false, false, false, false, hints);
  // File.size() does NOT exist in PJSR (probed live); FileInfo carries the size.
  var bytes = -1;
  try { bytes = new FileInfo(path).size; } catch (e) {}
  return JSON.stringify({ viewId: ${id}, filePath: path, hints: hints, bytes: bytes });
})()`;
}

export function registerImageManagementTools(server: McpServer, bridge: BridgeClient): void {

  // list_open_images
  server.tool(
    "list_open_images",
    "List all currently open image windows in PixInsight",
    {},
    async () => {
      const result = await bridge.sendCommand("list_open_images", "__internal__", {});
      if (result.status === "error") {
        return {
          content: [{ type: "text", text: `Error: ${result.error.message}` }],
          isError: true,
        };
      }
      const images = (result as any).outputs?.images ?? [];
      if (images.length === 0) {
        return {
          content: [{ type: "text", text: "No images are currently open in PixInsight." }],
        };
      }
      const lines = images.map((img: any) =>
        `- **${img.id}**: ${img.width}x${img.height}, ${img.channels}ch, ${img.isColor ? "color" : "mono"}, ${img.bitDepth}bit` +
        (img.filePath ? ` (${img.filePath})` : "")
      );
      return {
        content: [{ type: "text", text: `Open images (${images.length}):\n${lines.join("\n")}` }],
      };
    }
  );

  // open_image
  server.tool(
    "open_image",
    "Open an image file in PixInsight",
    { filePath: z.string().describe("Absolute path to FITS/XISF/TIFF file") },
    async ({ filePath }) => {
      const result = await bridge.sendCommand("open_image", "__internal__", { filePath });
      if (result.status === "error") {
        return {
          content: [{ type: "text", text: `Error opening image: ${result.error.message}` }],
          isError: true,
        };
      }
      const out = (result as any).outputs ?? {};
      return {
        content: [{
          type: "text",
          text: `Opened image: **${out.id}** (${out.width}x${out.height}, ${out.channels}ch)`,
        }],
      };
    }
  );

  // save_image
  server.tool(
    "save_image",
    "Save an open image to disk. XISF is written COMPRESSED by default (zlib+sh, about -26% on " +
      "float masters); pass compression:'none' only if you have a reason. The codec hint is " +
      "ignored for non-XISF formats.",
    {
      viewId: z.string().describe("View ID of the image to save"),
      filePath: z.string().describe("Output path (.xisf, .fits, .tiff, .png)"),
      overwrite: z.boolean().default(false).describe("Overwrite existing file"),
      compression: z
        .enum(["zlib+sh", "zstd+sh", "lz4+sh", "lz4hc+sh", "zlib", "zstd", "lz4", "lz4hc", "none"])
        .default("zlib+sh")
        .describe(
          "XISF compression codec. '+sh' = byte shuffling, which is what makes float data " +
            "compress; keep it unless you know otherwise. XISF only."
        ),
    },
    async ({ viewId, filePath, overwrite, compression }) => {
      try {
        const out = await execPjsrJson(
          bridge,
          saveScript(viewId, filePath, overwrite, compression)
        );
        const mb = out.bytes > 0 ? ` (${(out.bytes / 1048576).toFixed(1)} MB)` : "";
        const how = out.hints ? ` [${compression}]` : "";
        return {
          content: [{ type: "text", text: `Saved **${viewId}** to ${filePath}${mb}${how}` }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error saving image: ${e?.message ?? String(e)}` }],
          isError: true,
        };
      }
    }
  );

  // close_image
  server.tool(
    "close_image",
    "Close an open image window in PixInsight",
    { viewId: z.string().describe("View ID of the image to close") },
    async ({ viewId }) => {
      const result = await bridge.sendCommand("close_image", "__internal__", { viewId });
      if (result.status === "error") {
        return {
          content: [{ type: "text", text: `Error closing image: ${result.error.message}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: `Closed image: **${viewId}**` }],
      };
    }
  );

  // get_image_statistics
  server.tool(
    "get_image_statistics",
    "Get per-channel statistics (mean, median, stddev, min, max) for an open image",
    { viewId: z.string().describe("View ID of the image") },
    async ({ viewId }) => {
      const result = await bridge.sendCommand("get_image_statistics", "__internal__", { viewId });
      if (result.status === "error") {
        return {
          content: [{ type: "text", text: `Error: ${result.error.message}` }],
          isError: true,
        };
      }
      const stats = (result as any).outputs?.statistics ?? [];
      const lines = stats.map((s: any) =>
        `**${s.channelName}**: mean=${s.mean.toFixed(6)}, median=${s.median.toFixed(6)}, ` +
        `stdDev=${s.stdDev.toFixed(6)}, min=${s.min.toFixed(6)}, max=${s.max.toFixed(6)}`
      );
      return {
        content: [{ type: "text", text: `Statistics for **${viewId}**:\n${lines.join("\n")}` }],
      };
    }
  );
}
