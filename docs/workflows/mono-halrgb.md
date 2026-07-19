> ⚠️ PROVISIONAL — NOT LIVE-SOURCE-VERIFIED. This run exhausted the session WebSearch budget (200/200) and authoritative pages 403d, so unlike the other category playbooks it rests on domain knowledge + adversarial cross-check only, NOT verified 2025-2026 sources. Physics/method is sound; all numeric coefficients and PixelMath strings are [UNSOURCED] starting points to tune. Re-verify (browser or a fresh run when the search budget resets) before treating as final. Builds on docs/workflows/mono-lrgb.md.

# MONO-HaLRGB PixInsight Processing Playbook

*Assumes the full LRGB master is already built and processed per the standard mono-LRGB workflow (calibrate → register all channels to one common reference → integrate → DBE/GradientCorrection → BXT → deconv/denoise → SPCC on RGB → stretch → LRGBCombination → curves). This playbook covers only the Ha additions layered onto that spine.*

**Sourcing caveat (applies globally):** Every finding below was generated in a session where the WebSearch budget was exhausted (200/200) and all authoritative pages (RC Astro, Light Vortex, PixInsight docs/forum, SetiAstro, Cloudy Nights) returned 403 / SSL / 404. **No claim was verified against a live 2025-2026 source.** Content rests on domain knowledge + adversarial cross-check only. Physics/geometry claims are robust; all numeric coefficients and exact PixelMath strings are **illustrative starting points, NOT source-quoted** — flagged inline as `[UNSOURCED]`.

---

## Part 1 — When HaLRGB Is Worth It

| | |
|---|---|
| **Track** | Ha-track (linear) |
| **Goal** | Decide whether to spend the Ha integration + processing risk |
| **Rule** | **Strong yes:** emission nebulae (diffuse HII, SNRs, planetaries) and star-forming galaxies with HII knots (M31/M33/M81/M101, NGC spirals). **Skip:** reflection/dust-only nebulae, star clusters, old-population/elliptical galaxies — Ha adds noise + magenta risk for little payoff. |
| **Cost/benefit** | Worth it only if the Ha master is **high-SNR**. A thin/undersampled Ha master mostly imports noise and tempts an overdone magenta result. Marginal value rises under light-polluted skies and for faint outer emission; from a dark site plain LRGB may already capture the brightest Ha. |
| **Confidence** | Medium |
| **Consensus** | Consensus. **Objectively better** (physics): a 3-7 nm narrowband filter demonstrably raises emission-line SNR/contrast vs the ~100 nm broadband R by rejecting continuum + light pollution. The *degree* of enhancement is preference. |

---

## Part 2 — The Separate Ha-TRACK (linear, parallel to the LRGB spine)

