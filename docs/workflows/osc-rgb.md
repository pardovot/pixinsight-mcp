# PixInsight Broadband OSC-RGB Natural-Color Processing Playbook (2025-2026)

> Provenance: 12-leg multi-agent web research (2025-2026 sources) + adversarial recency/evidence
> verification, cross-checked against primary docs read directly (PixInsight SPCC, MARS/MGC).
> Confidence + consensus/contested tags preserved. Anecdote/estimate values are flagged, drive
> those from image measurement.

> **Multi-panel?** Read **`mosaic.md`** alongside this file. It is a cross-cutting *stage*
> playbook (panel combination), not a separate category: gradient + colour calibration stay
> per-panel, assembly happens while linear, and everything from BXT-sharpen onward runs once on the
> merged mosaic using the steps below unchanged. Verified on a 2-panel OSC-RGB target (R9).

**Scope:** ONE integrated RGB image from a one-shot-color (OSC) camera. Natural/documentary color via SPCC broadband + masked saturation. NO narrowband, NO palette mapping. StarXTerminator is an OPTIONAL branch, not a baseline step.

**Master sequence (linear-first, verified order):**
DynamicCrop → BXT (Correct Only) → ImageSolver (plate solve) → SPFC → MGC/MARS → SPCC → BXT (sharpen) → NXT → stretch → color/saturation → [optional] star split.

> **Order note:** plate solve must come AFTER DynamicCrop (cropping invalidates the WCS), and it feeds SPFC/MGC/SPCC. SPFC only if using MGC/MARS (MGC hard-requires SPFC flux metadata); with DBE/GraXpert/GradientCorrection instead, SPFC is optional.

---

## 1. DynamicCrop, remove edge artifacts · High · Consensus
- **Goal:** cut ragged black borders + thin low-SNR margins from dithered integration so they don't corrupt background/color modeling.
- **Settings:** Angle 0, Scale 1.0 (crop-only). STF-stretch a preview (or open the `rejection_low` map) to find edges; draw the box just inside all ragged/black edges. Extent is image-dependent, no universal pixel number.
- Manual DynamicCrop vs WBPP AutoCrop, same outcome; manual trims the low-SNR margin better.

## 2. BlurXTerminator "Correct Only" (early) · High · Consensus (necessity contested)
- **Goal:** correct optical aberrations/round stars on linear data → cleaner PSFs for the solver + tighter SPCC photometry.
- **Settings:** "Correct Only" checkbox (or Sharpen Stars=0, Sharpen Nonstellar=0). BXT can auto-estimate PSF.
- **Evidence:** author (RC Astro) reports "same or better dispersion in R/G, B/G SPCC fits", a photometric metric. Modest, scales with aberration; skippable on well-corrected optics with round stars. No source says it harms.

## 3. ImageSolver, plate solve · High · Consensus
- **Goal:** write WCS. SPFC/MGC/SPCC read it and do NOT self-solve. Run AFTER crop (crop strips any solution).
- **Settings:** RA/Dec via Search button (bad coords fail *silently*). Focal length = effective FL. **Pixel size (µm): drizzle gotcha**, if drizzled ×N, divide sensor pitch by N (3.76 at ×2 → 1.88); wrong pixel size fails more than focal length. Install local Gaia DR3 XPSD (faster/offline). On failure: Noise Reduction=1, +1 Detection Scales, Gnomonic→Stereographic for wide fields.

## 4. SPFC (SpectrophotometricFluxCalibration) · High · Consensus · Conditional (only if MGC)
- **Goal:** put image on a physical flux scale + write flux metadata MGC consumes. Metadata only, no pixel/color change.
- **Settings:** QE = **Ideal QE curve**; sensor = your OSC chip + UV/IR-cut if listed else Ideal; white ref default; Gaia DR3/SP; linear, pre-gradient, plate-solved.
- MGC errors "target image lacks flux calibration metadata" without it (verified tool behavior).

