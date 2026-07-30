# M106 - process-v2 run, 2026-07-30

Pilot run 1 of the library rebuild. **Calibration mode (SKILL 3a): `references/library.json` is
empty, galaxy has 0 accepted / 0 rejected, so the class does not gate.** No class distance is
computed and no class range is quoted anywhere below; every number is absolute.

| field | value |
|---|---|
| target | M106 |
| category | osc-rgb galaxy |
| class | `galaxy` (from the prompt, not from the path and not from `FILTER`) |
| capture | `data/C8/M106/OSC/RGB/` (Telescope C8 / OSC / RGB) |
| master | `masterLight_BIN-1_6248x4176_EXPOSURE-180.00s_FILTER-No-Filter_RGB_autocrop.xisf` |
| recipe | `recipes/osc-rgb-linear.js` **rev 2** |
| profilerRev | **3** (`scripts/profile.js`, native scale, significant-figure output) |
| output | `data/C8/M106/OSC/RGB/runs/2026-07-30/` |
| delivered | 4 variants, **unpicked**, no full-res apply |

---

## 1. Linear stage, one shot

`checks.ok = true` on the first run. No re-verification per step, no retry.

```json
{"recipe":"osc-rgb-linear","rev":2,
 "steps":[{"step":"open","ms":2960,"medianAfter":0.0011873},
          {"step":"headroom_skipped_max_0.573","ms":17},
          {"step":"bxt_correct_only","ms":13727,"medianAfter":0.0011875},
          {"step":"spfc","ms":8880,"medianAfter":0.0011875},
          {"step":"mgc","ms":10408,"medianAfter":0.0011878},
          {"step":"spcc","ms":11230,"medianAfter":0.0001602},
          {"step":"bxt_sharpen","ms":12054,"medianAfter":0.00016},
          {"step":"nxt","ms":11871,"medianAfter":0.0001577},
          {"step":"sxt_split","ms":8927,"medianAfter":0.0001575}],
 "checks":{"gradient":{"cornerMedians":[0.0001547,0.0001555,0.0001556,0.0001542],
                       "center":0.0006055,"rampRel":0.0091,"pass":true},
           "clipping":{"fracHi":0,"fracLo":0,"pass":true},
           "stars":{"peak":0.2967,"fracLit":0.00005,"pass":true},
           "ok":true},
 "marsFiles":["MARS-DR1-u01-1.0.1.xmars","MARS-DR2-1.0.3-s08.xmars"],
 "mgc":{"attempted":true,"declined":false,"fallback":null},
 "views":{"starless":"M106_starless","stars":"M106_stars"},
 "timing":{"totalMs":102122,"stepsMs":80074,"checksMs":194,"saveMs":20683,
           "overheadMs":22048,
           "slowest":["bxt_correct_only:13727ms","bxt_sharpen:12054ms","nxt:11871ms"]}}
```

**Timing read.** `totalMs` 102122. `stepsMs` 80074 (78%) is PixInsight compute and no driver
change touches it. `overheadMs` 22048, of which `saveMs` 20683 (94%) is writing the three
~215 MB full-res XISFs; `checksMs` is 194. So the overhead is essentially disk, not driver logic.
Nothing to fix here.

MGC ran and did **not** decline (MARS covers this field). Frame after autocrop: **6067 x 4082**.

Linear state picture: `00_linear_starless.jpg` (auto STF, 4x, for the log only). The stars layer
was never autostretched.

---

## 2. Crop selection - the 5-term gate could not be met, and why

⚠️ **This run did not produce a crop passing all five gate terms at 5%. Read this section before
using the delivered numbers as a reference.**

The skill scores candidate crops against the full frame on `skyP25`, `lumP50`, `grainRelSky`,
`structure.RoverG`, `structure.RoverB`, requiring every term within 5%.

**Full-frame reference (native scale, profilerRev 3):**

