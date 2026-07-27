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
- ⚠️ **"Restrained" is not "absent" [R11].** R11 read as gray-cream at core saturation 0.0535 and **two independent blind critics flagged it**, "blue arms barely distinguishable from the inner disk", which is this row's own stated goal unmet. A masked S-curve to core 0.0837 / arms 0.164 / dust 0.270 fixed it with background saturation **unchanged** (0.0182 → 0.0183, bgChroma 0.0282 → 0.0282), and the user still wanted "slightly more". **The luminance-mask trick is what makes this safe** (mask `clip((mean(RGB)−0.24)/0.12)` over a bg at ~0.20): it protects background chroma noise completely. Cost to know: it also lifts chroma noise inside low-signal dust lanes. Magnitude remains preference, but the *floor* is higher than R11 assumed.

## 10b. [TECHNIQUE] DarkStructureEnhance, for dust lanes · user-taught (R11) · unvalidated numerically
**`Utilities > DarkStructureEnhance`** (`$PXI_SRCDIR/scripts/misc/DarkStructureEnhance.js`). The user
applied it to M31's final and it "looks beautiful" on the dust lanes. Read directly from source:
- **Mechanism.** Builds a mask, then darkens *through* it. The mask is: duplicate the target →
  `ATrousWaveletTransformV1` with **only the residual (largest) layer enabled** (so the copy holds
  just large-scale structure) → `PixelMath` **`largeScale − original`**, which is positive exactly
  where a pixel is *darker than its large-scale surroundings*, i.e. dust lanes and dark nebulae →
  `ConvertToGrayscale` → `Rescale` → a light `ATrousWaveletTransform` noise-reduction pass.
  Then `doDark`: a `HistogramTransformation` with **RGB/K midtones = `median`** applied through that
  mask, `iterations` times. Midtones **above 0.5 darkens**, so it deepens only dark structure and
  leaves the bright object alone.
- **Defaults (from `DarkMaskLayersData`):** `numberOfLayers 8`, `scalingFunction 1`,
  `extractResidual true`, `toLumi false`, **`median 0.7`**, `iterations 1`, `viewMask false`.
  More layers removed → larger structures selected by the mask. `median` is the strength dial
  (0.5 = no-op, higher = darker); `iterations` stacks it.
