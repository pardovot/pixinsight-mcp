---
name: pixinsight-pipeline
description: |
  PixInsight processing reference: process parameters (LHE, HDRMT, MorphologicalTransformation,
  LRGBCombination), XTerminator tool settings, the GHS PixelMath formula, and hard-won
  equipment/quality lessons. Use as a PARAMETER REFERENCE when processing deep sky images
  (nebulae, galaxies, clusters) through the MCP tools.
---

# PixInsight Processing Reference

> ⚠️ **This is a parameter/knowledge reference, not a runnable pipeline.**
> The Node pipeline this skill originally documented (`scripts/run-pipeline.mjs`, `editor/`,
> config JSONs) was **deleted** from this fork. Do not look for those files.
>
> **How processing actually happens now:** the agent drives PixInsight directly through the MCP
> tools — `get_process_parameters` → reason → `run_process` → re-measure. To *drive a full run*,
> use the **`process-master`** skill; for *what to do per data type*, use **`docs/workflows/`**
> (osc-hoo, osc-rgb, mono-rgb, mono-lrgb, mono-halrgb, mono-sho).
>
> This skill remains useful for the *numbers*: cross-process parameter ranges, tool settings, and
> the lessons in `reference/` — especially for galaxy / LRGB / broadband targets the OSC-HOO
> playbook doesn't cover. **The `Parameter` column names in the tables below are legacy config
> keys from the retired pipeline — treat them as labels; the reusable content is the range + the
> Notes, which you map onto the corresponding `run_process` settings.**

## Method (do not skip)

1. `get_process_parameters` first — understand what each setting means.
2. **Watch for no-op defaults.** `AutomaticBackgroundExtractor` defaults to `targetCorrection=0`
   + `replaceTarget=false`: it builds a background *model* and leaves the image untouched.
3. Choose settings by **measuring this image**, never by copying fixed numbers.
4. Execute, then **re-measure**. Byte-identical statistics = a no-op; stop and fix it.

## Reference Techniques

**Non-linear star extraction** — Avoids halo bloating. Load pre-SXT checkpoint, apply identical
stretch (HT+GHS), then SXT with `unscreen=true`. Screen blend to recombine: `~(~$T*~(strength*stars))`.
(Note: on a *linear* extraction use `unscreen=false` — see the star method below and osc-hoo.)

**Ha injection (three-part with nebula mask):**
1. Conditional R-channel: `R + strength * max(0, Ha - threshold*R)` — adds Ha where it exceeds existing R
2. Luminance boost: LRGBCombination with Ha as luminance — transfers structural detail to all channels
3. Detail layer: `$T + detailStr * (Ha - GaussianBlur(Ha, sigma=15))` — color-neutral filament enhancement

**GHS** — GeneralizedHyperbolicStretch **is a native process** — drive it via
`run_process("GeneralizedHyperbolicStretch", …)` (confirmed working; param map in the
`process-master` skill / osc-hoo playbook). The PixelMath formula `exp(exponent*ln(base))` (no
`pow()` in PixelMath) in [GHS reference](reference/ghs-stretch.md) is a **fallback only**, for when
the module isn't loaded.

**Mask gamma compression** — Luminance masks for LHE/HDRMT on galaxies must use gamma compression
to prevent bright cores from saturating to 1.0 in the mask. Formula: `exp(gamma * ln(max(rescaled, 0.00001)))`.
LHE uses maskGamma=2.0, HDRMT uses maskGamma=1.5.

**Hue-selective saturation** — For galaxy targets, instead of blanket saturation, classify pixels
by hue (R/G/B ratios) and apply per-hue boost: blue spiral arms (1.30), pink HII regions (1.25),
golden bulge (1.0). Formula: `lum + factor * (channel - lum)`.

**Per-channel gradient correction** — Apply GradientCorrection to R, G, B, L individually before
combination. Essential for LRGB where different filters/nights produce different gradient profiles.
Use a baseline guard that reverts if GC makes any channel worse.

