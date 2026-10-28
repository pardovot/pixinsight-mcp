# ⚠️ READ THIS FIRST

`github.com/pardovot/pixinsight-mcp`, npm `@pardovot/pixinsight-mcp`. Independent project; grew
out of aescaffre/pixinsight-mcp, see "Origins" at the bottom. **Any doc that describes a macOS/ES5
runtime or a Node `run-pipeline` driving PixInsight is describing the original project, not this
one, treat it as stale.**

## 🖼️ PROCESSING AN IMAGE? Everything below this section is irrelevant.
The rest of this file is about BUILDING the tooling (MCP server, C++ module, signing). A
processing run needs exactly three things, read `facts.md` + the class slice in ONE parallel call:
- `.claude/skills/process-v2/SKILL.md`, the run driver (invoke `/process-v2`)
- `docs/facts.md`, verified tool traps
- `npm run library -- --class <class>`, the target class's reference profiles + gate status.
  ⛔ **Never read `references/library.json` whole**: thresholds are PER CLASS, a run needs only its
  own, and the file grows ~1.5 KB per entry.

Do NOT go exploring: not the README, not `docs/architecture.md`, not old journals (v1, RETIRED
2026-08-11, reachable only via the `archive/main-2026-08` tag, its architecture produced bad
training, do not mine it for numbers), not the recipe source. `recipes/*.js` are opaque executables whose
JSON report is the contract. Smoke test: `npm run test:recipe`. Watcher check:
`node scripts/ping-watcher.mjs`.