- **Driving it headless:** it is a **modal-dialog script**, so replay its worker functions
  (`doMask` / `doDark` with a `DarkMaskLayersData`-shaped object) via `run_script`, the same pattern
  as SetiAstro Star Stretch. Do **not** `#include` (the watcher's V8 eval breaks on `#`).
- ✅ **RUN AND VALIDATED on M31 [R11 v2].** Driven headless exactly as above. **Two passes at
  `median` 0.70 then 0.75, `numberOfLayers 8`, `iterations 1`** gave visibly deeper, better-separated
  dust lanes without a crunchy look; the v2 blind gate independently reported "dust lanes are finely
  resolved with **no ringing along the lane edges**". Applied to the **starless**, after SCNR + tone
  + saturation, before recombine.
- ⚠️ **A single default pass is nearly invisible; and region-average metrics will lie to you.** One
  pass at 0.70 moved the dust-lane region mean only **−1.2%**. That is a *measurement* artifact, not
  a weak effect: the mask peaks at ~0.49 and is ~0 over most of the region, so at the lane cores the
  local effect is ~−21% while the average is diluted. **Judge DSE on a 1:1 before/after crop
  (snapshot first), never on a region mean.**
- ✅ **Verify the mask first with `viewMask: true`.** On M31 it lit the lane filaments and was black
  over the bulge, M110 and M32, with only a ~0.004 noise floor in the background - exactly the
  intended selection.
- ⛔ **Driving it via eval records history as `Script` with an EMPTY `filePath`, so the step does NOT
  survive into an exported `.xpsm`.** Any run using DSE needs `replay.js` as its real reproducer.
- **SCNR, protection method matters more than amount [R9, measured on-image] · High · contradicts a common forum claim.** Gate on `gex = G − (R+B)/2 > 0` (NOT "G ≥ both R and B", which misses the case where R is a hair above G while G sits well above the midpoint, R9 `gexRel` was **+0.17** and read visibly olive while the old gate said skip).
  - ⛔ **ON A GALAXY, `gex > 0` IS NOT ENOUGH, use `G vs R` [R11, cost a correct step].** A warm stellar population *necessarily* has `G > (R+B)/2`, so the gate fires on legitimate yellow and cannot discriminate. The physical test is `R > G > B`: **`G >= R` on any continuum source (bulge, disc, elliptical companion) is a hard fail.** R11 skipped SCNR on M31's starless reasoning the core's `gexRel +3.0%` was real yellow, while **M110 measured G (0.482) ABOVE R (0.472)** - impossible for an elliptical. See `_common.md` §2.
  - ⛔ **SCNR-neutral CANNOT bleach a warm core.** `G' = min(G, 0.5(R+B))` edits only G, so **`R−B` is preserved exactly**; it removes only the green that makes yellow read olive. R11's "it would bleach the core" objection was provably wrong: the user's SCNR green at **amount 1.0** took core/M110/arm from `gexRel +3.0/+7.2/+3.3%` to `<=0.11%`, made `G−R` properly negative, and read clearly better. **A galaxy field is a strong candidate for SCNR, not a reason to skip it.**
  - ⛔ **Use a NEUTRAL method** (`AverageNeutral`=2 default, or `MaximumNeutral`=3). **Never the mask methods** (`MaximumMask`=0, `AdditiveMask`=1) on a field with real colour diversity.
  - Neutral is `G' = Min(G, 0.5(R+B))`, which is **self-gating**, a no-op wherever green is already at/below the midpoint. R9: Hα arc **4.6°→4.6°** and blue sky **240.9°→240.9°**, byte-identical, while the dust went 60.8°→45.5° (gold).
  - Mask is `G' = G×[1 − a(1−m)]`, scaling green down **unconditionally everywhere**. R9 `MaximumMask@0.5`: Hα arc → **335.2°**, blue sky → **280.1°**, whole region magenta on the render. Matches the PixInsight doc's own warning about a magenta sky cast. **"Clipping" is surgical; "scaling" touches everything.**
  - Linear vs post-stretch placement: post-stretch is ~3° more aggressive (Jensen, for a concave stretch the midpoint computed after stretching is lower); both are identical no-ops where green is legitimately low. Minor axis, either defensible.
  - **A residual `gex > 0` after SPCC is EXPECTED and physical:** airglow is dominated by the **OI 557.7 nm** green line and mercury LP has a strong **546.1 nm** line, both landing in the green channel; OSC adds **RGGB's 2x green photosites** (different debayer interpolation). Photometric calibration fixes *stellar* colour, not an additive green-weighted **sky pedestal**, and a nebula-filling field gives background neutralization no true blank sample. ⚠️ Magnitude is still diagnostic: R9's **80.9%** of pixels above the midpoint (mean excess 0.046) is large enough to warrant investigating the upstream cause, not just clamping. **The airglow/LP part applies to MONO equally** (see the note in `mosaic.md`-adjacent categories); only the debayer term is OSC-specific.

## 10b-2. ⛔ [GALAXY] WHY curves and HDR must alternate · **R11, measured** · High

**The mechanism, not a recipe.** A galaxy needs "object brighter, white point unchanged". There are
two tools and they are not interchangeable:

- **A tone curve applies ONE slope to everything at a given level.** Structure and detail at that
  level are inseparable, so **compressing range compresses the detail inside it.** And the
  compression is not optional: a curve that lifts `m → m'` and must still pass through `(1,1)` has
  an **average slope above the pivot of `(1−m′)/(1−m)`**, which is below 1 by construction. That
  deficit lands on star peaks and faint knots.
- **HDRMultiscaleTransform separates by SCALE.** It compresses the large-scale component and leaves
  or raises the small-scale one, so it buys headroom **without** paying in detail.

**Controlled measurement (R11, same image, same amount of large-scale range compression):**

| | bulge/disk range | small-scale detail |
|---|---|---|
| before | 2.178 | 2.26% |
| **via HDR** | 2.065 | **2.36% (+4.4%)** |
| **via an equivalent curve** | 2.093 | **2.09% (−7.5%)** |

Same range change, **12-point swing in detail**. That is the whole reason the two must alternate.

**The rule that follows:**
1. **Before applying any curve, compute its forced compression `(1−m′)/(1−m)`.** R11's agent curve:
   `(1−0.665)/(1−0.55) = 0.744`. The user's: `(1−0.537)/(1−0.457) = 0.852`. **Below ~0.85 means the
   lift is too big for one step.**
2. **Take the lift from HDR wherever possible** - for the same range change it is detail-positive.
3. **Then place levels with a gentle curve.** Repeat. HDR reduces how much range the next curve has
   to compress, which is *why* interleaving keeps every individual curve gentle. It is not that
   "many small steps" is magic; it is that HDR keeps refilling the headroom.

**What this explains in R11** (all one root cause, the forced compression of a too-large single lift):
- **Stars 20-30% too dim**, matched star-by-star against the reference (amplitude bins 0.12-0.50 at
  0.70-0.74). A dim star has a smaller visible disc and a relatively deeper ring → the reported
  "smaller stars" and "worse dark ringing" are the same defect.
- **Faint-highlight detail at 0.569 of reference immediately after the agent's S-curve**, before HDR
  or DSE ran at all. HDR then recovered it only to 0.696.
- Adding *more* HDR at a finer layer count did **not** fix it (0.732 → 0.737, and disk noise
  1.81% → 2.01%): once a curve has destroyed the detail, HDR cannot fully restore it. **Prevent, do
  not repair.**

⛔ **Do not copy the step list below as a recipe.** It is one worked example of the rule above; the
numbers are specific to this image. Copying steps without the compression check reproduces neither
the reasoning nor the result.

**The worked example, read out of the user's history:**

| step | operation |
|---|---|
| 1 | `CurvesTransformation` **K** `[0,0] [0.26357,0.23514] [0.45736,0.53747] [1,1]` |
| 2 | **EZ HDR**, blend 0.3 |
| 3 | `CurvesTransformation` **K** `[0,0] [0.24289,0.25323] [0.43928,0.5478] [1,1]` |
| 4 | `CurvesTransformation` **H** `[0,0] [0.51163,0.47287] [1,1]` |
| 5 | **EZ HDR**, blend 0.3 |
| 6 | `CurvesTransformation` **c** (CIE chroma) `[0,0] [0.5168,0.48837] [1,1]` |
| 7 | `CurvesTransformation` **K** `[0,0] [0.24031,0.26357] [0.48062,0.51938] [1,1]` |
| 8 | **EZ HDR**, blend 0.3 |
| 9 | `DarkStructureEnhance` |

**The pattern to copy:**
- Every K curve is a **4-point S-curve** (two endpoints + one shadow point + one highlight point).
  Never 8-11 points.
- The deltas are **tiny**: −0.028 / +0.080, i.e. ~10% moves, roughly **3x gentler per step** than the
  agent's.
- Curves are **interleaved with HDR**, not stacked. Curve → HDR → curve → curve → HDR → curve → HDR.
- Hue and chroma get their own **single-point** nudges (`H` and the `c` channel), not a saturation
  blitz.
- `DarkStructureEnhance` runs **last**.

⛔ **Rule: on a galaxy, build the nonlinear result out of many small 4-point S-curves interleaved
with HDR. Do not try to reach the target tone in one or two big curves.**

## 10c. [GALAXY] Local contrast / HDR, and how to read "haze" · **R11, first galaxy run** · High

⚠️ **This project's first GALAXY target (M31, R11). Everything in the nonlinear half above was
derived from nebula-filling fields; a bright galaxy on comparatively empty sky behaves differently
and these are its rules.**

⛔ **"The galaxy looks hazy / glowy" almost never means excess glow. It means MISSING LOCAL
CONTRAST.** R11 chased this the wrong way first. Measured on the same field, the agent's version and
the user's had a **nearly identical radial falloff** outward from the core (x sky: 1.60/1.15/1.06/1.02
vs 1.59/1.18/1.07/1.02), i.e. the same diffuse light, but the user's carried far more structure on it:

