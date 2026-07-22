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
  **`unscreen = false` when extracting from a LINEAR image [High — primary: RC-Astro].** Unscreen is for
  extracting from an *already-stretched* image; on linear data use simple subtraction for best star color.
  (Run 4 wrongly used `unscreen=true` on linear.) Screen-recombine still happens later (Step 12) regardless.
- **HOO star color:** duoband stars can be magenta/teal — consider rebuilding "natural" stars (or a separate RGB/broadband star exposure) to add onto the finished starless nebula.
- Author + 2025-26 consensus favors early/linear SXT; post-stretch still works (mild contest).

## Step 10 — Stretch (starless + stars separately) · **REVISED (Run-2 research, 2026-07-21)** · use GHS · High

> **Root cause of 2 failed runs:** HistogramTransformation to a target median (0.10 → "extremely
> dim"; 0.25 STF-matched → "still awful") is the WRONG TOOL. A single MTF only rescales brightness;
> it cannot concentrate contrast where the nebula signal sits. **Use GeneralizedHyperbolicStretch
> (GHS).** [High — primary: ghsastro.co.uk authors + Siril tutorial; 2024-26 standard.]

**Pre-stretch gate — background neutrality is a LINEAR problem [High — primary: PixInsight SPCC
docs].** Equal channel medians do NOT mean a neutral background (this is why Runs 1–2 went
pink/blue). Neutrality is set *before* the stretch, measured on the true sky.
- **How to measure the sky (Run-3 validated method).** Do NOT use the darkest N% of pixels — on a
  nebula-filling target those are **dark-nebula dust lanes** (the NGC 7000 "Gulf of Mexico" bay)
  where Hα is physically absent, giving a 8–40% fake "cast" that is really correct OIII-teal signal.
  Instead measure the **diffuse-sky band**: per-channel median of pixels within ±8% of the luminance
  median (the histogram peak). That population is the real sky; ≤~1% channel spread = neutral. (Grid-
  sample `image.sample` in `run_script` until a first-class `get_background_neutrality` exists.)
- **How to fix a residual.** SPCC's `neutralizeBackground` usually covers it. If a small residual
  remains, **do NOT use the `BackgroundNeutralization` process** — Run 3 it blew up (median ×100,
  R channel clipped to 1.0) with a narrow `backgroundHigh`. Null it with a **per-channel additive
  offset** in PixelMath (`useSingleExpression:false`; `$T`, `$T-offsetG`, `$T-offsetB`) where each
  offset = that channel's diffuse-sky median minus the min channel's. It's tiny (~5e-6) but it
  **compounds** through GHS + black-point (Run 3: 0.7%→1.4%→3.6%), so it must be nulled while linear.
- **Linear pre-stretch neutralization is PRIMARY.** But post-stretch background work is a **legitimate
  supplement** [Run-7 research + validated], not forbidden — the old blanket "never fix a cast after
  stretch / never SCNR" came from *blind* SCNR@100% failures. When a residual cast survives the stretch,
  neutralize it **measured and gated** per **`docs/background-work.md`** (OSC-HOO: luminance-dependent
  per-channel curves leveling → teal-toward-own-luminance gated to `rex<0`; preserves brightness = gray
  not black, red untouched by construction). ⚠ **Judge on the render**, not the ±8% sky-band spread
  metric — that metric is valid for *linear* neutrality but **LIES post-stretch** (reads 2–3% on a
  visually-neutral gray bg). Never stack SCNR + a mask (Run 7: flattened reds, worst result).

**Use the NATIVE GHS process** — `run_process("GeneralizedHyperbolicStretch", …)`. ✅ Run 4 drove it
natively (param map: `stretchType:0`=GH, `stretchFactor`=D entered directly, `localIntensity`=b,
`symmetryPoint`=SP, `stretchChannel:3`=linked RGB). If `undefined` (Run 3), the module loaded after PI
launched → restart PI. The PixelMath port is a fallback only.

**⛔ DIM STRETCH = OVER-BLACK-POINTING [correctness — the #1 recurring failure, R1–R4].** The stated
target above is **histogram peak ≈ 0.20–0.25 — you must END there.** Run 4 lifted the peak to 0.15 →
black-pointed to 0.07 → lifted to 0.17 → black-pointed to 0.09, ending at **0.09, under half the target
= dim** (same as every prior run). The black point is a **gentle true-black set** (shave only the few %
of empty sky just below the histogram rise), **NOT a background crush** — on a nebula-filling target the
faint nebula sits just above the sky and a hard black point kills it. **Gate: after the last step, measure
the peak; if < ~0.18, you over-black-pointed → undo and redo the black point gently.** Reach 0.20–0.25 with
more D / another gentle GHS pass, not by first over-lifting and then crushing back down.

**⚠ R5 — a SECOND, distinct dim failure mode (not over-black-pointing) [quality, OPEN].** R5 used *no*
black point (BP=0) and *did* end at peak 0.245 (in target), yet the user still read it "okayish / dim-milky."
Cause: on this faint wide-field target the tonal distribution came out **extremely compressed** — after a
high-`b` first pass, p01→peak spanned only ~0.045, so the whole background/faint-nebula bulk sits in a
narrow bright band = low-contrast/milky, and any black point near the histogram rise then craters the peak.
A **lower-`b` restretch (b≈3) was WORSE** (even more compressed). So hitting the peak target is necessary
but **not sufficient**; contrast/tonal-spread is a separate axis. A saturation + gentle contrast-curve pass
(ColorSaturation / CurvesTransformation, measured per image) visibly helped in R5 but is not yet a
researched recipe. **Open research question — do NOT hardcode curve points.** See journal.

**⚠ R6 — the OPPOSITE overshoot: a dark background that CRUSHES faint nebulosity [quality/method, OPEN].**
Correcting R5's milkiness, R6 pushed the background dark (peak ~0.125) with a curve pinned at the background
and rising above it. User verdict: **"nebulosity too dim; fainter nebulosity vanished with the background."**
The dark-background aesthetic **overshot** — pinning/darkening the background sank the faint *outer* nebula
with it, and the main nebula ended too dim. **The two failure modes bracket the target:** R5 = background too
bright/milky; R6 = background too dark, faint signal lost + object dim. The real objective is a **band, not an
edge**: background dark enough to give contrast **but** faint outer nebulosity must remain clearly visible AND
the object itself must stay bright. **Method fix (applies now, not a number): before accepting a stretch,
explicitly CHECK FAINT-NEBULA SURVIVAL** — sample/inspect known faint outer regions (e.g. the Pelican's outer
diffuse) and confirm they read clearly above the background, not just "no clipping (min>0)". "No clipping" is
NOT preservation — R6's mins were >0 yet the faint nebula was visually gone. **Do NOT sacrifice object
brightness to darken the background.** Exact levels = open research (objective function), do NOT hardcode.

**GHS parameters — derive from measurement, do not guess [High — primary docs]:**
- **SP (Symmetry Point)** = where GHS adds maximum contrast. Place it *within / just-left of the
  histogram peak*; for nebula-filling targets at or slightly left of the peak. **Measure it:**
  readout probe **15×15, calculation mode = mean**, click the dim signal/background you want to
  reveal, then **"Send to SP"** (value measured; region chosen).
- **b (local intensity)** = contrast concentration around SP. **First** stretch: high **b ≈ 5–10**
  (up to ~15 for a tightly-focused initial pull on faint signal). **Subsequent** stretches: lower
  **b ≈ 2–6**, trending toward/negative as the histogram widens.
- **D (stretch amount)** = logarithmic slider (actual D = exp(slider)−1). Raise **until the
  histogram peak reaches ~0.2–0.25.** This is the real target — from the GHS docs, NOT a chosen
  median in HistogramTransformation.

**GHS is ITERATIVE; the black point is a SEPARATE linear step [High]:**
1. Set SP + b, raise D while watching the linear **and** log histograms, execute.
2. Switch stretch type to **Linear**, apply a black-point shift just left of the histogram rise.
3. Repeat GHS with **lower b (~3–5)** for contrast. Expect **two or more** passes.

Stretch the **starless** with GHS as above; stretch the **stars** with their own transfer (Step 12
— NOT STF-auto, NOT a blind midtones). Keep RGB linked unless neutrality (above) is already correct.

**Grading:** GHS method/params = High (primary, unanimous 3-0). SetiAstro Statistical Stretch /
VeraLux are viable but were NOT characterized head-to-head → **open**. STF-as-final remains the only
agreed-inferior option.

## Step 11 — HOO color shaping (SCNR + curves) · **REVISED** · Medium
- **SCNR is NOT a mandatory 100% step [Medium — multi-source consensus].** Green / Average Neutral /
  1.0 applied blindly flattens color and, on a not-truly-neutral background, reveals/introduces a
  cast (both runs). **Fix the cast in the LINEAR stage (Step 10 pre-stretch BN), not with SCNR.** If
  green genuinely remains *after* correct BN, apply SCNR green at a **reduced, measured amount**
  (e.g. ~0.5), gated by actually measuring green > (R,B) in the nebula — never 100% "to be safe."
- **SCNR *after* the stretch — CONDITIONAL, not refuted [Run-7 research correction].** Earlier graded
  "refuted," but that was blind SCNR@100%. It's mechanically sound (direction-symmetric; Average Neutral
  clamps the target channel to the other-two average; amount IS operative) and a valid **background**
  tool *when the cast is genuinely green/blue-dominant* and dosed/gated — see `docs/background-work.md`.
  On an R-dominant or mixed cast it under-neutralizes, and **stacked with a mask it flattens the reds**
  (Run 7, worst result). `invert→SCNR-green→invert` removes magenta (complement) — valid for magenta
  star fringing. Still refuted: the per-channel PixelMath `R=T(0)/G=T(1)/B=T(2)` "magenta-star fix" (0-3).
- **⚠ Saturation — RESTRAINT [R6, quality].** R6 applied a `CurvesTransformation` S-curve
  `S=[[0,0],[0.35,0.5],[0.7,0.83],[1,1]]` on the starless → user: **"way too much."** A strong saturation
  curve on an already-saturated SPCC result over-cooks it. Keep any saturation boost **gentle and measured**,
  and verify on the render — do NOT apply an aggressive fixed curve. Exact amount is per-image/preference →
  open, do not hardcode. (Note: the *star-layer* ColorSaturation in Step 12 is separate and lighter-touch.)
- **HOO gold/teal look — [Low / preference · UNRESOLVED].** The dynamic "Foraxx" PixelMath
  (`R=Ha; G=((O*H)^~(O*H))*H + ~((O*H)^~(O*H))*O; B=O`) is a **channel-split** recipe; for a single
  RGB OSC image it's only an approximation and was **not verified**. Lighter sourced move: blend
  ~15–20% Ha into blue and ~20% Ha into green to warm hydrogen / mute pink (jonrista, blog-grade).
  Treat as preference; **open research question — do not hardcode.**

## Step 12 — Star stretch + recombination · **RESEARCHED (R4) + RUN-VALIDATED (R5–R6, 2026-07-21)** · High
> Sources: RC-Astro (StarXTerminator author) usage notes; ghsastro.co.uk GHS primer; SetiAstro
> Star Stretch **source read directly** (`C:\Program Files\PixInsight\src\scripts\star_stretch.js`,
> Franklin Marek v2.6, MIT/CC-BY-NC). All primary.

- **Do NOT STF-autostretch the stars image [High — primary: RC-Astro].** SXT translated the original
  image's STF onto the stars layer; autostretch destroys it. Never a guessed `m=0.10`.
- **⛔ Do NOT use GHS (or arcsinh) on the star layer — the wash is INHERENT, not a bad parameter [High —
  primary: RC-Astro].** RC-Astro states GHS/arcsinh *"create star profiles indistinguishable from small
  elliptical galaxies"* = compact core + broad halo (exactly the Run-4 wash, and the real cause of Run-3's
  "combine artifacts" — NOT SXT residual). Mechanism: on an isolated star layer the background is near-black
  and the faint stellar wings sit right at a near-black GHS symmetry point, so high-`b` puts maximum slope
  ON the wings → halo, while the core compresses. The "high-b protects stars" rule is specific to the
  *combined* image histogram and does **not** transfer to a stars-only layer. No `b` fully fixes it.
