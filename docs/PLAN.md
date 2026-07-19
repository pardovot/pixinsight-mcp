# Project plan — fixes, debt, and the road to automation

Status: post-MVP. MCP server + native module + workflow knowledge base all work.
This covers what's broken, what's owed, and what's needed for autonomous processing.

Findings marked **[verified]** were checked against the repo, not recalled.

> Note: `docs/ROADMAP.md` is **upstream's** pre-implementation plan and is **stale + contradictory**
> — its Phase 5 lists per-process tools (`remove_gradient`, `denoise`, `sharpen`, …), the exact
> anti-pattern this project abandoned in favour of generic `run_process`. See CLAUDE.md.

---

## 1. Identity: is this still a fork?

### What the data says
- Divergence from upstream base `db5b1e2`: **45 files, ~4,759 insertions** [verified].
- **Entirely ours:** `module/` (3.7 MB — upstream has *no* native module), `docs/workflows/` (1.1 MB knowledge base), `pi-repo/` (signed update repo), the generic `run_process`/`get_process_parameters` design, Windows platform layer, npm packaging + installer/launcher scripts.
- **Genuinely upstream:** the file-bridge contract (`~/.pixinsight-mcp/bridge`, `<id>.json` in/out), the PJSR handler bodies (our `BridgeHandlersJS.h` is *generated from* the watcher, which descends from upstream), MCP server skeleton in `src/`.
- **Upstream code we carry but never execute:** `agents/` (969 KB) + `scripts/` giga-run pipeline (456 KB) + `editor/` (64 KB) ≈ **1.5 MB dead weight** [verified]. We Windows-ported 5 of those files, then never used them — our architecture is MCP + module, not the Node pipeline.

### Honest read
Architecturally this is **a different product** sharing a protocol and some handler code.
Upstream = *a Node pipeline driving PixInsight via a blocking script*.
Ours = *a non-blocking PixInsight module + generic-tool MCP server + research-backed knowledge base*.
The fork relationship is now mostly **git ancestry and attribution**, not shared development.

### Options
| | Pros | Cons |
|---|---|---|
| **A. Stay a fork, quarantine upstream code** | keeps PR path + attribution obvious; least work | identity stays confusing; dead weight lingers |
| **B. Detach into a standalone project** *(recommended)* | honest identity; drop the pipeline; clean README/scope | must carry MIT + credits manually; loses easy upstream PR path |
| **C. Split repos** (module+MCP standalone; fork keeps watcher/bridge lineage) | cleanest separation | two repos; overkill now |

**Recommendation: B**, executed conservatively — delete the unused pipeline, keep the bridge contract + handler lineage, preserve **MIT + credits (Alain Escaffre; Andre Couto for the V8 port)** prominently. Do it *after* the P0 fixes.

---

## 2. Fixes (confirmed bugs)

### P0 — blocking
1. **`install.bat` doesn't install the signature.** [verified] `module/build/` holds `MCPWatcher-pxm.xsgn` (708 B) but `install.bat` copies only the `.dll`. With `AllowUnsignedModuleInstallation=false`, PixInsight then rejects the module. → **Copy `.dll` + `.xsgn` together.**
2. **`build.bat` never regenerates the embedded handlers.** [verified — `grep -c gen-handlers module/build.bat` = 0] Editing `pjsr/pixinsight-mcp-watcher.js` does **not** update `module/src/BridgeHandlersJS.h`, so the module silently builds with **stale handler logic**. Correctness bug, not a nuisance. → **Run `gen-handlers.sh` as a build step** (ideally a CMake custom command with a real dependency on the JS file).

### P1 — correctness / ergonomics
3. **`build-pcl.bat` short-circuits.** [verified — line 48: `if exist "%OUTDIR%\PCL-pxi.lib" goto :ok`] If PCL source or flags change it skips the rebuild entirely. → Add `--force`/timestamp check; document that PCL rarely changes.
4. **No signature-staleness guard.** Nothing stops installing an `.xsgn` older than the `.dll` (rebuild-after-signing ⇒ signature mismatch ⇒ confusing rejection). → **Fail loudly if `.dll` is newer than `.xsgn`.**
5. **Signing is wholly manual + undocumented in-repo.** The private key can't be automated, but the flow can: build → sign (exact steps) → verify → install. → Add a `sign-module` helper + document in `module/README.md`.

### Target build flow
- `build.bat` = regenerate handlers → rebuild PCL if stale → compile → **warn "unsigned — sign before install"**.
- `install.bat` = verify `.dll` + `.xsgn` exist **and** `.xsgn` ≥ `.dll` → copy both → confirm.

