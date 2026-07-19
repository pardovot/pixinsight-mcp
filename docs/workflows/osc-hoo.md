# OSC-HOO (Duoband) PixInsight Processing Playbook
### Evidence-consolidated, current for PixInsight 1.9.x / mid-2026

> Provenance: 12-leg multi-agent web research (2025-2026 sources) + adversarial recency/evidence
> verification, cross-checked against primary docs read directly (PixInsight MARS/MGC, SPCC,
> RC Astro). Confidence + consensus/contested tags are preserved. Numeric values that are
> anecdote/estimate (not authoritatively sourced) are flagged — drive those from image measurement.

**Core rule:** the stack stays **ONE RGB image** end to end. A duoband filter already maps Ha into red and OIII into green+blue, so the calibrated RGB *is* an HOO image — no ChannelExtraction/recombination is required. Any channel split noted below is an explicit, optional "split-for-control" detour, never the baseline.

**Primary-source anchors (confirmed directly):**
- SPCC narrowband emission lines: Hα 656.0, [OIII] 500.7, [SII] 674.2, [NII] 658.4, Hβ 486.1 nm.
- OSC/color camera → SPCC/SPFC QE curve = **Ideal QE Curve** (color sensor response already embedded).
- MGC = observational additive gradient correction using the MARS all-sky reference (Gaia = multiplicative). Requires plate solve + SPFC metadata.
- SPCC requires an RGB image (cannot run on a single mono channel).

---

## Recommended order (linear → color → nonlinear)

1. DynamicCrop (edge trim)
2. BlurXTerminator — Correct Only
3. ImageSolver (plate solve)
4. SPFC (only if using MGC)
5. MGC + MARS (gradient)
6. SPCC — Narrowband mode
7. BlurXTerminator — main sharpening pass
8. NoiseXTerminator
9. StarXTerminator (linear) → split starless/stars
10. Stretch (starless + stars separately)
11. HOO color shaping (SCNR + curves)
12. Star recombination (screen / relinearization)

**Why this order:** SPFC writes flux metadata that MGC *requires* (hard error otherwise); MGC/SPFC/SPCC all consume the plate-solve WCS, so solving precedes all three. BXT correct-only precedes the solve so solver + SPCC see clean PSFs. BXT sharpen and NXT run on linear data, NXT *after* BXT. SXT pulled to linear so stars/nebula stretch independently.

---

## Step 1 — DynamicCrop (edge trim) · Consensus · High
- **Goal:** remove ragged/partial-coverage integration borders so they don't bias background models, statistics, or the STF.
- **Process:** DynamicCrop. Scale X/Y = 1.000, Rotation = 0 (crop, not resample).
- **Decision rule:** inspect all edges/corners under STF autostretch; set the rectangle a few px inside any dark/feathered borders. Amount is image-specific. If edges are clean, it's optional/framing.

## Step 2 — BlurXTerminator "Correct Only" · Consensus · High
- **Goal:** correct PSF aberrations so the solver + SPCC per-star flux are clean. No sharpening yet.
- **Settings:** Correct Only = checked (sharpening auto-disabled).
- **Decision rule:** run if stars show corner aberration/chromatic fringing, or for mosaics/max SPCC consistency. On clean single-panel data it's optional, minimal downside.
- **Contested:** necessity only — author documents "same or better" SPCC dispersion; gain can be small. No source argues against it.

## Step 3 — ImageSolver (plate solve) · Consensus · High
- **Goal:** write WCS. SPCC/SPFC/MGC do NOT self-solve and error without it. Run once.
- **Settings:** pixel size (accurate, µm); focal length (approx OK); auto limiting magnitude On; local Gaia DR3 XPSD if installed; distortion/spline correction On for wide/fast optics.
- **Decision rule:** on failure, verify focal length + pixel size and re-run; tune limiting mag only if needed.

## Step 4 — SPFC (SpectrophotometricFluxCalibration) · Consensus · Medium · Conditional
- **Goal:** write flux metadata (`PCL:SPFC:ScaleFactors`). Pixels unchanged. **Hard prerequisite for MGC.**
- **Settings:** Device/Sensor = your OSC chip or **Ideal QE Curve**; astrometric solution required; leave numeric params at defaults.
- **Skip if** you use DBE/GraXpert/GradientCorrection instead of MGC.
- **⚠ Caveat:** the "no Ha/OIII declaration needed / broadband star photometry regardless of duoband" sub-claim is thinly sourced; SPFC shares SPCC's NB-filter mode and a duoband passes stars only in Ha/OIII. Forum reports of NB mode ignored on OSC — verify on your version.

