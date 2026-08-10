# PixInsight MCP, drive PixInsight from Claude, without freezing it

An **MCP server** that lets an AI assistant (Claude Code, Claude Desktop) operate
[PixInsight](https://pixinsight.com) directly, open masters, measure them, run any process,
and inspect the result, while **PixInsight stays fully interactive** so you can watch and
review the work live.

Three parts make that work: a **native PixInsight module** that polls without blocking the UI, a
**generic process runner** instead of a tool per process, and a **research-backed workflow
knowledge base** the agent processes from.

**Status:** working and used for real processing. The autonomous loop is running with
human-in-the-loop review per batch - see [Autonomy](#autonomy) and [Roadmap](#roadmap).

---

## Why a native module

PJSR (PixInsight's scripting engine) is **single-threaded**. A running script holds the main
thread, so the original JS watcher, a `for(;;)` polling loop, froze the whole application
while it ran. You could not pan, zoom, or review anything. There is no way around this from a
script: a background `Timer` does not survive the script returning (verified).

A **compiled module** can. `MCPWatcher-pxm.dll` installs a `pcl::Timer` that fires on
PixInsight's **own event loop during idle**, the app is never "busy running a script".

- PixInsight stays **fully interactive** while the bridge polls.
- You can **review the agent's work at any time**, no stop/resume, no second instance.
- Human-in-the-loop checkpoints become practical: the agent pauses, you look, you continue.

The module is a **thin shell**: it delegates every bridge command to the embedded JS handlers
(generated from `pjsr/pixinsight-mcp-watcher.js`) via `MetaModule::EvaluateScript`. Handler
logic lives in **one** place, the JS, and C++ only provides the non-blocking timer.

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

**Trust boundary:** any local process that can write to `~/.pixinsight-mcp/bridge/commands` can
execute arbitrary code inside PixInsight, that is the bridge's job. Keep the directory
user-private; do not point it at a shared or synced location.

### Three delivery channels

1. **MCP server** (npm) - `@pardovot/pixinsight-mcp`
2. **PixInsight update repo** (`pi-repo/`) - ships the **native module** (`type="module"`,
   installed into `bin/`) via PixInsight's own updates mechanism, so no source build is needed.
   Modules are **signed** with a Certified PixInsight Developer identity - see
   [Update repository status](#update-repository-status)
3. **Native C++ module** (`module/`) - **the runtime**

---

## The tool design: one generic runner, not per-process tools

Every PixInsight process is `new X; set params; executeOn(view)`. So instead of a tool per
process, this project exposes:

- **`run_process(processId, viewId?, settings?)`**, runs **any** process by class name
  (`BlurXTerminator`, `AutomaticBackgroundExtractor`, `PixelMath`, anything installed)
- **`get_process_parameters(processId)`**, introspects that process's settable parameters and
  current defaults
- **`run_script(...)`**, raw PJSR escape hatch

One generic pair covers every process with zero per-process maintenance. **Adding
`run_bxt`-style tools is the anti-pattern this project deliberately moved past.** The legacy
per-process wrappers (`run_bxt`, `sharpen`, `stretch_image`, …) were removed 2026-07-22.

---

## Tools

21 tools. The ones that matter are in bold.

| Category | Tools |
|---|---|
| Generic execution | **`run_process`**, **`get_process_parameters`**, **`run_script`** |
| Image management | `list_open_images`, `open_image`, `save_image`, `close_image`, **`get_image_statistics`** |
| Measurement | **`get_noise`**, **`get_background_gradient`**, `get_background_neutrality`, **`get_star_metrics`** |
| Rendering | **`render_view`**, **`render_critic_pack`** |
| Session / history | `get_history`, `get_full_history`, `undo`, `redo`, `snapshot`, `restore` |
| Export | `export_container` |

Measurement tools exist so settings are **derived from this image** rather than copied. Two
non-obvious ones: `get_noise` returns an **MRS** estimate - never judge denoising by `stdDev`,
which is signal-dominated on astro frames and produces false alarms; and
`get_background_neutrality` needs `mode:'poststretch'` after stretching, because the ±8%
sky-band metric lies once the transfer curve is applied.

Authoritative definitions live in `src/tools/*.ts`.

---

## Requirements

- **OS**: cross-platform by design; Windows is the only platform it has been *run* on so far -
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

**Update repository.** In PixInsight: `Resources > Updates > Manage Repositories`, add the
repository URL, then `Resources > Updates > Check for Updates`, PixInsight installs the native
module into `bin/` and auto-loads it (no source build, no compiler).

> ⚠️ **Not usable by others yet** - the repository in `pi-repo/` is **not published at a public
> URL**. Build from source instead. See [Update repository status](#update-repository-status).

**Build the native module from source** (needs a C++ toolchain: MSVC on Windows, g++/clang on macOS/Linux):

```bash
npm run module:pcl       # once, builds the PCL static library from PixInsight's PCL source
npm run module:build     # regenerates embedded handlers, then compiles the module
npm run module:sign      # produces MCPWatcher-pxm.xsgn (no PixInsight needed)
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

> "Open this master, clean the gradient, tighten the stars, reduce noise, check your work as
> you go."

---

## Update repository status

**Modules are signed** with the Certified PixInsight Developer identity `OfirPardo`, which
resolves by name on any install (it replaced a *local* identity, which was trusted only on
machines where this license is activated and would have been rejected outright elsewhere).

Signing runs in Node with **no PixInsight involved**, so CI signs its own releases; PixInsight is
needed once, to export the key. The construction, how it was established, and the security
caveats are in [`docs/SIGNING.md`](docs/SIGNING.md).

`updates.xri` is signed too, with a different construction: a canonical rendering of the root
element rather than the file bytes. `npm run repo:sign` does it, CI runs it automatically, and a
signature produced this way was confirmed by PixInsight's own validator.

---

## Configuration

Nothing is hardcoded to one machine, every path and tuning value is a **default that an
environment variable overrides**. Defaults are derived (`%ProgramFiles%`, `vswhere`, `$HOME`)
rather than written as literals, so a stock install needs no configuration at all.

**MCP server / Node scripts**

| Variable | Default | Purpose |
|---|---|---|
| `PIXINSIGHT_EXE` | per-platform, probed | PixInsight executable |
| `PIXINSIGHT_MCP_TIMEOUT_MS` | `300000` | per-command timeout, raise on slow machines or large frames |
| `PIXINSIGHT_MCP_EXTENDED_TIMEOUT_MS` | `3600000` | timeout for long operations |
| `PIXINSIGHT_MCP_POLL_INTERVAL_MS` | `200` | bridge poll cadence |

**Module build/sign/install** (`module/config.mjs`, run `node module/config.mjs` to print what resolves on your machine)

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

Nothing in the architecture is Windows-specific, the MCP server is Node, the bridge is plain
files, and the handlers are PJSR. The build tooling is Node too (`module/*.mjs`), with
per-platform branches: PixInsight ships PCL project files for all three
(`src/pcl/windows/vc17`, `src/pcl/macosx/g++`, `src/pcl/linux/g++`), and the module itself
builds with CMake everywhere.

| | Status |
|---|---|
| Windows | **verified**, build, sign, install all exercised |
| macOS | written, **not yet run**, uses `make` in `src/pcl/macosx/g++`, clang |
| Linux | written, **not yet run**, uses `make` in `src/pcl/linux/g++`, g++ |

Remaining work is verification, not authoring: run it on a Mac and a Linux box, fix what
breaks, and add CI for all three.

> **Unverified ≠ unsupported.** Non-Windows instructions are present throughout the docs and
> should be corrected when someone runs them, not deleted for being untested.

---

## Repository layout

```
src/                  MCP server (TypeScript → build/)
  tools/              tool definitions: processing, image-management, measurement,
                      render, session, export
  pjsr/               PJSR script bodies the measurement/render tools send over the bridge
  bridge/             file-bridge client
test/                 node --test suites (bridge client, handler generation)
module/               native PixInsight module, THE RUNTIME
  src/                C++ sources; BridgeHandlersJS.h is GENERATED
  config.mjs          resolved paths/toolchain per platform (run it to inspect)
  gen-handlers.mjs    regenerates BridgeHandlersJS.h from the JS watcher
  build-pcl.mjs       builds the PCL static library (once)
  build.mjs           regenerate handlers → compile
  sign.mjs            sign the module in Node (no PixInsight)
  signing.mjs         the signing construction, key loading, .xsgn format
  ed25519.mjs         Ed25519 from an expanded key, which node:crypto cannot do
  export-signing-key.js  one-time key export, run inside PixInsight
  install.mjs         install module + .xsgn (admin/root)
pjsr/
  pixinsight-mcp-watcher.js   JS watcher, SOURCE OF TRUTH for handler logic
pi-repo/              PixInsight update repository (signed modules, unsigned index)
docs/
  SIGNING.md          how signing works, and what is still unrecovered
  RELEASING.md        tag-driven module release
  bridge-protocol.md  bridge wire format
scripts/
  ping-watcher.mjs    bridge round-trip test
  build-pi-repo.mjs   rebuild the update repo zip (packages each .xsgn)
.github/workflows/    ci, module-build, module-release
```

> **Handler logic lives in `pjsr/pixinsight-mcp-watcher.js` only.** `module/src/BridgeHandlersJS.h`
> is generated from it by `gen-handlers.mjs`, which `build.mjs` runs automatically. Never edit the
> generated header by hand.

---

## Roadmap

The goal is **autonomous processing from a short, goal-driven prompt**, the user states an
outcome, the agent selects and configures the processes itself.

- **M1** - one full agent-driven run on a real master, documented warts and all ✅ *done*
- **M2** - first-class measurement tools (MRS noise, gradient residual, background neutrality,
  star metrics) ✅ *done 2026-07-24*, plus `render_view` / `render_critic_pack`
- **M3** - acquisition-category detection + executable per-category step lists *(next)*
- **M4** - enforced verification gates (no-op, clipping, star-count collapse) and checkpoints
- **M5** - a `/process <master>` entry point

> ⚠️ **Category detection must not trust the FITS `FILTER` header.** Real case from our own test
> data: a master labelled `FILTER-NoFilter` was actually shot through an Antlia ALP-T 5 nm duoband
>, screw-in filters are commonly unlogged. Header-only detection would route it to broadband SPCC
> and calibrate the color wrongly. Corroborate with channel statistics, the user's equipment
> profile, or an explicit prompt. Treat headers as a hint, never as truth.

---

## Origins

This project began in 2026 as a fork of
[aescaffre/pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp) and has since become an
independent codebase. What carries forward from that work is the idea and its foundation: **the
file-bridge contract**, the **PJSR handler bodies** (ours are generated from a watcher descended
from the original), and the **MCP server skeleton**.

What replaced the rest: the native module (the original had none), the generic
`run_process` / `get_process_parameters` design in place of per-process tools,
the measurement layer, the update repository, the Windows platform layer, and npm packaging.

The original's `giga-run.mjs` pipeline, `scripts/run-pipeline.mjs`, config editor, sample target
configs, and `agents/` are **not** part of this codebase. They described a different product - a
Node pipeline driving PixInsight through a *blocking* script - which is the specific problem the
native module exists to solve. Git history retains them.

---

## Credits

- **Alain Escaffre** ([@aescaffre](https://github.com/aescaffre)) - originator of the project this
  one grew from: the file bridge, the agentic architecture, and the PJSR watcher whose handler
  logic still runs here. Developed as a member of [**Astro ARO**](https://astrolentejo.fr), a
  remote observatory in the Alentejo Dark Sky Reserve (Portugal), Bortle 2-3.
- **Andre Couto** ([@4ndr3c0ut0](https://github.com/4ndr3c0ut0)) - V8 runtime port of the watcher
  for PixInsight 1.9.4+ "Lockhart"
  ([PR #1](https://github.com/aescaffre/pixinsight-mcp/pull/1) on the original repository).
- **pardovot** - native PixInsight module, generic process runner, workflow knowledge base,
  measurement and autonomy layer, Windows port, packaging.

> Alain's and Andre's commits are preserved in this repository's history. GitHub does not link
> Alain's to his profile because they were authored with a local hostname email address
> (`@MacBook-Pro-de-Alain.local`) that maps to no account - the same is true in his own
> repository. The omission is a GitHub matching artifact, not a statement about authorship.

## License

MIT © Alain Escaffre (original work) and pardovot. See [LICENSE](LICENSE).
