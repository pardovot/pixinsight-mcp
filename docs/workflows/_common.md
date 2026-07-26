# Shared processing knowledge (cross-category)

**Read this ALONGSIDE your acquisition-category playbook, on every run.** It holds facts that are
true across categories. The category file holds what is specific to your data.

## ⛔ How to write entries here, this is the whole design

A shared file rots the moment one category contradicts it. Two rules prevent that:

1. **Record the DECISION AXIS, never a universal value.** Not "use Ideal QE", but "QE choice
   depends on sensor type: OSC → Ideal, mono → real". A future category then **adds a row** instead
   of contradicting the file.
2. **Every entry carries `Verified on:`.** A new category either confirms an entry or forces an
   explicit split, so a contradiction becomes a visible event instead of silent rot.

If an entry turns out to be category-specific, **demote it** into that category's playbook and
leave a one-line pointer here. Do not leave a contradicted rule standing.

`[live]` = confirmed on a real run. `[researched]` = from the research passes, not yet run.
`[vendor-doc]` = stated by the tool's own author in the shipped PixInsight reference
(`<PixInsight>/doc/tools/<Tool>/<Tool>.html`). Outranks forum consensus on what a parameter
*means*; says nothing about what suits a given image.

---

## 1. Colour calibration, filter curves and QE

**Axis: sensor type.** This is the single most costly thing to get wrong, and the OSC and mono
answers are opposites.

| Sensor | Filter curves | Device QE curve |
|---|---|---|
| **OSC** | the fused colour-sensor entries (`Sony Color Sensor R/G/B[-UVIRcut]`) | **Ideal QE curve** |
| **Mono** | the **REAL** per-filter transmission curves (Chroma / Astrodon / Baader / Astronomik) | the **REAL** mono sensor QE curve (Ideal only as fallback) |

**Why:** `response = filter x sensor QE`. The OSC colour-sensor entries **already embed the CFA and
the sensor QE**, so pairing them with a real QE curve double-counts. Mono filter curves do not embed
QE, so the real QE is required. ⛔ **Never pick a "Sony Color Sensor" entry for mono**, it
double-applies sensor response.
*Verified on: OSC-HOO `[live]`, OSC-RGB `[live]`, mono-RGB `[researched]`. Full detail + the
per-parameter table lives in `mono-rgb.md` (the mono spine).*

**Corollary for LRGB/HaLRGB/SHO:** those playbooks are **deltas on the mono-RGB spine**. Read
`mono-rgb.md` too, the SPCC/QE rules are stated there, not repeated in the delta files.

---

## 2. Green bias, why it survives calibration, and how to treat it

**A residual green excess after colour calibration is EXPECTED and physical, not a bug.**

**Sources (axis: which apply depends on sensor + sky, not on target type):**
- **Airglow is dominated by the OI 557.7 nm line** and mercury light pollution has a strong
  **546.1 nm** line. Both land in a green channel or a mono G filter. **Applies to every camera.**
- **Haze and moonlight** scatter broadly and lift the same band.
- **OSC only:** RGGB has **2x green photosites**, so green is debayer-interpolated differently from
  R and B.

**Why calibration does not remove it:** photometric calibration (SPCC) matches *stellar* spectra, so
it fixes star colour. It does not null an **additive, green-weighted sky pedestal**. On a
nebula-filling field, background neutralization also has **no true blank sample** to key on.
*Verified on: OSC-RGB `[live]`, 80.9% of pixels above the R-B midpoint post-SPCC (mean excess only
0.046). Expected to be smaller on mono, where per-channel gradient correction + LinearFit run before
combination, UNMEASURED, see the journal's open question.*

### SCNR, protection method matters far more than amount `[live]`

**Gate on the midpoint axis:** `gex = G − (R+B)/2 > 0`. **Not** "G ≥ both R and B", which misses the
common case where R is a hair above G while G sits well above the midpoint.

⛔ **Always a NEUTRAL protection method** (`AverageNeutral` = 2, default; `MaximumNeutral` = 3).
⛔ **Never the mask methods** (`MaximumMask` = 0, `AdditiveMask` = 1) on a field with real colour
diversity. This **reverses** a widely repeated forum claim that the scaling methods are the safe ones.

