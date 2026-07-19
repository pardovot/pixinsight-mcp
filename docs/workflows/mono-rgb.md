# Mono-RGB PixInsight Processing Playbook
### Mono camera · separate R/G/B masters · broadband natural color · NO luminance
*Evidence-aware, current to PixInsight 1.9.x / 2025–2026*

> Provenance: 11-leg multi-agent web research + adversarial recency/evidence verification,
> cross-checked against primary SPCC/MARS docs. Confidence/consensus/contested tags preserved;
> anecdote/estimate values flagged. (Luminance/LRGB is a later category.)

---

## Key question resolved up front: what runs per-channel vs on combined RGB, and why

| Step | Where | Why |
|---|---|---|
| Crop | Per-channel (identical instance) **or** once on RGB — equivalent | Registration pixel-aligns channels; one uniform geometry is the only hard rule |
| Registration (StarAlignment) | **Per-channel, pre-combine** | ChannelCombination is a blind pixel copy with NO alignment; channels must share one grid first |
| Gradient removal (DBE / GradientCorrection) | **Primarily per-channel, pre-combine**; optional 2nd pass on RGB | Additive gradients are filter-specific and model cleanest in a single grayscale channel |
| LinearFit | Per-channel — **but skippable** | SPCC re-derives and overwrites inter-channel scaling; redundant for color |
| BXT "Correct Only" | **Default: once on combined RGB**; per-channel only when star shapes differ between filters | Per-channel is a targeted fix for differential per-filter aberration, not a default |
| ChannelCombination | **THE combine point** | — |
| Plate solve, SPFC, MGC/MARS, SPCC | **Post-combine on RGB** | These fit flux/color across 3 channels; SPCC/SPFC cannot run per-channel |
| BXT main sharpen, NXT, stretch, saturation, SXT | **Post-combine on RGB** | Identical to broadband OSC |

**Governing logic:** anything *additive + filter-specific* (gradients) or *geometric* (registration, per-filter aberration) → **pre-combine per-channel**. Anything that *solves a relationship across the three channels* (color balance, flux, chroma-aware denoise) → **post-combine on the RGB**.

---

## Mono-vs-OSC differences (what OSC does NOT do)
1. **Registration + LinearFit + ChannelCombination** — mono must align 3 separate masters to a common grid and assemble them.
2. **SPCC filter declaration** — mono declares the **REAL R/G/B filter transmission curves** (Chroma/Astrodon/Baader/Astronomik) per channel. OSC uses fused "Sony Color Sensor R/G/B" entries.
3. **SPCC/SPFC sensor QE** — mono uses the **REAL mono sensor QE curve** (Ideal QE only as fallback), because `response = filter × sensor QE`. The OSC "Ideal QE" rule does **NOT** apply. **Never pick a "Sony Color Sensor" entry for mono** — it double-applies sensor response.
4. **Per-channel gradient removal** is meaningful (filters see different sky spectra).
5. **Per-channel SNR mismatch** (e.g. short B) → chroma noise post-combine → denoise after combine.

---

# STAGE 1 — PRE-COMBINATION (per-channel, linear masters)

### 1.1 Registration — StarAlignment · pre-combine · High · Consensus
- Put all three masters on one identical pixel grid before combine. Pick a reference (sharpest/highest-SNR, commonly G); register the other two to it.
- Settings (tutorial best-practice, not hard optima): 2-D Surface Splines, distortion on (~100 iter), Bicubic B-Spline (Lanczos-3 well-sampled / Mitchell-Netravali noisy).
- **Skip only if** all subs were already registered to one common reference in WBPP/integration.
- Skipped → colored star halos, fringing, bloat, SPCC photometry errors.

### 1.2 Crop — DynamicCrop · pre-combine (or post-combine equivalent) · High · Consensus
- **Cardinal rule:** ONE crop geometry applied uniformly to all three channels — set the box on the worst-edge channel, save a New Instance (triangle), apply that same instance to the others (pixel-identical). Never free-hand per channel.
- Equivalent: combine first, crop the single RGB once; or WBPP auto-crop (convenience/robustness, not a quality gain).

