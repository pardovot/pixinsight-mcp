# PixInsight Broadband OSC-RGB Natural-Color Processing Playbook (2025-2026)

> Provenance: 12-leg multi-agent web research (2025-2026 sources) + adversarial recency/evidence
> verification, cross-checked against primary docs read directly (PixInsight SPCC, MARS/MGC).
> Confidence + consensus/contested tags preserved. Anecdote/estimate values are flagged — drive
> those from image measurement.

**Scope:** ONE integrated RGB image from a one-shot-color (OSC) camera. Natural/documentary color via SPCC broadband + masked saturation. NO narrowband, NO palette mapping. StarXTerminator is an OPTIONAL branch, not a baseline step.

**Master sequence (linear-first, verified order):**
DynamicCrop → BXT (Correct Only) → ImageSolver (plate solve) → SPFC → MGC/MARS → SPCC → BXT (sharpen) → NXT → stretch → color/saturation → [optional] star split.

> **Order note:** plate solve must come AFTER DynamicCrop (cropping invalidates the WCS), and it feeds SPFC/MGC/SPCC. SPFC only if using MGC/MARS (MGC hard-requires SPFC flux metadata); with DBE/GraXpert/GradientCorrection instead, SPFC is optional.

---

## 1. DynamicCrop — remove edge artifacts · High · Consensus
- **Goal:** cut ragged black borders + thin low-SNR margins from dithered integration so they don't corrupt background/color modeling.
- **Settings:** Angle 0, Scale 1.0 (crop-only). STF-stretch a preview (or open the `rejection_low` map) to find edges; draw the box just inside all ragged/black edges. Extent is image-dependent — no universal pixel number.
- Manual DynamicCrop vs WBPP AutoCrop — same outcome; manual trims the low-SNR margin better.

## 2. BlurXTerminator "Correct Only" (early) · High · Consensus (necessity contested)
- **Goal:** correct optical aberrations/round stars on linear data → cleaner PSFs for the solver + tighter SPCC photometry.
- **Settings:** "Correct Only" checkbox (or Sharpen Stars=0, Sharpen Nonstellar=0). BXT can auto-estimate PSF.
- **Evidence:** author (RC Astro) reports "same or better dispersion in R/G, B/G SPCC fits" — a photometric metric. Modest, scales with aberration; skippable on well-corrected optics with round stars. No source says it harms.

## 3. ImageSolver — plate solve · High · Consensus
- **Goal:** write WCS. SPFC/MGC/SPCC read it and do NOT self-solve. Run AFTER crop (crop strips any solution).
- **Settings:** RA/Dec via Search button (bad coords fail *silently*). Focal length = effective FL. **Pixel size (µm): drizzle gotcha** — if drizzled ×N, divide sensor pitch by N (3.76 at ×2 → 1.88); wrong pixel size fails more than focal length. Install local Gaia DR3 XPSD (faster/offline). On failure: Noise Reduction=1, +1 Detection Scales, Gnomonic→Stereographic for wide fields.

## 4. SPFC (SpectrophotometricFluxCalibration) · High · Consensus · Conditional (only if MGC)
- **Goal:** put image on a physical flux scale + write flux metadata MGC consumes. Metadata only, no pixel/color change.
- **Settings:** QE = **Ideal QE curve**; sensor = your OSC chip + UV/IR-cut if listed else Ideal; white ref default; Gaia DR3/SP; linear, pre-gradient, plate-solved.
- MGC errors "target image lacks flux calibration metadata" without it (verified tool behavior).

