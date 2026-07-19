# OSC-HOO test runbook — North America / Pelican (FMA180 + IMX571)

Guided interactive test of the **OSC-HOO (duoband)** flow from `docs/workflows/osc-hoo.md`,
tuned to your data. You drive PixInsight's GUI; at each **📏 MEASURE → tell me** point, paste the
number/screenshot back and I'll tune the next setting. Numbers below marked *(tune)* are starting
points, not gospel — we drive them from your image.

> **Core rule (do not break):** the stack stays **ONE RGB image** end to end. A duoband OSC master
> already *is* an HOO image (Ha→red, OIII→green+blue). **No ChannelExtraction / recombination.**

---

## The data
- **File:** `D:\AP\FMA180 Pro\North America Pelican Clamshell\ATR3CMOS26000KPA\WBPP\master\masterLight_BIN-1_6224x4168_EXPOSURE-300.00s_FILTER-NoFilter_RGB_autocrop.xisf`
- Target: **NGC 7000 + IC 5070** (North America + Pelican, Cygnus) — bright Ha-dominant emission, dense star field. Ideal HOO test.
- Already **autocropped** (Step 1 will likely be a no-op).
- **Filter (confirmed): Antlia ALP-T 5 nm duoband** → SPCC bandwidth **5/5/5** (the `NoFilter` label is just an unlogged screw-in). Treated as duoband HOO throughout.

## Equipment (pre-filled)
| | |
|---|---|
| Sensor | ToupTek/Altair **IMX571** OSC (26 MP APS-C) |
| Pixel size | **3.76 µm** |
| Optics | Askar **FMA180 Pro**, FL **180 mm**, f/4.5 |
| Image scale | ≈ **4.31 ″/px** → **wide field** → enable distortion/spline in the solver |
| **SPCC/SPFC QE** | **Ideal QE Curve** ← OSC rule; do **not** pick a mono sensor curve |
| Field center | ≈ RA 20h59m, Dec +44.3° (for the solver hint) |

## Prerequisites (check once, before you start)
- [ ] PixInsight open with **BXT / NXT / SXT** modules installed and licensed.
- [x] **MARS DR2 installed** → **MGC gradient path is ON** (Steps 4 SPFC + 5 MGC). Northern Cygnus is well covered.
- [ ] This is **interactive** — the file-bridge watcher is *not* required.
- [ ] Work on a **clone/copy** so you can restart a step without re-opening.

## Measurements to record (fill as you go — paste back to me)
| # | What | Value |
|---|---|---|
| M1 | Linear background median (object-free preview), per channel R/G/B | |
| M2 | Any gradient direction/strength (from STF autostretch) | |
| M3 | Star FWHM (from a BXT/DynamicPSF read), px | |
| M4 | Post-SPCC: does nebula read red-Ha / cyan-OIII? (y/n) | |
| M5 | Post-stretch background median target hit (~0.08–0.15) | |
| M6 | Nebula green median vs red/blue (decides SCNR strength) | |

---

# The 12 steps

