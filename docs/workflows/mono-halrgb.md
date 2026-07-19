> Provenance: 17-leg multi-agent web research (2025-2026) + adversarial recency/evidence/stage verification. Builds on docs/workflows/mono-lrgb.md (LRGB spine). Replaces the earlier PROVISIONAL draft. Ha never touches SPCC. Confidence/consensus/contested tags preserved; unsourced numbers flagged [UNSOURCED].

# MONO-HaLRGB PixInsight Processing Playbook

*This playbook assumes you already have a fully processed mono-LRGB master (registration, integration, gradient removal, deconvolution, SPCC, LRGBCombination, and stretch all done on the L/R/G/B broadband data). It covers ONLY the additions needed to fold a monochrome Ha master into that image. One rule threads through everything: **Ha is a single narrowband channel and NEVER touches SPCC** — there is nothing to photometrically color-calibrate in one line-emission channel. SPCC runs on RGB only, before Ha is injected; the Ha track runs in parallel through the same operator order as L and joins at/after the LRGBCombination point.*

---

## Part 1 — When HaLRGB Is Worth It (Target Selection + Cost/Benefit)

Adding Ha is a go/no-go decision made **before** any blend math. Add Ha only when the target has real ionized-hydrogen line emission **AND** your Ha master clears an SNR bar.

**Worth it (real 656.28 nm line emission):**
- Emission nebulae — HII regions, supernova remnants, planetary nebulae.
- Galaxies **with** active HII knots / star-forming regions — Ha brightens red HII detail that the broadband R buries under continuum.

**Skip (continuum / scattered-starlight sources, near-zero payoff):**
- Pure reflection / dust nebulae.
- Star clusters.
- Elliptical galaxies.

The physics is objective and target-conditional. On line-emission targets a 3–7 nm Ha filter passes essentially all of the 656.28 nm recombination signal while rejecting roughly 90–97% of the broadband skyglow, light pollution, and moonlight that a ~100 nm broadband R admits — so line-to-background contrast and achievable SNR-per-hour are far higher, and Ha stays usable under a bright (broadband) Moon. **The flip side is equally objective:** on continuum-dominated sources the narrowband filter discards most of the source's photons, so SNR is *worse*. "Narrowband beats broadband R" is not a universal win — it is conditional on the target actually emitting the line.

**Filter-bandwidth contrast (sourced):** 3 nm gives the strongest skyglow rejection but needs longer subs; 5–7 nm balances contrast vs throughput; 10–12 nm gives more throughput but weaker sky suppression. Narrower helps **only** line-emission targets.

**Gate on the Ha master itself.** If the registered Ha frame is thin/noisy, blending it degrades the clean LRGB — it injects magenta mottling and star halos for little gain. No published numeric SNR threshold exists **[UNSOURCED]**; measure by eye:

- On the registered **linear** Ha, use Statistics or a preview over blank sky vs signal. If the nebula-to-background contrast is weak, or mottling is visible after a test stretch, either **denoise Ha hard first** (star-removal → NoiseXTerminator) or abstain.
- Distinguish signal from a copy of R: real HII filaments/shells that R lacks = proceed; a frame that looks like a fainter copy of R (same stars, same galaxy core continuum) = skip.

The blend point sits **at/after LRGBCombination**. (Note a legitimate method fork: some workflows, including the Astrodoc NBRGBCombination recipe, combine before final color balance rather than strictly after — a fork in *where in the color pipeline*, not a change to this go/no-go gate.)

**Recency note:** none of this go/no-go logic is new. Continuum subtraction and Ha→R/Ha→L blending predate the 2024–2026 AI-tool era; do not treat them as a recent development. Only the *denoise-the-thin-Ha* path benefits from recent tools (SXT/NXT, 2023+).

| Track | Goal | Process | Confidence | Consensus |
|---|---|---|---|---|
| Go/no-go gate | Decide if Ha earns its place | Visual + Statistics on linear Ha; no new process | high | consensus |

---

## Part 2 — The Separate Ha Linear Track

Process Ha as its own monochrome **linear** master, in the **same operator order as L**, up to (but not including) the blend. Everything that is a per-pixel arithmetic relationship between masters — continuum subtraction, LinearFit, blends — MUST happen while linear, because stretching is a nonlinear remap that breaks flux proportionality and makes scale factors meaningless.