**HDR headroom** — A modified Seti Hermite HDR compress that caps the maximum pixel value below 1.0
gives HDRMT working room in bright galaxy cores. L headroom=0.10, RGB headroom=0.05.

## Parameter Tuning Guide

(See the note at the top: the `Parameter` names are legacy labels; the value **ranges + Notes** are
what transfer to `run_process` settings.)

### Core Parameters
| What to adjust | Parameter | Range | Notes |
|----------------|-----------|-------|-------|
| Background brightness | `stretch.targetBg` | 0.10-0.25 | 0.10 for galaxies, 0.25 for nebulae |
| Ha strength | `ha_inject.injectionStrength` | 0.3-0.8 | Higher = more Ha in red channel |
| Ha structure | `ha_inject.detailLayer` | 0.3-0.7 | Higher = more filament detail |
| Ha luminance | `ha_inject.lumBoost` | 0.3-0.7 | Adds Ha brightness to all channels |
| Denoise (linear) | `nxt_pass1.denoise` | 0.2-0.5 | Don't over-denoise linear data |
| Denoise (non-linear) | `nxt_pass2.denoise` | 0.4-0.7 | Can be stronger post-stretch |
| Denoise (final) | `nxt_final.denoise` | 0.25-0.35 | 0.30 after LHE/HDRMT; 0.40 over-smooths recovered detail |
| Star sharpening | `bxt_sharpen.sharpenStars` | 0.1-0.5 | Subtle is better |
| Nebula sharpening | `bxt_sharpen.sharpenNonstellar` | 0.3-0.75 | Can be more aggressive |
| Halo reduction | `bxt_sharpen.adjustStarHalos` | -0.5 to 0 | 0.00 for galaxies (neg. causes ringing before SXT) |
| Green removal | `scnr.amount` | 0.2-0.5 | 0.35 when it applies — but SCNR is NOT a default step (see Common Issues) |

### Gradient Correction
| What to adjust | Parameter | Range | Notes |
|----------------|-----------|-------|-------|
| Per-channel mode | `gc.perChannel` | true/false | **Always true for LRGB** — fixes per-channel color gradients that combined-image GC cannot |
| GC method | `gc.method` | "auto"/"abe"/"gc" | "auto" compares ABE vs GC and picks best |
| ABE polynomial | `gc.polyDegree` | 2-4 | 2-3 for galaxies (higher eats signal) |

### LHE / HDRMT Masks
| What to adjust | Parameter | Range | Notes |
|----------------|-----------|-------|-------|
| LHE tonal separation | `lhe.amount` | 0.25-0.50 | 0.25 edge-on, 0.35 face-on spirals, 0.50 nebulae |
| LHE contrast limit | `lhe.slopeLimit` | 1.3-2.0 | 1.3 edge-on, 1.5 face-on, 1.8 nebulae |
| LHE mask gamma | `lhe.maskGamma` | 1.5-2.5 | **2.0 for galaxies** — protects bright cores from flattening |
| HDRMT layers | `hdrmt.numberOfLayers` | 5-8 | 6 for L, 7 for RGB on spiral galaxies |
| HDRMT iterations | `hdrmt.numberOfIterations` | 1-4 | 3 for spirals, 1 for edge-on |
| HDRMT mask gamma | `hdrmt.maskGamma` | 1.0-2.0 | **1.5 for galaxies** — lighter than LHE (HDRMT has built-in lum mask) |
| HDRMT mask clip low | `hdrmt.maskClipLow` | 0.10-0.30 | 0.20 for L channel, 0.10 for main RGB |

### HDR Headroom
| What to adjust | Parameter | Range | Notes |
|----------------|-----------|-------|-------|
| L headroom | `l_stretch.hdrHeadroom` | 0-0.15 | 0.10 for galaxies — prevents core clipping before HDRMT |
| RGB headroom | `stretch.hdrHeadroom` | 0-0.10 | 0.05 for galaxies — less aggressive for color fidelity |