### 0 · Open + first look
1. Open the master. **Screen Transfer Function (STF) → auto-stretch (radioactive icon)** for *preview only* — never apply it as the real stretch.
2. Create a small **Preview** over blank sky (a corner with no nebula/bright stars).
3. **📏 MEASURE → tell me (M1, M2):** run **Statistics** (Image → Statistics) on that preview with the image *linear* (STF on is fine, it doesn't change pixels). Report the **median** for R/G/B, and eyeball gradient direction/strength. → I confirm whether MGC vs GradientCorrection, and set the stretch target later.

### 1 · DynamicCrop (edge trim) — *likely skip*
- Data is already autocropped. STF-autostretch and scan all four edges/corners.
- **If** any dark/feathered border remains: DynamicCrop, **Scale X/Y = 1.000, Rotation = 0** (crop, not resample), rectangle a few px inside the bad border. Otherwise **skip**.

### 2 · BlurXTerminator — **Correct Only**
- Process: **BlurXTerminator**, check **Correct Only** (sharpening auto-disables).
- Goal: clean PSFs so the solver + SPCC see round stars. Run once.
- **📏 note M3** (BXT reports/uses the PSF; or run **DynamicPSF** on a handful of stars for FWHM).

### 3 · ImageSolver (plate solve)
- Script → Image Analysis → **ImageSolver** (or Image → Astrometry).
- Settings: **Pixel size 3.76 µm**, **Focal length 180 mm**, **auto limiting magnitude ON**, **local Gaia DR3 (XPSD)** if installed, **Distortion correction / spline ON** (wide, fast optics).
- Coordinates hint: **RA 20 59, Dec +44 18** if it asks.
- Verify it **writes WCS** (console: solved, RMS small). SPCC/SPFC/MGC all fail without this.

### 4 · SPFC (SpectrophotometricFluxCalibration) — **DO** (required for MGC)
- Purpose: writes flux metadata (`PCL:SPFC:ScaleFactors`) that **MGC hard-requires**. Pixels unchanged.
- Settings: **Device/Sensor = Ideal QE Curve**, astrometric solution required (from Step 3), leave numeric params at defaults.
- ⚠ Duoband quirk: SPFC/SPCC NB-mode reliability on OSC varies by version — if it errors, tell me.

### 5 · Gradient removal — **MGC + MARS DR2**
- **MultiscaleGradientCorrection.** **Split channels = NO.** MARS DB = **DR2**. **Model Smoothness = 1.00** *(raise 3–5 if background still wavy)*. **Structure Separation = 3** *(drop to 2/1 to reach corners, then raise Smoothness)*. Gradient Scale *(anecdotal 256–1024 — not a hard default)*.
- (Emergency fallback only if MGC misbehaves: GradientCorrection with samples on true background — Cygnus has real nebulosity everywhere, so be conservative.)
- **✅ Success = flat background, NO dark rings around bright objects, faint nebulosity preserved.**
- **📏 MEASURE → tell me:** re-run Statistics on your blank preview — background medians should now be flat/equal across the frame.

### 6 · SPCC — **Narrowband mode** (the color-defining step)
- Process: **SpectrophotometricColorCalibration**, **Narrowband** filters mode.
- **Wavelengths (physical lines — do NOT change to tune color):** **R = 656.3 nm (Hα)**, **G = 500.7 nm (OIII)**, **B = 500.7 nm (OIII)**.
- **🔑 THE ONE RULE: G and B must be identical — same wavelength AND same bandwidth.**
- **White reference = Photon Flux** (emission-line-proportional). **QE = Ideal** (OSC).
- **Bandwidth = 5 / 5 / 5** (Antlia ALP-T 5 nm — same value in R, G, B; the equal-G/B rule dominates anyway).
- **📏 M4:** after SPCC, nebula should lean **red (Hα)** with **cyan/teal (OIII)** where present. Report y/n.

### 7 · BlurXTerminator — main sharpen (linear)
- Process: **BlurXTerminator**, linear stage, **Automatic PSF ON**.
- **Sharpen Nonstellar ≈ 0.50–0.75** *(tune; below the 0.90 default — HOO nebulosity is smooth and over-sharpens easily)*, **Sharpen Stars ≈ 0.25 or lower**. Apply once.
- **Check at 1:1:** worms/mottle/dark-rings on nebula → lower Nonstellar; dark halos on stars → lower Stars. Preview 0.50 / 0.75 / 0.90, keep the highest with **no** artifacts.

### 8 · NoiseXTerminator (linear, **after** BXT)
- Process: **NoiseXTerminator**. **Denoise ≈ 0.80–0.90** *(tune per image)*. On AI3 the **Detail** slider is inert.
- **Non-negotiable order:** NXT **after** BXT (deconvolution needs non-denoised linear input).

### 9 · StarXTerminator (linear) → split starless / stars
- Process: **StarXTerminator**, **linear / pre-stretch** (preserves star cores), **stars = true only** (no unscreen on linear — house rule).
- Produce **starless** + **stars-only** (`stars = original − starless`, linear).
- ⚠ **HOO stars are often magenta/teal.** Keep the stars layer; we may rebuild neutral star color at recombination (Step 12).

### 10 · Stretch (starless and stars **separately**)
- Tool: **GHS** or **SetiAstro Statistical Stretch** (primary); HistogramTransformation/Curves to refine. **STF is preview-only — never the final stretch.**
- Statistical Stretch target median default 0.25 is usually **too bright** → start **~0.12–0.18**. Aim **post-stretch background median ~0.08–0.15** (up to ~0.20 for large bright nebulae). Keep RGB **linked** unless a strong cast forces unlinked.
- **📏 M5:** measure post-stretch background median on the blank preview; report — we adjust if outside range.
- Stretch the **stars-only** layer separately (gentler; keep them from bloating).

### 11 · HOO color shaping (SCNR + curves) — in place
- **📏 M6 first:** Statistics on nebula — is **green median ≥ red/blue**? If yes, SCNR is warranted; if not, reduce/skip.
- **SCNR Green: Average Neutral, amount 1.0** (post-stretch) to strip the green cast.
- Optional in-place tweak (PixelMath, **uncheck "use a single RGB/K expression"**): lift a little OIII into green (red→gold) or balance G/B for teal. **Values by eye — no canonical numbers; tell me what you see and I'll suggest a curve.**
- Mild **Curves** saturation + small hue rotation to taste.

### 12 · Star recombination
- **Screen (default):** PixelMath `~(~starless * ~stars)`.
- **Relinearization/additive (NightPhotons):** HT midtones **0.999** on both → `Stars + Starless` → HT midtones **0.001**.
- **Never** plain `Stars + Starless` on nonlinear data (clips cores).
- If stars are magenta/teal: rebuild from a neutral source **before** recombining.
- **✅ Done:** clean background, gold/teal HOO nebula, round non-bloated stars, no burnt cores/rings.

---

## Success criteria (what "the flow works" means)
- One RGB image throughout — no channel split needed. ✔
- Plate solve + (SPFC→)MGC + SPCC-narrowband all ran without erroring on OSC duoband data. ✔
- Post-SPCC red-Ha/cyan-OIII balance present. ✔
- Final: flat background, gold/teal nebula, intact stars, quality gates you'd expect (no ringing, no burnt core).

## Where I come in
Paste back **M1–M6** and any console errors / 1:1 screenshots at the checkpoints. The likely tuning
conversations: MGC-vs-GradientCorrection (M2), SPCC bandwidth (your filter), BXT Nonstellar amount
(1:1 look), stretch target (M5), SCNR strength (M6). If SPFC/SPCC **narrowband mode throws on OSC**
(a known version-dependent friction), tell me and we route around it.
