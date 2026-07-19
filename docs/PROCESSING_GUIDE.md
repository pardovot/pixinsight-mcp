# Driving PixInsight well via the MCP

The MCP tools let you run any PixInsight process. Running one *correctly* is a
method, not a memorized setting. Follow this loop for every processing step.

## The loop (do this for each step)

1. **Understand the process before running it.**
   Call `get_process_parameters("<ProcessName>")` to see every setting and its
   default. Then reason about what they mean — recall it, or look it up in the
   PixInsight reference docs (https://pixinsight.com/doc/). Pay special attention
   to the **output configuration**, not just the algorithm knobs.

2. **Beware "no-op by default" processes.**
   Several processes default to producing a *side product* rather than modifying
   the target image. Running them with defaults looks like success but changes
   nothing. You must configure the output explicitly. The classic case:
   - **AutomaticBackgroundExtractor**: defaults are `targetCorrection=0`
     (NoCorrection) and `replaceTarget=false` → it only builds a background
     *model* view and leaves the image untouched. To actually correct:
     `{ targetCorrection: 1 /*Subtract*/, replaceTarget: true, normalize: true }`
     (use `targetCorrection: 2` = Divide for vignetting/multiplicative gradients).

3. **Choose settings from measurement — every image differs.**
   Measure first (`get_image_statistics`, or `run_script` for FWHM, gradient
   uniformity, star counts) and pick parameters from what you measured. Do not
   apply fixed defaults blindly.

4. **Execute with explicit settings.**
   `run_process("<ProcessName>", viewId, { ...settings })`.

5. **Verify — always.**
   Re-measure. If the statistics are byte-for-byte identical to before, the step
   was a **no-op** — stop and investigate (usually an output-config issue like
   #2). Never build the next step on an unverified/no-op result.

## Stage matters: linear vs non-linear

- **Linear stage** (pre-stretch): BlurXTerminator, Deconvolution,
  SpectrophotometricColorCalibration, most NoiseXTerminator use, background
  extraction. Running these after stretching gives wrong results.
- **Non-linear stage** (post-stretch): CurvesTransformation, saturation,
  HDR/local contrast, final StarXTerminator compositing.

## Core processes — starting points (confirm via get_process_parameters + docs)

These are sane starting points, not universal truths. Always introspect + measure.

- **AutomaticBackgroundExtractor** — correct in place with
  `{ targetCorrection:1, replaceTarget:true, normalize:true }`. `polyDegree`
  1–2 for smooth gradients, up to 4–6 for complex. `Divide` for vignetting.
- **GradientCorrection** (PI 1.9.x) — often better than ABE for strong/complex
  gradients; prefer it when ABE leaves residual structure.
- **BlurXTerminator** — linear only. Defaults *do* sharpen. Typical:
  `sharpen_nonstellar ~0.90`, `sharpen_stars ~0.25`; `auto_nonstellar_psf` on is
  fine. Use `correct_only:true` first if you only want PSF correction, then
  sharpen after other steps. Over-sharpening → dark halos/worms; back off.
- **NoiseXTerminator** — linear (or with its linear handling). `denoise ~0.90`,
  keep `detail` high to avoid smearing. Verify SNR improved without lost detail.
- **StarXTerminator** — set `stars:true` to also get a stars-only image (the
  target becomes starless). Works linear or stretched.
- **SpectrophotometricColorCalibration (SPCC)** — needs filter transmission +
  sensor QE curves + a white reference, and a valid plate solution. Heavy; the
  biggest source of "it errored" is missing curves/solve.
- **Stretch** — `STF` auto-stretch is a non-destructive screen transfer; a
  *permanent* stretch uses HistogramTransformation targeting a background median
  (~0.10–0.25 depending on look). Measure the current median first.

## What this prevents

The failure this guide exists for: running ABE with defaults, seeing "success,"
and proceeding to sharpen an *uncorrected* image because nobody configured the
output or checked the result. The loop (understand output → measure → verify)
catches exactly that.