| Method | Formula | Behaviour |
|---|---|---|
| Neutral | `G' = Min(G, 0.5(R+B))` | **Self-gating**, a mathematical NO-OP wherever green is already at/below the midpoint |
| Mask | `G' = G x [1 − a(1−m)]` | Scales green down **unconditionally everywhere** |

Measured on one frame: neutral@0.5 corrected dust 60.8° → 45.5° while leaving the Hα arc (4.6°) and
blue sky (240.9°) **byte-identical**. `MaximumMask@0.5` sent those same regions to **335.2°** and
**280.1°**, turning the field magenta. That is the magenta-sky-cast drawback the PixInsight doc
itself warns about for mask protection. **"Clipping" is surgical; "scaling" touches everything.**

**Placement (linear vs post-stretch) is a MINOR axis.** Post-stretch is ~3° more aggressive (for a
concave stretch the midpoint computed after stretching is lower, by Jensen), and both are identical
no-ops where green is legitimately low. Either is defensible.

⚠️ **Legacy-doc trap:** the 2010 PixInsight LE page says "the Amount parameter is not used for
neutral protection". **Modern PixInsight DOES honour it** (amount 0.5 leaves G above the midpoint).

---

## 3. Star colour correction, gated on the same axis

Both branches key on green vs the R-B midpoint, measured on star pixels:

| Condition | Action |
|---|---|
| **green excess**, `G − (R+B)/2 > 0` | `SCNR` green (Average Neutral) |
| **green deficit**, `(R+B)/2 − G > 0` | `invert → SCNR green → invert` |

The second reduces to **`G_new = max(G, (R+B)/2)`**, the mirror of SCNR-neutral, and is likewise a
no-op where green already sits at/above the midpoint.

⚠️ **Deficit-branch strength cap on BROADBAND (research 2026-07-26):** the invert-SCNR-invert
technique is sourced from narrowband magenta-star repair; on broadband the clamp `G >= (R+B)/2`
sits ~on the blackbody locus, so at amount 1.0 it starts desaturating the REDDEST stars, exactly
the reddened background stars a dark-nebula field should keep. Cap the inverted pass at
**amount 0.3-0.5** on broadband, and treat a STRONG post-SPCC magenta cast as a symptom to
diagnose first (calibration, chromatic aberration, or star-layer floors, R10's cause WAS the
floors) rather than clamp away. (R10 ran it at 1.0 pre-correction; datapoint, not a default.)

⛔ **Do NOT gate the deficit branch on "magenta" (`R>G && B>G`).** That requires green to be the
*minimum* channel and misses `B < G < (R+B)/2`. Measured on one image: the magenta test read
**0.17%** ("skip") while the correct test read **74.2%** of lit pixels.

⛔ **HARD EXCLUSION for the deficit branch: emission lines.** Where red is Hα rather than continuum,
G is *legitimately* below the midpoint, and lifting it bleaches real signal. **Broadband + stars
layer only. Never on narrowband/duoband, never on a starless holding emission nebulosity.** Stars are
continuum sources; emission nebulae are not. A smooth continuum puts G at ~the midpoint, which is
why a deficit is non-physical on a star and physical on an Hα region.

**Gates are per-image, never inherited.** Adjacent panels of the same target, same rig, same session
fired *opposite* branches. *Verified on: OSC-RGB `[live]`, three images.*

---

## 4. Order of operations (tool-level, category-independent)

- ⛔ **Gradient-model subtractions: run the MINIMUM, never retry a converged pass.** Each GC/MGC
  pass leaves channel-differential residue over large dark structure even when it no-ops at its
  target scale; downstream pedestal removal (SPCC neutralizeBackground) then amplifies all local
  contrasts ~1/(1−pedestal fraction) (R10: ~4x), turning invisible residues into visible color
  blobs on the subject. R10: two redundant passes → dust rims at R/B 2.0 vs a ~1% raw
  differential, AND suppressed real Ha. *Verified on: mono-LRGB `[live]` (R10 stage trace +
  sandbox reproduction).*
