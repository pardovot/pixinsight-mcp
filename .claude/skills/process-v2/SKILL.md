---
name: process-v2
description: v2 run driver for processing an astro image end to end. Route by category, run the linear recipe one-shot, end-check, 4x-proxy aesthetic search against the reference class, 4-variant contact sheet, STOP for the user's pick, apply full-res, verify invariants, log.
---

# process-v2, thin run driver

**Startup is ONE batched call**: read `docs/facts.md` + `references/library.json` in a single
parallel tool call, and ping the watcher (`node scripts/ping-watcher.mjs`) in the same batch.
That is the whole orientation. Do NOT read the recipe source, the README, `docs/architecture.md`,
git history, or old journals; the recipe is an opaque executable and its JSON report is the
contract. Recipes: `recipes/`. Profiler: `scripts/profile.js`.

Principles (why this driver is thin): the linear half is near-deterministic, run it in ONE
shot and check only the end state; the aesthetic half is per-object taste, search it against
measured references, never against remembered rules; the user picks, metrics only veto.

## 1. Route

Ask the user (or take from their prompt) the CATEGORY, never infer from FITS headers (FILTER
lies). Current routes:

| category | linear recipe | reference class in library.json |
|---|---|---|
| osc-rgb galaxy | `recipes/osc-rgb-linear.js` | `galaxy` |
| osc-rgb emission (filling) | `recipes/osc-rgb-linear.js` | `emission-nebula-filling` |
| osc-rgb dark nebula | `recipes/osc-rgb-linear.js` | `dark-nebula` |
| osc-hoo / sho / mono | no v2 recipe yet, tell the user, stop |

Input must be a linear, plate-solved master (the recipe hard-errors otherwise).

## 2. Linear stage, one shot

```
run_script: (0,eval)(File.readTextFile("<repo>/recipes/osc-rgb-linear.js"));
            OSC_RGB_LINEAR({ src: "<master>", baseName: "<target>", out: "<result dir>" })
```

Read the returned JSON report. If `checks.ok` is true, move on, do NOT re-verify per step
(trust BXT/NXT, that is the design). If a check failed, only then diagnose per step using the
recorded per-step medians, fix, re-run the recipe from scratch (it is idempotent from the
source file). Render the starless once (`render_view`, autostretch) so the user can see the
linear result; never autostretch the stars layer.

## 3. Aesthetic search on the 4x proxy

Build 4x proxies of starless + stars (`IntegerResample` zoomFactor -4, average). Iterate the
nonlinear look ON THE PROXY ONLY: stretch (linked), tone, color. Measure each candidate with
`scripts/profile.js` (eval, then `runFiles` or `__pfProfileView` on the proxy view) and
compare against the target's class entries in `references/library.json`. Proxy-valid metrics:
tone ladder, band saturation, structure RoverG/RoverB, grainRelSky. NOT proxy-valid: stars,
rings, fine grain, judge those at 1:1 only, later. Thresholds are PER CLASS, never borrow
another class's numbers.

Produce exactly 4 variants:
1. **reference-matched**: closest to the class profile (sky level, skyBandSat, ladder)
2. **darker-punchier**: sky toward the class floor, more contrast
3. **brighter-softer**: sky toward the class ceiling, gentler slopes
4. **alt-palette**: same tone as 1, different color emphasis (saturation/hue balance)

Keep each variant's op list replayable (ordered process settings), you will re-apply it.

## 4. Contact sheet, then STOP

Render the 4 proxies into ONE 2x2 contact sheet image (label the quadrants), save it, show
the user. **STOP HERE and wait for their pick.** No full-res work before the pick.

## 5. Apply + verify

Re-apply the picked variant's ops to the FULL-RES starless/stars, recombine
(`starless*~stars + stars` screen). Then verify:
- **1:1 crops**: brightest star + measured worst-case star (rings, color fringe), object core,
  a sky patch. Judge stars only here, global stats hide barely-there stars.
- **Invariants vs the class entry**: clipping fractions ~0, no exactly-achromatic tiles,
  per-band saturation and grainRelSky inside the class range, structure RoverG/RoverB same
  trend as the linear input. Any breach: show the user, do not silently fix.

Save final + starless/stars per the project's versioning rule: never overwrite a delivered
final, keep `versions/`.

## 6. Log

Write `RUNLOG.md` next to the outputs: category, recipe rev, report JSON, variant picked,
op list, invariant numbers, user verdict. Append one line to `result-tests/SCOREBOARD.md`:
`| date | target | class | recipe rev | variant | verdict |`.
Findings do NOT become rules here. A tool fact goes to `docs/facts.md` only if it passes the
gate (objective, reproducible); everything else stays in the RUNLOG.
