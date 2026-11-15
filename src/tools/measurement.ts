import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";
import { jsonContent } from "./content.js";
import { viewIdField } from "./fields.js";
import { registerTool } from "./register.js";

// The star scan reads a full frame twice, which on a large master outlasts the default timeout.
const STAR_METRICS_TIMEOUT_MS = 600_000;
const DEFAULT_SAMPLES = 150_000;

const colorViewIdField = z.string().describe("Id of an open color view");
const targetSamplesField = z.number().int().min(10_000).max(1_000_000).default(DEFAULT_SAMPLES)
  .describe("Approximate number of grid samples");

export function registerMeasurementTools(server: McpServer, bridge: BridgeClient): void {
  registerTool(server,
    "get_noise",
    "Per-channel MRS noise estimate for an open image. Use this, never stdDev, to gauge noise and " +
      "denoising: stdDev is dominated by signal on astro images. Uniform sigma across channels " +
      "after denoising is healthy.",
    { viewId: viewIdField },
    async ({ viewId }) => jsonContent(await bridge.request("get_noise", { viewId })),
  );

  registerTool(server,
    "get_background_gradient",
    "Background map: per-channel medians over a grid of boxes, the corner spread and a least " +
      "squares plane fit. Use before and after gradient correction: the corner spread should drop " +
      "while the center median stays put. Box medians resist stars, boxes on nebulosity read high " +
      "and show in maxDeviationPct.",
    {
      viewId: viewIdField,
      gridSize: z.number().int().min(2).max(9).default(5).describe("Grid is gridSize x gridSize boxes"),
      boxFraction: z.number().min(0.01).max(0.2).default(0.04)
        .describe("Box side as a fraction of image width/height"),
    },
    async ({ viewId, gridSize, boxFraction }) =>
      jsonContent(await bridge.request("get_background_gradient", { viewId, gridSize, boxFraction })),
  );

  registerTool(server,
    "get_background_neutrality",
    "Background color neutrality. mode:'linear' (before any stretch) = per-channel medians of the " +
      "pixels within 8% of the median luminance, spreadPct <= 1 is neutral. That band is " +
      "meaningless after a stretch, so mode:'poststretch' reports bgChroma (mean saturation of the " +
      "near-neutral population, |rex| < 0.01) and faint and bright signal medians, to compare " +
      "across before and after calls. rex = signalChannel - mean(other channels), with " +
      "signalChannel the dominant emission (R for Ha or RGB dust).",
    {
      viewId: colorViewIdField,
      mode: z.enum(["linear", "poststretch"]).describe("linear before any stretch, poststretch after"),
      signalChannel: z.enum(["R", "G", "B"]).default("R").describe("Dominant signal channel (poststretch mode)"),
      targetSamples: targetSamplesField,
    },
    async ({ viewId, mode, signalChannel, targetSamples }) =>
      jsonContent(await bridge.request("get_background_neutrality", { viewId, mode, signalChannel, targetSamples })),
  );

  registerTool(server,
    "get_star_metrics",
    "Star metrics: approximate star count, median FWHM (px) and eccentricity of the brightest " +
      "stars from background subtracted moments (saturated peaks excluded), the brightest star " +
      "coordinates (for 1:1 crops), and starPixelMedian, the median of grid samples with " +
      "max(R,G,B) > 0.005, meaningful on a stars only layer. Values compare between calls, they " +
      "are not photometric: moment FWHM reads about 2.3x SubframeSelector's PSF fit FWHM, never " +
      "mix the two.",
    {
      viewId: viewIdField,
      maxStars: z.number().int().min(10).max(1000).default(200)
        .describe("How many of the brightest stars to measure for FWHM/eccentricity"),
    },
    async ({ viewId, maxStars }) =>
      jsonContent(await bridge.request("get_star_metrics", { viewId, maxStars }, { timeoutMs: STAR_METRICS_TIMEOUT_MS })),
  );

  registerTool(server,
    "get_structure_color",
    "Two chroma checks region medians cannot do. structure: the color of the nebulosity rather " +
      "than the sky under it, as bright minus dark population by luminance with stars excluded. A " +
      "region median is the sky, so a global cast can hide an inverted signal from it. Track " +
      "structure.RoverG and RoverB across steps, on an Ha field a fall toward 1.0 means red " +
      "structure is being neutralized. spatialChroma: saturation per tile and the share of pixels " +
      "at exactly R=G=B, which a single saturation number averages away. Use after anything that " +
      "pulls pixels toward luminance (desaturation, SCNR, neutralization) and after tone curves.",
    {
      viewId: colorViewIdField,
      rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional()
        .describe("Optional region [x0,y0,x1,y1], omit for the whole frame"),
      tileGrid: z.number().int().min(2).max(12).default(6)
        .describe("spatialChroma is computed on a tileGrid x tileGrid tile map"),
      targetSamples: targetSamplesField,
    },
    async ({ viewId, rect, tileGrid, targetSamples }) =>
      jsonContent(await bridge.request("get_structure_color", { viewId, rect: rect ?? null, tileGrid, targetSamples })),
  );
}
