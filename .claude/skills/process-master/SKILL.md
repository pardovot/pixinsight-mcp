---
name: process-master
description: >
  Drive a full PixInsight processing run on a stacked astro master. Use whenever the user
  asks to process / finish / "turn into a finished image" an astrophotography master (nebula,
  galaxy, cluster) through the PixInsight MCP tools — e.g. "process this OSC duoband master",
  "make a finished HOO image from this". This skill routes to the correct acquisition-category
  playbook in docs/workflows/ and drives the measure → configure → verify loop. Invoke it
  BEFORE planning any processing steps.
---

# Process an astro master (autonomous driver)

You are about to process a real master into a finished image. **Do not plan from general
astrophotography knowledge.** The researched, per-acquisition-category playbook is the source
of truth for *what* to do and in *what order*; your job is to apply it to THIS image by
measuring, configuring, and verifying each step.

## Step 0 — prerequisites (once, before touching the image)

1. Confirm the bridge is alive: call `list_open_images` (or ping). If it errors, stop and tell
   the user PixInsight + the MCP Watcher module must be running.
2. Read **`/CLAUDE.md`** (repo root) if not already in context — the generic-`run_process`
   rule, the measure→configure→verify methodology, and the no-op traps live there.

## Step 1 — determine the acquisition category, then LOAD ITS PLAYBOOK

Pick the category from what the **user told you** (and their equipment profile if given).
**Do NOT infer it from the FITS `FILTER` header** — screw-in duoband filters are commonly
logged as `NoFilter`, which would misroute a narrowband image to a broadband playbook and
calibrate color wrongly. If the category is genuinely unstated, **ask** — do not guess.

| The data is… | Read this playbook |
|---|---|
| OSC, duoband / HOO (Ha+OIII) | `docs/workflows/osc-hoo.md` |
| OSC, broadband / RGB | `docs/workflows/osc-rgb.md` |
| mono RGB | `docs/workflows/mono-rgb.md` |
| mono LRGB | `docs/workflows/mono-lrgb.md` |
| mono Ha+LRGB | `docs/workflows/mono-halrgb.md` |
| mono SHO / narrowband palette | `docs/workflows/mono-sho.md` |

**Read the entire matching playbook now, in full, before planning a single step.** It carries
the correct process choices (e.g. gradient via MGC/GradientCorrection, *not* ABE, on
nebula-filling targets), the exact order, and per-step settings with confidence grades. Present
your plan as the playbook's step order, with your intended stop/checkpoint points.

**Decide; do not interview.** The playbook already answers the routine choices — gradient tool,
SPCC narrowband wavelengths, BXT nonstellar strength, NXT strength, HOO mapping. Do NOT ask the
user to pick these; choose per the playbook, **state your assumption in one line**, and proceed.
Only pause at the genuine aesthetic decision points the user named (and honor their checkpoints).
If something is truly unspecified and consequential (e.g. output path), make a sensible default
and mention it — a run should not block on questions the research has already settled.

**Detect existing state; do not blindly redo it.** WBPP masters arrive partly prepared:

- **Plate solve:** usually already present, and the WCS survives stacking. Check first
  (`run_script`: `View.window.astrometricSolution()` returns null if unsolved; or look for WCS
  FITS keywords `CTYPE1`/`CTYPE2`). Only run ImageSolver if the solution is absent — re-solving is
  wasted time. (BlurXTerminator strips the WCS, so copy it back after BXT if a later step needs it.)
- **Autocrop / crop masks:** a `_autocrop` master is already cropped — do not crop it again. WBPP
  also leaves a stray `<image>_crop_mask` view floating; list open images at the start
  (`list_open_images`) and close any `*_crop_mask` view so it can't be picked up as a target by a
  later step.

## Step 2 — execute, one playbook step at a time

For **every** step, in this loop — never skip the measure/verify halves:

1. **Measure first.** Capture the relevant statistic for THIS image (`get_image_statistics`,
   or a `run_script` measurement). This is both your configuration input and your before-baseline.
2. **Introspect.** `get_process_parameters(processId)` — read the actual settable params and
   their current defaults. Reason about what they mean for this image.
3. **Configure from the playbook + the measurement**, never from fixed numbers you recall.
   Use the **generic `run_process(processId, viewId, settings)`** — not a per-process wrapper.
4. **Run**, then **re-measure.**
5. **Verify — this is a gate, not a formality:**
   - **Byte-identical stats before/after = a no-op.** Stop; do not proceed. Diagnose (wrong
     output default? separate output view created instead of in-place edit? mask?), fix, re-run.
   - Watch for clipping (values pinned to 0 or 1), star-count collapse, and background sign flips.

## Known traps (apply proactively — do not wait to be caught by the gate)

- **Background/gradient no-op:** `AutomaticBackgroundExtractor` defaults to `targetCorrection=0`
  + `replaceTarget=false` → it builds a *model* and leaves the image untouched. To actually
  correct: `{ targetCorrection: 1, replaceTarget: true }`. But prefer the **playbook's** gradient
  tool (MGC+MARS or GradientCorrection) over ABE on nebula-filling targets — ABE/DBE sampling
  eats real nebulosity.
- **SPCC narrowband:** G and B must be entered with **identical** wavelength AND bandwidth; use
  physical emission lines (Hα 656.3, OIII 500.7), not filter marketing centers.
- **Starless/SXT is an OPTIONAL branch, never a mandatory step.**
- **Never fabricate numeric settings.** Measure → configure → verify, every step.

## Checkpoints & review

The user's prompt says where to pause. Honor it — the native module is non-blocking, so they can
inspect the live image between steps. At each checkpoint: report the before/after measurements,
what you changed and why (cite the playbook), and what's next. Default to pausing more often early
in a run and less as confidence builds.

## When you finish

Save the result, and **write down the warts**: any step where the playbook was vague, a tool that
behaved unexpectedly, a measurement you had to improvise because no first-class tool existed. That
list is the specification for the next tools to build.
