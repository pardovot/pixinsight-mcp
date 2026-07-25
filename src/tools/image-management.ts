import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";

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
      const result = await bridge.sendCommand("save_image", "__internal__", {
        viewId, filePath, overwrite, compression,
      });
      if (result.status === "error") {
        return {
          content: [{ type: "text", text: `Error saving image: ${result.error.message}` }],
          isError: true,
        };
      }
      const out = (result as any).outputs ?? {};
      // Capability check: the handler echoes the hints it applied. An older installed module
      // silently ignores `compression` and writes UNCOMPRESSED, so fail loudly instead.
      if (out.hints === undefined) {
        return {
          content: [{
            type: "text",
            text:
              `Saved **${viewId}** to ${filePath}, but the installed MCPWatcher module predates ` +
              `compression support, so the file is UNCOMPRESSED and \`compression\` was ignored. ` +
              `Rebuild and reinstall the module (npm run module:build, module:sign, then ` +
              `module:install as admin with PixInsight closed).`,
          }],
          isError: true,
        };
      }
      const mb = out.bytes > 0 ? ` (${(out.bytes / 1048576).toFixed(1)} MB)` : "";
      const how = out.hints ? ` [${compression}]` : "";
      return {
        content: [{ type: "text", text: `Saved **${viewId}** to ${filePath}${mb}${how}` }],
      };
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
