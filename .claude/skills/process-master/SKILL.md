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
  stretch — take a `snapshot` first, then `restore` if the result is wrong. **`snapshot`/`restore`
  worked reliably in Run 5** (named `snapshotId`s, `restore` succeeded, used to iterate the stretch and the
  star layer cheaply) — contradicting the Run-3 "unreliable" note. Use it before SXT and the stretch;
  `undo(steps=N)`/`get_history` remain solid fallbacks.
- **Gauge denoising with MRS noise, not stdDev.** Global stdDev and background-box stdDev are
  dominated by real signal and the star field, so they can *rise* after a correct denoise (BXT
  enhanced the stars; SPCC lifted a zero-clip). Use PixInsight's multiresolution/k-sigma noise
  estimator to measure the true noise floor. Run 1 raised a false "NXT added noise" alarm from the
  wrong metric.
- **SPFC needs filter curves supplied explicitly** on OSC — its defaults ship empty and it errors
  `Parsing CSV spectrum parameter ... At least 5 items are required`. Give it the sensor's actual
  R/G/B curves (the same Sony/IMX curves SPCC uses) + Ideal QE. Reuse `scripts/spcc-curves.mjs`
  (materialize to a file, read in PJSR with `File.readTextFile`). SPCC-NB has these built in; SPFC
  does not.
- **SCNR is NOT a default step.** SCNR green / Average Neutral / amount 1.0 has cast the background
  in **both runs** (Run 1 pink, Run 2 blacks→blue). Apply it ONLY if the measured decision rule
  actually fires (green median ≥ BOTH red and blue in the nebula), and even then don't assume 100% —
  the correct amount/alternative is an **open research gap**. Do not apply it "to be safe": equal
  medians do NOT mean neutral, and 100% SCNR on already-balanced data introduces the cast it's
  meant to remove.
- **After SXT with `stars=true`, `undo` on the starless restores the stars but leaves the spawned
  `*_stars` window open** — close it yourself. (Also why you `snapshot` before SXT.)
- **PJSR API notes:** use `System.getEnvironmentVariable(name)` — the bare global
  `getEnvironmentVariable` is deprecated and warns. `view.properties` is an array of
  property-**id strings** (index them directly, e.g. `props[i]` / `.filter(s=>/SPFC/.test(s))`),
  NOT `[id, type]` tuples. **Named enum constants are NOT loaded in the watcher's bare context**
  (`UndoFlag_NoSwapFile`, `ColorSaturation.AkimaSubsplines`, … are `undefined` → throw) — use the
  numeric value (`HSt=2` for Akima) and call `view.beginProcess()` with **no arg**.
- **MCP tool param names (easy to get wrong):** `open_image` takes **`filePath`** (not `path`);
  `run_script` takes **`code`** (not `script`); `save_image` needs **`overwrite:true`** to replace an
  existing file.

### Where the quality is currently weak (flag, don't wing it)

