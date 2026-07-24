# Autonomy protocol, how the loop runs without per-image human review

Since 2026-07-24 the training loop is: **process-master** (with blind critic gates at phase
boundaries) → **image-critic** findings → **process-retro** (types + routes) → **kb-gate**
(regression) → auto-commit or queue. The human moved from per-image inspection to per-batch
review. This file defines exactly what stays human.

## The pieces

| Piece | Role | Blind to |
|---|---|---|
| `render_critic_pack` + measurement tools | produce the evidence (renders + metrics) |, |
| `image-critic` skill (subagent) | judge packs against `docs/CRITIC_RUBRIC.md` | transcript, parameters, provenance |
| `process-retro` skill | type findings, apply safe fixes, queue research |, |
| `kb-gate` skill | replay-based regression before any KB commit | which pack is candidate vs baseline (A/B randomized) |
| `docs/CRITIC_RUBRIC.md` | the objective function | **human-owned, loop may only propose** |

## What the human still does

1. **Per-batch KB review (weekly cadence, or per retro batch):** read the KB diff + the
   `gate-runs/<date>.md` report together. The gate report exists precisely so this review is
   minutes, not a full image inspection.
2. **Sampled eyeball audit, about 1 run in 10:** look at the run's final + its critic packs
   like the old days; file notes into process-retro. Critic-vs-human disagreements become
   `[method]` findings against the rubric. This is the drift detector for reward hacking -
   don't skip it because recent runs "looked fine"; the sampling is the point.
3. **Rubric changes.** Only the human edits `docs/CRITIC_RUBRIC.md` (version-bump each time).
   The loop proposing rubric edits as queued findings is expected and healthy; applying them
   itself is the failure mode this file exists to prevent.
4. **Re-baselining.** After a PI/XT upgrade or a deliberate look change, regenerating
   `result-tests/<target>/metrics.json` (and its critic scores) is a human-approved action.
5. **Aesthetic taste calls** the run prompt names (star intensity, palette choices), memory:
   stretch/curves are per-object taste, not researchable; the critic enforces "technically
   clean", the human owns "looks right".

## Forced-human triggers (regardless of sampling)

- kb-gate **FAIL** (any tier).
- A critic **revise loop exhausted** (2 cycles on one axis without clearing it).
- A **new target category** (first run of a playbook), full audit, not sampled.
- The critic reports a context **leak** or a pack it could not judge.

## Anti-reward-hacking rules (why each mitigation exists)

- **Critic blindness** (no transcript/params): the processor can't argue its case; the critic
  can't rationalize what it can't see.
- **Human-anchored rubric** (R5/R6 brackets, approved-final metrics): scores trace to human
  verdicts, not model taste.
- **A/B order randomization + provenance scrub** in the gate: the critic can't learn to favor
  "the new one" (`viewId`/`path` keys are stripped from pack metrics copies).
- **Frozen versioned rubric + gate reports as append-only history**: a drifting judge is
  detectable after the fact.
- **1-in-10 human audit**: the backstop for everything above.

## Eye-confirmable vs metric-only failures (the false-positive guard)

The gate never hard-blocks you on something you can't see. Every metric failure is classified:
- **Eye-confirmable**, color cast, brightness/stretch level, gradient ramp, star brightness,
  faint survival. Visible in the critic pack → a failure hard-blocks (`verdict: FAIL`, exit 1).
- **Metric-only**, noise (invisible grain on an 8-bit downsampled pack), raw star count,
  sub-pixel FWHM/eccentricity. A run whose ONLY failures are metric-only → `verdict: ADVISORY`
  (exit 2): not a block, not an auto-pass, a human glances, confirms the drift is benign (or
  decides to re-baseline after a PI/XT upgrade), and proceeds. You are never asked to trust a
  hard failure on a change you cannot confirm by eye.

Noise carries a deliberately loose tolerance (±15%, vs ±2-5% for visible metrics) precisely
because it's metric-only, only gross drift trips it, benign version-bump jitter does not.
These thresholds live in `result-tests/<target>/metrics.json` and are human-tunable.