---

## 3. Debt / cleanup

### ⚠️ Correction: `agents/ops/` is a HARVEST target, not dead weight [verified]
Inspection shows `agents/ops/` already implements the automation layer §4 says is missing —
and it talks to **the same bridge** our MCP server uses (`agents/ops/bridge.mjs` →
`~/.pixinsight-mcp/bridge`), so it can be wrapped as MCP tools rather than rewritten:

| File | Contains | Serves |
|---|---|---|
| `quality-gates.mjs` (1,625 lines) | `checkStarQuality`, `checkRinging`, `checkSharpness`, `checkCoreBurning`, `scanBurntRegions`, `checkSaturation`, `checkTonalPresence`, `checkHighlightTexture`, `checkStarLayerIntegrity`, `checkBrightChroma` | **M4 verification gates** |
| `stats.mjs` | `getStats`, `measureUniformity` (gradient residual) | **M2 measurement** |
| `subject-metrics.mjs` | `measureSubjectDetail`, `locateSubjectROI` | **M2 measurement** |
| `gradient.mjs` | `runABE`, `runPerChannelABE`, `runGC`, `runSCNR` — **correctly configured** (the config whose absence caused our ABE no-op bug) | M3/M5 execution |
| `stretch.mjs` | `setiStretch`, GHS via PixelMath (`computeGHSCoefficients`, `buildGHSExpr`) | M3/M5 execution |
| `masks.mjs`, `preview.mjs`, `checkpoint.mjs` | masks, previews, checkpointing | M4 checkpoints |

**Keep and harvest these.** They are battle-tested on real data and represent the single
largest shortcut to M2/M4.

**Keep (ours / in use):** `scripts/ping-watcher.mjs` (our bridge round-trip test),
`scripts/shutdown-watcher.mjs`, `scripts/build-pi-repo.ps1`, `scripts/spcc-curves.mjs`
(SPCC filter curve data).

**Dead weight (delete or archive):** `agents/llm/` (the `claude -p` subprocess orchestration —
superseded: Claude now drives directly via MCP), `agents/critics/`, `agents/memory/`,
`scripts/run-pipeline.mjs` + the one-off `process-*`/`test-*`/`research-*`/`pi-tool` scripts,
`editor/`, target configs (`M81_LRGB_agentic.json`, `NGC891_LRGB_v9.json`, …), `equipment.json`,
`toto.txt`, `reddit-post.md`, `TODO-v8-port.md` (V8 port done).

*Reference-only before deletion:* `agents/llm/deterministic-prep.mjs` encodes the measure→decide→
configure linear sequence, and `agents/classifier.mjs` does target classification — both now
largely superseded by `docs/workflows/`, but worth a read before they go.

**Actively dangerous stale guidance:**
- **`docs/ROADMAP.md`** — upstream's plan; Phase 5 prescribes **per-process tools**, contradicting our generic-`run_process` decision. Demonstrably caused a regression in another session. → Delete or clearly mark stale.
- **`.claude/skills/pixinsight-pipeline/`** — still asserts **ECMAScript 5** + macOS paths. We run **V8 on Windows**; a session following this will write broken PJSR. → Correct or remove.
- **README.md** — describes the giga pipeline as the product. → Rewrite for this fork.
- *(CLAUDE.md already fixed + divided.)*

**Structural debt:**
- **Three code paths for the same handlers:** V8 watcher, legacy SpiderMonkey watcher, module's embedded copy. Module is the runtime — decide if the JS watchers stay a supported fallback.
- **Version drift:** npm (0.7.0) and module (`Version.h` 1.2.0) version independently with no coupling despite needing protocol compatibility.
- **Windows-only in practice:** `platform.mjs` is cross-platform, but the module build (MSVC) and all `.bat` scripts are Windows. → **Declare Windows-first officially** rather than implying otherwise.
- **No tests, no CI** — nothing catches a stale-handler build or a broken bridge round-trip.
- **`pi-repo` re-sign fragility:** any zip rebuild invalidates the signed `updates.xri`; ordering is manual and easy to get wrong.

---

## 4. The road to automation (the actual goal)

**Goal:** short, goal-driven prompt ("process this master — clean gradient, tighten stars, reduce noise") → agent selects, configures, executes, and *verifies* the pipeline.

**Have:** MCP + non-blocking module (drive + review live); generic `run_process`/`get_process_parameters`; measure→configure→verify methodology; 6 verified category playbooks.

