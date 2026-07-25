# Mosaic (multi-panel) assembly, a CROSS-CUTTING STAGE playbook

> Provenance: web research (2025-2026 secondary sources) + the **PixInsight GradientMergeMosaic
> primary doc read in full locally** + PJSR source inspection (`MosaicByCoordinates`,
> `StarAlignment` enums) + **one fully verified end-to-end run (R9, 2-panel OSC-RGB, Rho Ophiuchi,
> 2026-07-25)**. Confidence/consensus tags preserved. Numbers tagged `[R9]` are ONE measured
> datapoint, treat as a starting hypothesis, not law.

## ⛔ This is NOT an acquisition category

There is no `osc-rgb-mosaic.md` / `mono-lrgb-mosaic.md`. Six categories x mosaic would be twelve
playbooks with ~80% duplication. Mosaic is a **second combination point** on an axis orthogonal to
acquisition category, and it reuses the decomposition model already in `README.md`:

| Combination point | Combines | Defined in |
|---|---|---|
| **Channel** combination | per-filter masters → one RGB | the category playbooks |
| **Panel** combination | per-panel masters → one mosaic | **this file** |

**The governing rule from `mono-rgb.md` generalises almost verbatim.** For channels it reads
"additive+filter-specific or geometric → pre-combine; anything solving a relationship across the
set → post-combine". For panels:

| Do it PER PANEL (pre-merge) | Do it ONCE on the mosaic (post-merge) |
|---|---|
| Crop / edge trim | BXT **sharpening** pass |
| BXT **Correct Only** (PSF/aberration) | NXT denoise |
| Plate solve | Stretch + all nonlinear work |
| Gradient removal | Colour shaping / saturation |
| Colour calibration (SPCC) | Star split + star stretch + recombine |

**Why colour calibration is per-panel and not post-merge** (this is where the panel axis differs
from the channel axis, where SPCC is strictly post-combine): SPCC is photometric and needs a WCS
per image; each panel has its own solve, its own airmass and its own extinction. Calibrating each
panel independently is also what makes the panels *match*. · High · Consensus (PI forum: "SPCC
must be done on individual panels before they are stitched"; running it on a finished mosaic is
possible but needs a distortion-consistent solution mapped across the whole frame).
[R9: the two panels returned near-identical WB factors, 0.7536/0.6738 vs 0.7524/0.6612, which is
itself the evidence that per-panel calibration left them consistent.]

**Read your category playbook for everything else.** This file only owns the assembly stage.

---

## Where the stage slots in

```
per panel:  [category pre-processing] → crop → BXT Correct Only → plate solve
                                      → gradient removal → colour calibration → SAVE
   assemble:  register → match intensities → merge → crop
on mosaic:  BXT sharpen → NXT → [category nonlinear half, unchanged]
```

**Stitch while LINEAR.** · High · Consensus. Every source assumes linear panels, and the nonlinear
half then runs once on the whole field so tone and colour cannot diverge between panels.
(GradientMergeMosaic's own doc notes it *can* run on stretched data and that stretched images are
"less prone to problems" thanks to reduced dynamic range, that is a **fallback for a failing
merge**, not the default.)

**BXT Correct Only before assembly, sharpening after.** · Medium · Single-source (RC Astro):
correcting aberrations pre-assembly gives cleaner PSFs for the solver and better registration;
sharpening after avoids doing it twice and keeps it uniform. RC Astro additionally suggests
re-solving each panel after Correct Only. [R9 followed this; FWHM 4.60 → 3.62 px on the merged
mosaic.]

---

## 1. Register the panels

Three routes. Pick by panel count and whether the panels are plate-solved.

