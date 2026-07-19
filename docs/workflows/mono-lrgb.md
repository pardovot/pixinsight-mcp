> Provenance: 11-leg multi-agent web research (2025-2026) + adversarial recency/evidence verification. Builds on docs/workflows/mono-rgb.md (RGB spine). Confidence/consensus/contested tags preserved; anecdote/estimate values flagged. Playbook body is the verbatim research synthesis.

# MONO-LRGB PixInsight Processing Playbook

*Assumes the RGB color image is already built and calibrated per the standard mono-RGB workflow (per-channel calibration → registration → ChannelCombination → plate-solve → SPCC while linear). This playbook covers only what LRGB adds: the separate L-track, the combine step, RGB-track deltas, and star/color handling. L never goes through SPCC.*

---

## Two Live Debates — Resolved Up Front

### 1. Is a separate L still worth shooting in the BXT era?
**Answer: Leaning YES, but the value has narrowed — target-dependent, not universal.**

- **Objective (physics):** A broadband/clear/L filter passes far more of the visible spectrum than any single R/G/B filter, so for a *fixed total integration time* it collects more photons → higher luminance SNR. Because human vision resolves luminance detail far more acutely than color, concentrating photons in L yields a sharper, cleaner result. **BXT cannot manufacture SNR that was never captured**, so a deep L gives deconvolution and denoise better raw material — BXT and a strong L are *complementary, not substitutes*.
- **What narrowed it:** modern low-read-noise, high-QE CMOS shrinks the per-filter SNR penalty; BXT recovers resolution so well the sharpness edge of a dedicated L is smaller; synthetic/extracted L from deep RGB + BXT/NXT can approach dedicated-L results with one fewer filter.
- **Verdict:** L still adds real value for **detail/resolution-limited targets (galaxies, fine structure, faint halos) and bright-sky sites**. The advantage is largest when L integration exceeds RGB; at equal exposure it becomes marginal and mostly preference. Whether the acquisition/processing overhead is "worth it" is preference/target-dependent.
- **Confidence: medium. Consensus: contested.**

### 2. Linear vs Nonlinear LRGBCombination?
**Answer: Combine NONLINEAR (both L and RGB stretched first) — the documented default. Linear combine is a legitimate but unproven minority path.**

- **Objective:** LRGBCombination's lightness/saturation transfer math and built-in chrominance NR are defined on stretched (nonlinear) data; linear combine is a known failure mode for the stock tool. This is tool design, not taste.
- **Contested edge:** A growing minority injects luminance via **PixelMath / CIE L\* channel swap** in linear or single-stretch form, arguing a more physically consistent color/luminance ratio. This is preference/experimental, **not** established consensus.
- **Note (honesty):** No claim here that "nonlinear is objectively best in all cases" — only that it is the tool's intended, documented, mainstream path. The *heavy per-track work* (gradient, BXT/decon, denoise) stays **linear**; only the fuse is nonlinear.
- **Confidence: medium. Consensus: consensus on the default; the linear alternative is contested.**

---

## L-TRACK (process L on its own, in parallel with RGB)

### L-1. Register + Crop
- **Goal:** L and RGB align pixel-for-pixel (LRGBCombination does *no* internal registration; per-pixel luminance substitution turns any misalignment into color fringing/halos, doubled star edges, detail-vs-color offset).
- **Process:** StarAlignment all four masters (L,R,G,B) to **one shared reference** — conventionally the highest-SNR master (usually L, most robust star matches). Enable distortion correction / adequate control points so field distortion matches across filters/nights. Apply **one identical crop** (DynamicCrop) to L and RGB from the common valid-data intersection — never crop by eye independently.
- **Rule:** Verify L and RGB share identical dimensions + WCS after any BXT/resample before combining. Even sub-pixel shift shows as chromatic edge fringing.
- **Confidence: high (tool mechanics). Consensus.** *(Reference-frame choice is the only preference element; any consistently-shared reference works.)*

