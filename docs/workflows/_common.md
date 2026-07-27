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

⚠️ **`gex > 0` is NECESSARY, NOT SUFFICIENT. On a CONTINUUM source it fires on legitimately warm
colour, so it needs a second, physical test.** Yellow *means* `G > (R+B)/2` by construction, so the
inequality alone cannot distinguish real warm colour from a green cast.

**Axis: continuum source, or emission source?**

| Source | Physical constraint | How to read it |
|---|---|---|
| **Continuum** (stars, galaxy bulge/disc, elliptical companions) | any old/warm stellar population gives `R > G > B` | ⛔ **`G >= R` is a HARD FAIL: that is a green cast, whatever `gex` says.** Use `G vs R`, not `gex`, as the discriminator |
| **Emission** (Hα region) | `G` sits legitimately far *below* the midpoint | never lift G, see the branch-(b) exclusion in §3 |

⛔ **"SCNR would bleach my warm object" is FALSE, and believing it cost a run a correct step.**
SCNR-neutral is `G' = min(G, 0.5(R+B))`: it edits **only G** and leaves R and B untouched, so
**`R − B`, the entire warm-vs-cool signal, is mathematically preserved.** It cannot desaturate a
yellow core; it removes only the green component that makes yellow read olive/lime. The
emission-line HARD EXCLUSION belongs to branch **(b)**, which *raises* G, do **not** transfer that
caution to branch (a).
*Verified on: OSC-RGB galaxy `[live]` (R11, M31). The agent skipped SCNR on the starless, arguing the
core's `gexRel +3.0%` was "legitimate yellow" for a warm bulge. But M110 measured
R 0.472 / **G 0.482** / B 0.422, i.e. **G above R**, non-physical for an elliptical's integrated
light; core and outer arm read `gexRel +3.0%` and `+3.3%`. The user's `SCNR` green, AverageNeutral,
**amount 1.0**, applied post-recombine, took every region to `gexRel <= 0.11%`, drove `G−R` properly
negative (core −0.029), and the user judged it clearly better. The `G vs R` test would have fired
immediately; `gex > 0` alone did not.*

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

⛔ **BOTH branches are CLAMPS, so verify them by RESIDUAL FRACTION + WORST CASE, never by the mean.**
A correctly applied clamp drives the violating population to ~zero **by construction**. At
`amount < 1` it only moves G part of the way, so a large outlier survives while the average looks
cured. **Acceptance test: `% of lit pixels still violating` and the `worst-case relative deficit`.**
*Verified on: OSC-RGB `[live]` (R11). The agent ran branch (b) at amount 0.3, measured the mean
relative deficit improving −4.28% → −0.96%, and accepted it. Re-measured afterwards: **51.3% of lit
star pixels were still green-deficient, worst case 80.5%, and 14,989 pixels above 0.35 brightness
carried >18% deficit** - the user saw a purple star. The residual fraction had barely moved
(53.6% → 52.7%), which was the number that mattered and was visible in the original measurement.
The user's fix was a **second full invert-SCNR pass**, taking the residual to 3.1%.*

⛔ **And render the mandatory 1:1 star check AT THE MEASURED WORST-CASE LOCATION**, not at a region
you picked for looking nice. The same measurement that gates the step already returns the
coordinates; use them. R11 rendered a clean field at (4250-5150, 2080-2720) and passed the step
while the offender sat elsewhere.

⚠️ **Deficit-branch strength cap on BROADBAND (research 2026-07-26):** the invert-SCNR-invert
technique is sourced from narrowband magenta-star repair; on broadband the clamp `G >= (R+B)/2`
sits ~on the blackbody locus, so at amount 1.0 it starts desaturating the REDDEST stars, exactly
the reddened background stars a dark-nebula field should keep. Cap the inverted pass at
**amount 0.3-0.5** on broadband, and treat a STRONG post-SPCC magenta cast as a symptom to
diagnose first (calibration, chromatic aberration, or star-layer floors, R10's cause WAS the
floors) rather than clamp away. (R10 ran it at 1.0 pre-correction; datapoint, not a default.)

⚠️⚠️ **SUPERSEDED, the 0.3-0.5 cap is NOT the default. `amount = 1.0` is** [user directive, R11].
**Default `amount = 1.0` for both SCNR branches, and especially on the STARS layer.** Reserve
0.3-0.5 for the deliberate case where you only want to *slightly* tone something down, and say why.

