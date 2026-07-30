---
name: process-v2
description: v2 run driver. Processes an astro image start to finish UNATTENDED, no prompts. Route by category, run the linear recipe one-shot, end-check, search 4 variants at native scale on a matched crop against the reference class, verify at 1:1 without a full-res apply, deliver all four unpicked for the user to choose, write RUNLOG + scoreboard with timings.
---

# process-v2, unattended run driver

**This skill NEVER asks the user anything and never waits.** It runs to four delivered variants
and stops there. The user reviews afterwards, from the contact sheet and the saved op lists, and
picks; that pick costs one replay, not a re-run. If a genuine blocker appears (missing input,
unroutable category, failed end-check after one retry), stop and report, that is a failure exit,
not a question.

⚠️ **Unattended is about not blocking, not about deciding taste.** The driver does not pick a
variant (section 4) and does not apply one at full res (section 5). Both were removed after they
were measured to cost a full re-run and to select versions the user rejected.

**Startup is ONE batched call**: read `docs/facts.md`, load the target's class slice
(`npm run library -- --class <class>`), and ping the watcher (`node scripts/ping-watcher.mjs`), all
in a single parallel tool call. That is the whole orientation.

⛔ **Do NOT read `references/library.json` whole.** A run needs only the target's class, thresholds
are PER CLASS anyway, and the file grows ~1.5 KB per entry. The slice also returns
`mode: gated | calibration`, which is what section 3a branches on, so there is nothing to count by
hand. Do NOT read the recipe source, the README, `docs/architecture.md`,
git history, or old journals; the recipe is an opaque executable and its JSON report is the
contract. Recipes: `recipes/`. Profiler: `scripts/profile.js`.

Principles: the linear half is near-deterministic, run it in ONE shot and check the end state
only; the aesthetic half is per-object, search it against measured references, never against
remembered rules. Unattended means the guards that a human eye used to provide must be in the
procedure, section 3b is not optional.

## 1. Route

Take the CATEGORY from the user's prompt. Never infer it from FITS headers (FILTER lies). If
the prompt does not state one, infer from the target name only if unambiguous (M31 = galaxy),
else stop and report.

| category | linear recipe | reference class in library.json |
|---|---|---|
| osc-rgb galaxy | `recipes/osc-rgb-linear.js` | `galaxy` |
| osc-rgb emission (filling) | `recipes/osc-rgb-linear.js` | `emission-nebula-filling` |
| osc-rgb dark nebula | `recipes/osc-rgb-linear.js` | `dark-nebula` |
| osc-hoo / sho / mono | no v2 recipe yet, stop and report |

Input must be a linear, plate-solved master (the recipe hard-errors otherwise).

**Data root is `data/`** (renamed from `result-tests/` 2026-07-30), laid out
`data/<Telescope>/<Object>/<CameraType>/<CaptureType>/`, e.g. `data/C8/M106/OSC/RGB/`. The master
sits in that leaf; this run writes `runs/<yyyy-mm-dd>/` beside it and never overwrites an earlier
run. Full spec incl. the CaptureType vocabulary and master-hygiene checks: `docs/data-layout.md`.

⚠️ **CaptureType is not the reference class.** The path says how it was captured (`OSC/RGB`); the
class says what the object is (`galaxy`), and only the class indexes `library.json`. Take the class
from the prompt, never from the path and never from `FILTER`.

**`data/_pre-v2/` is INPUT-ONLY.** Pre-v2 runs were archived there 2026-07-30. Reading a stacked
linear master out of it is fine, that data is pipeline-independent. Reading its finals,
`metrics.json`, `HISTORY.md`, `RUNLOG.md` or `versions/` is not: those numbers describe a pipeline
that no longer exists, and reusing them is exactly what the library reset was for.

## 2. Linear stage, one shot

```
run_script: (0,eval)(File.readTextFile("<repo>/recipes/osc-rgb-linear.js"));
            OSC_RGB_LINEAR({ src: "<master>", baseName: "<target>", out: "<result dir>" })
```

Read the returned JSON report. If `checks.ok` is true, move on, do NOT re-verify per step
(trust BXT/NXT, that is the design). If a check failed, diagnose once from the recorded
per-step medians, re-run, and if it fails again stop and report. Render the starless once so
the run log carries a picture of the linear state; never autostretch the stars layer.