- **BXT before NXT.** BXT performs worse on de-noised data (author's rule). Reason, from the
  manual: noise reduction "alters or destroys information needed for deconvolution" and
  "produces a falsely-high SNR that will usually result in over-sharpening". Decon applied to
  denoised data "can't truly be called deconvolution. It is sharpening." `[vendor-doc]`
- ⚠️ **Give BXT clipping headroom BEFORE sharpening.** BXT is trained to conserve flux, so
  concentrating a star's light into fewer pixels makes those pixels brighter, and anything
  already near 1.0 clips. The manual's own remedy: add headroom with the **high range**
  function of `HistogramTransformation` first. Stronger sharpening = more risk. Check the
  bright-star population for a saturated count that grew across the BXT step.
  `[vendor-doc, untested here]`
- **BXT Correct-Only early, sharpening late.** On multi-input work (mosaic panels, mono channels),
  correct aberrations per input *before* combination and sharpen *once* after.
- **BXT defaults are good, don't tone them down.** Run sharpening with auto PSF and the GUI
  defaults: `sharpen_stars 0.5`, `sharpen_nonstellar 1.0` (user-confirmed on the installed
  build; RC Astro's manual text and older writeups cite 0.25/0.90, they lag, don't "correct"
  back down) unless artifacts appear at 1:1.
  ⚠️ A fresh `run_process` instance does NOT carry the GUI defaults (introspected 0.30/0.25),
  always pass the amounts explicitly. Extra aggression beyond that comes from an oversized
  PSF, which is off-model, the manual calls a fictitious PSF diameter "no longer
  deconvolution" (over-sharpens smooth nebulosity, curdles faint stars).
  ⚠️ Know what `sharpen_nonstellar 1.0` is: the manual defines 1.00 as "attempt to reduce the
  nonstellar PSF to zero size, an ideal point PSF, and **the maximum possible amount of
  sharpening**". It is the top of the range, not a mild default. Right starting point on this
  build, but it leaves no headroom, so artifacts at 1:1 mean going *down*, never up.
  `[vendor-doc]`
  *User-confirmed + verified on Barnard150 L 2026-07-26.*
- **Check sampling before sharpening at all.** The manual's thresholds, by star FWHM in px
  (`get_star_metrics`): **3-4 = generously sampled**; **4-6 = oversampled, but don't downsample
  unless the data is noisy**; **>6-8 = more than 2x oversampled, downsample 2x with
  `IntegerResample` in Average mode** (no significant information loss, higher SNR, ~4x faster
  downstream). BXT's `PSF Diameter` maxes at 8 px for exactly this reason. Converse trap:
  **2x drizzle only recovers anything on undersampled data, FWHM < 2-3 px.** These thresholds
  do not depend on aperture, focal length, f-ratio, pixel size or seeing.
  `[vendor-doc, untested here]`
- ⛔ **NEVER run BXT with auto PSF on a STARLESS image.** No stars to sense → it guesses from
  nonstellar features and badly overestimates (measured: behaved like ~6-8 px on true ~2.2 px
  data, the harshest carving of all variants). Prefer BXT *before* SXT (author's rule); if
  sharpening starless data, uncheck auto and set the PSF diameter to the star FWHM measured
  **before** star removal. The manual prescribes exactly this, and gives the same failure mode
  for star-poor *regions* of a star-bearing image: BXT tiles at 512x512 and falls back to
  guessing the PSF from nonstellar features per tile, so a starless corner gets sharpened
  differently from the rest. Manual PSF diameter also fixes that. `[vendor-doc]`
  *Verified on: mono-LRGB L starless, 2026-07-26.*
- ⚠️ **BXT via `run_process`: `auto_nonstellar_psf`/`nonstellar_psf_diameter` are DEAD aliases**
  (setting them changes nothing, byte-identical output). The live pair is
  **`auto_nonstellar_radius`/`nonstellar_diameter`**; set both pairs to be version-safe.
- **Gauge denoising with the MRS noise estimator, never stdDev.** stdDev is signal/star dominated and
  can *rise* after a correct denoise.
- **Starless/SXT is an OPTIONAL branch, never a baseline step.**

---

## 4b. Star-layer floors (SXT), subtract before any star stretch

**SXT star layers carry small per-channel CONSTANT floors** (residue of the starless subtraction),
and they are **unequal across channels**, so the star MTF amplifies the imbalance into a global
color wash on faint stars. Measured: R 14.1e-6 / G 9.1e-6 / B 6.1e-6 (2.3x R:B) → orange wash,
B median exactly 0 across whole rows while R sat at 9e-4.
**Rule (research-corrected 2026-07-26):** measure each channel's floor = median of the
`0 < lum < 0.003` population. **The established remedy is per-channel MIDTONES equalization in
the star stretch (+ SCNR), NOT a black-point raise**, NightPhotons warns explicitly that star-layer
backgrounds are near-clipped and any black-point adjustment loses faint stars. Subtract a floor
directly ONLY when it is measurably above zero with margin (R10's 6-14e-6 pedestals qualified;
`max(0, $T - floor_c)`); never as a default black-point move.
*Verified on: mono-LRGB `[live]` (R10 Barnard 150, subtraction path). Midtones-equalization
variant is the sourced standard, untested here.*

---

## 4c. GradientCorrection, documented defaults and tuning ladder `[vendor-doc]`

From the shipped manual (Edoardo Luca Radice, PTeam). Everything here is *what the knobs mean and
in what order to reach for them*, not a prescription, the right values stay image-dependent.

**Preconditions (all three, or expect suboptimal/odd results):** image is **linear**; the gradient
is **purely additive** (light pollution); **the frame edges have no sudden brightness change.**
⚠️ The edge rule is concrete and it is a crop gate: multiscale analysis is sensitive to abrupt
edge steps, so dark/low-SNR stacking borders produce bright or dark edge artifacts. **Pure black
(exactly zero) edge pixels are fine, very dim non-zero or very bright ones must be cropped out
first.** So "crop before gradient work" is not hygiene here, it is a documented requirement.

**GUI label → `run_process` id, with defaults.** Introspected live 2026-07-26; every value the
manual states matches the installed process, so the ladder below is directly usable.

| Manual's label | `run_process` id | Default |
|---|---|---|
| Low threshold | `lowThreshold` | `0.2` |
| Low tolerance | `lowTolerance` | `0.5` |
| High threshold | `highThreshold` | `0.05` |
| High tolerance | `highTolerance` | `0` |
| Scale | `scale` | `5` |
| Smoothness | `smoothness` | `0.4` |
| Automatic convergence | `automaticConvergence` | `false` |
| Generate gradient model | `generateGradientModel` | `false` |
| Simplified Model | `useSimplification` | `false` |
| Model degree | `simplificationDegree` | `1` |
| Generate simplified model | `generateSimpleModel` | `false` |
| Structure protection | `protection` | **`true`** |
| Protection threshold | `protectionThreshold` | `0.1` |
| Protection amount | `protectionAmount` | `0.5` |
| Generate protection masks | `generateProtectionMasks` | `false` |

⚠️ **Structure protection is ON by default**, so ladder step 2 ("turn protection off to find the
High threshold") is an explicit `protection: false`, not a no-op.
⚠️ **`highTolerance` defaults to `0`**, the floor of its range, i.e. bright structures contribute
minimally to the model out of the box. The manual only says "the default value is generally
suitable" and never prints the number, so raising it is the documented move for *moderate*
under-correction, before reaching for High threshold.

Not in the manual at all, leave alone unless you have a reason: `simplificationScale` 1024,
`protectionSmoothingFactor` 16, `iterations` 15, `maxIterations` 10, `convergenceLimit` 1e-5,
`downsamplingFactor` 16, `gridSamplingDelta` 16, `lowClippingLevel` 7.63e-5, `reference` 0.5.

**Tuning ladder, in the manual's own order.** The decision axis is *which failure you are seeing*:

| Symptom | Move |
|---|---|
| Default result is fine | stop, this is the common case by design |
| Gradient not solved | **structure protection OFF**, simplified model ON at degree 1, re-apply; then raise the degree |
| Gradient still present | **raise High threshold** until background is flat (the manual's single most critical knob; examples go 0.05 → **0.4** on M101, → **0.8** on M42) |
| Overcorrection on the bright subject | protection ON, tune **protection threshold** (inspect the generated mask, it must cover the subject), then **protection amount** (up if outer subject regions are overcorrected, down if under) |
| Dark nebulae flattened | **lower Low threshold** (0.2 → 0.05 in the IC2087 example) to exclude them from the model |
| Bright halos around dark nebulae | **raise Low tolerance** (0.5 → 0.65), but expect contrast loss, pair it with the Low-threshold move above |
| Sharp/sudden gradient structure | **lower scale and smoothness** (5 → 2, 0.4 → 0.1), at the cost of overcorrecting smaller objects |
| Smooth gradient + large-scale nebulosity | **raise scale and smoothness**, preserves the faintest nebulosity |
| Protection is over-protecting (residual gradient under the subject) | **enable automatic convergence** (3-6 iterations), it fixed the Milky Way case at otherwise-default settings |

⛔ **Never use the simplified model when the "gradient" is natural**, e.g. the Milky Way filling one
side of the frame. The manual is explicit: you will always get signal loss.

✅ **This corroborates our R10 rule** (§4, "run the MINIMUM, never retry a converged pass"):
GradientCorrection "is always applied in a single step to the original image", and the manual's
prescribed way to explore parameters is a **full-image preview** (drag the view label onto the
grey band), not repeated applications to the real image. Independent vendor confirmation of a
rule we learned the expensive way.

⚠️ **Do not cite the manual's per-example summary lists.** They contradict their own prose in at
least two places (Example 3: body lowers Low threshold 0.2 → **0.1**, the summary says "0.2 to
**0.5**"; Example 5: body raises smoothness to **0.56**, the summary says **0.65**; Example 6's
protection line is garbled outright). Trust the prose.

*Source: `<PixInsight>/doc/tools/GradientCorrection/GradientCorrection.html`, doc compiler
1.7.3, 2026-05-22. Parameter ids + defaults verified live against the installed process
2026-07-26. The ladder itself is untested here, no GC run has yet been driven from it.*

---

## 5. Measurement traps that fire on any category

- **The histogram-peak stretch gate assumes ONE background population.** On a mosaic or any
  heterogeneous field it is bimodal and a global argmax jumps between peaks. Measure **per region**.
- **Gradient corner-spread has no honest reading on a nebula-filling field** (no corner is empty
  sky). Check per-channel plane asymmetry before believing it: a real dust ramp is strongly
  channel-dependent, an additive light-pollution ramp much less so.
- **Residual/speckle metrics must be normalised by LOCAL BACKGROUND.** Absolute speckle can halve
  while the result looks *noisier*, because removing a glow lowers the background beneath it.
- **Equal channel medians do NOT prove neutrality**, and the ±8% sky-band metric is only valid
  pre-stretch, and is not actionable at all when blank patches disagree in sign across the frame.
- **SCALAR background summaries are blind to antisymmetric chromatic ramps** (research-narrowed
  2026-07-26: a per-channel box-median MAP resolves them fine; what failed in R10 was reading only
  the scalar cornerSpread/whole-frame-spread numbers). A real warm-left/cyan-right ramp cancels in
  whole-frame averages. Checks in cost order: (1) **inspect the gradient tool's own background
  model / difference map** (the standard visual check); (2) the **per-channel sky-band X/Y
  PROFILE** (10-16 column/row bands, 40th-pct sky), professional practice states the criterion as
  *residuals flat across BOTH spatial dimensions with no trend in either*. ⚠️ The profile's
  *correction* has holes: mask coherent dark structure out of the fit; when subtracting a fitted
  model keep the level (subtract `model - median(model)`); and independent X + Y fits assume a
  SEPARABLE gradient, a true diagonal tilt needs a 2D fit.
  *Verified on: mono-LRGB `[live]` (R10: scalar metrics said flat while the r0 critic saw a 1.9x
  render ramp).*
- **"Flat enough" for a LIGHTNESS-CARRYING layer (L): peak-to-peak profile residual < 1% of sky,
  aim ~0.4%** (professional-reduction bar; research 2026-07-26). Structural reason: LRGB combine
  takes lightness from L, so L's gradient survives 1:1 while achromatic RGB gradients are
  discarded; and the stretch's near-black MTF slope ((1-m)/m ≈ 30-50x at autostretch midtones)
  makes small absolute residuals visible. R10: a 1.4% L ramp became the final's dominant ramp.
  *Verified on: mono-LRGB `[live]` (R10).*
- **Judge by the RENDER.** Where a metric and the render disagree, the render wins and the metric is
  the thing to fix.

---

## 6. Stretch discipline

The validated methodology currently lives in **`osc-hoo.md` steps 10-12** and has transferred
cleanly to OSC-RGB `[live]`. Until it is generalised here, read it from there regardless of your
category. Key invariants: end with the background peak in the target band (never over-black-point),
run an explicit **faint-signal survival check on the render** (`min > 0` is NOT preservation), and
treat saturation with restraint.