### 1.3 Gradient / background removal — per channel · pre-combine · Medium · Consensus on placement
- DBE or **GradientCorrection** on each linear master R,G,B separately (both run on grayscale, no plate solve). Optional **second pass on the combined linear RGB** for residual *color* gradients. (Essentially the Warren Keller workflow.)
- **MGC/MARS caveat:** MGC is reference-based (needs plate-solve + SPFC + MARS band). Whether it runs robustly on *individual mono channels* is **contested**. Safe default: DBE/GC per channel; reserve MGC for the combined RGB (Stage 3).

### 1.4 LinearFit — OPTIONAL / largely legacy · pre-combine · Medium · Contested
- **Verdict for an SPCC pipeline: skip it.** SPCC re-derives + overwrites inter-channel scaling from real filter+QE spectrophotometry, so LinearFit's color effect is undone (redundant, not harmful).
- If used: run AFTER per-channel gradient removal, channels registered; reference = lowest-sigma channel; fit the two non-reference masters to the third (NOT to an L master — no L here).
- Remaining value: neutral pre-SPCC preview / determinism (hygiene, not accuracy).

### 1.5 BXT "Correct Only" — per-channel is the EXCEPTION · pre-combine when used · Medium · Contested
- **Default = a single Correct Only pass on the combined RGB (Stage 3).** Run per-channel pre-combine ONLY when star shapes differ between channels (per-filter tilt/collimation/dispersion). Matters more for mono than OSC.
- Settings: Correct Only — Sharpen Stars=0, Nonstellar=0, Adjust Star Halos=0, Auto PSF on. (BXT estimates PSF; does not require a WCS.)
- The 2025 "STOP separating channels" video = one imager's efficiency test for well-corrected rigs, not evidence per-channel is wrong.

---

# STAGE 2 — THE COMBINATION POINT

### 2.1 ChannelCombination — assemble the linear RGB · COMBINE · High · Consensus
- ChannelCombination → Color Space = **RGB** → assign R→R, G→G, B→B → global Apply → new linear RGB view.
- **Hard prerequisites:** all masters **registered to a common reference** (identical geometry + dimensions), **all linear**. It's per-pixel with NO alignment and no numeric params beyond channel assignment — wrong mapping swaps colors; misregistration = color-fringed stars.
- Do NOT background-neutralize/stretch/color-correct individual channels as a substitute for SPCC.

---

# STAGE 3 — POST-COMBINATION (combined linear RGB)

### 3.1 Plate solve — ImageSolver · post-combine · Medium · Consensus
- Attach WCS (hard prerequisite for SPCC; SPCC no longer self-solves — needs full polynomial/spline coefficients). Run on the combined linear RGB right after ChannelCombination, before any PSF-altering step. Accurate seed RA/Dec + FL + pixel size; distortion on for wide fields.
- Alternative: solve one master pre-combine + ChannelCombination "Inherit astrometric solution." Path A (solve the RGB directly) is the robust default.

### 3.2 (Optional) SPFC + MGC/MARS · post-combine, linear · Medium · Contested at margins
- **SPFC:** writes flux metadata. **Device/QE = REAL mono sensor QE** (Ideal only if unlisted); declare real R/G/B filters; Narrowband OFF; Gaia DR3/SP.
- **MGC + MARS:** additive multiscale gradient correction vs real survey data. **Objectively better only for complex NON-PLANAR/multiscale gradients**; for ordinary gradients it's complementary to DBE, not superior (many still prefer DBE and tune MGC heavily). **MARS coverage broad but incomplete/growing** (DR2 expanded north; gaps remain).
- Placement: combined-RGB is the typical flow, but per-channel pre-combine gradient (1.3) remains legitimate.

### 3.3 SPCC — the color step · post-combine, linear · Medium-High · Consensus
Cannot run per-channel — needs the 3-channel image.

| Parameter | Value | Note |
|---|---|---|
| White reference | **Average Spiral Galaxy** (default) | Scene-agnostic natural color |
| Catalog | **Gaia DR3/SP** (local if installed) | spectral requirement |
| R/G/B filter | **Actual filter model** (dropdown / Curve Explorer / custom CSV) | Chroma/Astrodon/Baader/Astronomik — the key mono step |
| Device / QE curve | **Real mono sensor QE** (IMX455/571 mono…); Ideal QE fallback | response = filter × QE; OSC Ideal-QE rule does NOT apply |
| Do NOT use | any **"Sony Color Sensor"** entry | embeds CFA+QE → double-applies on mono |
| Narrowband mode | Off | broadband |
| Generate graphs | On | tight linear fit validates filter/QE choice |