```
skyP25 0.000151489   lumP50 0.000157637   grainRelSky 0.0308685
RoverG 1.02128       RoverB 1.05931
p75 0.000164793   p95 0.000209329   p99 0.000475695   p99.9 0.00156835
```

**What the search found.** Three passes were run (42, 63 and 45 candidates; 1500x1000, 2400x1600
and 3600x2400):

| crop size | best gate `worst` | where it landed |
|---|---|---|
| 1500x1000 | **2.08%** `[0,1230,1500,2230]` | frame edge, no galaxy |
| 2400x1600 | **1.57%** `[3100,2100,5500,3700]` | starts 52 px right of the core |
| 2400x1600 | **1.73%** `[3000,2100,5400,3700]` | contains the core, ~92% sky |
| 3600x2400 | **6.24-7.0%** (all candidates) | galaxy centred |

The 1.73% crop was cut, rendered, and **rejected on inspection**: it is ~92% empty sky with the
galaxy as a corner sliver (`01_crop_linear.jpg` was regenerated after this, the sliver version is
not kept). Tuning contrast and colour on it would have been tuning sky noise.

**The diagnosis is structural, not a bad search.** M106's frame is ~92% sky *by area*, so
`lumP50`, `RoverG` and `RoverB` measured on the full frame are **sky statistics**: the frame's
"bright" population (p70-p95 = 0.000209) is still sky, which is why full-frame `RoverG` is 1.021,
i.e. essentially colour-neutral. Matching those terms therefore *forces* the crop to be sky. Two
independent confirmations:

1. A 1500x1000 crop is 6% of frame area, so the core's area fraction inside it is ~16x the
   frame's. Every gate-passing 1500x1000 candidate had **p99 off by 56-63%**. Matching the sky
   percentiles and the highlight ladder simultaneously is arithmetically impossible at that size.
2. At 3600x2400 every candidate passed `skyP25` (<=2.7%), `lumP50` (<=4.0%), `grainRelSky`
   (<=4.5%) and `RoverG` (<=2.0%), and failed **only `RoverB`**, always in the same direction
   (crop 1.125-1.133 vs frame 1.059, i.e. **high**). That is the galaxy's real R-over-B trend
   appearing once the crop stops being mostly sky.

**Decision taken (unattended, no prompt).** Deliver on a galaxy-centred 3600x2400 crop and record
the one breached term rather than deliver a sky-only crop that satisfies the letter of the gate.
Tone ops here are **pointwise**, so what must transfer is the sky *level* and the *grain*, not the
histogram's area fractions; those terms all pass. Recorded so the reader can discount it, not
buried.

**Chosen crop: `[1450, 1200, 5050, 3600]` (3600x2400, 35% of frame area, native scale).**

| term | crop | full frame | dev |
|---|---|---|---|
| skyP25 | 0.000155166 | 0.000151489 | **+2.43%** pass |
| lumP50 | 0.000163425 | 0.000157637 | **+3.67%** pass |
| grainRelSky | 0.0303301 | 0.0308685 | **-1.74%** pass |
| RoverG | 1.04108 | 1.02128 | **+1.94%** pass |
| RoverB | 1.12577 | 1.05931 | **+6.27%** BREACH (gate 5%) |

Contains the core (full-res peak at **(3048, 2120)**, linear peak 0.087443), both spiral arms and
the dust lanes, with a sky margin on all four sides. The stars layer was cut at the identical rect.
Crop views: `M106_c_starless`, `M106_c_stars`. Picture: `01_crop_linear.jpg`.

**Consequence for the library.** Every delivered variant is `extent: crop` and its `cropMatch`
records this breach. If the intent is a `galaxy` reference profile whose `RoverB` is comparable
across targets, be aware these numbers are measured on a galaxy-centred crop, not on a
sky-weighted full frame; the two are ~6% apart on `RoverB` for this object and the gap will scale
with how much of the frame the galaxy fills.

---

## 3. Variant search (calibration mode)

