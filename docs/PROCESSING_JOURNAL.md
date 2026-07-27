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
| **Color shaping** | gated SCNR, gentle saturation | ⚠️ **SCNR correctly skipped R3-R6** (rule never fired). ⛔ **But R11 shows this row reads as a SKIP-BIAS**: on a broadband GALAXY the gate should have fired and the agent talked itself out of it with an invalid argument (`gex > 0` is trivially true for warm colour; the real test is `G vs R`, and SCNR-neutral preserves `R−B` so it cannot "bleach" a yellow core). "Not a default" means **gate it per region**, not avoid it. **R6: saturation "way too much"** on an already-saturated SPCC nebula → gentle; ⚠️ **R11 the opposite on a galaxy**, "restrained" was read as minimal and two critics flagged colourless arms, the masked-S-curve floor is higher than R11 assumed. gold/teal recipe + duoband star color still OPEN. |
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
22. **`save_image` cannot compress, and `render_view` defaults below quality 100 `[tooling, HIGH, Run 9,
    user-raised]`.** XISF written through `save_image` is **uncompressed**: 521.7 MB vs **384.2 MB** with
    `compression-codec zlib+sh`, i.e. **~140 MB wasted per image**, and a run writes 6+ of them. There is no
    compression parameter on the tool, so the only route today is `run_script` + `ImageWindow.saveAs(path,
    false,false,false,false, "compression-codec zlib+sh")`, which every future run has to remember.
    ✅ **DONE 2026-07-26, and far cheaper than assumed: NO module rebuild needed.** `render_view` was already
    implemented as TS-generated PJSR via `execPjsrJson` (not a module handler), so `save_image` was reimplemented
    the same way: it now takes **`compression` (default `zlib+sh`)**, suppresses the hint for non-XISF, keeps the
    overwrite guard, and reports the written size. `render_view` JPEG quality default 90 → **100**. TypeScript
    only, so `npm run build` + an MCP-server restart activates it, no `module:build`/sign/admin-install/PI
    restart. The module's own `handleSaveImage` (5-arg `saveAs`, no hints) is now bypassed by the tool but is
    still a trap for any direct bridge caller, fix it at the next module regen.
    ⚠️ **Two live API findings from this work:** (a) **`File.size()` does NOT exist in PJSR**, use
    `new FileInfo(path).size` (or an opened `File`'s `.size`); (b) ⛔ **XISF format hints are SESSION-STICKY**,
    an empty hints string means "format defaults" and a previous `saveAs` with a codec hint MUTATES those
    defaults, so the same image wrote 16.95 MB with `""` and then 12.07 MB with `""` after one `zlib+sh` save.
    **Any save without an explicit codec has non-deterministic size across a session**, which affects
    `replay.js` reproducibility. Always pass the codec explicitly.
    (Original ask: add a `compression` param to `save_image` and default `render_view` JPEG quality to 100.) Measured codec ranking on a 6159x7396 float RGB master: zlib+sh 384.2 MB ≈ zstd+sh, lz4hc 393.5 MB,
    lz4 400.1 MB, none 521.7 MB. **Byte shuffling is the load-bearing part** for float data (on a 1500x1500
    crop, unshuffled zlib gave 22.10 MB vs 18.53 MB shuffled, a further ~16%). PixInsight's GUI "zlib deflate"
    already shuffles (byte-identical to `zlib+sh` within 82 bytes), but an empty hints string means "format
    defaults", NOT "no compression", so always be explicit.
23. **Shared-knowledge layer `[tooling/method, HIGH, Run 9, user-raised]` ✅ SEEDED as
    `docs/workflows/_common.md`.** Cross-category facts were living wherever they were discovered, which
    produced a real near-miss: the mono SPCC rule (real filter curves + real sensor QE, never a "Sony Color
    Sensor" entry) exists ONLY in `mono-rgb.md` and a build-handoff README, while `mono-lrgb.md` has **zero**
    QE mentions and the skill's SPCC guidance is entirely OSC-flavoured. An LRGB run reading skill + LRGB
    playbook would plausibly apply the OSC Ideal-QE rule and double-count sensor response.
    **Design rule that answers "what if a future category contradicts it": shared entries record the DECISION
    AXIS, not a universal value** (not "use Ideal QE" but "QE depends on sensor type: OSC → Ideal, mono →
    real"), so a new category ADDS A ROW instead of contradicting. Every entry carries `Verified on:` so a
    contradiction is a visible event, not silent rot. Skill now routes to `_common.md` on every run and tells
    the mono delta playbooks to read the spine. → remaining work: migrate the stretch discipline out of
    `osc-hoo.md` steps 10-12 into `_common.md` once a second category validates it.
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
24. **`get_background_profile(viewId, axis, bands?)` `[tooling, HIGH, Run 10]`**, the per-channel sky-band
    X/Y profile was the ONLY metric that caught R10's real chromatic ramps (box-median gradient and the ±8%
    band are both blind to antisymmetric ramps), and it was improvised in `run_script` 6+ times in one run.
    Ship it first-class WITH the two hard-won caveats built in: (a) a structure mask / structure-clipped sky
    estimator (the 40th-pct percentile is contaminated inside columns holding a dark nebula, and a fit
    through the fake dip paints complementary color onto the subject, R10's red blob); (b) report ramp as a
    fraction AND as "post-stretch projected %" given a target peak, so the flat-enough judgment is explicit
    (1.4% linear = 55% stretched on R10). A companion `flatten_profile` actuator should require an explicit
    structure-mask ack.
25. **Critic economy `[tooling/method, HIGH, Run 10, user-raised]`**, user: critics "take very long, probably
    waste a lot of tokens, not sure I'm confident about their benefits." R10 data: 6 critic subagents; 5 real
    catches (chromatic ramp, L-lightness ramp, star floors, green annuli, cyan shadows) vs 1 costly misfire
    (crop over real Ha) + repeated findings across gates + slow sequential turnaround. Directions to evaluate:
    (a) invariants + cheap deterministic metrics FIRST (backlog #18, #24), critic only where numbers can't
    judge; (b) fewer gates by default (post-linear + final; post-stretch layer packs only when the driver is
    uncertain); (c) sky-facts target card (R9 research Q, now with a second confirming datapoint); (d) smaller/
    cheaper model or reduced effort for the critic subagent; (e) driver spot-verifies quantitative claims
    before acting (now a skill rule). Do NOT silently drop gates, agree the default with the user first.
26. **`Crop` headless semantics `[tooling, LOW, Run 10]`**, `mode:1` + negative margins silently no-op'd on an
    RGB view and returned an empty error on a mono view. Map the mode enum / margin sign convention properly
    before anyone needs a scripted crop (R10's was vetoed, so unresolved).
27. **`metrics.stars` / `get_star_metrics` must be LAYER-AWARE `[tooling, HIGH, Run 11]`**, on a starless it
    named the **M32 nucleus** the brightest "star" (peak 0.993) and returned medianFWHM 12.37 / ecc 0.839, i.e.
    galaxy structure presented as star metrics; on a stars layer it escalated the threshold 4x and measured 56
    of a claimed 10016. **Two independent critics tripped on it** and had to override by render. It already
    emits a degenerate-median warning for stars-only layers → add the same for "detector latched onto an
    extended object" (e.g. flag when measured FWHM >> the pre-split FWHM, or when the top peak is resolved).
    Also: it **excludes saturated peaks, so it goes blind exactly when clipping starts** (returned
    `measured: 0`, `medianFWHM: null` at the moment BXT pinned the cores, the step where it was most needed) →
    report a saturated-star count and a fallback FWHM from unsaturated stars.
28. **Clamp-op acceptance metric `[tooling/method, MED, Run 11]`**, the SCNR / invert-SCNR gates report a mean
    relative excess/deficit, and R11 accepted a bad result on it (mean −0.96% while 51.3% of pixels still
    violated, worst case 80.5%). A measurement helper for these ops should return **`% still violating`,
    `worst-case relative`, and the `(x,y)` of the worst case** as first-class outputs, and the render helper
    should take those coordinates directly. Turns a skill rule into a tool guarantee.
29. **BXT clipping-headroom calculator `[tooling, MED, Run 11]`**, `_common.md` says "add headroom" without an
    amount; R11 burned 3 iterations (1.0x → 1.5x → 3.0x) because correcting an ecc-0.52 PSF concentrates peak
    flux ~1.78x. Derivable as `(FWHM_before/FWHM_after)²` from a cheap pre-pass, or just measure the saturated
    count before/after and auto-retry. Should be a pre-flight guard, not a lesson.
30. **⛔ Critic-pack blindness hygiene `[tooling, HIGH, Run 11]`**, the deliverables spec puts critic reports in
    `critic/`, and the natural path `critic/<gate>/report.md` places the processing narrative **inside the pack
    directory a later blind critic is pointed at**. A gate caught this itself ("a blind critic is one Read away
    from the processing narrative"). Fixed by convention here (`critic/reports/<gate>.md`), but
    `render_critic_pack` should own it: emit packs into a directory that holds renders + metrics only, or the
    deliverables spec should mandate reports outside the pack tree. Pairs with the task-list leak noted in
    the session memory (the harness can leak stage names to critics through task subjects too).
31. **`full.png` is anti-diagnostic at downsample 5 `[tooling, MED, Run 11]`**, in both directions: it averaged
    the ring/undershoot defect away completely (0% ringed sources vs 10-35% at 1:1, so an overview-only review
    would pass a defective frame) and it box-averages a 2-3 px star over 25 px so a **stars layer reads far too
    dark**. → peak/max-preserving downsample for the overview, or an explicit "not diagnostic for point sources
    or star layers at this scale" note in the pack manifest.
32. **Masks are invisible to `export_container` `[tooling, MED, Run 11]`**, both saturation passes ran through a
    window mask, so `starless.xpsm` / `final_colour.xpsm` cannot reproduce them and `replay.js` is the only
    faithful reproducer. Minimum: flag a container whose source history contains steps applied under a mask as
    INCOMPLETE. Better: capture the mask as a companion image + a sidecar note.
33. **Synchronous-only critic gating `[tooling, MED, Run 11]`**, background subagents completed analysis and
    returned nothing (3 of them; `SendMessage` did not revive them), and the subagent `Write` tool is blocked by
    a report-file policy so "have the agent save its own report" fails silently too. Only synchronous `Agent`
    calls delivered. Cost ~40 min and 3 wasted launches. Either make background agent results reliably
    retrievable or encode "gates run synchronously, caller persists the report" in the skill.

34. **⛔ Never overwrite a delivered final `[tooling/process, HIGH, Run 11]`**, the deliverables spec
    names a single `final.xisf` / `final.jpg`, so successive revisions overwrote it in place. When the
    user rejected v3 and asked to return to baseline, v1 existed only as an in-memory view and was
    one window-close from being gone. **Fix adopted:** a `versions/` directory that is never
    overwritten (`final_v1.xisf`, `final_v3_grainy.xisf`, … plus matching starless files and a README
    of the measurements), with `final.*` merely mirroring the current pick. Should be in the
    `process-master` DELIVERABLES section, not improvised per-run.
35. **Local-contrast metric as a first-class measurement `[tooling, MED, Run 11]`**, "the galaxy looks
    hazy" was diagnosable only after hand-rolling `mean |px − local median(15px)| / local level` in
    `run_script`. It is the metric that distinguishes *under-textured* from *over-glowing*, and the
    radial-profile check (the obvious first guess) actively misleads: it was near-identical between a
    good and a bad image. Belongs next to `get_noise` / `get_star_metrics`.
36. **⛔ "Curve aggressiveness" guard `[tooling/method, HIGH, Run 11]`**, the agent has no signal telling
    it that a tone curve is too violent, and shipped three rejected versions whose *outcome* metrics
    all looked fine. Cheap and computable before executing: **number of control points**, **max local
    slope**, **max single-step level change** (`|out/in − 1|` at the background), and **cumulative
    slope excursion** across the whole nonlinear chain. On R11 the accepted (user) chain used 4-point
    curves with ~10% deltas and max slope near 1; every rejected agent version used 8-11 points with
    slopes to 1.86 and a −38% single-step background move. A warning at, say, >5 control points or
    >1.3 local slope or >15% background move would have caught all three. Pairs with #35.
37. ~~**Structure-colour metric**~~ `[tooling, HIGH, R12]` **DELIVERED 2026-07-27** as
    `get_structure_color` (`src/pjsr/measure-structure-color.ts`). Verified to catch the R12 defect:
    re-applying the v1 teal gate to the accepted result moves `structure.RoverG` 2.02 -> 1.41.
    Original entry:, "did processing preserve the colour of this
    nebulosity?" has no tool, and the obvious substitute (region medians, `bgChroma`,
    `get_background_neutrality`) answered **wrong twice in one run** because the median of a region is
    the SKY, not the structure in it. The correct primitive: split a region by LUMINANCE, exclude
    stars, return `(bright population − dark population)` per channel = the colour of the structure.
    On R12 it read `R/G` 1.547 (linear input) vs 0.917 (delivered) where medians showed no change.
    Pairs with #35 (local contrast); same shape of gap, colour instead of detail.
38. ~~**Spatial chroma check**~~ `[tooling, HIGH, R12]` **DELIVERED 2026-07-27**, folded into
    `get_structure_color.spatialChroma` (per-tile saturation map + exactly-achromatic fraction);
    it shares the same stride-grid pass. Verified: `pctExactlyAchromatic` 0% -> 1.41% on the
    re-broken image, `minTileSaturation` 0.0998 -> 0.0500. Original entry:, `bgChroma` is magnitude-only and scored a
    damaged image as *better than reference* (0.0252 vs a 0.05 bar) while **72.5% of one corner was
    at exactly R=G=B**. Need per-tile/per-corner saturation and the fraction of exactly-achromatic
    pixels. Also needed to catch cast DIRECTION, which `bgChroma` cannot express. Blocking a real
    defect class: any operation that pulls pixels toward luminance can silently zero chroma.
39. **Cumulative-saturation guard `[tooling/method, HIGH, R12]`**, sibling of #36 (curve
    aggressiveness) for colour. 6-8 individually gentle gated saturation ops multiplied to ~**x2.6**
    in overlapping luminance bands, and nothing in the loop tracked the product. Cheap: accumulate
    the per-band effective factor across the chain and warn above ~1.5x, or simply require colour to
    be done in one measured step.
40. **⛔ Critic blindness is breached by the harness `[tooling, HIGH, R12]`**, **two** critics
    disclosed, unprompted, that the session TASK LIST reached them via system reminders naming
    BXT/NXT/SPCC/SXT/MGC stage by stage. `docs/AUTONOMY.md` and the `image-critic` skill both rest on
    the critic being blind to process. One critic also confirmed that renaming tasks mid-run works but
    only for reminders delivered *after* the rename. Fixes, in order: (a) harness should not share the
    parent task list with subagents, or allow opt-out; (b) failing that, keep tool names out of task
    subjects before spawning any critic; (c) make "declare and disregard side-channel process info" a
    REQUIRED instruction in the skill rather than the lucky behaviour it was here.
41. **Critic pack renders are 8-bit `[tooling, MED, R12]`**, so an "exactly achromatic" test is
    quantization-floor limited (the `sat<0.01` fraction equalled the exact-achromatic fraction in all
    eight crops). 16-bit renders, or a per-crop chroma statistic shipped in `metrics.json`, would make
    that check reliable. Also: `render_critic_pack` omits `stars.png` at `phase:"final"`, and
    `metrics.stars` was degenerate at EVERY phase of R12 (null FWHM on the linear master, nebula knots
    on the starless, misleading on the stars layer, `starCount 0` on the final).

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

- **Dust color fidelity `[quality, R10, RESEARCH-SETTLED with an open aesthetic tension]`.** My
  claim "R/B 2.0 final vs ~1% linear differential = over-saturated" was **contradicted** by the
  verification pass (2026-07-26): comparing a LINEAR differential against a POST-STRETCH ratio is
  a category error (the stretch exists to turn small linear differences into large visible ones),
  and physically interstellar dust IS "saturated orange to brownish-red" (Clarkvision; the common
  amateur failure is UNDER-saturating dust, rendering it yellow). So strong red-brown B150 rims
  are plausibly FAITHFUL. What remains true: R10's redundant gradient passes injected a real
  spurious component (stage-traced, sandbox-proven), and the v2 rebuild removed it. **Fidelity
  check going forward: verify SPCC ran + sky background neutral, then judge dust hue against
  calibrated references, NEVER against the linear differential.** Open tension: the user prefers
  less red than even physically-faithful rendering; that is an aesthetic preference to honor
  per-target, not a fidelity rule.
- **Chroma-aware shadow color correction `[quality/method, R10, OPEN]`.** Both R10 shadow ops had
  complementary holes: luminance-only gating concentrates the correction in the darkest REAL
  structure (the subject), while |rex|-gating excludes exactly the strongly-cast pixels needing
  the fix. Design a shadow neutralization that (a) never pushes a channel above the local max
  channel, (b) excludes coherent structure, (c) verifies on the subject render, not the global
  shadow-median metric. Until then: shadow ops are suspect-by-default near dark nebulae.
- **Mauve / G-deficit spatial residual `[quality, R10, OPEN]`.** The passed final retains a top-row
  G-below-both-neighbours tilt (5-9.6% of midpoint, critic-measured; reads lilac). The corrective
  (gated G-lift, `G=max(G,(R+B)/2)`) is hard-excluded near emission regions (left-edge Ha), so a
  global application is unsafe. Needs a spatially-bounded approach (fit the tilt as a smooth field
  on non-emission sky, or region-mask). Second datapoint for the R9 "green survives calibration"
  question, on MONO this time (G filter airglow).
- **Galaxy nonlinear tone target `[quality, R11, OPEN]`.** The `0.20-0.25` histogram-peak band is a
  nebula-filling-target number and lands a **galaxy on comparatively empty sky too bright**: R11 hit
  0.2055 (inside the band, low end), passed every gate, and the user still darkened it to a
  whole-image median of 0.198 and asked for more contrast. Both blind critics independently reported
  a **highlight-compressed, hue-washed core** ("cream-white plateau ... golden-yellow washes to
  ivory", not clipped at 0.83). Research: (a) is there a distinct target band for
  galaxy/small-object-on-sky vs nebula-filling fields; (b) how to add object contrast without
  re-milking, i.e. the de-milk S-curve's **highlight slope** (R11 used 0.375 above x=0.8, deliberate
  protection, which is what flattened the bulge); (c) whether core structure wants a **local HDR**
  step (HDRMultiscaleTransform / LocalHistogramEqualization) rather than a global curve, user
  suggested "a bit more HDR to the core if needed". ⛔ **Do not hardcode R11's curve points.**
  User constraints to research against: darker background, more overall contrast, slightly stronger
  saturation than R11's second pass, dust lanes enhanced (see DarkStructureEnhance below).
- **DarkStructureEnhance parameters `[quality, R11, OPEN]`.** User-taught and user-endorsed
  ("fantastic ... looks beautiful") for dust lanes; mechanism and defaults are now documented in
  `osc-rgb.md` §10b from source, but **no numbers are validated here** and it was not run by the
  agent. Research: sensible `numberOfLayers` / `median` / `iterations` for a galaxy dust lane vs a
  dark nebula, where it belongs in the order (before or after saturation; on the starless or the
  recombined final, the user applied it last on the final), and its interaction with the chroma-noise
  amplification the second saturation pass already introduces in low-signal lanes.
- **Is the broadband invert-SCNR amount cap real? `[quality, R11, OPEN]`.** `_common.md` caps the
  deficit branch at 0.3-0.5 on broadband to protect the reddest stars from desaturation at amount
  1.0. That is a **research inference, never measured on-image**, and on R11 amount 0.3 was far too
  weak (51.3% residual, 80.5% worst case, visible purple star; the user applied a second full pass).
  Research: measure the reddest/most-reddened star in a broadband field before and after the branch
  at amounts 0.3 / 0.5 / 1.0 and quantify actual saturation loss, then either justify the cap with
  numbers or replace it with the residual-fraction acceptance test. R10 (cap's origin) and R11
  (cap too weak) currently disagree.

- **✅ RESOLVED by R12, the broadband invert-SCNR cap.** R11 asked for the measurement at
  0.3/0.5/1.0; R12 ran it at 1.0 on a heavily reddened field. Saturation of the ten reddest stars
  **rose on every one**, and there is a proof, not just a measurement: clamping G toward `(R+B)/2`
  leaves G the MIDDLE channel, so `max`/`min` and therefore `(max−min)/max` are invariant. The op
  moves hue only and cannot desaturate a star. Landed in `_common.md` §3. **Question closed.**
- **✅ RESOLVED by the user, R12: the 0.20-0.25 peak band is a WAYPOINT, not an acceptance gate.**
  *User: "I don't think 0.2 or 0.25 matters, even after stretch we can always use s curve to darken
  the background, increase the highlights. I think possibly data + visual comparison might be a good
  combination."* **Global tone is freely reshapeable after the stretch**, so the peak is an
  intermediate state, not the deliverable, and gating the FINAL on it is a category error. What the
  gate was really protecting is **faint-signal survival**, which should be measured directly
  (R12: faint-over-sky 0.073 → 0.096 *improved* while the peak fell 0.170 → 0.146, accepted at
  0.146). Acceptance criterion becomes **data + visual comparison together**: neither alone has
  worked here (metrics passed three rejected R11 versions; eyeballing without measurement let R12's
  colour inversion ship). Landed in the `process-master` skill. The residual research below is now
  narrower, not a band question.
- **What the peak band should key off, if anything `[quality, R11+R12, NARROWED]`.**
  R11 (galaxy) was pulled to a 0.198 median; R12 (nebula-FILLING, the case the band was supposedly
  tuned for) was pulled to peak **0.146**, in two successive user requests for a darker background.
  That breaks the standing explanation that the band is "tuned for nebula-filling targets" - M16 *is*
  one. Research: is the band simply too bright in general, is it a function of how much of the frame
  is real signal (M16 has NO empty sky, darkest 1% at 88% of the sky median), or is it a display/
  gamma assumption? Constraint for the research: at peak 0.146 the faint-survival check *improved*
  at every step (faint-over-sky separation 0.073 → 0.096), so the gate the band protects was never
  actually at risk. ⛔ Do not simply lower the band by decree; find out what it should key off.
- **DarkStructureEnhance parameters, second datapoint `[quality, R11+R12, still OPEN]`.** R12 ran it
  for real (R11 only documented it): `numberOfLayers 8, scalingFunction 1, median 0.68, 1 iteration`,
  applied to the **starless** (not the recombined final as the R11 user did) so stars cannot be
  darkened. Effect measured as dust-lane local contrast 6.42 → 7.60 with sky and bright core
  unchanged. Still not a validated recipe: `median` 0.68 vs the 0.7 default was picked by eye, and
  starless-vs-final placement remains untested head to head.

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

### Run 10, 2026-07-26, mono-LRGB (FIRST mono run), Barnard 150 / Seahorse (384mm f/4.8, ASI2600MM, Optolong LRGB)
**Outcome:** complete autonomous run, final blind-critic **PASS (4/3/4/4/4)**, user: "the ending
result is looking pretty good, I like what you did", with four substantive user findings. Full
artifacts + warts in `result-tests/Barnard150/HISTORY.md`. Star-separated LRGB path (SXT both
layers, LRGBCombination on starless only, RGB stars screened back) worked structurally.
All critic gates ran live: post-linear (2 revise cycles + user closure), post-stretch (1 each
layer), final (1 cycle → pass).

**Findings**
- `[method]` ⛔ **Nearly executed a critic-recommended 300px crop over a real Ha region; the user
  had to interrupt.** The r2 critic's "red-deficient band cannot be sky" was spectrally wrong
  (raw R master: spot/annulus R 1.006 vs G 1.002, global R +8.7% where G +0.9% = real Ha), and I
  executed instead of pausing. Compounding error: the gate had closed at max revise cycles, whose
  remedy is LOG AND PROCEED, and the crop was also a geometry change (invalidates checkpoints).
  → skill: crop/geometry = user decision; verify "cannot be sky" claims against raw masters;
  closure means log, not act; give the critic a sky-facts target card.
- `[method]` **"Flat enough" must be judged against stretch amplification** (the run's dominant
  defect): L's 1.4% linear ramp, accepted as flat, was amplified ~50x by GHS and became the
  combined image's lightness via LRGBCombination (55% render ramp, tonal hierarchy inverted,
  dark nebula brighter than sky). Fixed in-run by undoing LRGB, cubic-flattening linear starless
  L, restretching, recombining. → skill + `_common.md` + `mono-lrgb.md` L-5: lightness carriers
  gate at ~0.3% profile ramp.
- `[method]` **Both standing background metrics (box-median gradient, ±8% band) were blind to a
  real antisymmetric chromatic ramp** the r0 critic saw instantly (R -10.1% / G -7.0% / B -6.7%
  linear X-profile; raw R master carries the same -9.4%). The catching metric, per-channel
  sky-band X/Y profile, was improvised in-run 6+ times. → `_common.md` + backlog #24.
- `[method]`+`[quality]` ⛔ **The red blob's ROOT CAUSE (user-forced second pass; my first two
  attributions were WRONG).** Attempt 1: a global red-hue desaturation "fix", REJECTED by the
  user (killed all reds incl. real Ha, blob still structurally present), symptomatic hack, not a
  fix. Attempt 2: blamed the improvised profile fits, DISPROVED analytically (their contribution
  measured −2e-3). The real chain, established by a scale-invariant stage trace (blob-vs-refs red
  differential D x1e-3: raw −15 → GC −7 → SPFC/MGC1 +8 → SPCC +27 → MGC2 +45 → BXT/NXT +64, and
  a sandbox replay reproduced the shipped +64.3 exactly):
  (a) **REDUNDANT gradient passes (GC 2x on R, MGC 2x) injected channel-differential residue over
  the dark structure** (~+23e-3 combined), each retry no-op'd at its target ramp scale but left
  local chroma error on the nebula; (b) SPCC pedestal removal amplified ALL local contrasts ~4x,
  LEGITIMATE physics (the additive sky is ~75% of the raw level; dust genuinely extincts B >> R);
  (c) BXT/NXT compounded (+19). **Rule: run the MINIMUM number of gradient-model subtractions;
  never "try again" on a converged pass.** v2 rebuild (single passes + structure-masked fits):
  blob R/B 2.00 → 1.52 with the Ha strip STRONGER (rex 72 → 99, the extra passes had been
  suppressing real signal too). → skill + `_common.md` + research Q below.
- `[method]` **Luminance-only-gated shadow color ops concentrate in the darkest REAL structure =
  the subject.** The final-polish "equalize shadow medians" pushed +R exactly onto the dark
  nebula (blob rex +28% from polish alone); the Stage-1 leveling |rex| gate has the complementary
  hole (excludes the strongly-cast pixels it should fix). Global metric passed while the subject
  got tinted. → skill trap + research Q (chroma-aware shadow gating).
- `[correctness]` **SXT star layers carry unequal per-channel constant floors** (R 14.1e-6 /
  G 9.1e-6 / B 6.1e-6 = 2.3x R:B); the star MTF amplified them into an orange wash on all faint
  stars (post-stretch critic: B median exactly 0 in whole rows). Fixed by floor subtraction +
  rebuild. → `_common.md` 4b + skill.
- `[method]` **"Star pixel median vs 0.35-0.45" is a moving goalpost post-stretch:** each MTF pass
  floods the >threshold footprint with wing pixels and drags the median DOWN (39k → 111k px,
  0.112 → 0.106 after MORE stretch). Chasing it numerically diverges. → skill: set amount once
  from pre-stretch M, judge renders.
- `[correctness]` **PixelMath `newImageColorSpace: 2` = GRAY** (not RGB) silently produced a mono
  recombine; caught by the R9 always-verify-saturation rule (which earned its keep). Use 0 =
  SameAsTarget. → skill trap.
- `[correctness]` **Deliverables layout confused the user on a multi-track run** ("linear and
  L_linear?", "no in-between steps?"): bare `linear.xisf` names don't say which track, and there
  was no checkpoint between ChannelCombination and the fully-processed linear. → skill DELIVERABLES
  reworked: track prefixes (rgb_/L_/Ha_), added `rgb_combined.xisf` (post-combine pre-cal,
  user-requested so they can re-run calibration themselves) + `rgb_calibrated.xisf` (post-SPCC
  pre-BXT), and a per-run README.md mapping every file.
- `[tooling]` `get_star_metrics` returns `measured=0` / null FWHM on BXT-tightened images (PSF fit
  fails; worked pre-BXT on the same views), and `brightestStars` degrades to tie-order at
  peak=1.0. Extends backlog #16.
- `[tooling]` `Crop` headless: `mode:1` + negative margins silently no-op'd on an RGB view and
  errored empty on mono. Semantics unresolved (moot this run, crop vetoed). Backlog #26.
- `[tooling]` GHS `stretchFactor` param (0-20) is the LOG slider (exp(v)-1), not raw D, v=8 lifted
  bg 0.0009→0.31. Documented in skill; the measured-stretch helper (#8) would absorb this.
- `[method]` **Critic cost/benefit, user-raised, mixed verdict.** 6 subagent critics ran; r0
  post-linear + post-stretch + final r0 each caught real, fixable defects my metrics missed (the
  chromatic ramp, the L-lightness ramp, star floors, green annuli, cyan shadows), but: the crop
  misfire cost a user interrupt, findings repeat across critics (NGC 6946 desaturation x3, mauve
  x2), each gate is slow (subagent reads 8 PNGs + rubric) and token-heavy, and polish driven by
  critic findings created part of the red-blob problem (over-correction risk). The reliable
  pattern remains R9's: **A/B and concrete measurable defects good, absolute aesthetic scores and
  sky interpretation weak.** → backlog #25 (critic economy) + existing R9 research Q.

**Changed this entry:** `process-master` (critic-crop/geometry rule, gate-closure rule, spot-verify
rule, target card, L-flatness gate, profile-contamination trap, R10 nonlinear traps block, reworked
DELIVERABLES layout); `_common.md` (4b star-layer floors, profile metric + blindspot, flatness-vs-
amplification); `mono-lrgb.md` (L-5 flatten-first gate); backlog #16 extended, **#24-#26 added**;
research questions +3 (dust-rim color fidelity, chroma-aware shadow gating, mauve/G-deficit spatial
residual). **Repro artifacts:** `result-tests/Barnard150/` (full stage tree, 7 critic packs with
reports, metrics.json, replay.js, HISTORY.md).

**Verification-research addendum (2026-07-26, web pass over the R10 improvised rules; full report
in the session record):** 6 of 7 claims needed corrections, all applied to skill/playbooks:
(1) L-flatten rationale corrected (the structural reason is the L*a*b* lightness/chrominance split:
achromatic RGB gradients are DISCARDED at combine, L's survive 1:1; the 30-50x figure is absolute
near-black MTF slope, not fractional) + numeric bar adopted (<1% of sky, aim ~0.4%);
(2) star-floor remedy reversed to the sourced standard (per-channel midtones equalization; a star
layer's background is near-clipped, black-point raises lose faint stars; direct subtraction only
for measurably-positive floors);
(3) "box-median blind to chromatic ramps" narrowed to SCALAR summaries (the map resolves them; R10
read only the scalars); model-inspection added as the cheap first check;
(4) profile-subtraction confirmed; added level add-back + X/Y-separability caveats;
(5) deficit-branch (invert-SCNR-invert) demoted from broadband default-at-1.0 to a bounded 0.3-0.5
correction (the clamp sits on the blackbody locus; strong magenta post-SPCC = diagnose first);
(6) LinearFit-in-linear is the prescribed LRGB brightness match (peak-matching = verification
only); chrominance NR off = reasoned option not best practice; screen = default recombination;
(7) my "R/B 2.0 = over-saturated vs 1% linear differential" claim CONTRADICTED (category error +
dust physics; see the settled research question above). The redundant-gradient-pass root cause is
UNAFFECTED by (7): the injected component was independently proven by the stage trace.
**Mono-LRGB pipeline state:** linear spine solid on first contact (registration/WCS reuse, real
Optolong curves + IMX571 QE via SPCC/SPFC, MARS-MGC killed a ramp blind GC refused); the
star-separated combine is structurally sound; the new failure class is **ramp/floor amplification
through the stretch and the L transfer**, now gated. Nonlinear judgment quality remains the
open axis (same as OSC), plus the new shadow-color-op question.

---

### Run 11, 2026-07-26, OSC-RGB, M31 (Esprit 100 / 555 mm, ASI2600MC Pro, no filters, 180 s subs)
**Outcome:** complete autonomous run, **good result, user-approved with corrections.** All three
critic gates passed (post-linear returned `revise: stars`, verified and logged; post-stretch
starless/stars and final all `pass`, final judged twice). Linear half clean on first contact.
User verdict: "The run did very well", then five corrections, two of which were real agent errors.
Artifacts: `result-tests/M31/` (full stage tree, 4 critic packs + reports in `critic/reports/`,
`metrics.json`, `replay.js`, `HISTORY.md`).

**Linear half, all first-try:** headroom → BXT correct-only (ecc **0.521 → 0.288**) → SPFC → MGC/MARS
(sky-profile Y 1.7-1.9% → **<1%**) → SPCC (neutrality **18.5% → 0.30%**) → BXT sharpen (FWHM
**4.59 → 2.50**) → NXT (MRS halved, channel-uniform). Final mode 0.2055, bgChroma 0.0282, clipping
0.003% high / 0% low.

**Findings**
- ⛔ `[correctness]` **Skipped SCNR on the starless using an invalid argument, and it was the run's
  main quality miss.** The agent measured `gexRel` +3.0% (core) / +7.2% (M110) / +3.3% (arm) and
  reasoned "yellow *means* `G > (R+B)/2`, so this is legitimate warm colour, and SCNR would bleach
  the core." **Two distinct errors.** (a) **Wrong invariant:** SCNR-neutral is `G' = min(G,0.5(R+B))`,
  it edits *only* G, so **`R − B`, the whole warm-vs-cool signal, is preserved exactly** - it cannot
  bleach a yellow core, it removes only the green making yellow read olive. The "bleach" claim was
  provably false. (b) **No magnitude test:** `gex > 0` is satisfied by both real warm colour and a
  real cast. The discriminator for a **continuum** source is `R > G > B`, and **M110 measured
  G 0.482 ABOVE R 0.472** - non-physical for an elliptical's integrated light. The agent also
  transferred the emission-line HARD EXCLUSION (which belongs to the *deficit* branch, that raises G)
  onto branch (a). User's `SCNR` green, AverageNeutral, **amount 1.0**, post-recombine → all regions
  `gexRel <= 0.11%`, `G−R` properly negative (core −0.029), visibly better.
- ⛔ `[method]` **Verified a CLAMP by its mean and shipped the outlier.** Branch (b) invert-SCNR ran at
  amount 0.3; the agent saw mean relative deficit −4.28% → −0.96% and accepted. Re-measured:
  **51.3% of lit star pixels still green-deficient, worst case 80.5%, 14,989 px above 0.35 brightness
  carrying >18% deficit** - the user saw a purple star. The **residual fraction barely moved
  (53.6% → 52.7%)** and was in the same measurement output; that was the number that mattered,
  because a clamp is supposed to *empty* the violating population, not shrink its average. User's
  fix: a second full pass (residual → 3.1%).
- `[method]` **Did the mandated 1:1 star verify at a region the agent chose, not the measured worst
  case.** The metric already knew the offender's coordinates.
- `[method]` **KB framing produced a SKIP-BIAS on SCNR** (user: "it feels like you have a bias towards
  not doing it"). The journal/playbook record SCNR being *correctly skipped* in R3-R6, which reads as
  a prior rather than as "gate it". Fixed in the skill: "not a default" = gate it per region with the
  right discriminator, and a broadband galaxy usually SHOULD fire.
- `[quality]` **The 0.3-0.5 broadband deficit-branch cap is CONTESTED.** It came from research
  inference (protecting the reddest stars at amount 1.0), never measured on-image, and on R11 it was
  far too weak. → research question below; do not obey the cap blind.
- `[quality]` **Saturation floor was too low, and "restrained" was read as "minimal".** Core sat 0.0535
  after the first masked pass; **two independent blind critics** flagged "blue arms barely
  distinguishable" - the playbook's own galaxy goal. A second masked pass (core 0.0837 / arms 0.164 /
  dust 0.270) landed with background sat **unchanged** (0.0182 → 0.0183) and the user still wanted
  "slightly more". The luminance mask is what makes this safe.
- `[quality]` **Global tone: too bright and too flat for a galaxy.** User wants darker background, more
  contrast, slight lane/galaxy enhancement, possible core HDR. Their own edit took whole-image median
  **0.226 → 0.198**. Both critics independently said "highlight-compressed core". The agent's mode
  0.2055 was *inside* the playbook band 0.20-0.25 but at its low end and still too bright here -
  second confirmation that the band is tuned for nebula-filling targets, not galaxies-on-empty-sky.
- ✅ `[technique]` **User taught `Utilities > DarkStructureEnhance`** for dust lanes. Source read and
  mechanism documented into `osc-rgb.md` §10b (mask = `largeScale − original` from a single-residual-
  layer wavelet → rescale → NR; then masked `HistogramTransformation` with RGB/K midtones = `median`
  0.7, which darkens only structure darker than its surroundings). Defaults recorded. Dialog-only, so
  headless needs the worker-function replay pattern.
- ✅ `[confirmed]` **Dead/hot-pixel speckle correctly triaged and left alone** (user: "you did well to
  simply ignore it ... not much that can be done at this stage"). Verified pre-existing in the
  untouched master and *reduced* 66% by processing (24.2 → 8.2 spike px per 1000). Owner is the
  stacking/calibration stage (CosmeticCorrection), not the post-processing pipeline.
- ✅ `[confirmed]` **Post-linear critic's `revise: stars` correctly rejected after measurement.** Ring
  depth in **absolute** units was unchanged by the sharpen pass (corner-TL got *shallower*,
  −5.03e-5 → −4.61e-5); the apparent worsening was NXT dropping the noise floor ~42% and inflating a
  σ-normalised comparison. 0% of stars reached zero. Both later gates independently reported "no dark
  rings". Good use of the spot-verify rule.
- `[correctness]` **Crescent-arc and border "artifacts" verified against the untouched master before
  acting** (arcs = real optical ghosts; border = ±2-3% in linear, ~20x exaggerated by the pack's
  shadow clip). The R9 verify-before-removing rule worked.
- `[tooling]` **`metrics.stars` is silently wrong on non-star-field layers.** On the starless it named
  the **M32 nucleus** the brightest "star" (peak 0.993) → medianFWHM 12.37, ecc 0.839, i.e. galaxy
  structure; on the stars layer it escalated 4x and measured 56 of a claimed 10016. Two separate
  critics tripped on it and had to override it by render. → backlog.
- `[tooling]` **`get_star_metrics` goes blind exactly when clipping starts** (excludes saturated peaks →
  returned `measured: 0`, `medianFWHM: null` at the moment BXT pinned the cores). → backlog.
- `[tooling]` **BXT headroom amount is unspecified and cost 3 iterations.** Derivable:
  required headroom ≈ `(FWHM_before/FWHM_after)²` (predicted 1.78x for correct-only alone; 3x held). → backlog.
- `[tooling]` **The critic pack layout invites a blindness breach**: the deliverables spec puts reports
  in `critic/`, and the obvious path `critic/<gate>/report.md` sits *inside the pack a later critic
  reads*. A gate caught this itself. Fixed here (`critic/reports/`) and in the memory note. → backlog.
- `[tooling]` **`full.png` at downsample 5 is anti-diagnostic in both directions**: it averaged the
  ring defect away entirely (0% vs 10-35% at 1:1) and makes a stars layer read far too dark. → backlog.
- `[tooling]` **Masks are invisible to `export_container`**, so the masked saturation steps cannot be
  reproduced from the `.xpsm`; `replay.js` is the only faithful reproducer. → backlog.
- `[tooling]` **Background subagents returned nothing** (3 critics idled without delivering; the
  subagent `Write` tool is policy-blocked, so "write your own report" also failed silently). Only
  synchronous `Agent` calls worked. Cost ~40 min. → backlog.

**Changed this entry:** `_common.md` (§2 continuum `G vs R` test + the `R−B`-invariant correction to
the "SCNR bleaches warm objects" myth; §3 clamp acceptance test + worst-case 1:1 render rule; the
0.3-0.5 cap marked CONTESTED); `osc-rgb.md` (step 10 galaxy-SCNR correction, step 11 clamp
acceptance, step 10 saturation-floor note, **new §10b DarkStructureEnhance**);
`process-master` skill (continuum SCNR discriminator + anti-bleach correction, SCNR **skip-bias**
warning, clamp-verification rule, worst-case 1:1 render rule); backlog **#27-#32**; research
questions **+3**.

**OSC-RGB pipeline state after R11:** the linear spine is now **solid on a galaxy target too**
(first non-nebula OSC-RGB run; SPCC white-ref "Average Spiral Galaxy" + bare-vs-UVIRcut curve choice
validated by physical plausibility, warm core / blue arms / rust lanes). The new failure class is
**colour-gate reasoning on continuum sources**: the `gex` gate silently inverts meaning between
emission fields (where high G is a cast) and stellar/galaxy fields (where high G is *also* a cast but
the inequality can't tell you, and warm colour trips it too). Both R11 colour errors were reasoning
failures against knowledge already in the KB, not missing research. Remaining open axis is unchanged
and now has a galaxy datapoint: **the nonlinear tone objective** (band too bright for galaxies,
highlight compression, saturation floor).

**R11 v2 rework (2026-07-27), same session, user-directed. `result-tests/M31/` now ships v2.**
The linear half was untouched; the nonlinear half was redone against the feedback:
- **`SCNR` green, AverageNeutral, amount 1.0** on the starless (the v1 miss). M110's `G−R`
  **+0.010 → −0.011**, all regions to `gexRel ≈ 0`.
- **Tone**: mode **0.2055 → 0.1725**, faint-arm/sky ratio **1.93 → 2.47**, p01..p90 span
  **0.227 → 0.294**. ⚠️ **Below the 0.20-0.25 band and its 0.18 gate, deliberately and
  user-directed**, and the v2 blind critic *independently* both agreed the render is not crushed
  (0.0% of pixels below 0.10) and flagged the band as "imported from nebula runs, may be
  miscalibrated for large-galaxy fields". Strongest evidence yet for the galaxy-tone research Q.
- **Saturation**: rather than guess "slightly more", the **user's own image was measured as the taste
  reference** and matched, bulge 0.1006 vs their 0.1022, dust 0.313 vs 0.323, arms 0.199 vs 0.201.
  Worth keeping as a technique: when the user supplies their own version, measure it, don't estimate.
- **DarkStructureEnhance x2 (median 0.70, 0.75)**, run headless by eval'ing the real script's
  `doMask`/`doDark`. ✅ **Validated**: lanes visibly deeper, gate reported no lane-edge ringing.
  Two lessons now in `osc-rgb.md` §10b: a single default pass is nearly invisible, and the
  **region-average metric lies** (−1.2% average vs ~−21% at the lane cores, because the mask peaks
  at 0.49 and is ~0 elsewhere) → judge on a 1:1 before/after crop.
- **Star invert-SCNR 0.3 → 1.0**: residual deficit **52.7% → 7.4%**, worst case **85.6% → 28.7%**,
  landing on the *same* worst-case value the user's own second pass reached. **Amount 1.0 is now the
  documented default** (user: "in most cases ... especially for stars, I believe 1 is the right
  value"); the 0.3-0.5 "broadband cap" is demoted to a deliberate light-touch option. The R10-vs-R11
  disagreement is thereby resolved **in favour of 1.0**, and the research question narrows to "does
  full strength measurably desaturate the reddest stars, and if so how much".
- **Core HDR: deliberately NOT applied.** User said "if needed" and their own version has no HDR
  step; HDRMT on a galaxy bulge is a known over-processing trap. Recorded as a non-action.
- **Final gate re-run on v2 by a fourth blind critic: `pass`, artifacts 3 → 4**, and it
  independently re-confirmed "no dark rings" (third gate to do so, closing the v1 post-linear
  finding) and no lane-edge ringing from DSE.
- New wart: **DSE-via-eval records as `Script` with an empty `filePath`**, so it does not survive
  into an exported `.xpsm`; with the masked saturation steps that makes `replay.js` the only
  faithful reproducer. Folded into backlog #32.

**R11 v3 rework (2026-07-27), second user pass. `result-tests/M31/` ships v3.**
Requests: one more DSE pass, and more background/galaxy contrast ("the background and galaxy are too
close to each other"). Diagnosed numerically first: **outer halo 0.2163 vs sky 0.161, only 0.055
apart**, while p50 0.192 / p75 0.275 confirmed the halo fills the frame → the fix had to be a *local*
slope increase at the sky/halo boundary, not a global darkening.
- **DSE pass 3** (0.70/0.75/0.75). Dust lane 0.4031 → 0.3954, sky untouched.
- **Separation curve** with the kick just ABOVE the sky (0.165→0.215, slope ~1.86) so the sky's own
  noise is not stretched: **halo−sky 0.0557 → 0.0918 (+65%)**, **faint-arm/sky 2.47 → 3.19**, min
  luminance 0.0049. Mode 0.1715 → **0.1385**, i.e. now far below the playbook band, user-directed
  across two rounds, and **faint survival went UP**, which is the check that matters.
- ⛔ **NEW GENERAL TRAP, now in `_common.md` §5: a LUMINANCE curve with slope > 1 changes SATURATION
  in both directions.** The separation curve amplified channel differences in the sky
  (**sky saturation 0.0250 → 0.0405**, more visible chroma noise) *and* compressed the object's
  relative chroma (**bulge 0.1006 → 0.0885**) at the same time. One S-curve through one mask cannot
  fix both → needed a **signal-masked boost + a sky-masked reduction**. Two more sub-traps recorded:
  (a) set a signal mask's threshold from the sky's **p99 (0.246 here), not its median (0.138)** - a
  0.21 threshold was quietly boosting background chroma; (b) a **masked local enhancement cannot be
  judged by a region mean** (DSE moved the dust-lane mean −1.2% while doing ~−21% at the lane cores,
  because its mask peaks at 0.49 and is ~0 elsewhere).
- **Technique worth keeping:** when the user hands over their own version, **measure it as the taste
  reference** instead of estimating "slightly more". v3 lands bulge 0.1060 / dust 0.3138 / arms
  0.1982 / sky 0.0205 against their 0.1022 / 0.3231 / 0.2013 / 0.0185.

**R11 v4-v8 (2026-07-27). ⛔ v3 was REJECTED by the user: "awful ... you killed the image".**
This is the run's most valuable stretch and it is **the project's FIRST GALAXY** - every nonlinear
rule in the KB up to here came from nebula-filling fields.

- ⛔ **The v3 grain, isolated by experiment** (each applied to the clean v4 starless, measured, undone):
  the **unmasked "separation" curve** took sky HF grain 1.31% → **2.26%**; a masked saturation with
  the bad mask: **no change**; **DarkStructureEnhance at 3 iterations: 0.00 change**, twice.
  → **DSE is INNOCENT** (I had blamed it; user was right). New rule in `_common.md` §5:
  `relative grain multiplier = local slope / (output level / input level)`. To darken a background
  without amplifying grain the local slope there must be ≈ its level ratio. v3: slope 1.86 vs ratio
  0.86 → 2.16x predicted, 2.2x measured. v4+ uses slope 0.76 vs ratio 0.69 and the sky came out
  **cleaner than v1** (HF 2.39% vs 3.79%) at a much darker background.
- ⛔ **MASK CONSTRUCTION was the user's actual complaint, and they were right.** My masks were
  `clip((mean(RGB)−k)/w)` on raw luminance with a hand-picked `k` that **landed inside the noisy
  sky** (0.21 vs a sky p99 of 0.246) - a mask that is literally a noise map. Worse, masks were used
  where they were not needed (saturation) and NOT used where they were (the galaxy/background
  separation, attempted with a global curve that inevitably stretched the sky).
  ✅ Correct construction now documented in `_common.md` §5, read from `EZ_Common.js`:
  lightness → `RangeSelection(fuzziness 0.1, smoothness 5, highRange = lightness median)`, applied
  **inverted**. **The smoothing is the load-bearing part.** Also: once the sky is compressed rather
  than stretched its chroma noise was only 0.0070, so a **global** saturation needed no mask at all.
- ⛔ **"Haze around the galaxy" = MISSING LOCAL CONTRAST, not excess glow [user-reported, verified].**
  First hypothesis (over-lifted diffuse halo) was **refuted by measurement**: the radial falloff from
  the core was nearly identical to the user's (x sky 1.60/1.15/1.06 vs 1.59/1.18/1.07). The real gap
  was local contrast (`|px − local median(15px)|` / level): disk 4.04 vs **4.72%**, dust 2.74 vs
  **3.13%**, bulge 0.34 vs **0.41%** *at a lower level*. → diagnose haze with a local-contrast
  metric; fix with HDR, never a tone curve.
- ✅ **EZ HDR is the galaxy tool, now replayable headless** (`EZProcessingSuite/EZ_HDR.js`, defaults
  `hdrLayers 5`, `hdrAmount 0.3`): clone → `HDRMultiscaleTransform(numberOfLayers=5)` (all else
  default) → blend `(1-0.3)*img + 0.3*hdr` **through the inverted background range mask** → repeat.
  User ran it **3x**, interleaved with small curves. ⚠️ **HDR compresses levels**: after 3 passes
  every region sat at ~**x0.81** of the user's reference while local contrast was already right -
  which is exactly why their chain alternates HDR → curve. One level-match curve (uniform **x1.24**,
  derived by measuring their image) closed all four regions to <1%.
- **v8 result vs the user's own reference:** sky 0.1288 / 0.1294, bulge 0.6841 / 0.6829, disk
  0.3616 / 0.3593, dust 0.4848 / 0.4895, local contrast 4.58 / 4.72%, **grain HF 3.27% vs their
  3.98%**, clipping 0% both. Chain: GHS → one S-curve → SCNR 1.0 → saturation → recombine →
  EZ HDR x3 → DSE x3 → user colour grade → level-match curve. **No hand-rolled masks anywhere.**
- ⛔⛔ **THE BIGGEST LESSON, and it took three rejections to see: THE PATH MATTERS, NOT JUST THE
  DESTINATION.** v8 matched the user's reference on essentially every global number - sky 0.1288 vs
  0.1294, bulge 0.6841 vs 0.6829, disk/dust within 1%, **tone-matched detail within 1.0-1.4%**, and a
  whole-image quantile map that was near-identity (max deviation 3.7%) - and the user still rejected
  it as flat, hazy, small-starred and hard-ringed. Four hypotheses were tested and **all refuted by
  measurement**: (a) over-lifted diffuse halo (radial profiles near-identical), (b) compressed
  highlights (my bright tail was actually *higher*), (c) HDR/DSE on star-bearing data (moving both to
  the starless made v9 *slightly worse*), (d) global tone mismatch (quantile map near-identity).
  **What actually differed was the PATH.** Read out of the user's history: every one of their K
  curves is a **4-point S-curve with ~10% deltas** (−0.028 / +0.080), **interleaved with EZ HDR**
  (curve → HDR → curve → curve → HDR → curve → HDR → DSE), with single-point `H` and CIE-`c` nudges
  for colour. Mine were **8-11 control points with local slopes to 1.86**, moving the background
  −38% in one step and re-lifting +24% in another. Same destination, and the aggressive path is what
  amplifies sky noise, hardens the BXT undershoot rings and flattens the disk's local relationships.
  → New playbook section `osc-rgb.md` **10b-2**, with the user's exact chain as the reference recipe.
  → **Corollary for the metrics**: the agent's whole measurement kit (levels, local contrast, detail
  spectrum, quantile map) said "within a few percent" while the user's eye said "you killed it"
  three times running. Per the project's own rule the user wins and **the metric is the thing to
  fix**; a "path aggressiveness" measure (max local slope per curve, number of control points,
  cumulative slope excursion) would have flagged every rejected version and passed the accepted one.
- ✅ **ROOT CAUSE FOUND, and it is one thing, not three** (user pushed back on "just copy the steps",
  correctly: *"if you simply follow x, y, z without reason and understanding it doesn't benefit"*).
  **A tone curve applies ONE slope to structure and detail at a given level, so compressing range
  compresses detail with it - and the compression is forced:** a curve lifting `m → m'` that must
  pass through `(1,1)` has average slope above the pivot `(1−m′)/(1−m)`, below 1 by construction.
  Agent's curve **0.744**, user's **0.852**. **`HDRMultiscaleTransform` separates by SCALE instead**,
  so it buys the same headroom detail-positively. Controlled test, same image, same large-scale
  range compression both ways: **HDR** 2.178 → 2.065 with detail **+4.4%**; **equivalent curve**
  2.178 → 2.093 with detail **−7.5%**. A 12-point swing.
  → This single mechanism explains every symptom the user reported: **stars 20-30% dim** (matched
  star-by-star, amplitude bins 0.12-0.50 at 0.70-0.74 - and a dim star has a smaller disc and a
  relatively deeper ring, so "smaller stars" and "worse ringing" are the SAME defect), and
  **faint-highlight detail at 0.569 of reference immediately after the S-curve**, before HDR/DSE ran.
  → ⚠️ **Prevent, do not repair:** two extra finer-layer HDR passes moved it only 0.732 → 0.737
  while raising disk noise 1.81% → 2.01%. Once a curve flattens detail, HDR cannot restore it.
  → Landed as a **reasoned gate** in `_common.md` §5 and `osc-rgb.md` 10b-2: compute
  `(1−m′)/(1−m)` before every curve, split if < ~0.85, take the lift from HDR, alternate.
  The user's 9-step chain is recorded as a *worked example of the rule*, explicitly not as a recipe.
- ⛔ **Process failure worth its own line: I overwrote `final.xisf` in place across v1→v3**, so when
  the user asked to go back to baseline the v1 result survived only as an in-memory view. Now
  `result-tests/M31/versions/` keeps every final + starless with a README of the measurements, and
  `final.*` merely mirrors the current one. **Never overwrite a delivered final.** → backlog.

### Run 12, 2026-07-27, OSC-RGB, M16 / Eagle Nebula (Esprit 100 / 555.7 mm, ASI2600MC Pro, no filters, 180 s subs)
**Outcome:** linear half **clean first time**; nonlinear half **failed four times** and had to be
rebuilt from the linear starless. v2 accepted by the user ("looks great now"). User verdict on the
first delivery: *"you did a pretty bad job. The linear part is good, but stretch and non linear
phase was really bad."* Deliverables in `result-tests/M16/`.

**Linear half, no changes needed.** Worth recording only because it worked: master already
WBPP-autocropped and plate-solved (no DynamicCrop/ImageSolver); MGC at `gradientScale 1024` **not**
the playbook's 256 (at 256 the generated model visibly contained M16 and ate ~11% of the nebula's
contrast over sky, caught by inspecting the model per `_common.md`); `-UVIRcut` curves chosen from
the data (raw medians R 0.0104 < G 0.0113 prove an IR cut is present) with SPFC redone to match so
flux scale and colour calibration share one passband assumption.

**Findings**
- ⛔ `[correctness]` **`background-work.md` Stage 2 destroyed real Hα.** Its gate is an **ABSOLUTE**
  `rex = R−(G+B)/2 < 0`, and the doc claims red is "preserved by construction". False on any field
  with a global cool bias: the red nebulosity is *also* below the midpoint. Measured: the gate fired
  on **99.6%** of the region at mean strength 0.85, taking structure `R/G` **1.602 → 1.053** in one
  step. Also `gate = 1.0` sets chroma to **exactly zero** (72.5% of one corner at R=G=B), and `w`
  alone cannot prevent that. → Landed: precondition (measure the `rex<0` fraction; >~80% means
  global cast, wrong tool), `strength ≤ 0.75` cap, and a spatial-chroma verification requirement.
- ⛔ `[correctness]` **Stacked shadow-compressing K curves invert colour.** `CurvesTransformation`
  **K** applies the same curve to R, G, B *individually*; the systematically-lower channel lands
  further down the compressive part of *each* curve. Two stacked tone curves drove the dark
  population to **R 0.043 / G 0.166 / B 0.176** (structure `R/G` 1.716 → 1.087). One curve was
  survivable, two were not. → Landed in `_common.md` §5: single CIE-`L` curve (restored R to 0.135
  and `R/G` to 1.361) or deliberate per-channel curves.
- ⛔ `[method]` **Gated saturation ops MULTIPLY.** 6-8 individually gentle boosts with overlapping
  luminance gates compounded to ~**x2.6**. Each verified in isolation, none cumulatively. → Landed
  in `_common.md` §5 + backlog #39.
- ⛔ `[quality/method]` **SCNR-green manufactured the purple.** `G' = min(G,(R+B)/2)` drives G to/below
  the R-B midpoint, which **IS** the magenta axis; the stacked saturation then amplified it.
  G-is-min on bright px: **42.8%** (v1) vs 20.8% (user reference) vs **15.2%** (v2, no SCNR on the
  starless). It also drove the background blue: on a `B>G>R` shadow population SCNR lowers G and
  leaves B, so blue dominates (my dark sky navy, the reference's warm brown). **User rule: SCNR only
  earns its place if it leaves the background neutral AND clean.** Stars layer at 1.0 is unaffected,
  the distinction is scope, not strength. → Landed as `osc-rgb.md` §10b-4.
- ⛔ `[method]` **I answered "was colour preserved?" from region MEDIANS, and was wrong twice.** The
  median of a region is the SKY; the nebulosity is structure inside it. A matched-luminance test I
  ran was correctly executed but proved only that my result beat a naive single-MTF stretch, **not**
  that colour survived relative to what was recoverable. The user's own processing was the correct
  benchmark and I should have compared against it immediately instead of defending the metric.
  → Landed in `_common.md` §5 (structure colour = bright-pop minus dark-pop, stars excluded) +
  backlog #37.
- ⭐ `[technique]` **PER-CHANNEL PERCENTILE MATCHING.** Given a reference, measure both per-channel
  percentile ladders and build one `CurvesTransformation` per channel mapping one onto the other.
  Tone, colour balance and saturation are all consequences of the per-channel distributions, so
  **one step fixes all three**. After this single step: p50 0.1704 vs 0.1704, mean sat 0.2627 vs
  0.2607, hue red 52.5% vs 49.5%, blue 0.8% vs 1.0%, five of six bands matched to ~1% on
  `[R/G, R/B, sat]`. → Landed as `osc-rgb.md` §10b-3. Numbers are target-specific; the method is not.
- ⭐ `[technique]` **HDR blend beats turning LHE up, second datapoint confirming R11's mechanism.**
  A gated LHE topped out at roughly HALF the reference local contrast, and raising `amount` is where
  artifacts begin. The user's EZ HDR blend at **0.4** closed it: core inner 1.60 → **2.47**
  (ref 2.21), pillars 1.77 → **2.49** (ref 2.52), dust 7.60 → **8.53** (ref 9.60), with the histogram
  peak unchanged at 0.1504 and mean saturation 0.2524. Independent confirmation of R11's
  `(1−m′)/(1−m)` reasoning from a nebula instead of a galaxy.
- ✅ `[correctness]` **The broadband invert-SCNR 0.3-0.5 cap is CLOSED, with a proof.** Measured at
  1.0: saturation rose on all ten reddest stars. Proof: clamping G toward `(R+B)/2` leaves G the
  MIDDLE channel, so `(max−min)/max` is invariant, the op moves hue only. Also: **run BOTH branches
  when both gates fire** - skipping the excess branch because its population was smaller (35.5% vs
  64.5%) shipped a **pure green star** (R 0.006 / G 0.501 / B 0.047, worst excess 34x the midpoint).
- `[correctness]` **Star bloat: raising the stretch is the WRONG fix, it does the opposite.** The MTF
  is concave, so it lifts faint wings far more than an already-saturated core (a linear 0.02 wing
  maps to 0.673 at a=4.2 but 0.407 at a=3.2). Normalized radial profile, same 40 stars: pre-SXT
  0.342/0.081/**0.019** at r=1/2/3 versus delivered 0.845/0.486/**0.219**, i.e. apparent radius
  1.9 px → 4.1 px. The stars were tight when SXT removed them; the disc is the stretch. Two halo
  remedies were tested and both rejected on measured cost (morphological: −36% of the star field;
  value-domain waist curve: −13% faint-star brightness for −6% halo). Real fix is upstream
  (`adjust_star_halos` before SXT, or shorter subs so cores are not saturated).
- `[tooling]` **`metrics.stars` was degenerate at EVERY phase**: null FWHM on the linear master (all
  brightest candidates saturated), nebula knots on the starless, misleading on the stars layer,
  `starCount 0` on the final. The star axis had no working metric anywhere in the run.
- `[tooling]` **Critic blindness breached by the harness** (task list naming tools reached two
  critics via system reminders). → backlog #40. Also: reports were initially written *inside* the
  pack directories, re-making the exact mistake R11 already fixed; moved to `critic/reports/`.

**Changed this entry:** `background-work.md` (Stage 2 preconditions + strength cap + spatial-chroma
verification); `_common.md` (§3 cap CLOSED with the invariance proof + run-both-branches rule; §5
structure-colour measurement, cumulative-saturation multiplication, no-stacked-K-curves);
`osc-rgb.md` (new §10b-3 percentile matching, new §10b-4 SCNR manufactures magenta); backlog
**#37-#41**; research questions **+2** (peak band overridden twice, DSE second datapoint), **−1**
(invert-SCNR cap resolved).

**Delivered v2 chain (four steps, no SCNR, nothing stacked):** GHS → one percentile-matched
per-channel `CurvesTransformation` → one gated LHE (r48, amount 0.8, gate L 0.42→0.62) → one
DarkStructureEnhance (median 0.68, on the starless) → recombine → EZ HDR blend 0.4 *(user)*.

**OSC-RGB pipeline state after R12:** the linear spine is now solid across nebula, galaxy and mosaic.
The failure class that remains is **the nonlinear half's colour handling**, and R12 showed it is not
a tuning problem but a *composition* problem: the damage came from stacking small "safe" operations
(a teal gate, two tone curves, six saturation boosts, an SCNR) each of which was defensible alone.
The countermeasure that worked was doing colour ONCE, measured against a reference.
