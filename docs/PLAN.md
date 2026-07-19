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

**Dead weight (delete or archive):** `agents/`, `scripts/` pipeline, `editor/`, target configs (`M81_LRGB_agentic.json`, `NGC891_LRGB_v9.json`, …), `equipment.json`, `toto.txt`, `reddit-post.md`, `TODO-v8-port.md` (V8 port done).

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
