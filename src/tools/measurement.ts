import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { execPjsrJson, jsonContent, jsonErrorContent } from "../pjsr/exec.js";
import { noiseScript } from "../pjsr/measure-noise.js";
import { gradientScript } from "../pjsr/measure-gradient.js";
import { neutralityScript } from "../pjsr/measure-neutrality.js";
import { starMetricsScript } from "../pjsr/measure-stars.js";

/**
 * M2 measurement tools (journal backlog #3/#9/#13). Delivered via run_script -
 * the PJSR bodies live in src/pjsr/measure-*.ts (promotion-ready as embedded
 * handlers if run_script delivery ever shows a problem). These replace the
 * per-run hand-rolled measurement code the agent previously improvised.
 */
export function registerMeasurementTools(server: McpServer, bridge: BridgeClient): void {

  server.tool(
    "get_noise",
    "Per-channel MRS noise estimate for an open image. ALWAYS use this (never stdDev) to gauge " +
      "noise/denoising: stdDev is signal-dominated on astro images and produces false alarms. " +
      "Returns sigma per channel; uniform sigma across channels after denoising = healthy.",
    {
      viewId: z.string().describe("View ID of the image"),
    },
    async ({ viewId }) => {
      try {
        return jsonContent(await execPjsrJson(bridge, noiseScript(viewId)));
      } catch (err) {
        return jsonErrorContent(err);
      }
    }
  );

  server.tool(
    "get_background_gradient",
    "Background map: per-channel medians over a grid of boxes + corner spread + least-squares " +
      "plane fit. Use before/after gradient correction, corner spread should drop (R8: ~halved) " +
      "while the center (nebula) median stays put. Box medians are star-robust; boxes on nebula " +
      "read high and show in maxDeviationPct.",
    {
      viewId: z.string().describe("View ID of the image"),
      gridSize: z.number().int().min(2).max(9).default(5).describe("Grid is gridSize x gridSize boxes"),
      boxFraction: z.number().min(0.01).max(0.2).default(0.04)
        .describe("Box side as a fraction of image width/height"),
    },
    async ({ viewId, gridSize, boxFraction }) => {
      try {
        return jsonContent(await execPjsrJson(bridge, gradientScript(viewId, gridSize, boxFraction)));
      } catch (err) {
        return jsonErrorContent(err);
      }
    }
  );

  server.tool(
    "get_background_neutrality",
    "Background color-neutrality metric. mode:'linear' (pre-stretch ONLY) = per-channel medians " +
      "over the ±8% diffuse-sky band; spreadPct <= 1 = neutral. mode:'poststretch' = the honest " +
      "post-stretch metrics (the ±8% band metric LIES after stretching): bgChroma (mean saturation " +
      "of the near-neutral |rex|<0.01 population) + faint/bright signal-channel medians for " +
      "computing a preservation ratio across before/after calls. rex = signalChannel - mean(others); " +
      "signalChannel is the palette's dominant emission (R for HOO-Ha/RGB-dust, adjust for OIII/SHO).",
    {
      viewId: z.string().describe("View ID of the image (must be color)"),
      mode: z.enum(["linear", "poststretch"]).describe("linear = pre-stretch gate; poststretch = after any stretch"),
      signalChannel: z.enum(["R", "G", "B"]).default("R")
        .describe("Dominant signal hue channel (poststretch mode)"),
      targetSamples: z.number().int().min(10000).max(1000000).default(150000)
        .describe("Approximate number of stride-grid samples"),
    },
    async ({ viewId, mode, signalChannel, targetSamples }) => {
      try {
        return jsonContent(await execPjsrJson(bridge, neutralityScript(viewId, mode, signalChannel, targetSamples)));
      } catch (err) {
        return jsonErrorContent(err);
      }
    }
  );

  server.tool(
    "get_star_metrics",
    "Star metrics: approximate star count, median FWHM (px) + eccentricity of the brightest stars " +
      "(background-subtracted moments; saturated peaks excluded), brightest-star coordinates (for " +
      "1:1 crop rendering), and starPixelMedian, the star-layer stretch metric (grid samples of " +
      "max(R,G,B) > 0.005; ~0.4 target after star stretch, only meaningful on a stars-only layer). " +
      "Values are comparison-stable (before/after, run/baseline), not photometric: moment FWHM " +
      "reads ~2.3x SubframeSelector's PSF-fit FWHM (known bias, quantified), never mix the two.",
    {
      viewId: z.string().describe("View ID of the image"),
      maxStars: z.number().int().min(10).max(1000).default(200)
        .describe("How many of the brightest stars to measure for FWHM/eccentricity"),
    },
    async ({ viewId, maxStars }) => {
      try {
        return jsonContent(await execPjsrJson(bridge, starMetricsScript(viewId, maxStars), 600000));
      } catch (err) {
        return jsonErrorContent(err);
      }
    }
  );
}
