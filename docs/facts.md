# Verified tool facts

Gate: objective, reproducible tool/API behavior only. No aesthetics, no anecdotes, no recipes.
Harvested from the pre-v2 KB (git 4786a13) 2026-07-28.

## BXT
- Live params: `sharpen_stars`, `sharpen_nonstellar`, `correct_only`, `adjust_star_halos`,
  `auto_nonstellar_radius`, `nonstellar_diameter` (FWHM px, cap 8). `auto_nonstellar_psf` /
  `nonstellar_psf_diameter` are DEAD aliases (verified no-op). Set both pairs for safety.
- ⛔ A bare `new BlurXTerminator` inherits persisted LAST-USED settings, NOT factory defaults
  (verified 2026-07-28: introspection returned this machine's old run values 0.2/0.8; factory =
  stars 0.50 / halos 0.00 / nonstellar 1.00 / auto PSF). Pin every load-bearing param
  explicitly; suspect the same for the other XT tools. `sharpen_nonstellar 1.0` is defined by
  the manual as maximum sharpening.
- Auto PSF on STARLESS input badly overestimates (~6-8 px guessed on true 2.2 px); tiles at
  512x512, star-poor tiles guess from nonstellar features. Set manual PSF = pre-SXT star FWHM.
- Flux-conserving: peaks near 1.0 clip on sharpen. Add headroom first, needed factor
  ~ (FWHM_before/FWHM_after)^2, 3x held on R11.
- Worse on denoised data (author), so BXT before NXT. Preserves the WCS.

## NXT
- Current NXT: `iterations`, frequency + color separation, per-band dials. The LIVE denoise
  dials are `denoise_intensity_low_freq`/`_high_freq` (+ `denoise_color_*`); ⛔ top-level
  `denoise` is a DEAD alias (behavior-tested: 0.1 vs 0.9 byte-identical). Old
  `denoise`/`detail`-only param model is stale. Introspected "defaults" may be persisted
  last-used values (see the BXT trap), pin what matters.
- Gauge with MRS noise estimate, never stdDev (signal-dominated, can RISE after good denoise).

## SXT
- `stars` (def false), `unscreen` (def false), `overlap` (0.20). `P.starmask`/`P.linear` do
  NOT exist. Star image = `<viewId>_stars`; undo on the starless leaves it open.
- Copies the parent STF onto both split products.
- Star layer: median degenerate (~99.9% black), measure star-PIXEL median (samples > ~0.005);
  carries small unequal per-channel constant floors (R 14.1e-6 / G 9.1e-6 / B 6.1e-6).
- Cannot cleanly separate stars from large galaxies; HII knots land in the star frame.

## SPCC / SPFC
- ⛔ SPCC `narrowbandMode=true` HARD-DEADLOCKS PI on OSC data. Broadband + duoband curves.
- Curves extractable from `<PI>/library/filters.xspd` (slice the `data="..."` attr). "Sony
  Color Sensor R/G/B" entries embed CFA+QE, pair ONLY with "Ideal QE curve" (real QE curve
  double-counts). Mono filter curves do not embed QE.
- SPFC ships EMPTY curves on OSC and errors ("At least 5 items are required"), supply them.
  Only MGC consumes SPFC. Verify SPFC by written `PCL:SPFC:*` metadata, not the return.
- SPCC needs WCS; PixelMath composites lose it, restore via
  `dstWindow.copyAstrometricSolution(srcWindow)`.
- SPCC `neutralizeBackground` amplifies all local contrasts ~1/(1-pedestal fraction).
- SPCC/SPFC/MGC nested Gaia JS clobbers the EvaluateScript completion value; process still
  succeeds.

## MGC / GradientCorrection / ABE
- Headless MGC silently no-ops with empty `marsDatabaseFiles` (GUI config does NOT transfer).
  Pass `useMARSDatabase=true` AND `marsDatabaseFiles: [[true, "<abs .xmars>"]]` (Windows:
  `%APPDATA%/Pleiades/XMARS/`).
- MGC DECLINES outside MARS coverage: `executeOn` false, no exception, stats byte-identical.
  DR2 far-southern (< -15 dec) coverage thin. `Settings` probes false-negative in the watcher.
- GC: `protection` defaults TRUE (0.1/0.5), `scale` 5, `smoothness` 0.4. Subtractive only.
  Linear data only; nonzero/bright edges artifact, crop first. May spawn model windows.
- GC/MGC can leave channel-differential residue over large dark structure even when no-op at
  target scale.
- ABE no-op default: `targetCorrection` None builds a model, image untouched. To correct:
  `targetCorrection: 1 Subtract / 2 Divide, replaceTarget: true`.

## PixelMath
- No `pow()`; `^` handles fractional/negative exponents. `iif()` exists. `ln(0)` NaN, guard
  `max($T, 0.00001)`. Parenthesize negative literals `(-1.859)`.
- `createNewImage` + `executeGlobal()` needs ALL `newImageWidth/Height/ColorSpace/
  SampleFormat`; `newImageColorSpace`: 2 = GRAY not RGB, use 0 = SameAsTarget.
- Per-channel: `expression`/`expression1`/`expression2`, `useSingleExpression=false`.

