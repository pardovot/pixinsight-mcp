# Background work — neutralize the sky to gray without killing faint signal

Cross-cutting reference (HOO now; OIII/SHO/RGB noted). Built from a deep-research run
(`wf_bb8b080b`, 21 sources, 19 verified claims) **plus** a live measure→render→judge demo on a
real OSC-HOO starless (Run 7, 2026-07-22), user-validated by eye. Palette-specific knobs are
flagged; **no numbers here are universal defaults — measure per image.**

## The goal (objective function)

The **true empty-sky background** should be **neutral gray**: channels balanced **and brightness
preserved** (neutral at its own level, *not* crushed to black). **Faint signal must survive** — the
whole difficulty is the fine line between faint nebula and background, which is why every method is
either mask-gated or gated by construction.

**Two axes, do not conflate them:**
- **Color** (is the background neutral?) — the main job.
- **Brightness** (is it gray, or black?) — neutralizing *badly* (pulling color toward the low
  channel) darkens the sky to black. Neutralizing *well* preserves each pixel's luminance.

## Verify by the RIGHT signal [method — Run 7]

- **The render is the judge.** Downsample (IntegerResample -4) and LOOK; compare variants
  side-by-side. Metrics guided every wrong turn this session.
- **⛔ The ±8% diffuse-sky-band channel-spread metric LIES post-operation.** It is correct for
  *linear pre-stretch* neutrality (its original use), but after a post-stretch neutralization it
  reads 2–3% "non-neutral" on a visually-perfect gray background — it catches protected
  nebula-edge pixels. Do **not** gate a post-stretch result on it.
- **Honest post-stretch metrics:** (a) **background chroma** = mean saturation of the
  near-neutral population (`|R−(G+B)/2| < ~0.01`) — this genuinely tracks neutrality; (b)
  **faint/bright-red preservation ratio** = median of the signal-hue channel over faint
  (`rex∈[0.02,0.05]`) and bright (`rex>0.05`) pixels, after/before — should be ~100%.

## The recipe that worked (OSC-HOO, Hα-dominant) [Run 7, user-validated]

Post-stretch, on the starless. Two stages, each covering the other's blind spot. **`rex ≡ R−(G+B)/2`**
is the "redness excess" (the signal-hue axis for HOO).

**Stage 1 — luminance-dependent per-channel leveling (fixes the cast).**
The background cast is **brightness-dependent** and flips sign — teal in the dark lanes, ~neutral
at sky level, slightly red above. A *single* additive offset (measured at sky level) therefore
**cannot** neutralize the dark lanes (that was demo "A": left them teal). Instead:
1. Grid-sample background pixels (`|rex| < ~0.012`), bin by luminance `L=(R+G+B)/3`.
2. Per channel, least-squares fit the residual `channel−L` vs `L` → `a + b·L`.
3. Subtract per channel: `R' = R − (aR + bR·clamp(L))`, same for G,B, with `L` clamped to the
   sampled range so extrapolation past the data can't over-correct bright signal.
- **Safe on signal by construction:** an additive offset of ~0.001–0.005 is negligible on a
  bright red pixel (R≈0.5) but neutralizes the dim background where those offsets are significant.

**Stage 2 — teal→own-luminance, gated to the teal side (fixes the residual color, keeps it GRAY).**
Neutralize the remaining teal (dark lanes) by pulling those pixels toward **their own luminance**
(preserves brightness → *gray*, not black), gated so red is untouched:
```
gate = clip(-rex / w, 0, 1)          # 1 for teal (rex<0), 0 for neutral/red (rex>=0)
new  = pixel + (L - pixel) * gate    # pull toward luminance where teal
```
- **Red preserved by construction:** `rex>0` ⇒ `gate=0` ⇒ untouched. No mask, no leak — ~100%
  faint-red preserved (measured 99.9%+).
- **Gray, not black:** pulling toward `L` (the pixel's own luminance) removes chroma while holding
  brightness — the exact fix for "neutralize made it black."
- `w` ≈ 0.02–0.04 (Run 7). Higher = neutralizes milder teal too. Tune on the render.

## Per-target triggers (why this doesn't blindly transfer)

- **The signal hue is the dominant emission.** HOO Hα ⇒ protect **red** (`rex = R−(G+B)/2`,
  gate on `rex<0`). **OIII-rich HOO / SHO / RGB ⇒ re-key** on the palette's signal hue (e.g.
  protect teal/`OIII`, gate the opposite side). The *method* transfers; the hue axis does not.