The report carries `timing` (per-step `ms`, `totalMs`, `stepsMs`, `overheadMs`, `slowest`).
Carry it into the RUNLOG verbatim. This stage is a single tool call with no agent checkpoints in
it, so its wall clock is PixInsight compute; `slowest` is the only place to look when a run feels
long.

## 3. Variant search on a matched full-res crop

⛔ **Never downsample to search.** Measured 4x vs 1:1: `grainRelSky` **1.918x**, `structure.RoverG`
**+36%**, `RoverB` **+55%**. Grain AND colour trend are scale dependent, and anything multiscale
(HDR layer counts) does not transfer across scales at all. The 4x proxy was removed 2026-07-29
after costing a full re-tune every time it was used. Work at native scale on less area instead.

**Cut a matched crop, framed on the object.** One call, do not hand-roll a search:

```
run_script: (0,eval)(File.readTextFile("<repo>/scripts/crop-select.js"));
            JSON.stringify(CROP_SELECT("<target>_starless"))
```

Measures the object's extent from the marginal flux profile above sky, sizes the crop from that
extent, centres on it, then scores a bounded jitter against the FULL frame on sky p25, lum p50,
`grainRelSky`, RoverG/RoverB. Returns `{extent, size, rect, match, gate}`. Crop the stars layer at
the identical rect. Record `rect`, `match` and `gate` in the RUNLOG.

⛔ **Framing is primary, the gate is only a filter.** The gate terms say nothing about where the
object sits, so a crop can score **1.7%** and still be **92% empty sky with the object as a corner
sliver**. Never let the gate pick the position, and never pick it by eye off a downsampled render.
`CROP_SELECT` holds `offCentre` at ~0 by construction.

**`margin` is what buys the gate.** The gate terms are sky statistics, so a crop framed tighter on
the object scores WORSE. Measured, margin -> gate worst: `0.25 -> 9.5%`, `0.40 -> 7.1%`,
`0.55 -> 5.3%`, **`0.70 -> 3.9%, all five pass`**. Default 0.70. Size derives from the measured
object, so it adapts: a frame-filling galaxy gets a large crop, a small object a small one. When
the object fills the frame the area saving is only ~1.7x; the crop is still correct, because its
job is keeping the run free of a full-res apply, not raw speed.

**If the gate still breaches, do NOT widen forever.** Raise `margin` once (0.85). If a term still
breaches, take the best-centred candidate, record the breached terms and their deviations in the
RUNLOG **and** in every resulting library entry's `cropMatch`, and proceed. A recorded breach is a
caveat the reader can discount; a search that will not terminate is a stalled run.

Evidence for all of the above, incl. the arithmetic on why a small crop cannot match both the sky
percentiles and the highlight ladder: `data/C8/M106/OSC/RGB/runs/2026-07-30/RUNLOG.md` §2, §8.

The crop is at native resolution, so **every metric is valid on it**, grain and texture included,
and multiscale parameters transfer to full res unchanged. Iterate here: stretch (linked), tone,
colour. Measure with `scripts/profile.js`, compare against the class slice loaded at startup.
Thresholds are PER CLASS, never borrow another class's numbers.

What the crop still cannot see: stars outside it, and whole-frame gradient. Both are covered in
section 5, neither needs a full-res apply of a variant.

Produce exactly 4 variants, each with a REPLAYABLE ordered op list (the user picks one afterwards
and you re-apply it at full res, without a re-search):
1. **reference-matched**: closest to the class profile (sky level, skyBandSat, ladder)
2. **darker-punchier**: sky toward the class floor, more contrast
3. **brighter-softer**: sky toward the class ceiling, gentler slopes
4. **alt-palette**: tone of 1, different colour emphasis

## 3a. Calibration mode, when the class has no usable reference

`references/library.json` was **reset to empty 2026-07-30** (v1 entries discarded: a reference
profile only means something for the pipeline that has to hit it). So expect few or zero entries.
That is the normal state, not a failure, and not a reason to stop.

The class slice returns `mode`: `gated` or `calibration`, plus `counts`. **Branch on that, never
count by hand.** (`gated` = >= 3 accepted AND >= 1 rejected.)