No class profile exists, so variants 1-3 are defined by **spanning the plausible sky-level range**
rather than by distance to a reference. The span was chosen a priori (nothing was recalled from
the v1 library or from earlier runs, per SKILL 3a).

Shared linear->nonlinear stretch for all four: `HistogramTransformation`, **per-channel** shadow
clip at `median - 2.8 sigma` (sigma = 1.4826 x MAD), single common midtone. Per-channel clip is
deliberate: a single common `c0` would leave a 73% pedestal fraction and amplify the sky's
relative channel differences by ~3.7x, i.e. manufacture a sky colour cast.

```
c0 = [0.000118587, 0.000119708, 0.000119458]     (R, G, B)
```

| variant | role | midtone `m` | sky p50 target | sky p50 got | skyP25 got |
|---|---|---|---|---|---|
| v1 | mid of the range | 0.00032282 | 0.120 | 0.1199 | 0.0939 |
| v2 | low end, punchier | 0.00047379 | 0.085 | 0.0849 | 0.0652 |
| v3 | high end, softer | 0.00024001 | 0.155 | 0.1548 | 0.1258 |
| v4 | v1 tone, alt palette | 0.00032282 | 0.120 | 0.1199 | 0.0937 |

All four hit their target within 0.3%.

### Op lists (replayable)

Machine-readable: **`oplists.json`**. Applier: **`apply-ops.js`** (`APPLY_OPS(viewId, ops)`).
Curve nodes for the `L` (CIE L*) channel are given in L* space; `type: 0` = Akima subsplines.

**v1 - reference-matched (mid sky)**
1. `HT` c0 as above, m 0.00032282
2. `CURVE L` `[[0,0],[0.412,0.4008],[0.7607,0.7875],[1,1]]`  (value space: 0.1199->0.1128, 0.50->0.545)
3. `CURVE S` `[[0,0],[0.04,0.036],[0.09,0.15],[1,1]]`

**v2 - darker-punchier (low sky)**
1. `HT` c0 as above, m 0.00047379
2. `CURVE L` `[[0,0],[0.3498,0.3398],[0.6947,0.7322],[1,1]]`  (0.0849->0.0797, 0.40->0.455)
3. `CURVE S` `[[0,0],[0.04,0.036],[0.09,0.15],[1,1]]`

**v3 - brighter-softer (high sky)**
1. `HT` c0 as above, m 0.00024001
2. `CURVE L` `[[0,0],[0.4628,0.4591],[0.7904,0.8046],[1,1]]`  (0.1548->0.1498, 0.55->0.575)
3. `CURVE S` `[[0,0],[0.045,0.043],[0.09,0.125],[1,1]]`

**v4 - alt-palette (v1 tone, cool arms / warm core)**
1. `HT` c0 as above, m 0.00032282
2. `CURVE L` same as v1
3. `CURVE B` `[[0,0],[0.12,0.12],[0.30,0.315],[0.70,0.70],[1,1]]`
4. `CURVE R` `[[0,0],[0.12,0.12],[0.70,0.715],[1,1]]`
5. `CURVE S` `[[0,0],[0.04,0.038],[0.09,0.175],[1,1]]`

Shared star stretch (one pointwise op, applied once to the **full-res** stars layer, identical for
all four): `HT` c0 `[0,0,0]`, m **0.021002**. See section 5.

### Rejected during the search (recorded, not repaired)

- **HDRMultiscaleTransform for the core: dropped.** Tested on v1 (6 layers, 1 iteration,
  `toLightness` + `luminanceMask` true, deringing 0.1/0.25). It **flattened the dust lanes badly**
  (`t_core_hdr.png` vs `t_core_v1.png` at 1:1) while moving the peak only 0.998 -> 0.995. It was
  not needed: the core box (600x500 at 1:1 around the nucleus) measures p25 0.503, p50 0.612,
  p75 0.717, p95 0.836, with only **3.7% above 0.85 and 0.33% above 0.95**, and whole-crop
  `fracClipHi` is 0. The stretch does not blow the core, so there was nothing for HDR to buy.
  Introspected HDRMT defaults on this machine were `toLightness=false`, `luminanceMask=false`,
  which contradicts `docs/facts.md`; every parameter was pinned explicitly rather than trusted
  (the BXT persisted-settings trap).