1. **StarAlignment** — register Ha to the **ONE common reference** used for L/R/G/B (the luminance / common reference frame), **not** to the red master. Every master must share an identical pixel grid; continuum subtraction and the blends are per-pixel math. Registered images inherit the reference resolution.
2. **DynamicCrop** — apply the **single shared crop instance** (built from the registration overlap/rejection map) to Ha exactly as to the other masters, so all share identical width/height/origin. (Astrodoc: apply to the unselected image first, then the selected.)
3. **Gradient removal** — in **subtraction mode** (additive sky gradient), preferring DBE (the sourced "preferred" NB tool); GradientCorrection / MultiscaleGradientCorrection also work on mono/NB. Gradient-correct **both Ha and RGB before any subtraction** — residual gradients in either transfer into the other. If you use GraXpert, run it per grayscale channel; its AI is trained on OSC/RGB and underperforms on raw NB.
4. **BlurXTerminator on LINEAR Ha** — **Correct-Only** if you only want star-shape correction with zero sharpening; or modest full deconvolution leaning on **Sharpen Nonstellar** for high-contrast Ha structure (filaments/shells), which sharpens without ringing. Keep stellar sharpen conservative to protect faint stars. L (and, by analogy, a detail-carrying Ha) can be deconvolved harder than RGB. Exact numeric defaults are **[UNSOURCED]** (RC Astro page inaccessible) — start modest, increase until detail resolves without ringing/dark-halo overshoot; zoom to 1:1 on a bright rim to verify.
5. **NoiseXTerminator** — after BXT, still linear.
6. **Stretch** — only now. Use **GHS** (or HistogramTransformation / MaskedStretch), matching Ha's stretch target to L/RGB so the later blend needs no gross rescaling. GHS D/b/SP are set by measuring the Ha histogram, **not** a fixed number **[method-sourced]**.

**Never SPCC** and **never SCNR** a mono Ha channel — SCNR removes a color (typically green) from an RGB image and is undefined on a single-channel master.

Before any blend, put Ha on a comparable linear scale to R/L via LinearFit and/or continuum subtraction (Part 3), verified by star-nulling.

**Contested within this track:** Correct-Only vs full deconvolution depends on Ha's role — if Ha only feeds a Ha→R color boost, minimal sharpening avoids injecting deconvolution artifacts into the blend; if Ha carries structural detail meant for luminance (Ha→L), modest nonstellar-sharpen deconvolution is warranted.

| Track | Goal | Process | Confidence | Consensus |
|---|---|---|---|---|
| Ha linear prep | Ha ready to blend, same grid/scale as L | StarAlignment → DynamicCrop → DBE/GC/MGC → BXT (linear) → NXT → GHS | medium | consensus |

---

## Part 3 — Continuum Subtraction (Isolating Pure Ha)

**Do NOT blend the raw Ha master.** The R master carries the SAME broadband continuum (starlight, reflection nebulosity, galaxy disk) that the Ha filter also records, and Ha filters leak some continuum too. Blending raw Ha **double-counts** that continuum, producing star bloat, halos, and magenta star cores. This is objective physics, not preference.

**The formula (run on registered, linear masters):**

```
Ha_pure = Ha - k * (R - med(R))
```

Subtract the **median-referenced** continuum `(R - med(R))`, **not** raw R — this preserves Ha's own background/sky level and avoids importing R's gradient. `k` is almost always **< 1**, because the NB bandpass is far narrower than the BB bandpass.

**Never hard-code `k`.** Derive it per-image, three ways (preferred → fallback):

- **(A) Photometric flux-fit — preferred, automatable.** **PhotometricContinuumSubtraction (PCS)** (Charles Hagen / NightPhotons, released Oct 1 2024) detects stars in the broadband image, filters to the brightest below a peak threshold, runs DynamicPSF on the matched stars in **both** Ha and R, uses integrated **flux** (not peak), and fits the linear NB-vs-BB relationship — **the slope is `k`**. Defaults: **Maximum Stars 400, Maximum Peak 0.8** (avoid saturated stars), optional flux plot for verification. Works on linear masters, including starless pairs. Non-linear scatter → raise max-stars. **NarrowbandNormalization** (native process, Blanshan/Cranfield) and **SetiAstro's Continuum Subtraction Utility** are alternative photometric solvers. Note: PCS is often described loosely as "star-flux fit"; the source wording is photometric/optimal weights.
- **(B) LinearFit regression.** Run LinearFit with R as reference against Ha to obtain slope + offset, then apply `Ha - slope*(R - med(R))`. Verify by star-nulling.
- **(C) Physical bandwidth/flux ratio — starting estimate only.** `f ≈ (NB_bandpass × NB_subexposure) / (BB_bandpass × BB_subexposure)`. The source explicitly calls this "only an approximation" needing visual tweak. For Ha/SII use broadband **red** as continuum; for OIII use **green**.

