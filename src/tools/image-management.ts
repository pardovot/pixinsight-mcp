import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";
import { textContent } from "./content.js";
import { viewIdField } from "./fields.js";
import { registerTool } from "./register.js";

interface OpenImage {
  id: string;
  filePath: string | null;
  width: number;
  height: number;
  channels: number;
  isColor: boolean;
  bitDepth: number;
}

interface ChannelStatistics {
  channelName: string;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
}

// Same list as SAVE_CODECS in pjsr/images.js, shuffled codecs first since they suit float data.
const SAVE_CODECS = ["zlib+sh", "zstd+sh", "lz4+sh", "lz4hc+sh", "zlib", "zstd", "lz4", "lz4hc", "none"] as const;
const BYTES_PER_MB = 1024 * 1024;
const STATISTIC_DECIMALS = 6;

export function registerImageManagementTools(server: McpServer, bridge: BridgeClient): void {
  registerTool(server,
    "list_open_images",
    "List the image windows open in PixInsight, with size, channels and file path.",
    {},
    async () => {
      const { images } = await bridge.request<{ images: OpenImage[] }>("list_open_images");
      if (images.length === 0) return textContent("No images are open in PixInsight.");
      const lines = images.map((image) =>
        `- **${image.id}**: ${image.width}x${image.height}, ${image.channels}ch, ` +
        `${image.isColor ? "color" : "mono"}, ${image.bitDepth}bit` +
        (image.filePath ? ` (${image.filePath})` : ""));
      return textContent(`Open images (${images.length}):\n${lines.join("\n")}`);
    },
  );

  registerTool(server,
    "open_image",
    "Open an image file (XISF, FITS, TIFF, ...) in PixInsight.",
    { filePath: z.string().describe("Absolute path of the file") },
    async ({ filePath }) => {
      const opened = await bridge.request<Omit<OpenImage, "filePath" | "isColor" | "bitDepth">>(
        "open_image", { filePath });
      return textContent(`Opened **${opened.id}** (${opened.width}x${opened.height}, ${opened.channels}ch)`);
    },
  );

  registerTool(server,
    "save_image",
    "Save an open image to disk. XISF is written COMPRESSED by default (zlib+sh, about -26% on " +
      "float masters), pass compression:'none' only with a reason. Other formats ignore the codec.",
    {
      viewId: viewIdField,
      filePath: z.string().describe("Output path (.xisf, .fits, .tiff, .png)"),
      overwrite: z.boolean().default(false).describe("Replace an existing file"),
      compression: z.enum(SAVE_CODECS).default("zlib+sh").describe(
        "XISF codec. '+sh' is byte shuffling, which is what makes float data compress, keep it " +
          "unless you know otherwise."),
    },
    async ({ viewId, filePath, overwrite, compression }) => {
      const saved = await bridge.request<{ hints: string; bytes: number }>(
        "save_image", { viewId, filePath, overwrite, compression });
      const size = saved.bytes > 0 ? ` (${(saved.bytes / BYTES_PER_MB).toFixed(1)} MB)` : "";
      const codec = saved.hints ? ` [${compression}]` : "";
      return textContent(`Saved **${viewId}** to ${filePath}${size}${codec}`);
    },
  );

  registerTool(server,
    "close_image",
    "Close an image window in PixInsight, discarding unsaved changes.",
    { viewId: viewIdField },
    async ({ viewId }) => {
      await bridge.request("close_image", { viewId });
      return textContent(`Closed **${viewId}**`);
    },
  );

  registerTool(server,
    "get_image_statistics",
    "Per-channel mean, median, standard deviation, min and max of an open view.",
    { viewId: viewIdField },
    async ({ viewId }) => {
      const { statistics } = await bridge.request<{ statistics: ChannelStatistics[] }>(
        "get_image_statistics", { viewId });
      const format = (value: number) => value.toFixed(STATISTIC_DECIMALS);
      const lines = statistics.map((channel) =>
        `**${channel.channelName}**: mean=${format(channel.mean)}, median=${format(channel.median)}, ` +
        `stdDev=${format(channel.stdDev)}, min=${format(channel.min)}, max=${format(channel.max)}`);
      return textContent(`Statistics for **${viewId}**:\n${lines.join("\n")}`);
    },
  );
}