## 5. MGC + MARS DR2 (gradient) · Medium · Consensus works / contested "best"
- **Goal:** remove gradients by comparing your flux-calibrated frame to the real MARS sky survey, not inferring from the image.
- **Settings (defaults then tune, single-source Stirling guidance):** MARS DB = **DR2** (~1.35 GB, v1.1.1, 1 Aug 2025; drop-in over DR1). Gradient Scale 256 (reaches corners; try 1024 on clean wide data). Structure Separation 3 (drop to 2/1 to reach corners). Model Smoothness 1.00 (raise 3-5 if wavy). Goal: model contains only gradient, not target.
- **Objectively better (one respect):** signal preservation, won't eat faint IFN/nebulosity like image-only models (ABE/DBE/GraXpert).
- **Contested:** vs GraXpert, situational; GraXpert sometimes removes a gradient more completely while MGC leaves a residual edge. Exact setting numbers are single-source. Fallback: GradientCorrection/DBE where uncalibrated/no MARS coverage.
- **⚠ MGC silently DECLINES where MARS lacks coverage, clean signal: `executeOn` returns `false` (no exception) and stats are byte-identical [R8, dec −24 Rho Oph].** MARS DR2's far-southern (<−15°) coverage is thin; at dec −24 MGC declined even with the table bound correctly and the `.xmars` present. → **fall back to `GradientCorrection`** (`protection:true, protectionThreshold:0.1, protectionAmount:0.5, scale:5, smoothness:0.4`, R8: halved the corner-median ramp AND preserved the central nebula, protection kept it from eating signal). Note SPFC is then wasted work (only MGC needs it), a MARS-coverage probe *before* SPFC would save the step.

## 6. SPCC, broadband, OSC natural color · High · Consensus
- **Goal:** physically-grounded natural color from Gaia DR3 BP/RP spectra (replaces PCC).
- **Settings:**
  - **Filters R/G/B = "Sony Color Sensor" (R,G,B)**, or your camera's dedicated color-sensor entry. These curves already include sensor QE.
  - **QE curve = "Ideal QE curve"**, critical OSC gotcha: color-sensor curves already include QE; a real QE curve double-counts. **Never combine a color-sensor filter curve with a real QE curve.**
  - White reference = **Average Spiral Galaxy** (documented natural-color standard). G2V only for sun-like-white intent.
  - Catalog = Gaia DR3/SP, auto limit magnitude (download DR3/SP locally).
  - Background Neutralization enabled; Region of Interest from a blank-sky preview. (BN limits ~ −2.80/+2.00 are from a secondary guide.) SPCC BN removes an additive cast, it is NOT gradient/LP removal.
- Official docs cite ~400% precision gain over PCC.

## 7. BlurXTerminator, main sharpen · Medium · Consensus (tuning = judgment)
- **Goal:** deconvolution sharpening on the linear, color-calibrated image (post-SPCC, pre-stretch), normal (not Correct-Only) mode.
- **Settings:** Automatic PSF ON for star-rich fields; manual PSF Diameter (measured FWHM ~2-8 px) only for sparse-star/long-FL/galaxy crops. **Sharpen Nonstellar ~0.90 default** (lower to 0.70-0.80 if worms/mottle/halos; ~0 for dense star fields). **Sharpen Stars ~0.25** (lower to 0.10-0.15 if AI4 harsh on small stars; many defer star sharpening to post-StarX). Apply **once**.
- AI4/2.0 = better model (linear processing, wider aberration coverage); applies to model quality, not a settings recipe. Tuning numbers are community judgment (RC Astro pages 403).

