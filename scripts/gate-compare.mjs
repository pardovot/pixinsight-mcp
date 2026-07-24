#!/usr/bin/env node
// kb-gate metric comparison: project a critic-pack metrics.json onto the gate's
// checkpoint schema and compare against the stored baseline with per-metric tolerances.
//
//   node scripts/gate-compare.mjs project <packMetrics.json>
//       → prints the projection (used to author/refresh a baseline checkpoint)
//   node scripts/gate-compare.mjs compare <baseline.json> <checkpoint> <packMetrics.json>
//       → prints {verdict, failures[...]}; exit 0 PASS, 1 FAIL, 2 ADVISORY
//
// Tolerances live in the baseline file (human-tunable) as {rel} | {abs} | {band:[lo,hi]}
// keyed by dotted metric path; DEFAULT_TOLERANCES covers anything unlisted.
//
// Every failure is classified eye-confirmable vs metric-only (a human can/can't verify
// it by opening the critic pack). Verdict:
//   PASS     , no failures
//   FAIL     , at least one EYE-CONFIRMABLE failure (a visible regression → hard block)
//   ADVISORY , only METRIC-ONLY failures (nothing visible to confirm → human glance,
//               don't auto-revert). This is the guard against false-positives on things
//               you can't see (noise, star count, FWHM/ecc).

import { readFileSync } from "node:fs";

const DEFAULT_TOLERANCES = {
  // noiseSigma is metric-only and invisible on an 8-bit downsampled pack, so it runs a
  // LOOSER tolerance, only gross drift (like a 2x noise injection) should trip it; benign
  // ~5-10% jitter from a version bump must not raise a failure a human can't confirm.
  "noiseSigma": { rel: 0.15 },
  "neutrality.luminanceMedian": { rel: 0.02 },
  "neutrality.spreadPct": { abs: 0.25 },
  "neutrality.perChannelMedian.R": { rel: 0.02 },
  "neutrality.perChannelMedian.G": { rel: 0.02 },
  "neutrality.perChannelMedian.B": { rel: 0.02 },
  "neutrality.nearNeutral.perChannelMedian.R": { rel: 0.02 },
  "neutrality.nearNeutral.perChannelMedian.G": { rel: 0.02 },
  "neutrality.nearNeutral.perChannelMedian.B": { rel: 0.02 },
  "neutrality.nearNeutral.bgChroma": { abs: 0.005 },
  "neutrality.faint.signalMedian": { rel: 0.02 },
  "neutrality.bright.signalMedian": { rel: 0.02 },
  "gradientCornerSpreadPct": { abs: 5 },
  "gradientCenterMedian": { rel: 0.02 },
  "starCount": { rel: 0.1 },
  "medianFWHM": { abs: 0.3 },
  "medianEccentricity": { abs: 0.05 },
  "starPixelMedian": { rel: 0.05 },
};

// Metrics a human CANNOT confirm by looking at the critic pack (8-bit, downsampled):
// noise (invisible grain), raw star count, and sub-pixel FWHM/eccentricity. A failure on
// ONLY these → ADVISORY, not a hard block. Everything else (gradient ramp, brightness/
// stretch level, color cast, star brightness, faint survival) IS visible in the pack.
const METRIC_ONLY = new Set([
  "noiseSigma", "starCount", "medianFWHM", "medianEccentricity",
]);

function isEyeConfirmable(path) {
  const noIdx = path.filter((s) => !/^\d+$/.test(s)).join(".");
  const head = path[0];
  return !(METRIC_ONLY.has(noIdx) || METRIC_ONLY.has(head));
}

/** The gate's checkpoint schema, one projection used by both baseline authoring and compare. */
function project(m) {
  const p = {
    noiseSigma: m.noise?.channels?.map((c) => c.sigma),
    gradientCornerSpreadPct: m.gradient?.channels?.map((c) => c.cornerSpreadPctOfCenter),
    gradientCenterMedian: m.gradient?.channels?.map((c) => c.centerMedian),
    starCount: m.stars?.starCount,
    medianFWHM: m.stars?.medianFWHM,
    medianEccentricity: m.stars?.medianEccentricity,
    starPixelMedian: m.stars?.starPixelMedian,
  };
  const n = m.neutrality;
  if (n && !n.error) {
    p.neutrality =
      n.mode === "linear"
        ? { mode: n.mode, luminanceMedian: n.luminanceMedian, perChannelMedian: n.perChannelMedian, spreadPct: n.spreadPct }
        : {
            mode: n.mode,
            nearNeutral: { perChannelMedian: n.nearNeutral.perChannelMedian, bgChroma: n.nearNeutral.bgChroma },
            faint: { signalMedian: n.faint.signalMedian },
            bright: { signalMedian: n.bright.signalMedian },
          };
  }
  return p;
}