- Real-QE materiality: physically correct, but on flat back-illuminated Sony sensors the visible difference vs Ideal QE is small/second-order — prefer real, not make-or-break.

### 3.4 BXT main sharpen · post-combine, LINEAR, after SPCC · High · Consensus
Correct-Only (optional) then Sharpen Stars + Nonstellar on the RGB. Identical to OSC; no per-channel sharpening.

### 3.5 NoiseXTerminator · post-combine · High · Consensus
Denoise the **combined** RGB, never per-channel (NXT separates luma/chroma only with all 3 channels). Linear (post-BXT) or post-stretch; heavy light pollution favors post-stretch (mildly contested).

### 3.6 Stretch · post-combine · Medium · Contested (linked vs unlinked)
Tools: GHS / MaskedStretch / VeraLux / StatStretch / HT+STF. With SPCC done, a **LINKED stretch preserves the calibrated color balance** (technically correct; unlinked can undo SPCC). Caveat: some current workflows still use unlinked STF+AutoLinearFit — treat "linked preferred" as reasoned best practice, not hard consensus.

### 3.7 Color / saturation · post-combine, non-linear · High · Consensus
CurvesTransformation saturation (or SetiAstro), optional SCNR green. Same as OSC; slider values are preference.

### 3.8 OPTIONAL — StarXTerminator / starless · post-combine · High
Split stars/nebula, process separately, recombine (screen). Same as OSC; fully optional. Ensure tight R/G/B star registration before combine, else fringing gets amplified.

---

## Canonical spine
```
PRE-COMBINE (per channel, linear):
  StarAlignment → DynamicCrop (shared instance)
    → per-channel gradient (DBE / GradientCorrection)
    → [optional LinearFit — usually skip]
    → [optional per-channel BXT Correct Only — only if star shapes differ]
COMBINE:
  ChannelCombination (RGB, linear, registered, same dims)
POST-COMBINE (combined RGB):
  ImageSolver → [optional SPFC + MGC/MARS] → SPCC (real filters + real mono QE)
    → BXT main sharpen (linear) → NoiseXTerminator
    → Stretch (linked) → Curves/Saturation (± SCNR)
    → [optional StarXTerminator branch]
```

---

## What changed recently — and is it actually better?
- **MGC + MARS (PI 1.9.x, DR2):** objectively better only for complex non-planar gradients; complementary to DBE otherwise; MARS coverage incomplete; requires SPFC. Adopt selectively.
- **WBPP auto common-area crop / single-reference registration:** convenience/robustness, not a quality/color gain.
- **SPCC (2023+) demoting LinearFit:** evidence-based, physics-grounded improvement — LinearFit now redundant for color.
- **Curve Explorer / expanding filter+sensor libraries:** incremental (easier real-curve selection).
- **BXT AI4 / NXT2 AI3:** update the models, not the step *positions*.

## Contested / open decisions
1. Per-channel MGC on individual mono channels — unresolved. Default: MGC on combined RGB; DBE/GC per channel.
2. Gradient: per-channel only / RGB only / both — per-channel-first + optional RGB-second is the taught majority.
3. MGC vs DBE/GC as default — MGC better only for non-planar gradients.
4. BXT Correct-Only default (combined) vs exception (per-channel differing aberration).
5. LinearFit pre-combine — cosmetic/preview only; skip for SPCC.
6. Linked vs unlinked stretch — linked recommended post-SPCC; real workflows still use unlinked; unsettled.
7. NXT linear vs post-stretch — data-dependent (heavy LP favors post-stretch).

## Sourcing note
No settings invented. Registration params (2-D Surface Splines, ~100 distortion iter, Bicubic B-Spline/Lanczos-3) and reference-channel choices are tutorial best-practice, not measured optima. Several primary sources 403'd this pass (browser-verify list retained) — hence medium confidence on currency for some steps, though core mechanics (ChannelCombination performs no alignment; SPCC needs combined RGB + real mono QE) are tool-architecture facts.
