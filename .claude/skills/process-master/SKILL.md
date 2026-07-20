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

- **Plate solve:** usually already present, and the WCS survives stacking. Check with
  `run_script`: **`View.window.hasAstrometricSolution`** (a boolean property — NOT
  `astrometricSolution()`, which is not a function and will throw). The solution is stored as an
  XISF property, so `CTYPE*` FITS keywords are often absent even on a solved image — don't rely on
  them. Only run ImageSolver if `hasAstrometricSolution` is false. **BXT does NOT necessarily strip
  the WCS** — in Run 1 a BXT correct-only pass preserved it. Do not assume; re-check
  `hasAstrometricSolution` after BXT and only re-solve if it actually went false.
- **Autocrop / crop masks:** a `_autocrop` master is already cropped — do not crop it again. WBPP
  also leaves a stray `<image>_crop_mask` view floating; list open images at the start
  (`list_open_images`) and close any `*_crop_mask` view so it can't be picked up as a target by a
  later step.

**MARS database: assume it is configured.** Do not try to detect the MARS DB by probing paths or
Settings — the PJSR constants for that (`DataType_String`, etc.) aren't loaded in the watcher's
bare context and the probes give false negatives (Run 1 wrongly concluded "not installed"). Just
run MGC with `useMARSDatabase=true`. **MGC headless will silently no-op with an empty
`marsDatabaseFiles` — the GUI config does not transfer to the process parameter.** Pass it
explicitly as a table row: `marsDatabaseFiles: [[true, "<abs path to the .xmars file>"]]` (the
DB lives under `%APPDATA%/Roaming/Pleiades/XMARS/` on Windows). If MGC no-ops (the gate catches it)
or errors, report that clearly and fall back to GradientCorrection — do not silently continue.

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

### Operational gotchas (proven in real runs — see docs/PROCESSING_JOURNAL.md)

- **Long processes NO LONGER phantom-"fail"** (fixed 2026-07-21, verified on live SPCC). The old
  "SPFC/SPCC/MGC time out at 300 s even on success" was **result corruption**, not a slow process: the
  module read each result from `EvaluateScript`'s completion value, and these processes trigger nested
  JS eval internally (Gaia photometry) that clobbers it → raw junk (`true\n<Gaia temp path>`) instead
  of the JSON envelope. The process itself succeeds; only the report was corrupt. Fixed by the JS
  wrapper writing its own result file + the client erroring fast on a malformed result. Still good
  discipline: **verify by artifact** (re-measure, or check written metadata e.g. `PCL:SPFC:*`), never by
  the wrapper's return alone. If you ever see a `MalformedResult` error, the process likely still ran —
  verify, don't retry blind.
- **Programmatic undo/snapshot EXIST — use them, never ask for GUI Ctrl+Z** (the old "canUndo=false /
  undo is GUI-owned" was a misdiagnosis; the real signal is `view.canGoBackward`). Tools:
  `get_history`, `undo(viewId, steps)`, `redo`, `snapshot(viewId, snapshotId?)` (hidden checkpoint),
  `restore(viewId, snapshotId)`. To revert a step: call `undo`. Before a risky/hard-to-reverse step —
  **especially SXT** (it also spawns a separate stars window that `undo` won't fold back) and the
  stretch — take a `snapshot` first, then `restore` if the result is wrong.
- **Gauge denoising with MRS noise, not stdDev.** Global stdDev and background-box stdDev are
  dominated by real signal and the star field, so they can *rise* after a correct denoise (BXT
  enhanced the stars; SPCC lifted a zero-clip). Use PixInsight's multiresolution/k-sigma noise
  estimator to measure the true noise floor. Run 1 raised a false "NXT added noise" alarm from the
  wrong metric.
- **SPFC needs filter curves supplied explicitly** on OSC — its defaults ship empty and it errors
  `Parsing CSV spectrum parameter ... At least 5 items are required`. Give it the sensor's actual
  R/G/B curves (the same Sony/IMX curves SPCC uses) + Ideal QE.

### Where the quality is currently weak (flag, don't wing it)

The **stretch and color-shaping** steps are the least-researched and produced a poor result in
Run 1 (dim stretch, pink background, SCNR at 100% questionable). Follow the playbook, but if the
user says the look is wrong, treat it as a **research gap** (log it via `process-retro`), not a
cue to invent numbers. Take a `snapshot` before the stretch so iterating is cheap (`restore` to
retry).

## Checkpoints & review

The user's prompt says where to pause. Honor it — the native module is non-blocking, so they can
inspect the live image between steps. At each checkpoint: report the before/after measurements,
what you changed and why (cite the playbook), and what's next. Default to pausing more often early
in a run and less as confidence builds.

## When you finish

Save the result, and **write down the warts**: any step where the playbook was vague, a tool that
behaved unexpectedly, a measurement you had to improvise because no first-class tool existed. That
list is the specification for the next tools to build.