- All numbers (`w`, level offsets, bin range) are **measured per image**, never hardcoded.

## Failure-mode catalog (the negative knowledge — half the value) [Run 7]

Every one of these was tried on the same image and rejected by eye:

| Approach | Why it fails |
|---|---|
| **Desaturate toward luminance under a mask** (blurred-chroma / luminance mask) | The *operation* is symmetric — pulls red down as readily as teal. Any mask leak onto faint red **kills it**. No mask tuning fixes a wrong operation. Also converts colored bg to *dark* gray. |
| **SCNR blue→green @100% + a mask** | Over-stacked: SCNR flattens the reds (dead/brown), the mask adds blotchy nebula↔bg transitions. Was the **worst** result. Don't stack SCNR + mask chasing a metric. |
| **Single additive offset** (naive method 1) | Can't fix a **brightness-dependent** cast → dark lanes stay teal. |
| **Teal-shrink toward R** (`G,B −= t·max(0,G−R)`) | Preserves red perfectly, but pulls teal down to the *low* R of dark lanes → **black, not gray.** Right idea (asymmetric), wrong target (R instead of luminance). |
| **Per-pixel redness mask alone** | Protects the R-dominant background *cast* too → can't neutralize. Needs Stage-1 leveling first. |

## SCNR — a valid conditional, not doctrine [research + Run 7]

- SCNR is **direction-symmetric** (remove blue/green/red; Average Neutral clamps the target down
  to the other-two average: `G' = min(G, (R+B)/2)`). The **amount slider IS operative** on Average
  Neutral (blends toward the clamp — the "amount inert" claim is **refuted**).
- **HOO "SCNR blue→green" (user method 2) is mechanically sound** — SCNR green pushes a neutral bg
  blue, so blue-first then green. It **structurally cannot reduce a red pixel** (red-safe), so it
  neutralizes teal without touching Hα. **But:** it can't touch red-*noise*, and on this
  R-dominant cast it under-neutralized; stacked with a mask it flattened reds (above). **Use only
  when the background cast is genuinely green/blue-dominant**, never on RGB/SHO (kills real data),
  never blind at 100%. A **mask is needed only if the highlights actually contain the removed
  channel** (measure: does blue/green in the nebula exceed its clamp target?).
- **invert → SCNR-green → invert removes MAGENTA** (complement): `G_final = max(G, (R+B)/2)`.
  Proven; for magenta star fringing / casts. Mask if real magenta signal exists.

## Doctrine correction [research-confirmed]

The old rule *"neutrality is linear-only; never fix a cast after stretch; never use SCNR"* is **too
broad** — it came from **blind unmasked SCNR@100%** failures (Runs 1–2). Corrected:
- **Linear pre-stretch neutralization stays PRIMARY** (SPCC `neutralizeBackground` / a linear
  additive null is a pixel-wise per-channel *subtraction* — the right mechanism).
- **Post-stretch neutralization is a legitimate SUPPLEMENT** (Light Vortex Astronomy does exactly
  this on nonlinear narrowband) — fires as cleanup when a cast survives the stretch. Measured and
  gated, never blind.

## Perception note [Run 7]

Removing chroma makes a region **read darker at identical luminance** (colored areas look
brighter than gray). So neutralizing inherently makes darks *look* blacker — this is why
brightness must be **preserved** (pull toward luminance), and why "too dark after neutralize" must
**not** be fixed by global brightening (that just washes the neutral gray you built).

## Mask mechanics (when a mask IS the right tool) [research]

- **Polarity:** white selects / black protects (`result = orig·(1−mask) + proc·mask`). Background
  work ⇒ mask **white over background, black over nebula**, and **smooth it** (or a noisy mask
  protects noise as if it were signal).
- **RangeSelection:** raise **Lower limit** (bg→black, object→white); **Fuzziness** softens the
  value-domain edge; **Smoothness** = Gaussian blur. Build it on a **nonlinear** image. It **can't
  exclude stars** → subtract a StarMask in PixelMath (`range − star`), dilate stars first.
- **Coherence trick** (if you must separate faint signal from noise by a mask): blur the
  signal-hue map (Gaussian σ≈15–25) so incoherent *noise* averages to zero but coherent *nebula*
  survives — but note Run 7 found the gated-by-construction Stage-2 approach cleaner than any mask
  here.
