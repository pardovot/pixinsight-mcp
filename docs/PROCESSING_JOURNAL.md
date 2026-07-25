# PixInsight processing journal

Living record of real end-to-end runs: what the pipeline actually did, what worked, what broke,
and what to build or fix next. Updated after every run (via the `process-retro` skill). This is
the M1 "warts and all" deliverable and the working spec for M2+.

**Autonomy (2026-07-24):** runs are critiqued by the blind `image-critic` skill against
`docs/CRITIC_RUBRIC.md` (human-owned), and KB edits are regression-gated by `kb-gate` before
committing. The human review protocol (per-batch KB diff, 1-in-10 eyeball audit, forced-human
triggers) is `docs/AUTONOMY.md`.

**Finding types**, every finding is exactly one of these, and the distinction is the whole point:

| Type | Means | Fix goes to |
|---|---|---|
| `[correctness]` | the agent did something technically wrong (bad API, wrong assumption) | the skill / `CLAUDE.md` |
| `[tooling]` | a task was painful or impossible for lack of a tool | the Tooling backlog (build it) |
| `[quality]` | the *recommended process* produced a poor image | the playbook, **research required, never invent numbers** |
| `[method]` | the measure/verify approach itself was flawed | methodology guidance |

Conflating "executed it wrong" with "the knowledge is wrong" with "the tool is missing" breaks the
improvement loop. Keep them apart.

---

## Current pipeline state, OSC-HOO (best known, after Run 6)

Confidence reflects real-run evidence, not just the playbook's grading.

