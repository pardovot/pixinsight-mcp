---
name: kb-gate
description: Regression gate for CODE-SIDE changes (module/handlers, measurement tools, render pipeline) and Tier-2 for [quality] playbook changes. Replays the reference target, re-measures every checkpoint, compares against the stored baseline with tolerances, and runs a blind A/B critic against the baseline final. Run once per change BATCH (it takes 10-20 min), never per edit. Pure KB edits do NOT require Tier-1 (repurposed 2026-07-26, the replay never consults the playbook); FAIL always escalates to the human.
---

# KB gate, replay, re-measure, compare, A/B judge

Purpose: code-side changes (module/handler edits, measurement-tool changes, render pipeline)
must not silently degrade a previously-approved result; this is the project's only end-to-end
test on real data. The reference target's replay is deterministic (verified: two clean-room
runs → identical output), so Tier-1 deltas mean real pixel changes or an environment change,
either way, a human decision.

**Repurposed 2026-07-26 (human decision):** the replay never consults the playbook, so pure
KB edits cannot fail Tier-1, do not run it for them. `[correctness]`/`[method]` KB edits
auto-commit directly (per process-retro); `[quality]` playbook changes need Tier-2 or human
review.

## Preconditions

- PixInsight running with the MCP watcher/module active (`list_open_images` responds).
- A clean session, close stray views first (stale ids collide with replay ids).
- The reference source master drive is mounted (replay.js opens the original master -
  see `sourceMaster` in the baseline `result-tests/<target>/metrics.json`).
- ~20 minutes of wall clock (BXT/NXT/SXT run at full resolution).

## Tier-1 (required for every CODE-SIDE batch)

1. **Replay.** Run the reference reproducer via `run_script` with an extended timeout:
   `eval(File.readTextFile("<abs path to result-tests/<target>/replay.js>"))`
   (strip nothing, the file is eval-ready; see its header). It rebuilds the exact final
   state from an empty session, saving/naming its checkpoint views.
2. **Pack each checkpoint.** For every entry in the baseline's `checkpointViews`, run
   `render_critic_pack` on the live replayed view (phase `linear` for post-linear,
   `final` for the final) into a scratch dir per checkpoint.
3. **Compare metrics.** For each checkpoint:
   `node scripts/gate-compare.mjs compare result-tests/<target>/metrics.json <checkpoint> <pack>/metrics.json`
   The output's `verdict` (exit code) is one of:
   - **PASS** (0), no failures.
   - **FAIL** (1), at least one **eye-confirmable** failure (color, brightness/stretch, gradient
     ramp, star brightness, faint survival, visible in the pack). A real regression → hard block.
   - **ADVISORY** (2), only **metric-only** failures (noise, star count, FWHM/eccentricity -
     invisible on an 8-bit downsampled pack). Do NOT hard-block or auto-revert; surface the
     `metricOnlyFailures` list to the human as "metric moved, cannot confirm by eye." This is the
     guard against false-positives on things nobody can see. On deterministic Tier-1 a metric-only
     failure almost always means an environment change (PI/XT version) → re-baseline decision.
   The output lists `eyeConfirmableFailures` and `metricOnlyFailures` separately, carry both into
   the report so a human reviewing a FAIL knows which failures to check by eye and which to trust.
4. **Blind A/B critic on the final.** Open the stored baseline final
   (`result-tests/<target>/rho_final.xisf` or per `checkpointViews`), pack it with the
   SAME `starsRect` as the candidate pack (pairwise packs must crop identical regions),
   copy both packs to neutral `pack-A`/`pack-B` dirs (randomize which is which), scrub
   `viewId`/`path` keys from both `metrics.json` copies (provenance leak), and launch the
   `image-critic` skill as a subagent in Pairwise mode.
   **FAIL** if the candidate loses any axis by ≥ 2 points vs the baseline's stored
   `criticCalibration.baselineScores`, or loses overall with `margin: "clear"`.
5. **Report.** Write `result-tests/<target>/gate-runs/<YYYY-MM-DD>.md`: KB batch under
   test (files + one-line diff summary), compare `verdict` per checkpoint with the
   eye-confirmable vs metric-only failure split, critic scores A/B + verdict, environment
   (PI version vs baseline `piVersion`), and overall PASS / FAIL / ADVISORY. This report is
   what the human reviews alongside the KB diff.

## Tier-2 (required only for `[quality]`-class playbook changes)

A playbook change that alters processing DECISIONS can pass Tier-1 trivially (the replay
doesn't consult the playbook). For those: run a fresh `process-master` run on the
reference source master under the new playbook, then judge the result with the critic
(all axes ≥ 3) and band tolerances (`{band: [lo,hi]}` entries, not tight relative ones -
fresh runs are non-deterministic). Queue for the human when in doubt; Tier-2 is
expensive and its verdicts are softer.

## Hard rules

- **Never adjust the baseline or a tolerance to make a run pass.** A FAIL is information
  for the human. Re-baselining is a human decision (typically after a PI/XT upgrade -
  compare `piVersion` first).
- `[correctness]`/`[method]` KB edits auto-commit WITHOUT Tier-1 (it cannot see them);
  `[quality]` playbook changes need Tier-2 or human review. Tier-1 PASS clears code-side
  batches.
- An **ADVISORY** verdict does NOT auto-revert and does NOT auto-commit, it holds the batch
  for a human glance (the human confirms the metric-only drift is benign, then commits or
  re-baselines). Never silently treat ADVISORY as PASS.
- Gate reports are append-only history, never delete or rewrite past runs.