function* leaves(obj, path = []) {
  if (obj === null || obj === undefined) return;
  if (typeof obj === "number") { yield [path, obj]; return; }
  if (Array.isArray(obj)) { for (let i = 0; i < obj.length; ++i) yield* leaves(obj[i], [...path, String(i)]); return; }
  if (typeof obj === "object") { for (const k of Object.keys(obj)) if (k !== "mode") yield* leaves(obj[k], [...path, k]); }
}

function toleranceFor(path, tolerances) {
  // exact dotted path, then the path with trailing array indices stripped
  const full = path.join(".");
  const noIdx = path.filter((s) => !/^\d+$/.test(s)).join(".");
  return tolerances[full] ?? tolerances[noIdx] ?? DEFAULT_TOLERANCES[full] ?? DEFAULT_TOLERANCES[noIdx] ?? null;
}

function compare(baseCp, candMetrics) {
  const cand = project(candMetrics);
  const tolerances = { ...DEFAULT_TOLERANCES, ...(baseCp.tolerances ?? {}) };
  const candLeaves = new Map([...leaves(cand)].map(([p, v]) => [p.join("."), v]));
  const failures = [];
  const checked = [];
  for (const [path, base] of leaves(baseCp.metrics)) {
    const key = path.join(".");
    const tol = toleranceFor(path, tolerances);
    if (!tol) continue;
    const c = candLeaves.get(key);
    if (c === undefined) { failures.push({ metric: key, base, cand: null, tol, reason: "missing in candidate" }); continue; }
    let ok, detail;
    if (tol.band) { ok = c >= tol.band[0] && c <= tol.band[1]; detail = `band [${tol.band}]`; }
    else if (tol.abs !== undefined) { ok = Math.abs(c - base) <= tol.abs; detail = `|d|=${Math.abs(c - base).toPrecision(3)} abs<=${tol.abs}`; }
    else { const d = Math.abs(c - base) / Math.max(Math.abs(base), 1e-12); ok = d <= tol.rel; detail = `rel=${d.toPrecision(3)} <=${tol.rel}`; }
    checked.push(key);
    if (!ok) failures.push({ metric: key, base, cand: c, tol, detail, confirmable: isEyeConfirmable(path) });
  }
  const eyeConfirmable = failures.filter((f) => f.confirmable);
  const metricOnly = failures.filter((f) => !f.confirmable);
  const verdict = eyeConfirmable.length ? "FAIL" : metricOnly.length ? "ADVISORY" : "PASS";
  return {
    verdict, pass: verdict === "PASS", checked: checked.length,
    eyeConfirmableFailures: eyeConfirmable.map((f) => f.metric),
    metricOnlyFailures: metricOnly.map((f) => f.metric),
    failures,
  };
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "project") {
  const m = JSON.parse(readFileSync(args[0], "utf8"));
  console.log(JSON.stringify(project(m), null, 2));
} else if (mode === "compare") {
  const baseline = JSON.parse(readFileSync(args[0], "utf8"));
  const cp = baseline.checkpoints?.[args[1]];
  if (!cp) { console.error(`No checkpoint '${args[1]}' in baseline`); process.exit(2); }
  const result = compare(cp, JSON.parse(readFileSync(args[2], "utf8")));
  console.log(JSON.stringify({ checkpoint: args[1], ...result }, null, 2));
  // 0 PASS · 1 FAIL (visible regression, hard block) · 2 ADVISORY (metric-only, human glance)
  process.exit(result.verdict === "PASS" ? 0 : result.verdict === "FAIL" ? 1 : 2);
} else {
  console.error("Usage: gate-compare.mjs project <packMetrics.json> | compare <baseline.json> <checkpoint> <packMetrics.json>");
  process.exit(2);
}