### 1a. StarAlignment, `Register/Union - Separate` · verified [R9]
Native, headless, no script driving. **Execute it ON THE TARGET view with the reference named**,
union modes refuse global/batch execution ("StarAlignment batch tasks can only work in the
'Register/Match' and 'Transformation Matrices' modes").

```
mode = 2                      // StarAlignment.RegisterUnionSeparate (0=RegisterMatch, 1=RegisterUnion)
referenceIsFile = false
referenceImage  = "<reference view id>"
frameAdaptation = true        // linear intensity match, see step 2
distortionCorrection = true   // 2-D surface splines; handles field curvature + projection differences
```
Outputs two images on a common union frame, `<target>_mosaic_1` (reference remapped) and
`_mosaic_2` (target remapped). Both carry the full union geometry with **zero outside coverage**,
which is exactly what the merge step expects.
- Enum constants are `undefined` in the watcher's bare context. Discover them by setting a numeric
  value and reading `ProcessInstance.toSource()` back, it prints the symbolic name.
- `intersection` (0 NoIntersection / 1 MosaicOnly / 2 Always) stays at its default.

### 1b. MosaicByCoordinates (script) · Medium · Consensus for 2-3 panels
Purely WCS-driven: every panel must already be plate-solved (`ImageSolver`), then the script
reprojects all panels onto one common frame (`_ra` suffix). No star matching needed, so it works
where overlap is small or starless. Auto-derives centre, resolution, projection and dimensions.
**Not exercised here**, `StarAlignment` covered the R9 case natively; prefer 1a when panels overlap
well, prefer this when they barely do.

### 1c. Synthetic star field, for 3+ panels · Medium · Consensus
For larger mosaics, do **not** chain panel-to-panel (errors accumulate and the reference keeps
changing). Instead:
1. `ImageSolver` on the **centre-most** panel only; note RA, Dec, rotation, pixel size.
2. **`CatalogStarGenerator`** to synthesise a star field slightly larger than the mosaic.
3. `StarAlignment` every panel against that synthetic field.
Registering all panels to one common synthetic reference is the documented preference over
pairwise chaining.

**Star-detection tuning if registration fails:** lower `sensitivity` (log-sensitivity) to detect
more stars, raise `peakResponse`, and consider thin-plate-spline / distortion correction for
minimal-overlap panels. · Low · community judgment, no sourced numbers.

**Overlap:** R9 worked comfortably with **808 px ≈ 20%** of the short axis. No source gives a
minimum. Treat 20% as "known to work", not as a threshold.

---

## 2. Match panel intensities BEFORE merging

· High · Consensus. Every source says the same thing: brightness must be equalised before
integration, and a merge tool hides *seams*, not *level differences*.

Two mechanisms, use one:
- **`StarAlignment` frame adaptation** (`frameAdaptation = true`), applies the linear intensity
  match during registration. Simplest, and what GradientMergeMosaic's own doc recommends ("Use the
  Frame Adaptation feature of the StarAlignment tool ... Alternatively, use the LinearFit tool").
- **`dnaLinearFit`** (installed script), computes the intersection between panes, runs LinearFit on
  that overlap only, and copies the scale factor to the target. Correct choice for the
  MosaicByCoordinates route (1b), which has no frame adaptation of its own.

---

## 3. Merge, and ⛔ MEASURE FIRST

**⛔ Do not reach for GradientMergeMosaic reflexively. Measure whether it has anything to do.**

### What GMM is actually FOR (read this before deciding)
Its own doc states the purpose precisely: StarAlignment's frame adaptation "does an excellent job",
but "it still leaves **small seams that cannot be removed by purely linear adjustments**". So GMM
exists to absorb the **non-linear residual** that a linear intensity match cannot: panels shot on
different nights, at different altitudes, under different sky brightness or moon, where the
mismatch is a *spatially varying gradient difference* rather than a constant offset or scale.
**In that situation GMM is the correct tool and a feather blend will show a seam.**

### The decision rule [R9, candidate rule, needs a second target]
Sample the overlap on both registered panels; compute the per-pixel difference **and its spatial
structure** across the overlap, then compare to the image's own **MRS noise sigma**:

| Residual across the overlap | Use |
|---|---|
| At/below noise level **and spatially flat** | **feather blend** (nothing non-linear to fix) |
| Above noise level, or **varying across the overlap** | **GradientMergeMosaic** (this is its job) |

⚠️ **Do not over-generalise from R9.** That was the *easy* case: 2 panels, same target, same
session, same night, already frame-adapted, residual median 2e-6 with spread +/-5e-5 against MRS
sigma 2.9e-5, i.e. flat and at the noise floor. **Multi-night and many-panel mosaics will often
fail this test, and should use GMM.** The rule is "measure before choosing", NOT "avoid GMM".
Keying on magnitude alone is insufficient, a small but *structured* residual still needs GMM.

[R9 measured median **2e-6**, spread **+/-5e-5**, against MRS sigma **2.9e-5**, i.e. the panels
agreed to within the noise. GMM was therefore rejected on evidence.]

### Why this matters, the GMM failure mode · verified [R9]
GMM's Poisson/"elastic membrane" solve spreads the measured edge difference smoothly across the
frame. When a **bright star sits near the boundary of a panel's valid data**, that discontinuity is
enormous and the solve smears it into a large, smooth **colour blob** (R9: a red halo above and a
teal halo below a bright star, ~250 px across, plus a second at the other panel's edge). This is
the documented "stars cause problems at seams" case.
- **You cannot fix it with the tool's own knobs on a bad case:** `nShrinkCount` (shrink radius)
  **caps at 10** (= 20 px removed) and the offending stars sat further in than that. The doc's own
  escape hatch is "use the manual clone stamp tool to remove the offending star from all but one of
  the contributing images", i.e. manual.
- GMM's other documented remedies, in order: raise `nFeatherRadius` (default 10) for stars at
  seams; raise `nShrinkCount` (default 1) for surviving seams; as a last resort merge **stretched**
  images.
- GMM takes **files, not views**, so save the registered panels first. `type` 0=Overlay (last image
  wins, order matters), **1=Average** (default; better SNR in the overlap, order-independent).
  `blackPoint` 0 is correct for StarAlignment output, whose outside-coverage pixels are exactly 0.

### Feather blend (when the panels already agree)
A guarded linear cross-fade over the overlap. Guarding matters: without it, a pixel covered by only
one panel gets averaged against zero and darkens.

```
va = iif( A > 0, 1, 0 );            // A, B = the two registered panels
vb = iif( B > 0, 1, 0 );
wy = max( 0, min( 1, (Y() - y0) / span ) );   // Y() is NORMALISED to [0,1] over (H-1)
ww = iif( va*vb > 0, wy, va );      // both valid → feather; only one valid → take that one
ww*A + (1 - ww)*B
```
Declare `va, vb, wy, ww` in PixelMath's **Symbols** field. Place the feather window inside the
region where both panels are valid, and **inset it well away from each panel's data edge** so that
truncated bright stars never sit in the blend.

**Verify the seam by profile, not by eye alone:** take a median profile of narrow strips running
across the seam. A correct merge is **monotone through the blend window with no step**; real
astrophysical gradients continue smoothly through it. [R9 verified this way.]

---

## 4. Crop the union frame

The union is larger than the covered area and its edges are ragged (rotation between panels) and
carry interpolation ramps. Find the largest fully-covered inner rectangle (scan rows/columns for
the data boundary), then **inset it by ~20 px** to drop the soft interpolated edge.
**Verify: no zero pixels remain in any channel.** [R9: 6254x7473 union → 6159x7396 cropped.]

---

## 5. Post-merge gradient removal, CONDITIONAL

Secondary sources list a gradient-removal pass after merging, to smooth residual differences across
panels. · Medium · Contested in practice.

⛔ **Do not run it blindly on a nebula-filling or dust-filled field.** [R9] The mosaic spanned a
large dust complex; the whole-frame gradient metric read a ~30% top-to-bottom ramp and the blind
critic called it a defect, but it was **real dust**, and a gradient correction would have read the
dust *as* the gradient and eaten it. Two independent checks settled it:
- A **sky-floor profile** down the frame: flat, then a smooth monotone decline **through the seam
  with both panels agreeing**, then flat again. A per-panel level error cannot look like that.
- **Per-channel plane asymmetry:** R ramped ~3x harder than B (`by` = -0.261 vs -0.080), which is
  what a yellow dust cloud produces, not an additive light-pollution ramp.

Rule: run post-merge gradient removal only if the residual is (a) discontinuous at the seam, or
(b) spectrally flat across channels. Otherwise leave it, and see the metric caveats below.

---

## 6. Measurement caveats specific to mosaics

These metrics **lie on mosaics** and have caused wrong decisions [all R9]:

- **Histogram peak / stretch gate.** A mosaic spanning heterogeneous sky is **bimodal**. A global
  argmax jumps between peaks and reported channel modes disagreeing 2x (R 0.088 / B 0.175), which
  reads as catastrophic over-black-pointing but is pure artifact. → **measure the peak PER REGION**
  and gate each. [R9 final: 0.154 and 0.226, both acceptable, no single number describes it.]
- **Gradient corner-spread** has no honest reading on a dust-filled wide field, no corner is empty
  sky. Judge on the render; check per-channel plane asymmetry before believing it.
- **Background-neutrality band (+/-8%)** is not actionable when the field is heterogeneous: R9's
  blank-sky patches showed **R-B flipping sign** across the frame (blue in one half, red-brown in
  the other). A single global additive offset cannot fix a sign-flipping pattern and would only
  flatten real colour. Measure several blank patches and check the sign before nulling.

---

## 7. Per-category hooks (the only category-dependent part)

| Category | Panels per filter | Ordering of the two combination points |
|---|---|---|
| OSC-RGB, OSC-HOO | one image per panel | Panel combination is the only combine. Follow this file, then the category's nonlinear half. |
| mono-RGB, mono-LRGB, mono-HaLRGB, mono-SHO | N filters x M panels | **Mosaic each filter first, then channel-combine.** · Low · **single-source**, reasoning-supported. |

**The mono ordering argument** (worth more than its sourcing): mosaicking per filter means matching
intensities along **one** axis (panels) within each filter, then performing a normal channel
combine. Doing it the other way forces you to match intensities across **both** axes at once, every
panel against every channel. The forum guidance is "do each channel as a mosaic ... then put it
together as a regular HaRGB afterwards". ⚠️ **Untested here**, verify before relying on it.

Otherwise the stage is category-agnostic, secondary sources explicitly state that mosaic assembly
"fits seamlessly into the existing workflow, regardless if working with Broadband ... or Narrowband
workflows". Category-specific rules (SPCC curve selection, the SPCC-narrowband deadlock, palette
mapping) are unchanged and stay in the category playbook.

---

## Contested / open

1. **The measure-overlap-agreement rule is ONE datapoint.** Needs a target whose panels genuinely
   do NOT match, to confirm GMM is the right tool there.
2. **MosaicByCoordinates route untested** in this project.
3. **PhotometricMosaic** (John Murphy) is repeatedly described as more robust than GMM with less
   intervention, but it is **not installed here**, so it was never evaluated.
4. **Mono per-filter ordering** single-source (see above).
5. **Minimum workable overlap** unknown; 20% verified.
6. **Post-merge gradient removal**: sources say do it, R9 says conditional. Unresolved in general.
7. **SXT `overlap` on cluster-bearing mosaics** is an open lead, not a default (see the journal).

## Unverified specifics (do not treat as gospel)
Star-detection tuning numbers for failed registration; the 3+ panel synthetic-star-field route
(sourced but not run here); "small mosaic = 2-3 panels" as a threshold; post-merge Dynamic Crop
rotation adjustment. `lightvortexastronomy.com` is **down at origin** (Cloudflare DNS failure,
2026-07-25), its mosaic tutorial could not be consulted.

## Reference implementation
`result-tests/Rho-Ophiuchi-2Panel-Mosaic/` holds a working end-to-end example: `replay.js`
(empty → final, includes the registration + feather blend + crop with the geometry asserted),
`HISTORY.md` (16 warts), `metrics.json` (both checkpoints + the mosaic-specific
`expectedDeviations` that must NOT be gated as failures).