| region | agent | user | metric |
|---|---|---|---|
| disk NE | 4.04% | **4.72%** | mean `\|px − local median(15px)\|` / local level |
| disk SW | 2.63% | **3.42%** | |
| dust lane | 2.74% | **3.13%** | |
| bulge | 0.34% | **0.41%** | at a *lower* level, 0.685 vs 0.746 |

→ **Diagnose with a local-contrast metric, not the radial profile**, and fix with HDR, not a tone
curve. A tone curve that tries to fix haze just lifts the diffuse component too.

**EZ HDR is the tool the user reaches for, and it is worth replaying exactly**
(`<PixInsight>/src/scripts/EZProcessingSuite/EZ_HDR.js`, defaults `hdrLayers 5`, `hdrAmount 0.3`):
1. build the mask (see below);
2. clone the image, run `HDRMultiscaleTransform` with **only `numberOfLayers = 5`** set, everything
   else default;
3. blend `(1-0.3)*image + 0.3*hdrClone` **through the mask, INVERTED**, so HDR lands on the object
   and the background is untouched;
4. **repeat**. The user ran it **3x at 0.3**, interleaved with small curves.

⚠️ **HDR COMPRESSES LEVELS, so it must be paired with a re-lift.** After 3 passes R11 measured every
galaxy region at ~**x0.81** of the user's reference (bulge 0.558 vs 0.685) while local contrast was
already correct. That is exactly why the user's chain alternates **HDR → curve → HDR → curve**. Fix
with a curve; in R11 the gap was a uniform **x1.24** and one curve matched all four regions to <1%.

**Order that worked (R11 v8):** GHS → one S-curve → SCNR → saturation → recombine → **EZ HDR x3** →
**DarkStructureEnhance x3** → colour grade → level-match curve.

