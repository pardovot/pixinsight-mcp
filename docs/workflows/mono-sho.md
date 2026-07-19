> Provenance: Tier-1 capstone. 19-leg multi-agent web research (2025-2026) + adversarial verification (recency traps, aesthetic-vs-objective, stage correctness). Builds on the mono spine; diverges at the combine point. Palette is false-color/aesthetic; mono SPCC uses real filter+sensor QE (NOT OSC Ideal-QE). Unsourced numbers flagged [UNSOURCED].

# MONO-SHO PixInsight Processing Playbook

*You have three monochrome narrowband masters — SII, Ha, OIII — and you are about to build a **false-color** image: an arbitrary assignment of invisible emission lines to R/G/B. SHO builds on the standard mono spine (per-channel calibrate → register every channel to one common reference → integrate → one shared crop → per-channel linear prep) and then **diverges at the combine point**, where the pipeline stops being a recipe and becomes a palette. SHO is the most contested of the six categories precisely because most of what people argue about — the palette, the hue targets, static vs dynamic mapping — is **aesthetic, not physical**. This playbook is relentless about separating the handful of objective points (register to one reference; balance channels so one line doesn't swamp; BXT on linear per channel before mixing; mono real-QE SPCC) from the large aesthetic space where "correct" simply does not exist.*

---

## Live Debates — Resolved Up Front

| Debate | Honest verdict | Confidence / consensus |
|---|---|---|
| **Linear vs nonlinear NB combine** | DEFAULT to **linear combine** (LinearFit → ChannelCombination while linear → one shared stretch). The tie-breaker is physical, not aesthetic: a single shared stretch keeps star profiles identical across R/G/B and prevents mismatched per-channel star edges → colored (usually blue) halos and bloat. The nonlinear route (masked-stretch each channel to matched brightness first, then combine) is a legitimate, widely-taught alternative that trades star-profile integrity for finer per-channel brightness control. Two durable schools; both publish good SHO. | medium / **contested** |
| **Dynamic (Foraxx) vs static palette mapping** | DEFAULT to **static** linear mapping (SII→R, Ha→G, OIII→B) as the reproducible, sourceable baseline; offer **dynamic (Foraxx-style)** as an *optional alternate combine node*, never a replacement. Dynamic is **not objectively better** — it is a per-pixel blend that produces smoother Ha/OIII transitions and a softer gold/teal look, at the cost of reproducibility and interpretability. Every primary source frames it as per-target preference ("no definitive answer"). The 2022–2026 Foraxx popularity wave is fashion signal, not evidence of a quality jump. | high / **mixed** |
| **Does SPCC apply to SHO?** | For the **nebula palette — no.** The SII→R/Ha→G/OIII→B mapping is arbitrary false-color; no photometric process can make it "correct." SPCC's photometric solve is **star-driven** and only meaningfully fixes **star color / cross-channel star balance**. So SPCC is **optional and commonly skipped** on the SHO nebula (theAstroShed 2024 skips it as a mere sanity check); it earns its place only if you want photometrically sensible star color, ideally applied to a *separate* broadband/RGB star field. | high / **contested** |

---

## Part 1 — Palette Choice (aesthetic first, objective second)

**Default to the classic static Hubble/SHO mapping — R = SII, G = Ha, B = OIII —** as the reproducible baseline, then treat the actual color as an aesthetic decision, not a physical one. Ha usually carries the strongest signal and sits in the *center* channel (green), so the other two lines frame it. `[SOURCED, consensus]`

**The only objective parts of palette work are:** (a) correct emission-line-to-channel assignment for the palette you chose; (b) channel balance so the strongest line (nearly always Ha in green) doesn't swamp everything; (c) clean per-channel linear prep before combine. **Everything about hue is preference.** State this plainly in any UI or doc: the final SHO color is false-color.

| Palette | Mapping | When |
|---|---|---|
| **Classic SHO / Hubble** | R=SII, G=Ha, B=OIII | Default; all three channels usably strong `[SOURCED]` |
| **HOO bicolor** | R=Ha, G=OIII, B=OIII | SII weak/absent, or only Ha+OIII available `[SOURCED variant]` |
| **HSO / HOS etc.** | same three channels permuted | Arbitrary false-color permutations — pure preference |
| **Foraxx / dynamic** | per-pixel adaptive (Part 5) | You want the softer bronze/less-blue adaptive look; good Ha/OIII overlap |

**Illustrative** static de-green blend (NOT a mandated recipe): `R=SII, G=0.8*Ha + 0.2*OIII, B=OIII` — shows the "bleed OIII into green to fight green dominance" idea. Treat `0.8 / 0.2` as `[UNSOURCED — tune to your data]`, not universal.

**When to deviate from straight SHO:** measure the three registered masters' relative signal (per-channel median/noise; how strong OIII and SII are vs Ha). Drop to **HOO/bicolor** if SII (or OIII) is too weak/noisy to carry a color. Choose a **dynamic** palette only if you specifically want its adaptive look and the data supports it. Dynamic is a legitimate alternative, **not an objective upgrade** — the same author (Night Sky Pics) found SHO won on one target and dynamic won on another: explicit "no definitive answer."

---

## Part 2 — Per-Channel NB Linear Prep

Treat S, H, O as three independent mono **linear** tracks that share **one geometry** and are prepped identically, **diverging only in denoise strength.**

1. **Register to ONE common reference** — StarAlignment all channels to a single reference master (usually **Ha**: densest star field, registers most robustly), or set one registration reference in WBPP so everything lands on one geometry. Register-to-one-reference is **objectively required** — misregistration = color fringing at combine. `[OBJECTIVE]`
2. **ONE shared crop** — after registration, `DynamicCrop` once, then apply the **same** instance to all three so geometry is pixel-identical. No per-channel independent cropping. `[OBJECTIVE]`
3. **Gradient removal, per channel, while linear** — DBE / GradientCorrection / MGC / ABE / GraXpert all valid; **DBE** is the frequent NB default because you place samples manually on true (dark, sparse) background. Do each channel separately — **gradients are filter-specific and OIII is usually the worst** (LP/skyglow-dominated). Tool choice is preference; verify with a strong STF that no large-scale gradient remains.
4. **BlurXTerminator on LINEAR, per channel, BEFORE combine** — non-negotiable: BXT requires linear, un-noise-reduced data, and RC Astro is explicit that channel-mixing must happen **after** deconvolving in distinct-channel form ("one filter per color channel") — mixing first blends distinct PSFs and corrupts deconvolution. `[OBJECTIVE — both order and linearity]`
   - **Correct-Only** = aberration/PSF correction, no sharpening (safest). **Full deconv** adds Sharpen Nonstellar (useful range ~0.6–0.9 `[UNSOURCED]`) + Sharpen Stellar (keep **low**, ~0.0–0.3 `[UNSOURCED]`, or bright NB stars get dark rings/black cores). Correct-Only vs full is a real **risk-tolerance choice**, not settled by evidence. Values could not be source-loaded (RC Astro 403); measure on a preview, blink at 1:1, back off until no halos/ringing on Ha filaments.
5. **NoiseXTerminator on LINEAR, per channel, AFTER BXT** — **this is where channels diverge.** OIII and SII are genuinely lower SNR than Ha, so **denoise them harder than Ha** — this is objectively justified by their lower SNR. `[OBJECTIVE]` A search-summary starting point of ~60–75 denoise / ~15–25 detail for SII/OIII is `[UNSOURCED]` — measure: raise denoise until background is smooth without plastic clumping, lower detail until faint structure survives, keep Ha lightest.
6. **No separate deconvolution** — subsumed by BXT.

**What differs from broadband mono prep:** gradient removal matters more and is per-filter (OIII worst); denoise is deliberately **unequal** across channels; there is **no physical color truth** (SPCC does not define the palette — Part 8); the combine is aesthetic mapping, so cross-channel *balance* is the substance, not white balance.

---

## Part 3 — Channel Balancing (why balance drives color)

Balance the three channels so no single one dominates the false-color palette. This is **the substance of getting predictable color** — but LinearFit is **one** valid route, not mandatory. Two defensible schools:

| Route | Method | Source |
|---|---|---|
| **A — before combine** | LinearFit two channels to a chosen reference **while linear**, then ChannelCombination/PixelMath S→R/H→G/O→B | jonrista |
| **B — after combine** | Combine raw channels first, then **AutoLinearFit** on the RGB (GREEN/Ha as reference) + **NarrowbandNormalization** on the (preferably starless) stretched RGB | theAstroShed 2024 |

**The reference-channel choice is the most contested knob** and is partly aesthetic:

- **Ha** — common default.
- **Weakest / lowest-noise channel** (jonrista, via NoiseEvaluation) — **objectively** improves combined SNR: "fitting to the strongest channel can result in worse SNR when the channels are combined." This is an SNR argument, not taste. `[OBJECTIVE]`
- **SII** (Light Vortex, via SSL-blocked snippet) — specifically to keep Ha from overpowering the palette.

Note jonrista states "use Ha as reference" **and** "fit to the weakest channel" together — these are in tension (Ha is usually strongest); there is no single rule. LinearFit has no numeric params; leave reject at defaults unless a channel clips.

**NarrowbandNormalization (Blanshan + Cranfield)** normalizes channel brightness, boosts SII/OIII, and has built-in SCNR-green + an SHO/HOO selector and linear/non-linear mode. Install repo: `https://www.cosmicphotons.com/pi-modules/narrowbandnormalization/`. It is an **alternative/complement** to LinearFit — **not proven objectively superior**; it packages an aesthetic and interactive preview, LinearFit gives deterministic, reproducible balancing. Both are legitimate.

**Verify balance:** after fitting, stack channel windows and `Ctrl+PgDn` to swap/compare, and check per-channel background medians converge so one channel doesn't tint the whole palette. The target is a *look*, so iterate reference choice and sliders against the visual, not a physical standard.

---

## Part 4 — The Combine (linear vs nonlinear)

**DEFAULT — linear combine:**

1. LinearFit the three registered masters to a common reference (**fit to the weakest channel** to protect SNR — jonrista verbatim: *"For linear fit, I recommend fitting to the weakest channel."* Which physical channel is weakest is dataset-dependent — measure, don't hardcode).
2. Combine **while linear** — ChannelCombination or PixelMath, SII→R, Ha→G, OIII→B.
3. Apply **ONE shared stretch** (STF/GHS) to the combined SHO.
4. Do normalization/SCNR-green/hue after (Parts 3, 6).

**Why linear is the defensible default (objective, palette-independent):** a single shared stretch keeps star profiles identical across R/G/B. jonrista: *"With a linear blend … star halo issues can be greatly mitigated,"* whereas nonlinear blends risk *"strong colored halos, frequently blue"* because star profiles stretch differently per channel. Linear data also calibrates/normalizes more correctly. This benefit holds even though the hue mapping is arbitrary.

**The nonlinear school** (Galactic Hunter; The Coldest Nights): masked-stretch each channel to matched brightness first, LinearFit, then combine — *"for greater control over the final image."* The Coldest Nights explicitly names *"two schools of thought"* and points to jonrista for the linear method. **Do NOT stretch channels independently to taste** either way — that breaks the palette color relationships. Balance comes from matched stretch or a balance tool, never eyeball per-channel stretching.

**Decide from the STARS, not the nebula hue** (hue is arbitrary in SHO): split-view/blink star cores + halos across R/G/B and check per-channel FWHM. Consistent profiles + neutral halos → linear path is working. Colored (typically blue) halos, mismatched star sizes, or one channel's stars bloated → that is the nonlinear differential-stretch pitfall; combine linear with a single shared stretch. Note chroma (a*/b*) curve work is *"overpowering on linear data, much easier on non-linear"* — do it after stretch.

---

## Part 5 — Palette Mapping Mechanics

Treat combine as a spectrum of increasingly data-adaptive tools. **Build STATIC first as ground truth**, then optionally A/B a dynamic map.

**Operators:** `~x` = inverse = `(1 - x)`; `^` = exponentiation. **PixInsight PixelMath supports `^` and `~` natively**, so the expressions below run as-is — this is *unlike* the project's `pow()` rule (which concerns arbitrary exponents in the GHS fallback); the `^` operator itself exists in PixelMath. Verify at build time.

**Static SHO (ChannelCombination)** `[SOURCED, consensus]` — SII→Red, Ha→Green, OIII→Blue. Deterministic Hubble palette, green-dominant by construction. Its objective advantage for an automated pipeline: **reproducibility + sourceability** (fixed, recordable math).

**Static PixelMath blend** — add fixed fractions of one channel into another to warm/de-green (e.g. bleed Ha into R and B). Coefficients are per-image aesthetic `[UNSOURCED]` — never hardcode.

**Dynamic "Foraxx"-style SHO** `[SOURCED VERBATIM — confirmed identical across The Coldest Nights (Ludo, June 2020) and x-bit-astro]`:

```
R = (Oiii^~Oiii)*Sii + ~(Oiii^~Oiii)*Ha
G = ((Oiii*Ha)^~(Oiii*Ha))*Ha + ~((Oiii*Ha)^~(Oiii*Ha))*Oiii
B = Oiii
```

**Dynamic Ha/OIII (HOO-blend "Foraxx" bicolor)** `[SOURCED VERBATIM]`:

```
R = Ha
G = ((Oiii*Ha)^~(Oiii*Ha))*Ha + ~((Oiii*Ha)^~(Oiii*Ha))*Oiii
B = Oiii
```

`Oiii^~Oiii` = `Oiii^(1-Oiii)` — a per-pixel adaptive weight → ~1 where the channel is strong, pulling toward the other channel where weak. This is the real, verifiable **mechanism** (pixel-adaptive blend factors, not constants) that yields smoother Ha/OIII transitions and softens the hard green→magenta edge. That mechanism is genuine **capability**; "which look is better" is aesthetic. **Apply dynamic combines to non-linear, stretched, starless data.**

**Bill Blanshan HOSNormalization_V8 core** `[SOURCED VERBATIM, starlust astroguide]`:

```
M = (min($T)+Blackpoint*(med($T)-min($T))/1);
E0 = adev($T)/1.2533 + mean($T) - M;
A0 = E0/~M[1];
E1 = (A0[1]*(1-A0[0])/(A0[1] - 2*A0[1]*A0[0] + A0[0]))/OIIIBoost;
E2 = rescale($T[1],M[1],1);
E3 = ~(~mtf(E1,E2) * ~min($T[1],M[1]));
E4 = (A0[2]*(1-A0[0])/(A0[2] - 2*A0[2]*A0[0] + A0[0]))/SIIBoost;
E5 = rescale($T[2],M[2],1);
E6 = ~(~mtf(E1,E5) * ~min($T[2],M[2]));
R = $T[0];
G = iif(SCNR==0, E3, min(mean($T[0],E6), E3));
B = E6;
```

Params: Mode (0=linear/1=non-linear), SCNR (0–1), Blackpoint (0–1), OIIIBoost, SIIBoost, HLRecover (≥1), HLReduction (≥1), Brightness; SHO/HOO selector. Input = preferably-starless RGB with NB already mapped.

**NBRGBCombination** (broadband+NB continuum-subtraction — marginal for pure SHO) `[SOURCED VERBATIM via extract]`:

```
newNB = ((NB * RGB_bandwidth) - (RGB * NB_bandwidth)) / (RGB_bandwidth - NB_bandwidth)
```

Example symbols `R_bandwidth=100`, `HA_bandwidth=7 (or 3)`. Relevant only when blending NB into a broadband RGB.

**Static "FORAX" (one x — Maxime Oudoux, ~2018)** `[SOURCED VERBATIM, browser-verified astroaf.space "WTF is FORAX?", Doug/AstroAF, 13 Jul 2025]` — a *static, linear-weighted* blend, NOT the dynamic mtf palette (see name-collision note):

```
R = SII·n + Ha·m
G = Ha·n + OIII·m
B = OIII          (n>m; example n=0.8, m=0.2 — tune to taste, NOT fixed)
```

Optional luminance blend the same author uses: `FORAX × ~(k - Lum)`, `k≈0.6` `[SOURCED example, tune]`. Author's final background-contrast tweak: `$T × (1 - (1 - $T)^2.2 × 0.3)` `[SOURCED example]`.

> **Name-collision warning (browser-verified).** There are TWO distinct things sharing this name: **(1) "Foraxx" (two x)** = the *dynamic, per-pixel mtf* palette above (`Oiii^~Oiii` adaptive weights, ~2020, popularized via AutoIntegrate/NarrowbandNormalization), and **(2) "FORAX" (one x)** = Maxime Oudoux's *static linear-weighted* blend `rgb(SII·n+Ha·m, Ha·n+OIII·m, OIII)`, shared ~2018. They are different formulas with different behavior — do not conflate. The earlier "later Blanshan mtf-based Foraxx variant" that research flagged for `astroaf.space` was a **wrong expectation**: that page documents the *static one-x FORAX*, not an mtf Blanshan variant. NarrowbandNormalization does productize the two-x dynamic math into a GUI. The Blanshan mtf-specific "Foraxx" variant (if distinct from the self-referential 2020 form already captured above) remains unverified.

---

## Part 6 — Color & Hue Handling (the green-dominance problem)

**Why green dominates:** in SII→R/Ha→G/OIII→B, Ha is almost always the strongest line, so **green overpowers** everywhere except pixels with strong SII or OIII. Stars are broadband (bright in all three), so after green is subtracted they turn **magenta** (R+B, no G) — the magenta-star problem is a *direct byproduct* of green removal, not an independent defect.

**Recommended order (SCNR is cosmetic false-color correction — apply at/after combine, never on individual linear masters):**

1. Combine channels.
2. **Balance BEFORE relying on SCNR** — LinearFit/AutoLinearFit with **green (Ha) as reference** so SII and OIII reach comparable backgrounds. This tames much of the cast *at its source* and lets SCNR run gentler — **objectively less signal damage**. `[OBJECTIVE]`
3. Optionally **NarrowbandNormalization** (built-in green control — modern integrated alternative to raw SCNR).
4. **SCNR green, Average Neutral**, amount tuned to taste.
5. **Hue/saturation shaping** — Curves in Hue mode, ColorSaturation by hue, toward the gold/teal "Hubble look."
6. **Fix residual magenta stars** — invert → SCNR-green → invert on a star-only image or star mask (Part 7).

**SCNR reference (jonrista, verbatim):**

| Mode | Formula | Note |
|---|---|---|
| **Average Neutral** (recommended) | `m=(R+B)/2 ; G'=Min(G,m)` | Safest — fewest color issues, widest usable amount range `[OBJECTIVE: safest mode]` |
| Maximum Neutral | `m=Max(R,B) ; G'=Min(G,m)` | "only works somewhat well at 1.0" |
| Minimum Neutral | `m=Min(R,B) ; G'=Min(G,m)` | "better around 0.5 or less" |
| Maximum / Additive Mask | — | Drive toward magenta unless amount ≤ ~0.05 — **avoid for SHO** |

**Amount:** general use ~0.7 (range ~0.2–0.95). **For SHO start LOWER (~0.5)** and raise only until background sky is neutral (R≈G≈B). Exact SHO amount is `[UNSOURCED]` — measure per image.

**The key SHO guardrail (objective cost):** SCNR **cannot distinguish Ha-green from OIII-teal.** The Ha/OIII overlap regions are legitimately teal/cyan; **aggressive green removal desaturates them toward gray and can shift genuine OIII areas blue** (community-reported). Over-correction yields "color noise artifacts" and gray instead of the colors you want. Verify overlap zones stay teal and OIII-only regions stay blue; if they gray out or go pure-blue, back off. `[OBJECTIVE cost — measurable]`

The James Lamb "modified SCNR" PixelMath is referenced by sources but no page exposed it verbatim — `[UNSOURCED]`, not reproduced. Target hue angles and saturation levels are aesthetic — judge by eye per target.

---

## Part 7 — Star Handling

**Dominant modern (2024–2026) default: starless-split + broadband RGB-star replacement.** SHO stars are intrinsically wrong-colored (magenta/purple) because broadband star light is forced through emission-line filters and mapped to an arbitrary palette — so the pragmatic consensus is *don't fix SHO stars, replace them*. Cosgrove: *"who cares about getting the SHO stars right? I want to eliminate them anyway."* This is a **factual basis** for handling stars separately. `[OBJECTIVE basis]`

**Where to split (contested):**

| Split point | Trade | Source |
|---|---|---|
| **Per-channel starless BEFORE combine** — StarX each linear S/H/O, then combine starless masters | Cleaner: no stars to fight, avoids magenta rings | Cosgrove (switched after StarX-on-combined left *"significant magenta star ring artifacts"*) |
| **StarX on the COMBINED SHO** (with Unscreen) | Simpler/faster: one run → SHO_starless + SHO_stars | theAstroShed 2024, many tutorials |

Both are current/valid. Per-channel is cleaner *for star artifacts* but whether it avoids rings is data/SXT-version dependent (single-imager result) — treat as a genuine contested split, not a proven law.

**Star removal settings:** StarXTerminator. On **linear per-channel** mono S/H/O → `stars=true` **only** (project rule: NO unscreen on linear). On the **combined non-linear** SHO → `stars=true, unscreen=true`. Verify starless has no magenta rings before proceeding. `[SXT numeric defaults not source-loaded — RC Astro 403]`

**Star-field source (ranked by popularity):**

| Option | How | When |
|---|---|---|
| **A — True broadband RGB** | Shoot short RGB subs → BXT+NXT → StarX (Unscreen) → screen onto SHO_starless | Strongest; when RGB data exists |
| **B — Synthetic RGB from NB** | SetiAstro "NB to RGB Star Combination", or manual PixelMath `R=Ha, G=0.5*OIII+0.5*SII, B=OIII` `[UNSOURCED — verify]` | No broadband data |
| **C — HOO / HaOIII bicolor** | Process a 2-channel H+O star field, blend into SHO | Classic middle ground |

**Re-adding — SCREEN blend** (near-universal). **ScreenStars** (Blanshan / Cosmic Photons) is the modern default; its *reverse-stretch* mode preserves star color when screening RGB stars onto a differently-colored NB starless. Manual equivalent: `screen = stars + starless - stars*starless` = `combine(stars, starless, op_screen())`; unscreen/extract = `(original - starless)/(1 - starless)`. Same math as the scripts — automation is convenience, not a quality upgrade. Verify against a loaded Cosmic Photons page before shipping.

**If you KEEP SHO stars** (no RGB data, no replacement wanted): the **long-standing** magenta fix — Invert (Ctrl+I) → SCNR green (Average Neutral, ~1.0 `[UNSOURCED default]`) → Invert back, applied through a **dilated** star mask to also catch the magenta **halo** (SCNR alone misses it). Or ColorMask (magenta axis) → desaturate. Reduce SCNR amount toward 0.5 if stars go gray. This is a legitimate different aesthetic, not "less correct" than replacement.

**Star reduction (optional):** MorphologicalTransformation (Morphological Selection / erosion) through a star mask, or the ImageBlend script, if replacement stars are too large. Measure FWHM before/after; amounts `[UNSOURCED]`.

**SPCC scope:** photometric calibration cannot apply to a false-color palette, so if you want **calibrated** star color you must source it from a properly (SPCC-)calibrated **broadband RGB** set — an objective argument for RGB replacement, applied to the *separate star field*, not the SHO composite.

---

## Part 8 — SPCC in Narrowband Mode

**SPCC does NOT calibrate the SHO palette.** The mapping is arbitrary aesthetic assignment; no photometric process can correct it. SPCC's solve is **star-driven** — it computes expected per-channel flux for a white reference from **real filter curves + real sensor QE**, derives a robust linear transform (R/G, B/G flux ratios), and applies it whole-image. In narrowband that transform mainly fixes **star color / cross-channel balance**, not nebula false color.

**Two defensible paths:**
1. **SKIP SPCC on the nebula** (dominant path — theAstroShed 2024, AutoIntegrate consensus): balance with LinearFit, control green with SCNR/NarrowbandNormalization/hue. If star color isn't a goal you lose nothing the palette cares about.
2. **USE SPCC in narrowband mode** only for photometrically sensible **star** color (ideally on a separated/synthetic-RGB star image), on the **linear combined image before stretch** (photometry is invalid on stretched data).

**Settings when you do run it:**

| Field | Value |
|---|---|
| Palette auto-map | SII→R, Ha→G, OIII→B (SPCC sets which channel each wavelength lands in per palette) |
| **Emission wavelengths** | **Ha ≈ 656.3 nm** (656.28), **[OIII] 500.7 nm**, **[SII] ≈ 671.6 / 673.1 nm doublet (~672 nm)** — enter **your filter's actual center**, not a memorized number |
| Bandwidth | Each filter's **real** passband from its datasheet (typical 3 / 3.5 / 5 / 7 nm) — read it off, don't guess `[filter-dependent]` |
| **QE (MONO rule)** | Select the **REAL sensor** (e.g. IMX455 for a QHY600M) + real filter curves. Use "Ideal QE Curve" **only if your exact sensor is unlisted**. The OSC "Ideal QE" shortcut does **NOT** apply to mono. `[OBJECTIVE]` |
| Optimize for stars | Enable — reinforces that NB SPCC is a **star-color** tool |
| Catalog | Gaia DR3/SP |

> **Correction folded in:** the project KB previously listed **[SII] 674.2 nm** and **Ha 656.0** — both wrong. There is no real [SII] line at 674.2 nm; the [S II] forbidden doublet is **671.6 / 673.1 nm (≈672 nm)**, and Ha is **656.28 nm**, not 656.0. SPCC's shipped narrowband UI defaults (e.g. SII 671.6, Ha 656.3) reflect the real doublet — always use your filter's true center. Other KB lines are correct: **[OIII] 500.7, [NII] 658.4, Hβ 486.1 nm.** These wavelengths matter only for the star sub-problem; they do not make the false-color palette "accurate."

**Contested:** whether to run SPCC at all in the SHO spine. *For:* natural star colors + a sane channel-balance start (telescope.live). *Against:* theAstroShed skips it for final SHO; AutoIntegrate practitioners report *"better result without SPCC on SHO — run SCNR and fix stars,"* since dominant Ha can swamp the fit. Mechanism strongly implies **stars-only** (the official doc could not be loaded to confirm — 403).

---

## Recommended Full SHO Sequence

```
# --- Mono spine (all three channels) ---
1.  Calibrate each channel (bias/dark/flat)                    [per channel]
2.  Register EVERY channel to ONE common reference (usually Ha)
3.  Integrate each channel -> S, H, O masters
4.  ONE shared DynamicCrop applied identically to all three

# --- Per-channel LINEAR prep (Part 2; diverge only on denoise) ---
5.  Gradient removal per channel (DBE default; OIII worst)
6.  BlurXTerminator on LINEAR, per channel, BEFORE any mixing
      Correct-Only (safe) or full deconv (low Sharpen Stellar)
7.  NoiseXTerminator on LINEAR, per channel, AFTER BXT
      denoise OIII/SII HARDER than Ha (lower SNR)

# --- Balance + combine (Parts 3-4) ---
8.  LinearFit the 3 masters to a common ref (fit to WEAKEST for SNR)
9.  DEFAULT: combine while LINEAR -> ChannelCombination SII->R Ha->G OIII->B
      (alt: static/dynamic PixelMath; dynamic wants NON-LINEAR starless data)
10. ONE shared stretch (STF/GHS) of the combined SHO
      (optional SPCC on LINEAR combined image BEFORE stretch — STARS only)

# --- Color + hue (Part 6) ---
11. (optional) NarrowbandNormalization (SHO palette)
12. SCNR green, Average Neutral, start ~0.5, raise only to neutral bg
      GUARD: keep Ha/OIII overlap TEAL, OIII blue — don't gray them out
13. Hue rotation + ColorSaturation toward gold/teal look   [aesthetic]

# --- Stars (Part 7) ---
14. StarX split (per-channel-before-combine OR on combined SHO)
15. Build star field: broadband RGB (best) / synthetic-RGB / HOO
16. Screen stars back (ScreenStars reverse-stretch, or op_screen PixelMath)
      keep-SHO-stars path: invert -> SCNR-green -> invert via dilated mask
17. (optional) star reduction if replacement stars too large

# --- Finish ---
18. Final contrast/local stretch, sharpening, export
```

---

## (a) What Changed Recently — and Is It Actually Better?

| Newer thing | Era | Genuine gain | Or fashion? |
|---|---|---|---|
| **Foraxx / dynamic PixelMath palettes** | math 2020, hype 2022–26 | Real *capability*: per-pixel adaptive blend factors → smoother Ha/OIII transitions, softer green→magenta edge | **Not objectively better** — "no definitive answer"; target/taste-dependent. "Everyone uses Foraxx" = fashion signal |
| **NarrowbandNormalization** (Blanshan+Cranfield) | 2023–24 | Dynamic math + green control + SII/OIII boost in a **reproducible GUI**; convenient | Productizes an aesthetic; **not "more correct"** than hand PixelMath / LinearFit + SCNR |
| **AI star tools** (SetiAstro NB-to-RGB, ScreenStars) | 2023–25 | Automate alignment/blend; reverse-stretch preserves star color | Same screen/unscreen math as manual PixelMath — **convenience, not superiority** |
| **GradientCorrection / MGC** | 2024 PI | Modern gradient modeling | Newer ≠ better for NB; **DBE's manual sampling still preferred** on sparse dark NB backgrounds |
| **BXT full deconv** | current | More sharpening available | **Correct-Only remains the safer linear choice**; full deconv is risk, not mandate |
| **SPCC narrowband mode** | post-2022 | Physics-based **star**-color correction; mono real-QE rule is objectively right for mono | Does **not** make the palette accurate; **commonly skipped** on the SHO nebula |
| **SCNR-green** (old) | 2010s | Still the core, well-motivated green fix | **Not obsoleted** by newer palette scripts |

---

## (b) Contested / Open Decisions

1. **Linear vs nonlinear combine.** Combine-linear-then-single-stretch (jonrista, theAstroShed 2024: star-profile/calibration integrity) vs stretch-each-channel-first (Galactic Hunter, The Coldest Nights: finer per-channel control). Both publish good SHO; the official forum "linear vs nonlinear" thread confirms it's unresolved.
2. **Static vs dynamic palette.** Community/marketing lean dynamic; primary technical sources refuse to call it objectively better. Resolve by defaulting static (automation-friendly) with dynamic as an explicit optional node.
3. **Where to balance channels.** LinearFit on linear masters *before* combine (jonrista) vs AutoLinearFit + NarrowbandNormalization *after* combine (theAstroShed). Both live in 2024.
4. **LinearFit reference channel.** Ha (default) vs weakest/lowest-noise (jonrista, SNR argument) vs SII (Light Vortex, suppress Ha dominance) vs green-after-combine (theAstroShed). No single rule; jonrista even states two of these together.
5. **Whether to LinearFit at all.** NarrowbandNormalization users often skip standalone LinearFit; an entire Cloudy Nights thread debates it.
6. **BXT Correct-Only vs full deconvolution** for NB linear — safety vs detail, user-dependent, not settled by evidence.
7. **Gradient tool** — "DBE superior for NB" vs "try all, keep the flattest."
8. **Whether to run SPCC on SHO at all**, and whether it helps the nebula or **only** the stars (mechanism implies stars-only; official doc unverified).
9. **Star split point** — per-channel starless before combine (Cosgrove, artifact-driven) vs StarX on the combined SHO (theAstroShed, simpler).
10. **Star-field source** — true broadband RGB vs synthetic-RGB-from-NB vs HOO bicolor; depends on available data.
11. **Replace vs correct SHO stars** — replacement is dominant but keeping NB stars + SCNR/desaturate is legitimate (cheaper, preserves NB star intensity).
12. **Whether SCNR-green is even a good idea** — near-universal, but it removes real OIII/teal signal; honest position is "yes, conservatively, after pre-balancing." Exact SCNR amount is per-image, never source-fixed.
13. **Exact "real" Foraxx formula** — the two-x self-referential dynamic form is verbatim-confirmed; the *static one-x "FORAX"* (Oudoux) is now browser-verified too (see Part 5 name-collision note); a Blanshan-specific mtf variant, if genuinely distinct from the captured 2020 form, remains unverified.
14. **Synthetic RGB-from-SHO star coefficients** — vary by author; `R=Ha, G=0.5*OIII+0.5*SII, B=OIII` is unverified.
15. **Static-blend coefficients** (e.g. `0.8*Ha+0.2*OIII`) — taste knobs, not derived constants.

---

## (c) Consolidated `needsBrowser` List

| URL | Why / what to confirm |
|---|---|
| `https://www.lightvortexastronomy.com/tutorial-narrowband-hubble-palette.html` | SSL handshake failure — canonical Hubble-palette: LinearFit, modified-SCNR, hue steps, star handling |
| `https://www.galactic-hunter.com/post/pixinsight-narrowband-combination-in-hubble-palette-tutorial` | Snippet only — verbatim nonlinear SHO combine steps |
| `https://pixinsight.com/doc/docs/SPCC/SPCC.html` | 403 — exact shipped narrowband wavelength/bandwidth defaults; definitive stars-vs-whole-image statement |
| `https://telescope.live/blog/pixinsight-spcc-narrowband-images` | (loaded) — cross-check narrowband SPCC recipe / background limits |
| `https://app.astrobin.com/equipment/explorer/software/6601/bill-blanshan-narrowband-normalization-pixelmath` | 403 — verbatim Blanshan normalization PixelMath |
| `https://www.rc-astro.com/software/bxt/` | 403 — exact NB + sharpen-slider guidance/defaults |
| `https://www.rc-astro.com/blurxterminator-2-0-ai4-release/` | 403 — verbatim Correct-Only + channel-mixing-order text |
| `https://www.rc-astro.com/noisexterminator-2-ai3-user-manual-pixinsight/` | 403 — exact denoise/detail ranges, HF/LF, star-removal order |
| `https://www.rc-astro.com/starxterminator-usage-notes/` / `…/software/sxt/` | 410 / 403 — SXT narrowband/unscreen guidance & defaults |
| `https://www.cloudynights.com/forums/topic/810222-pixinsight-to-linearfit-or-not-with-narrowband/` | 403 — the LinearFit-yes/no debate |
| `https://www.cloudynights.com/forums/topic/850797-sho-do-you-do-a-linear-fit…/` | 403 — SHO LinearFit vs other histogram alignment |
| `https://www.cloudynights.com/forums/topic/907829-when-to-run-blur-terminator-for-narrow-band/` | 403 — BXT-per-channel-vs-after-combine consensus |
| `https://pixinsight.com/forum/index.php?threads/narrowband-combining-for-sho-linear-vs-nonlinear…8947/` | 403 — the exact linear-vs-nonlinear advice thread |
| `https://www.cloudynights.com/topic/680158-pi-lrgb-nb-combination-vs-stretching/` | 403 — combination-vs-stretching-order consensus |
| `https://pixinsight.com/tutorials/narrowband/` | 403 — official NBRGBCombination equation + authorship |
| `https://www.cosmicphotons.com/pi-modules/narrowbandnormalization/` | Not loaded — verbatim NarrowbandNormalization params/lineage |
| `https://www.astroworldcreations.com/blog/new-pixinsight-process-narrowbandnormalization` | JS-only/truncated — full NBN params + Blanshan lineage |
| ~~`https://astroaf.space/wtf-is-forax/`~~ | ✅ **RESOLVED (browser 2026-07-19)** — loaded fine; the fetch-tool 403 was bot-blocking. Content is the *static one-x FORAX* (Oudoux ~2018), NOT an mtf Blanshan variant — captured verbatim in Part 5 with a name-collision warning. |
| `https://remoteastrophotography.com/foraxx-palette-script…` (and NBN / SCNR-invert variants) | 410 Gone — Foraxx script write-up; invert→SCNR→invert magenta procedure |
| `https://www.cloudynights.com/topic/966485-foraxx-script/` | 403 — community consensus on Foraxx |
| `https://forums.ruuth.xyz/t/foraxx-palette-utility/177` | Not loaded — AutoIntegrate Foraxx implementation details |
| `https://pixinsight.com/forum/…the-problem-of-green-in-narrowband-sho-palette.13286/` | 403 — authoritative green-problem thread |
| `https://chaoticnebula.com/pixinsight-scnr/` (and `/workflows/`) | 403 — SCNR green/hue settings; NB per-channel BXT/NXT numbers |
| `https://stargazerslounge.com/topic/384453-…scnr-to-tame-green…good-or-bad/` | 403 — is-SCNR-green-good/bad consensus |
| `https://telescope.live/tutorials/sho-green-colour-adjustment-tools…` | 404 — SHO green-adjustment tools |
| `https://pixinsight.com/forum/…using-pixelmath-to-get-rid-of-magenta-stars…7128/` | 403 — primary PixelMath magenta-star expression |
| `https://app.astrobin.com/forum/topic/44389/…starxterminator/…blending-rgb-stars…` | 403 — RGB-star blending method + PixelMath |
| `https://cosmicphotons.com/scripts/` | Search-summary only — verify ScreenStars screen/unscreen formula verbatim |
| `https://www.setiastro.com/pjsr-scripts` (NB-to-RGB Star) | Verify exact synthetic-RGB-star behavior/coefficients |
| `https://pixinsight.com/forum/…new-script-screenstars.21098…` | ScreenStars announcement — reverse-stretch mode, Blanshan collab |
| `https://starfieldview.com/…color-calibration-for-narrowband-images/` | 403 — narrowband color-calibration tutorial |
| `https://www.cloudynights.com/forums/topic/932882-spcc-question-narrowband-filters-mode/` | 403 — SPCC narrowband-mode consensus |
| `https://nebularama.com/2023/07/08/sho-processing-narrowband-data-in-pixinsight-part-one/` | JS-only / dead redirect — full SHO NB workflow |