**Verify by star-nulling** (the universal check): at high stretch on a star field, stars in `Ha_pure` should sink to background. **Dark holes/rings = `k` too high** (over-subtraction); **residual white star cores = `k` too low** (under-subtraction). Also confirm the background median is unchanged (no gradient imported from R).

**Clip vs pedestal:** after subtraction, over-subtracted stars/background can go negative. A hard clip `max(0, expr)` zeroes them but can leave black cores/rings and truncate noise statistics; **median-referenced subtraction + a light `k` (optionally a small pedestal) preserves background noise and the NB sky level** and is preferred. Exact pedestal value is **[UNSOURCED / reasoning-based]**.

**NBRGBCombination is a bandwidth-weighted COMBINE, not a clean per-pixel subtraction:** `((HA*R_bw) - (R*HA_bw)) / (R_bw - HA_bw)`, weights = filter bandwidths in nm. Lowering the R_bandwidth parameter (e.g. 100 → 40) makes continuum removal more aggressive. Treat it as a convenience combine, not as continuum isolation.

**Recency note:** continuum subtraction is decades old (Ha-minus-scaled-R for galaxies/nebulae). What is genuinely new (2024–2026) is **automation of `k`** — PCS, NarrowbandNormalization, SASpro. Automation is more repeatable, not a different result: a well-star-nulled manual `k` is equivalent. SASpro's Continuum Subtraction Utility is confirmed to exist (SetiAstro), but its internal algorithm is **unverified**.

| Track | Goal | Process | Confidence | Consensus |
|---|---|---|---|---|
| Continuum subtraction | Isolate pure line emission; null stars | PCS / NarrowbandNormalization / LinearFit / PixelMath | high | consensus |

---

## Part 4 — Blending Ha into RED

Two-stage, measure → configure → verify. **Stage 1 is Part 3** (continuum-subtract to `Ha_only`). **Stage 2 adds to red**, ordered most-natural → crudest:

**(a) PixelMath additive (most natural).** Add `Ha_only` to R, distributing a fraction off pure-red so oversaturated crimson becomes the natural salmon/pink of real HII:

```
R' = R + a * (Ha_only - med(Ha_only))
G' = G + <green_fraction> * a * (Ha_only - med(Ha_only))
B' = B  (unchanged, or a tiny blue fraction)
```

- The **NightPhotons sourced defaults** put the non-red fraction into **blue**: `R=1.0, G=0.0, B=0.05, m=0.999`, via `$T*~R + R*mtf(~m,(mtf(m,$T)+mtf(m,NB)))`. Increase B/G for a pinker tone.
- A widely-circulated **community convention** instead pushes **~20% into green** (`G' = G + 0.2*a*Ha_only`) to mute magenta. **Be honest about which this is:** distributing *some* fraction off pure-red is defensible and physically motivated; but "~20% into *green* specifically" is a competing **taste convention**, not objective — the cited primary (NightPhotons) puts it in blue, not green. Pick one, tune by eye.
- **Blend strength `a` is [UNSOURCED] — TUNE.** Start low (`a ≈ 0.2–0.4`), raise until HII structure reads clearly without the red channel clipping.

**(b) NBRGBCombination script** (guided UI, linear, before stretch). Astrodoc starting points: **RGB bandwidth ~200**; **Ha bandwidth = your filter** (e.g. 7 nm Baader); **Ha scale ~1.2 for galaxies, ~4 for bright emission nebulae** — these are START values; run ColorCalibration after.

**(c) Screen or max/lighten blends (crudest).** Prone to blowing out cores; use only for a quick look. Example RGB-mode feel: `R*0.6 + Ha*0.4`.

**Add Ha to R, NEVER as the primary of B.** Ha is a red line (656 nm); Hβ belongs in blue but is faint and already in your broadband.

**Decision rules (from the image):**
1. **Magenta/red rings around stars** → continuum subtraction too weak; **raise `k`** (Part 3).
2. **Overall hue** — real HII should read salmon/pink, not saturated crimson or magenta; if magenta, increase the green (or blue) fraction, or lower `a`.
3. **Core clipping** — inspect brightest nebula cores in readout; back off `a` if clipped.

**Why magenta arises** (two complementary framings, not exclusive): (A) *physical* — hydrogen emits ~80% red (Ha) + ~20% blue (Hβ), so red+blue without green reads magenta; the fix is adding green. (B) *workflow* — SPCC already balanced red, so dumping un-subtracted Ha over-drives red and, with existing blue, tips to magenta; the fix is continuum subtraction + moderate `a`. The exact green fraction (0.2 common) is an empirical tuning target, not rigorously derived.

| Track | Goal | Process | Confidence | Consensus |
|---|---|---|---|---|
| Ha → R | Show Ha as HII color, natural hue | PixelMath additive (green/blue push) / NBRGBCombination / screen | high | consensus |