Why the cap was wrong as a default: it came from a research *inference* (that the clamp sits on the
blackbody locus, so amount 1.0 would desaturate the reddest stars) that was **never measured
on-image**. On R11 amount 0.3 left **51.3%** of lit star pixels green-deficient with an **80.5%**
worst case, the user saw the residual purple star, and their own fix was a **second full-strength
pass**. Both branches are self-gating no-ops wherever the channel is already on the correct side of
the midpoint, which is precisely why full strength is safe by default: it clamps only what violates.
*User, 2026-07-26: "running SCNR in most cases should be at 1 ... especially for stars, I believe 1
is the right value."* The reddest-star desaturation risk is still worth **checking** after the fact
(measure the reddest star in frame), it is just not a reason to start below 1.0. Journal R11.

✅ **CLOSED, the cap's premise is not merely unmeasured, it is IMPOSSIBLE. [R12, measured + proved]**
R12 ran the measurement R11 asked for, at amount **1.0** on a heavily reddened broadband field:
saturation of the ten reddest stars in frame went **UP on every one** (0.804→0.874, 0.771→0.830,
0.887→0.904, 0.616→0.690, …), never down. Acceptance at 1.0: green deficit **64.5% → 1.56%**,
worst-case relative deficit 98.8% → 50.8%, worst excess 3446% → 15.1%, **0%** of lit pixels left
above 20% relative excess.
**The proof:** both branches clamp G toward `(R+B)/2`, and that midpoint always lies between R and
B. So **G stays the MIDDLE channel**; `max` and `min` are untouched and saturation `(max−min)/max`
is **invariant**. The operation moves hue only and *cannot* desaturate a star. (Saturation rose
because `preserveLuminance` rescales.) → the reddest-star check is now a formality, not a gate.

⛔ **Run BOTH branches when both gates fire. Population size is not permission. [R12]** R12 skipped
the excess branch because the deficit population was larger (64.5% vs 35.5%) and shipped a **pure
green star**: one pixel measured R 0.006 / G 0.501 / B 0.047, with the worst excess at **34x** the
R-B midpoint. Gate each branch on its own **magnitude** (worst case + residual fraction), never on
which population has more pixels.

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
- ⛔ **HOW TO BUILD A MASK, and when not to use one at all `[live]` (R11, learned the hard way).**
  A hand-rolled `clip((mean(RGB)−k)/w)` on **raw luminance** is the wrong construction and it cost
  R11 a wrecked image. Two failure modes:
  1. **The transition zone lands inside the noisy background** → the mask *is* a noise map, and the
     effect gets modulated per pixel by noise. R11 used threshold 0.21 while the sky's own
     luminance tail reached **0.246** (set thresholds from the background's **p99**, never its
     median).
  2. **Using a mask where it does not help, and not using one where it does.** R11 masked only
     *saturation* (which needed no mask) while trying to separate galaxy from background with a
     **global** tone curve, which necessarily stretches the sky and amplifies its grain. That is
     backwards: the tonal separation is what wants a mask.
  ✅ **The correct construction, as used by the EZ Processing Suite**
  (`EZProcessingSuite/EZ_Common.js`, `createBackgroundMask` → `doBackgroundRangeSelection`):
  **extract lightness** (`ChannelExtraction`, CIELab L) → **`RangeSelection`** with
  **`fuzziness 0.1`, `smoothness 5`** (the smoothing is the load-bearing part, it removes the
  per-pixel noise modulation) and **`highRange = the lightness median`** (measured, not hand-picked)
  → apply **inverted** to act on the object and protect the background.
  ⚠️ `ChannelExtraction.prototype.CIELab` is **undefined** in the watcher's bare context; use the
  static `ChannelExtraction.CIELab` (= 2).
  **And if the background is already compressed by the tone curve, you may not need a mask at all**:
  R11 v4's sky chroma came out at 0.0070, low enough that a plain **global** saturation boost was
  safe. Reach for a mask when the measurement says you need one.
- ⛔ **EVERY tone curve has a FORCED compression cost, and it lands on your detail. Compute it
  before you apply the curve** `[live, R11, controlled measurement]`. A curve that lifts `m → m'`
  and must still pass through `(1,1)` has an average slope above the pivot of **`(1−m′)/(1−m)`**,
  which is below 1 by construction. A curve applies **one slope to structure and detail alike** at a
  given level, so that deficit is paid directly out of star peaks and faint knots.
  **Gate: if `(1−m′)/(1−m) < ~0.85`, the lift is too big for a single curve, split it.**
  *R11's rejected curve: `(1−0.665)/(1−0.55) = 0.744`; the accepted reference: `0.852`.*
  ✅ **`HDRMultiscaleTransform` is the escape, because it separates by SCALE, not level.** Measured
  on one image with the SAME large-scale range compression applied both ways:
  HDR took bulge/disk 2.178 → 2.065 with small-scale detail **+4.4%**; an equivalent curve took it
  to 2.093 with detail **−7.5%**. A 12-point swing for the same range change.
  → **Take the lift from HDR, then place levels with a gentle curve, and alternate.** HDR keeps
  refilling the headroom so no single curve has to compress hard. ⚠️ **Prevent, do not repair**:
  once a curve has flattened the detail, more HDR does not bring it back (R11: 0.732 → 0.737 while
  noise rose 1.81% → 2.01%).