Ha runs as its own monochrome linear track, in the same operator order as L, and **never touches SPCC** (single narrowband channel — no color to photometrically calibrate; SPCC's star-color database assumes broadband).

### 2.1 Register + shared crop
| | |
|---|---|
| **Goal** | Pixel-for-pixel alignment of Ha to L/R/G/B |
| **Process** | StarAlignment Ha to the **same common reference as L/R/G/B** (typically the L master — best star SNR). Do NOT register Ha only to R. Then apply **ONE identical DynamicCrop** (same rectangle/instance) to all five masters. |
| **Ha-specific** | Ha is grayscale — no debayer, no SPCC. If Ha stars too sparse to solve: raise star-detection sensitivity, enlarge match tolerance, or use a distortion model. |
| **Verify** | Blink Ha vs R/L, or PixelMath `R - Ha_normalized` and check stars have no residual halo offset **before** any subtraction/blend. |
| **Confidence / Consensus** | Medium (thin sourcing) / consensus. **Objectively required** — per-pixel subtraction and blending are geometrically meaningless without pixel correspondence + identical dimensions. Misregistration → uncorrectable star rings, red/pink fringing, ghosting in L. |

### 2.2 Gradient / background removal (linear)
DBE / ABE, or **GradientCorrection** / GraXpert, Subtraction mode. Place samples on true background only (Ha has strong faint nebulosity). NB gradients are usually milder than broadband but still correct for a seamless blend. *Recency note: GradientCorrection is increasingly favored over DBE/ABE for linear gradients.*

### 2.3 BlurXTerminator (linear, BEFORE stretch)
| | |
|---|---|
| **Objective constraint** | BXT **must** run on linear data (RC Astro design requirement) — not preference. |
| **Modes** | (a) *Correct Only* (fix PSF/aberrations, no sharpen), or (b) modest deconv: `Sharpen Stars ~0.25-0.50, Sharpen Nonstellar ~0.7-0.9` `[UNSOURCED numbers]`. Ha's high structural contrast sharpens well; keep star sharpening low to avoid dark rings. |
| **Confidence** | Medium. Mode choice is preference; the linear requirement is objective. |

### 2.4 NoiseXTerminator
After BXT (linear or early nonlinear). Ha SNR per structure is often lower than L, so denoise matters — but don't over-smooth; the Ha detail is the payload. Moderate denoise + modest detail recovery.

### 2.5 Stretch
GeneralizedHyperbolicStretch (preferred, best control on high-contrast Ha) or STF-guided HT / MaskedStretch. Match the Ha stretch roughly to the L/RGB stretch so blended tonal ranges are comparable — or keep it slightly gentler and control strength at blend time.

> **Do NOT** run SCNR on mono Ha (no green). **Keep the master LINEAR through the point of continuum subtraction** (Part 3) — subtraction is only physically valid in linear flux.

---

## Part 3 — Continuum Subtraction (isolate pure Ha from broadband R)

| | |
|---|---|
| **Track** | blend-into-R (also feeds L) |
| **Goal** | An Ha master = broadband continuum (all red starlight incl. stars) + the Ha line. R contains that *same* continuum. Blending raw Ha double-counts continuum → bloated stars → overdone magenta. Subtraction removes the broadband component so you add **only genuine line emission**. |
| **Core expression** | `Ha_pure = max(0, Ha - k*R)` — clip negatives; some add a small pedestal. Both images **must be registered and on comparable linear scale** first. |
| **Confidence** | Medium. **Objectively better** than blending raw Ha (correctness point — prevents double-counting + star bloat), not aesthetic. |

### How to get the scale factor `k` (per-image — never hard-code)
1. **Star-nulling (empirical, most intuitive):** stars are pure continuum with no Ha line. Tune `k` up/down until stellar residuals vanish (~0) in `Ha_pure`. This is the practical target/check.
2. **LinearFit (robust, automatable):** LinearFit R to Ha → slope `m`, offset `b`; then `Ha_pure = Ha - (m*R + b)`. Handles differing background/scale automatically. What most tools wrap.
3. **Bandwidth/flux ratio (physical):** `k` ≈ ratio of effective passband transmission (NB Ha passes far less continuum), so `k` is typically well below 1. Verify empirically.

Typical tuned range `k ~0.3-1.0` `[UNSOURCED heuristic]` — data/filter dependent, **not a constant. Do not fabricate a value.**

### Tool options
- **PixelMath** — manual `Ha - k*R` (full control).
- **NBRGBCombination** (native) — supply broadband + NB bandwidth params + scale weights; does **bandwidth-ratio weighted addition**, *not* an explicit per-pixel `Ha - k*R` subtraction. *(Adversarial correction: the finding's gloss slightly overstates this — treat NBRGB as continuum-*aware* scaled combine, not rigorous subtraction.)*
- **SetiAstro Suite Continuum Subtraction** — automates regression/star-nulling `[existence/algorithm UNVERIFIED]`.

**Contested:** clip-negatives vs pedestal (minor); PixelMath vs NBRGB vs SetiAstro (preference, not correctness).

---

## Part 4 — Blending Ha into RED (HaRGB)

| | |
|---|---|
| **Goal** | Boost nebular Ha color naturally without magenta |
| **Confidence** | Medium / consensus on principle |

### Methods (most-natural → crudest)
1. **Continuum-subtracted PixelMath addition (recommended):**
   - Isolate: `Ha_only = max(0, Ha - k*R)`, tune `k ~0.7-1.0` (after comparable scaling) so star cores/faint bg → ~0. `[UNSOURCED]`
   - Blend: `R' = R + a*Ha_only`, strength `a ~0.5-0.8`. `[UNSOURCED]`
   - **Anti-magenta tweak:** also push a fraction into green: `G' = G + (0.15..0.25)*a*Ha_only` — turns pure-red/magenta into the natural salmon/pink of real HII regions. `[UNSOURCED]`
2. **NBRGBCombination** — built-in continuum-aware weighted combine. Expects **LINEAR** data, run **after SPCC, before stretch**. Best low-effort route; can look blocky/magenta on defaults.
3. **screen:** `R' = R + Ha - R*Ha` — gentler, self-limiting near white.
4. **max / lighten:** `R' = max(R, Ha)` — simplest but overdrives, bloats Ha stars — the **classic overdone-magenta cause. Not recommended.**

### Avoiding overdone magenta (decision rules)
- Continuum-subtract — add only genuine excess (the main fix; magenta comes from double-counting red SPCC already balanced).
- Distribute ~0.2× Ha into green → shifts magenta toward natural salmon.
- Keep strength moderate (`a ~0.5-0.8`); tune `k` so stars/bg don't inflate.
- **Work starless** (see Part 6).
- Tame residual reds afterward with a saturation mask / curves, not by killing the blend.

---

## Part 5 — Blending Ha into LUMINANCE

| | |
|---|---|
| **Goal** | Optional, gentle SNR/detail boost — NOT the primary way to show Ha |
| **When it helps** | Recover **faint structure** L genuinely lacks: outer nebulosity, faint filaments, low-surface-brightness shells (regions where Ha out-SNRs broadband L). |
| **When it hurts** | Dumping raw/heavy Ha into L is the biggest cause of the flat/lifeless look: L carries all detail+brightness, so globally brightening emission regions crushes their saturation and shrinks LRGBCombination's chrominance headroom. |
| **Method** | Blend on the L track **before LRGBCombination**, using **lighten/screen (never raw max)** so you never darken existing L: `L' = max(L, k*Ha_scaled)` or softer screen `~((~L)*(~(k*Ha)))`, `k ~0.2-0.5` `[UNSOURCED]`, Ha pre-scaled via LinearFit to L. Keep **stars out** of the Ha contribution (starless Ha or star mask) to avoid dark rings/halos. Blend both-linear (best SNR math) or both-nonlinear (easier tuning). |
| **Confidence** | Medium. **Objectively true** (signal theory): adding higher-SNR Ha to noise-limited L raises luminance SNR there. Also objective: raising a pixel's lightness reduces its max achievable saturation → heavy Ha-to-L necessarily desaturates bright emission. *How much* to blend is preference. |

> *Adversarial refinement:* saturation is not strictly monotonic in lightness (LRGBCombination works in CIE L\*a\*b\*/L\*c\*h\*, not HSL; saturation peaks near mid-tones), but the practical conclusion — all-Ha-into-L looks flat — holds either way.

### Ha-to-R vs Ha-to-L vs both
- **Ha→R** changes **hue/saturation** (nebula color); needs continuum subtraction to avoid magenta.
- **Ha→L** changes **detail/brightness** (structure, SNR); no hue shift, but erodes saturation if overdone.
- **Complementary, not substitutes. Mature approach = both:** strong-but-clean Ha in R for color + light Ha in L for faint-structure SNR, then use LRGBCombination Saturation/Lightness sliders + chrominance NR to recover the saturation the L-blend costs. **If forced to pick one for a natural result: favor Ha→R, use Ha→L sparingly.**

---

## Part 6 — Star & Color Handling

| | |
|---|---|
| **Core pitfall** | Ha into R (or L) boosts stars in red only → pink/magenta cores + red halos; Ha PSF often larger → halo mismatch with RGB stars. |
| **Confidence** | Medium |

**Two mutually-reinforcing fixes (both objectively target the physical cause, not cosmetic):**
1. **Continuum subtraction before any blend** (Part 3) — removes broadband stellar signal so blending `Ha_net` inherently suppresses magenta stars.
2. **Starless split** (popular modern method): StarXTerminator → remove stars → do ALL Ha enhancement on the **starless** nebula (into starless R and/or L) → screen the **unmodified RGB stars** back on top last: `result = max/screen(starless_blended, stars_original)`. Fully decouples nebula Ha boost from star color.

*Adversarial correction:* the starless split is **increasingly common / a popular modern approach**, NOT a proven universal "default consensus" — NBRGBCombination and direct continuum-subtracted PixelMath blends remain common. AI star removal is a genuine capability gain, but "dominant default" overstates it.

**Blend mechanics that protect stars:** gate the add with a nebula/range mask or inverse star mask so star cores are excluded: `R_new = R + Ha_net` or `max(R, Ha_net)`, masked.

**Residual magenta cleanup (Ha problem is MAGENTA, not green — plain SCNR won't fix):**
- **Invert → SCNR (remove green) → Invert back** — mechanically correct: magenta = inverse of green.
- Or CurvesTransformation hue channel rotating magenta → red; or star-mask desaturation; or reduce Ha opacity.

**Star reduction:** if Ha halos bloated, run star reduction on Ha before blend, or always take stars from the tighter-PSF (usually RGB/L broadband) channel. **Do SPCC on RGB before any Ha injection** so star colors are set first.

---

## Part 7 — WHERE Blending Sits in the Sequence

Ha→R has **two valid, genuinely contested placements**:

- **(A) LINEAR blend** (classic NBRGB school): after RGB is DBE'd + SPCC-calibrated but **still linear**, combine continuum-subtracted Ha into R (NBRGBCombination), then stretch the combined RGB as one image. Keeps star colors/channel relationships consistent through a single stretch. Physically correct (subtraction meaningful in linear flux).
- **(B) NONLINEAR blend** (modern PixelMath school): stretch RGB and Ha separately to matched brightness, then blend into R post-stretch via lighten/max/screen. Finer, tunable control; easier to keep natural / judge magenta by eye. Trades single-stretch consistency for per-step control.

**Neither is objectively better — pick ONE camp, do not double-add.**

Ha→L is added to L **nonlinearly, BEFORE LRGBCombination**, via max/lighten/screen so structure brightens without darkening.

**Firm consensus regardless of camp:** (1) Ha excluded from SPCC; (2) continuum-subtract before blending; (3) Ha into R not B (blue is the other magenta source); (4) Ha→L done nonlinear before LRGBCombination.

---

## Recommended Full HaLRGB Sequence

```
LRGB spine (assumed done): calibrate → register ALL masters (L,R,G,B,Ha)
   to one common reference (linear) → integrate → shared DynamicCrop.

RGB path:
  1. RGB linear prep: DBE/GradientCorrection → SPCC (Ha EXCLUDED).

Ha path (parallel, linear):
  2. Ha linear prep: DBE/GradientCorrection → BXT (linear) → NXT.
     (optional StarXTerminator → starless Ha)
  3. Continuum-subtract:  Ha_pure = max(0, Ha - k*R)
     (k via star-nulling or LinearFit; tune so stars → ~0)

Blend into RED — pick ONE camp:
  4a. LINEAR camp:  NBRGBCombination on linear RGB (after SPCC, before stretch)
  4b. NONLINEAR camp: stretch RGB + Ha_pure to matched brightness, then
      R' = R + a*Ha_pure   (a~0.5-0.8),   G' = G + 0.2*a*Ha_pure

  5. Stretch RGB (if not already stretched in 4a).

Luminance:
  6. Build/stretch L; blend starless Ha_pure into L (nonlinear):
     L' = max(L, k*Ha_scaled)   (k~0.2-0.5) — faint structure only.

Combine:
  7. LRGBCombination: apply enhanced L' to Ha-enhanced RGB.

Cleanup:
  8. Star handling (starless split re-add if used) → invert-SCNR-invert for
     residual magenta → curves/saturation → done.
```

*All coefficients `[UNSOURCED starting points]` — tune per dataset.*

---

## (a) What Changed Recently — and Is It Actually Better?

| Change (2024→2026) | Actually better? |
|---|---|
| **BXT / SXT / NXT AI models, GraXpert, GradientCorrection, NarrowbandNormalization** | **Ergonomics only.** Makes preparing a clean linear Ha master + handling stars easier and sharper. Does **not** change *when* Ha is worth it or the blend math. This is a real capability gain (input quality), not fashion. |
| **Shift away from NBRGBCombination → continuum-subtracted PixelMath / SetiAstro scripts** | Better *for a natural look* — but because **continuum subtraction is correct signal-physics**, NOT because it's newer. Continuum subtraction is a **long-standing** technique (classic PixelMath, Peris/Cannistra lineage); framing it as "the biggest 2024→2026 change" is one narrative, not established fact. |
| **Starless split via StarXTerminator** | Genuine improvement for star-color preservation (removes the star-color mismatch entirely). **Increasingly common / popular**, but "dominant default consensus" is overstated — verify. |
| **SetiAstro Suite (SASpro) continuum-subtraction / NB-normalization tools** | Real, popular convenience wrappers around the same isolate-then-add math. Specific tool names/params/attribution (Franklin Marek "popularized" it) **UNVERIFIED**. |

**Net:** fundamentals (Ha's role, continuum subtraction, SPCC exclusion) are stable and unchanged. "Newer" is genuinely better only on prep-tool ergonomics + AI star removal. Do not treat the recency narrative as evidence of superior method.

---

## (b) Contested / Open Decisions

1. **Ha→R vs Ha→L vs both** — target-dependent preference. Mature = both; if picking one, favor R.
2. **Linear vs nonlinear Ha→R blend timing** — NBRGB (linear, single-stretch consistency) vs PixelMath (nonlinear, per-step control). Both valid; no objective winner.
3. **Continuum subtraction vs low-opacity screen/lighten without formal subtraction** — both camps report natural results.
4. **Synthetic super-luminance (L+Ha, ± R)** vs keeping L purely broadband — SNR/detail gain vs saturation cost.
5. **Blend expression** — additive vs screen vs lighten/max; and clip-negatives vs pedestal.
6. **`k` and `a` values** — data/filter dependent; no universal constant. Tune per image.
7. **Any Ha into blue?** — most say no or trace only.
8. **NBRGBCombination vs PixelMath vs SetiAstro** — workflow preference; PixelMath+starless argued better at avoiding magenta stars, but not universally.

---

## (c) Consolidated needsBrowser List

**All returned 403 / SSL failure / 404 this session — none verified. Priority: fetch to confirm 2025-2026 wording, current tool defaults, and exact expressions/coefficients before treating any number as canonical.**

- `https://www.rc-astro.com/wp/2023/03/13/halrgb-combination/` (403) — HaLRGB combination guidance
- `https://www.rc-astro.com/blurxterminator/` and `/tips/` (403) — current linear NB / Correct-Only settings
- `https://www.rc-astro.com/resources/StarXTerminator/` (403) — starless-split workflow
- `https://www.lightvortexastronomy.com/tutorial-combining-ha-and-oiii-data-into-lrgb-images.html` (SSL)
- `.../tutorial-combining-narrowband-with-broadband.html` (SSL) — NB linear prep + continuum subtraction
- `.../tutorial-combining-monochrome-ha-with-rgb.html` (SSL) — Ha→R PixelMath expressions
- `.../tutorial-combining-and-blending-narrowband-Ha-into-LRGB.html` (SSL)
- `https://pixinsight.com/doc/tools/NBRGBCombination/NBRGBCombination.html` (403) — internal bandwidth/scaling math + default bandwidth values
- `https://pixinsight.com/forum/` (403) — 2025-2026 HaLRGB / k-factor / LinearFit / magenta-star threads
- `https://www.setiastro.com/` (404/portfolio only) — SASpro Continuum Subtraction + NarrowbandNormalization tool names, params, algorithm, release dates
- `https://www.cloudynights.com/topic/807650-adding-ha-to-rgb-in-pixinsight/` (403) — PixelMath vs NBRGBCombination consensus

**Specific items to confirm in-browser:** (1) current recommended BXT/NXT NB defaults; (2) whether GradientCorrection has officially superseded DBE/ABE for linear gradients; (3) NBRGBCombination default bandwidth values + whether it does any real subtraction; (4) SetiAstro Continuum Subtraction algorithm + correct tool names/attribution; (5) any dated evidence that starless-split is truly "dominant" vs merely popular.