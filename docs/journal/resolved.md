# Resolved journal entries, archive

Verbatim moves of RESOLVED/DONE tooling-backlog and research entries from
`docs/PROCESSING_JOURNAL.md` (stubs with pointers remain there, numbering unchanged).
Append-only; consult when a stub's one-liner is not enough.

---

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

---

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

---

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

---

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

---

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

---

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

---

38. ~~**Spatial chroma check**~~ `[tooling, HIGH, R12]` **DELIVERED 2026-07-27**, folded into
    `get_structure_color.spatialChroma` (per-tile saturation map + exactly-achromatic fraction);
    it shares the same stride-grid pass. Verified: `pctExactlyAchromatic` 0% -> 1.41% on the
    re-broken image, `minTileSaturation` 0.0998 -> 0.0500. Original entry:, `bgChroma` is magnitude-only and scored a
    damaged image as *better than reference* (0.0252 vs a 0.05 bar) while **72.5% of one corner was
    at exactly R=G=B**. Need per-tile/per-corner saturation and the fraction of exactly-achromatic
    pixels. Also needed to catch cast DIRECTION, which `bgChroma` cannot express. Blocking a real
    defect class: any operation that pulls pixels toward luminance can silently zero chroma.

---

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

---

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

---

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

---

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
