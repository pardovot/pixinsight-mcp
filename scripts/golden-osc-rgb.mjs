// Golden-crop regression test for recipes/osc-rgb-linear.js.
// Runs the recipe end-to-end in a live PixInsight (watcher must be running) on the fixture
// master, then compares the end-state report + golden-crop medians against the stored golden.
//
//   node scripts/golden-osc-rgb.mjs              compare against recipes/osc-rgb-linear.golden.json
//   node scripts/golden-osc-rgb.mjs --bootstrap  run and (re)write the golden file
//
// The golden file records the fixture source path (machine-local data, R8 Rho Oph master),
// the crop rect, and the expected metrics. Medians compare at relative tolerance TOL.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { fileURLToPath } from 'url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const goldenPath = path.join(repo, 'recipes', 'osc-rgb-linear.golden.json');
const recipePath = path.join(repo, 'recipes', 'osc-rgb-linear.js').replace(/\\/g, '/');
const bridge = path.join(os.homedir(), '.pixinsight-mcp', 'bridge');
const TOL = 0.02; // 2% relative on medians (re-runs reproduce within AI-tool rounding, R8)
const TIMEOUT_MS = 30 * 60 * 1000;

function sendCommand(tool, parameters, timeoutMs = TIMEOUT_MS) {
  const id = crypto.randomUUID();
  const cmd = { id, timestamp: new Date().toISOString(), tool, process: '__internal__', parameters };
  fs.writeFileSync(path.join(bridge, 'commands', id + '.json'), JSON.stringify(cmd));
  const resultPath = path.join(bridge, 'results', id + '.json');
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const poll = setInterval(() => {
      if (fs.existsSync(resultPath)) {
        let r;
        try { r = JSON.parse(fs.readFileSync(resultPath, 'utf-8')); } catch { return; } // partial write
        if (r.status === 'running') return;
        clearInterval(poll);
        fs.unlinkSync(resultPath);
        if (r.status !== 'success') reject(new Error(`${tool} failed: ${r.error || r.message}`));
        else resolve(r);
      } else if (Date.now() - t0 > timeoutMs) {
        clearInterval(poll);
        reject(new Error(`${tool} timed out after ${timeoutMs / 1000}s`));
      }
    }, 2000);
  });
}

function relDiff(a, b) { return Math.abs(a - b) / Math.max(Math.abs(b), 1e-9); }

const bootstrap = process.argv.includes('--bootstrap');
if (!bootstrap && !fs.existsSync(goldenPath)) {
  console.error(`No golden file at ${goldenPath}. Run with --bootstrap first (needs PixInsight + watcher).`);
  process.exit(1);
}

const golden = fs.existsSync(goldenPath) ? JSON.parse(fs.readFileSync(goldenPath, 'utf-8')) : {
  src: 'D:/AP/FRA500 Reducer/Rho Ophiuchi/masterLight_BIN-1_6248x4176_EXPOSURE-300.00s_FILTER-NoFilter_RGB_RHO-Ophiuchi Complex Panel 1_autocrop.xisf',
  goldenCrop: { x0: 2800, y0: 1700, w: 600, h: 600 },
};

if (!fs.existsSync(golden.src)) {
  console.error(`Fixture master not found: ${golden.src}`);
  process.exit(1);
}

const cfg = { src: golden.src, baseName: 'golden', goldenCrop: golden.goldenCrop };
const code = `(0,eval)(File.readTextFile(${JSON.stringify(recipePath)})); OSC_RGB_LINEAR(${JSON.stringify(cfg)})`;

console.log(`Running recipe on ${path.basename(golden.src)} (this takes minutes: BXT x2, NXT, SXT)...`);
const t0 = Date.now();
let report;
try {
  const r = await sendCommand('run_script', { code });
  report = JSON.parse(r.outputs.returnValue);
} finally {
  // best-effort cleanup so repeated runs don't accumulate views
  for (const v of ['golden_starless', 'golden_stars']) {
    try { await sendCommand('close_image', { viewId: v }, 60000); } catch { /* not open */ }
  }
}
console.log(`Recipe finished in ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(JSON.stringify(report, null, 1));

if (bootstrap) {
  const out = {
    note: 'Golden fixture for osc-rgb-linear (R8 Rho Oph master). Regenerate with --bootstrap.',
    generated: new Date().toISOString(),
    src: golden.src,
    goldenCrop: golden.goldenCrop,
    expect: {
      mgcDeclined: report.mgc.declined,          // dec -24, MARS gap: decline expected
      checksOk: report.checks.ok,
      steps: report.steps.filter(s => s.medianAfter !== undefined)
        .map(s => ({ step: s.step, medianAfter: s.medianAfter })),
      crop: report.goldenCrop,
      gradientRampRel: report.checks.gradient.rampRel,
    },
  };
  fs.writeFileSync(goldenPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`Golden written: ${goldenPath}`);
  process.exit(report.checks.ok ? 0 : 2);
}

const exp = golden.expect;
const fails = [];
if (report.mgc.declined !== exp.mgcDeclined) fails.push(`mgc.declined ${report.mgc.declined} != ${exp.mgcDeclined}`);
if (!report.checks.ok) fails.push(`end-state checks failed: ${JSON.stringify(report.checks)}`);
const gotSteps = new Map(report.steps.filter(s => s.medianAfter !== undefined).map(s => [s.step, s.medianAfter]));
for (const s of exp.steps) {
  const got = gotSteps.get(s.step);
  if (got === undefined) { fails.push(`missing step ${s.step}`); continue; }
  if (relDiff(got, s.medianAfter) > TOL) fails.push(`${s.step} median ${got} vs golden ${s.medianAfter}`);
}
for (const layer of ['starless', 'stars']) {
  for (let c = 0; c < 3; c++) {
    const got = report.goldenCrop[layer][c], want = exp.crop[layer][c];
    // absolute floor: star-layer crop medians sit at the SXT residue scale (~1e-7)
    if (Math.abs(got - want) > Math.max(TOL * Math.abs(want), 1e-6)) fails.push(`crop ${layer}[${c}] ${got} vs golden ${want}`);
  }
}
if (fails.length) {
  console.error(`GOLDEN TEST FAILED:\n - ` + fails.join('\n - '));
  process.exit(1);
}
console.log('GOLDEN TEST PASSED');
