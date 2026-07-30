// The ONLY way an entry enters references/library.json. Enforces that file's own `rules` +
// `entryContract` mechanically, so the discipline does not depend on whoever is writing the entry
// remembering it. The v1 library died partly of hand-written entries: two rejects carried a lesson
// and no numbers, so nothing could ever be scored against them.
//
//   node scripts/add-library-entry.mjs <meta.json>          validate + append
//   node scripts/add-library-entry.mjs --check <meta.json>  validate only, write nothing
//   node scripts/add-library-entry.mjs --counts             per-class counts + gate status
//   node scripts/add-library-entry.mjs --class <name>       ONE class's slice, for a run to load
//
// --class exists because a run only ever needs the target's class, and thresholds are PER CLASS
// anyway. Reading the whole file costs the run every other class's entries: at ~1.5 KB per entry
// the file reaches ~30 KB by 20 entries and would dominate a run's context for no benefit. The
// slice drops the entryContract too (that is the writer's and the grader's business, not the
// run's).
//
// meta.json: { name, class, verdict, gradedBy, gradedOn, extent, cropRect?, cropMatch?,
//              provenance: { driver, recipe, runlog, opList }, failure?, lesson?,
//              profile: "<profiler json path>"   // preferred: metrics are DERIVED, not transcribed
//              | metrics: { ... } }              // hand path, same validation
//
// Passing `profile` is the safer route: it maps profiler output to the contract's field names and
// refuses anything but the native-scale (s1) block, so the 1:1 rule holds by construction instead
// of by trusting a `scale` field the writer typed.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(repo, 'references', 'library.json');

const argv = process.argv.slice(2);
const mode = argv[0] === '--check' ? 'check'
  : argv[0] === '--counts' ? 'counts'
  : argv[0] === '--class' ? 'class'
  : 'add';
const metaPath = mode === 'add' ? argv[0] : argv[1];

const lib = JSON.parse(fs.readFileSync(LIB, 'utf-8'));
const CLASSES = lib.entryContract.class.split('|').map(s => s.trim());
const GATE = { accepted: 3, rejected: 1 };

function counts() {
  const rows = CLASSES.map(c => {
    const e = lib.entries.filter(x => x.class === c);
    const a = e.filter(x => x.verdict === 'accepted').length;
    const r = e.filter(x => x.verdict === 'rejected').length;
    return { class: c, accepted: a, rejected: r, gates: a >= GATE.accepted && r >= GATE.rejected };
  });
  const w = Math.max(...CLASSES.map(c => c.length));
  for (const r of rows) {
    const need = [];
    if (r.accepted < GATE.accepted) need.push(`${GATE.accepted - r.accepted} more accepted`);
    if (r.rejected < GATE.rejected) need.push(`${GATE.rejected - r.rejected} more rejected`);
    console.log(
      `  ${r.class.padEnd(w)}  ${String(r.accepted).padStart(2)} accepted  ${String(r.rejected).padStart(2)} rejected  ` +
      (r.gates ? 'GATES' : `calibrating (needs ${need.join(' + ')})`)
    );
  }
  console.log(`\n  total entries: ${lib.entries.length}   profilerRev: ${lib.profilerRev}`);
  console.log(`  gate = >= ${GATE.accepted} accepted AND >= ${GATE.rejected} rejected`);
}

if (mode === 'counts') { counts(); process.exit(0); }

if (mode === 'class') {
  const cls = argv[1];
  if (!CLASSES.includes(cls)) {
    console.error(`--class: must be one of ${CLASSES.join(' | ')}`);
    process.exit(2);
  }
  const entries = lib.entries.filter(e => e.class === cls);
  const accepted = entries.filter(e => e.verdict === 'accepted').length;
  const rejected = entries.filter(e => e.verdict === 'rejected').length;
  const gates = accepted >= GATE.accepted && rejected >= GATE.rejected;
  console.log(JSON.stringify({
    class: cls,
    gates,
    // The driver branches on this: false => SKILL section 3a calibration mode, no class distance,
    // no class range, variants deliberately span the space instead of matching a profile.
    mode: gates ? 'gated' : 'calibration',
    counts: { accepted, rejected, need: gates ? null : { accepted: Math.max(0, GATE.accepted - accepted), rejected: Math.max(0, GATE.rejected - rejected) } },
    gate: `>= ${GATE.accepted} accepted AND >= ${GATE.rejected} rejected`,
    profilerRev: lib.profilerRev,
    profiler: lib.profiler,
    metricDefs: lib.metricDefs,
    rules: lib.rules,
    entries,
  }, null, 1));
  process.exit(0);
}

if (!metaPath) {
  console.error('usage: add-library-entry.mjs [--check] <meta.json> | --counts');
  process.exit(2);
}

// ---------- profiler output -> contract metrics (derive, never transcribe) ----------
function metricsFromProfile(profPath) {
  const raw = JSON.parse(fs.readFileSync(profPath, 'utf-8'));
  // Accept runFiles() array form, a {scales:{...}} object, or a bare profile block.
  let p = Array.isArray(raw) ? raw[0] : raw;
  if (p && p.scales) {
    if (!p.scales.s1) throw new Error(`profile has no native-scale (s1) block; scales present: ${Object.keys(p.scales).join(',')}. A downsampled profile is not a valid entry (grainRelSky reads 1.918x low at 4x, RoverG +36%).`);
    p = p.scales.s1;
  }
  if (!p || !p.pctLum) throw new Error('unrecognised profile shape: no pctLum');
  const bandsSat = (p.bands || []).map(b => (b.meanSat === null || b.meanSat === undefined ? null : b.meanSat));
  const skyIdx = (p.bands || []).reduce((best, b, i, a) => (b.n > a[best].n ? i : best), 0);
  return {
    skyP25: p.skyP25,
    lum: { p1: p.pctLum.p1, p50: p.pctLum.p50, p75: p.pctLum.p75, p95: p.pctLum.p95, p99: p.pctLum.p99 },
    bandsSat,
    skyBandSat: bandsSat[skyIdx],
    structure: { RoverG: p.structure.RoverG, RoverB: p.structure.RoverB },
    grainRelSky: p.grainRelSky,
    textureD8med: p.textureD8med,
    fracSatLt01: p.fracSatLt01,
    tilesMinSat: p.tiles ? p.tiles.minTileSat : undefined,
  };
}

