# PixInsight MCP — drive PixInsight from Claude, without freezing it

An **MCP server** that lets an AI assistant (Claude Code, Claude Desktop) operate
[PixInsight](https://pixinsight.com) directly — open masters, measure them, run any process,
and inspect the result — while **PixInsight stays fully interactive** so you can watch and
review the work live.

This is a fork of [aescaffre/pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp) that
diverged substantially: it adds a **native PixInsight module**, a **generic process runner**
instead of per-process tools, and a **research-backed workflow knowledge base**.
See [Relationship to upstream](#relationship-to-upstream).

**Status:** working and used for real processing. The autonomous end-to-end flow is still
being built — see [Roadmap](#roadmap).

---

## Why a native module

PJSR (PixInsight's scripting engine) is **single-threaded**. A running script holds the main
thread, so the original JS watcher — a `for(;;)` polling loop — froze the whole application
while it ran. You could not pan, zoom, or review anything. There is no way around this from a
script: a background `Timer` does not survive the script returning (verified).

A **compiled module** can. `MCPWatcher-pxm.dll` installs a `pcl::Timer` that fires on
PixInsight's **own event loop during idle** — the app is never "busy running a script".

- PixInsight stays **fully interactive** while the bridge polls.
- You can **review the agent's work at any time** — no stop/resume, no second instance.
- Human-in-the-loop checkpoints become practical: the agent pauses, you look, you continue.

The module is a **thin shell**: it delegates every bridge command to the embedded JS handlers
(generated from `pjsr/pixinsight-mcp-watcher.js`) via `MetaModule::EvaluateScript`. Handler
logic lives in **one** place — the JS — and C++ only provides the non-blocking timer.

---

## Architecture

```
  Claude (Claude Code / Desktop)
        │  MCP (stdio)
        ▼
  MCP server  ──  src/ (TypeScript → build/)
        │
        │  file-based bridge:  ~/.pixinsight-mcp/bridge/
        │    commands/<id>.json  in    results/<id>.json  out
        ▼
  MCPWatcher-pxm.dll  ──  pcl::Timer on PixInsight's event loop  (module/)
        │  MetaModule::EvaluateScript
        ▼
  Embedded JS handlers  ──  generated from pjsr/pixinsight-mcp-watcher.js
        ▼
  PixInsight  (stays interactive throughout)
```

There is no socket or HTTP API into PixInsight; the file bridge is the only mechanism.
Round-trip latency is roughly the poll interval (default 300 ms).

### Three delivery channels

1. **MCP server** (npm) — `@pardovot/pixinsight-mcp`
2. **Signed PixInsight update repo** (`pi-repo/`) — users add one URL; PixInsight auto-installs
   and auto-registers the watcher
3. **Native C++ module** (`module/`) — **the runtime**

---

## The tool design: one generic runner, not per-process tools

Every PixInsight process is `new X; set params; executeOn(view)`. So instead of a tool per
process, this fork exposes:

- **`run_process(processId, viewId?, settings?)`** — runs **any** process by class name
  (`BlurXTerminator`, `AutomaticBackgroundExtractor`, `PixelMath`, anything installed)
- **`get_process_parameters(processId)`** — introspects that process's settable parameters and
  current defaults
- **`run_script(...)`** — raw PJSR escape hatch

One generic pair covers every process with zero per-process maintenance. **Adding
`run_bxt`-style tools is the anti-pattern this fork deliberately moved past.** The legacy
per-process wrappers (`run_bxt`, `sharpen`, `stretch_image`, …) were removed 2026-07-22.

### Never run a process blind

The methodology is baked into the tool descriptions and
[`docs/PROCESSING_GUIDE.md`](docs/PROCESSING_GUIDE.md):

1. **`get_process_parameters` first** — reason about what the settings mean.
2. **Watch for no-op output defaults.** Canonical case: `AutomaticBackgroundExtractor` defaults
   to `targetCorrection=0` + `replaceTarget=false`, so it builds a background *model* and leaves
   your image **untouched**. To actually correct: `{ targetCorrection: 1, replaceTarget: true }`.
3. **Choose settings by measuring *this* image** (`get_image_statistics`, `run_script`) — not by
   copying fixed numbers.
4. **Execute, then re-measure.** Byte-identical statistics mean a no-op — stop and fix it; never
   build the next step on a no-op.

---

## Tools

14 tools. The ones that matter are in bold.

| Category | Tools |
|---|---|
| Generic execution | **`run_process`**, **`get_process_parameters`**, **`run_script`**, `run_pixelmath` |
| Image management | `list_open_images`, `open_image`, `save_image`, `close_image`, **`get_image_statistics`** |
| Session / history | `get_history`, `undo`, `redo`, `snapshot`, `restore` |

Authoritative definitions live in `src/tools/*.ts`. (`docs/mcp-tools.md` is upstream's
aspirational catalog and is marked stale.)

---

## Workflow knowledge base

`docs/workflows/` holds **per-acquisition-category playbooks** — how to process each kind of
data, with confidence / consensus / contested grading on every claim:

[`osc-hoo.md`](docs/workflows/osc-hoo.md) · [`osc-rgb.md`](docs/workflows/osc-rgb.md) ·
[`mono-rgb.md`](docs/workflows/mono-rgb.md) · [`mono-lrgb.md`](docs/workflows/mono-lrgb.md) ·
[`mono-halrgb.md`](docs/workflows/mono-halrgb.md) · [`mono-sho.md`](docs/workflows/mono-sho.md)

Deliberate conventions encoded there:

- **Starless / SXT is an optional branch, never a baseline step.**
- **Never fabricate numeric settings** — measure, configure, verify.
- **Newer ≠ better** — recency traps are flagged explicitly.

See [`docs/workflows/README.md`](docs/workflows/README.md) for the research method and
verification status.

---

## Requirements

- **OS**: cross-platform by design; Windows is the only platform it has been *run* on so far —
  see [Platform](#platform)
- **PixInsight 1.9.4 "Lockhart"** or later (V8 scripting engine)
- **Node.js** v18+ (v22 recommended)
- **Claude Code** or **Claude Desktop**
- Optional third-party process modules, if you want to use them: BlurXTerminator,
  NoiseXTerminator, StarXTerminator
- Calibrated master frames (WBPP-stacked XISF)

---

## Quick start

### 1. Add the MCP server

```bash
claude mcp add pixinsight -- npx -y @pardovot/pixinsight-mcp
```

### 2. Install the PixInsight-side watcher

**Signed update repository.** In PixInsight: `Resources > Updates > Manage Repositories`, add the
repository URL, then `Resources > Updates > Check for Updates` — PixInsight installs and registers
the watcher automatically.

> ⚠️ Not usable by others yet: the repository in `pi-repo/` is **not published at a public URL**,
> and it is signed with a **local** identity rather than a Certified PixInsight Developer one, so
> other machines would reject it. Build from source instead.

**Build the native module from source** (needs a C++ toolchain: MSVC on Windows, g++/clang on macOS/Linux):

```bash
npm run module:pcl       # once — builds the PCL static library from PixInsight's PCL source
npm run module:build     # regenerates embedded handlers, then compiles the module
npm run module:sign      # prompts for password; produces MCPWatcher-pxm.xsgn (~5 s)
npm run module:install   # needs administrator (Windows) / sudo (macOS, Linux), PixInsight closed
```

`npm run module:config` prints every path this resolves on your machine.
(Each is just `node module/<name>.mjs` if you prefer to call it directly.)

`install.mjs` copies both the module **and** its `.xsgn` signature, and refuses to install a
signature older than the DLL. PixInsight blocks unsigned modules unless
`AllowUnsignedModuleInstallation=true`.

### 3. Start the watcher

In PixInsight: `Process > Utilities > MCP Watcher > Start`. PixInsight remains usable.

### 4. Verify the bridge

```powershell
node scripts/ping-watcher.mjs
```

### 5. Use it

Ask Claude to work on an image. The intended interaction is **goal-driven, not step-by-step**:

> "Open this master, clean the gradient, tighten the stars, reduce noise — check your work as
> you go."

---

## Configuration

Nothing is hardcoded to one machine — every path and tuning value is a **default that an
environment variable overrides**. Defaults are derived (`%ProgramFiles%`, `vswhere`, `$HOME`)
rather than written as literals, so a stock install needs no configuration at all.

**MCP server / Node scripts**

| Variable | Default | Purpose |
|---|---|---|
| `PIXINSIGHT_EXE` | per-platform, probed | PixInsight executable |
| `PIXINSIGHT_MCP_TIMEOUT_MS` | `300000` | per-command timeout — raise on slow machines or large frames |
| `PIXINSIGHT_MCP_EXTENDED_TIMEOUT_MS` | `3600000` | timeout for long operations |
| `PIXINSIGHT_MCP_POLL_INTERVAL_MS` | `200` | bridge poll cadence |

**Module build/sign/install** (`module/config.mjs` — run `node module/config.mjs` to print what resolves on your machine)

| Variable | Default | Purpose |
|---|---|---|
| `PI_ROOT` | `%ProgramFiles%\PixInsight` | PixInsight install root |
| `PI_BIN`, `PI_EXE` | derived from `PI_ROOT` | binary directory / executable |
| `VS` | discovered via `vswhere` | Visual Studio, any edition/version (Windows only) |
| `VCVARS`, `CMAKE`, `NINJA_DIR` | derived from `VS` | toolchain components |
| `PCL_BUILD_OUT` | `%USERPROFILE%\pcl-build` | where `PCL-pxi.lib` is built |
| `PCLINCDIR`, `PCLLIBDIR` | derived | PCL headers / library |
| `PI_SIGN_KEYS` | `%USERPROFILE%\key.xssk` | signing keys file |
| `PI_SIGN_SLOT` | `7` | instance slot for the signing process |

Non-standard install? Set the variable and run normally:

```bash
# Windows
set PI_ROOT=D:\Astro\PixInsight && node module\build.mjs

# macOS / Linux
PI_ROOT=/opt/PixInsight node module/build.mjs
```

> A single config **file** that feeds these is planned; the environment-variable layer above is
> the mechanism it will drive.

---

## Platform

**Cross-platform by design. Windows is currently the only platform it has been *run* on.**

Nothing in the architecture is Windows-specific — the MCP server is Node, the bridge is plain
files, and the handlers are PJSR. The build tooling is Node too (`module/*.mjs`), with
per-platform branches: PixInsight ships PCL project files for all three
(`src/pcl/windows/vc17`, `src/pcl/macosx/g++`, `src/pcl/linux/g++`), and the module itself
builds with CMake everywhere.

| | Status |
|---|---|
| Windows | **verified** — build, sign, install all exercised |
| macOS | written, **not yet run** — uses `make` in `src/pcl/macosx/g++`, clang |
| Linux | written, **not yet run** — uses `make` in `src/pcl/linux/g++`, g++ |

Remaining work is verification, not authoring: run it on a Mac and a Linux box, fix what
breaks, and add CI for all three.

> **Unverified ≠ unsupported.** Non-Windows instructions are present throughout the docs and
> should be corrected when someone runs them, not deleted for being untested.

---

## Repository layout

```
src/                  MCP server (TypeScript → build/)
  tools/              tool definitions: image-management, processing, research
  bridge/             file-bridge client
module/               native PixInsight module — THE RUNTIME
  src/                C++ sources; BridgeHandlersJS.h is GENERATED
  config.mjs          resolved paths/toolchain per platform (run it to inspect)
  gen-handlers.mjs    regenerates BridgeHandlersJS.h from the JS watcher
  build-pcl.mjs       builds the PCL static library (once)
  build.mjs           regenerate handlers → compile
  sign.mjs            sign via PixInsight's native CLI (~5 s)
  install.mjs         install module + .xsgn (admin/root)
pjsr/
  pixinsight-mcp-watcher.js   JS watcher — SOURCE OF TRUTH for handler logic
pi-repo/              signed PixInsight update repository
docs/
  workflows/          per-category processing playbooks (the knowledge layer)
  PROCESSING_GUIDE.md measure → configure → verify methodology
  mcp-tools.md        tool reference
  bridge-protocol.md  bridge wire format
scripts/
  ping-watcher.mjs    bridge round-trip test
  build-pi-repo.ps1   rebuild the update repo zip (re-sign updates.xri after!)
```

> **Handler logic lives in `pjsr/pixinsight-mcp-watcher.js` only.** `module/src/BridgeHandlersJS.h`
> is generated from it by `gen-handlers.mjs`, which `build.mjs` runs automatically. Never edit the
> generated header by hand.

`agents/`, `editor/`, and most of `scripts/` are **upstream's Node pipeline, which this fork does
not execute**. They are retained pending a harvest of `agents/ops/` (battle-tested measurement and
quality-gate code) and will otherwise be removed.

---

## Roadmap

The goal is **autonomous processing from a short, goal-driven prompt** — the user states an
outcome, the agent selects and configures the processes itself.

- **M1** — one full agent-driven run on a real master, documented warts and all *(next)*
- **M2** — first-class measurement tools (FWHM/PSF, gradient residual, noise/SNR, star count, clipping)
- **M3** — acquisition-category detection + executable per-category step lists
- **M4** — enforced verification gates (no-op, clipping, star-count collapse) and checkpoints
- **M5** — a `/process <master>` entry point

> ⚠️ **Category detection must not trust the FITS `FILTER` header.** Real case from our own test
> data: a master labelled `FILTER-NoFilter` was actually shot through an Antlia ALP-T 5 nm duoband
> — screw-in filters are commonly unlogged. Header-only detection would route it to broadband SPCC
> and calibrate the color wrongly. Corroborate with channel statistics, the user's equipment
> profile, or an explicit prompt. Treat headers as a hint, never as truth.

`docs/ROADMAP.md` is **upstream's** pre-implementation plan and is stale — its Phase 5 prescribes
the per-process tools this fork abandoned.

---

## Relationship to upstream

**Shared with upstream:** the file-bridge contract, the PJSR handler bodies (ours are generated
from a watcher descended from upstream's), and the MCP server skeleton.

**New in this fork:** the native module (upstream has none), the generic
`run_process` / `get_process_parameters` design, `docs/workflows/`, the signed update repository,
the Windows platform layer, and npm packaging.

**Removed from this fork:** upstream's `giga-run.mjs` agentic pipeline, `scripts/run-pipeline.mjs`,
the config editor, and the sample target configs. They described a different product — a Node
pipeline driving PixInsight via a blocking script — and were never executed here. Git history
retains them.

**Kept from upstream:** `agents/ops/`, deliberately — battle-tested measurement and quality-gate
code (star quality, ringing, burn scanning, gradient residual) to be wrapped as MCP tools for the
measurement and verification milestones.

---

## Credits

- **Alain Escaffre** ([@aescaffre](https://github.com/aescaffre)) — original author: the pipeline,
  the agentic architecture, and the PJSR watcher this fork's handlers descend from. Developed as a
  member of [**Astro ARO**](https://astrolentejo.fr), a remote observatory in the Alentejo Dark Sky
  Reserve (Portugal), Bortle 2–3.
- **Andre Couto** ([@4ndr3c0ut0](https://github.com/4ndr3c0ut0)) — V8 runtime port of the watcher
  for PixInsight 1.9.4+ "Lockhart" (upstream
  [PR #1](https://github.com/aescaffre/pixinsight-mcp/pull/1)).
- **pardovot** — native PixInsight module, generic process runner, workflow knowledge base,
  Windows port, packaging.

## License

MIT © Alain Escaffre. See [LICENSE](LICENSE).
