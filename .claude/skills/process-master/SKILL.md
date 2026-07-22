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
astrophotography knowledge.** The per-acquisition-category playbook in `docs/workflows/` is the
source of truth for *what* to do and in *what order*; your job is to apply it to THIS image by
measuring, configuring, and verifying each step. `[R#]` tags cite run entries in
`docs/PROCESSING_JOURNAL.md` — read there for the story behind any rule.

## Step 0 — prerequisites (once)

1. Bridge alive: `list_open_images`. On error, stop — PixInsight + the MCP Watcher module must be running.
2. Read `/CLAUDE.md` (repo root) if not already in context — the generic-`run_process` rule,
   measure→configure→verify, and the no-op traps live there.

## Step 1 — category → playbook

Pick the category from what the **user told you** (and their equipment profile). **Never infer it
from the FITS `FILTER` header** — screw-in duoband filters are commonly logged `NoFilter`;
misrouting narrowband to a broadband playbook calibrates color wrongly. Genuinely unstated → **ask**.

| The data is… | Read this playbook |
|---|---|
| OSC, duoband / HOO (Ha+OIII) | `docs/workflows/osc-hoo.md` |
| OSC, broadband / RGB | `docs/workflows/osc-rgb.md` |
| mono RGB | `docs/workflows/mono-rgb.md` |
| mono LRGB | `docs/workflows/mono-lrgb.md` |
| mono Ha+LRGB | `docs/workflows/mono-halrgb.md` |
| mono SHO / narrowband palette | `docs/workflows/mono-sho.md` |

**Read the entire matching playbook, in full, before planning a single step.** Present your plan
as the playbook's step order with your intended checkpoint points.

**Decide; do not interview.** Routine choices (gradient tool, SPCC wavelengths, BXT/NXT
strengths, HOO mapping) are already answered by the playbook — state each assumption in one line
and proceed. Pause only at aesthetic decision points the user named. If something unspecified is
consequential (e.g. output path), pick a sensible default and mention it.

**Detect existing state; do not redo it:**
- **Plate solve:** check `View.window.hasAstrometricSolution` via `run_script` (a boolean
  property — NOT `astrometricSolution()`, which throws). The solution is an XISF property, so
  `CTYPE*` keywords are often absent on solved images. Only run ImageSolver if false. BXT does
  not necessarily strip the WCS [R1] — re-check after BXT; re-solve only if actually false.
- **Crop:** an `_autocrop` master is already cropped — don't crop again. Close WBPP's stray
  `*_crop_mask` view at the start so it can't be picked up as a target.

**MARS: assume it is configured; never probe** (Settings probes false-negative in the watcher's
bare context [R1]). Run MGC with `useMARSDatabase=true` AND pass the table explicitly:
`marsDatabaseFiles: [[true, "<abs path to .xmars>"]]` (Windows: `%APPDATA%/Roaming/Pleiades/XMARS/`).
**Headless MGC silently no-ops on an empty table** — the GUI config does not transfer. If MGC
no-ops (the gate catches it) or errors: report clearly and fall back to GradientCorrection.

## Step 2 — the loop (every step; never skip the measure/verify halves)

1. **Measure first** (`get_image_statistics` / `run_script`) — before-baseline + configuration input.
2. **Introspect**: `get_process_parameters(processId)`; reason about what the params mean here.
3. **Configure** from the playbook + the measurement — never fixed numbers you recall. Use the
   generic `run_process(processId, viewId, settings)`.
4. **Run**, then **re-measure**.
5. **Verify — a gate, not a formality:** byte-identical stats = no-op → stop, diagnose (wrong
   output default? separate output view? mask?), fix, re-run. Watch for clipping (values pinned
   to 0/1), star-count collapse, background sign flips.

## Traps — linear half

- **ABE defaults are a no-op** (`targetCorrection=0` + `replaceTarget=false` → model only). To
  correct: `{ targetCorrection: 1, replaceTarget: true }`. But prefer the playbook's
  MGC/GradientCorrection — ABE/DBE sampling eats real nebulosity on nebula-filling targets.