✅ **`DarkStructureEnhance` is free.** Measured twice: 3 iterations changed sky HF grain by **0.00
percentage points** while visibly deepening the lanes. Do not blame it for grain.

## 10b-3. ⭐ [TECHNIQUE] PER-CHANNEL PERCENTILE MATCHING · **R12, measured** · High

**Use when you have a reference to match** (the user's own version, an earlier accepted result, a
second processing of the same data). It replaces the whole guess-a-curve-then-patch-it-with-
saturation-and-SCNR loop that produced R12's first four failed attempts.

**Why it works:** tone, colour balance and saturation are not three independent things to be tuned
with three different tools. They are all consequences of the **per-channel distributions**. Match the
distributions and you have matched all three, in one step, with nothing stacked.

**Method:**
```
P = [0.001, 0.01, 0.05, 0.15, 0.30, 0.50, 0.70, 0.85, 0.94, 0.98, 0.995, 0.999]
measure mine_c[p] and reference_c[p] for c in {R,G,B}          # after the stretch, before any colour work
for each channel c:
    curve_c = [(mine_c[p], reference_c[p]) for p in P] + anchors (0,0) and (1,1)
apply ONE CurvesTransformation with the three curves (Akima)
```
Thin closely-spaced points before applying, Akima wobbles on irregular spacing.

**R12 result after this SINGLE step** (M16, matching the user's own processing):

| metric | after one curve step | reference |
|---|---|---|
| p50 / p90 / p99 | 0.1704 / 0.2828 / 0.6275 | 0.1704 / 0.2824 / 0.6175 |
| mean saturation | 0.2627 | 0.2607 |
| G-is-min on bright px | 16.8% | 20.8% |
| hue red / cyan / blue / magenta % | 52.5 / 13.3 / 0.8 / 1.8 | 49.5 / 15.3 / 1.0 / 2.0 |

Five of six luminance bands matched to ~1% on `[R/G, R/B, saturation]` simultaneously.

⛔ **The curve POINTS are target-specific and must never be reused.** The method generalises; the
numbers do not. Re-derive them by measuring both ladders every time.

⚠️ **No reference?** Then this technique does not apply, and the old discipline stands: one measured
colour step, judged on the render. Do **not** approximate a reference from another object's numbers.

## 10b-4. ⛔ SCNR-green MANUFACTURES magenta/purple · **R12, measured** · High

`SCNR` AverageNeutral is `G' = min(G, (R+B)/2)`. **Driving G to or below the R-B midpoint IS the
magenta axis, by definition.** Applied broadly it does not merely fail to help, it *creates* the cast
that a later saturation pass then amplifies.

Measured on R12 (M16), fraction of pixels where **G is the minimum channel**:

| | all lit px | bright px (L>0.20) |
|---|---|---|
| with SCNR 0.5 on the starless + stacked saturation | 27.9% | **42.8%** |
| user's reference (no SCNR anywhere) | 19.7% | 20.8% |
| R12 v2 (no SCNR on the starless) | - | **15.2%** |

Hue distribution told the same story: the SCNR version was **cyan-dominant** (cyan 28.6%, blue 7.3%,
red 24.6%) against the reference's **red-dominant** (red 49.5%, cyan 15.3%, blue 1.0%).

**Why it also drives the background BLUE:** on a shadow population ordered `B > G > R`, SCNR lowers G
and leaves B untouched, so blue becomes *more* dominant. R12's dark sky read navy; the reference's
read warm brown.

⛔ **The rule (user, R12): SCNR only earns its place if it makes the background neutral AND clean.**
If it leaves the background bluer or pushes G below the midpoint over large areas, it is the wrong
tool for that image, whatever the green gate says. Ablation cost on R12's starless: structure
`R/G` 1.669 → 1.602 for no visible benefit.
**On the STARS layer it remains correct and valuable at amount 1.0** (see `_common.md` §3), where it
is a surgical clamp on individual stars rather than a field-wide operation. The distinction is
scope, not strength.

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
  - ⛔ **(b) is a CLAMP: accept it on RESIDUAL FRACTION + WORST CASE, never on the mean [R11].** R11 ran it at amount 0.3, saw the mean relative deficit go −4.28% → −0.96%, and accepted, but **51.3% of lit star pixels were still deficient (worst case 80.5%, 14,989 bright px >18%)** and the user saw a purple star. The residual fraction had barely moved, 53.6% → 52.7%, and that was the number that mattered. The user's fix: a **second full pass** (residual → 3.1%). Also **render the 1:1 check at the measured worst-case coordinates**, not a region you chose, R11's clean 1:1 crop passed while the offender sat elsewhere in the frame.
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