- **v4 attempt 1: uniform channel rebalance, dropped.** `B` +4.9% / `R` -2.7% at value 0.45
  cancelled the galaxy's own R-over-B trend (`RoverB` 1.178 -> **1.060**), which left the
  saturation curve nothing to boost (object bands fell to 0.060/0.030, `fracSatLt01` rose to
  0.136). Replaced by the luminance-dependent palette above, which **redistributes** the trend
  (`RoverG` 1.058 -> 1.078, `RoverB` 1.178 -> 1.098) instead of removing it.
- **v4 attempt 2: ordering.** Running the channel curves *after* the saturation curve partly undid
  the boost (object bands 0.117/0.102 vs v1's 0.121/0.123). Final order puts `S` last.

---

## 3b. Hard guards - measured, per variant

Every curve was measured on a **1024-step ramp** (`RAMP_SLOPE` in `apply-ops.js`), never read off
the chord, because Akima overshoots its chord by ~5%. The ramp meter reads back **the channel the
op actually drives**; measuring a per-channel curve on channel G reports a false identity (1.00003),
which is how the v4 curves first mis-measured.

**Curve slope guard (max local slope <= 1.2):**

| curve | max slope | at | verdict |
|---|---|---|---|
| v1 / v4 `L` | **1.14957** | 0.519 | pass |
| v2 `L` | **1.1832** | 0.470 | pass |
| v3 `L` | **1.07835** | 0.543 | pass |
| v4 `B` | **1.09913** | 0.217 | pass |
| v4 `R` | **1.0412** | 0.365 | pass |

All curves are 4-5 control points with ~10% deltas. No local slope above 1.2, none approaching 8+
points.

**Curve compression gate (avg slope above the pivot >= 0.85):**

| variant | m (sky in) | m' (sky out) | (1-m')/(1-m) | verdict |
|---|---|---|---|---|
| v1 | 0.1199 | 0.1128 | **1.00807** | pass |
| v2 | 0.0849 | 0.0797 | **1.0057** | pass |
| v3 | 0.1548 | 0.1498 | **1.00593** | pass |

All three sit at ~1.0, far above 0.85, because the background level is set by the stretch and the
tone curve does not have to lift it. No step needed splitting, so the curve -> HDR -> curve
alternation was never triggered.

**Grain gate (local slope / level ratio ~ 1 at the sky):**

| variant | local slope at sky | level ratio | grain multiplier |
|---|---|---|---|
| v1 | 0.920117 | 0.940784 | **0.978** |
| v2 | 0.967236 | 0.938554 | **1.031** |
| v3 | 0.967392 | 0.967868 | **0.9995** |

None of the contrast curves amplifies sky grain.

**Masks:** none were hand-rolled, and none were needed. The saturation curves key on saturation
itself, which separates here (sky band 0.040 vs object bands 0.074-0.079 before the boost), so the
`clip((mean(RGB)-k)/w)` failure mode never arose and no `RangeSelection` mask was constructed.

**Rejections:** the two v4 attempts above were **regenerated, not repaired**. All four delivered
variants pass every guard by construction.

---

## 4. Contact sheet - NO auto-select

**`contact-sheet.jpg`** (2400x1688, labelled 2x2). Per-variant renders: `v1.png` ... `v4.png`.

**The driver did not pick.** The class does not gate, so **no distance to a class profile was
computed** - there is no reference to compute one against. The four absolute profiles, side by
side (native scale, profilerRev 3, measured on the crop):

