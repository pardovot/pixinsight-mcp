---
name: process-master
description: >
  Drive a full PixInsight processing run on a stacked astro master. Use whenever the user
  asks to process / finish / "turn into a finished image" an astrophotography master (nebula,
  galaxy, cluster) through the PixInsight MCP tools, e.g. "process this OSC duoband master",
  "make a finished HOO image from this". This skill routes to the correct acquisition-category
  playbook in docs/workflows/ and drives the measure → configure → verify loop. Invoke it
  BEFORE planning any processing steps.
---

# Process an astro master (autonomous driver)

You are about to process a real master into a finished image. **Do not plan from general
astrophotography knowledge.** The per-acquisition-category playbook in `docs/workflows/` is the
source of truth for *what* to do and in *what order*; your job is to apply it to THIS image by
measuring, configuring, and verifying each step. `[R#]` tags cite run entries in
`docs/PROCESSING_JOURNAL.md`, read there for the story behind any rule.

## Step 0, prerequisites (once)

1. Bridge alive: `list_open_images`. On error, stop, PixInsight + the MCP Watcher module must be running.
2. Read `/CLAUDE.md` (repo root) if not already in context, the generic-`run_process` rule,
   measure→configure→verify, and the no-op traps live there.

## Step 1, category → playbook

Pick the category from what the **user told you** (and their equipment profile). **Never infer it
from the FITS `FILTER` header**, screw-in duoband filters are commonly logged `NoFilter`;
misrouting narrowband to a broadband playbook calibrates color wrongly. Genuinely unstated → **ask**.

| The data is… | Read this playbook |
|---|---|
| OSC, duoband / HOO (Ha+OIII) | `docs/workflows/osc-hoo.md` |
| OSC, broadband / RGB | `docs/workflows/osc-rgb.md` |
| mono RGB | `docs/workflows/mono-rgb.md` |
| mono LRGB | `docs/workflows/mono-lrgb.md` |
| mono Ha+LRGB | `docs/workflows/mono-halrgb.md` |
| mono SHO / narrowband palette | `docs/workflows/mono-sho.md` |

⛔ **ALWAYS read `docs/workflows/_common.md` too, on every run.** It holds the cross-category facts
(SPCC filter/QE axis, the SCNR protection-method rule, the star-colour gate, order-of-operations,
the measurement traps). It is written as decision **axes**, so find your row, do not assume a
universal value.

⛔ **The mono delta playbooks are NOT self-contained.** `mono-lrgb.md`, `mono-halrgb.md` and
`mono-sho.md` are deltas on the **mono-RGB spine**, so **read `docs/workflows/mono-rgb.md` as well**.
The SPCC rules (real filter curves + real sensor QE, never a "Sony Color Sensor" entry) are stated
ONLY in the spine, and applying the OSC Ideal-QE rule to mono double-counts sensor response.

**MULTI-PANEL / MOSAIC?** Read **`docs/workflows/mosaic.md` IN ADDITION to** the category playbook
above. It is a cross-cutting *stage* (panel combination), not a category, so the category file
still governs colour/stretch. It owns: what runs per-panel vs once on the mosaic, registration,
intensity matching, **the measure-before-you-merge rule (do NOT reach for GradientMergeMosaic
reflexively)**, cropping, and the metric caveats that misfire on mosaics (bimodal peak, gradient
corner-spread, neutrality band).

**Read the entire matching playbook, in full, before planning a single step.** Present your plan
as the playbook's step order with your intended checkpoint points.

**Decide; do not interview.** Routine choices (gradient tool, SPCC wavelengths, BXT/NXT
strengths, HOO mapping) are already answered by the playbook, state each assumption in one line
and proceed. Pause only at aesthetic decision points the user named. If something unspecified is
consequential (e.g. output path), pick a sensible default and mention it.

**Detect existing state; do not redo it:**
- **Plate solve:** check `View.window.hasAstrometricSolution` via `run_script` (a boolean
  property, NOT `astrometricSolution()`, which throws). The solution is an XISF property, so
  `CTYPE*` keywords are often absent on solved images. Only run ImageSolver if false. BXT
  preserves the WCS, do not treat WCS survival as a checkpoint, a per-step outcome, or something
  to announce in plans/tables. Just don't re-solve unless `hasAstrometricSolution` is actually false.
- **Crop:** an `_autocrop` master is already cropped, don't crop again. Close WBPP's stray
  `*_crop_mask` view at the start so it can't be picked up as a target.