## Step 5 — MGC + MARS (gradient) · Consensus · Medium
- **Goal:** remove gradients via the external MARS all-sky reference (doesn't eat real IFN/nebulosity like sample-based DBE).
- **Settings:** split channels = **NO**; MARS DB = **DR2** (~1.35 GB); Model Smoothness default **1.00** (raise 3–5 if background wavy); Structure Separation default **3** (drop to 2/1 to reach corners, then raise Smoothness). Gradient Scale: *anecdotal 256–1024* — not a hard default.
- **Decision rule:** success = flat background, NO dark rings around bright objects, faint nebulosity preserved. Keep DBE/GradientCorrection as fallback where MARS coverage is thin (far-southern).
- **⚠** "recovers IFN DBE flattened" is qualitative community reports, not controlled tests → Medium confidence.

## Step 6 — SPCC, Narrowband mode · Consensus · Medium
- **Goal:** physically-based color calibration on the single linear RGB image; yields teal-OIII / gold-Ha balance.
- **Settings:** Narrowband filters mode; **R = 656.3 nm (Hα)**, **G = 500.7 nm (OIII)**, **B = 500.7 nm (OIII)** — physical lines, not filter marketing center. **G & B must be entered identically (wavelength AND bandwidth) — the single most important rule.** White reference = **Photon Flux** (for emission-line-proportional color). QE = **Ideal** (OSC). Bandwidth = filter per-line FWHM:
  - L-eXtreme 7/7/7 · L-Ultimate 3/3/3 · Antlia ALP-T 5nm 5/5/5 · ALP-T 3nm 3/3/3
  - L-eNhance (triband, NOT clean HOO) ~R10/G24/B24 — **UNSOURCED estimate, cautious**
  - Unknown FWHM → SPCC default 3 nm (low-sensitivity, acceptable).
- **Decision rule:** don't alter central wavelengths to tune color; fix color downstream (stretch/SCNR).
- **Contested:** Photon-Flux vs galaxy-default white ref is partly aesthetic; exact bandwidth (3/5/7) is low-sensitivity vs the equal-G/B rule (that insensitivity is lore, unmeasured).

## Step 7 — BlurXTerminator, main sharpen · Consensus · Medium
- **Goal:** deconvolve/sharpen on linear data, after gradient + color, before stretch.
- **Settings:** linear stage; Automatic PSF Enabled (disable only for starless frames); **Sharpen Nonstellar ≈ 0.50–0.75** (below ~0.90 default — often too aggressive on smooth HOO); **Sharpen Stars ≈ 0.25 or lower**; apply once.
- **Decision rule:** at 1:1, worms/mottle/dark-rings on nebulosity → lower Nonstellar; dark halos on stars → lower Stars; preview 0.50/0.75/0.90, pick highest with no artifacts.
- AI4/2.0 is objectively better than AI2 (author-documented). The Nonstellar reduction is taste.

## Step 8 — NoiseXTerminator · Consensus · High
- **Goal:** denoise linear RGB, after gradient/color, **after BXT**.
- **Settings:** linear stage, after BXT; Denoise ~**0.80–0.90** *(single-review datapoint, tune per image)*; Detail inactive on AI3 (matters only on AI2, keep ≤20–30); optional mask to protect faint OIII.
- **Non-negotiable:** NXT after BXT (deconvolution needs linear, non-denoised input). Linear-vs-post-stretch placement is near-identical (NXT internally stretches/reverses) → preference.

## Step 9 — StarXTerminator (linear) → starless/stars · Consensus · High
- **Goal:** remove stars while linear so starless + stars process/stretch independently.
- **Settings:** SXT linear/pre-stretch (preserves star cores). Stars = original − starless (linear).
- **HOO star color:** duoband stars can be magenta/teal — consider rebuilding "natural" stars (or a separate RGB/broadband star exposure) to add onto the finished starless nebula.
- Author + 2025-26 consensus favors early/linear SXT; post-stretch still works (mild contest).

## Step 10 — Stretch (starless + stars separately) · Contested (tool) · Medium
- **Tools:** GHS or SetiAstro Statistical Stretch as primary; HistogramTransformation/Curves to refine. **STF is preview-only — never the final stretch.**
- **Settings:** Statistical Stretch target median default 0.25 is often too bright → start **~0.12–0.18**; post-stretch background median target **~0.08–0.15** (up to ~0.20 for large bright nebulae). Keep RGB linked unless a strong cast forces unlinked. Stretch starless + stars-only separately.
- **Decision rule:** measure linear background median on an object-free preview first; drive values from your histogram, don't copy numbers.
- **Genuinely contested:** HT vs GHS vs Statistical Stretch — preference/image-dependent. Only agreed-inferior option: direct-STF-as-final.

## Step 11 — HOO color shaping (SCNR + curves) · Contested · Medium
- **Goal:** collapse raw red+cyan into the gold/teal HOO look, in place.
- **Settings:** SCNR Green: Average Neutral, amount 1.0 (post-stretch) to strip green cast; optional in-place PixelMath (uncheck single-expression; `$T[0]=R/Ha`, `$T[1]=G`, `$T[2]=B/OIII`) to lift a little OIII into green (red→gold) or balance G/B for teal; mild Curves saturation + small hue rotation. **Values by eye — no canonical numbers.**
- **Decision rule:** Statistics — if green median ≥ red/blue in nebula, SCNR Green 1.0 warranted; else skip/reduce.
- **Contested:** SCNR after SPCC violates "don't alter hue after calibration" — treat as a deliberate artistic step (most OSC-duoband imagers do it). The richer Foraxx dynamic gold/teal is documented only via a split mono route; in-place is an approximation — and its aesthetic superiority is **preference, not proven**.

## Step 12 — Star recombination · Consensus (timing) · Contested (math) · High
- **Screen (traditional default):** PixelMath `~(~starless * ~stars)`.
- **Relinearization/additive (NightPhotons):** HT midtones = 0.999 on both → `Stars + Starless` → HT midtones = 0.001.
- Avoid plain `Stars + Starless` on nonlinear data (clips cores).
- **Decision rule:** if bright cores clip/bloat → switch additive→screen/relinearization; magenta/teal stars → rebuild from neutral source first.
- No objective winner among screen/relinearization/additive — preference + data state.

---

## What changed recently — and is it actually better?

| Change | When | Verdict |
|---|---|---|
| **MGC/MSGC + MARS** | PI 1.9.0 (2024); MARS **DR2** (2025/26, ~1.35 GB, deeper+broader north) | **Objectively better** for gradients (external Ha/OIII reference doesn't eat nebulosity). Now standard. IFN-recovery support is qualitative. |
| **SPFC→MGC→SPCC sequence** | 2024-25, evolving | Situationally better (reproducibility/photometric honesty); aesthetic gain on HOO is preference. Mandatory only with MGC. NB-mode-on-OSC reliability is a known friction point. |
| **BXT AI4 (2.0)** | **Dec 2023** (not 2025) | Objectively better (direct linear processing; independent stellar/nonstellar). Only 2025 BXT news = standalone CLI. |
| **NoiseXTerminator 2 / AI3** | Feb 2025 | Detail slider inert; Denoise only. Placement vs stretch near-identical. |
| **SetiAstro Suite Pro** | Feb 2025 | Preference/convenience; no evidence it beats PI-native equivalents. |
| **Stretch tools (Stat Stretch 2.0, VeraLux, MAS)** | 2024-25 | Not proven better than GHS/HT — subjective. Statistical Stretch's real edge is speed/ease. |

**Recency traps:** BXT AI4 mis-cited as 2025 (it's Dec 2023). MARS DR2 far-southern (<−15) coverage weaker than its confirmed northern gains — DBE/GradientCorrection stays southern fallback.

---

## Contested / open decisions
1. BXT Correct-Only necessity (skippable on clean single-panel).
2. SPFC necessity (only with MGC).
3. SPFC/SPCC NB-mode reliability on OSC (verify per version).
4. SPCC white reference: Photon Flux vs galaxy default (aesthetic).
5. SPCC bandwidth 3/5/7 nm (low-sensitivity vs equal-G/B rule).
6. BXT Sharpen Nonstellar amount (taste).
7. NXT linear vs post-stretch (near-identical; only "after BXT" is fixed).
8. Stretch tool (GHS vs Stat Stretch vs HT; STF-as-final is the only agreed-inferior).
9. SCNR after SPCC (artistic, against doctrine).
10. In-place vs split HOO color (Foraxx = preference).
11. Star recombination math (no objective winner).
12. MARS coverage for far-southern targets.

## Confidence summary
High: crop, BXT correct-only, plate solve, SXT timing, NXT-after-BXT rule.
Medium: SPFC, MGC/MARS, SPCC-NB, BXT sharpen, stretch, HOO color (parameters image-dependent / partly preference).
No numeric setting above is invented; unsourced values (MGC 256–1024, NXT 0.80–0.90, L-eNhance bandwidths, curve/saturation values) are flagged as anecdote/estimate → drive from image measurement.