- **⛔ SPCC narrowband mode HARD-DEADLOCKS PixInsight on OSC data [R7, 3× forced restarts].**
  Use **broadband mode** (`narrowbandMode=false`) with the sensor's per-channel duoband curves
  from `C:\Program Files\PixInsight\library\filters.xspd`: `Sony CMOS R/G/B-UVIRcut / Antlia-ALP-T`
  as `red/green/blueFilterTrCurve` + `Sony IMX411/455/461/533/571` as `deviceQECurve`; extract in
  PJSR (`File.readTextFile`, slice the `data="…"` attr); set `neutralizeBackground=true`.
  (NB mode worked R1–R6; cause unknown — don't fight it, switch and move on.) Checkpoint-save to
  disk through MGC/SPCC so a forced restart costs nothing.
- **SPCC NB wavelengths (if ever used):** G and B identical wavelength AND bandwidth; physical
  emission lines (Hα 656.3, OIII 500.7), not filter marketing centers.
- **SPFC needs filter curves supplied explicitly on OSC** — defaults ship empty and error
  (`Parsing CSV spectrum parameter … At least 5 items are required`). Supply the sensor's curves
  the same way the broadband-SPCC step does: extract them from `filters.xspd` in PJSR (device QE
  `Sony IMX...`, per-channel filter transmission) + Ideal QE. (SPCC-NB ships curves built in; SPFC
  does not.)
- **Gauge denoising with the MRS noise estimator, not stdDev** — stdDev is signal/star-dominated
  and can rise after a correct denoise [R1 false alarm].
- **Background neutrality is a LINEAR pre-stretch step.** Equal channel medians do NOT prove
  neutrality [R1–R2]; darkest-N% pixels are wrong on nebula-filling targets (dark lanes are
  correct OIII teal, not a cast) [R3]. Measure the **diffuse-sky band**: per-channel median of
  pixels within ±8% of the luminance median (histogram peak); ≤~1% spread = neutral. Null the
  residual with per-channel additive PixelMath (`useSingleExpression:false`; `$T`, `$T-offsetG`,
  `$T-offsetB`; offsets = channel median − min channel), while linear — tiny residuals compound
  through the stretch. **Not** the `BackgroundNeutralization` process for a small pedestal — it
  blew up in R3 (median ×100, R clipped).
- **SCNR is NOT a default step** [R1 pink, R2 blue casts]. Apply only if the measured rule fires
  (green median ≥ BOTH red and blue in the nebula), and even then not blindly at 100% — equal
  medians ≠ neutral. **⛔ Never stack SCNR + a mask chasing a metric [R7 worst result].**
- **SXT is an OPTIONAL branch, never mandatory. Extract on linear with `unscreen=false`**
  (unscreen is for nonlinear extraction; simple subtraction keeps best star color) [R4→research].
  `snapshot` first; with `stars=true`, `undo` on the starless leaves the spawned `*_stars` window
  open — close it yourself.

## Traps — nonlinear half (where runs fail; follow `osc-hoo.md` steps 10–12 exactly)

- **Stretch = native GHS**, not HistogramTransformation:
  `run_process("GeneralizedHyperbolicStretch", …)` with `stretchType:0` (=GH), `stretchFactor`=D,
  `localIntensity`=b, `symmetryPoint`=SP, `stretchChannel:3` (=linked RGB). If the class is
  `undefined`, the module loaded after PI launched → **restart PixInsight** [R3]; do NOT settle
  for a PixelMath fallback. (Emergency fallback only: port `computeGHSCoefficients`/`buildGHSExpr`
  from `git show 2b5482a^:scripts/run-pipeline.mjs`; median is preserved under a monotonic map,
  so D can be solved analytically for the target peak.)
- **⛔ Dim stretch = over-black-pointing — the #1 recurring failure [R1–R4].** END at histogram
  peak ≈ 0.20–0.25. The black point is a **gentle true-black set** (shave only the few % of empty
  sky below the histogram rise), NOT a background crush; each GHS pass re-lifts shadows → pair
  with a separate linear black point `($T-BP)/(1-BP)`. **Hard gate: after your LAST step, if the
  peak is < ~0.18 you over-black-pointed — undo the black point(s) and redo gently.** Prefer more
  D or a second GHS pass over any black point beyond a minimal one.
- **The target is a band, not an edge [R5 milky / R6 too-dark bracket it].** Before accepting the
  nonlinear result, run a **faint-nebula-survival check**: inspect known faint outer regions ON
  THE RENDER and confirm they read clearly above background. `min>0` is NOT preservation [R6].
  Do NOT trade object brightness for a darker background. Discipline: render (full + faint-region
  crop) → judge object-pop AND faint-survival AND not-milky → iterate.
- **⛔ Judge by the RENDER, not metrics [R7].** The ±8% sky-band metric LIES post-stretch (valid
  only for linear neutrality). Judge on the render + background chroma of the near-neutral
  population + faint/bright preservation. Removing chroma makes darks read blacker at equal
  luminance → neutralize by preserving brightness; never fix "too dark" by global brightening
  (washes the neutral). Compare variants side-by-side; **the user picks.**
- **Post-stretch background neutralization IS legitimate** (the old "never after stretch" was too
  broad — it came from blind SCNR@100%): see `docs/background-work.md` [R7, user-validated].
  Recipe: (1) luminance-dependent per-channel curves leveling, then (2) pull teal pixels toward
  their OWN luminance, gated to `rex = R−(G+B)/2 < 0` — preserves brightness, red untouched by
  construction. Signal hue is the per-target knob.
- **Saturation: restraint** [R6 fixed S-curve "way too much" on an already-saturated SPCC
  result]. Gentle, verify on the render; never a fixed aggressive curve.
- **Stars: NEVER GHS/arcsinh/STF-autostretch on the star layer — the wash is inherent** (RC-Astro:
  stars become "indistinguishable from small elliptical galaxies"; also the real cause of R3's
  "combine artifacts" [R4]). Stretch with a single MTF — replay SetiAstro Star Stretch's Execute
  path in `run_script` (its dialog is modal; source:
  `C:\Program Files\PixInsight\src\scripts\star_stretch.js`; no `#include`):
  1. PixelMath `((3^a)*$T)/((3^a-1)*$T+1)`;
  2. **mandatory** `ColorSaturation` `HS=[[0,0.4],[0.5,0.7],[1,0.4]]*satAmount`, `HSt=2`,
     `hueShift=0` — omitting this color step is exactly what made R1–R5 stars flat;
  3. optional SCNR-green (default OFF).
  The transfer curve is tool-cosmetic (PixelMath ≡ HT ≡ SetiAstro) — don't relitigate it [R5].
- **Star amount by MEASUREMENT of star PIXELS** — the layer median is degenerate ≈0 [R5]. M =
  median of grid samples `> ~0.005`; then `a = ln(T·(1−M)/(M·(1−T)))/ln 3`. **T ≈ 0.35–0.45 is
  the STARTING point, not 0.10–0.20** (the low target buried stars, R1–R5). Per-target and
  usually wants to go HARDER: R5 a≈4.5; R6 wanted amount=6 + satAmount=1.3 for NAN/Pelican —
  a per-object datapoint, NOT a default ("other targets might not be as good"). A darker
  background tolerates a harder star stretch. Never the nebula's black points on stars.
- **VERIFY STARS AT 1:1 — global stats lie** (star-layer median≈0 hides too-dim stars) [R5].
  Render a true 1:1 crop (`Crop` `mode=1`, negative margins, ~900×640, centered on a
  grid-scanned bright star `max(r,g,b)>0.5`) and LOOK before calling the star step done.
- **Recombine `starless*~stars + stars`** (≡ screen) — the formula is correct; artifacts mean
  the star layer wasn't a natural MTF stretch, not a combine bug [R4].
- **Open research gaps — do NOT invent numbers** (`process-retro` them): in-place OSC gold/teal
  (Foraxx) and natural duoband star color. `snapshot` before the stretch so iterating is cheap.

## Reliability & API notes

- **Long processes no longer phantom-fail** (result-corruption fixed 2026-07-21). Still: **verify
  by artifact** (re-measure, or written metadata e.g. `PCL:SPFC:*`), never by the wrapper's
  return alone. A `MalformedResult` error means the process likely still RAN — verify, don't
  retry blind.
- **Programmatic undo/snapshot EXIST — never ask for GUI Ctrl+Z.** `get_history`,
  `undo(viewId, steps)`, `redo`, `snapshot(viewId, snapshotId?)` (hidden checkpoint),
  `restore(viewId, snapshotId)`; the real signal is `view.canGoBackward`. Snapshot before risky
  steps (especially SXT and the stretch) [worked reliably in R5].
- Process icons from PJSR: `ProcessInstance.fromIcon(id)` reads a GUI-configured instance;
  `writeIcon(id)` writes but only into an already-existing icon.
- PJSR: `System.getEnvironmentVariable(name)` (the bare global is deprecated); `view.properties`
  is an array of property-id **strings**; named enum constants are `undefined` in the watcher's
  bare context (`UndoFlag_*`, `ColorSaturation.AkimaSubsplines`, …) — use numeric values
  (`HSt=2` for Akima) and call `view.beginProcess()` with no arg.
- MCP tool params (easy to get wrong): `open_image` takes **`filePath`**; `run_script` takes
  **`code`**; `save_image` needs **`overwrite:true`** to replace an existing file.

## Checkpoints & when you finish

The user's prompt says where to pause — honor it; the module is non-blocking, so they can inspect
the live image between steps. At each checkpoint: before/after measurements, what you changed and
why (cite the playbook), what's next. Pause more often early in a run, less as confidence builds.

At the end: save the result, then **write down the warts** — vague playbook spots, tools that
surprised you, measurements you had to improvise. That list is the spec for the next tools to build.
