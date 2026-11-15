import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";
import { jsonContent } from "./content.js";
import { viewIdField } from "./fields.js";
import { registerTool } from "./register.js";

export function registerRenderTools(server: McpServer, bridge: BridgeClient): void {
  registerTool(server,
    "render_view",
    "Render an open view to PNG or JPEG for visual inspection. stf:'auto' = PixInsight's " +
      "autostretch computed on the full image (crops share the full field stretch), for linear " +
      "images only. It clamps and warns on a degenerate median, never judge a stars only layer on " +
      "'auto'. stf:'asis' = no transform (stretched images). stf:'view' = the view's own GUI STF. " +
      "rect = [x0,y0,x1,y1] source crop at 1:1, downsample = integer reduction factor.",
    {
      viewId: viewIdField,
      outputPath: z.string().describe("Absolute output path (.png or .jpg)"),
      stf: z.enum(["auto", "asis", "view"]).default("auto").describe("Stretch mode for the render"),
      rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional()
        .describe("Source crop [x0,y0,x1,y1] in image pixels"),
      downsample: z.number().int().min(1).max(16).optional().describe("Integer downsample factor"),
      quality: z.number().int().min(10).max(100).optional().describe("JPEG quality, default 100 (ignored for PNG)"),
    },
    async ({ viewId, outputPath, stf, rect, downsample, quality }) =>
      jsonContent(await bridge.request("render_view", { viewId, outputPath, stf, rect: rect ?? null, downsample, quality })),
  );
}