## GHS
- Native module; if `new GeneralizedHyperbolicStretch` undefined it loaded after PI launch,
  restart PI.
- `stretchType:0` GH, `stretchFactor` = D LOG slider (D = exp(v)-1), `localIntensity` = b,
  `symmetryPoint` = SP, `stretchChannel:3` = linked RGB.
- HP > SP else NaN; LP < SP else domain error; D=0 identity; b=1 is exactly HT's MTF.

## SCNR
- `protectionMethod`: 0 MaximumMask, 1 AdditiveMask, 2 AverageNeutral (default), 3
  MaximumNeutral. Neutral `G' = min(G, 0.5(R+B))` edits ONLY G, self-gating no-op where G at/
  below midpoint. Mask methods scale green down unconditionally everywhere.
- Modern PI honours Amount for neutral protection (2010 LE doc saying otherwise is stale).
- `invert -> SCNR green -> invert` = `G_new = max(G, (R+B)/2)`. Both directions clamp G toward
  (R+B)/2 which lies between R and B, so saturation is invariant, hue-only op.

## STF / stretch tools
- STF row order `[c0, c1, m, r0, r1]`, NOT the HT order `[c0, m, c1, r0, r1]`.
- STF is screen-only (autostretch: shadows -2.80 sigma, target bg 0.25); bake via HT on a
  clone. On a ~99.9%-black star layer autostretch blows out.
- SetiAstro Statistical Stretch headless: keep the pre-dialog half, strip `#` lines, eval,
  call `processColorImage(view, targetMedian, 1)`. One-shot, converges median to target.
  Dialog-only scripts generally: eval worker functions, never main() (modal, freezes watcher).
- SetiAstro Star Stretch MTF = PixelMath `((3^a)*$T)/((3^a-1)*$T+1)` = HT, tool cosmetic.
- Curves `K` applies one curve to R,G,B individually (crushes the lower channel); `Lt` (CIE L)
  preserves chrominance by construction.

## Other processes
- HDRMT: `invertedIterations` must be boolean. Defaults `numberOfLayers` 6, `toLightness`
  true, `luminanceMask` true. Cannot recover clipped data, rings on pure-white cores.
- MorphologicalTransformation `structureWayTable` broken (arrays error); use `structureSize`.
- LRGBCombination `channelL = [enabled, 'viewId']`; lightness taken 1:1 from L.
- `ChannelExtraction.prototype.CIELab` undefined in bare context; static
  `ChannelExtraction.CIELab` (=2) works.

## Astrometry
- Check `View.window.hasAstrometricSolution` (bool); `astrometricSolution()` THROWS. Solution
  is an XISF property, CTYPE* keywords often absent.
- ImageSolver cannot run via eval (`#include` is compile-time).

## PJSR / bridge API
- `ImageWindow.windowById(id)` NEVER returns null, check `.isNull`.
- ⛔ XISF format hints are SESSION-STICKY: one hinted `saveAs` mutates later unhinted saves.
  Always pass `"compression-codec zlib+sh"` as `saveAs`'s 6th arg (measured best; `+sh`
  shuffling load-bearing).
- `image.median(channel)` THROWS; omit arg or set `image.selectedChannel = c` first.
- ⛔ A lingering `image.selectedChannel` makes `render_view` silently MONOCHROME. Always
  `image.resetSelections()` at the end of measurement helpers.
- Named enum constants undefined in the watcher's bare context (`UndoFlag_*`,
  `ColorSaturation.AkimaSubsplines`, ...); use numerics; `view.beginProcess()` no arg.
- `#` directive lines BREAK eval'd code, strip them. PI 1.9.4 = V8/ES6.
- `File.size()` missing, use `new FileInfo(path).size`. Have: `File.readLines/writeTextFile/
  exists/createDirectory(path,true)`, `searchDirectory(dir+'/*.ext')`. No `DataType_ByteArray`.
- `new ImageWindow(w, h, ...)` throws on Image.width/height passed directly, inject literal
  numbers; 5th ctor arg floatSample=true for float masks.
- WBPP masters spawn extra `*crop_mask*` windows on open, close them.
- Undo history ~300 MB/step on 26 MP f32 RGB; `window.purge()` between runs.
- `view.processing` resets on save+reopen; `createNewImage` outputs start with empty history:
  capture history incrementally, export containers from live views. `export_container` index =
  get_full_history display index minus 1.
- No PJSR API saves `.xpsm` (`writeIcon` only overwrites existing GUI icons). But `.xpsm` is
  plain XML, write it directly; needs the `<icon>` element; `toSource()` prints curve arrays
  multi-line, parse with a multiline regex.
- Process availability: `try { new Name }`; a module installed after launch stays undefined
  until PI restarts.
- Tool args: `open_image` takes `filePath`; `run_script` takes `code`; `save_image` needs
  `overwrite:true`. `MalformedResult` usually means the process still RAN, verify by artifact,
  never retry blind.
- Long scripts: write a file and `File.readTextFile` + eval, don't fight JSON escaping.
- FITS `FILTER` header unreliable for routing (duoband commonly logged NoFilter).
- EZ background mask (`EZProcessingSuite/EZ_Common.js` createBackgroundMask): CIE L ->
  RangeSelection(fuzziness 0.1, smoothness 5, highRange = lightness median).
