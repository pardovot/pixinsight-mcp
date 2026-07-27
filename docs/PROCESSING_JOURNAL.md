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

1. ~~**Robust long-process handling**~~ `[tooling, HIGH]`, **FIXED 2026-07-20.** Watcher
   re-entrancy + `EvaluateScript` completion-value corruption (JS wrapper now writes its own
   result file) + client malformed-result handling. Full story: `journal/resolved.md`.
2. ~~**Programmatic undo / snapshot**~~ `[tooling, HIGH]`, **DONE (2026-07-20), and the premise was
   wrong.** `canUndo=false` was a **misdiagnosis**: `canUndo` is not a property of `ImageWindow`
   (reads `undefined`). Scripted `executeOn` **does** accumulate an undoable process history, and
   `ImageWindow.undo()/redo()/go()` + `view.historyIndex`/`view.canGoBackward` all work from PJSR
   **and persist across separate bridge commands** (verified live). The undo stack is NOT GUI-owned.
   Shipped tools (`src/tools/session.ts`, delivered via `run_script` → **no module rebuild**):
   `get_history`, `undo`, `redo`, `snapshot` (hidden duplicate window), `restore` (undoable
   pixel-assign back). Correct revert signal is **`view.canGoBackward`**, never `canUndo`.
3. ~~**First-class measurement tools**~~ `[tooling, HIGH]`, **SHIPPED 2026-07-24, live-verified**:
   `get_noise` (MRS), `get_background_gradient`, `get_background_neutrality` (linear + poststretch),
   `get_star_metrics`. A measured stretch helper remains open (#8/#12). Details: `journal/resolved.md`.
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
12. **SetiAstro Statistical Stretch** `[tooling, HIGH]`, ✅ **PROVEN DRIVABLE HEADLESS** (eval the
    real script's worker funcs; `targetMedian` is the bg-brightness dial; also in memory). Still open:
    adopt as default nebula stretch engine + a `statistical_stretch` helper. Details: `journal/resolved.md`.
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
14. **Session-replication artifact** `[tooling, MED]`, ✅ **SOLVED 2026-07-24, user-verified.**
    `.xpsm` is plain XML, writable directly (needs the `<icon>` element); `export_container` MCP tool
    built + verified; `replay.js` = proven empty→final reproducer, capture incrementally. Future
    `export_session` can template it. Details: `journal/resolved.md` + memory `pixinsight-xpsm-and-replay`.
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
22. ~~**`save_image` compression / `render_view` quality**~~ `[tooling, HIGH]`, ✅ **DONE 2026-07-26.**
    `save_image` takes `compression` (default `zlib+sh`, −26%); `render_view` quality default 100. The
    session-sticky-hints and `FileInfo(path).size` findings live in the skill's file-writing rules.
    Details: `journal/resolved.md`.
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
    → **(b) ADOPTED 2026-07-27, user-agreed:** post-stretch gate now conditional in the skill; sync-only
    gating + reports-outside-packs + task-subject scrub also encoded there (covers #30's report placement,
    #33's workaround, #40b). **(d) dropped 2026-07-27, user decision:** sessions usually run Opus 5 already
    and the critic should never run on a weaker model than the session; the user picks the model per session.
    Still open here: (a) invariants-first, (c) target card.
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
    `get_structure_color`; verified to catch the R12 inversion (`RoverG` 2.02 → 1.41).
    Details: `journal/resolved.md`.
38. ~~**Spatial chroma check**~~ `[tooling, HIGH, R12]` **DELIVERED 2026-07-27**, folded into
    `get_structure_color.spatialChroma` (per-tile saturation + exactly-achromatic fraction).
    Details: `journal/resolved.md`.
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

**RESOLVED 2026-07-21** (deep-research `wf_9cb980de`, 108 agents): stretch → GHS
(measurement-derived, iterative, separate linear black point); neutrality = linear pre-stretch on a
true background sample; stars = never STF-auto, real transfer + screen recombine; SCNR conditional,
not default. Landed in `osc-hoo.md` steps 10-12. Details: `journal/resolved.md`.

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
- ~~**Star stretch method**~~ ✅ **RESOLVED** (R4 research + R5 corrections): single MTF
  (`(K*$T)/((K-1)*$T+1)`, K=3^a) + mandatory ColorSaturation; amount from star-PIXEL median,
  T≈0.35-0.45; verify 1:1. Baked into `osc-hoo.md` step 12 + skill. Details: `journal/resolved.md`.
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
- **MOSAIC playbook** ✅ **WRITTEN 2026-07-25 → `docs/workflows/mosaic.md`** (cross-cutting STAGE,
  not a category; user-driven structure decision). Remaining narrow open items live in `mosaic.md`'s
  Contested list. Lesson `[method]`: when a run does mid-run research, the retro's job is to CAPTURE
  it, not re-queue it. Details: `journal/resolved.md`.
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
- ✅ **SETTLED (R9): SCNR protection method matters far more than amount.** Always
  AverageNeutral/MaximumNeutral (self-gating clip), never the mask methods (scale green everywhere,
  magenta cast); placement linear-vs-post-stretch is minor; modern PI honours Amount. Baked into
  `osc-rgb.md` step 10 + skill. Details: `journal/resolved.md`.

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

- ✅ **RESOLVED by R12: the broadband invert-SCNR cap** (amount 1.0 cannot desaturate, proof:
  G stays the middle channel → `(max−min)/max` invariant; landed `_common.md` §3).
- ✅ **RESOLVED by the user, R12: the 0.20-0.25 peak band is a WAYPOINT, not an acceptance gate**;
  gate faint-signal survival directly; acceptance = data + visual comparison together (landed in the
  skill). Details for both: `journal/resolved.md`.
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

## Run log, index

Full entries live in `docs/journal/R<nn>.md`, one file per run. A new run = a new file plus a
row here. Read a run file only when its story is relevant; do not read them all.

| Run | Date | Category | Target | One-line outcome |
|---|---|---|---|---|
| [R1](journal/R01.md) | 2026-07-20 | OSC-HOO | NGC 7000/Pelican | complete but poor; linear solid, stretch/color failed |
| [R2](journal/R02.md) | 2026-07-21 | OSC-HOO | NGC 7000/Pelican | linear clean; nonlinear still poor; SCNR@100% cast |
| [R3](journal/R03.md) | 2026-07-21 | OSC-HOO | NGC 7000/Pelican | rewritten steps 10-12, "pretty decent"; dim stretch, combine artifacts |
| [R4](journal/R04.md) | 2026-07-21 | OSC-HOO | NGC 7000/Pelican | first fully autonomous; native GHS; GHS star-wash diagnosed |
| [R5](journal/R05.md) | 2026-07-21 | OSC-HOO | NAN/Pelican | star stretch finally right (star-pixel median, T 0.35-0.45); milky stretch |
| [R6](journal/R06.md) | 2026-07-21 | OSC-HOO | NAN/Pelican | self-critique loop converged but overshot dark; faint nebula vanished |
| [R7](journal/R07.md) | 2026-07-22 | OSC-HOO | North Sadr/IC 1318 | SPCC-NB deadlock -> broadband; background-work method validated |
| [R8](journal/R08.md) | 2026-07-23 | OSC-RGB | Rho Oph Panel 1 | first RGB run, good first pass; MGC southern decline; star-color rule born |
| [R9](journal/R09.md) | 2026-07-25 | OSC-RGB mosaic | Rho Oph P1+P2 | first mosaic; feather beat GMM; star-colour gate corrected; mono-JPEG trap |
| [R10](journal/R10.md) | 2026-07-26 | mono-LRGB | Barnard 150 | first mono; redundant-gradient red blob; L-flatness gate; critic crop misfire |
| [R11](journal/R11.md) | 2026-07-26/27 | OSC-RGB | M31 | first galaxy; SCNR skip-bias; v1-v8 "path matters" lesson; curve-slope gate |
| [R12](journal/R12.md) | 2026-07-27 | OSC-RGB | M16 | nonlinear failed 4x then v2 accepted; colour-in-one-measured-step doctrine |