- **Stretch the stars with a single MTF / midtones curve [High — primary: RC-Astro consensus].** Options,
  all the **same MTF transfer** — the tool choice is cosmetic (`PixelMath` MTF ≡ `HistogramTransformation`
  midtones ≡ SetiAstro's curve). Don't relitigate PixelMath-vs-script; **the amount and the color step are
  what matter** (R5).
  - **Plain `HistogramTransformation`** (or STF→HT transfer). Simplest; RC-Astro's baseline. Midtones
    `m = M*(T-1) / (2*T*M - T - M)`.
  - **SetiAstro Star Stretch — replay its actual Execute path [R5, source read].** It IS installed
    (Script → SetiAstro → Star Stretch, `star_stretch.js` v2.6). Its dialog is modal (`dialog.execute()`)
    so it **can't be clicked through the watcher** — but its whole algorithm is three ops you replay in
    `run_script` (no `#include` — `#` breaks the watcher's V8 eval):
    1. `PixelMath` `((3^a)*$T)/((3^a - 1)*$T + 1)` — MTF, `K = 3^a`. **`amount` default `a=5` (K=243).**
    2. `ColorSaturation` `HS = [[0,0.4],[0.5,0.7],[1,0.4]] * satAmount` (default `satAmount=1`), `HSt=2`
       (Akima), `hueShift=0`. **This color boost is NOT an optional extra — it is part of every Execute,
       and it is exactly what a bare-MTF reproduction (R1–R4, R5 first attempt) was missing.**
    3. Optional `SCNR` green, Average Neutral, amount 1.0 — **default OFF**; leave off unless the SCNR gate fires.
- **Set the amount by MEASUREMENT — but measure the star PIXELS, not the whole layer [R5, corrected].**
  The stars layer is ~99.9% black, so its **overall median ≈ 0** and the formula degenerates (huge `a`).
  Measure `M` = the **median of the star pixels only** (grid-sample and take the median of samples
  `> ~0.005`; R5 had `M ≈ 0.01`). Pick target output median `T`, then `a = ln( T*(1-M) / (M*(1-T)) ) / ln 3`.
  - **T ≈ 0.35–0.45 is a STARTING POINT, tune UP per target [R5+R6].** NOT 0.10–0.20 (that buried the
    stars — screened onto a bright ~0.24 nebula, `screen(0.24,0.13)≈0.34` adds nothing = the "barely-there"
    failure R1–R5). But the amount is **per-target and usually wants to go harder:** R5 `a≈4.5` was OK on the
    bright-background version; **R6 (darker background) the user wanted it HARDER still — `amount=6, satAmount=1.3`
    worked well FOR THIS TARGET (NAN/Pelican)** vs my `a=4.0/sat=1.0` which read too soft. ⚠ **These are a
    per-object datapoint, NOT a universal default** — the user was explicit that "other targets might not be as
    good." Start near the measured `a`, then **push harder + more saturation and confirm at 1:1**; a darker
    background lets stars take a harder stretch. `satAmount` 1.0→1.3 for more star color.
- **VERIFY THE STARS AT 1:1 — global stats will lie [R5, method].** The star-layer median is ~0, so
  `get_image_statistics` cannot tell you the stars are too dim. **Render a true 1:1 crop** around the
  brightest stars (find them by grid-scan for `max(r,g,b) > 0.5`; `Crop` process, `mode=1`, negative
  margins to a ~900×640 box) and LOOK before declaring the star step done. This is the only check that
  caught the barely-there failure in R5.
- **Never apply the nebula's *nebula-tuned* black points to the stars** — they clip faint stars →
  "barely-there" (Runs 1–2). A star layer needs at most one tiny black point on its own near-zero background.
- **Recombine via PixelMath `starless*~stars + stars`** (house formula; ≡ screen `~(~starless*~stars)` =
  `a+b-ab`). Formula is correct — the artifact fix is a natural MTF-stretched star layer, not a different
  combine. Avoid plain additive on nonlinear data (clips cores).
- **Duoband magenta/teal star color — [UNRESOLVED].** The per-channel PixelMath fix was refuted;
  no positive method survived verification. Options (ungraded): rebuild stars from a broadband/RGB
  exposure, or in-place hue correction — **open research question.**

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