---

## Part 5 — Blending Ha into LUMINANCE (Optional, Gentle)

Ha→L is **optional and gentle**, not the primary way to show Ha. The primary display path is chrominance/red (Part 4). Ha→L is a **targeted SNR/detail boost** only for faint outer nebulosity and filaments where Ha genuinely out-SNRs L. The safest default (the Vicent Peris school): keep Ha entirely on the chrominance/red side and leave L untouched; add Ha→L only if faint structure demands it.

**Method:**
1. **LinearFit Ha with L as the reference — non-negotiable precondition.** Peris: the max/mix operators fail "if the brightness and background illumination level in the narrowband image don't fit perfectly to the same properties of the broadband image."
2. **Blend operator = screen or lighten/max (per-pixel brighter wins), NOT a fixed 50/50 average.** Peris: naive 50% R + 50% Ha "does degrade terribly the signal-to-noise ratio of the nebulas" — averaging two channels of unequal SNR discards signal.
3. Do it **BEFORE LRGBCombination, on starless masters** (stars excluded via SXT/StarNet) so star cores aren't blown and Ha's black star-holes don't punch L.
4. **Strength/opacity is [UNSOURCED].** After LinearFit, blend via screen or a lighten expression (`L2 = L + w*(Ha-L)*(Ha>L)` style); start `w` small (~0.2–0.4) and raise only until faint filaments emerge WITHOUT flattening the red nebula core. A CN-community "~30% opacity Ha-Red as luminance" figure appeared in search snippets but the source did not load — **treat as illustrative [UNSOURCED / needsBrowser]**. Note: Peris **Ha-boost factors of ×2..×12 are for the CHROMINANCE/HaGB red path**, NOT luminance weights — do not reuse them here.

**When it helps vs hurts (objective signal theory):**
- **Helps** where Ha out-SNRs L over emission nebulosity — a lighten/max blend selects the higher-signal pixel, raising local luminance SNR (same reason L boosts SNR in LRGB). Region-dependent.
- **Hurts** over stars, continuum objects, galaxy cores, and star fields, where L wins — so the blend must be **selective**.
- **Desaturation is a mathematical consequence, not taste:** LRGBCombination substitutes lightness (L*) while keeping chrominance (a*, b*). Inflating L in red-nebula regions raises L* under fixed a*, b*, lowering the chroma/lightness ratio → lower perceived saturation and a flat look. This is why Peris matches luminances in a linear (gamma = 1.0) working space.