| metric | v1 | v2 | v3 | v4 |
|---|---|---|---|---|
| skyP25 | 0.0938533 | 0.0652192 | 0.125754 | 0.0937449 |
| lum p1 | 0.0544904 | 0.0369934 | 0.0751782 | 0.054318 |
| lum p50 | 0.112458 | 0.079542 | 0.1502 | 0.112414 |
| lum p75 | 0.155094 | 0.111569 | 0.204918 | 0.155351 |
| lum p95 | 0.359704 | 0.274906 | 0.439763 | 0.362273 |
| lum p99 | 0.731213 | 0.653601 | 0.776708 | 0.733587 |
| bandsSat | 0.1776 / 0.0544 / 0.051 / 0.1211 / 0.1233 / 0.0729 | 0.0986 / 0.049 / 0.1025 / 0.1475 / 0.1544 / 0.0879 | 0.2102 / 0.0677 / 0.0372 / 0.0767 / 0.0868 / 0.0579 | 0.243 / 0.079 / 0.0531 / 0.0869 / 0.1419 / 0.1174 |
| skyBand (index) | 2 | 1 | 2 | 2 |
| skyBandSat | 0.051 | 0.049 | 0.0372 | 0.0531 |
| RoverG | 1.05804 | 1.0637 | 1.04057 | 1.07819 |
| RoverB | 1.17826 | 1.19752 | 1.12388 | 1.09788 |
| grainRelSky | 0.103742 | 0.114024 | 0.0986737 | 0.104517 |
| textureD8med | 0.0163224 | 0.0125149 | 0.0204104 | 0.0164229 |
| fracSatLt01 | 0.04543 | 0.0374527 | 0.0372499 | 0.048675 |
| tilesMinSat | 0.0156856 | 0.0174359 | 0.0154145 | 0.0220369 |

This is a description of where each variant sits, not a verdict. All four passed every 3b guard.

Reference points for reading the above: the **linear** crop measured `skyP25` 0.000155166,
`grainRelSky` 0.0303301, `RoverG` 1.04108, `RoverB` 1.12577, `textureD8med` 0.00000777283.
`grainRelSky` rises ~3.3-3.8x across the stretch, which is inherent to going nonlinear, and rises
most for the darkest variant (v2, 0.114) and least for the brightest (v3, 0.0987), exactly as the
level-ratio physics predicts.

---

## 5. Verification (no full-res apply)

### Per variant, on the crop (which is 1:1)

| check | v1 | v2 | v3 | v4 |
|---|---|---|---|---|
| `fracClipHi` | 0 | 0 | 0 | 0 |
| `fracClipLo` | 0 | 0 | 0 | 0 |
| `fracAch` (exactly R=G=B) | 0 | 0 | 0 | 0 |
| `tiles.maxTileAchFrac` | 0 | 0 | 0 | 0 |
| colour trend vs linear input | same sign, strengthened | same | same | same, redistributed |

Class-free invariants only, as calibration mode requires: no clipping at either end, no
exactly-achromatic tiles, colour trend preserved. Per-band saturation, `grainRelSky` and texture
are reported above as **absolute** numbers and are **not** checked against a class range, because
none exists.

### Stars, on the FULL-RES stars layer

Shared star stretch applied once to the full-res `M106_stars` (6067x4082) -> `M106_stars_s`.
Linear star-pixel median (samples > 0.005) was **0.0141031**; target 0.40; post-stretch lit-pixel
(> 0.15) median **0.33802**, p25 0.2255, p75 0.5814, p95 0.9366. Measured on star **pixels**, not
the global median, which is degenerate on a ~99.99%-black layer (`fracLit` 0.00013).

**Ring scan.** 33 star peaks above 0.55 were located on the stretched full-res star layer, then
each was measured on the **full-res linear starless**: local background = median of the r=30-46 px
annulus, dip = 2nd percentile of the r=6-20 px annulus.

- brightest star **(5724, 584)**, peak 0.9989, dip **3.32%**
- worst dips: (144,608) 11.97%, (508,1928) 10.11%, (5456,1704) 9.69%, (780,3000) 8.97%,
  (4120,2440) 8.49%