## 5. MGC + MARS DR2 (gradient) · Medium · Consensus works / contested "best"
- **Goal:** remove gradients by comparing your flux-calibrated frame to the real MARS sky survey, not inferring from the image.
- **Settings (defaults then tune — single-source Stirling guidance):** MARS DB = **DR2** (~1.35 GB, v1.1.1, 1 Aug 2025; drop-in over DR1). Gradient Scale 256 (reaches corners; try 1024 on clean wide data). Structure Separation 3 (drop to 2/1 to reach corners). Model Smoothness 1.00 (raise 3–5 if wavy). Goal: model contains only gradient, not target.
- **Objectively better (one respect):** signal preservation — won't eat faint IFN/nebulosity like image-only models (ABE/DBE/GraXpert).
- **Contested:** vs GraXpert — situational; GraXpert sometimes removes a gradient more completely while MGC leaves a residual edge. Exact setting numbers are single-source. Fallback: GradientCorrection/DBE where uncalibrated/no MARS coverage.

## 6. SPCC — broadband, OSC natural color · High · Consensus
- **Goal:** physically-grounded natural color from Gaia DR3 BP/RP spectra (replaces PCC).
- **Settings:**
  - **Filters R/G/B = "Sony Color Sensor" (R,G,B)** — or your camera's dedicated color-sensor entry. These curves already include sensor QE.
  - **QE curve = "Ideal QE curve"** — critical OSC gotcha: color-sensor curves already include QE; a real QE curve double-counts. **Never combine a color-sensor filter curve with a real QE curve.**
  - White reference = **Average Spiral Galaxy** (documented natural-color standard). G2V only for sun-like-white intent.
  - Catalog = Gaia DR3/SP, auto limit magnitude (download DR3/SP locally).
  - Background Neutralization enabled; Region of Interest from a blank-sky preview. (BN limits ~ −2.80/+2.00 are from a secondary guide.) SPCC BN removes an additive cast — it is NOT gradient/LP removal.
- Official docs cite ~400% precision gain over PCC.

## 7. BlurXTerminator — main sharpen · Medium · Consensus (tuning = judgment)
- **Goal:** deconvolution sharpening on the linear, color-calibrated image (post-SPCC, pre-stretch), normal (not Correct-Only) mode.
- **Settings:** Automatic PSF ON for star-rich fields; manual PSF Diameter (measured FWHM ~2–8 px) only for sparse-star/long-FL/galaxy crops. **Sharpen Nonstellar ~0.90 default** (lower to 0.70–0.80 if worms/mottle/halos; ~0 for dense star fields). **Sharpen Stars ~0.25** (lower to 0.10–0.15 if AI4 harsh on small stars; many defer star sharpening to post-StarX). Apply **once**.
- AI4/2.0 = better model (linear processing, wider aberration coverage); applies to model quality, not a settings recipe. Tuning numbers are community judgment (RC Astro pages 403).

