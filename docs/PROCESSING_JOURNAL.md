# PixInsight processing journal

Living record of real end-to-end runs: what the pipeline actually did, what worked, what broke,
and what to build or fix next. Updated after every run (via the `process-retro` skill). This is
the M1 "warts and all" deliverable and the working spec for M2+.

**Finding types** — every finding is exactly one of these, and the distinction is the whole point:

| Type | Means | Fix goes to |
|---|---|---|
| `[correctness]` | the agent did something technically wrong (bad API, wrong assumption) | the skill / `CLAUDE.md` |
| `[tooling]` | a task was painful or impossible for lack of a tool | the Tooling backlog (build it) |
| `[quality]` | the *recommended process* produced a poor image | the playbook — **research required, never invent numbers** |
| `[method]` | the measure/verify approach itself was flawed | methodology guidance |

Conflating "executed it wrong" with "the knowledge is wrong" with "the tool is missing" breaks the
improvement loop. Keep them apart.

---

## Current pipeline state — OSC-HOO (best known, after Run 1)

Confidence reflects real-run evidence, not just the playbook's grading.

| Step | Tool | State |
|---|---|---|
| Crop | (skip if `_autocrop`) | ✅ solid |
| PSF correct | BXT correct-only | ✅ solid — **preserved the WCS solve** (see Run 1; the "BXT strips WCS" claim did not hold) |
| Plate solve | (usually already present) | ✅ detect with `window.hasAstrometricSolution`, don't re-solve |
| Flux cal | SPFC | ⚠️ works, but needs filter curves supplied explicitly (empty by default → parse error) |
| Gradient | MGC + MARS DR2 | ✅ **excellent** (−93/94/94% corner spread) — needs `marsDatabaseFiles` passed explicitly |
| Color cal | SPCC narrowband | ✅ neutralized R≈G≈B; ⚠️ clipped blue min to 0 (bg-neutralization) |
| Sharpen | BXT nonstellar | ✅ works; 0.60 read soft, 0.75 accepted (aesthetic) |
| Denoise | NXT | ✅ works; gauge with **MRS noise, not stdDev** |
| Star split | SXT linear | ✅ mechanically clean |
| **Stretch** | GHS/StatStretch | ❌ **THE weak point** — dimmer/worse than STF autostretch, pink background, stars wrong. Needs rework + research. |
| **Color shaping** | SCNR + neutralize + saturation | ⚠️ questionable — SCNR at 100% is not generally recommended; pink/magenta background emerged here |
| Recombine | screen (unscreen) | ✅ mechanically clean |

**One-line read:** the *linear* pipeline is close (with tooling friction); the *nonlinear* half
(stretch + color) is where the result is lost and where the playbook needs the most research.

---

## Tooling backlog (the M2/M4 spec, priority order)