**MARS: assume it is configured; never probe** (Settings probes false-negative in the watcher's
bare context [R1]). Run MGC with `useMARSDatabase=true` AND pass the table explicitly:
`marsDatabaseFiles: [[true, "<abs path to .xmars>"]]` (Windows: `%APPDATA%/Roaming/Pleiades/XMARS/`).
**Headless MGC silently no-ops on an empty table**, the GUI config does not transfer. If MGC
no-ops (the gate catches it) or errors: report clearly and fall back to GradientCorrection.
**MGC also DECLINES where MARS lacks coverage, the clean signal is `executeOn` returns `false`
(no exception, stats byte-identical)** [R8: dec −24 Rho Oph; MARS DR2 far-southern (<−15°) coverage
is thin]. Same fallback: `GradientCorrection` (`protection:true, protectionThreshold:0.1,
protectionAmount:0.5, scale:5, smoothness:0.4`, R8 halved the corner ramp AND preserved the central
nebula). Note SPFC is then wasted (only MGC consumes it); a MARS-coverage probe before SPFC would save it.

## Step 2, the loop (every step; never skip the measure/verify halves)

1. **Measure first**, before-baseline + configuration input. Use the dedicated tools:
   `get_noise` (MRS, never stdDev), `get_background_gradient`, `get_background_neutrality`
   (mode `linear` pre-stretch / `poststretch` after), `get_star_metrics` (star-pixel median,
   FWHM, brightest-star coords), `get_image_statistics`; `run_script` only for what they
   don't cover.
2. **Introspect**: `get_process_parameters(processId)`; reason about what the params mean here.
3. **Configure** from the playbook + the measurement, never fixed numbers you recall. Use the
   generic `run_process(processId, viewId, settings)`.
4. **Run**, then **re-measure**. **While the image is LINEAR, also apply auto STF** (a
   `ScreenTransferFunction` autostretch, screen only, pixels untouched) **after EVERY process**,
   so the user can actually see what the step did; linear pixels render near-black otherwise, and
   the module is non-blocking precisely so they can inspect live. ⛔ **Except the starless and the
   stars layers, never auto-STF those:** SXT translates the parent image's STF onto both split
   products and autostretch destroys it, and on a star layer it blows out (layer is ~99.9% black →
   median≈0 → noise mapped to the 0.25 target) [RC-Astro; R2]. Standard params: shadows clip
   −2.80σ, target background 0.25; `STF` row order is `[c0, c1, m, r0, r1]` (NOT the
   `HistogramTransformation` order `[c0, m, c1, r0, r1]`, easy to swap). To show it in chat, bake
   the same numbers into a throwaway clone with `HistogramTransformation` (an STF won't appear in a
   saved file), or simply `render_view(viewId, path, stf:"auto")`, which does exactly this
   (and refuses to blow out a mostly-empty layer: degenerate-median clamp + warning).
5. **Verify, a gate, not a formality:** byte-identical stats = no-op → stop, diagnose (wrong
   output default? separate output view? mask?), fix, re-run. Watch for clipping (values pinned
   to 0/1), star-count collapse, background sign flips.

## Traps, linear half

