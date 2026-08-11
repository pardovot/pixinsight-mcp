// Smoke test for recipes/osc-rgb-linear.js: runs the recipe end-to-end in a live PixInsight
// (watcher must be running) on the fixture master and asserts the BEHAVIOR, not the pixels:
// every step ran, the MGC decline branch was handled, the end-state checks pass. Tool updates
// that change pixel output do not fail this test, a broken chain does.
//
//   node scripts/smoke-osc-rgb-linear.mjs       (or: npm run test:recipe)
//   FIXTURE=<path to a linear plate-solved OSC master> overrides the default fixture.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { fileURLToPath } from 'url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recipePath = path.join(repo, 'recipes', 'osc-rgb-linear.js').replace(/\\/g, '/');
const bridge = path.join(os.homedir(), '.pixinsight-mcp', 'bridge');
const TIMEOUT_MS = 30 * 60 * 1000;

// R8 Rho Oph master (machine-local data): exercises the MGC-decline -> GC-fallback branch.
const fixture = process.env.FIXTURE
  || 'D:/AP/FRA500 Reducer/Rho Ophiuchi/masterLight_BIN-1_6248x4176_EXPOSURE-300.00s_FILTER-NoFilter_RGB_RHO-Ophiuchi Complex Panel 1_autocrop.xisf';

function sendCommand(tool, parameters, timeoutMs = TIMEOUT_MS) {
  const id = crypto.randomUUID();
  fs.writeFileSync(path.join(bridge, 'commands', id + '.json'),
    JSON.stringify({ id, timestamp: new Date().toISOString(), tool, process: '__internal__', parameters }));
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

// SKIP rather than fail without the fixture, so pointing this at a machine that
// does not have the master says so instead of erroring deep in the run. (The
// file is named smoke-*, not test-*, precisely so `node --test` does NOT
// discover it: with the fixture present and no watcher running it would block
// the whole suite for TIMEOUT_MS.)
if (!fs.existsSync(fixture)) {
  console.log(`SKIP: fixture master not found: ${fixture}`);
  console.log('      This smoke test needs a linear OSC master and a running PixInsight watcher.');
  console.log('      Point it at one with FIXTURE=<path> to actually run it.');
  process.exit(0);
}

const cfg = { src: fixture, baseName: 'smoke' };
const code = `(0,eval)(File.readTextFile(${JSON.stringify(recipePath)})); OSC_RGB_LINEAR(${JSON.stringify(cfg)})`;

console.log(`Running recipe on ${path.basename(fixture)} (minutes: BXT x2, NXT, SXT)...`);
const t0 = Date.now();
let report;
try {
  const r = await sendCommand('run_script', { code });
  report = JSON.parse(r.outputs.returnValue);
} finally {
  for (const v of ['smoke_starless', 'smoke_stars']) {
    try { await sendCommand('close_image', { viewId: v }, 60000); } catch { /* not open */ }
  }
}
console.log(`Recipe finished in ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(JSON.stringify(report, null, 1));

const stepNames = report.steps.map(s => s.step);
const fails = [];
for (const must of ['open', 'bxt_correct_only', 'spcc', 'bxt_sharpen', 'nxt', 'sxt_split']) {
  if (!stepNames.includes(must)) fails.push(`step missing: ${must}`);
}
// gradient handling: exactly one of the three branches must have run
const gradSteps = stepNames.filter(s => s === 'mgc' || s.startsWith('gradient_correction'));
if (gradSteps.length !== 1) fails.push(`expected exactly one gradient step, got: ${gradSteps.join(', ') || 'none'}`);
if (report.mgc.attempted && report.mgc.declined && !stepNames.includes('gradient_correction_fallback')) {
  fails.push('MGC declined but no GC fallback step ran');
}
if (!report.checks.ok) fails.push(`end-state checks failed: ${JSON.stringify(report.checks)}`);

if (fails.length) {
  console.error('SMOKE TEST FAILED:\n - ' + fails.join('\n - '));
  process.exit(1);
}
console.log('SMOKE TEST PASSED');