**Missing — in dependency order:**
1. **A real end-to-end run.** We have **never** processed a master from open → finished image; only primitives and a 2-step mini-flow. **Biggest unknown — make it milestone 1.**
2. **Measurement tools as first-class MCP tools** — FWHM/PSF, background uniformity/gradient residual, noise/SNR, star count, clipping. Today the agent improvises via `get_image_statistics` + `run_script`; without these, "measure → configure" is aspirational.
3. **Acquisition-category detection** — pick the right playbook automatically (mono vs OSC, filters, NB vs broadband) from filenames/FITS headers/channel count.
4. **Playbook → execution mapping** — playbooks are prose; need a reliable path from "step 5: MGC with these rules" to concrete `run_process` calls. Likely a per-category *step list* carrying measurement inputs + a verification criterion per step.
5. **Enforced verification gates** — no-op detection, clipping, star-count collapse as *required* steps.
6. **Checkpoint/review protocol** — pause points for human inspection (works because the module is non-blocking).
7. **Short-prompt entry point** — a skill/command (e.g. `/process <master>`).

**Milestones**
- **M1** — one full agent-driven run on a real master (OSC-RGB or OSC-HOO, simplest), documented warts and all.
- **M2** — add the measurement tools M1 proves are needed.
- **M3** — category detection + per-category executable step lists.
- **M4** — verification gates + checkpoints.
- **M5** — `/process` entry point; iterate on real data.

---

## Suggested sequencing
1. **P0 fixes** — module is broken-to-install without #1, silently wrong without #2.
2. **P1 fixes** + kill the stale guidance (`ROADMAP.md`, `.claude/skills`) — cheap, prevents repeat regressions.
3. **M1 end-to-end run** — *before* big cleanup; highest-information action available.
4. **Cleanup + fork decision** — delete pipeline, rewrite README, decide detach.
5. **M2 → M5 automation build-out.**

Rationale for M1 before cleanup: an end-to-end run tells you what actually matters, making "what's dead vs needed" obvious rather than guessed.

---

## Decisions (settled)

1. **Fork/detach** — deferred until after the `agents/ops` harvest (harvest first; the remaining upstream surface is then small enough that detaching is trivial).
2. **`agents/`, `scripts/`, `editor/`** — **harvest `agents/ops/`** (see §3 correction); keep the 4 in-use scripts; delete/archive the rest.
3. **Cross-platform: yes, preferred.** Feasible — upstream already ships PCL makefiles for linux/macOS (`src/pcl/linux/g++`, `src/pcl/macosx/g++`), so the module can build there. Work: replace `.bat` scripts with cross-platform equivalents (node or `.sh`), add mac/linux paths to build/install, CI-build all three.
4. **JS watchers — deprecate.** The module is the runtime. Keep the V8 watcher only as a documented emergency fallback (or drop once the module install flow is fixed).
5. **Legacy SpiderMonkey watcher — drop** (`pjsr/pixinsight-mcp-watcher-legacy-sm.js`). User is on 1.9.4/V8; it also ships in the npm package for no reason.
6. **M1 target:** `D:\AP\FMA180 Pro\North America Pelican Clamshell\ATR3CMOS26000KPA\WBPP\master\masterLight_BIN-1_6224x4168_EXPOSURE-300.00s_FILTER-NoFilter_RGB_autocrop.xisf` — **OSC / HOO** (duoband). Playbook: `docs/workflows/osc-hoo.md`.
7. **Tests/CI — now.** Minimum worth having immediately:
   - bridge round-trip smoke test (`ping-watcher` as an assertion),
   - **stale-handler guard**: assert `BridgeHandlersJS.h` matches `gen-handlers.sh` output (kills P0-#2 permanently),
   - MCP server boot + `tools/list` snapshot,
   - module build in CI (once cross-platform).
8. **Versioning — protocol version, not lockstep.** Coupling npm and module versions is brittle (different channels, different cadences). Instead define a **bridge protocol version** emitted by the module and checked by the MCP server at first contact, failing loudly on mismatch ("update X"). Package versions stay independent; compatibility becomes explicit and self-diagnosing.

## Revised sequencing (supersedes the list above)
1. **P0 fixes** — install `.xsgn`; `build.bat` → run `gen-handlers.sh`.
2. **Kill stale guidance** — `ROADMAP.md` ✅ done; `.claude/skills` (ES5/macOS); README.
3. **M1 end-to-end run** on the OSC-HOO master — highest-information action.
4. **Harvest `agents/ops/`** into MCP measurement + gate tools (M2/M4 shortcut), guided by what M1 exposes.
5. **Cleanup + detach decision**; drop legacy watcher; deprecate JS watchers.
6. **Cross-platform + CI**; then M3/M5 automation build-out.