- **Class gates**: run section 3 as written, score against the class profile.
- **Class does not gate (calibration mode)**: compute **no** class distance and quote **no** class
  range. Spread the four deliberately so they become four data points rather than four guesses, and
  spread them on **the axis carrying the LEAST user-graded information.** Report every metric in
  **absolute** terms and state which class entries exist (possibly none). Widen a spread rather
  than narrowing it; the spread is what makes the user's pick informative.

  ⛔ **Do NOT re-span an axis the entries already bracket.** An axis is bracketed once it has an
  accepted value with a reject on each side; re-spanning it repeats the previous run and learns
  nothing. Pick the axis like this:
  - **No entries at all** -> sky level. v1 mid, v2/v3 at the low/high ends of the plausible range.
  - **Sky level already bracketed** -> hold all four at the accepted `skyP25` and spread on the
    next unresolved axis. **Take the candidates from the rejects' `lesson` fields**: a lesson
    reading "global metrics blind to this" names something the contract cannot see, which is
    exactly what four visual variants can resolve and what no distance function ever will.
  - **v4 always carries colour**: if the class has an accepted entry, re-use ITS colour treatment
    at v1's tone (its `provenance.opList` has the ops). Re-testing a liked palette on a new object
    is how you learn whether it transfers. Invent a new palette only when nothing is accepted yet.
- **Never substitute remembered numbers for the missing reference.** Recalling "sky p25 ~0.14 for
  HOO" from an old run reintroduces v1 data through the back door and defeats the reset. If it is
  not in `library.json` at the current `profilerRev`, it is not a reference.

The **3b guards still apply in full at n=0.** They constrain the path, not the destination, and
they derive from measured tool physics in `docs/facts.md`, not from the library. Calibration mode
loses the yardstick, not the safety net.

## 3b. Hard guards on every variant, unattended-critical

These encode the measured failure classes that global metrics do NOT catch. They are
constraints on the PATH, checked before each op, not judgments after it.

- **Curve compression gate.** A curve lifting `m -> m'` that passes through (1,1) has average
  slope above the pivot of `(1-m')/(1-m)`, below 1 by construction, and that deficit lands on
  star peaks and faint detail. **Compute it before every tone curve; if < 0.85, split the
  step.** Take the lift from `HDRMultiscaleTransform` instead (it separates by scale, so it
  buys the same headroom detail-positively) and alternate curve -> HDR -> curve.
- **Curve shape.** 4-point S-curves, deltas ~10%. Never 8+ control points, never a local slope
  above ~1.2. Aggressive paths are what amplify sky grain and harden BXT undershoot rings, and
  they do it while the destination metrics still look correct.
  ⛔ Measure the slope on a 1024-step ramp, never from the chord: **Akima overshoots its chord
  by ~5%**, so design to a chord <= 1.15 to land under 1.2. Designing to 1.20 measures 1.21-1.28
  and trips the guard, which costs a regeneration cycle every time.
- **Grain gate.** Relative grain multiplier = local slope / (output level / input level). To
  darken the background without amplifying grain, the local slope there must be about its level
  ratio. Check it for any op that moves the sky.
- **Masks.** Never hand-roll a `clip((mean(RGB)-k)/w)` mask, a hand-picked k lands inside the
  noisy sky and the mask becomes a noise map. Use the EZ construction (CIE L ->
  `RangeSelection` fuzziness 0.1, smoothness 5, highRange = lightness median, applied
  inverted); the smoothing is load-bearing. Set any signal-mask threshold from the sky's p99,
  never its median.
- **Reject on breach**, do not repair. A variant that cannot meet a guard is dropped and
  regenerated more gently. Detail a curve has flattened cannot be restored by later HDR.

## 4. Contact sheet, NO auto-select

Render the 4 crop results into ONE labeled 2x2 contact sheet, save it to the output dir.

⛔ **The driver does not pick.** Auto-selection was removed 2026-07-29. It was measured
unreliable: profiles matched a class reference within a few percent on versions the user
rejected outright (`M31_v8`: "global profile nearly identical to accepted"), and on the Sadr run
the selection had to be redone anyway once its inputs proved invalid. A distance function that
cannot see the failure modes is not a selector.

**If the class gates**, still **compute and report** the normalized distance of all four to the
class profile (sky level, skyBandSat, the p1..p99 ladder, grainRelSky), as information in the
RUNLOG. **In calibration mode there is no distance to compute**; report the four absolute profiles
side by side and state that the class has no reference yet. It is a description
of where each variant sits, not a verdict. Note which variants passed every 3b guard; a variant
that breached a guard was already regenerated or dropped in section 3b, so all four delivered
variants pass by construction.

Unattended means no prompts and no waiting. It does not mean the tool decides taste. The run
completes on its own and ends holding four options.