- **median dip over all 33 stars: 7.26%**

**Control (this is what makes the number interpretable):** the same estimator at **120 star-free
sky positions** (no lit pixel within 60 px) gives median **10.27%**, p90 **11.59%**, p99 27.11%.

So the dips around stars are **at or below the noise floor of the estimator on empty sky** - the
worst star (11.97%) sits at the control's p90. **No detectable BXT undershoot ring.** Without the
control the 7-12% figures would have read as real rings; they are not.

**1:1 visual crops from full res** (300x300 each):

- `z_star_brightest.png` - (5724,584) on the stretched star layer: tight round point, no ring, no
  halo, no boxing.
- `z_star_worstring.png` - (5456,1704), the worst non-edge dip, same layer.
- `z_starless_atring.png` - the same rect on the linear starless (auto STF): clean noise, a faint
  small SXT removal residual at centre, no annulus.
- `z_core_v1.png` - object core at 1:1 (v1): dust lanes and nuclear structure resolved, warm
  nucleus, no clipped plateau, no ringing.
- `z_sky_v1.png` - sky patch at 1:1 (v1): even, neutral, no mottling, a faint background galaxy
  visible.

Stars were judged only here, on the full-res layer, so stars outside the crop are included.

### Whole-frame gradient

From the recipe on the linear starless: corner medians
`[0.0001547, 0.0001555, 0.0001556, 0.0001542]`, centre 0.0006055, **rampRel 0.0091, pass**. All
tone ops in every variant are pointwise, so the flat linear frame stays flat; no per-variant
gradient re-measurement is needed.

**No guard breach required a regeneration at this stage.** Nothing is delivered flagged.

---

## 6. Files

| file | what |
|---|---|
| `M106_linear.xisf` / `_starless` / `_stars` | full-res linear stage output (recipe) |
| `M106_v1_crop.xisf` .. `M106_v4_crop.xisf` | the four variants, 3600x2400 at native scale |
| `oplists.json` | replayable op lists + `_shared_stars` + crop rect |
| `apply-ops.js` | the applier (`APPLY_OPS`), ramp slope meter, compression gate |
| `profile_v1.json` .. `profile_v4.json` | profilerRev 3 `s1` blocks, for `npm run library` |
| `meta_v1.json` .. `meta_v4.json` | grading stubs, fill `verdict` |
| `contact-sheet.jpg`, `v1.png` .. `v4.png` | the 2x2 sheet and per-variant renders |
| `z_*.png` | 1:1 verification crops |
| `00_linear_starless.jpg`, `01_crop_linear.jpg` | linear state, crop state |
| `t_core_v1.png`, `t_core_hdr.png` | the HDRMT test that was rejected |

**Applying a pick.** `replay-variant.js` does not exist in the repo yet; `apply-ops.js` is the
replay path used here. To apply variant N at full res: open `M106_linear_starless.xisf`, run
`APPLY_OPS` with `oplists.json` -> `vN`, apply `_shared_stars` to `M106_linear_stars.xisf`, then
recombine. The op lists are pointwise and were tuned at native scale, so they transfer to full res
unchanged.

---

## Notes that did NOT become rules

None of the below passed the `docs/facts.md` gate (objective + reproducible tool behaviour), so
they stay here:

- The 5-term crop gate is not satisfiable on a frame where the object's *bright* pixels are a small
  area fraction while the object itself is visually large. Three of the five terms are sky
  statistics on such a frame. This is an observation about one procedure on one object, not a tool
  fact, and the right fix (gate on sky/grain terms only, or scale the crop with the object's area
  fraction) is a skill change to propose, not a finding to record.
- HDRMT flattening dust lanes at these settings is an aesthetic result on this object, not
  reproducible tool behaviour.
- The ring-scan control methodology (measure the same estimator on star-free sky before believing a
  dip) is generally useful but is a measurement habit, not a tool fact.

---