The nonlinear half failed in **both** Run 1 and Run 2 (dim/washed stretch, pink→blue background,
soft stars). **Deep research (2026-07-21) rewrote `osc-hoo.md` steps 10–12 — follow them exactly:**
- **Stretch = GHS, not HistogramTransformation** (HT was the root cause). Params are measurement-
  driven (SP via 15×15/mean readout "Send to SP"; b 5–10→2–6; D until histogram peak ≈ 0.2–0.25);
  it's **iterative** and the black point is a **separate linear step**.
  - **GHS IS a native process — use it (`run_process("GeneralizedHyperbolicStretch", …)`).** ✅ Run 4
    drove it natively (param map: `stretchType:0`=GH, `stretchFactor`=D entered directly, `localIntensity`=b,
    `symmetryPoint`=SP, `stretchChannel:3`=linked RGB). If `new GeneralizedHyperbolicStretch` is `undefined`
    (Run 3), the module loaded after PI launched → **restart PixInsight**, then introspect and drive it. Do
    NOT settle for the PixelMath fallback.
  - **⛔ DIM STRETCH = OVER-BLACK-POINTING. This is the #1 recurring failure (R1–R4, every run).** The
    playbook target is **histogram peak ≈ 0.20–0.25** — you must END there. Run 4 lifted the peak to 0.15
    then black-pointed it to 0.07, lifted to 0.17, black-pointed to 0.09 → **final peak 0.09, less than
    half the target = dim.** The black point is a **gentle true-black set** (shave only the few % of empty
    sky below the histogram rise), **NOT a background crush.** On a nebula-filling target the faint nebula
    sits just above the sky, so a hard black point kills the faint signal → the whole thing reads dim.
    **Hard gate: after your LAST step, measure the histogram peak; if it is < ~0.18 you over-black-pointed —
    undo the black point(s) and redo them gently.** Prefer more D / a second GHS pass to reach 0.20–0.25
    over any black point beyond a minimal one. Do NOT crush to a "clean 0.09 background." (Fallback, if ever truly needed: port `computeGHSCoefficients`/`buildGHSExpr`
    from `git show 2b5482a^:scripts/run-pipeline.mjs`; median is preserved under a monotonic map, so
    solve D analytically for the target peak, then apply. Each GHS pass re-lifts shadows → pair it with
    a separate linear black point `($T-BP)/(1-BP)`.)
  - **⚠ The target is a BAND, not an edge — R5 & R6 bracket it [quality/method].** R5 went too bright
    (milky); R6 corrected too far dark → **"nebulosity too dim; fainter nebulosity vanished with the
    background."** Darkening the background to make the object pop **sinks the faint outer nebula with it**
    if you overshoot. **Before accepting the nonlinear result, run a FAINT-NEBULA-SURVIVAL check** — sample/
    inspect known faint outer regions (e.g. the Pelican's diffuse edge) on the RENDER and confirm they read
    clearly above the background. **"No clipping (min>0)" is NOT preservation** — R6's mins were >0 yet the
    faint nebula was visually gone. And **do NOT trade object brightness for a darker background.** This is a
    *self-critique loop* discipline: render (full + faint-region crop) → judge object-pop AND faint-survival
    AND not-milky → iterate. The loop mechanism works; the **judgment quality** is the current gap.
  - **Saturation — RESTRAINT [R6].** R6's starless S-curve `[[0,0],[0.35,0.5],[0.7,0.83],[1,1]]` was
    **"way too much"** on an already-saturated SPCC result. Keep any saturation gentle + verify on the render;
    never a fixed aggressive curve. (Star-layer ColorSaturation in step 12 is separate/lighter.)
- **Background neutrality is a LINEAR pre-stretch step** — **equal channel medians do NOT prove
  neutrality** (that false check caused Runs 1–2 casts), and on a nebula-filling target **neither do
  the darkest N% pixels** (those are dark-nebula dust lanes where Hα is truly absent → a huge fake
  "cast" that is really correct OIII-teal; this tripped Run 3's first measurements). **Measure the
  DIFFUSE-SKY BAND: per-channel median of pixels within ±8% of the luminance median (the histogram
  peak).** That's the real sky. Verified there, ≤~1% spread = neutral; teal dark lanes are correct.
  - **Do NOT use the `BackgroundNeutralization` process for a small pedestal fix** — Run 3 it blew up
    (median ×100, R clipped to 1.0) with a narrow `backgroundHigh`. Null the residual yourself:
    per-channel additive PixelMath (`useSingleExpression:false`; `$T`, `$T-offsetG`, `$T-offsetB`),
    offsets = each background-population channel median minus the min channel. Tiny (~5e-6) but it
    compounds through GHS+black-point (0.7%→1.4%→3.6%), so do it while linear. Never fix a cast after
    the stretch or with SCNR.
- **Stars — RESEARCHED (Run 4, primary sources). NEVER GHS/arcsinh on the star layer — the wash is
  INHERENT.** RC-Astro (SXT author): GHS/arcsinh make stars *"indistinguishable from small elliptical
  galaxies"* (tiny core + broad halo = the Run-4 wash, and the real cause of Run-3's "combine artifacts",
  NOT SXT residual). On an isolated star layer the faint wings sit at the near-black GHS symmetry point →
  high-`b` puts max slope on the wings. No `b` fixes it. Also never STF-autostretch the stars.
  - **Stretch stars with a single MTF/midtones curve.** `PixelMath` MTF ≡ `HistogramTransformation`
    midtones ≡ SetiAstro's transfer — **the tool is cosmetic; don't relitigate PixelMath-vs-script**
    (R5: the user's "why PixelMath not SetiAstro" was answered by *the amount and the color step*, not the
    curve). **SetiAstro Star Stretch IS installed** (`C:\Program Files\PixInsight\src\scripts\star_stretch.js`,
    Marek v2.6); its dialog is modal so it can't be clicked via the watcher — **replay its exact Execute path**
    in `run_script` (no `#include`): (1) `PixelMath ((3^a)*$T)/((3^a-1)*$T+1)` (default `a=5`); (2) **`ColorSaturation`
    `HS=[[0,0.4],[0.5,0.7],[1,0.4]]*satAmount`, `HSt=2`, `hueShift=0` (default `satAmount=1`) — this color step
    is part of EVERY Execute, and omitting it is exactly what made R1–R5's first star attempts look flat/wrong**;
    (3) optional SCNR-green (default OFF).
  - **Amount by MEASUREMENT — measure the star PIXELS [R5, corrected].** The star layer is ~99.9% black, so
    its overall median ≈ 0 and the formula degenerates. Measure `M` = **median of star pixels only**
    (grid-sample, median of samples `> ~0.005`; R5 `M≈0.01`), then `a = ln(T*(1-M)/(M*(1-T)))/ln 3`.
    **Target `T ≈ 0.35–0.45` is a STARTING POINT, NOT 0.10–0.20** [R5] — the low target buried stars (screen
    onto a ~0.24 nebula adds nothing) = the "barely-there" failure R1–R5. **Amount is per-target and usually
    wants to go HARDER:** R5 `a≈4.5`; **R6 (darker background) the user wanted `amount=6, satAmount=1.3` for
    NAN/Pelican** (my `a=4.0/sat=1.0` read too soft). ⚠ **Per-object datapoint, NOT a universal default** —
    user was explicit "other targets might not be as good." Start near measured `a`, push harder + more sat,
    confirm at 1:1; a darker background tolerates a harder star stretch. Never the nebula's black points on stars.
  - **VERIFY STARS AT 1:1 — global stats lie [R5].** Star-layer median ≈ 0, so `get_image_statistics` cannot
    reveal too-dim stars. **Render a true 1:1 crop** (`Crop` `mode=1`, negative margins, ~900×640, centered on a
    grid-scanned bright star `max(r,g,b)>0.5`) and LOOK before calling the star step done. Only this caught R5.
- **SXT extraction: `unscreen=false` on a LINEAR image [primary: RC-Astro]** — unscreen is for nonlinear
  extraction; on linear use simple subtraction (best star color). Run 4 wrongly used `unscreen=true`.
- **Recombine `starless*~stars + stars`** (house formula ≡ screen). Formula is correct — the artifact fix
  is a natural MTF-stretched star layer, not a different combine.
- **SCNR is not a default 100% step** (see traps above).

Still genuinely open (treat as research gaps, `process-retro` them — do NOT invent numbers): the
in-place OSC **gold/teal (Foraxx)** recipe and **natural duoband star color**. Snapshot before the
stretch so iterating is cheap (`restore` to retry).

## Checkpoints & review

The user's prompt says where to pause. Honor it — the native module is non-blocking, so they can
inspect the live image between steps. At each checkpoint: report the before/after measurements,
what you changed and why (cite the playbook), and what's next. Default to pausing more often early
in a run and less as confidence builds.

## When you finish

Save the result, and **write down the warts**: any step where the playbook was vague, a tool that
behaved unexpectedly, a measurement you had to improvise because no first-class tool existed. That
list is the specification for the next tools to build.