## 5. Verify, without a full-res apply

Everything below is measured at native resolution and reported as FACT, not as a gate to ask
about. **No variant is applied at full res during the run.**

- **Per-variant, on the crop** (which is 1:1): clipping fractions ~0, no exactly-achromatic
  tiles, structure RoverG/RoverB the same trend as the linear input. Per-band saturation,
  `grainRelSky` and texture are checked against the class range **when the class gates**; in
  calibration mode report them as absolute numbers and check only the class-free invariants
  (no clipping, no achromatic tiles, colour trend preserved, every 3b guard met).
- **Stars, on the FULL-RES stars layer.** Apply the shared star stretch to the full-res stars
  layer once (it is one pointwise op and it is shared across variants) and scan it there, so
  stars outside the crop are still measured. Then pull 1:1 visual crops from full res at the
  located coordinates: brightest star, measured worst-case ring star, object core, sky patch.
  Stars are judged only here; global stats hide barely-there stars.
- **Whole-frame gradient**: already measured by the recipe on the linear starless
  (`checks.gradient`). The tone ops are pointwise, so a flat linear frame stays flat.
- A breach that a 3b guard should have caught: regenerate that variant once, more gently. Two
  failures = deliver it anyway and flag it loudly in the RUNLOG.

**The full-res apply happens on the user's pick, not during the run.** They say "variant 3",
`replay-variant.js` re-applies that op list at full res and writes
`versions/<id>_{final,starless,stars}.xisf`. **Never overwrite a delivered final**; `final.*`
mirrors the current one and is only re-pointed when a final is accepted.

## 6. Deliver + log

Write `RUNLOG.md` next to the outputs: category, recipe rev, the recipe's JSON report **including
its `timing` block**, the crop rect and its match quality, the 4 variants with their op lists and
distances, guard results, verification numbers, and the contact-sheet path. Record the
`profilerRev` every number was measured at. Append one line to `data/SCOREBOARD.md`:
`| date | target | class | recipe rev | variant | verdict | in library |` with variant `unpicked`,
verdict `pending-review`, and in-library `no`.

**Report the timing.** Lead the summary with `timing.totalMs`, the three slowest steps, and
`overheadMs`. Slow runs get diagnosed from numbers, never from impressions: if `stepsMs`
dominates, that is PixInsight compute and no driver change will help; if `overheadMs` dominates,
the recipe is spending it on medians, checks and saves and that is fixable here.

End the run with a short summary: the four variants, what distinguishes them in one line each,
the contact-sheet path, and how to apply one. The user says "variant 3" and you replay that saved
op list at full res, no re-search.

Findings do NOT become rules here. A tool fact goes to `docs/facts.md` only if it passes that
file's gate (objective, reproducible); everything else stays in the RUNLOG.

⛔ **The run does NOT write to `references/library.json`.** A run measures; only a user verdict
creates a reference. The sequence is: run delivers four variants -> user grades one or more ->
*then* the graded variants are added with **`npm run library -- <meta.json>`**
(`scripts/add-library-entry.mjs`, the only writer; `-- --counts` reports per-class gate status and
`-- --check` validates without writing). Pass `profile` pointing at the profiler JSON so metrics are
derived, never transcribed; it refuses anything but the native-scale `s1` block. It enforces
`library.json`'s own `rules` and `entryContract`
(user-graded, 1:1, full metric set, provenance, and a reject carries the same complete ladder as an
accepted entry plus its failure and lesson). A run appending its own numbers would rebuild the
self-graded library the reset just removed. Flip the scoreboard's `in library` column when it lands.

**Always leave grading to one command per variant.** Write a `meta_v<n>.json` stub beside the run
and print the four `npm run library -- <stub>` lines in the summary. Prefill everything the run
already knows: `name` (`<target>_v<n>_<yyyy-mm-dd>`), `class`, `gradedBy: "user"`, `gradedOn`,
`extent`, `cropRect`, `cropMatch` (incl. any breached gate terms), `provenance`
{`driver`, `recipe`, `runlog`, `opList`}, and `profile` pointing at that variant's profiler JSON.
Leave **only** `verdict` unset, as a placeholder that fails validation loudly (never a plausible
default: a stub that validates unedited is a stub that silently accepts). Include empty
`failure`/`lesson` keys, required on a reject and dropped on an accept. Also save each variant's
profiler `s1` block as `profile_v<n>.json` so the metrics are derived, never transcribed.