### L-2. Gradient / Background Removal (linear)
- **Goal:** Flat neutral background only (no color calibration — L bypasses SPCC).
- **Process:** **GradientCorrection** (2024+ DBE/ABE successor, preferred for complex gradients) or classic **DBE** (valid, manual sample control). Run on the **linear** L, **before** BXT/stretch.
- **Rules:** Independent pass on L (do not share samples/model with RGB — L is a separate master with its own vignetting/LP gradient). DBE correction type = **Subtraction** (gradients are additive). An uncorrected L gradient dominates the final image post-combine, so flatten L at least as carefully as color.
- **Confidence: medium. Consensus.** *(GradientCorrection-vs-DBE is preference. Numeric params are object-dependent — not prescribed.)*

### L-3. Deconvolution / Sharpening — **on L, linear, once**
- **Goal:** Concentrate detail recovery where SNR lives.
- **Process:** **BlurXTerminator** on the **linear** L master, after gradient removal, before denoise/stretch. Modern replacement for classical Deconvolution (no PSF image, star mask, or local-support/deringing fiddling). **Do NOT** run BXT on the combined LRGB or on stretched data — BXT assumes linear input; post-stretch use produces halos/artifacts.
- **Suggested L settings (BXT v2, match known defaults — verify live):**
  - Auto PSF: **on**
  - Sharpen Non-Stellar: **~0.70–0.90** (default 0.90; back off to **0.5–0.7** if L is undersampled/noisy or shows worming/over-crisp artifacts)
  - Sharpen Stars: **~0.25–0.50**
  - Adjust Star Halos: slightly **negative** if halos remain
  - Apply **once** per image.