## 8. NoiseXTerminator, denoise · High · Consensus
- **Hard rules (author):** (1) **BXT before NXT** (BXT performs worse on de-noised data). (2) run NXT on the **combined RGB**, not per-channel.
- **Placement:** linear vs post-stretch is quality-equivalent (NXT internally auto-stretches/reverses) → efficiency preference. Optional light second post-stretch pass is fine.
- **Settings (tune via preview):** Denoise start 0.75-0.90 (1.0 = plastic); Detail ~0.15 (raise until fake structure, back off); **reduce color noise more than intensity** (key for natural color); lower LF denoise on dusty targets.
- **Version:** current NXT = **2 / AI3** (Feb 2025), NOT "AI4" (that's BXT), not "v3" (a YouTuber label).

## 9. Stretch, linear → nonlinear · Medium · Contested (tool + target median)
- **Tools (no single best):** SetiAstro Statistical Stretch (fast one-click, hits a Target Median) · GHS (precise; place symmetry point to protect cores) · STF→HistogramTransformation / Masked Stretch (valid but legacy). **By 2025-2026 also consider MAS (MultiScale Adaptive Stretch, native) and VeraLux, now front-runners in head-to-head comparisons.** **STF is preview-only, not the final stretch.**
- **LINKED vs UNLINKED (key color decision):** after SPCC + neutral background, use **LINKED** (identical 3 channels) to preserve calibrated color ratios. UNLINKED only as a preview/rescue on uncalibrated/gradient-heavy data (shifts true color).
- **Target background median ~0.10-0.15 RGB** (community heuristic; 0.25-0.40 only for large faint extended targets). Measure the linear background first. Keep it gentle; add contrast later.
- **⚠ The OSC-RGB nonlinear half was UNVALIDATED until R8, borrow the OSC-HOO GHS methodology** (`osc-hoo.md` steps 10-12: over-black-point gate, faint-survival check on the render, judge-by-render). It transferred cleanly. **R8 first datapoint (Rho Oph, nebula-filling, post-SPCC bg median ~0.00026, very compressed):** native GHS pass-1 `stretchType:0, SP=0.00022, b=4, D=7` → mode 0.17 but **MILKY** (same R5 failure mode). De-milk that worked: a **gentle `CurvesTransformation` K S-curve** (pull the floor down, brighten the nebula) then a **moderate S-channel saturation** (~1.35×), judged on the render at each step. ⚠ **These curve/sat points are a per-object datapoint, NOT a law** (same open objective-function gap as OSC-HOO R5/R6). The OSC-RGB nonlinear half still wants its own research/validation pass, do not hardcode R8's curves.

## 10. Color / Saturation (post-stretch) · High · Consensus (magnitude = preference)
- **Don't re-do color balance**, SPCC set it photometrically.
- **Background:** rely on SPCC's neutralization; run a separate BackgroundNeutralization only for residual cast, do NOT blindly chain SPCC-BN and the BN tool (different definitions, wildly different results).
- **Saturation, gentle + MASKED:** CurvesTransformation saturation channel (global) or ColorSaturation (hue-selective); **protection mask over dark background + bright star cores** (the key anti-chroma-noise/anti-clip move). No sourced numeric curve values, magnitude is target-dependent preference.
- **Target-type:** Galaxy → restrained, differential color (blue arms/yellow core), protect core. Broadband nebula → more aggressive OK. Star-field → moderate global saturation, light masking, very neutral background.
- **SCNR, protection method matters more than amount [R9, measured on-image] · High · contradicts a common forum claim.** Gate on `gex = G − (R+B)/2 > 0` (NOT "G ≥ both R and B", which misses the case where R is a hair above G while G sits well above the midpoint, R9 `gexRel` was **+0.17** and read visibly olive while the old gate said skip).
  - ⛔ **Use a NEUTRAL method** (`AverageNeutral`=2 default, or `MaximumNeutral`=3). **Never the mask methods** (`MaximumMask`=0, `AdditiveMask`=1) on a field with real colour diversity.
  - Neutral is `G' = Min(G, 0.5(R+B))`, which is **self-gating**, a no-op wherever green is already at/below the midpoint. R9: Hα arc **4.6°→4.6°** and blue sky **240.9°→240.9°**, byte-identical, while the dust went 60.8°→45.5° (gold).
  - Mask is `G' = G×[1 − a(1−m)]`, scaling green down **unconditionally everywhere**. R9 `MaximumMask@0.5`: Hα arc → **335.2°**, blue sky → **280.1°**, whole region magenta on the render. Matches the PixInsight doc's own warning about a magenta sky cast. **"Clipping" is surgical; "scaling" touches everything.**
  - Linear vs post-stretch placement: post-stretch is ~3° more aggressive (Jensen, for a concave stretch the midpoint computed after stretching is lower); both are identical no-ops where green is legitimately low. Minor axis, either defensible.
  - **A residual `gex > 0` after SPCC is EXPECTED and physical:** airglow is dominated by the **OI 557.7 nm** green line and mercury LP has a strong **546.1 nm** line, both landing in the green channel; OSC adds **RGGB's 2x green photosites** (different debayer interpolation). Photometric calibration fixes *stellar* colour, not an additive green-weighted **sky pedestal**, and a nebula-filling field gives background neutralization no true blank sample. ⚠️ Magnitude is still diagnostic: R9's **80.9%** of pixels above the midpoint (mean excess 0.046) is large enough to warrant investigating the upstream cause, not just clamping. **The airglow/LP part applies to MONO equally** (see the note in `mosaic.md`-adjacent categories); only the debayer term is OSC-specific.

## 11. [OPTIONAL] Star handling, StarXTerminator split · High mechanics · Contested timing
*Optional branch, not baseline. Common for galaxies/broadband nebulae; often skipped for star-field images.*
- **Timing (contested):** author = as early as possible on LINEAR (best star color; use Subtraction, Unscreen OFF). Common practice = after gradient+color, often after initial stretch (cleaner separation, easier QC). Recent SXT (v2/AI11) **auto-detects** linear/nonlinear (manual "Linear" checkbox removed). If using GHS/arcsinh, remove stars BEFORE stretching.
- **Recombine:** SCREEN blend `~((~starless)*(~stars))` after both stretched, adds star light without clipping (consensus over plain addition).
- **Star reduction:** curve/multiply-down the stars image before screen, or MMT/MorphologicalTransformation + star mask.
- **SXT vs StarNet2:** SXT majority-preferred (fewer artifacts, better hole-fill) but image-dependent, not a clean objective win.
- **Star stretch (if split), tool-agnostic, applies to broadband too:** single MTF (SetiAstro Star Stretch replay: PixelMath `((3^a)*$T)/((3^a-1)*$T+1)` + the **mandatory** ColorSaturation pass) by **measured star-PIXEL median** (not the ≈0 layer median), verify at **1:1**. See `osc-hoo.md` step 12 for the full method. [R8: satAmount=1.2 → colorful stars on Rho Oph, dec-toward-galactic-center = orange-dominant, astrophysically correct.]
  - **R8 amount calibration (per-object, NOT a default):** a=4.5 = too soft (my first pass); the user's own harder stretch = too hard; the measured midpoint **a=5.4** (star-pixel p90 landed exactly between) was close but the user still wanted it **slightly softer** → sweet spot ≈ **a≈5.0-5.2** for Rho Oph. Confirms the OSC-HOO rule "start near the measured a, push harder, confirm at 1:1" but shows the ceiling, too hard inflates faint noise-stars. Match by star-pixel **p90** (bright-star brightness), not just count.
- **Star COLOR correction, gated + measured [R8; metric CORRECTED in R9].** After the star stretch, measure the star pixels and apply **only what fires**. Both branches are gated on the same axis, green vs the R-B midpoint:
  - **(a) green EXCESS**, `gex = G − (R+B)/2 > 0` → `SCNR` green (Average Neutral).
  - **(b) green DEFICIT**, `gdef = (R+B)/2 − G > 0` → **`invert → SCNR green → invert`**.
  - ⛔ **R9: do NOT gate branch (b) on "magenta" (`R>G && B>G`, i.e. G is the minimum channel).** That was the R8 operationalization and it MISSES the common case. On Rho Oph the defect was a green deficit *without* magenta (`B < G < (R+B)/2`): the magenta test read **0.17%** ("skip") while the red-fringe test read **74.2%** of lit pixels. Applying (b) took red fringe **74.2% → 1.0%** and the user confirmed the visible "reddish bulbs" disappeared.
  - **Why (b) is near-always safe on a STARS layer:** the op reduces algebraically to **`G_new = max(G, (R+B)/2)`**, a **no-op wherever green already sits at/above the midpoint**. A smooth continuum puts G at ~the midpoint, so a green deficit on a continuum source is non-physical by construction (mirror of the nebula `gex` argument). Verified on the reddest object in frame: **Antares hue 29.7°→30.0°, sat 0.700→0.702** (its G=0.419 vs midpoint 0.421, i.e. already on the line). Blue stars gained slight saturation. → on **broadband, stars layer**, treat (b) as **default ON**, with the gate as a magnitude sanity check rather than permission.
  - ⛔ **HARD EXCLUSION, emission lines (not red stars).** Where red is Hα rather than continuum, G is *legitimately* far below the midpoint. Measured on the Sh2-9 arc in the R9 **starless**: R 0.414 / G 0.357 / B 0.355, midpoint 0.385 > G, so (b) would lift G by 0.027 and bleach real Hα. **Never apply (b) to narrowband/duoband data, nor to any starless containing emission nebulosity.** Stars-layer-only is the physically correct scope: stars are continuum sources, emission nebulae are not.
  - Star-color gates are **per-image, never inherited**: Panel 1 fired magenta (37.5%), Panel 2 fired green (20.6%), the R9 mosaic fired green (30.2%), same rig and session.
  - **Green haze lives on the STARS layer AND the STARLESS [R8, user].** The green/teal haze around bright blue stars is primarily a **star-layer** phenomenon (apply SCNR green there), but a matching teal haze in the **reflection nebula / around blue stars in the starless** is also real, a **gated, careful SCNR green** on the starless is legitimate too (it purifies teal→blue; Average Neutral only edits the green channel, so it can't reduce blue). Use with care and measure the **green excess** `gex = G−(R+B)/2 > 0` on the true haze pixels (the region mean is blue-dominated so it reads ≤0, check the localized halos), and judge on the render. Not a default step either place.

---

## What changed recently, and is it actually better?

| Change | Timeline | Verdict |
|---|---|---|
| **MGC + MARS** | MGC in PI 1.9.0; MARS **DR2 = 1 Aug 2025** (v1.1.1, ~1.35 GB) | Objectively better for **signal preservation** where MARS covers + flux-calibrated. DR2>DR1 is a factual drop-in upgrade. vs GraXpert = contested; additive, not a full DBE replacement. |
| **SPFC→MGC→SPCC sequence** | 2024-25 | Enables MGC's flux footing (required). For pure aesthetic color, **SPFC is optional** (SPCC alone suffices). "Better than legacy DBE+PCC" is too absolute, DBE still valid where no WCS/flux-cal. |
| **SPCC over PCC** | mature | Objectively better (per-star Gaia spectra vs broadband B-V; ~400% precision). Consensus standard. |
| **BXT 2.0 / AI4** | Dec 2023 → current | Objectively better model (linear processing, wider aberration). Model quality, not a settings recipe. |
| **NXT 2 / AI3** | Feb 2025 | Objectively better architecture (decouples large-scale-noise vs faint-detail). Author-sourced. **Not "AI4"/"v3".** |
| **StatStretch / MAS (native) / VeraLux** | 2023-25 | Preference/convenience, not a higher ceiling. MAS + VeraLux now also front-runners. |

**Bottom line:** BXT/NXT/MARS "newer = better" is real (architecture/coverage). The **color pipeline is NOT** a newer-is-better story, SPCC remains the standard; SPFC adds rigor but is optional for aesthetic color.

## Contested / open decisions
1. MGC vs GraXpert (community split; MARS coverage dependent).
2. BXT Correct-Only necessity (modest, skippable on clean optics).
3. SPFC in aesthetic-only workflow (required for MGC, optional for color).
4. DynamicCrop manual vs WBPP AutoCrop.
5. BXT star-sharpen value / whether to sharpen stars in main pass.
6. NXT linear vs post-stretch (quality-equivalent).
7. Stretch tool + target median (StatStretch/GHS/MAS/VeraLux; preference).
8. SXT timing linear-early vs nonlinear-after; whether to split at all.
9. Separate BackgroundNeutralization vs SPCC built-in.
10. White reference for pure star-fields.
11. SXT vs StarNet2 (image-dependent).
12. Saturation magnitude (no sourced numbers).

## Unverified specifics (do not treat as gospel)
MGC exact default numbers (single-source, 403); BXT star-sharpen 0.10-0.15 / nonstellar 0.70-0.80 (community judgment); SPCC BN limits −2.80/+2.00 (secondary guide); target background median 0.10-0.15 (community heuristic); StatStretch shipped default Target Median (unsourced, do not fabricate).