1. ~~**Robust long-process handling**~~ `[tooling, HIGH]` — **FIXED (2026-07-20). NOT a slow process —
   a watcher re-entrancy bug.** First hypothesis (process legitimately outran 300 s → raise the
   ceiling) was **wrong**. Evidence: 5 orphaned result files left in `bridge/results/` from Run 1,
   several containing **raw non-JSON text** (Gaia `.xpsd` paths + a `Gaia_SP_*.bin` temp path — i.e.
   SPCC/SPFC catalog output), never consumed.
   - **Root cause (watcher) — the REAL one, confirmed by a live SPCC run:** the module read the
     result from **`Module->EvaluateScript(...).ToString()`** (the script's completion value). SPCC/
     SPFC/MGC trigger **nested JS evaluation inside the V8 engine** during Gaia photometry; that
     clobbers the outer call's completion value, so `v.ToString()` comes back as unrelated raw text
     (`true\n<Gaia_SP_*.bin temp path>`) instead of our JSON envelope. The process itself succeeds
     (verified: SPCC changed the blue median); only the *reported result* was corrupted. → **Fix:
     the JS wrapper now writes its own result file** (`File.writeTextFile`) from a local built AFTER
     the process returns (immune to the completion-value corruption); C++ writes only a fallback if
     JS didn't. **Proven** on the live module: a JS-written result file was clean JSON even while the
     same command's `EvaluateScript` return was corrupted.
   - **Also added (defensive, not the cause):** a `m_busy` re-entrancy guard in
     `BridgePoller::ProcessPending` — `processEvents` can re-fire the poll timer mid-process; the
     guard stops a nested tick from running a *second* command. (My first hypothesis blamed this
     alone; the synthetic 719k-pump test passed but real SPCC still corrupted — because the real
     bug was the completion value, above.) **Both need the module rebuild to take effect.**
   - **Root cause (client):** on a result file that failed `JSON.parse`, the client's catch just
     re-polled — so a *delivered-but-malformed* result was indistinguishable from "nothing yet" and
     it waited out the full 300 s, returning a phantom timeout. Fixed in `src/bridge/client.ts`:
     tolerate a 2 s partial-write grace, then surface a malformed result as an **immediate error**
     (with the raw content), and consume the file. No timeout inflation.
   - The `longRunning`/extended-ceiling/pre-flight-ping approach was **reverted** — it treated the
     wrong cause and would have hung a genuinely stuck process for an hour.
2. ~~**Programmatic undo / snapshot**~~ `[tooling, HIGH]` — **DONE (2026-07-20), and the premise was
   wrong.** `canUndo=false` was a **misdiagnosis**: `canUndo` is not a property of `ImageWindow`
   (reads `undefined`). Scripted `executeOn` **does** accumulate an undoable process history, and
   `ImageWindow.undo()/redo()/go()` + `view.historyIndex`/`view.canGoBackward` all work from PJSR
   **and persist across separate bridge commands** (verified live). The undo stack is NOT GUI-owned.
   Shipped tools (`src/tools/session.ts`, delivered via `run_script` → **no module rebuild**):
   `get_history`, `undo`, `redo`, `snapshot` (hidden duplicate window), `restore` (undoable
   pixel-assign back). Correct revert signal is **`view.canGoBackward`**, never `canUndo`.
3. **First-class measurement tools** `[tooling, HIGH]` — the agent hand-rolled corner-box gradient,
   MRS noise, and stretch math in `run_script`. Using the wrong metric once (stdDev instead of MRS
   for denoising) caused a false "NXT broke it" alarm and a needless undo. → `get_noise` (MRS),
   `get_background_gradient`, `get_background_neutrality`, and a measurement-driven stretch helper.
   These also make the verify gates reliable instead of improvised.
4. **No-op / empty-param guards** `[tooling, MED]` — MGC with empty `marsDatabaseFiles` and SPFC
   with empty filter curves both silently no-op'd or errored; only the measure→verify gate caught
   them. → validate/populate these before executing, or surface a clear error.
5. **Headless plate solve** `[tooling, LOW]` — ImageSolver is a script needing 19 `#include`s;
   `#define`/`#include` don't run through the watcher's `EvaluateScript` (V8 reads `#` as a private
   field). Fine when the WBPP solve survives (usual), but blocks any unsolved master.

---

## Open research questions (feed the playbook — do NOT guess settings)

- **Stretch (highest priority).** What stretch actually produces a good OSC-HOO result? The
  measurement-driven GHS/StatStretch we tried was worse than a plain STF autostretch. Research:
  GHS parameterization for large emission nebulae, target background, whether to stretch **before**
  SXT, and how to keep the background neutral (the run went pink).
- **Stars.** The star layer stretched too soft; the user wanted much more aggressive. Research:
  stretch stars before vs after SXT split; the right transfer for a tight, bright star field.
- **SCNR.** It was applied green / Average Neutral / amount 1.0 per the playbook, but SCNR at 100%
  is widely discouraged. Research: when SCNR is warranted on HOO, at what amount, vs alternatives.
- **SPCC blue clipping.** Background neutralization clipped blue min to 0. Is that acceptable, or
  should neutralization be deferred / done differently?

---

## Run log

### Run 1 — 2026-07-20 — OSC-HOO — NGC 7000 / Pelican (FMA180 Pro, Antlia ALP-T 5 nm, IMX571)
**Outcome:** complete run (open → `HOO_final`), **poor result**. Linear half solid; stretch/color
poor. Heavy user intervention (undos, timeouts, aesthetic questions). Not saved to disk.

**Findings**
- `[correctness]` Reported the image unsolved — called `window.astrometricSolution()` (not a
  function); the try/catch swallowed the TypeError. Correct check: `window.hasAstrometricSolution`.
- `[correctness]` Assumed BXT strips the WCS; BXT correct-only **preserved** it here. Don't assume —
  verify.
- `[correctness]` Concluded MARS DB "not installed" from failed probes (undefined `DataType_String`
  in the bare context, guessed paths). It was configured. → assume configured; on error, report.
- `[tooling]` Long-process timeouts (SPFC/SPCC/MGC) — see backlog #1. Multiple false "failed".
- `[tooling]` No script undo — see backlog #2. Every revert was manual.
- `[method]` Used stdDev / box-stdDev to judge denoising → false "NXT added noise" alarm; MRS noise
  showed it was fine all along. → gauge denoising with MRS.
- `[tooling]` MGC no-op'd with empty `marsDatabaseFiles`; needed `[[true, "<.xmars path>"]]` table
  row passed explicitly (GUI config didn't transfer). SPFC needed Sony IMX571 curves supplied.
- `[quality]` **Stretch worse than STF autostretch**, dim, pink background — the run's main failure.
- `[quality]` Stars too soft; wanted much more aggressive.
- `[quality]` SCNR at 100% questionable; background went pink/magenta after color shaping.

**Changed this entry:** WCS-detection + BXT-WCS + MARS-assume-configured fixed in `process-master`;
operational gotchas (long-process verify-by-metadata, no-undo, MRS-for-noise, MGC/SPFC param
formats) added to the skill's traps; backlog + research questions above seeded.

**Still open:** everything under Tooling backlog and Open research questions. The stretch rework is
the highest-value next quality task; robust long-process handling + undo are the highest-value tool
tasks.