- **Rule:** Non-stellar strength is imager-dependent (sampling, seeing, SNR) — not a fixed number.
- **Confidence: medium. Consensus** on "sharpen L not final LRGB, linear, once." *(BXT-vs-classical decon is broad aesthetic-AP consensus, not universal objective truth. "Separate L near-mandatory" is an overclaim — it's advantageous, not mandatory.)*

### L-4. Denoise (linear, after BXT)
- **Goal:** Preserve the resolution L is contributing.
- **Process:** **NoiseXTerminator**, applied **lightly/conservatively** on the L track (L carries the detail — over-denoising L destroys the LRGB advantage). Typically after BXT, before/right after stretch.
- **Rule (direction is objective, magnitude is preference):** L gets a *lighter* touch than RGB. See LRGB-1 for the full split.
- **Confidence: medium. Consensus** on direction. *(NXT-after-BXT is a reasonable default, not a settled order — denoise-first has real practitioner support.)*

### L-5. Stretch (separate track)
- **Goal:** Optimize L purely for detail + dynamic range; bring L to a brightness that matches the RGB luminance it will replace.
- **Process:** HistogramTransformation / GHS / STF-based stretch, **independent** of RGB.
- **Brightness-match rule (mechanical, objective):** LRGBCombination *substitutes* L for the RGB's own luminance. If L is much **brighter** than the replaced RGB luminance → washed-out/desaturated result. If much **darker** → over-saturated/dim. Target: match L's background/median and highlight rolloff to ~the stretched RGB luminance. Many deliberately keep L *slightly under-stretched* to protect saturation (recovering it later via the Saturation slider or CurvesTransformation). Exact target is preference.
- **Confidence: medium. Consensus.**

---

## LRGBCombination Step

### Timing
Both L and RGB **nonlinear (stretched)** and brightness-matched. See Debate #2. Sequence:
1. RGB spine: SPCC while linear → stretch RGB (own path)
2. L track: gradient → BXT → NXT → stretch (own path)
3. **LinearFit L to RGB luminance** (or match stretches) so brightness matches
4. LRGBCombination — both nonlinear

### Settings
Core sliders range 0–1, default **0.50**, and are **counterintuitive: LOWER value = STRONGER effect.**

| Control | Value | Why |
|---|---|---|
| Application domain | **Nonlinear**, brightness-matched | Prevents luminance-color mismatch (muddy/dark or washed regions) |
| Lightness slider | ~**0.50**; lower (0.40–0.45) pushes **more** L in (brighter/more detail); raise to hold L back (some use 0.55–0.60 to reduce L dominance in highlights / protect star cores) | Balances L transfer |
| Saturation slider | Lower to ~**0.40–0.45** | LRGB inherently desaturates (luminance replacement flattens color); lower slider **increases** retained saturation |
| Chrominance Noise Reduction | Common practice: **OFF**, use dedicated NXT/masked MMT on RGB before combine; enable only for quick cleanup of noisy RGB | External chroma NR gives more control |
| Transfer functions / Layers | **Defaults** (L\*a\*b\*) | Wavelet layers only affect built-in chroma NR |
| Pre-combine | LinearFit L→RGB luminance; pre-boost RGB saturation (CurvesTransformation) | Match brightness; offset desaturation |

**Better desaturation fix:** pre-boost RGB saturation *before* combine and/or re-saturate after, rather than relying on the slider alone.

**Alternative method:** **PixelMath / CIE L\*a\*b\* channel swap** — convert RGB to L\*a\*b\*, replace L\* with the luminance master, convert back. Purer luminance swap, less built-in desaturation, more manual. Genuine methodology split — both defensible; LRGBCombination preferred for integrated controls, PixelMath-LAB for maximum control.

- **Confidence: medium (settings low). Consensus** on nonlinear + brightness-match + slider inversion; slider *numbers* are illustrative preference.

---

## DELTAS to the RGB Track (given an L exists)

The presence of L **relaxes** the RGB track — RGB only carries color (low-frequency chroma), so it needs to be clean and correctly colored, **not sharp**.

- **Unchanged (the calibration spine):** per-channel gradient removal, ChannelCombination, plate-solve, **SPCC** — all exactly as standalone mono-RGB. SPCC is unaffected by L; L never sees SPCC. Color-calibrate RGB **before** LRGBCombination.
- **Delta 1 — Depth/SNR:** RGB can be shallower/noisier; lower per-channel SNR is acceptable (chroma is low-frequency, L dominates perceived detail).
- **Delta 2 — Binning/resolution:** RGB commonly binned/softened (fine color detail isn't visible). *(Somewhat dated with modern CMOS; degree is preference.)*
- **Delta 3 — Sharpening:** Heavy decon belongs on L. RGB gets a **light BXT or none** — its value on RGB is *star tightening* (matching L star sizes, avoiding combine halos), not detail recovery. Running BXT on RGB at all is a mild preference split; both camps agree aggressive decon stays on L.
- **Delta 4 — Denoise:** Push RGB **harder** than a detail-bearing image (softening chroma is invisible after L combines in). Objectively grounded in luminance/chrominance perceptual asymmetry (same reason JPEG/video chroma-subsample).
- **Delta 5 — Saturation:** Can be pushed harder on RGB (not also carrying luminance).
- **Confidence: medium. Consensus** on doctrine; binning degree and RGB-BXT are preference.

---

## Star & Color Handling under LRGB

**Problem:** L transfer replaces RGB lightness. Bright star cores in L are near-saturation → after transfer, star centers read white, desaturating colored RGB cores. Broadband L star profiles are often larger/bloated → halos.

**Mitigations (rough consensus order):**
1. **Brightness-match L to RGB before combine** + use the Lightness slider (raise toward 0.55–0.60 to weaken L transfer in highlights) rather than raw 0.5.
2. Reduce saturation loss via the Saturation slider; keep chroma NR modest so color isn't smeared.
3. **Star-separated / starless workflow (strongest, ascendant 2024–2026 method):** StarXTerminator splits **both** L and RGB into starless + stars; run LRGBCombination only on the **starless** layers; recombine the **RGB stars** (full color, correct profile) via screen/PixelMath. Stars never receive the L lightness → **structural guarantee** of star-color preservation (not a tuning tradeoff). Cost: more steps, possible recombination seams if star removal is imperfect.
4. Alternatively: build L without/reduced stars before combining, or protect star cores with a star mask.
5. Pre-boost RGB saturation before combine (some deliberately over-saturate RGB stars).
6. Ensure RGB is SPCC-calibrated before combine so star colors are physically correct going in.

- **Confidence: medium. Consensus.** Star-separation is *objectively* better for star color (stars never see L); raising Lightness only *reduces*, never eliminates, core whitening. "Newer is better" here applies **only** to star-color fidelity, at the cost of workflow complexity.

---

## (a) What Changed Recently — and Is It Actually Better?

| Change | Better? | Evidence strength |
|---|---|---|
| **BXT on the linear L** replacing classical/EZ Deconvolution (2023→2026 standard) | **Yes, objectively** — PSF-derived, corrects aberrations + mild undersampling, avoids ringing/star-mask failure modes; applied on highest-SNR L where it works best | Broad AP consensus |
| **NXT** per-track replacing MultiscaleLinearTransform/TGVDenoise + often replacing LRGBCombination's built-in Chrominance NR | **Yes** for control; more targeted | Trend/common practice, not documented consensus |
| **GradientCorrection** (2024+) as DBE/ABE successor | Better for complex gradients; DBE still adequate | Consensus tool exists; choice is preference |
| **Synthetic/extracted L + BXT** narrowing the dedicated-L gap | **Partially** — competitive on well-integrated RGB, but cannot replace real photons a deep L collects | Contested |
| **Star-separated LRGB** (StarXTerminator) | **Yes, for star-color fidelity only**; adds complexity | Ascendant, logic-backed |
| **PixelMath/L\* luminance injection** replacing LRGBCombination | **Not established** — preference/experimental | Contested minority |

**Newer is NOT automatically better:** BXT narrowed but did not eliminate L's photon/SNR advantage; it did not overturn the nonlinear-combine default.

---

## (b) CONTESTED / Open Decisions

1. **Separate dedicated L vs pure-RGB + synthetic L** in the BXT era (biggest open debate; target/site/camera/time-budget dependent).
2. **Linear vs nonlinear LRGBCombination** — nonlinear is the documented default; linear/PixelMath-L\* injection is unproven minority.
3. **LRGBCombination vs PixelMath/CIE-L\* channel swap** — genuine methodology split.
4. **BXT on RGB or not** (star tightening vs skip) — mild preference.
5. **Denoise order** (NXT-after-BXT vs denoise-first) — both have support.
6. **Any denoise on the *combined* LRGB** — gentle final pass vs skip to protect L detail.
7. **Built-in Chrominance NR vs external NXT on RGB** — trend toward external, not settled consensus.
8. **RGB binning degree** — SNR-vs-color-resolution tradeoff; dated with modern CMOS.
9. **Exact slider/BXT numeric values** — all imager/data-dependent preference.

---

## (c) Consolidated needsBrowser List

**Sourcing caveat:** This playbook is synthesized from established, long-stable PixInsight/RC-Astro domain knowledge. **No claim was freshly citation-verified** — every source below was blocked this session (WebSearch budget 200/200 exhausted; repeated HTTP 403 / SSL / TLS failures). Numeric settings match known defaults but are **unverified live**. Treat the contested verdicts as directional, and confirm the following before finalizing:

- `https://pixinsight.com/doc/tools/LRGBCombination/LRGBCombination.html` — linear/nonlinear requirement; Lightness/Saturation/Chrominance-NR slider semantics
- `https://pixinsight.com/doc/tools/StarAlignment/StarAlignment.html` — distortion model, control points, output geometry
- `https://pixinsight.com/doc/tools/GradientCorrection/GradientCorrection.html` — GradientCorrection params
- `https://pixinsight.com/doc/tools/DynamicBackgroundExtraction/DynamicBackgroundExtraction.html`
- `https://pixinsight.com/tutorials/LRGB/index.html` — official LRGB tutorial
- `https://www.rc-astro.com/resources/BlurXTerminator/Usage/` and `/software/bxt/` — L settings, linear-input, before/after-combine placement, v2 defaults
- `https://www.rc-astro.com/noisexterminator/` — NXT placement guidance
- `https://www.rc-astro.com/blurxterminator/` — luminance/deconvolution/resolution-recovery statements
- `https://www.lightvortexastronomy.com/tutorial-combining-monochrome-rgb-and-lrgb-images.html` (+ related LRGB/luminance tutorials) — combine workflow, brightness-matching, denoise ordering
- `pixinsight.com/forum` + Cloudy Nights (2024–2026) — linear-vs-nonlinear combine, PixelMath luminance injection, BXT-on-luminance, separate-L-worth-it threads

**Highest-priority verifications:** (1) linear-vs-nonlinear LRGBCombination current consensus; (2) 2025–2026 community position on separate-L worth-it; (3) BXT v2 default slider values.