- ⛔ **Flatness gate for lightness carriers: < 1% of sky peak-to-peak, aim ~0.4% [R10 +
  research-verified].** LRGBCombination takes lightness from L 1:1 (achromatic RGB gradients get
  DISCARDED at combine; L's survive whole), and the stretch's near-black MTF slope (~30-50x at
  autostretch midtones) makes small absolute residuals visible: R10's 1.4% L ramp became the
  final's dominant defect. **Scalar summaries (cornerSpread %, whole-frame channel spread) are
  blind to antisymmetric chromatic ramps**, read the box-median MAP or, better, the per-channel
  sky-band X/Y PROFILE (10-16 bands, 40th-pct sky; criterion: flat in BOTH dimensions, no trend
  in either). Cheapest first check: inspect the gradient tool's own background model.
- ⛔ **Run the MINIMUM number of gradient-model subtractions; NEVER "try again" on a converged
  pass [R10, the red-blob root cause, stage-traced + sandbox-reproduced].** Every per-channel
  background-model subtraction (GC, MGC) leaves channel-differential residue over large dark
  structure even when it no-ops at its target ramp scale. R10 ran GC twice on R and MGC twice;
  the redundant passes injected ~+23e-3 of red differential onto the dark nebula, which SPCC's
  pedestal removal then amplified ~4x (legitimate: the additive sky is ~75% of the raw level, so
  removing it multiplies ALL local contrasts, including injected errors) and BXT/NXT compounded.
  Final result: dust rims at R/B 2.0 vs ~1% raw differential, plus the extra passes SUPPRESSED
  real Ha. If a gradient pass converges with a residual you dislike, the answer is a different
  tool or a measured profile fix, not a second pass of the same model.
- **Profile-fit corrections: mask coherent structure out of the fit** (seahorse/galaxy exclusion
  boxes in R10 v2). A 40th-pct "sky" percentile inside columns holding a dark nebula is pulled
  down channel-differentially and the fit bends into it. (Note: R10's unmasked fits measured only
  −2e-3 actual injection, the hazard is real but was NOT the blob's cause; keep the masking as
  cheap insurance, and sanity-check the fitted correction over the subject before applying.)
- **ABE defaults are a no-op** (`targetCorrection=0` + `replaceTarget=false` → model only). To
  correct: `{ targetCorrection: 1, replaceTarget: true }`. But prefer the playbook's
  MGC/GradientCorrection, ABE/DBE sampling eats real nebulosity on nebula-filling targets.
- **⛔ SPCC narrowband mode HARD-DEADLOCKS PixInsight on OSC data [R7, 3× forced restarts].**
  Use **broadband mode** (`narrowbandMode=false`) with the sensor's per-channel duoband curves
  from `C:\Program Files\PixInsight\library\filters.xspd`: `Sony CMOS R/G/B-UVIRcut / Antlia-ALP-T`
  as `red/green/blueFilterTrCurve` + `Sony IMX411/455/461/533/571` as `deviceQECurve`; extract in
  PJSR (`File.readTextFile`, slice the `data="…"` attr); set `neutralizeBackground=true`.
  (NB mode worked R1-R6; cause unknown, don't fight it, switch and move on.) Checkpoint-save to
  disk through MGC/SPCC so a forced restart costs nothing.
- **SPCC NB wavelengths (if ever used):** G and B identical wavelength AND bandwidth; physical
  emission lines (Hα 656.3, OIII 500.7), not filter marketing centers.
- **SPFC needs filter curves supplied explicitly on OSC**, defaults ship empty and error
  (`Parsing CSV spectrum parameter … At least 5 items are required`). Supply the sensor's curves
  the same way the broadband-SPCC step does: extract them from `filters.xspd` in PJSR (device QE
  `Sony IMX...`, per-channel filter transmission) + Ideal QE. (SPCC-NB ships curves built in; SPFC
  does not.)
- **Gauge denoising with the MRS noise estimator, not stdDev**, stdDev is signal/star-dominated
  and can rise after a correct denoise [R1 false alarm].
- **Background neutrality is a LINEAR pre-stretch step.** Equal channel medians do NOT prove
  neutrality [R1-R2]; darkest-N% pixels are wrong on nebula-filling targets (dark lanes are
  correct OIII teal, not a cast) [R3]. Measure the **diffuse-sky band**: per-channel median of
  pixels within ±8% of the luminance median (histogram peak); ≤~1% spread = neutral. Null the
  residual with per-channel additive PixelMath (`useSingleExpression:false`; `$T`, `$T-offsetG`,
  `$T-offsetB`; offsets = channel median − min channel), while linear, tiny residuals compound
  through the stretch. **Not** the `BackgroundNeutralization` process for a small pedestal, it
  blew up in R3 (median ×100, R clipped).
- **SCNR is NOT a default step** [R1 pink, R2 blue casts]. Apply only if the measured rule fires,
  and even then not blindly at 100%, equal medians ≠ neutral. **⛔ Never stack SCNR + a mask
  chasing a metric [R7 worst result].**
  - **Gate on the midpoint axis, `gex = G − (R+B)/2 > 0`** [R9 corrected], NOT "G ≥ both R and B".
    The old gate misses the common case where R is a hair above G yet G sits well above the R-B
    midpoint (R9 nebula: gate said skip, `gexRel` was **+0.17** and the dust read visibly olive).
  - ⛔ **ALWAYS use a NEUTRAL protection method** (`protectionMethod` 2 = AverageNeutral, default;
    3 = MaximumNeutral). **NEVER the mask methods** (0 = MaximumMask, 1 = AdditiveMask) on a field
    with real colour diversity. Counter-intuitive but measured [R9]:
    - Neutral = `G' = Min(G, m)`, `m = 0.5(R+B)`. **Self-gating**: a mathematical NO-OP wherever
      green is already at/below the midpoint, so genuinely low-green regions come out
      **byte-identical**. R9: Hα arc 4.6°→4.6°, blue sky 240.9°→240.9°, unchanged to the digit.
    - Mask = `G' = G×[1 − a(1−m)]`, scales green down **everywhere, unconditionally**, dragging
      legitimately-low-green regions toward magenta. R9 MaximumMask@0.5 wrecked the same regions:
      Hα arc 4.6°→**335.2°** (sat 0.235→0.379), blue sky 240.9°→**280.1°** (sat 0.125→0.322), the
      whole field went purple on the render. This is the doc's own warning ("mask-protected SCNR
      ... can introduce a magenta cast to the sky background").
    - So "clipping" is **surgical** and "scaling" touches everything. The common forum claim that
      the scaling methods are the safe ones is **refuted on-image**.
  - **Expect a residual green bias even AFTER colour calibration; it is physical, not a bug.**
    Sky **airglow is dominated by the OI 557.7 nm green line**, and mercury light pollution has a
    strong 546.1 nm green line, both land squarely in a G filter or an OSC green channel. **OSC
    adds a second cause:** RGGB has 2x green photosites, so green is debayer-interpolated
    differently from R and B. **This applies to MONO too** (the G filter collects the same airglow
    and LP; haze/moonlight scatter broadly). Photometric calibration fixes *stellar* colour, it
    does not necessarily null an **additive, green-weighted sky pedestal**, and on a nebula-filling
    field there is no true blank sample for background neutralization to key on. → a modest
    post-calibration `gex > 0` is the expected state; SCNR-neutral is the right corrective.
    ⚠️ But **magnitude is diagnostic**: R9 measured **80.9% of pixels** above the midpoint (mean
    excess only 0.046). A large fraction means the upstream cast is big enough to investigate
    (background reference sample, debayer), not just to clamp.
- **SXT is an OPTIONAL branch, never mandatory. Extract on linear with `unscreen=false`**
  (unscreen is for nonlinear extraction; simple subtraction keeps best star color) [R4→research].
  `snapshot` first; with `stars=true`, `undo` on the starless leaves the spawned `*_stars` window
  open, close it yourself.

## Traps, nonlinear half (where runs fail; follow `osc-hoo.md` steps 10-12 exactly)

- **Stretch = native GHS**, not HistogramTransformation:
  `run_process("GeneralizedHyperbolicStretch", …)` with `stretchType:0` (=GH), `stretchFactor`=D,
  `localIntensity`=b, `symmetryPoint`=SP, `stretchChannel:3` (=linked RGB). If the class is
  `undefined`, the module loaded after PI launched → **restart PixInsight** [R3]; do NOT settle
  for a PixelMath fallback. (Emergency fallback only: port `computeGHSCoefficients`/`buildGHSExpr`
  from `git show 2b5482a^:scripts/run-pipeline.mjs`; median is preserved under a monotonic map,
  so D can be solved analytically for the target peak.)
- **⛔ The peak gate assumes ONE background population. On a mosaic / heterogeneous field it is
  BIMODAL and a global argmax is meaningless [R9].** R9's histogram had two real peaks (0.154 and
  0.226) from two genuinely different sky regions; the global mode jumped between them and reported
  channel modes disagreeing 2× (R 0.088 / B 0.175), which reads as a catastrophic over-black-point
  but was pure metric artifact. **Measure the peak PER REGION** (split the frame along the seam /
  along the dominant structure) and gate each. Also: a first curve pinned only at the global mode
  crushed the darker half to 0.095, the fix was pinning at the background and putting the gain
  ABOVE it (the R6 mechanism), which held both halves in range.
- **Residual / speckle metrics must be normalised by LOCAL BACKGROUND, not absolute [R9, user].**
  An A/B where absolute speckle σ *halved* (2.4e-4 → 1.1e-4) still read as "a tad more noisy" to
  the user, because removing the core glow dropped the background under those leftovers (3.11× →
  1.58×), raising their contrast. Report speckle-over-local-background, and let the render decide.
- **⛔ Dim stretch = over-black-pointing, the #1 recurring failure [R1-R4].** END at histogram
  peak ≈ 0.20-0.25. The black point is a **gentle true-black set** (shave only the few % of empty
  sky below the histogram rise), NOT a background crush; each GHS pass re-lifts shadows → pair
  with a separate linear black point `($T-BP)/(1-BP)`. **Hard gate: after your LAST step, if the
  peak is < ~0.18 you over-black-pointed, undo the black point(s) and redo gently.** Prefer more
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
  (washes the neutral). Compare variants side-by-side; **the critic ranks (blind A/B mode);
  the user audits per `docs/AUTONOMY.md`**, pause for the user only at aesthetic decision
  points they named.
- **Post-stretch background neutralization IS legitimate** (the old "never after stretch" was too
  broad, it came from blind SCNR@100%): see `docs/background-work.md` [R7, user-validated].
  Recipe: (1) luminance-dependent per-channel curves leveling, then (2) pull teal pixels toward
  their OWN luminance, gated to `rex = R−(G+B)/2 < 0`, preserves brightness, red untouched by
  construction. Signal hue is the per-target knob.
- **Saturation: restraint** [R6 fixed S-curve "way too much" on an already-saturated SPCC
  result]. Gentle, verify on the render; never a fixed aggressive curve.
- **Stars: NEVER GHS/arcsinh/STF-autostretch on the star layer, the wash is inherent** (RC-Astro:
  stars become "indistinguishable from small elliptical galaxies"; also the real cause of R3's
  "combine artifacts" [R4]). Stretch with a single MTF, replay SetiAstro Star Stretch's Execute
  path in `run_script` (its dialog is modal; source:
  `C:\Program Files\PixInsight\src\scripts\star_stretch.js`; no `#include`):
  1. PixelMath `((3^a)*$T)/((3^a-1)*$T+1)`;
  2. **mandatory** `ColorSaturation` `HS=[[0,0.4],[0.5,0.7],[1,0.4]]*satAmount`, `HSt=2`,
     `hueShift=0`, omitting this color step is exactly what made R1-R5 stars flat;
  3. optional SCNR-green (default OFF).
  The transfer curve is tool-cosmetic (PixelMath ≡ HT ≡ SetiAstro), don't relitigate it [R5].
- **Star amount by MEASUREMENT of star PIXELS**, the layer median is degenerate ≈0 [R5]. M =
  median of grid samples `> ~0.005`; then `a = ln(T·(1−M)/(M·(1−T)))/ln 3`. **T ≈ 0.35-0.45 is
  the STARTING point, not 0.10-0.20** (the low target buried stars, R1-R5). Per-target and
  usually wants to go HARDER: R5 a≈4.5; R6 wanted amount=6 + satAmount=1.3 for NAN/Pelican -
  a per-object datapoint, NOT a default ("other targets might not be as good"). A darker
  background tolerates a harder star stretch. Never the nebula's black points on stars.
- **VERIFY STARS AT 1:1, global stats lie** (star-layer median≈0 hides too-dim stars) [R5].
  `render_view(viewId, path, stf:"asis", rect:[…])` centered on a bright star from
  `get_star_metrics().brightestStars` (~600×400) and LOOK before calling the star step done.
- **Star COLOR correction, gated + measured [R8; metric CORRECTED in R9].** Both branches gate on
  ONE axis, green vs the R-B midpoint, measured on star pixels:
  (a) **green EXCESS** `gex = G−(R+B)/2 > 0` → `SCNR` green (Average Neutral);
  (b) **green DEFICIT** `gdef = (R+B)/2−G > 0` → **`invert → SCNR green → invert`**.
  ⛔ **Do NOT gate (b) on "magenta" (`R>G && B>G`).** That R8 test needs green to be the MINIMUM
  channel and misses the common case `B < G < (R+B)/2`: on R9 it read 0.17% ("skip") while the
  correct test read **74.2%** of lit pixels, a defect the user could see. Applying (b): 74.2%→1.0%.
  (b) reduces to **`G_new = max(G, (R+B)/2)`**, a **no-op** wherever green already sits at/above the
  midpoint, and a smooth continuum puts G at ~the midpoint, so a deficit is non-physical on a
  continuum source (Antares verified unchanged: hue 29.7→30.0°, sat 0.700→0.702). → **broadband +
  stars layer: treat (b) as default ON**, gate = magnitude sanity check, not permission.
  ⚠️ **Amount cap on broadband [research 2026-07-26]: run the inverted pass at 0.3-0.5, not 1.0.**
  The clamp sits ~on the blackbody locus, so full strength starts desaturating the reddest
  (reddened-background) stars. And a STRONG post-SPCC magenta cast is a symptom, diagnose the
  cause first (star-layer floors did it in R10; also calibration / chromatic aberration).
  ⛔ **HARD EXCLUSION, emission lines (not red stars).** Where red is Hα, G is legitimately below
  the midpoint (R9 Sh2-9 arc: G 0.357 vs midpoint 0.385, (b) would bleach it) → **never on
  narrowband/duoband, never on a starless holding emission nebulosity.** Gates are **per-image,
  never inherited**: adjacent panels of the same target fired opposite branches. **Green haze around bright blue stars lives on BOTH the
  stars layer and the starless** (reflection nebula) [R8, user], a gated, careful SCNR green on the
  starless is legitimate too (purifies teal→blue; Average Neutral only edits green so it can't reduce
  blue). Measure **green excess** `gex=G−(R+B)/2>0` on the *localized* halos, the region mean is
  blue-dominated (reads ≤0) and hides it. Not a default step; judge on the render.
- **Recombine `starless*~stars + stars`** (≡ screen), the formula is correct; artifacts mean
  the star layer wasn't a natural MTF stretch, not a combine bug [R4].
- **Open research gaps, do NOT invent numbers** (`process-retro` them): in-place OSC gold/teal
  (Foraxx) and natural duoband star color. `snapshot` before the stretch so iterating is cheap.

**R10 additions (mono-LRGB, first live mono run):**
- ⛔ **SXT star layers carry unequal per-channel constant FLOORS (subtraction residue); equalize
  them BEFORE the star MTF [R10; remedy research-corrected].** R10 measured R 14.1e-6 / G 9.1e-6 /
  B 6.1e-6 (2.3x R:B); the MTF amplified that into an orange wash on every faint star. Measure:
  per-channel median of the 0 < lum < 0.003 population. **Remedy: prefer per-channel MIDTONES
  equalization in the star stretch (+SCNR), the sourced standard; a star layer's background is
  near-clipped and black-point raises lose faint stars** (NightPhotons). Direct subtraction
  `max(0, $T - floor_c)` only when the floor is measurably above zero with margin (R10's was).
- **The "star pixel median vs 0.35-0.45" target moves its own goalposts post-stretch:** every
  extra MTF floods the >threshold footprint with wing pixels and drags the median DOWN (R10:
  39k → 111k px, median 0.112 → 0.106 after MORE stretch). Set the amount ONCE from the
  pre-stretch star-pixel M, then judge renders; do not iterate against the post-stretch median.
- ⛔ **Luminance-only-gated shadow corrections concentrate in the darkest REAL structure, i.e.
  the subject [R10, made the dark nebula's red blob worse].** A dark-nebula core IS the L<0.13
  population, so "equalize the shadow medians" pushed +R exactly onto it (blob rex +28%). The
  Stage-1 leveling |rex| gate has the complementary hole: it EXCLUDES the strongly-cast pixels
  it should fix. Any shadow-population color op needs a chroma-aware term (don't push a channel
  UP where it is already the max channel / don't operate on coherent structure), and must be
  render-checked ON THE SUBJECT, not only on the global metric.
- **GHS `stretchFactor` (process param, range 0-20) is the LOG slider**, actual D = exp(v)-1;
  v=8 lifted bg 0.0009→0.31 in one pass. Iterate with undo; ~6.5-7 was the useful zone on R10.
- **PixelMath `newImageColorSpace`: 2 = GRAY, not RGB.** Use 0 = SameAsTarget. R10's first
  recombine silently produced a MONO final; the always-verify-saturation rule caught it.

## Reliability & API notes

- **Long processes no longer phantom-fail** (result-corruption fixed 2026-07-21). Still: **verify
  by artifact** (re-measure, or written metadata e.g. `PCL:SPFC:*`), never by the wrapper's
  return alone. A `MalformedResult` error means the process likely still RAN, verify, don't
  retry blind.
- **Programmatic undo/snapshot EXIST, never ask for GUI Ctrl+Z.** `get_history`,
  `undo(viewId, steps)`, `redo`, `snapshot(viewId, snapshotId?)` (hidden checkpoint),
  `restore(viewId, snapshotId)`; the real signal is `view.canGoBackward`. Snapshot before risky
  steps (especially SXT and the stretch) [worked reliably in R5].
- Process icons from PJSR: `ProcessInstance.fromIcon(id)` reads a GUI-configured instance;
  `writeIcon(id)` writes but only into an already-existing icon.
- PJSR: `System.getEnvironmentVariable(name)` (the bare global is deprecated); `view.properties`
  is an array of property-id **strings**; named enum constants are `undefined` in the watcher's
  bare context (`UndoFlag_*`, `ColorSaturation.AkimaSubsplines`, …), use numeric values
  (`HSt=2` for Akima) and call `view.beginProcess()` with no arg.
- **`image.median(channel)` THROWS** in the bare context (a channel arg isn't accepted) [R8], omit
  it (`image.median()` = current selection) or set `image.selectedChannel = c` then `image.median()`,
  or just use the `get_image_statistics` tool for per-channel medians. Same for other stats methods.
- MCP tool params (easy to get wrong): `open_image` takes **`filePath`**; `run_script` takes
  **`code`**; `save_image` needs **`overwrite:true`** to replace an existing file.
- **⛔ A lingering `image.selectedChannel` silently makes `render_view` MONOCHROME** [mosaic run,
  cost the delivered JPEG]. `render_view` honours the view's channel selection and replicates that
  one channel into R=G=B, with **no warning** and a normal 3-channel file, so it looks like a
  correct color JPEG until you measure saturation. `save_image` (XISF) is NOT affected, and
  `render_critic_pack` resets selections internally, so the critic sees correct color while your
  deliverable is grey. **Always `image.resetSelections()` at the end of EVERY measurement helper**,
  and beware helpers called inside a `JSON.stringify(...)` that runs *after* your reset line, that
  is exactly how it happened. Cheap guard before shipping: sample a few pixels and assert
  `max(R,G,B) != min(R,G,B)` somewhere in the frame.
- **`export_container` indices are offset by 1 from `get_full_history` display indices** (its 0 =
  the first step *after* the base container). Verify by the returned process-name list, not the
  numbers, an off-by-one silently ships the WRONG stretch in the container.

## Critic gates (phase boundaries, the autonomous quality loop)

At each of these three boundaries, run the blind critic before moving on:
1. **post-linear**, after gradient correction + color calibration + BXT/NXT, before SXT/stretch;
2. **post-stretch**, starless and stars layers judged as separate packs (never `stf:"auto"`
   on the star layer, pack them `poststretch`);
3. **final**, the recombined result.

Procedure per gate: `render_critic_pack(viewId, <scratch dir>, phase)` → launch the
`image-critic` skill as a **subagent given ONLY the pack dir + `docs/CRITIC_RUBRIC.md`** -
never the transcript or parameter values (blindness is the design; see the skill).
- `pass` → proceed; keep the report for the run record.
- `revise: <axis>` → re-enter the measure→configure→verify loop on that axis. **Max 2 revise
  cycles per boundary**, then log the unresolved axis as a finding and proceed, a stuck axis
  is information for process-retro, not a reason to loop forever.
- The final pack + all critic reports are end-of-run artifacts: keep them with the run record
  (they feed process-retro and the 1-in-10 human audit, `docs/AUTONOMY.md`).

**Triaging critic findings [R9, all three lessons cost something]:**
- ⛔ **Verify every ARTIFACT claim against the SOURCE MASTER before removing anything.** R9's critic
  reported a "satellite trail" that was real sky (a cometary reflection nebula, present in the
  untouched master). One `open_image` + one crop settles it. Satellite trails also do not survive
  stacking rejection and do not terminate on a star.
- ⛔ **Never batch-dismiss an artifact list because some entries are false.** R9: of four findings,
  two were false (bright-star "halos" = real reflection nebulosity) and one was real sky, so the
  list was written off, and the **fourth was TRUE** (a globular core left in the starless, later
  user-confirmed). Adjudicate each finding separately.
- **Judge the starless in the context it will be seen in.** Two of R9's three false artifact
  findings came from judging a layer nobody ever views alone; removed-star sites are expected there.
- **The critic is blind to your process, but it is also blind to the SKY**, and only the first is
  the design goal. Every wrong R9 call came from missing subject facts (dust-filled field, no empty
  sky, two globulars, an emission arc), not bad judgment. Weigh its background/gradient verdicts
  accordingly on wide dusty fields. **Give the critic a factual target card** (sky facts only:
  field type, known objects, known-real features like reflection halos or an Ha region), R10's
  crop misfire came from a critic that did not know the left edge held real Ha.
- ⛔ **A critic CROP/geometry recommendation is a USER decision, never execute it yourself [R10,
  user had to interrupt].** The r2 critic argued "red-deficient band cannot be sky, dust reddens" +
  a noise rise = stack edge, and prescribed a 300px crop; the band was a real faint Ha region.
  Two rules: (a) verify any "this cannot be sky" spectral claim against the RAW masters first
  (per-channel spot/annulus differential, an Ha region shows R-specific excess in the raw R
  master, R10: R 1.006 vs G 1.002 local, R +8.7% vs G +0.9% global); (b) geometry changes
  invalidate every saved checkpoint and lose field, pause for the user.
- ⛔ **When a gate closes at max revise cycles, the remedy is LOG AND PROCEED, never a new
  corrective action.** R10 hit cycle-2 closure and started executing the crop anyway; closure
  means the axis is recorded for process-retro, full stop.
- **Spot-verify a critic's quantitative claim yourself before acting on it** (one measurement
  script). R10's cyan-shadow numbers verified and were right; the crop rationale did not and
  was wrong.

## Checkpoints & when you finish

The user's prompt says where to pause, honor it; the module is non-blocking, so they can inspect
the live image between steps. At each checkpoint: before/after measurements, what you changed and
why (cite the playbook), what's next. Pause more often early in a run, less as confidence builds.

## ⛔ DELIVERABLES, every run, no exceptions

**Everything below goes to `result-tests/<TargetName>/`, never a scratch/working dir.** The run is
NOT finished until all of it exists. Do not report completion first and produce these on request.

**Layout, by PIPELINE STAGE keyed to combination boundaries** (mirrors the KB's pre/post-combine
model, so it generalises to channels, panels, or both):

```
result-tests/<Target>/
├── HISTORY.md  metrics.json  replay.js
├── final.xisf  final.jpg
├── 01-precombine/     per-CHANNEL and/or per-PANEL, before any combination
│   ├── L_lin.xisf  R_lin.xisf  G_lin.xisf  B_lin.xisf   (or P1_lin.xisf …, or L_P1_lin.xisf …)
│   └── precombine.xpsm
├── 02-linear/         combined, still linear. MULTI-TRACK runs (LRGB/HaLRGB/SHO): prefix EVERY
│   │                  file with its track (rgb_, L_, Ha_...), never a bare `linear.xisf` [R10,
│   │                  user: "linear and L_linear is confusing"]
│   ├── rgb_combined.xisf      right after ChannelCombination, pre-calibration (cheap, lets the
│   │                          user re-run calibration themselves; R10 user asked for exactly this)
│   ├── rgb_calibrated.xisf    post SPFC/MGC/SPCC, pre BXT/NXT (the color-decision boundary)
│   ├── rgb_linear.xisf        post BXT+NXT (+ any measured fixes), pre-SXT
│   ├── L_linear.xisf          the L track's same stage (parallel track, merges only at nonlinear
│   │                          LRGBCombination, that is WHY it lives here and not in 01-)
│   ├── rgb_linear_starless.xisf  rgb_linear_stars.xisf  L_linear_starless.xisf
│   └── rgb_linear.xpsm  L_linear.xpsm
├── 03-nonlinear/
│   ├── final_starless.xisf  final_stars.xisf  (+ final_L.xisf on LRGB)
│   └── starless.xpsm  stars.xpsm  L_stretch.xpsm  recombine.xpsm
├── critic/            the packs + reports for EVERY gate (post-linear/, post-stretch-*/, final/)
└── gate-runs/         kb-gate reports
```

- **A run README.md in the target dir is part of the deliverable on multi-track runs:** one line
  per file saying what stage it is and which track it belongs to. The stage layout is obvious to
  the agent that wrote it and to nobody else [R10 user feedback].

- **The layer pairs are the point:** linear (pre-stretch) and final, for both starless and stars, so
  a later run can restart from either side of the stretch. A single-image OSC run has an empty
  `01-precombine/`; mono has one file per filter; a mosaic has one per panel.
- **Containers: ONE PER STAGE BOUNDARY, not a fixed count.** Single-image OSC = 4; mono-LRGB = 5
  (it has an extra combination point, the L application). Use `export_container` (mind the index
  off-by-one trap above).
- **`critic/` is mandatory**, the packs are end-of-run artifacts and belong with the run record.
  Do NOT leave them in a scratch dir, they get wiped.
- **Records, 3:** `metrics.json`, `replay.js` (empty→final reproducer), `HISTORY.md` (pipeline as
  run + the warts).
- **`metrics.json` checkpoint keys must be FLAT strings**, `gate-compare.mjs` does
  `baseline.checkpoints[name]`. So `pre-combine-L`, `pre-combine-R`, …, `post-linear`, `final`.
  Never nest per-channel objects. `checkpointViews` values are free-form, so they carry subpaths.
- Legacy targets (`Rho-Ophiuchi-Panel-1/2`, `-2Panel-Mosaic`) are FLAT. Do not migrate them.

**Pre-combination checkpoint (multi-input runs).** Save each channel/panel and record its metrics
under `pre-combine-<track>` BEFORE combining. Gradient, registration and LinearFit errors are far
cheaper to catch here than after. A metrics checkpoint is enough, do **not** run a blind critic per
channel (N x cost, low yield); the critic gates stay at post-linear / post-stretch / final.

### ⛔ File-writing rules (every save, no exceptions)

- **XISF: ALWAYS compressed.** `save_image` now takes **`compression`, defaulting to `zlib+sh`**, so
  the normal tool call is already correct. Measured on a 6159x7396 float RGB master:
  **521.7 MB → 384.2 MB (−26%)**, about 140 MB per image, and a run writes 6+ of them.
  `zlib+sh` (deflate + byte shuffling) is the best codec tested; `zstd+sh` within ~1%; plain
  `lz4`/`lz4hc` markedly worse. **Byte shuffling is the load-bearing part for float data**
  (unshuffled loses a further ~16%), always keep the `+sh`.
- ⛔ **When saving via raw PJSR (`run_script`, `replay.js`), pass the codec EXPLICITLY:**
  ```js
  w.saveAs(path, false, false, false, false, "compression-codec zlib+sh");   // 6th arg = hints
  ```
  An empty hints string means "format defaults", and **those defaults are SESSION-MUTABLE**: one
  saveAs with a codec hint changes them, so a later empty-hint save silently inherits it (probed:
  the same image wrote 16.95 MB with `""`, then 12.07 MB with `""` after one `zlib+sh` save).
  **Consequence: any save without an explicit hint has non-deterministic size across a session**,
  including the module's own `save_image` bridge handler and any `saveView()` helper in a replay
  script. Explicit hints everywhere, or file sizes will not reproduce.
- **JPEG: ALWAYS quality 100.** `render_view(..., quality: 100)`. These are deliverables and review
  artifacts, not web assets.
- **Verify the write, do not assume:** re-open and assert non-zero saturation somewhere in the frame
  (the `selectedChannel` trap above silently produced a mono JPEG that passed every critic gate).

Rules that make the above actually correct:
- **Export containers LIVE**, before saving/closing the view. `view.processing` resets on
  save+reopen and `createNewImage` outputs (the recombine) start with EMPTY history, so the
  recombine container must be captured from a view you applied it to **in place**.
- **A container must contain only the KEPT path.** Snapshot/restore leaves abandoned attempts and
  `Script` entries interleaved in the history, so a plain index range can ship a discarded stretch.
  If the kept steps are non-contiguous, rebuild the section cleanly on a copy of the previous
  checkpoint and export from that, which also verifies your recorded parameters reproduce the
  result (expect a byte-identical diff).
- **Re-save the layers AFTER the last edit to them.** Saving `final_starless` before a later SCNR
  or curve leaves a stale file that does not match `final.xisf`.
- Mosaics/multi-panel add the per-panel and registered intermediates (`P<n>_lin.xisf`,
  `reg_P<n>.xisf`) and a per-panel linear container; capture them during the run, the views are
  closed by the time you stitch.

Then **write down the warts**, vague playbook spots, tools that surprised you, measurements you had
to improvise. That list is the spec for the next tools to build.
