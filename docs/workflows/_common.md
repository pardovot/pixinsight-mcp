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
- **BXT before NXT.** BXT performs worse on de-noised data (author's rule).
- **BXT Correct-Only early, sharpening late.** On multi-input work (mosaic panels, mono channels),
  correct aberrations per input *before* combination and sharpen *once* after.
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