**Verify** (star-nulling doesn't apply to an L blend): overlay L-blended vs un-blended; the delta should be confined to faint nebulosity, background must not lift, bright star cores unchanged.

**Ha→R vs Ha→L vs both (contested):** R (chrominance) is the correct place to **show** Ha as color; L is optional detail/SNR only. Whether to touch L at all is genuinely contested — Peris school keeps Ha purely chrominance for cleanest SNR and color fidelity; detail-first imagers use Ha (or an Ha-R blend) as luminance and accept a saturation-recovery step. **Consensus warning: do HaLRGB, not LHaRGB** — if Ha deepens R but L is left un-boosted, LRGBCombination's flatter L flattens the very Ha you added → saturation loss. Keep what's in L consistent with what's in the color.

| Track | Goal | Process | Confidence | Consensus |
|---|---|---|---|---|
| Ha → L | Optional SNR/detail on faint structure | LinearFit(ref=L) → screen/lighten (starless) → LRGBCombination | medium | mixed |

---

## Part 6 — Star & Color Handling

Ha is red-only, so blending raw Ha into R (or L) lifts star **cores in red only** → pink/magenta cores; and because the **Ha PSF is usually LARGER** than the broadband PSF, you also get a **red halo** ringing each star. Two independent, complementary fixes — best used together:

**(1) Continuum-subtract the Ha (Part 3)** so stellar (continuum) signal nulls and only true nebular Ha remains. This addresses the *mechanical cause* of magenta cores and red halos: the broadband R already contains the Ha photons, so blending raw Ha double-counts stellar continuum. (Sources call subtraction "mandatory"; that is slightly overstated — some workflows add raw Ha to R and compensate in the blend — but the double-counting physics strongly favors subtracting first.)

**(2) Starless-split.** SXT the RGB into starless + stars, add the continuum-subtracted Ha only to the **STARLESS** nebula, then **screen the unmodified broadband stars back LAST** so Ha never touches a star — making the core/halo problem structurally impossible.

- **Screen recombine:** `combine(starless, stars, op_screen())` i.e. `~((~starless)*(~stars))`, after both are stretched.
- **SXT on LINEAR data, subtraction method, unscreen = OFF** (matches project rule — unscreen only on nonlinear). Objectively better star-color accuracy than nonlinear/unscreen extraction. Take final stars from the **tighter-PSF broadband** channel, never from Ha.

Starless-split is **popular and increasingly the default** (driven by SXT making star removal trivial), but **NOT the single agreed method** — continuum subtraction on the full image remains canonical, and AstroBackyard explicitly frames the RGB-star swap as *optional* (neutral/white Ha stars are a legitimate choice). The two approaches are complementary, not competing.

**Residual magenta cleanup:** `Invert → SCNR(Green, Average Neutral, Amount=1.0) → Invert`. Valid because magenta is the exact hue-wheel complement of green; works linear or nonlinear. If too strong, lower Amount or gate with a star mask.

**Caveat on "leak Ha into blue":** some formulas suggest adding a small blue fraction (e.g. `B + 0.2*Boost*(Ha_clean - med)`) to keep emission from going pure-red. **Be careful — this is physically off:** Ha is 656 nm red and does not belong in blue, and adding red-signal Ha to blue **increases** magenta (R+B), rather than preventing it. Treat any blue-leak as an optional taste knob, not a magenta fix; the real anti-magenta levers are continuum subtraction (kill the star contribution) and the green push (Part 4).

**Decision rule:** zoom to bright stars. Pink/magenta cores and/or a red ring = Ha continuum leaking onto stars → sample star pixels in `Ha_clean`; if stars are still visible, **raise `k`** (or fix filter-bandwidth values) until star residual nulls. After blend, star cores should keep their SPCC-calibrated broadband color, halos should not be red-fringed, and nebular Ha should brighten. Prefer the starless-split whenever you already run SXT (this pipeline does).

| Track | Goal | Process | Confidence | Consensus |
|---|---|---|---|---|
| Stars & color | No magenta cores / red halos | Continuum sub + SXT starless-split + screen recombine; invert-SCNR-invert cleanup | high | mixed |

---

## Part 7 — WHERE the Blend Sits: Linear vs Nonlinear Camp

**Neither camp is objectively better** — it is a control-vs-fidelity preference tradeoff, and both are in wide current use.

- **LINEAR camp** — combine while still linear (NBRGBCombination / Vicent Peris method, or PixelMath add-back), **after DBE + SPCC on RGB**, then a **single global stretch** of the combined image. Favored by Peris and Ron Brecher for maximal photometric consistency. Pick it when you want one global stretch across the frame.
- **NONLINEAR camp** — stretch RGB and Ha **separately** to matched brightness, then blend **post-stretch** via PixelMath lighten/max/screen. Favored in newer PixelMath tutorials. Pick it when you want independent control of Ha contrast / star-size vs the broadband stretch. Requires both images stretched to comparable brightness and matched backgrounds first (LinearFit or manual). Screen `~(~RGB * ~Ha)` protects highlights; max/lighten is simplest; additive gives the most punch but risks clipping.

**Firm consensus points — identical in BOTH camps (objective, evidence-backed):**
1. **Exclude Ha from SPCC entirely.** A single narrowband channel has no color ratios to photometrically calibrate — definitional, not stylistic. SPCC runs on RGB only, at/after the combine point.
2. **Continuum-subtract Ha BEFORE any blend** (Part 3) so you inject only true line emission, not leaked starlight/red-continuum. Peris: mandatory, because un-subtracted Ha enhances red areas that are stellar halos/continuum, not nebulae.
3. **Route pure Ha primarily into R** — Ha = 656.3 nm, deep red. This is objective. Optionally leak ~20% into B to represent Hβ, but **this blue share is a cosmetic approximation, NOT objective** — Hβ is not actually measured; some workflows put Ha into R only. Treat it as a taste knob.
4. **Do the Ha→L enhancement in the nonlinear domain feeding LRGBCombination** (Part 5), not as a second linear injection.
5. **Do NOT double-add.** If Ha goes into L (luminance) AND into R (chrominance), that is the intended **two-place** injection — do not additionally re-inject the same Ha into the combined result a third time.

**Manual linear add-back (Galactic Hunter, PixelMath, background preserved via `-med`):**
```
R'       = $T + B * (Ha_pure - med(Ha_pure))
B'(blue) = $T + B * 0.2 * (Ha_pure - med(Ha_pure))
G'       = $T   (unchanged)
```
`B` (blend/boost strength) example = 2 is **illustration only — TUNE [UNSOURCED]**. The 0.2 blue coefficient is the Hβ approximation (see the caveat above).

**Decision rules:** red stellar halos → continuum subtraction insufficient, raise `k`/re-fit. Bloated/magenta stars → `B` too high or Ha not subtracted. Background red cast → `-med()` term omitted or backgrounds not matched (LinearFit). Nebula flat / Ha lost → `B` too low or Ha crushed in the stretch. Choosing camp: need independent Ha star-size/contrast tuning → nonlinear; want one global stretch and tightest photometric consistency → linear.

**Recency note:** the linear-vs-nonlinear debate is long-running and unresolved by recency. Continuum subtraction is long-standing (Bornemann's ContinuumSub dates to 2017; Peris's NBRGBCombination predates 2020). The genuinely recent development is **PCS (~2024) automating the scale factor** — a tooling improvement, not a change to the math. Newer PixelMath-post-stretch tutorials reflect **preference/control, not proven superiority**.

| Track | Goal | Process | Confidence | Consensus |
|---|---|---|---|---|
| Blend placement | Choose linear vs nonlinear injection | NBRGBCombination / PixelMath add-back (linear) OR lighten/max/screen (nonlinear) | high | mixed |

---

## Recommended Full HaLRGB Sequence

```
# PREREQUISITE: fully processed mono-LRGB master (SPCC + LRGBCombination + stretch done, RGB only)

PART 1 — GO/NO-GO GATE
  1. Confirm target has real Ha line emission (emission neb / HII knots) — else STOP.
  2. Stretch a preview of the registered linear Ha: clean signal over smooth bg = proceed;
     grainy/mottled = denoise-first (star-remove -> NXT) or abstain.

PART 2 — HA LINEAR TRACK (parallel to L, same operator order)
  3. StarAlignment: register Ha to the COMMON reference (luminance frame, not R).
  4. DynamicCrop: apply the ONE shared crop instance to Ha.
  5. DBE / GradientCorrection / MGC (subtraction mode) on Ha AND RGB before any subtraction.
  6. BlurXTerminator on LINEAR Ha (Correct-Only, or modest Sharpen-Nonstellar).
  7. NoiseXTerminator (still linear).
  # keep Ha LINEAR — do NOT stretch yet if combining in the linear camp.

PART 3 — CONTINUUM SUBTRACTION (linear, registered)
  8. Derive k: PCS (Max Stars 400, Max Peak 0.8) / NarrowbandNormalization / LinearFit(R->Ha)
     / bandwidth-ratio first guess.
  9. Ha_pure = Ha - k*(R - med(R)).   Median-referenced, NOT raw R.
 10. VERIFY star-nulling: stars sink to bg (dark holes = k too high; white cores = k too low);
     background median unchanged. Prefer median-sub + light k over hard clipping.

PART 4/5/6/7 — BLEND (pick a camp)
 [LINEAR camp]
 11a. NBRGBCombination (RGB bw ~200; Ha bw = filter; Ha scale ~1.2 galaxies / ~4 neb) OR
      PixelMath add-back: R'=R+a*(Ha_pure-med); G'=G+<green_frac>*a*(...); B ~ untouched.
 12a. ColorCalibration / single global stretch of the combined image.
 [NONLINEAR camp]
 11b. Stretch Ha (GHS) to match RGB brightness; LinearFit backgrounds.
 12b. PixelMath lighten/max/screen Ha_pure into R (color) and optionally L (detail).

 13. (Optional) Ha -> L: LinearFit(ref=L), screen/lighten at low w, STARLESS, pre-LRGBCombination.
     Do HaLRGB not LHaRGB — keep L consistent with the color you added.
 14. STAR HANDLING: work starless (SXT linear, unscreen OFF); add Ha only to starless layer;
     screen unmodified broadband stars back LAST.
 15. Residual magenta: Invert -> SCNR(green) -> Invert.
 16. VERIFY: star cores keep broadband color, no red halos, nebula Ha brightened, bg neutral.

# Ha NEVER enters SPCC at any step.  Do NOT double-add (two-place R+L injection is the max).
```

---

## (a) What Changed Recently — and Is It Actually Better?

| Development | Date | Actually new? | Better? |
|---|---|---|---|
| Continuum subtraction (Ha − k·R) | decades old (arXiv 2013; pro Ha imaging far older) | **No** — recency trap. Standard in PixInsight for years | N/A — it is the baseline technique |
| NBRGBCombination (Vicent Peris method) | pre-2020 | No — legacy built-in | Fine, but tends to bloat/tint stars vs continuum subtraction |
| Bornemann ContinuumSubtraction script | 2017 | No | Manual/scripted `k`; superseded in convenience by PCS |
| **PhotometricContinuumSubtraction (PCS)** | **Oct 1 2024** | **Yes — genuinely new tooling** | **Yes for repeatability** — solves `k` from star flux vs eyeballing; result equals a well-star-nulled manual `k` |
| NarrowbandNormalization (native) | recent (Blanshan/Cranfield) | Yes | Comparable photometric solver; no consensus winner vs PCS/SASpro |
| SetiAstro Continuum Subtraction Utility | recent | Yes (exists; internal algorithm unverified) | Automates the same idea; unverified method |
| BlurXTerminator 2.0 / AI4 | **Dec 14 2023** (some sources say Dec 17) | **NOT 2024–2026** — recency trap | Improves star/aberration handling; relevant to Ha *prep*, not to the blend/color pitfall |
| Starless-split default (via SXT) | SXT ~2022+, AI updates through 2024–2025 | Popularity surge is recent; the screen-blend idea is old | Convenient and structurally clean, but **not mandatory** — full-image continuum subtraction remains canonical |

**Bottom line:** the *math* of HaLRGB is old and unchanged; the genuine 2024–2026 gain is **one-click photometric solving of the continuum scale factor** (removing guesswork on `k`). Newer tools do not produce a fundamentally better *image* than a careful manual workflow — they make the correct workflow faster and more repeatable. Blend *strength* remains pure preference.

---

## (b) Contested / Open Decisions

1. **Linear vs nonlinear blend placement** — genuinely contested. Linear camp (NBRGBCombination / add-back, single global stretch; Peris, Brecher) for photometric consistency vs nonlinear camp (matched-brightness lighten/max/screen post-stretch) for independent star/contrast control. No source shows one objectively beats the other.
2. **Ha → L at all?** Peris school keeps Ha purely chrominance (cleanest SNR, most color-faithful); detail-first imagers use Ha/Ha-R as luminance and accept a saturation-recovery step.
3. **Ha → R vs Ha → L vs both** — R is correct for *color*; L is optional detail/SNR only; "both" is common but sequence/consistency (HaLRGB not LHaRGB) matters.
4. **Green push amount and where the off-red fraction goes** — ~20% into *green* (community convention) vs the NightPhotons default of a small fraction into *blue* (`G=0, B=0.05`). Not rigorously derived; empirical tuning target. (And a naive blue leak can *worsen* magenta — see Part 6.)
5. **Continuum subtraction vs plain LinearFit-scaled blend** — subtraction removes the broadband/star component so only line emission blends (cleaner over galaxies/star fields); many nebula workflows blend Ha directly with a scale factor.
6. **Starless-split as the dominant default?** Popular and increasingly go-to, but not unanimous; full-image continuum subtraction is still canonical, and RGB-star swap is framed as optional (white Ha stars are legitimate).
7. **Clip-negatives vs pedestal** after subtraction — reasoning-based, weakly sourced; median-sub + light `k` preferred over aggressive clip.
8. **Blend into blue for Hβ?** Some route ~20% to blue to represent Hβ; others use R only. Hβ is not actually measured — cosmetic approximation, not objective.
9. **Correct-Only vs full deconvolution on Ha** — depends on whether Ha only feeds a color boost (minimal) or carries structural detail for luminance (modest nonstellar-sharpen).
10. **Native NarrowbandNormalization vs PCS vs SetiAstro** — all recent and capable; no consensus winner.
11. **Exact `k`/`Q`/`f` and blend strength `a`/`B`** — inherently per-dataset. Anyone quoting a universal constant is wrong; measure → configure → verify every time.
12. **SASpro Continuum Subtraction Utility's internal algorithm** — tool confirmed to exist; method (linear fit? photometric? clip behavior?) unverified.

---

## (c) Consolidated needsBrowser List

The following URLs were inaccessible during research (403 / SSL / not loaded). Re-fetch each in a browser to confirm the noted claim before treating it as source-verified.

| URL | What to confirm |
|---|---|
| https://pixinsight.com/tutorials/narrowband/ | **Primary source.** Vicent Peris "New Approach to Combination of Broadband and Narrowband Data" — that continuum subtraction is "mandatory," the exact `k` formula, that it is done linear before stretch, and the max/mix operators + Ha-boost ×2..×12 (chrominance) wording |
| https://pixinsight.com/examples/M31-Ha/ | Worked M31 Ha example: continuum-subtraction `k` factor and combine placement |
| https://www.rc-astro.com/software/bxt/ | BXT amount / Sharpen Stars / Sharpen Nonstellar defaults; per-channel narrowband guidance |
| https://www.rc-astro.com/blurxterminator-2-0-ai4-release/ | Exact BXT AI4 release date (Dec 14 vs Dec 17 2023) and change list |
| https://www.rc-astro.com/starxterminator-usage-notes/ | SXT linear vs nonlinear, unscreen-off, subtraction extraction, screen recombine |
| https://www.lightvortexastronomy.com/tutorial-combining-lrgb-with-narrowband.html | Canonical LRGB+NB tutorial: Ha→L and Ha→R placement, bandwidth-weighted subtraction formulas |
| https://www.lightvortexastronomy.com/tutorial-preparing-monochrome-images-for-colour-combination-and-further-post-processing.html | Luminance as alignment reference; LinearFit for mono color-combination |
| https://chaoticnebula.com/pixinsight-lrgbha-combination/ | LRGB+Ha PixelMath walkthrough; blend factors; L-can-run-higher-strength claim |
| https://chaoticnebula.com/how-to-reduce-blurring-in-astrophotos-with-blurxterminator/ | Confirm L can be deconvolved harder than RGB |
| https://www.highpointscientific.com/astronomy-hub/post/astro-photography-guides/ha-rgb-pixinsight | Screen-blend nonlinear formula `~(~BB*~NB)`; confirm post-stretch placement |
| https://www.cloudynights.com/topic/822468-proper-blending-of-ha-w-lrgb/ | Consensus on Ha/LRGB blending |
| https://www.cloudynights.com/forums/topic/751206-how-to-combine-ha-with-lrgb-in-galaxies/ | Galaxy-specific Ha consensus (scale, subtlety) |
| https://www.cloudynights.com/forums/topic/787918-ha-as-luminance/ | Ha-as-luminance opinions; the ~30% opacity figure |
| https://www.cloudynights.com/forums/topic/725936-problems-combining-ha-and-red-channel-in-pixinsight/ | Magenta/halo cause consensus |
| https://www.cloudynights.com/topic/946231-what-is-the-best-way-to-add-continuum-ha-to-rgb/ | Best-practice add-Ha-to-RGB consensus |
| https://www.cloudynights.com/forums/topic/993260-pixinsight-help-needed-lrgb-ha-processing-for-reflection-nebula/ | Reflection-nebula Ha edge case (Part 1 skip logic) |
| https://app.astrobin.com/forum/topic/201571/.../incorporating-ha-into-rgb-images | Linear vs nonlinear Ha-into-RGB consensus |
| https://app.astrobin.com/forum/topic/138868/new-script-photometriccontinuumsubtraction-pixinsight | PCS mechanism: star detection, DynamicPSF flux pairs, linear flux-ratio fit |
| https://app.astrobin.com/forum/topic/183748/.../continuum-subtraction-in-nebulas | Continuum subtraction practice in nebulae |
| https://pixinsight.com/forum/index.php?threads/adding-ha-to-red-channel-and-luminance-channel.18021/ | On-topic: Ha into R AND L; linear vs nonlinear consensus |
| https://pixinsight.com/forum/index.php?threads/mtf-and-adding-continuum-subtracted-nb-to-bb.20074/ | `mtf()` nonlinear-domain matching math |
| https://pixinsight.com/forum/index.php?threads/combining-ha-with-lum.9145/ | Ha-into-luminance discussion |
| https://pixinsight.com/forum/index.php?threads/adding-ha-to-nebula-image.3279/ | Adding Ha to nebula images |
| https://pixinsight.com/forum/index.php?threads/using-pixelmath-to-get-rid-of-magenta-stars-in-sho-hubble-palette-narrowband.7128/ | PixelMath magenta-star removal |
| https://remoteastrophotography.com/using-scnr-with-an-inverted-image-to-reduce-or-eliminate-magenta-stars-in-narrowband-images/ | invert → SCNR(green) → invert method (page now 410) |
| https://chaoticnebula.com/pixinsight-lrgbha-combination/ | LRGB+Ha combination formulas and blend factors |
| https://jonrista.com/the-astrophotographers-guide/pixinsights/narrow-band-combinations-with-pixelmath-hoo/ | PixelMath narrowband combination reference |
| http://www.robgendlerastropics.com/HARGB.html | Classic HaRGB luminance-blend guidance |
| https://www.setiastro.com/pjsr-scripts | SetiAstro Continuum Subtraction Utility + NBRGB Combination — confirm algorithm |
| https://telescope.live/tutorials/mastering-h-alpha-contrast-guide-pixinsights-continuum-subtraction-script | Continuum-subtraction script walkthrough |
| https://www.youtube.com/watch?v=QVYksOHlwHk | SASpro Galaxy Continuum Subtraction example — confirm tool behavior |
| https://arxiv.org/pdf/1311.3665 | Skewness Transition Analysis — evidence continuum subtraction is long-standing |
| https://github.com/areinartz/PI_ContinuumSubtraction | Long-standing continuum-subtraction script (recency-trap reference) |