## ⛔ FUNDAMENTAL: CROSS-PLATFORM BY DEFAULT
**Every new script, path, and default must be written cross-platform from the start.** This is a
baseline requirement, not a later "port" and not a nice-to-have.
- **Node, not shell.** Node is already a hard dependency (MCP server + installer scripts). New
  tooling goes in `.mjs`, exposed via `npm run` scripts. Do NOT add `.bat`/`.sh`, there are
  none left, and a per-OS shim just recreates the asymmetry (Windows gets a shortcut, others don't).
- **Derive paths, never hardcode them**, `process.env.ProgramFiles`, `os.homedir()`,
  `path.join()`, per-platform candidate probing. No literal `C:\...` or `/Applications/...`
  outside a per-platform fallback branch.
- **Windows-only is a fact about testing, not about design.** "I can't test macOS/Linux" is never
  a reason to write Windows-only code. Write all three branches; mark which are verified.
- Genuinely platform-bound pieces (MSVC vs g++ for the PCL build) get **per-platform branches in
  one cross-platform script**, not separate per-OS scripts.
- Never delete another platform's instructions/commands to "reflect reality", mark them
  unverified instead. **Unverified ≠ unsupported.**

## Environment
- Dev machine: **Windows 11**, stock PixInsight install. (Machine-specific paths must never be hardcoded, see the cross-platform rule above.)
- **Linux verified 2026-08-11** (Ubuntu 24.04, PixInsight in `/opt`): PCL + module build from
  source, 78/78 tests, path derivation, sign + install, bridge round trip. Two gotchas found there: PixInsight's
  bundled makefiles compile **in-tree**, so a root-owned install cannot be built in place
  (`build-pcl.mjs` mirrors the source to `$PCL_BUILD_OUT/src` first, and CI missed it because its
  `PI_ROOT` is a writable clone), and `bin/PixInsight` is not launchable, the launcher
  `bin/PixInsight.sh` is. Setup per platform: `docs/dev-setup.md`.
- **macOS verified 2026-08-11** (Apple Silicon M1, macOS 15.7, stock `/Applications/PixInsight`):
  78/78 tests, path derivation, both PCL slices + the universal module built from source, signed,
  installed, bridge round trip. The **arm64** slice is the one that loaded. x86_64 is built and
  lipo'd but has never been executed. Two gotchas found there: the module directory is the install root's top-level `MacOS/`, **not**
  `PixInsight.app/Contents/MacOS/` (the bundle holds only the core executables, while `include/`, `src/`
  and a `bin/` of stock modules sit beside it), and PixInsight's generated macOS makefiles hardcode
  `-isysroot` to the **full Xcode** SDK, so a Command Line Tools install cannot compile PCL until
  `build-pcl.mjs` retargets it via `xcrun`.
- **PixInsight 1.9.4 "Lockhart" → V8 engine, NOT ECMAScript 5.** The original project's "ES5 only" rule does not apply here; the watcher was V8-ported (`#engine v8`, ES6 `class ... extends`, `CoreApplication.processEvents`). V8 port credit: Andre Couto (@4ndr3c0ut0).
- Bridge (unchanged): `~/.pixinsight-mcp/bridge/{commands,results}`, command `<id>.json` in, result `<id>.json` out.

## Architecture, three delivery channels
1. **MCP server** (npm): `claude mcp add pixinsight -- npx -y @pardovot/pixinsight-mcp`. TypeScript in `src/`, builds to `build/`.
2. **PixInsight update repo** (`pi-repo/`): users add one URL; PixInsight auto-installs the **native module** (`type="module"`, into `bin/`, on macOS into the install root's top-level `MacOS/`, beside the app bundle rather than inside it, and as ONE universal `arch="all"` binary, the format has no arm64 token) straight from Resources > Updates, no source build. Rebuild with `npm run repo:build` (packages `module/build/MCPWatcher-pxm.*` per platform, reproducible pure-Node zip, generates `updates.xri`). Not currently published, there is no release workflow. Repackaged from the JS watcher to the module 2026-07-22.
   - Signing: PixInsight's own signer (`--sign-module-file`, `--sign-xml-file`) with your `.xssk`.
3. **Native C++ module** (`module/`), **this is the runtime.**

## The native module is why this project exists
**PJSR is single-threaded: a running script holds the main thread, so the blocking JS watcher froze PixInsight completely (verified, a background `Timer` does NOT survive the script returning).** The C++ module (`MCPWatcher-pxm.dll`) hosts a **`pcl::Timer` on PixInsight's own event loop**, so polling happens while **PixInsight stays fully interactive**, you can pan/zoom/run processes and review Claude's work live. Verified working end-to-end.
- It **delegates every bridge command to the embedded JS handlers** (`module/src/BridgeHandlersJS.h`, generated by `module/gen-handlers.mjs` from `pjsr/pixinsight-mcp-watcher.js`) via `MetaModule::EvaluateScript` on the root thread. So handler logic lives in ONE place (the JS), C++ is a thin non-blocking shell.
- Build: `node module/build-pcl.mjs` (once) → `node module/build.mjs` → sign with PixInsight → `node module/install.mjs` **as admin/root** (close PixInsight first). Version in `module/src/Version.h`, shown in the dialog; **auto-bumped by `build.mjs`** (`module/version.mjs`): minor when `HANDLERS_REVISION` grew, patch when module sources changed, major by hand-editing `Version.h` (any manual version ahead of the lock is adopted). Lock: `module/version.lock.json`, commit it together with `Version.h`.
- `build.mjs` regenerates `BridgeHandlersJS.h` automatically; `install.mjs` installs the module **+** `.xsgn` and refuses a signature older than the DLL.
- Hard-won gotchas: do **not** construct Qt-backed objects (Timer) at module-install time (crashes `InitializePixInsightModule`), allocate lazily on Start; `Version()` must use the `PCL_MODULE_VERSION` macro; MSVC caps string literals ~16 KB so the embedded JS is emitted as chunked raw literals.

## ⛔ THE TOOL DESIGN DECISION, do not regress
**Use the GENERIC process runner. NEVER add a per-process MCP tool.**
- **`run_process(processId, viewId?, settings?)`**, runs ANY PixInsight process by class name (`BlurXTerminator`, `AutomaticBackgroundExtractor`, `PixelMath`, anything).
- **`get_process_parameters(processId)`**, introspects that process's settable params + current defaults.
- Rationale: every PixInsight process is `new X; set params; executeOn(view)`. One generic tool covers all of them with zero per-process maintenance. Adding `run_bxt`-style tools is the **anti-pattern we deliberately moved past**.
- The per-process tools (`run_bxt`, `run_nxt`, `run_sxt`, `sharpen`, `denoise`, `stretch_image`, `remove_gradient`, …) were **legacy convenience wrappers and were removed 2026-07-22** (along with `search_processing_recommendations`). Don't re-add them. `run_script` remains the raw PJSR escape hatch.
- `run_pixelmath` (the last surviving per-process MCP tool, with a restricted parameter set: no `symbols`/`rescale`/…) was **removed as an MCP tool 2026-07-26**; use `run_process("PixelMath")`. The **bridge verb + handler remain** for direct bridge callers (public contract).

## ⛔ WHERE LOGIC LIVES, and never let build cost decide it
Everything that runs inside PixInsight lives in the embedded handler section
(`pjsr/pixinsight-mcp-watcher.js` → `BridgeHandlersJS.h`): the primitives (`open_image`,
`save_image`, `close_image`, `run_process`, `export_container`, ...) and the measurement and
render verbs (`get_noise`, `get_star_metrics`, `render_view`, ...). The MCP server sends a verb
and its parameters as data, never PJSR source. `run_script` exists only in the standalone JS
watcher, outside the handler section.

| Home | For | Cost to change |
|---|---|---|
| **Embedded JS handler** | Everything that runs in PixInsight | `module:build` → sign with PixInsight → close PI → `module:install` (admin) → reopen → restart MCP |
| **TS** (`src/tools/*.ts`) | Orchestration over verbs (`render_critic_pack`), input validation | `npm run build` + MCP restart |

⛔ **"I'll do it TS-side to avoid the rebuild-sign-admin-install cycle" is not an architecture
argument.** It is a cost argument, and it produces the actual failure mode: **two implementations of
the same verb that drift**, with the handler left silently wrong. Real example (2026-07-26):
`save_image` was reimplemented TS-side to add compression, leaving `handleSaveImage` calling the
5-arg `saveAs` with no hints, i.e. a known-wrong primitive kept in the tree because fixing it was
inconvenient. Corrected by putting it back in the handler.

**Smells that you are making a cost call and calling it architecture:**
- You are about to leave a handler you *know* is wrong, and describe it as "a trap for direct callers".
- The reason a parameter is missing is that it was never plumbed, not that the logic is evolving.

**The rebuild cycle is routine, budget it.** It is the same loop `get_full_history` and
`export_container` used. Batch several handler changes into one cycle rather than avoiding it.

**If a handler change must roll out in stages, make the gap FAIL LOUDLY.** Have the handler echo a
capability marker in its `outputs` and have the MCP server check it, so an older installed module
reports "your module predates this" instead of silently doing the old thing. `save_image` returns
`outputs.hints` for exactly this.

**Systemic skew guards (added 2026-07-26):**
- Every success result echoes `outputs.handlersRev` (`HANDLERS_REVISION` in the watcher JS;
  `EXPECTED_HANDLERS_REV` in `src/bridge/client.ts` must match). **Bump BOTH on any handler
  change.** A module OLDER than the server hard-errors every command with reinstall
  instructions (a rebuild is ~1 min; fail loudly beats silent stale primitives); a NEWER
  module warns once, appended to the result the agent reads. Per-feature markers (like
  `hints`) remain for gaps that must stay hard errors across releases.
- `scripts/check-handler-drift.mjs` (runs in `npm run build`) fails when a TS tool sends a
  bridge parameter the handler never reads (the save_image-compression drift class), when the
  two revision constants disagree, and, via the hash lock `scripts/handlers-rev.lock.json`,
  when the handler section changes without a rev bump (a forgotten bump would silently
  disarm the detector). The lock auto-updates on a bump; commit it.

---

## Origins

Grew out of [aescaffre/pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp); independent
codebase since. **Kept:** the file-bridge contract, the PJSR handler bodies the V8 watcher descends
from, the MCP server skeleton in `src/`.

The original's Node "giga-run" pipeline (`agents/`, `scripts/run-pipeline.mjs`, `editor/`) and
sample configs are **not part of this codebase**, never executed here, documented a different
product. (`agents/ops/` lingered as a measurement/quality-gate harvest target, then was removed
2026-07-22, M2 measurement tools were built fresh.) Recover from git history if ever needed.

Credits: **Alain Escaffre** (originator), **Andre Couto** (V8 port). MIT © both plus pardovot.
