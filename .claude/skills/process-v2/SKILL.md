---
name: process-v2
description: v2 run driver. Processes an astro image start to finish UNATTENDED, no prompts. Route by category, run the linear recipe one-shot, end-check, 4x-proxy variant search against the reference class, auto-select by measured distance, apply full-res, verify invariants at 1:1, deliver all variants for post-hoc review, write RUNLOG + scoreboard.
---

# process-v2, unattended run driver

**This skill NEVER asks the user anything and never waits.** It runs to a delivered final. The
user reviews afterwards, from the contact sheet and the saved variant op lists. If a genuine
blocker appears (missing input, unroutable category, failed end-check after one retry), stop
and report, that is a failure exit, not a question.

**Startup is ONE batched call**: read `docs/facts.md` + `references/library.json` in a single
parallel tool call, and ping the watcher (`node scripts/ping-watcher.mjs`) in the same batch.
That is the whole orientation. Do NOT read the recipe source, the README, `docs/architecture.md`,
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

## 2. Linear stage, one shot

```
run_script: (0,eval)(File.readTextFile("<repo>/recipes/osc-rgb-linear.js"));
            OSC_RGB_LINEAR({ src: "<master>", baseName: "<target>", out: "<result dir>" })
```

Read the returned JSON report. If `checks.ok` is true, move on, do NOT re-verify per step
(trust BXT/NXT, that is the design). If a check failed, diagnose once from the recorded
per-step medians, re-run, and if it fails again stop and report. Render the starless once so
the run log carries a picture of the linear state; never autostretch the stars layer.

## 3. Variant search on the 4x proxy

Build 4x proxies of starless + stars (`IntegerResample` zoomFactor -4). Iterate ON THE PROXY
ONLY: stretch (linked), tone, colour. Measure candidates with `scripts/profile.js` and compare
against the target's class entries in `references/library.json`. Proxy-valid: tone ladder, band
saturation, structure RoverG/RoverB, grainRelSky. NOT proxy-valid: stars, rings, fine grain,
those are 1:1 only (section 5). Thresholds are PER CLASS, never borrow another class's numbers.

Produce exactly 4 variants, each with a REPLAYABLE ordered op list (you re-apply it at full res
and the user may ask for a different one later, without a re-search):
1. **reference-matched**: closest to the class profile (sky level, skyBandSat, ladder)
2. **darker-punchier**: sky toward the class floor, more contrast
3. **brighter-softer**: sky toward the class ceiling, gentler slopes
4. **alt-palette**: tone of 1, different colour emphasis

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

## 4. Contact sheet + auto-select

Render the 4 proxies into ONE labeled 2x2 contact sheet, save it to the output dir. Then
**select automatically**: the variant with the smallest normalized distance to the class
reference profile across sky level, skyBandSat, the p1..p99 ladder and grainRelSky, among
variants that passed every 3b guard. Record the distances for all four. Ties go to the
gentler path (lower max local slope).

⚠️ Metric selection is the known-weak link (measured: profiles matched a reference within a
few percent on versions the user rejected outright). It is why 3b constrains the path and why
all four op lists are delivered, a re-pick must cost one replay, not a re-run.

## 5. Apply full-res + verify

Re-apply the selected variant's ops to the FULL-RES starless/stars, recombine
(`starless*~stars + stars`). Then verify, and treat these as REPORTED FACTS, not gates to ask
about:
- **1:1 crops**: brightest star, the measured worst-case star (rings, colour fringe), the
  object core, a sky patch. Stars are judged only here, global stats hide barely-there stars.
- **Invariants vs the class entry**: clipping fractions ~0, no exactly-achromatic tiles,
  per-band saturation and grainRelSky inside the class range, structure RoverG/RoverB same
  trend as the linear input.
- A breach that a guard should have caught: regenerate that variant once, more gently, then
  deliver whichever passes. Two failures = deliver the best and flag it loudly in the RUNLOG.

Save the final + starless/stars into `versions/`. **Never overwrite a delivered final**;
`final.*` mirrors the current one.

## 6. Deliver + log

Write `RUNLOG.md` next to the outputs: category, recipe rev, the recipe's JSON report, the 4
variants with their op lists and distances, which was auto-selected and why, guard results,
1:1 and invariant numbers, and the contact-sheet path. Append one line to
`result-tests/SCOREBOARD.md`: `| date | target | class | recipe rev | variant | verdict |`
with verdict `pending-review`.

End the run with a short summary naming the selected variant and how to switch: the user says
"variant 3" and you replay that saved op list at full res, no re-search.

Findings do NOT become rules here. A tool fact goes to `docs/facts.md` only if it passes that
file's gate (objective, reproducible); everything else stays in the RUNLOG.