- ⛔ **A LUMINANCE curve with slope > 1 changes SATURATION too, and in BOTH directions.** It
  amplifies channel *differences* where the slope is steep and compresses relative chroma where the
  output level rises. So a contrast/separation curve silently re-colours the image: measure
  saturation before and after **every** tone curve, not just after saturation steps.
  *Verified on: OSC-RGB `[live]` (R11 v3). A background/galaxy separation curve pushed the SKY's
  saturation 0.0250 → 0.0405 (visibly more chroma noise) while simultaneously compressing the
  object's chroma (bulge 0.1006 → 0.0885). One S-curve through one mask cannot fix both, it needs a
  signal-masked boost plus a sky-masked reduction.*
- ⚠️ **Set a signal mask's threshold from the SKY's upper luminance tail, not its median.** On R11 v3
  the sky's median was 0.138 but its **p99 reached 0.246**, so a mask starting at 0.21 was quietly
  boosting background chroma noise. Threshold 0.27 fixed it. Measure the background's p99 first.
- ⚠️ **A masked local enhancement cannot be judged by a region MEAN.** DarkStructureEnhance moved the
  dust-lane region mean only −1.2% while doing ~−21% at the lane cores, because its mask peaks at
  ~0.49 and sits near 0 over most of the region. Read a 1:1 before/after crop (snapshot first), or
  measure only the high-mask pixels. *Verified on: OSC-RGB `[live]` (R11 v2).*
- ⛔ **"Was the colour preserved?" CANNOT be answered from region MEDIANS on a field with a global
  cast. Measure the STRUCTURE colour. [R12, this error was made TWICE in one run]** The median of a
  region is the SKY; the nebulosity is *structure inside* that region, and averaging buries it. On
  R12 the region median said colour was fine (and even improving) while the actual Hα structure had
  been inverted from red to cyan.
  **The right measure:** split the region by LUMINANCE (not by colour, that is circular), exclude
  stars, and take `(bright population − dark population)` per channel. That difference IS the colour
  of the structure. Measured on R12's disputed region: `structure R/G` was **1.547** in the linear
  starless input and **0.917** in the delivered image, while the region median moved barely at all.
  A related trap: on a globally R-deficient field, an **absolute** `rex>0` warm/cool test reports the
  region as "99.6% cool" and contradicts the obvious warm dust, because dust that is warmer than its
  surroundings is still absolutely below the midpoint. **Warm/cool must be judged RELATIVE to the
  local population.** *Verified on: OSC-RGB `[live]` (R12).*
- ⛔ **Gated saturation ops MULTIPLY. Do colour in ONE measured step. [R12]** R12 applied 6-8
  individually "gentle" gated saturation adjustments across a run (an S-curve plus boosts gated at
  L>0.40, L>0.20, L>0.50, L>0.13, plus a colour-match pass). Their luminance gates OVERLAP, so the
  factors compound: roughly **x2.6** in the overlapping bands. Each was verified in isolation; none
  was ever measured **cumulatively** against a reference until the end, by which point the image was
  badly over-cooked. **Rule: track cumulative saturation against a target, and prefer one measured
  colour step over a sequence of small gated nudges.**
- ⛔ **Do NOT stack shadow-compressing `CurvesTransformation` K curves. [R12, measured]** The **K**
  channel applies the same curve to R, G and B **individually**. Where one channel sits
  systematically below the others, it lands further down the compressive part of *each* curve and is
  crushed relative to them. R12 stacked two tone curves and drove the dark population to
  **R 0.043 / G 0.166 / B 0.176**, inverting red structure to cyan (structure R/G 1.716 → 1.087).
  One curve was survivable; two were not.
  → **Use a single CIE-**`L`** curve for tone** (`Lt`), which preserves chrominance by construction:
  swapping the stacked K curves for one L curve restored the dark population to R 0.135 / G 0.165
  and structure R/G to 1.361. Or shape the channels deliberately with per-channel R/G/B curves.
- **Judge by the RENDER.** Where a metric and the render disagree, the render wins and the metric is
  the thing to fix.

---

## 6. Stretch discipline

The validated methodology currently lives in **`osc-hoo.md` steps 10-12** and has transferred
cleanly to OSC-RGB `[live]`. Until it is generalised here, read it from there regardless of your
category. Key invariants: end with the background peak in the target band (never over-black-point),
run an explicit **faint-signal survival check on the render** (`min > 0` is NOT preservation), and
treat saturation with restraint.