| Step | Tool | State |
|---|---|---|
| Crop | (skip if `_autocrop`) | ✅ solid |
| PSF correct | BXT correct-only | ✅ solid, **preserved the WCS solve** (see Run 1; the "BXT strips WCS" claim did not hold) |
| Plate solve | (usually already present) | ✅ detect with `window.hasAstrometricSolution`, don't re-solve |
| Flux cal | SPFC | ⚠️ works, but needs filter curves supplied explicitly (empty by default → parse error) |
| Gradient | MGC + MARS DR2 | ✅ **excellent** (−93/94/94% corner spread), needs `marsDatabaseFiles` passed explicitly |
| Color cal | SPCC **broadband** + duoband curves | ⛔ **R7: SPCC narrowband mode HARD-DEADLOCKED PI 3×** (force-restarts). **Use broadband** (`narrowbandMode=false`) + per-channel `Sony CMOS X-UVIRcut / Antlia-ALP-T` curves (from `library/filters.xspd`) + `Sony IMX411/…/571` QE, runs clean via `executeOn`. Contradicts R1-R6 (NB worked then); cause unknown. |
| Sharpen | BXT nonstellar | ✅ works; 0.60 read soft, 0.75 accepted (aesthetic) |
| Denoise | NXT | ✅ works; gauge with **MRS noise, not stdDev** |
| Star split | SXT linear | ✅ mechanically clean. ⚠ **`unscreen=false` on linear** (R4 wrongly used true; unscreen is for nonlinear extraction, RC-Astro). |
| **Bg neutrality** | linear additive offset (primary) **+ post-stretch background work** | ✅ **R3 VALIDATED (linear)**, diffuse-sky band (±8% of lum median), NOT darkest-N%. Null residual with additive-offset PixelMath. Don't use the `BackgroundNeutralization` *process* (blew up ×100). **R7: post-stretch neutralization is a legit supplement** (doctrine softened) → `docs/background-work.md`: luminance-dependent curves leveling + teal-toward-own-luminance gated to `rex<0` (gray not black, red preserved). ⚠️ **the ±8% spread metric LIES post-stretch**, judge on the render. |
| **Stretch** | **native GHS** + a pinned lift-curve (measurement-driven, iterative) | ⚠️ **R5=too bright/milky, R6=too dark/faint-crushed, the two bracket the target (it's a BAND).** R6 fix for R5 milkiness: SP just *above* the bg peak (bg compresses down, dark) + a `CurvesTransformation` pinned at the bg rising above it → decoupled bg-darkness from object-lift, killed the milkiness. **But overshot:** user "nebulosity too dim; fainter nebulosity VANISHED with the background." **Method gap:** "no clipping (min>0)" ≠ faint-nebula preserved (R6 mins>0 yet faint gone) → add an explicit **faint-nebula-survival check** on the render. Don't trade object brightness for a dark bg. Exact levels = OPEN (objective function). |
| **Star stretch** | **single MTF + ColorSaturation** (SetiAstro Execute, replayed) | ✅ **method solid (R5-R6): star-PIXEL median (`>~0.005`) not layer median (≈0); include the `ColorSaturation` pass; verify at 1:1.** ⚠ **amount is per-target and wants to go HARDER than first guess:** R5 `a≈4.5`; **R6 user: `amount=6, satAmount=1.3` for NAN/Pelican** (my `a=4.0/sat=1.0` too soft). T≈0.35-0.45 is a *starting point*, push harder + confirm 1:1; darker bg tolerates harder stretch. **Per-object datapoint, NOT a default** (user: "other targets might not be as good"). SetiAstro installed (`star_stretch.js`); replay ops, don't `#include`. |
| **Color shaping** | gated SCNR, gentle saturation | ⚠️ **SCNR correctly skipped R3-R6** (rule never fired). **R6: saturation "way too much"**, a strong S-curve `[[0,0],[0.35,0.5],[0.7,0.83],[1,1]]` over-cooks an already-saturated SPCC result → keep gentle + verify on render. gold/teal recipe + duoband star color still OPEN. |
| Recombine | `starless*~stars + stars` (≡ screen) | ✅ formula correct. **R3 "star artifacts" reframed (R4): they were the GHS star-WASH, not SXT residual** → fixed by a natural HT star layer, not a combine change. |

**One-line read:** the *linear* pipeline is solid. Nonlinear-half after Run 6: **star-stretch METHOD is
solid** (star-pixel median + ColorSaturation + 1:1 verify; only the per-target *amount* is tuned, wants to go
harder, R6 a=6/sat=1.3 for NAN). **The remaining weak spot is the STRETCH-TONE objective:** R5 (too bright/
milky) and R6 (too dark, faint nebula crushed, over-saturated) bracket a target *band* the agent can't yet
self-judge, the self-critique LOOP works, but the **judgment quality** (faint-nebula survival, saturation
restraint, don't-sacrifice-object-brightness) is the gap. That's the per-object *objective function*, an open
research/tooling task, NOT a numbers hunt. Color (gold/teal) deferred.

---

## Tooling backlog (the M2/M4 spec, priority order)

1. ~~**Robust long-process handling**~~ `[tooling, HIGH]`, **FIXED (2026-07-20). NOT a slow process -
   a watcher re-entrancy bug.** First hypothesis (process legitimately outran 300 s → raise the
   ceiling) was **wrong**. Evidence: 5 orphaned result files left in `bridge/results/` from Run 1,
   several containing **raw non-JSON text** (Gaia `.xpsd` paths + a `Gaia_SP_*.bin` temp path, i.e.
   SPCC/SPFC catalog output), never consumed.
   - **Root cause (watcher), the REAL one, confirmed by a live SPCC run:** the module read the
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
     `BridgePoller::ProcessPending`, `processEvents` can re-fire the poll timer mid-process; the
     guard stops a nested tick from running a *second* command. (My first hypothesis blamed this
     alone; the synthetic 719k-pump test passed but real SPCC still corrupted, because the real
     bug was the completion value, above.) **Both need the module rebuild to take effect.**
   - **Root cause (client):** on a result file that failed `JSON.parse`, the client's catch just
     re-polled, so a *delivered-but-malformed* result was indistinguishable from "nothing yet" and
     it waited out the full 300 s, returning a phantom timeout. Fixed in `src/bridge/client.ts`:
     tolerate a 2 s partial-write grace, then surface a malformed result as an **immediate error**
     (with the raw content), and consume the file. No timeout inflation.
   - The `longRunning`/extended-ceiling/pre-flight-ping approach was **reverted**, it treated the
     wrong cause and would have hung a genuinely stuck process for an hour.
2. ~~**Programmatic undo / snapshot**~~ `[tooling, HIGH]`, **DONE (2026-07-20), and the premise was
   wrong.** `canUndo=false` was a **misdiagnosis**: `canUndo` is not a property of `ImageWindow`
   (reads `undefined`). Scripted `executeOn` **does** accumulate an undoable process history, and
   `ImageWindow.undo()/redo()/go()` + `view.historyIndex`/`view.canGoBackward` all work from PJSR
   **and persist across separate bridge commands** (verified live). The undo stack is NOT GUI-owned.
   Shipped tools (`src/tools/session.ts`, delivered via `run_script` → **no module rebuild**):
   `get_history`, `undo`, `redo`, `snapshot` (hidden duplicate window), `restore` (undoable
   pixel-assign back). Correct revert signal is **`view.canGoBackward`**, never `canUndo`.
3. ~~**First-class measurement tools**~~ `[tooling, HIGH]`, **SHIPPED (2026-07-24, live-verified vs the
   R8 reference values):** `get_noise` (MRS, matched the 8.5e-6 checkpoint), `get_background_gradient`
   (grid boxes + plane fit), `get_background_neutrality` (linear ±8%-band: 0.51% vs recorded 0.48%;
   poststretch: near-neutral chroma per background-work.md), `get_star_metrics` (star-pixel median
   0.0109 vs recorded 0.0106; FWHM/ecc via moments; adaptive threshold, MAD collapses on stars-only
   layers, noise-floored + x4 escalation). `src/tools/measurement.ts` + `src/pjsr/measure-*.ts`,
   run_script-delivered (no module rebuild). A measured stretch helper remains open (#8/#12).
   Original text: the agent hand-rolled corner-box gradient,
   MRS noise, and stretch math in `run_script`. Using the wrong metric once (stdDev instead of MRS
   for denoising) caused a false "NXT broke it" alarm and a needless undo. → `get_noise` (MRS),
   `get_background_gradient`, `get_background_neutrality`, and a measurement-driven stretch helper.
   These also make the verify gates reliable instead of improvised. **Run 2:** still hand-rolled MTF
   3× and an STF-autostretch reimpl; STF-auto **blows out star fields** (median≈0 → maps noise to
   0.25), so the star layer was a blind `m=0.10` guess. Need: `get_noise` (MRS), gradient/neutrality,
   a measured nonlinear-stretch helper, and a **star-field-aware** star stretch.
4. **No-op / empty-param guards** `[tooling, MED]`, MGC with empty `marsDatabaseFiles` and SPFC
   with empty filter curves both silently no-op'd or errored; only the measure→verify gate caught
   them. → validate/populate these before executing, or surface a clear error.
5. **Headless plate solve** `[tooling, LOW]`, ImageSolver is a script needing 19 `#include`s;
   `#define`/`#include` don't run through the watcher's `EvaluateScript` (V8 reads `#` as a private
   field). Fine when the WBPP solve survives (usual), but blocks any unsolved master.
6. **SPFC/SPCC curve provisioning** `[tooling, MED]`, SPFC ships empty curves and errors; Run 2 had
   to materialize IMX571/Astronomik CSVs (`scripts/spcc-curves.mjs`) to a file and read them in PJSR
   just to enable MGC (SPCC-NB has built-in Sony curves; SPFC doesn't). → a first-class curve source
   the SPFC path injects automatically from the equipment profile.
7. **SXT spawned-window cleanup** `[tooling, LOW]`, SXT with `stars=true` opens a `*_stars` window;
   `undo` on the starless restores the stars but **orphans that window** (Run 2, user-confirmed).
   An SXT wrapper (or the undo tool) should track and close it.
8. **Native GHS not registered / no stretch tool** `[tooling, HIGH]`, Run 3: `new
   GeneralizedHyperbolicStretch` was `undefined` so the agent fell back to a PixelMath port (harder to
   tune → slightly dim result), **but the signed module IS in `bin/`**, it just wasn't loaded (installed
   after PI launch; needs restart). → (a) doc/checklist: restart PI so the module registers, then use
   `run_process("GeneralizedHyperbolicStretch")`; (b) a first-class **measurement-driven stretch helper**
   (`stretch_ghs` wrapping the native process, or the tested PixelMath builder with the analytic
   D-for-target-peak solve) so the stretch stops being hand-rolled each run.
9. **`get_background_neutrality`** ✅ **shipped 2026-07-24 (see #3)**, both modes (linear diffuse-sky
   band + poststretch near-neutral chroma). The safe `neutralize_background` ACTUATOR is still open., Run 3
   hand-rolled the **diffuse-sky-band** neutrality metric (grid `image.sample`, median ±8% of luminance
   median, the darkest-N% metric is WRONG on nebula-fillers: dark lanes = real OIII). And the
   `BackgroundNeutralization` *process* **blew up** (median ×100, R clipped to 1.0) with a narrow
   `backgroundHigh`, had to null the residual with a manual per-channel additive-offset PixelMath.
   → ship `get_background_neutrality` (diffuse-sky method) and a safe additive-offset neutralize.
10. **Headless community stretch scripts + a `star_stretch` helper** `[tooling, MED]`, ✅ **Star Stretch
    fully mapped (R5, source read at `.../src/scripts/star_stretch.js`):** Execute = (1) PixelMath MTF
    `(K*$T)/((K-1)*$T+1)`, `K=3^a` (default a=5); (2) `ColorSaturation HS=[[0,0.4],[0.5,0.7],[1,0.4]]*satAmount`;
    (3) optional SCNR-green. Dialog is modal → replay the ops (not `#include`). → **build a first-class
    `star_stretch(viewId, amount, satAmount)` tool** that bundles those three ops **plus** the star-PIXEL-median
    measurement and the 1:1-crop verify (R5 hand-rolled all three every time; two spec bugs, layer-median≈0
    and T=0.10-0.20, cost the whole run's star quality). EZ *Soft Stretch* still unproven-headless.
12. **SetiAstro Statistical Stretch, ✅ PROVEN DRIVABLE HEADLESS (R6 follow-up)** `[tooling, HIGH]`, user:
    "would be easier and had pretty much the same result" as the R6 GHS+curve iteration. **Confirmed by running
    the ACTUAL script code** (`.../src/scripts/statisticalstretch.js`, Marek v2.3), not a reimplementation.
    **How:** `File.readTextFile` it, take **lines 1..684** (the algorithm half, everything before the
    `ScrollControl`/`MyDialog` UI), drop `#`-directive lines (`#engine/#feature/#define` break V8 eval),
    prepend `var TITLE/VERSION/DEBUGGING_MODE_ON`, `(0,eval)(body)` to define its funcs globally, set
    `SHOParameters`, then call **`processColorImage(view, targetMedian, 1)`** (+ `applyFinalCurve` if
    `curvesBoost>0`), the exact sequence its Execute button (`executeAlgorithm`) runs. Its `main()` is a modal
    dialog (would freeze the watcher) and its headless `Parameters.isViewTarget` path doesn't trigger under
    `EvaluateScript`, so eval-the-functions is the route. **Result: one-shot, converges median to `targetMedian`
    exactly.** `targetMedian` **IS the background-brightness dial**: 0.25 → milky (= R5), 0.14 + `curvesBoost 0.15`
    → dark/punchy (≈ R6, faint nebula better preserved, its blackpoint is sigma-based/gentle vs R6's aggressive
    pinned curve). Knobs: `targetMedian`, `blackpointSigma` (higher=darker bg), `noBlackClip`, `curvesBoost`
    (contrast), `hdrCompress` (tame cores), `lumaOnly`/`lumaBlend`. → **adopt as the default nebula stretch
    engine** (collapses the stretch to ~1 dial + faint-survival verify) and **build a `statistical_stretch(viewId,
    targetMedian, {…})` helper**. Same eval-the-real-functions method works for any dialog-only SetiAstro script
    (also used for `star_stretch.js`). Shrinks, does not remove, the objective-function/faint-survival judgment.
11. **`snapshot`/`restore`** `[tooling, LOW, likely resolved]`, Run 3 saw it fail ("Snapshot not found",
    window missing). **Run 5 it worked reliably** (named `snapshotId`s created + restored, used to iterate the
    stretch and star layer). Either already fixed or the R3 failure was intermittent → downgraded; keep an eye
    out, no active fix needed unless it recurs.
13. **Background-work + visual-QA tooling** `[tooling, HIGH, Run 7]`, **(b) and (c) SHIPPED 2026-07-24:**
    `render_view(viewId, path, stf, rect?, downsample?)` (STF auto with degenerate-median clamp / asis /
    view; verified vs the approved final render) **plus** `render_critic_pack` + the blind `image-critic`
    skill + `docs/CRITIC_RUBRIC.md` + the `kb-gate` regression skill (see `docs/AUTONOMY.md`, critic
    calibration: blind A/B correctly ranked the approved R8 final over rho_combined on background chroma).
    (a) `background_neutralize` actuator and (d) SPCC curve auto-provisioning still open. Original: the whole background session was
    hand-rolled in `run_script` (curves fit, gated teal→luminance, ~10 render-downsample-and-Read cycles).
    → (a) **`background_neutralize(viewId, {signalHue, w, ...})`** wrapping the validated 2-stage recipe
    (`docs/background-work.md`); (b) **`render_view(viewId, factor)`** → returns a downsampled JPEG for
    visual QA (every judgment this session needed one; I built it inline each time); (c) **`get_background_neutrality`
    that reports background CHROMA of the near-neutral population** (not the ±8% sky-band spread, that metric
    LIES post-stretch) + faint/bright preservation ratio. (d) SPCC **broadband** OSC-duoband curve
    auto-provisioning from `library/filters.xspd` (the `Sony CMOS X-UVIRcut / <filter>` + IMX QE lookup), since
    NB mode is now off-limits.
14. **Session-replication artifact `[tooling, MED, Run 8, user-requested]`**, user wants to replay a full
    session precisely (a power outage lost the in-app state). A single `ProcessContainer` **can't** express the
    workflow: it branches at SXT (starless in place + stars in a new window, stretched separately, screen-recombined)
    and several steps need runtime data (SPFC/SPCC filter curves from `filters.xspd`, PixelMath expressions). The
    new **`get_full_history(viewId)`** tool reads the cumulative `ProcessContainer` per view (good for the linear
    trunk) but not the branch or the PJSR-driven steps. → build **`export_session(viewIds[])`** emitting a
    self-contained replay `.js` (each step's `ProcessInstance.toSource()` + the branch orchestration) + a
    ProcessContainer for the linear trunk. **CONFIRMED (R8): native process-icon minting is impossible headless**, `writeIcon`
    only overwrites an EXISTING GUI icon (errors "No such instance icon" otherwise), and there's no PJSR `.xpsm` file-save. So
    `export_session` must emit **paste-to-rebuild container source** (`ProcessContainer` + `.at(i).toSource()`), not a binary icon.
    Interim artifacts written: `result-tests/Rho-Ophiuchi-Panel-1/{replay.js (executable, handles the branch), process-container.js
    (all 17 instances + settings via toSource), HISTORY.md}`.
    **✅ SOLVED (2026-07-24, user-verified).** `.xpsm` is plain XML and I CAN write it directly (File.writeTextFile) → PI opens it
    → icons appear (no icon-mint API needed). Cracked the exact format from the user's `untitled.xpsm` (PI 1.9.4): a
    `<instance class="ProcessContainer" id="X_inst">` wrapping child `<instance class=... version="256" enabled="true">` blocks,
    PLUS a required `<icon id="Name" instance="X_inst" xpos ypos workspace="Workspace01"/>` element (the missing `<icon>` is
    exactly why my first attempt loaded nothing). Built a **toSource()→XML converter** (in `replay.js`): scalars/bools→`value`,
    enums `Class.NAME`→`value="NAME"`, strings→text content, arrays→`<table><tr><td id="x"/><td id="y"/>`. **Gotcha:** `toSource()`
    formats curve/HS point arrays MULTI-LINE → a line-by-line parser silently drops the tables; parse with a multiline regex
    (`/P\.(\w+)\s*=\s*([\s\S]*?);\s*(?=P\.\w+\s*=|$)/g`) + `eval` the array. **Delivered + user-verified loading:** per-section
    `linear/starless/stars/recombine.xpsm`. **replay.js is a proven empty→final reproducer** (2 clean-room `main()` runs → identical
    `[rho_final,starless,stars]`, median 0.169). Design settled: **per-section `.xpsm` containers** (narrow, per-image) + **one
    `replay.js`** (whole-session, empty→exact-final-state); **capture INCREMENTALLY as each process runs**, NOT from `view.processing`
    at the end (resets on save/reopen; `createNewImage` outputs carry empty history; crash-lossy). → build `export_session(outDir)` MCP
    tool wrapping this (emitter + replay generator). See `result-tests/Rho-Ophiuchi-Panel-1/replay.js` for the reference implementation.
    **MCP tool BUILT + VERIFIED END-TO-END (2026-07-24):** `export_container(viewId, outputPath, iconName, fromIndex?, toIndex?)`
   , TS tool `src/tools/export.ts` (registered in `index.ts`, `tsc` clean) + watcher handler `handleExportContainer` in
    `pjsr/pixinsight-mcp-watcher.js` (the proven converter, sourced from a `view.processing` slice; export per section by range
    while the view is LIVE). Activated by the module regen (`module:build` → `sign` → `install` as admin, PI closed, same loop
    as the `get_full_history` add) + MCP-server restart to register the tool. **Verified:** a tool call on a live view emitted a
    container **byte-identical (modulo icon name)** to the user-verified inline one, curve tables intact. `replay.js` (whole-session,
    empty→exact-final, proven 3×) stays hand-authored for now (branch orchestration is bespoke) → future `export_session` can template it.
15. **`star_color_correct(viewId)` helper `[tooling, LOW→MED, Run 8; metric corrected R9]`**, the gated star-color
    rule is hand-rolled. **R9 corrected the gate axis**: both branches key on green vs the R-B midpoint,
    `gex=G−(R+B)/2>0` → SCNR green; `gdef=(R+B)/2−G>0` → `invert→SCNR-green→invert`. The old "magenta"
    test (`R>G && B>G`) misses the common case and read 0.17% where the correct test read 74.2%. Bundle the
    measurement + the two conditional ops, and bake in the emission-line exclusion (broadband stars-layer only).
16. **Phase-aware measurement metrics `[tooling, HIGH, Run 9]`**, the star/gradient blocks emit confidently wrong
    numbers outside their valid phase and there is no signal that they are inapplicable:
    `starPixelMedian` **0.0175 vs a rendered 0.28-0.36 (~20×)** on a stars-only layer; `starCount 0` /
    `medianFWHM null` / `medianEccentricity null` on a recombined final; FWHM/ecc computed from a **6-star**
    sample of 21,705; gradient `cornerSpreadPctOfCenter` up to **475,589%** on a star layer. Two critics
    independently flagged these as unusable. → suppress/flag fields by phase, report the measured-star count
    alongside any FWHM/ecc, and weight the star sample by brightness.
17. **`render_view` must not honour `image.selectedChannel` `[tooling, HIGH, Run 9]`**, a lingering channel
    selection makes it emit a **silently MONOCHROME** file (one channel replicated to R=G=B) with a normal
    3-component container and **no warning**. It shipped the delivered JPEG. `save_image` is unaffected and
    `render_critic_pack` already resets internally, so **the blind critic saw correct colour while the
    deliverable was grey**. → reset (or ignore) channel selection inside `render_view`, and warn if it was set.
18. **Cheap INVARIANTS layer, separate from the aesthetic rubric `[tooling, HIGH, Run 9]`**, the mono JPEG passed
    the entire aesthetic critic rubric because the rubric judges taste, not integrity. Add target-independent
    booleans that hard-fail regardless of object: `max(R,G,B) != min(R,G,B)` somewhere (chroma exists), no
    shadow/highlight clipping wall, geometry as expected, no seam step across a known blend band. Invariants
    generalize across every target; aesthetic scores do not (see research Q below).
19. **`export_container` index alignment `[tooling, MED, Run 9]`**, its `fromIndex/toIndex` are offset by +1 from
    `get_full_history` display indices (its 0 = first step *after* the base container). Cost two wrong exports in
    one session: one silently included an ABANDONED stretch, the other silently DROPPED the star MTF PixelMath.
    → align the indexing with `get_full_history`, or make the returned process-name list the documented
    verification step. Related: a non-contiguous kept path cannot be expressed as a range at all (R9 had to
    rebuild the starless on a copy to get a clean container).
21. **kb-gate Tier-1 is mislabeled, and the real gate is missing `[tooling, HIGH, Run 9, user-raised]`.**
    Tier-1 replays `replay.js`, a **hardcoded list of process instances that never reads the skill or the
    playbook**. So a KB batch consisting of prose edits produces byte-identical pixels and Tier-1 passes
    **regardless of whether the edits are right or wrong**. The kb-gate skill already admits this ("a playbook
    change that alters processing DECISIONS can pass Tier-1 trivially"), yet process-retro still requires a
    Tier-1 PASS to auto-commit KB edits, which is a ~20 min ritual that tests nothing about the batch.
    → **(a) Rename/reclassify Tier-1 as what it actually is, an ENVIRONMENT / reproducibility regression test.**
    Its real value (catching a PI/BXT/NXT/SXT version bump changing pixels, or a corrupted baseline) is genuine
    but unrelated to KB edits. Correct triggers: after a tool/PI upgrade, periodically, or before re-baselining,
    **not** per KB batch.
    → **(b) Build a CHEAP Tier-2**, the only tier that can actually see a decision change, since a fresh
    `process-master` run is the only thing that reads the KB. Proposal: run the fresh run on a **crop of the
    reference master** (e.g. 1500x1500 around the object) instead of full resolution, which cuts the BXT/NXT/SXT
    cost by ~15x while still exercising every decision, gate, and measurement path. Band tolerances, not tight
    relative ones (fresh runs are non-deterministic).
    → **(c) Until (b) exists, say so honestly** rather than running Tier-1 as a proxy: a decision-altering KB
    edit needs explicit human review, and should be labelled as such in the retro report.
20. **Critic-pack coverage gaps `[tooling, LOW, Run 9]`**, no 1:1 crop on the brightest star (the canonical site
    for recombine halos/seams, both R9 critics had to improvise one from a 5× downsample); `stars.png` defaults
    to a subset of `corner-tl` so it adds no independent sampling; starless packs have no recombine preview,
    which caused 2 of 3 false artifact findings; pack PNGs are effectively uncompressed (~5× oversized).

---

## Open research questions (feed the playbook, do NOT guess settings)

**RESOLVED 2026-07-21** by deep-research run `wf_9cb980de` (108 agents, 20 verified claims) →
playbook `osc-hoo.md` steps 10-12 rewritten. Summary of what landed:
- **Stretch** ✅, root cause = wrong tool (HT). Switch to **GHS**, params measurement-derived (SP
  via 15×15/mean readout + "Send to SP" at/just-left of peak; b 5-10 then 2-6/neg; D→peak 0.2-0.25);
  **iterative**, black point a **separate linear step**. [High, primary: GHS authors, RC-Astro-tier.]
- **Neutrality** ✅, equal medians ≠ neutral; it's a **linear pre-stretch BackgroundNeutralization**
  on a pure-background *sample* (aggregate previews on nebula-fillers), verified under a linked STF.
  Never fix a cast post-stretch. [High, primary: SPCC docs.]
- **Stars** ✅, documented SXT trap: **don't STF-auto the stars image**; stretch with a real
  transfer matching the nebula (GHS / the SXT-carried STF), screen-recombine. [High, primary: RC-Astro.]
- **SCNR** ✅ (mostly), not a default 100% step; fix neutrality linearly, use reduced measured SCNR
  only if green truly remains. *Refuted:* SCNR-after-stretch, per-channel magenta-star PixelMath.

**STILL OPEN (need another research pass):**
- **Dim stretch, DIAGNOSED, not open `[correctness, R1-R4]`.** The agent **over-black-points**: it
  reaches the playbook's peak target (0.15-0.17) then crushes it back to ~0.09 chasing a "clean dark
  background," twice, ending at **less than half the researched 0.20-0.25 target**. Fix (applied to skill +
  playbook): the black point is a **gentle true-black set**, not a background crush; **hard gate, final
  peak must be ≥ ~0.18 (target 0.20-0.25) or undo the black point and redo it gently.** Reach the target
  with more D / another gentle pass, not by over-lifting and crushing. Not a numbers-research gap, an
  execution rule against the existing target. (Research may still refine the exact black-point discipline.)
- **Milky / low-contrast stretch despite an in-target peak, NEW, OPEN `[quality, R5]`.** R5 used **no**
  black point and hit peak **0.245** (squarely in 0.20-0.25), yet the user still read it "okayish / dim-milky."
  So over-black-pointing is not the only dim mode: on this faint wide-field target the tonal distribution came
  out **extremely compressed** (after high-`b` pass-1, p01→peak spanned only ~0.045 → the whole background/
  faint-nebula bulk sits in a narrow bright band = milky, low local contrast). A **lower-`b` restretch (b≈3)
  was WORSE** (more compressed, brighter). Hitting the peak target is necessary but **not sufficient** -
  contrast / tonal-spread is a separate axis the current GHS recipe doesn't control. A saturation + gentle
  contrast-curve pass helped in R5 but is unresearched. **Research needed:** how to get tonal separation
  (not just peak position) on faint nebula-filling wide-field, GHS `b`/`SP`/multi-pass strategy, or a
  post-stretch local-contrast/curve step. Is the fixed peak-0.20-0.25 target even right for this data class?
  **Do NOT hardcode curve points from R5.**
  - **R6 UPDATE, reframed as an OBJECTIVE-FUNCTION + SELF-EVAL-QUALITY problem, not a stretch-recipe hunt.**
    R6 *did* find a mechanism that kills the milkiness (SP above the bg peak so bg compresses dark, + a curve
    pinned at the bg rising above it to lift the object without lifting the bg). But it **overshot into the
    opposite failure:** user "nebulosity too dim; **fainter nebulosity vanished with the background**" + "saturation
    way too much." So R5 and R6 **bracket a target BAND**, and the real gap is that the agent **can't yet
    self-judge where inside the band it is.** The self-critique loop (render → judge → iterate) *ran and
    converged*, the mechanism works, but the **judgment was wrong** on: (a) faint-outer-nebula survival
    ("no clipping" ≠ preserved, R6 mins>0 yet faint gone), (b) saturation restraint, (c) not trading object
    brightness for a dark bg. **This is the per-object OBJECTIVE FUNCTION from the autonomy plan** (memory
    `stretch-is-per-object-not-researchable`): define measurable "what good means" checks the agent scores its
    own render against, object-to-bg contrast, faint-structure-above-bg presence, saturation ceiling, object not
    dim. Method guardrails (faint-survival check, saturation restraint) applied now to skill+playbook; the
    quantified objective is the open work. **Tooling angle:** SetiAstro Statistical Stretch (backlog #12) may
    make the stretch itself one-shot, shrinking the surface the objective function must police.
- ~~**Star stretch method**~~ ✅ **RESOLVED (Run-4 deep research, primary sources).** GHS/arcsinh on a
  star layer produce an inherent wash ("small elliptical galaxies", RC-Astro, SXT author); no `b` fixes
  it. **Correct = a single MTF/midtones curve:** plain `HistogramTransformation`, or headless PixelMath
  `(K*$T)/((K-1)*$T+1)`, `K=3^a`, which IS SetiAstro Star Stretch (Marek, MIT). Amount by measurement:
  `a=ln(T(1-M)/(M(1-T)))/ln3` (M=measured linear star median, T~0.10-0.20, tunable). SetiAstro's PJSR is
  dialog-only → reproduce in PixelMath. → baked into `osc-hoo.md` step 12 + skill. **Retracts Run-3's
  "GHS pass-1 much better."** **R5 CORRECTED two bugs in this R4 spec:** (a) "measured linear star median" is
  ≈0 (layer is 99.9% black) → measure the **star-PIXEL median** (`>~0.005`); (b) **T~0.10-0.20 was too low**
  (buried stars under the ~0.24 nebula screen → "barely-there" *again*) → **T≈0.35-0.45** (R5 `a≈4.5`,
  user-approved); (c) the SetiAstro Execute also runs a **`ColorSaturation`** pass (not optional), omitting it
  gave flat stars; (d) **verify at 1:1**, global stats hid the failure. All baked into step 12 + skill.
  (Still minor-open: exact `T`/`satAmount` to taste; duoband star *color* unchanged.)
- **HOO gold/teal (Foraxx) in-place recipe**, no verified single-RGB OSC recipe; the dynamic
  PixelMath found is a channel-split method. Preference, unresolved. (Run 3 deferred color; user OK.)
- **Natural duoband star color**, the magenta-fix was refuted; no positive method survived. Rebuild
  from broadband vs in-place hue, unresolved.
- **SetiAstro Statistical Stretch / Star Stretch, EZ Soft Stretch**, never characterized head-to-head
  vs GHS; GHS won by default. User wants them available as quick engines (see tooling backlog #10).
- **SPCC blue clipping**, background neutralization clipped blue min to 0; acceptable or defer? (Now
  lower priority given the linear-BN reframe.)
- **SPCC narrowband deadlock, root cause `[correctness/tooling, R7, OPEN]`.** NB mode hard-froze PI 3× this
  session but worked R1-R6. PI version bump? A specific data/state trigger? Broadband is the working path
  regardless, but the discrepancy is unexplained, investigate before trusting NB again.
- **Background-method generalization `[quality, R7, OPEN]`.** The 2-stage recipe (`docs/background-work.md`) is
  validated for **Hα-dominant HOO** (protect red / gate `rex<0`). The per-target signal-hue re-keying for
  **OIII-rich HOO, SHO, and RGB** is designed but **untested**, needs a live demo on each palette to confirm the
  hue axis and dose transfer. Do NOT assume it transfers unverified.
- **MOSAIC playbook** ✅ **WRITTEN 2026-07-25 → `docs/workflows/mosaic.md`.** Originally queued here as
  "needs a research pass", which **over-scoped it**: the research had already been done at the start of R9
  (6 web searches + the GradientMergeMosaic primary doc read in full locally + `MosaicByCoordinates`/
  `StarAlignment` source inspection) and then validated end-to-end. The real gap was **capture**, not knowledge.
  → **Lesson `[method]`: when a run does mid-run research, the retro's job is to CAPTURE it, not re-queue it.**
  **Structure decision (user-driven):** mosaic is a **cross-cutting STAGE playbook, not an acquisition
  category** (6 categories x mosaic = 12 near-duplicate files). It is a **second combination point** (channel
  combination vs **panel** combination) and the existing pre/post-combine governing rule generalises to it
  almost verbatim. Only the *ordering of the two combination points* is category-dependent.
  A browser pass (per README step 8) recovered the previously-403'd `chaoticnebula` workflow, which added the
  **3+ panel route** (`ImageSolver` on the centre panel → `CatalogStarGenerator` synthetic star field →
  `StarAlignment` all panels to it, instead of pairwise chaining). `lightvortexastronomy.com` is **down at
  origin** (Cloudflare DNS failure), genuinely unavailable rather than tool-blocked.
  ⚠️ **`[method]` finding against myself:** the browser fallback is documented as automatic in
  `docs/workflows/README.md` step 8, and I did NOT use it during the run, I hit 403/SSL on two load-bearing
  pages and moved on. Escalate to the browser in-run, not at retro.
  **Still open, now narrow** (carried into `mosaic.md`'s Contested list, not a research programme):
  (1) per-panel gradient+colour then stitch, vs stitch-then-correct (R9: per-panel, since gradients differ);
  (2) **when to use GradientMergeMosaic at all** - R9 REJECTED it (it manufactured red/teal blobs at bright stars
  near panel edges, and its `nShrinkCount` caps at 10 px so the offending stars cannot be excluded). The decisive
  measurement was that panel-vs-panel agreement in the overlap was **median 2e-6, spread ±5e-5, i.e. at the MRS
  noise level**, so StarAlignment's frame adaptation had already matched the panels and GMM's Poisson solve had
  nothing to correct. **Candidate rule: measure overlap agreement FIRST; if it is at noise level, prefer a plain
  feather blend.** Needs confirming on panels that genuinely DON'T match;
  (3) per-panel vs mosaic-level SPCC (R9 per-panel; WB factors came out near-identical, 0.7536/0.6738 vs
  0.7524/0.6612, which is itself evidence the panels were consistent);
  (4) BXT correct-only before assembly + sharpen after (RC-Astro-sourced, held up in R9);
  (5) how much overlap is enough (R9 had 808 px ≈ 20%).
- **SXT `overlap` on dense clusters / globulars `[quality, R9, OPEN, do NOT change the default on this]`.**
  3-way A/B on an M4 crop: SXT `overlap` 0.20 left the core at **3.11×** local background, `overlap` 0.50 at
  **1.58×** (absolute speckle σ also halved, 2.4e-4 → 1.1e-4), **StarNet2 at 11.75× with speckle ≈ the
  unprocessed input** (it barely removed the cluster). Cost of 0.5: nebulosity 0.6-2.6% darker. **BUT the user,
  looking at the render, was NOT convinced**: with the core glow gone the remaining leftovers read "a tad more
  noisy" (see the metric finding in R9, absolute speckle vs speckle-over-local-background). So: overlap 0.5 is a
  promising lead for cluster fields, **not** a validated default. Research needs a normalised residual metric and
  more than one cluster. StarNet2 is not the answer for this failure mode.
- **Do aesthetic critic scores generalize across targets at all? `[method/quality, R9, OPEN]`** R9 scored ~2.5/4
  on gate verdicts, and every wrong call came from the critic being blind to the **subject** (dust-filled field,
  no empty sky, two globulars, an emission arc) rather than to the process. Blind-to-process is the design goal;
  blind-to-sky is an accident. **Proposal to evaluate: give the critic a factual "target card"** (acquisition
  category, field size, dominant structure, known objects) which leaks no parameter choices. Also evaluate
  splitting the gate into **invariants (absolute, target-independent, hard-fail, backlog #18)** vs **aesthetics
  (ranked A/B only, never absolute scores)** - the A/B mode is the one that has been reliable.
  ⚠️ Touches `docs/CRITIC_RUBRIC.md` and the blindness contract, both **human-owned**: proposal only.
- **`docs/CRITIC_RUBRIC.md` gaps surfaced by R9 `[method, R9, QUEUED, human-owned, do NOT self-edit]`.** Both
  R9 critics independently reported the same structural holes: (a) **no stars-only branch** - axis 2's neutral-gray
  objective and its 0.05 chroma reference are meaningless on a star layer whose correct background is black
  (`bgChroma` read 0.788); (b) **no representation for a non-applicable axis** - a starless layer cannot score
  "stars", and emitting a placeholder 3 would silently trip the two-axes-at-3 revise rule (one critic emitted
  `null`); (c) **axis 1 contradicts its own anchor** - the stated band is 0.20-0.25 but the calibration anchor
  records the user-APPROVED R8 reference at 0.138, and R9 landed between them at 0.183; (d) the **0.4
  star-pixel-median target** is applied at phases where it compares to nothing; (e) **no guidance for a
  nebula-filling frame with no empty-sky corner**, which is exactly where the background axis misfires.
- **Why does a green bias SURVIVE colour calibration? `[quality, R9, OPEN, user-raised]`** R9 measured
  **80.9% of pixels above the R-B midpoint** (mean excess 0.046) on an SPCC-calibrated image. SCNR-neutral is
  the right corrective (see below) but the magnitude says something upstream is leaning green. Candidate causes,
  **all physical, none yet isolated**: (a) **airglow is dominated by the OI 557.7 nm green line** and mercury LP
  has a strong **546.1 nm** line, both landing in a green channel, and photometric calibration fixes *stellar*
  colour, not an additive green-weighted **sky pedestal**; (b) on a nebula-filling field, background
  neutralization has **no true blank sample** to key on (R9's blank patches even flipped R-B sign across the
  frame); (c) **OSC-specific: RGGB has 2x green photosites**, so green is debayer-interpolated differently.
  ⚠️ **(a) and (b) apply to MONO too** (the G filter collects the same airglow/LP; haze and moonlight scatter
  broadly), so this is not an OSC-only question. Research: separate the additive-pedestal term from the
  debayer term (compare an OSC master against a mono G master of similar sky), and test whether a better
  background-reference strategy removes most of it before SCNR is reached.
  **⚠️ Do NOT read this as "stop using SCNR"**, see the settled finding below.
- ✅ **SETTLED (R9, measured on-image, user-driven): SCNR protection method matters far more than amount.**
  The widely-repeated forum claim that the *scaling* (mask) methods are safer than the *clipping* (neutral)
  ones is **refuted on our data, and reversed.** Neutral (`G' = Min(G, 0.5(R+B))`) is **self-gating**, a
  mathematical no-op wherever green is already at/below the midpoint: R9's Hα arc (4.6°) and blue sky (240.9°)
  came out **byte-identical** while the dust corrected 60.8°→45.5°. Mask (`G' = G×[1−a(1−m)]`) scales green
  down **unconditionally everywhere**: `MaximumMask@0.5` sent the same Hα arc to **335.2°** and the blue sky to
  **280.1°**, turning the whole region magenta on the render, exactly the magenta-sky-cast drawback the
  PixInsight doc itself warns about. → **always AverageNeutral/MaximumNeutral, never the mask methods** on a
  field with real colour diversity. Also settled: placement (linear vs post-stretch) is a **minor** axis,
  post-stretch is ~3° more aggressive (Jensen: for a concave stretch the midpoint computed after stretching is
  lower) and both are identical no-ops where green is legitimately low. Baked into `osc-rgb.md` step 10 + skill.
  ⚠️ Legacy-doc trap: the 2010 PixInsight LE page says "the Amount parameter is not used for neutral
  protection", **modern PixInsight DOES honour it** (amount 0.5 left G above the midpoint, i.e. partial).

---

## Run log

### Run 1, 2026-07-20, OSC-HOO, NGC 7000 / Pelican (FMA180 Pro, Antlia ALP-T 5 nm, IMX571)
**Outcome:** complete run (open → `HOO_final`), **poor result**. Linear half solid; stretch/color
poor. Heavy user intervention (undos, timeouts, aesthetic questions). Not saved to disk.

**Findings**
- `[correctness]` Reported the image unsolved, called `window.astrometricSolution()` (not a
  function); the try/catch swallowed the TypeError. Correct check: `window.hasAstrometricSolution`.
- `[correctness]` Assumed BXT strips the WCS; BXT correct-only **preserved** it here. Don't assume -
  verify.
- `[correctness]` Concluded MARS DB "not installed" from failed probes (undefined `DataType_String`
  in the bare context, guessed paths). It was configured. → assume configured; on error, report.
- `[tooling]` Long-process timeouts (SPFC/SPCC/MGC), see backlog #1. Multiple false "failed".
- `[tooling]` No script undo, see backlog #2. Every revert was manual.
- `[method]` Used stdDev / box-stdDev to judge denoising → false "NXT added noise" alarm; MRS noise
  showed it was fine all along. → gauge denoising with MRS.
- `[tooling]` MGC no-op'd with empty `marsDatabaseFiles`; needed `[[true, "<.xmars path>"]]` table
  row passed explicitly (GUI config didn't transfer). SPFC needed Sony IMX571 curves supplied.
- `[quality]` **Stretch worse than STF autostretch**, dim, pink background, the run's main failure.
- `[quality]` Stars too soft; wanted much more aggressive.
- `[quality]` SCNR at 100% questionable; background went pink/magenta after color shaping.

**Changed this entry:** WCS-detection + BXT-WCS + MARS-assume-configured fixed in `process-master`;
operational gotchas (long-process verify-by-metadata, no-undo, MRS-for-noise, MGC/SPFC param
formats) added to the skill's traps; backlog + research questions above seeded.

**Still open:** everything under Tooling backlog and Open research questions. The stretch rework is
the highest-value next quality task; robust long-process handling + undo are the highest-value tool
tasks.

### Run 2, 2026-07-21, OSC-HOO, NGC 7000 / Pelican (FMA180 Pro, IMX571 / ATR3CMOS26000KPA, duoband filter unspecified)
**Outcome:** complete run, **saved** (`NAN_Pelican_HOO_finished.xisf/.png`). Linear half clean and
artifact-verified; **nonlinear half (stretch + stars + color) still poor** per the user at the
machine. Long-process corruption fix **held**, SPFC/MGC/SPCC all returned cleanly, no phantom
timeouts, no `MalformedResult`.

**Linear half, worked, verified by artifact:** BXT correct-only (WCS preserved), SPFC (wrote
`PCL:SPFC:ScaleFactors`), MGC+MARS (corner spread −88/−91/−91%), SPCC-NB (R≈G≈B), NXT (MRS noise
−83/−84/−84%), SXT split, screen recombine.

**Findings**
- `[quality]` **Stretch still AWFUL** (user). Agent bg=0.10 "extremely dim"; STF-matched bg=0.25
  "still pretty ass"; user's own SetiAstro Statistical Stretch → still poor. 2 runs, 2 failed
  stretches; likely upstream of the transfer curve. → escalated research Q.
- `[correctness]` Applied **SCNR green Average Neutral 1.0 despite the playbook decision rule** (green
  0.250 was NOT ≥ red 0.247 / blue 0.252 → not warranted). Turned **black areas blue** (R1: pink).
  SCNR-100% has cast the background in **2/2** runs. → guardrail added: honor the measured gate,
  don't default to 100%.
- `[quality]` **Overall color bad, background not neutral** (user) despite ~equal medians
  (R0.250/G0.247/B0.259). Equal-median "neutral" check missed a visible cast. → `[method]` neutrality
  metric insufficient; color-shaping is a research gap.
- `[quality]`/`[tooling]` **Star stretch too soft AGAIN**, "barely any stars." Guessed manual
  midtones `m=0.10` (unmeasured) because STF-auto blows out a star field. Run 1 constraint repeats.
- `[correctness]` Used **deprecated `getEnvironmentVariable()`** (PixInsight warns → `System.
  getEnvironmentVariable()`) in the MARS-path probe. Ours; harmless.
- `[correctness]` `view.properties` is an array of **property-id strings**, not `[id,type]` tuples -
  two misread probes before indexing the strings directly.
- `[tooling]` **SXT orphan window:** `undo` on the starless restores stars but leaves the spawned
  `*_stars` window open (user-confirmed).
- `[tooling]` **SPFC curve provisioning clunky**, materialized IMX571/Astronomik CSVs to a file to
  enable MGC.

**Changed this entry:** guardrails added to `process-master` (SCNR-not-by-default + honor the gate;
`System.getEnvironmentVariable`; `view.properties` format; SXT orphan-window note). Pipeline-state
table updated (Stretch/Star-stretch/Color all ❌ with 2-run evidence). Backlog #3 sharpened
(STF-auto star-field caveat + measured star-stretch); added backlog #6 (SPFC curve provisioning) and
#7 (SXT window cleanup). Research questions escalated (stretch, stars, SCNR/color, neutrality metric).

**Still open:** the entire **nonlinear half**. Highest-value next task: **research-driven rework of
OSC-HOO stretch → star-stretch → SCNR/color (playbook steps 10-12)**, with the user's Run-2
constraints recorded as research inputs, not guessed defaults.

### Run 3, 2026-07-21, OSC-HOO, NGC 7000 / Pelican (FMA180 Pro, ATR3CMOS26000KPA / IMX571, duoband)
**Outcome:** first run of the **rewritten steps 10-12**. Started from the linear-done state (starless +
stars already split). Complete, **saved** (`NAN_HOO_final.xisf/.jpg`). User verdict: **"pretty decent
overall, but should still be improved"**, a clear step up from R1/R2's failed nonlinear half. Neutrality
and star stretch validated; stretch better-but-dim; combine had star artifacts.

**Findings**
- `[correctness]` **Concluded "GHS not installed" and fell back to a PixelMath port**, but
  `GeneralizedHyperbolicStretch-pxm.dll` (signed) IS in `bin/`. `new GeneralizedHyperbolicStretch`
  was `undefined` because the module was installed after PI launched (user confirmed "recently
  installed") → needs a **restart** to register. The `ghs-stretch.md` reference's "NOT installed" claim
  was stale. → fixed skill/playbook/reference to use native GHS; backlog #8.
- `[method]` **Neutrality metric, darkest-N% is WRONG on nebula-fillers.** First measurement flagged a
  fake 8.6% "cast" that was really dark-nebula (Gulf of Mexico) Hα-absence = correct OIII-teal. Correct
  metric = **diffuse-sky band** (median ±8% of luminance median); the true sky was neutral to 0.12-0.7%
  and stayed neutral through the whole stretch. → baked into skill + playbook.
- `[tooling]` **`BackgroundNeutralization` process blew up** (median ×100, R clipped to 1.0) with a
  narrow `backgroundHigh`; undone. Nulled the residual with a manual per-channel additive-offset
  PixelMath instead. → backlog #9.
- `[quality]` **Stretch better than R1/R2 but still slightly dim** (user). Partly the PixelMath GHS
  fallback (harder to tune). → open research constraint; retry native GHS first.
- `[quality]` ✅ **Star stretch "much better"** (user). Method that worked: nebula GHS pass-1 only + one
  minimal star-tuned black point (~0.0005); do NOT apply the nebula black points to stars (that was the
  R1/R2 "barely-there" cause). → promoted to playbook as validated.
- `[quality]` **Combine produced star artifacts.** Used screen `~(~starless*~stars)`; user's house
  formula `starless*~stars+stars` is algebraically identical, so the artifacts are in the **star layer**
  (SXT residual/halos), not the formula. → playbook updated to the house formula + investigate star layer.
- `[correctness]` ✅ **SCNR correctly skipped**, decision rule measured (nebula 0.1% green-dominant) →
  did not fire → no SCNR → no cast this run (first run without a background cast). Rule works.
- `[tooling]` **`snapshot`/`restore` unreliable**, snapshot window vanished, `restore` "not found";
  `undo`/`get_history` worked. → backlog #11.

**Changed this entry:** `process-master` skill (native-GHS, diffuse-sky neutrality + BN-blowup, validated
star method, house recombine formula, snapshot caveat); `osc-hoo.md` steps 10 + 12 rewritten with the
above; `ghs-stretch.md` "NOT installed" corrected. Pipeline-state table → Run 3 (neutrality + star stretch
✅; stretch/combine ⚠️). Backlog #8-11 added. Research questions: added dim-stretch + star-artifact
constraints.

**Still open, highest value next:** switch the stretch to the **native GHS process** (restart PI) and
re-tune to kill the residual dimness; then a cleaner **star layer** to remove combine artifacts. Color
(gold/teal, star color) remains deferred per the user.

### Run 4, 2026-07-21, OSC-HOO, NGC 7000 / Pelican (FMA180 Pro, ATR3CMOS26000KPA / IMX571, Antlia ALP-T 5nm)
**Outcome:** first **fully autonomous** start-to-finish run (user: "do not prompt me"). Full linear+
nonlinear pipeline, **native GHS** for the first time. Complete, **saved** (`NAP_HOO_final.xisf/.jpg`).
User verdict: nebula stretch **better but still slightly dim**; **star stretch bad** (regressed vs R3's
claim). Linear half + neutrality clean; no phantom timeouts, no gate failures.

**Linear half, worked, verified by artifact:** BXT correct-only (WCS preserved), SPFC (Sony Color
Sensor curves + Ideal QE → `PCL:SPFC:ScaleFactors`), MGC+MARS DR2 (R corner spread −69%), SPCC-NB
(5/5/5, WhiteBalanceFactors), BXT sharpen (0.75/0.25), NXT 0.85 (MRS noise −84%), SXT split (unscreen),
linear diffuse-sky-band null (spread 0.84%→0.0016%). SCNR correctly skipped (0.07% green-dom).

**Findings**
- `[quality]` **Stretch still slightly dim (user)**, but this run was **native GHS**, not the PixelMath
  fallback, so the dimness is **the target, not the tool.** Landed bg peak ~0.09 after 2 black points.
  → research constraint sharpened: aim bg ~0.11-0.13 / gentler final black point. (2 runs now: R3+R4.)
- `[quality]`+`[correctness]` **Star stretch WASHED the stars**, GHS pass-1 + minimal black point gives a
  tiny saturated core + broad washed/pixelated surround (user compared to their own plain-HT result).
  **Overturns Run-3's "much better"** (single datapoint). Mechanism: high-`b` GHS concentrates contrast at
  the near-black SP → over-lifts faint stellar wings into a halo. → playbook step 12 + skill + pipeline
  table changed to **plain `HistogramTransformation`** (user-validated, M1-good-enough), midtones measured.
- `[correctness/method]` **Run-3's "combine artifacts" were mis-diagnosed**, they are this GHS star-wash,
  NOT SXT extraction residual. Recombine formula (`starless*~stars+stars`) is fine; the fix is a natural
  star layer. → corrected in journal, playbook, skill.
- ✅ **Native GHS confirmed working** (PI restarted since R3). Param map recorded (skill + memory).
- ✅ **Autonomous run held together**, measure→configure→verify gates passed unattended through 12 steps.

**Changed this entry:** `process-master` skill (star-stretch → plain HT + overturn note; native-GHS
confirmed + dim-is-target constraint); `osc-hoo.md` steps 10 + 12 (native GHS confirmed + dim constraint;
star-stretch overturn → plain HT + artifact reframe); pipeline-state table (Stretch/Star-stretch/Recombine
rows + one-line read); research questions (dim-stretch confirmed-native, star-stretch-method new/overturn).
Memory `pixinsight-mcp-run-gotchas` corrected (GHS is native; R4 recipe).

**Post-retro (same day): star-stretch research DONE** (primary sources) → resolved to a single MTF /
SetiAstro-formula PixelMath with a measured amount; unscreen-on-linear + dim=over-black-point also fixed
in docs. See the resolved research question above. **Highest value next: a live RUN of the corrected
steps**, MTF star stretch + peak-to-0.25 gentle-black-point nebula stretch, to validate on-image (and,
if adopted, with a visual-QA crop checkpoint). Color (gold/teal, duoband star color) stays deferred.

### Run 5, 2026-07-21, OSC-HOO, North America + Pelican (FMA180 Pro, ATR3CMOS26000KPA / IMX571, Antlia ALP-T 5nm)
**Outcome:** autonomous start-to-finish run of the corrected steps, **saved** (`NAN_Pelican_HOO_2026-07-21.xisf/png`).
User verdict: stretch "okay," saturation/color "okayish," **star stretch "still awful"** on the first pass -
then, after the fix below, **user-approved**. This run finally nailed the star stretch and localized the
remaining weakness to stretch *tone/contrast*, not the star layer.

**Linear half, worked, verified by artifact (again):** BXT correct-only (WCS preserved), SPFC (broadband,
Sony curves + Ideal QE → `PCL:SPFC:ScaleFactors`), MGC+MARS DR2 (corner spread −90/−93%), SPCC-NB 5/5/5
(R≈G≈B, `WhiteBalanceFactors`), BXT sharpen 0.75/0.25, NXT 0.85 (MRS noise −83/−84%), SXT `unscreen=false`
split. Diffuse-sky-band null 0.78%→0.0005%. `snapshot`/`restore` used to iterate cheaply, **worked reliably**.

**Findings**
- `[quality]`+`[method]` **Star stretch "barely-there" AGAIN (R1-R5), root cause finally isolated: the R4
  spec had two bugs, not the tool.** (1) "measure the linear star-layer *median* M" is **degenerate**, the
  star layer is ~99.9% black so median≈0 and `a` blows up; must measure the **star-PIXEL median** (samples
  `>~0.005`; here M≈0.01). (2) **T~0.10-0.20 was too low**, screened onto the ~0.24 nebula, faint stars add
  nothing → invisible. Fix: **T≈0.35-0.45** (R5 landed `a≈4.5`, K≈140), user-approved. → step 12 + skill corrected.
- `[method]` **Global star-layer stats HID the failure** (median≈0 tells you nothing). Only a **true 1:1 crop
  render** (Crop mode=1, negative margins, centered on a grid-scanned bright star) revealed the barely-there
  stars. → 1:1-verify requirement added to step 12 + skill. Should have looked the first time.
- `[correctness]`+`[tooling]` **SetiAstro Star Stretch IS installed** (`.../src/scripts/star_stretch.js`,
  Marek v2.6), my earlier "not installed" was a bad search (file is `star_stretch.js`, no "seti" in name).
  Read the source: Execute = PixelMath MTF **+ `ColorSaturation HS=[[0,0.4],[0.5,0.7],[1,0.4]]*satAmount`**
  (+ optional SCNR-green, default off). **The ColorSaturation pass was the piece my bare-MTF reproduction
  omitted**, that, not PixelMath-vs-script, was the real difference. Dialog is modal → replay its ops in
  `run_script` (drove it faithfully at a=4.5, satAmount=1). → step 12 rewritten (color step is mandatory,
  not "optional extra"); backlog #10 → build a `star_stretch` helper bundling the 3 ops + measurement + verify.
- `[correctness/behavior]` **Tool-choice was a red herring**, PixelMath MTF ≡ HT midtones ≡ SetiAstro transfer.
  I initially *defended* the math-equivalent PixelMath when the user said the result looked bad; wrong instinct.
  When the user names a tool and the output is bad, look at the output, don't argue equivalence. → noted in step 12 + skill.
- `[quality]` **Stretch still "dim-milky" though peak=0.245 (in target) with NO black point.** A *distinct*
  failure mode from R1-R4 over-black-pointing: tonal **compression** (p01→peak ~0.045). Lower-`b` restretch
  was worse. Sat curve `S=[[0,0],[0.4,0.56],[0.75,0.86],[1,1]]` + contrast `K=[[0,0],[0.2,0.175],[0.45,0.55],
  [0.78,0.88],[1,1]]` helped but are unresearched. → new OPEN research question (contrast/tonal-spread axis;
  is peak-0.20-0.25 the right target for faint wide-field?). Did NOT hardcode the curves.
- `[quality]` **Color still Ha-dominant, no OIII teal** (open gap). Data *has* real OIII (faint diffuse
  regions measured G≈B≥R) but Ha dominates the bright structure. **SCNR correctly skipped** (measured green
  never > both R and B), the gate works, 3rd run running clean.
- `[tooling]` **`snapshot`/`restore` worked reliably** (contradicts R3) → backlog #11 downgraded.
- `[correctness]` Minor watcher/API: `UndoFlag_*` and `ColorSaturation.AkimaSubsplines` are `undefined` in the
  bare context (use numeric `HSt=2`, no-arg `beginProcess()`); MCP params are `open_image.filePath`,
  `run_script.code`, `save_image.overwrite`. → added to skill's API notes.

**Changed this entry:** `osc-hoo.md` step 12 (star: star-pixel-median measurement, T≈0.35-0.45, mandatory
ColorSaturation with exact HS, replay-not-#include, 1:1 verify; tool-choice red herring) + step 10 (R5
milky-compression second-mode note); `process-master` skill (same star-stretch corrections + 1:1 verify +
tool red herring; snapshot caveat → "worked in R5"; API notes: undefined constants + MCP param names);
pipeline-state table (Stretch + Star-stretch rows + one-line read); backlog #10 (star_stretch helper spec)
and #11 (snapshot downgraded); research questions (star-stretch R4-spec bugs corrected; new milky-compression
open Q). Memory `star-stretch-amount-and-verify` added.

**Still open, highest value next:** the **stretch tonal-contrast** problem (milky despite in-target peak) is
now the single weakest link, needs a research pass on getting tonal separation on faint nebula-filling
wide-field (GHS multi-pass/`b`/`SP` strategy or a post-stretch local-contrast step). Then the deferred **HOO
gold/teal color** and **duoband star color**. Tooling: a first-class `star_stretch` helper (backlog #10) so
the now-known 3-op recipe + measurement + 1:1 verify stop being hand-rolled every run.

### Run 6, 2026-07-21, OSC-HOO, North America + Pelican (FMA180 Pro, ATR3CMOS26000KPA / IMX571, Antlia ALP-T 5nm)
**Outcome:** first deliberate **"walk toward autonomy"** attempt on the aesthetic half, continued from
user-supplied linear starless+stars, drove the **whole nonlinear half autonomously with a self-critique loop**
(render → judge vs explicit criteria → iterate), saved (`NAN_Pelican_HOO_2026-07-21_v2.xisf/png`), user graded.
Verdict: **better than R5 but still not good.** The loop converged; the agent's visual JUDGMENT was wrong on
the axes the user caught. Linear half was user-supplied (not re-run).

**What worked (held from prior runs):** neutrality null (0.78%→~0), SCNR correctly skipped (green never > both
R,B, 4th clean run), star-stretch METHOD (star-pixel median + T-based amount + ColorSaturation + **1:1 verify**
→ tight/round/populated stars), snapshot/restore. The R6 stretch mechanism that killed R5's milkiness:
**SP just ABOVE the bg peak** (bg compresses dark) **+ a `CurvesTransformation` pinned at the bg rising above
it**, decouples bg-darkness from object-lift (peak held 0.125 while nebula max 0.42→0.61).

**Findings**
- `[quality]` **Nebulosity too dim + fainter nebulosity VANISHED with the background**, the important one.
  Correcting R5's milkiness, R6 pushed the bg dark and **overshot**: the pinned-curve/dark-bg sank the faint
  outer nebula and left the main nebula dim. R5 (too bright) and R6 (too dark) **bracket a target band.**
- `[method]` **My self-critique VERIFY was flawed**, I accepted the stretch on "no clipping (min>0)" + an
  eyeball "faint preserved," but the faint nebula was visually gone (mins were >0). **"No clipping" ≠ preservation.**
  → added an explicit **faint-nebula-survival check** (inspect known faint outer regions on the render) to skill+playbook.
- `[quality]` **Saturation "way too much"**, starless S-curve `[[0,0],[0.35,0.5],[0.7,0.83],[1,1]]` over-cooked
  an already-saturated SPCC result. → saturation-restraint note added to step 11 + skill. (Open: the right amount.)
- `[quality]`/constraint **Stars want a HARDER stretch + more color, per-target.** User: SetiAstro **`amount=6,
  satAmount=1.3`** work well **for NAN/Pelican** (I used a=4.0/sat=1.0 = too soft), and explicitly **"other
  targets might not be as good."** → recorded as a per-object datapoint (NOT a hardcoded default); step 12 T-target
  softened to a "starting point, push harder + confirm 1:1."
- `[tooling]` **SetiAstro Statistical Stretch**, user believes it "would be easier and had pretty much the same
  result" as the R6 hand-tuned GHS+curve. Source installed (`statisticalstretch.js`). → backlog #12: transcribe
  its Execute ops headlessly (same method as `star_stretch.js`) as an easier one-shot nebula stretch.
- `[method/autonomy]` **The loop mechanism works; the JUDGMENT QUALITY is the gap.** The self-critique loop ran
  and converged unattended, the deficiency is *what "good" means*, not the render→judge→iterate machinery.
  → reframes the "milky/tonal-contrast" open item as the per-object **objective function** (measurable faint-survival,
  saturation ceiling, object-not-dim, object-to-bg contrast), per the autonomy memory. NOT a numbers hunt.

**Changed this entry:** `osc-hoo.md` step 10 (R6 dark-overshoot / faint-survival check), step 11 (saturation
restraint), step 12 (star amount per-target/harder + R6 datapoint); `process-master` skill (band-not-edge +
faint-survival self-critique criteria, saturation restraint, star per-target amount); pipeline-state table
(Stretch/Star-stretch/Color rows + one-line read → after R6); backlog #12 (Statistical Stretch); research
questions (R6 reframe → objective-function/self-eval-quality). Memory `stretch-is-per-object-not-researchable`
already carries the autonomy framing.

**Still open, highest value next:** define the per-object **objective function** so the self-critique loop can
score its own render (faint-nebula survival, saturation ceiling, object brightness/contrast), this is the real
blocker to autonomous nonlinear processing, and R5+R6 give the two failure bounds to calibrate against. In
parallel, cheap tooling win: transcribe **SetiAstro Statistical Stretch** (backlog #12) to make the nebula
stretch closer to one-shot. Color (gold/teal, star color) still deferred.

### Run 7, 2026-07-22, OSC-HOO, North Sadr region / IC 1318 (FMA180 Pro, ATR3CMOS26000KPA / IMX571, Antlia ALP-T 5nm)
**Outcome:** full autonomous linear+nonlinear run to a saved `NorthSadr_HOO_final.xisf` (mediocre stretch, complete),
then the session pivoted to a **deep-research + live-demo cycle on BACKGROUND WORK** (user-driven training iteration).
Two big results: (1) SPCC narrowband mode **hard-deadlocked** → broadband is the OSC path; (2) a researched +
user-validated **background-neutralization method** (`docs/background-work.md`), including a rich failure-mode catalog.

**Findings**
- `[correctness]`+`[tooling]` **SPCC NARROWBAND MODE HARD-DEADLOCKED PixInsight, 3× force-restarts.**
  `narrowbandMode=true` froze the app dead (user confirmed: no console progress), not the old slow-process
  corruption. **Broadband** (`narrowbandMode=false`) + per-channel `Sony CMOS X-UVIRcut / Antlia-ALP-T` curves
  (from `library/filters.xspd`) + `Sony IMX411/…/571` QE ran clean via `executeOn` (same code path as SPFC).
  **Contradicts R1-R6** where NB worked, cause unknown (PI version/state). → skill + playbook + pipeline table +
  memory updated: use broadband for OSC duoband; don't fight NB; checkpoint-save so a restart is free.
- `[correctness]` Process icons are PJSR-readable/writable: `ProcessInstance.fromIcon(id)` / `writeIcon(id)`
  (writes only to an **existing** icon). OSC duoband filter + QE curves live in `library/filters.xspd` (greppable);
  my `scripts/spcc-curves.mjs` IMX571 QE is byte-identical to PI's built-in.
- `[quality]` **Background-work method, RESEARCHED (deep-research `wf_bb8b080b`) + LIVE-DEMO validated.** Goal =
  true bg neutral **gray** (color-neutral AND brightness-preserved) with faint signal intact. Winning recipe
  (OSC-HOO): **(1) luminance-dependent per-channel curves leveling** (single offset can't fix a brightness-dependent
  cast → dark lanes stay teal); **(2) teal→own-luminance, gated to `rex=R−(G+B)/2 < 0`** (preserves brightness =
  gray not black; red untouched by construction, ~100% faint-red preserved, no mask). Signal-hue is the per-target
  knob. Written up in `docs/background-work.md` with the full **failure-mode catalog** below. User verdict on the
  final: "preserves details, not too black, pretty decent."
- `[method]` **The ±8% diffuse-sky-band spread metric LIES post-stretch**, read 2-3% "non-neutral" on
  visually-perfect gray backgrounds (catches protected nebula-edge pixels). Valid only for *linear* pre-stretch
  neutrality. → use background-chroma of the near-neutral population + faint/bright preservation ratio + **the render**.
- `[correctness/behavior]` **I over-indexed on metrics and over-claimed**, declared the SCNR+mask result "the
  answer" on a 99.98% metric; user: **"worst result so far"** (SCNR flattened reds, mask blotched transitions).
  Classic "user's eyes beat statistics." → judge-by-render + don't-stack-ops rules added to skill.
- `[quality]` **Failure-mode catalog (all rejected by eye, same image):** desat-toward-luminance-under-mask kills
  faint red (wrong *symmetric* op, no mask fixes it) + darkens to gray; **SCNR@100%+mask** = dead reds + blotchy
  (worst); single additive offset can't fix a brightness-dependent cast; **teal-shrink toward R** preserves red but
  crushes teal to **black** (right idea, wrong target); per-pixel redness mask alone can't fix the R-cast.
- `[method]` **Perceptual:** removing chroma makes darks read *blacker* at equal luminance → neutralize by
  **preserving brightness** (toward luminance), and never fix "too dark" by global brightening (washes the neutral).
- `[correctness]` PixelMath `createNewImage` via `executeGlobal` throws "cannot execute in global context" -
  build derived images by cloning a window + in-place PixelMath, or reference source channels inline.
- `[quality]` **Doctrine softened (research-confirmed):** "never fix a cast post-stretch / never SCNR" was too
  broad (blind-SCNR@100% failures). Post-stretch neutralization is a legit *supplement*; SCNR is a *conditional*
  (green/blue-dominant cast only, dosed, mask only if highlights contain the removed channel), not "refuted."

**Changed this entry:** created `docs/background-work.md` (method + failure catalog + SCNR conditional + metric
caveat + doctrine correction); `process-master` skill (SPCC-NB-deadlock→broadband gotcha, filters.xspd/process-icon
notes, background-work pointer, judge-by-render + don't-stack + metric-lies rules, SCNR-not-refuted); `osc-hoo.md`
step 10 (post-stretch supplement + metric caveat) + step 11 (SCNR conditional not refuted); pipeline-state table
(SPCC→broadband, Bg-neutrality→+post-stretch); backlog + research questions below.

**Still open, highest value next [user-corrected roadmap]:** ⚠️ **NOT the stretch.** User: *"stretching is
good enough for now; stretching can only do so much, the POST-STRETCH work is the real, hard job."* The frontier
is the **post-stretch aesthetic fine-tuning phase**, of which **background neutralization was the first step
(now solved for Hα-HOO)**. The rest, each a per-object eye-driven refinement that can get the same
research→demo→validate treatment we gave background work:
- **Curves work** (tone/contrast shaping), **blacks/brightness** fine-tune
- **Highlights** / **HDR** (e.g. HDRMultiscaleTransform to tame bright cores + pull structure)
- **Details** (local contrast / sharpening on the nonlinear)
- **Saturation**, **Hue**, and the **CIE c\*** (chroma) component specifically, color fine-tuning in LCh/Lab, not just RGB
Treat these as the M-next research/demo backlog. **Do the same measure→render→judge-by-eye loop; don't hardcode.**
Also open: background-method generalization (OIII/SHO signal-hue, untested) and the SPCC-NB-vs-broadband root cause.

### Run 8, 2026-07-23, **OSC broadband RGB (first non-HOO run)**, Rho Ophiuchi Complex Panel 1 (FRA500+reducer, ASI2600MC Pro / IMX571, NoFilter, dec −24)
**Outcome:** first **OSC-RGB** run on this fork, the whole prior journal is OSC-HOO. Full autonomous linear+nonlinear
run to a saved `rho_final.xisf/.jpg`; **good result on the first pass** (no "dim/milky/awful" verdict, the OSC-HOO
nonlinear discipline transferred). Then **re-run 1-to-1 from scratch** (user lost the in-app state to a power outage)
- every checkpoint reproduced within AI-tool rounding. Playbook synthesis: **linear+color = `osc-rgb.md`** (broadband
SPCC, NOT narrowband); **nonlinear = `osc-hoo.md` methodology** (the run-validated half; osc-rgb's was thin/unvalidated).

**Linear half, worked, verified by artifact:** BXT correct-only (WCS preserved), SPFC (plain `Sony Color Sensor R/G/B`
+ Ideal QE → `PCL:SPFC:ScaleFactors`), **MGC DECLINED** → GradientCorrection, SPCC broadband (`WhiteBalanceFactors`,
bg neutral, diffuse-sky spread 0.48%), BXT sharpen 0.8/0.2, NXT 0.8 (MRS noise ~8.5e-6 uniform), SXT `unscreen=false` split.

**Findings**
- `[correctness]` **MGC declines with `executeOn=false` (no exception, byte-identical stats) at dec −24**, MARS DR2
  far-southern coverage gap (not the empty-table no-op). Table bound + `.xmars` present, still declined. → **GradientCorrection**
  fallback (`protection:true` etc.) worked well: corner-median ramp halved (0.000427→0.000212), central nebula preserved
  (protection stopped it eating signal). SPFC was then wasted (only MGC needs it). → baked into `osc-rgb.md` step 5 + skill.
- `[correctness]` **`image.median(channel)` throws** in the bare context, cost one failed reporting line (SPCC itself ran).
  Use `get_image_statistics` or `selectedChannel`+`median()`. → skill API notes.
- `[quality]` ✅ **OSC-RGB nonlinear half got its first live datapoint and it WORKED** by borrowing OSC-HOO GHS discipline.
  Very compressed post-SPCC bg (median ~0.00026). GHS pass-1 (`SP=0.00022,b=4,D=7`) → mode 0.17 but **milky** (R5 mode).
  De-milk: gentle `CurvesTransformation` **K** S-curve (floor down, nebula up) + moderate **S** saturation (~1.35×), judged
  on the render. Faint outer dust survived (R6 check passed). ⚠ **per-object datapoint, NOT a law**, osc-rgb nonlinear still
  wants its own research pass; recorded R8 curves in `osc-rgb.md` step 9 as evidence, did NOT hardcode as default.
- `[quality]`/`[method]` ✅ **Star stretch** (a=4.5, satAmount=1.2, M≈0.0106) → tight colorful stars, verified 1:1. Orange-dominant,
  astrophysically correct toward the galactic center. Star-PIXEL-median + ColorSaturation + 1:1 method (from R5) transferred to RGB.
- `[method]` **New star-COLOR technique from the user (gated):** green-dominant stars → `SCNR green`; magenta/purple/red-fringed
  → **`invert→SCNR-green→invert`** (magenta = green's complement → kills purple fringe, shifts toward yellow). Measure star pixels
  first, apply only what fires. → `osc-rgb.md` step 11 + skill. (The `invert→SCNR→invert` trick was already noted for HOO magenta
  fringing; now promoted to a general **star-color decision rule**.) **Applied + validated on-image:** measured star pixels =
  green 1.6% (skip SCNR), magenta/purple **37.5%** → `invert→SCNR-green→invert` → magenta **37.5%→0%**, stars visibly warmer/cleaner
  (golden-white, no purple fringe), profiles intact at 1:1. First on-image confirmation of the rule.
- `[tooling]` **Session replication**, user wants a precise full-session replay (ProcessContainer or history). A single container
  can't hold the SXT branch + PJSR curve-loading. → backlog #14; interim replay script written to `result-tests/Rho-Ophiuchi-Panel-1/`.
- `[tooling]` **Watcher/bridge went unresponsive after the re-run** (300 s timeout, "PJSR watcher may not be running"), blocked
  the star-color application + the 4 image saves. Likely PI needs relaunching (post-outage state). Not a repro of the old
  result-corruption; the process calls had all returned cleanly. → user must restart PI + watcher to finish the on-image asks.

**Changed this entry:** `osc-rgb.md` (step 5 MGC-decline+GC-fallback; step 9 R8 nonlinear datapoint; step 11 star-stretch pointer +
gated star-color rule); `process-master` skill (MGC-decline signal, star-color rule, `median(channel)` wart); backlog #14 (session
replication) + #15 (star_color_correct helper). Repro artifacts: `result-tests/Rho-Ophiuchi-Panel-1/{HISTORY.md,replay.js}`; `.gitignore`
extended (`result-tests/**/*.xisf|jpg`). **OSC-RGB pipeline state:** linear half solid (same as HOO minus MARS-southern); nonlinear half
= 1 good datapoint (borrowed HOO), needs its own validation; star-color rule new/unvalidated on-image.

**Done this session (after the watcher recovered):** rebuilt cleanly from the intact `rho_linear_processed.xisf`; saved all 4 layers
(`rho_linear_starless/stars`, `rho_final_starless/stars`) + `rho_final` to `result-tests/Rho-Ophiuchi-Panel-1/`; applied+validated the
gated star-color correction; wrote `replay.js` (full-session replay, gated star-color included) + `HISTORY.md`.
**Still open, highest value next:** (1) OSC-RGB nonlinear half needs its own research/validation pass (currently 1 borrowed datapoint).
(2) Build the `export_session` replication tool (#14), the interim is a hand-authored replay script. (3) Star-color + de-milk rules
await a second RGB target to confirm they generalize.

**Post-run feedback (2026-07-24, user at the machine, learning only, image not re-changed):**
- `[quality]` **Star amount ceiling found.** Generated the precise midpoint between my a=4.5 (too soft) and the user's own harder stretch (too hard) = **a=5.4** (matched star-pixel **p90** exactly, the right axis, not count). User: middle is good "but stars should still slightly pull softer" → sweet spot **a≈5.0-5.2** for Rho Oph. Confirms "push harder than first guess" has a ceiling: too hard inflates faint noise-stars. Recorded as per-object datapoint in `osc-rgb.md` (NOT a default).
- `[method]` **SCNR-green green-haze applies to the STARS layer (user's original point) AND the starless.** The user's "green haze around blue stars" meant the **stars** image; but they also liked a **gated** SCNR-green on the **starless** (teal haze in the reflection nebula / around blue stars), purifies teal→blue, and since Average Neutral only edits green it **cannot reduce blue** (the user's worry). ⚠ Measure **green EXCESS** `gex=G−(R+B)/2>0` on the *localized* haze/halos, the region mean is blue-dominated (reads ≤0) and hides it. Not a default either place; judge on the render. → `osc-rgb.md` step 11 + skill.
- `[tooling]` **ProcessContainer can't be created from the API, CONFIRMED hard limit.** `writeIcon` errors *"No such instance icon"* on a non-existent icon (can only overwrite an existing GUI icon); there is no PJSR process-icon/`.xpsm` file-save. Delivered instead: `process-container.js` (a built `ProcessContainer` with all 17 process instances + exact settings dumped via `.toSource()`, paste into Script Editor → drag → save as `.xpsm`) + `replay.js` (executable full-session reproducer, handles the SXT branch a container can't). → sharpens backlog #14: `export_session` must emit the paste-to-rebuild container source, since native icon minting is impossible headless. **Lesson for me: state the ProcessContainer API limit up front, don't substitute a replay script silently.**

### Run 9, 2026-07-25, **OSC broadband RGB, first MOSAIC**, Rho Ophiuchi Complex Panels 1+2 (FRA500+reducer, ASI2600MC Pro / IMX571, NoFilter, dec −24/−26)
**Outcome:** first **multi-panel** run on this fork. Two `_autocrop` masters, one finished 6159x7396
(~3.8deg x 4.6deg) mosaic covering Antares, M4, M80, sigma Sco / Sh2-9 and the IC 4603/4604 blue reflection
complex. **Final critic gate PASS** (stretch 4 / bg 3 / faint 4 / stars 4 / artifacts 4). No mosaic playbook
existed; the order was derived from web research mid-run. Full artifacts in
`result-tests/Rho-Ophiuchi-2Panel-Mosaic/` (16 warts in `HISTORY.md`). ⚠️ Note the earlier **Panel-2 session
(2026-07-24) was never journaled**, its findings live only in `result-tests/Rho-Ophiuchi-Panel-2/NOTES.md`;
two of them were independently re-derived here.

**Pipeline:** per panel (BXT correct-only, GradientCorrection, SPCC broadband; SPFC+MGC skipped per R8
southern-MARS decline) → StarAlignment `mode=2` Register/Union-Separate + frameAdaptation +
distortionCorrection (808 px overlap) → **feather blend, NOT GradientMergeMosaic** → crop → BXT sharpen →
NXT (LF 0.7) → SXT → starless: GHS(SP 0.00029, D 6.9, b 4) + de-milk curve + saturation + **SCNR green 0.5**
+ highlight curve; stars: MTF a=5.1 + ColorSaturation x1.2 + SCNR green 1.0 → screen recombine.

**Findings**
- `[method]` ⛔ **The star-colour gate measured the WRONG QUANTITY (user-caught).** R8's branch-(b) test was
  "magenta" = `R>G && B>G` (green is the MINIMUM channel). The real defect is a green **deficit without**
  magenta (`B < G < (R+B)/2`). On the user's A/B previews: magenta test **0.17%** ("skip") vs red-fringe test
  **74.2%** of lit pixels; applying `invert→SCNR-green→invert` took it **74.2% → 1.0%** and the user confirmed
  the visible "reddish bulbs" vanished. Correct axis = green vs the R-B midpoint, the exact mirror of `gex`.
  **(b) reduces to `G_new = max(G, (R+B)/2)`**, a no-op wherever green is already at/above the midpoint, and a
  smooth continuum puts G at ~the midpoint, so a deficit is non-physical on a continuum source. Verified on the
  reddest object in frame: **Antares hue 29.7→30.0 deg, sat 0.700→0.702** (G 0.419 vs midpoint 0.421).
  ⛔ **The hard exclusion is emission lines, not red stars:** the Sh2-9 arc in the starless reads G 0.357 vs
  midpoint 0.385, so (b) would bleach real Halpha. → **broadband + STARS LAYER only, default ON; never
  narrowband/duoband, never a starless holding emission.** → `osc-rgb.md` step 11 + skill + backlog #15.
- `[method]` **The stretch peak gate assumes ONE background population; a mosaic is BIMODAL.** Two real peaks
  (0.154 rho Oph half / 0.226 Antares half); the global argmax jumped between them and reported channel modes
  disagreeing 2x (R 0.088 / B 0.175), which reads as catastrophic over-black-pointing but was metric artifact.
  A first curve pinned at the global mode crushed the darker half to 0.095; pinning at the background with the
  gain ABOVE it (R6 mechanism) held both halves in range. → measure the peak PER REGION. Skill updated.
- `[method]` **Residual/speckle metrics must be normalised by LOCAL BACKGROUND.** In the SXT A/B, absolute
  speckle sigma *halved* (2.4e-4 → 1.1e-4) yet the user read the leftovers as "a tad more noisy", because
  removing the core glow dropped the background beneath them (3.11x → 1.58x) and raised their contrast.
  **The user's eyes beat the statistic**; the metric was measuring the wrong thing. Skill updated.
- `[method]` **Critic triage cost real mistakes, three ways.** (a) It reported a "satellite trail" that is
  **real sky** (a cometary reflection nebula, verified present in the untouched master), so always check an
  artifact claim against the source master. (b) Having found two false entries (bright-star "halos" = real
  reflection nebulosity), I **batch-dismissed the whole list, and the fourth finding was TRUE** (globular core
  left in the starless, later user-confirmed). (c) 2 of 3 false findings came from judging the starless **in
  isolation**, a layer nobody ever views alone. Skill updated with all three.
- `[method]` **Overriding the post-linear gate was correct, and the final critic independently confirmed it.**
  It called the ~30% top-to-bottom ramp a gradient; a sky-floor profile showed a smooth monotone decline
  **through the seam** with both panels agreeing, i.e. the Antares dust filling the upper half.
  The final critic reached the same conclusion from the per-channel plane slopes (R by=-0.261 vs B by=-0.080,
  "what a yellow dust cloud produces, not a light-pollution ramp"). **The gradient metric has no honest reading
  on a dust-filled wide field.** Also skipped the linear additive null: blank-sky patches showed **R-B flipping
  sign** across the field, which a global offset cannot fix and would only flatten real colour.
- `[correctness]` ⛔ **Shipped a silently MONOCHROME final JPEG.** A measurement helper left
  `image.selectedChannel=1` set (it ran inside a `JSON.stringify(...)` positioned *after* my
  `resetSelections()` line), and `render_view` honours the selection, replicating green into R=G=B. Normal
  3-component file, zero saturation, no warning. Took five controlled variants (size / downsample / quality /
  drive / concurrency all cleared) to isolate. `save_image` is unaffected, every `.xisf` verified
  colour-correct. **`render_critic_pack` resets internally, so the blind critic saw correct colour while the
  deliverable was grey.** → skill trap + backlog #17 (fix the tool) + #18 (invariants layer).
- `[correctness]` **The deliverables contract did not exist anywhere.** The `process-master` finish step said
  only "save the result, then write down the warts"; `AUTONOMY.md` references
  `result-tests/<target>/metrics.json` only as a threshold store. The 4-image/4-container pattern existed
  **solely as an undocumented artifact of the Panel-1 folder**, so a literal reading of the skill produced none
  of it and everything went to a scratch dir. → the skill now has a mandatory **DELIVERABLES** section
  (6 images / 4 containers / 3 records + the capture rules).
- `[correctness]` **A saved layer went stale** (`final_starless` written before a later SCNR + curve, so it did
  not match `final.xisf`). Rebuilding the starless from `linear_starless.xisf` with the 5 kept ops reproduced
  the live view **byte-identically** (mean and max abs diff exactly 0), which fixed the file *and*
  independently verified the parameters recorded in `replay.js`. That rebuild-and-diff is now the prescribed
  way to build a container when the kept steps are non-contiguous.
- `[tooling]` **`export_container` indices are +1 off from `get_full_history`**, which silently shipped an
  ABANDONED stretch in one export and silently DROPPED the star MTF in another. Only the returned
  process-name list revealed it. → backlog #19.
- `[tooling]` **Star/gradient metric blocks emit confidently wrong numbers off-phase** (`starPixelMedian` ~20x
  low, `starCount 0` / `FWHM null` on the recombined final, FWHM from a 6-star sample, gradient spread up to
  475,589% on a star layer). Both critics flagged them independently. → backlog #16.
- `[quality]` **GradientMergeMosaic rejected on measurement.** It manufactured red/teal blobs at bright stars
  near panel edges and `nShrinkCount` caps at 10 px, too small to exclude them. Overlap agreement measured
  **median 2e-6, spread +/-5e-5 = MRS noise level**, so frame adaptation had already matched the panels and the
  Poisson solve had nothing to correct. Feather blend instead: row-median profile monotone through the blend,
  seam invisible at 1:1. → research question (mosaic playbook), candidate rule "measure overlap agreement
  first".
- `[quality]` **SXT `overlap` 0.5 vs 0.2 vs StarNet2 on a globular** (A/B, user-requested): core residual
  3.11x → **1.58x** for overlap 0.5; **StarNet2 11.75x** with speckle ~= the unprocessed input (it barely
  removed the cluster). But the user was **not convinced** on the render, so this is recorded as an open lead
  with the **default unchanged**. My prediction that overlap only fixes tile seams was **wrong**.

**Changed this entry:** `osc-rgb.md` (step 11 star-colour gate axis rewritten + emission exclusion);
`process-master` skill (corrected star-colour gate; mandatory DELIVERABLES section; critic-triage rules;
bimodal per-region peak gate; background-normalised residual metrics; `selectedChannel` mono-render trap;
`export_container` off-by-one trap); journal backlog **#15 sharpened, #16-#20 added**; research questions
**+5** (mosaic playbook, SXT overlap on clusters, do aesthetic scores generalize, CRITIC_RUBRIC gaps).
**Repro artifacts:** `result-tests/Rho-Ophiuchi-2Panel-Mosaic/{HISTORY.md, metrics.json, replay.js,
linear|starless|stars|recombine.xpsm, 6 images}`.
**OSC-RGB pipeline state:** linear half solid and now mosaic-capable; the nonlinear half has a **second** good
datapoint (R8 + R9) and the star-colour gate is materially better specified. **Mosaic support is real but
undocumented**, the playbook is the highest-value open item.