### Hue-Selective Saturation
| What to adjust | Parameter | Range | Notes |
|----------------|-----------|-------|-------|
| Blue arm boost | `hue_boost.blueBoost` | 1.0-1.5 | 1.30 — enhances spiral arms |
| Pink HII boost | `hue_boost.pinkBoost` | 1.0-1.4 | 1.25 — enhances emission regions |
| Golden bulge | — | 1.0 (fixed) | Left untouched — already warm enough |

### Channel Color Correction
| What to adjust | Parameter | Range | Notes |
|----------------|-----------|-------|-------|
| G channel factor | `channel_boost.G` | 0.90-1.0 | 0.94 for Astronomik filters — reduces green cast |
| B channel factor | `channel_boost.B` | 1.0-1.15 | 1.12 for Astronomik filters — compensates blue deficit |

## Common Issues

- **Stars have halos**: Avoid star erosion/threshold — use clean non-linear extraction instead
- **Over-processed look**: Reduce LHE amount, disable LHE fine and HDRMT, use gentler curves
- **Magenta/purple background**: SPCC issue — check sensor QE and filter profiles
- **PixInsight crash**: Check memory (warn at 8GB). Close intermediate images aggressively.
- **ImageSolver not defined**: Known — `#include` doesn't work in eval. SPCC still works without plate solve if image has WCS.

## Star Method: Linear Seti Stretch

Inspired by [Seti Astro](https://www.setiastro.com) (Bill Blanshan) — produces tight, point-like
stars without bloating. (The osc-hoo playbook + `process-master` carry the measured-amount version;
this is the technique summary.)

1. SXT on linear data (`stars=true`, no unscreen) — extract stars before stretch
2. Clip background pedestal from linear star residuals
3. Stretch with the Midtone Transfer Function (MTF): `MTF(m, x) = (1-m)*x / ((1-2m)*x + m)`
4. Apply a strong saturation boost (ColorSaturation / CurvesTransformation S channel) — the MTF
   stretch desaturates stars, so aggressive compensation is needed
5. Add stars back with simple PixelMath addition at 100% strength

**Key lessons:**
- Measure the amount from the **star-pixel** median, not the layer median (~99.9% black → degenerate).
- Star saturation must be applied AFTER the stretch (the stretch desaturates).
- Simple addition at 1.00 strength works well (not screen blend).
- Do NOT use star erosion/threshold — creates artifacts. Clean extraction is sufficient.

## Credits / Inspired By

| Technique | Source |
|-----------|--------|
| Star Stretch (Seti/MTF method) | [Seti Astro](https://www.setiastro.com) — Bill Blanshan |
| Generalized Hyperbolic Stretch | [GHS](https://ghsastro.co.uk) — Mike Cranfield & Mark Shelley (native process; PI script at `src/scripts/GeneralisedHyperbolicStretch/`) |
| Non-linear star extraction | PixInsight community technique |
| Screen blend recombination | Standard astrophotography: `1-(1-A)*(1-B)` |
| Ha 3-part injection | Combination of community techniques for narrowband |

## Reference Files

- [PJSR Process Parameters](reference/pjsr-processes.md) — LHE, HDRMT, MorphologicalTransformation, LRGBCombination, Convolution, SCNR
- [PJSR Gotchas](reference/pjsr-gotchas.md) — File I/O, eval quirks, crop masks, V8 engine notes
- [Xterminator Tools](reference/xterminator-tools.md) — SXT, NXT, BXT parameter reference
- [GHS Stretch](reference/ghs-stretch.md) — GHS formula, PixelMath implementation, multi-pass strategy
- [Processing Knowledge](reference/processing-knowledge.md) — Equipment settings, quality assessment, lessons learned