## 7. Grading outcome (2026-07-30, graded by user)

| variant | verdict | skyP25 | user's words |
|---|---|---|---|
| v1 | **accepted** | 0.0939 | "decent balance, background is good, galaxy highlight is okay" |
| v2 | **rejected** | 0.0652 | "a bit too dark ... but this helps the core not being overexposed and bloated, so the core is good here" |
| v3 | **rejected** | 0.1258 | "everything a bit too bright ... core is completely washed, but the good part is that the galaxy fainter details are visible" |
| v4 | **accepted** | 0.0937 | "the best result overall, like v1 but with better colors" |

Class `galaxy` is now **2 accepted / 2 rejected** and **does not gate** (needs 1 more accepted).
That is deliberate. The alternative on the table was to also accept v2, which would have gated the
class immediately off a single object; three entries from one image is really n=1. The third accept
should come from a **different target**.

Accepted sky level is bracketed from both sides: **too dark at 0.0652, good at 0.0938, too bright
at 0.1258.** That two-sided bracket is the useful product of this run, and it only exists because
the four variants were spread rather than clustered.

**What the verdicts revealed that no metric caught.** The user rated v2's core *better* than either
accepted entry, and v3's core "completely washed", while faint-detail visibility runs the opposite
way (best in v3). So **core quality and faint-detail visibility are coupled to the same knob in
opposite directions, and none of the four variants decouples them.** Neither end is visible to this
contract: `fracClipHi` is 0 for all four, and v3's lum p99 (0.7767) is only 6% above the accepted
v1 (0.7312). Recorded in both rejects' `lesson`.

---

## 8. For run 2

**1. Crop framing must become a search criterion. It currently is not.** `CS_SEARCH` scores
statistical match only; the delivered rect was then chosen among gate-passing candidates by
eyeballing the galaxy off a 4x-downsampled JPEG. Measured afterwards, from the marginal flux
profile of `M106_starless` above sky:

| threshold (frac of peak marginal) | x extent | y extent | centre |
|---|---|---|---|
| 10% | 2556 - 3504 | 1764 - 2472 | (3030, 2118) |
| 5% | 1992 - 3996 | 1504 - 2756 | (2994, 2130) |

(2% saturates to the whole frame: faint halo merges into the noise floor. Core is at (3048, 2120).)

Delivered crop centre is **(3250, 2400)**, i.e. **+230 px in x and +275 px in y** off the object,
so it clips the top of the galaxy and leaves dead sky at the bottom - an 11% vertical framing error
on a 2400 px crop. User-visible, and correctly called out.

The properly centred rect **`[1220, 925, 4820, 3325]`** was measured and scores gate `worst`
**6.64%** vs the delivered crop's 6.27% - the same pass/fail profile (only `RoverB` breaches, again
high). **So centring costs nothing on the metrics.** The fix is to measure the object extent first,
centre the crop on it, and use the statistical gate as a *filter*, not as the thing that picks the
position.

Deliberately **not** re-cut for this run (user call): the entries stay as delivered, with the
framing error documented here rather than silently corrected.

**2. Decouple core from faint detail.** See section 7. HDRMT was the intended tool and failed here
(flattened the dust lanes, section 3). Untried option: GHS with a symmetry point at the sky and a
highlight-protection point, which is designed for exactly this and is documented in
`docs/facts.md`. A variant axis of "same sky level, different highlight handling" would be more
informative than a third tone level, now that sky level is bracketed.

**3. Search cost.** The crop search ran six passes (~6 min of a ~20 min run) chasing a gate that was
structurally unsatisfiable; the failure was already diagnostic after pass two (all candidates
passing on sky terms, failing only `RoverB`, always high). Also: the 40k-sample full-frame reference
was recomputed inside every `CS_SEARCH` call, and the 25 MP star layer was scanned twice at stride 3
(~17M `img.sample()` calls). `img.sample()` is the dominant cost of the whole run, ~40-50M calls.