// ---------- validation ----------
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
const errs = [];
const num = (v) => typeof v === 'number' && Number.isFinite(v);

if (!meta.name || typeof meta.name !== 'string') errs.push('name: required string');
else if (lib.entries.some(e => e.name === meta.name)) errs.push(`name: "${meta.name}" already in the library`);
if (!CLASSES.includes(meta.class)) errs.push(`class: must be one of ${CLASSES.join(' | ')}`);
if (!['accepted', 'rejected'].includes(meta.verdict)) errs.push("verdict: must be 'accepted' or 'rejected'");
if (meta.gradedBy !== 'user') errs.push("gradedBy: must be 'user' (a run's own numbers belong in its RUNLOG, not here)");
if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.gradedOn || '')) errs.push('gradedOn: required yyyy-mm-dd');
if (!['full', 'crop'].includes(meta.extent)) errs.push("extent: must be 'full' or 'crop'");
if (meta.extent === 'crop') {
  if (!meta.cropRect) errs.push('cropRect: required when extent is crop');
  if (meta.cropMatch === undefined) errs.push('cropMatch: required when extent is crop (its match quality vs the full frame)');
}
const prov = meta.provenance || {};
for (const k of ['driver', 'recipe', 'runlog', 'opList']) if (!prov[k]) errs.push(`provenance.${k}: required`);
if (prov.runlog) {
  const rl = path.isAbsolute(prov.runlog) ? prov.runlog : path.join(repo, prov.runlog);
  if (!fs.existsSync(rl)) errs.push(`provenance.runlog: no such file (${prov.runlog})`);
}
if (meta.verdict === 'rejected') {
  if (!meta.failure || !String(meta.failure).trim()) errs.push('failure: required on a rejected entry');
  if (!meta.lesson || !String(meta.lesson).trim()) errs.push("lesson: required on a rejected entry (use 'none, global metrics blind to this' if no metric separates it)");
}

let metrics = null;
try {
  metrics = meta.profile ? metricsFromProfile(path.isAbsolute(meta.profile) ? meta.profile : path.join(repo, meta.profile)) : meta.metrics;
} catch (e) { errs.push(`profile: ${e.message}`); }

if (!metrics) errs.push('metrics: required (pass `profile` to derive them, or `metrics` to supply them)');
else {
  // Same complete set for BOTH verdicts: that is the rule a reject broke last time.
  for (const k of ['skyP25', 'skyBandSat', 'grainRelSky', 'textureD8med', 'fracSatLt01', 'tilesMinSat'])
    if (!num(metrics[k])) errs.push(`metrics.${k}: required finite number (got ${JSON.stringify(metrics[k])})`);
  for (const k of ['p1', 'p50', 'p75', 'p95', 'p99'])
    if (!num(metrics.lum?.[k])) errs.push(`metrics.lum.${k}: required finite number`);
  for (const k of ['RoverG', 'RoverB'])
    // null/Infinity here is real: a near-zero channel delta made v1's RoverB unreportable.
    if (!num(metrics.structure?.[k])) errs.push(`metrics.structure.${k}: required finite number (got ${JSON.stringify(metrics.structure?.[k])}); a null means a channel delta underflowed, re-measure rather than record it`);
  if (!Array.isArray(metrics.bandsSat) || metrics.bandsSat.length !== 6)
    errs.push('metrics.bandsSat: required array of 6 (null allowed for an empty band)');
  else metrics.bandsSat.forEach((b, i) => { if (b !== null && !num(b)) errs.push(`metrics.bandsSat[${i}]: number or null`); });
}

if (errs.length) {
  console.error(`REFUSED (${errs.length} problem${errs.length > 1 ? 's' : ''}):\n - ` + errs.join('\n - '));
  process.exit(1);
}

const entry = {
  name: meta.name, class: meta.class, verdict: meta.verdict,
  gradedBy: meta.gradedBy, gradedOn: meta.gradedOn,
  scale: '1:1', extent: meta.extent, profilerRev: lib.profilerRev,
  ...(meta.extent === 'crop' ? { cropRect: meta.cropRect, cropMatch: meta.cropMatch } : {}),
  provenance: { driver: prov.driver, recipe: prov.recipe, runlog: prov.runlog, opList: prov.opList },
  metrics,
  ...(meta.verdict === 'rejected' ? { failure: meta.failure, lesson: meta.lesson } : {}),
};

if (mode === 'check') {
  console.log('VALID (nothing written):');
  console.log(JSON.stringify(entry, null, 1));
  process.exit(0);
}

lib.entries.push(entry);
fs.writeFileSync(LIB, JSON.stringify(lib, null, 2) + '\n');
console.log(`ADDED ${entry.name} (${entry.class}, ${entry.verdict}, extent ${entry.extent}, profilerRev ${entry.profilerRev})\n`);
counts();
