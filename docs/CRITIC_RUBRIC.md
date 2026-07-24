# Image Critic Rubric, v1 (2026-07-24)

**HUMAN-OWNED.** The critic and retro skills may PROPOSE edits to this file (as queued
`[method]` findings) but must NEVER apply them. Rubric changes are the human's job -
this file IS the objective function, and letting the loop edit its own judge is how
reward hacking starts. Version-bump the header on every change.

Scoring: each axis 1-5. 3 = acceptable, 4 = good, 5 = excellent; 1-2 = defect requiring
revision. **The render is the judge; metrics corroborate**, when a metric and the image
disagree, believe the image (journal R7: metrics guided every wrong turn).

Calibration anchors come from graded real runs: R5 = too bright/milky, R6 = too
dark/faint-crushed, Rho Oph R8 final = user-approved good (bgChroma 0.049, near-neutral
medians 0.138, faint-band signal median 0.212).

## Axis 1, Stretch level (judge on full.png)

The background should read as deep but not crushed; the object should carry the image.

- Histogram-peak target band (metrics: near-neutral medians / GHS mode): **0.20-0.25**.
  Peak < 0.18 = over-black-pointed (R1-R4 failure class); a "milky" flat look with
  peak ≥ ~0.17 but no contrast = the R5 failure (mode 0.168 read milky until a contrast
  S-curve de-milked it).
- 5: object luminous, background deep, clear tonal separation. 3: slightly flat or
  slightly dark but nothing lost. 1-2: milky veil over the whole frame, OR shadows
  crushed to black (check axis 3 before scoring 1).

## Axis 2, Background (judge on corner-*.png; corroborate with metrics.neutrality)

Objective function (docs/background-work.md): true empty sky = **neutral GRAY** -
color-neutral AND brightness-preserved. Neutralized-to-black is a failure, not a success.

- Post-stretch: bgChroma (mean saturation of near-neutral population) is the honest
  metric, approved reference ≈ 0.05. The ±8% band spread metric LIES post-stretch;
  ignore it there.
- Look for: color casts in corners (teal/green/magenta), blotchy transitions,
  gradient ramps corner-to-corner.
- 5: even neutral gray all four corners. 3: faint cast visible on inspection only.
  1-2: obvious cast or corner-to-corner ramp, or background crushed to pure black.

## Axis 3, Faint-signal survival (judge on full.png + darkest corner crop)

The fine line between faint nebula and background is the whole game. `min > 0` is NOT
preservation, barely-there structure must READ, not merely exist.

- Faint outer structure (dust, halo edges, faint arms) should be visibly above the
  background, with texture, not posterized or clipped away.
- Metrics corroboration: faint-band signal median across before/after should hold
  (~100% preservation ratio).
- 5: faint structure clearly readable with tonal depth. 3: present but weak.
  1-2: faint structure gone or reduced to noise-mush.

## Axis 4, Stars (judge ONLY on stars.png + 1:1 corners; global stats hide buried stars)

- Star-layer stretch target: star-pixel median ~**0.4** (band 0.35-0.45) after star
  stretch (memory-verified; the 0.10-0.20 guesses read as barely-there).
- Color: stars should show color variety (blue/white/yellow/orange), not flat white
  discs and not fringed. Green tint or magenta/purple fringing = the R8 gated-correction
  failure classes (measured hue casts: fix when >~5%).
- Profiles: tight, round at 1:1; no halos, no dark rings (over-sharpened BXT), no
  "soft blobs" (over-stretched star layer).
- 5: tight colorful stars, clean profiles. 3: acceptable but flat-ish color or slight
  softness. 1-2: blown/merged star field, strong fringing, or barely-there stars.

## Axis 5, Artifacts (judge on core.png + all crops)

- Recombine seams/halos around bright stars (screen-blend artifacts), SXT residuals
  (star ghosts in the starless regions), tiling/blotches from denoise, posterization,
  clipping flats (histogram slammed at 0 or 1, metrics: min/max sample counts),
  visible correction boundaries.
- 5: none found at 1:1. 3: minor, only visible when hunted for. 1-2: any artifact
  obvious at pack resolution.

## Verdict rule

- **pass**, every axis ≥ 3.
- **revise: <axis>**, any axis ≤ 2, or ≥ 2 axes at exactly 3 with an identifiable cause.
  Name the single worst axis.

## Pairwise (A/B) mode, used by the kb-gate

When given two packs labeled A and B (order randomized by the caller, provenance
hidden): score both independently FIRST, then declare per-axis winners and an overall
winner. Never let the overall winner drag individual axis scores.