## 8. NoiseXTerminator — denoise · High · Consensus
- **Hard rules (author):** (1) **BXT before NXT** (BXT performs worse on de-noised data). (2) run NXT on the **combined RGB**, not per-channel.
- **Placement:** linear vs post-stretch is quality-equivalent (NXT internally auto-stretches/reverses) → efficiency preference. Optional light second post-stretch pass is fine.
- **Settings (tune via preview):** Denoise start 0.75–0.90 (1.0 = plastic); Detail ~0.15 (raise until fake structure, back off); **reduce color noise more than intensity** (key for natural color); lower LF denoise on dusty targets.
- **Version:** current NXT = **2 / AI3** (Feb 2025) — NOT "AI4" (that's BXT), not "v3" (a YouTuber label).

## 9. Stretch — linear → nonlinear · Medium · Contested (tool + target median)
- **Tools (no single best):** SetiAstro Statistical Stretch (fast one-click, hits a Target Median) · GHS (precise; place symmetry point to protect cores) · STF→HistogramTransformation / Masked Stretch (valid but legacy). **By 2025-2026 also consider MAS (MultiScale Adaptive Stretch, native) and VeraLux — now front-runners in head-to-head comparisons.** **STF is preview-only, not the final stretch.**
- **LINKED vs UNLINKED (key color decision):** after SPCC + neutral background, use **LINKED** (identical 3 channels) to preserve calibrated color ratios. UNLINKED only as a preview/rescue on uncalibrated/gradient-heavy data (shifts true color).
- **Target background median ~0.10–0.15 RGB** (community heuristic; 0.25–0.40 only for large faint extended targets). Measure the linear background first. Keep it gentle; add contrast later.

## 10. Color / Saturation (post-stretch) · High · Consensus (magnitude = preference)
- **Don't re-do color balance** — SPCC set it photometrically.
- **Background:** rely on SPCC's neutralization; run a separate BackgroundNeutralization only for residual cast — do NOT blindly chain SPCC-BN and the BN tool (different definitions, wildly different results).
- **Saturation — gentle + MASKED:** CurvesTransformation saturation channel (global) or ColorSaturation (hue-selective); **protection mask over dark background + bright star cores** (the key anti-chroma-noise/anti-clip move). No sourced numeric curve values — magnitude is target-dependent preference.
- **Target-type:** Galaxy → restrained, differential color (blue arms/yellow core), protect core. Broadband nebula → more aggressive OK. Star-field → moderate global saturation, light masking, very neutral background.

## 11. [OPTIONAL] Star handling — StarXTerminator split · High mechanics · Contested timing
*Optional branch, not baseline. Common for galaxies/broadband nebulae; often skipped for star-field images.*
- **Timing (contested):** author = as early as possible on LINEAR (best star color; use Subtraction, Unscreen OFF). Common practice = after gradient+color, often after initial stretch (cleaner separation, easier QC). Recent SXT (v2/AI11) **auto-detects** linear/nonlinear (manual "Linear" checkbox removed). If using GHS/arcsinh, remove stars BEFORE stretching.
- **Recombine:** SCREEN blend `~((~starless)*(~stars))` after both stretched — adds star light without clipping (consensus over plain addition).
- **Star reduction:** curve/multiply-down the stars image before screen, or MMT/MorphologicalTransformation + star mask.
- **SXT vs StarNet2:** SXT majority-preferred (fewer artifacts, better hole-fill) but image-dependent — not a clean objective win.

---

## What changed recently — and is it actually better?

| Change | Timeline | Verdict |
|---|---|---|
| **MGC + MARS** | MGC in PI 1.9.0; MARS **DR2 = 1 Aug 2025** (v1.1.1, ~1.35 GB) | Objectively better for **signal preservation** where MARS covers + flux-calibrated. DR2>DR1 is a factual drop-in upgrade. vs GraXpert = contested; additive, not a full DBE replacement. |
| **SPFC→MGC→SPCC sequence** | 2024-25 | Enables MGC's flux footing (required). For pure aesthetic color, **SPFC is optional** (SPCC alone suffices). "Better than legacy DBE+PCC" is too absolute — DBE still valid where no WCS/flux-cal. |
| **SPCC over PCC** | mature | Objectively better (per-star Gaia spectra vs broadband B-V; ~400% precision). Consensus standard. |
| **BXT 2.0 / AI4** | Dec 2023 → current | Objectively better model (linear processing, wider aberration). Model quality, not a settings recipe. |
| **NXT 2 / AI3** | Feb 2025 | Objectively better architecture (decouples large-scale-noise vs faint-detail). Author-sourced. **Not "AI4"/"v3".** |
| **StatStretch / MAS (native) / VeraLux** | 2023-25 | Preference/convenience, not a higher ceiling. MAS + VeraLux now also front-runners. |

**Bottom line:** BXT/NXT/MARS "newer = better" is real (architecture/coverage). The **color pipeline is NOT** a newer-is-better story — SPCC remains the standard; SPFC adds rigor but is optional for aesthetic color.

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
MGC exact default numbers (single-source, 403); BXT star-sharpen 0.10–0.15 / nonstellar 0.70–0.80 (community judgment); SPCC BN limits −2.80/+2.00 (secondary guide); target background median 0.10–0.15 (community heuristic); StatStretch shipped default Target Median (unsourced — do not fabricate).
