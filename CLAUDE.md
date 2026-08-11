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
2. **PixInsight update repo** (`pi-repo/`): users add one URL; PixInsight auto-installs the **native module** (`type="module"`, into `bin/`, on macOS into the install root's top-level `MacOS/`, beside the app bundle rather than inside it, and as ONE universal `arch="all"` binary, the format has no arm64 token) straight from Resources > Updates, no source build. Rebuild with `npm run repo:build` (packages `module/build/MCPWatcher-pxm.*` per platform, reproducible pure-Node zip, generates `updates.xri`). **`updates.xri` is signed separately by `npm run repo:sign`; see the note below.** Repackaged from the JS watcher to the module 2026-07-22.
   - ✅ **CPD identity active (2026-08-10):** the signing identity is `OfirPardo`, a real Certified PixInsight Developer id that resolves by name, replacing the old local `0104952866723499` (which reported *"Unknown code signing identity"* and was trusted only on machines where this license is activated). Distribution signing is back on: `repo:build` packages each platform's `.xsgn`.
   - ⛔ **Signing needs NO PixInsight**, do not reintroduce it. `npm run module:sign` computes the signature directly in Node, so CI signs releases itself. PixInsight is used exactly once, to export the key (`module/export-signing-key.js`). The construction, how it was proven, and what is still unknown: **`docs/SIGNING.md`**. **`updates.xri` is signed too** (2026-08-10): its construction differs from a code file's, a canonical rendering of the root element rather than the file bytes, recovered from the core binary and implemented in `module/xml-canonical.mjs` (`npm run repo:sign`). ⚠️ The canonicaliser is the fragile part, not the crypto: PixInsight decodes and re-escapes entities, and escapes `'` as `&apos;` **in text but not in attributes**. Ten fixtures in `module/test-fixtures/xri/` hold it byte-identical to PixInsight; add a fixture before trusting any new XML construct.
3. **Native C++ module** (`module/`), **this is the runtime.**

## The native module is why this project exists
**PJSR is single-threaded: a running script holds the main thread, so the blocking JS watcher froze PixInsight completely (verified, a background `Timer` does NOT survive the script returning).** The C++ module (`MCPWatcher-pxm.dll`) hosts a **`pcl::Timer` on PixInsight's own event loop**, so polling happens while **PixInsight stays fully interactive**, you can pan/zoom/run processes and review Claude's work live. Verified working end-to-end.
- It **delegates every bridge command to the embedded JS handlers** (`module/src/BridgeHandlersJS.h`, generated by `module/gen-handlers.mjs` from `pjsr/pixinsight-mcp-watcher.js`) via `MetaModule::EvaluateScript` on the root thread. So handler logic lives in ONE place (the JS), C++ is a thin non-blocking shell.
- Build: `node module/build-pcl.mjs` (once) → `node module/build.mjs` → `node module/sign.mjs` → `node module/install.mjs` **as admin/root** (close PixInsight first). Version in `module/src/Version.h`, shown in the dialog; **auto-bumped by `build.mjs`** (`module/version.mjs`): minor when `HANDLERS_REVISION` grew, patch when module sources changed, major by hand-editing `Version.h` (any manual version ahead of the lock is adopted). Lock: `module/version.lock.json`, commit it together with `Version.h`.
- **Signing runs in Node, no PixInsight** (2026-08-10, replaces the `--sign-module-file` CLI round-trip): `preimage = SHA-512(fileBytes ‖ developerId ‖ timestamp ‖ entitlements.join("\n"))`, Ed25519 over it, key stored **expanded** so `node:crypto` cannot sign with it (`module/ed25519.mjs`). Proven by reproducing 10 PixInsight signatures byte for byte. Any platform's binary signs anywhere. **`docs/SIGNING.md`** is the reference; the old "cannot be done outside PixInsight" claim is retracted there.
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
There are two legitimate homes for tool logic. Pick by **what the thing is**, never by what is
cheaper to ship.

| Home | For | Cost to change |
|---|---|---|
| **Embedded JS handler** (`pjsr/pixinsight-mcp-watcher.js` → `BridgeHandlersJS.h`) | **Primitives**: the bridge protocol's own verbs. `open_image`, `save_image`, `close_image`, `run_process`, `run_script`, `export_container`. Stable, rarely change. | `module:build` → `module:sign` → close PI → `module:install` (admin) → reopen → restart MCP |
| **TS-generated PJSR** (`src/pjsr/*.ts` + `execPjsrJson`) | **Composites** built on those primitives that evolve with the knowledge base: the measurement tools, `render_view`, `render_critic_pack`. | `npm run build` + MCP restart |

**The test (all three must hold for the handler; any failure means TS-side):**
1. **Stability**: semantics do not evolve with the knowledge layer.
2. **Contract value**: useful to any bridge client, not just the MCP agent loop.
3. **Boundary fit**: benefits from validation/error semantics at the PixInsight edge.

(The old test, "does the bridge expose it as a command", was circular: the bridge exposes
whatever someone put there. Replaced 2026-07-26 after the placement audit.)

⛔ **"I'll do it TS-side to avoid the rebuild-sign-admin-install cycle" is not an architecture
argument.** It is a cost argument, and it produces the actual failure mode: **two implementations of
the same verb that drift**, with the handler left silently wrong. Real example (2026-07-26):
`save_image` was reimplemented TS-side to add compression, leaving `handleSaveImage` calling the
5-arg `saveAs` with no hints, i.e. a known-wrong primitive kept in the tree because fixing it was
inconvenient. Corrected by putting it back in the handler.

**Smells that you are making a cost call and calling it architecture:**
- You are about to leave a handler you *know* is wrong, and describe it as "a trap for direct callers".
- You justify placement by "there is precedent" without checking whether the precedent is a
  *composite* (legitimate) or a primitive that drifted (not).
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
