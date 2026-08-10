# PixInsight MCP

**Let Claude process your astrophotography images in [PixInsight](https://pixinsight.com), while
you keep using PixInsight yourself.**

PixInsight is the standard application for processing deep-sky astrophotography: stacking,
gradient removal, deconvolution, noise reduction, stretching. It is powerful and famously
intricate, a single image can take an evening of dialogs, sliders and second-guessing.

This project connects it to Claude. You describe the outcome you want; Claude opens your master
frame, measures it, decides what to run, runs it, and checks its own work, using the real
PixInsight processes you would have used by hand.

```
"Open this master, clean the gradient, tighten the stars, reduce noise,
 and check your work as you go."
```

The unusual part is that **PixInsight stays fully interactive the whole time**. You can pan,
zoom, open a histogram and watch each step land as it happens, then intervene when you disagree.
That is not how scripted automation in PixInsight normally behaves, and [it took a compiled
module to achieve](#why-a-native-module).

**Status:** working and used for real processing, on Windows. Modules and the update repository
are signed with a Certified PixInsight Developer identity.

---

## What you get

- **Every PixInsight process**, driven by name, including third-party ones you have installed
  (BlurXTerminator, NoiseXTerminator, StarXTerminator, and so on). No per-process wrappers to
  maintain, and nothing to add when you install a new tool.
- **Measurements, not guesses.** Noise (MRS), background gradient, star metrics and image
  statistics are read back from *your* frame, so settings are derived from it rather than copied
  from a tutorial.
- **Renders Claude can actually look at**, so it can judge results visually instead of trusting
  numbers alone.
- **A knowledge layer** so results are repeatable: verified tool traps in
  [`docs/facts.md`](docs/facts.md), graded reference runs in `references/library.json`, and a run
  driver skill that processes an image end to end and records what it did.

---

## Requirements

| | |
|---|---|
| **PixInsight** | 1.9.4 "Lockhart" or later (V8 scripting engine) |
| **Node.js** | v18+ (v22 recommended) |
| **Claude** | Claude Code or Claude Desktop |
| **OS** | Windows verified; macOS and Linux written but not yet run, see [Platform](#platform) |
| **Images** | calibrated masters (WBPP-stacked XISF) |

---

## Quick start

### 1. Add the MCP server

```bash
claude mcp add pixinsight -- npx -y @pardovot/pixinsight-mcp
```

### 2. Install the PixInsight module

In PixInsight: `Resources > Updates > Manage Repositories`, add

```
https://raw.githubusercontent.com/pardovot/pixinsight-mcp/dist/
```

then `Resources > Updates > Check for Updates` and restart. PixInsight downloads and installs the
native module itself, no compiler and no source build. The repository and the module are both
signed, so the Updates dialog should show *Verified. Certified developer: OfirPardo*.

<details>
<summary>Or build the module from source (needs a C++ toolchain)</summary>

```bash
npm run module:pcl       # once, builds the PCL static library from PixInsight's PCL source
npm run module:build     # regenerates embedded handlers, then compiles the module
npm run module:sign      # produces MCPWatcher-pxm.xsgn (no PixInsight needed)
npm run module:install   # needs administrator (Windows) / sudo (macOS, Linux), PixInsight closed
```

`npm run module:config` prints every path this resolves on your machine. `install.mjs` copies the
module **and** its `.xsgn` signature, and refuses a signature older than the binary; PixInsight
blocks unsigned modules unless `AllowUnsignedModuleInstallation=true`.

Signing needs a signing identity of your own, see [`docs/SIGNING.md`](docs/SIGNING.md).
</details>

### 3. Start the watcher

`Process > Utilities > MCP Watcher > Start`. PixInsight stays usable.

### 4. Check the bridge

```bash
node scripts/ping-watcher.mjs
```

### 5. Work

Ask Claude for an outcome rather than a sequence of steps. It measures, chooses, runs and
verifies, and you watch it happen in the PixInsight window.

---

## Why a native module

This is the design decision the whole project rests on.

PJSR, PixInsight's scripting engine, is **single-threaded**. A running script owns the main
thread, so the obvious implementation, a script that polls for commands in a loop, freezes the
entire application for as long as it runs. You cannot pan, zoom or look at anything. There is no
way around it from inside a script: a background `Timer` does not survive the script returning
(verified, not assumed).

A **compiled module** can do what a script cannot. `MCPWatcher-pxm.dll` installs a `pcl::Timer`
that fires on PixInsight's **own event loop while it is idle**, so the application is never
"busy running a script".

- PixInsight stays **fully interactive** while the bridge polls.
- You can **review the work at any point**, with no stop/resume dance and no second instance.
- Human-in-the-loop checkpoints become practical: the agent pauses, you look, you continue.

The module is deliberately a **thin shell**. It delegates every bridge command to JS handlers
embedded at build time (generated from `pjsr/pixinsight-mcp-watcher.js`) via
`MetaModule::EvaluateScript`. Handler logic therefore lives in exactly one place, the JS, and C++
contributes only the non-blocking timer.

---

## How it works

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

PixInsight exposes no socket or HTTP API, so the file bridge is the only mechanism. Round-trip
latency is roughly the poll interval (default 300 ms).

> **Trust boundary:** any local process that can write to `~/.pixinsight-mcp/bridge/commands` can
> execute arbitrary code inside PixInsight. That is the bridge's purpose. Keep the directory
> user-private, and do not point it at a shared or synced location.

**Three delivery channels:** the MCP server on npm (`@pardovot/pixinsight-mcp`), the signed update
repository that ships the native module, and the module source in `module/`.

---

## One generic runner, not a tool per process

Every PixInsight process reduces to `new X; set params; executeOn(view)`. So rather than wrapping
processes one at a time, the server exposes:

- **`run_process(processId, viewId?, settings?)`**, runs **any** process by class name
- **`get_process_parameters(processId)`**, introspects its settable parameters and current defaults
- **`run_script(...)`**, the raw PJSR escape hatch

One pair covers every process, including ones released after this project, with zero per-process
maintenance. **Adding `run_bxt`-style tools is the anti-pattern this project deliberately moved
past**; the legacy wrappers (`run_bxt`, `sharpen`, `stretch_image`, and friends) were removed in
July 2026.

### Tools

24 tools; the ones that matter are in bold.

| Category | Tools |
|---|---|
| Generic execution | **`run_process`**, **`get_process_parameters`**, **`run_script`** |
| Image management | `list_open_images`, `open_image`, `save_image`, `close_image`, **`get_image_statistics`** |
| Measurement | **`get_noise`**, **`get_background_gradient`**, `get_background_neutrality`, **`get_star_metrics`**, `get_structure_color` |
| Rendering | **`render_view`**, **`render_critic_pack`** |
| Session / history | `get_history`, `get_full_history`, `undo`, `redo`, `snapshot`, `restore` |
| Instances | `list_instances`, `use_instance` |
| Export | `export_container` |

Two measurement subtleties worth knowing, because both produce confident wrong answers otherwise:
`get_noise` returns an **MRS** estimate, never judge denoising by `stdDev`, which is
signal-dominated on astro frames; and `get_background_neutrality` needs `mode:'poststretch'`
after stretching, because the plus/minus 8% sky-band metric lies once a transfer curve is applied.

Authoritative definitions live in `src/tools/*.ts`.

---

## Configuration

Nothing is hardcoded to one machine. Every path and tuning value is a **default that an
environment variable overrides**, and defaults are *derived* (`%ProgramFiles%`, `vswhere`,
`$HOME`) rather than written as literals, so a stock install needs no configuration.

**MCP server**

| Variable | Default | Purpose |
|---|---|---|
| `PIXINSIGHT_EXE` | probed per platform | PixInsight executable |
| `PIXINSIGHT_MCP_TIMEOUT_MS` | `300000` | per-command timeout, raise for slow machines or large frames |
| `PIXINSIGHT_MCP_EXTENDED_TIMEOUT_MS` | `3600000` | timeout for long operations |
| `PIXINSIGHT_MCP_POLL_INTERVAL_MS` | `200` | bridge poll cadence |

**Module build and install** (`node module/config.mjs` prints what resolves on your machine)

| Variable | Default | Purpose |
|---|---|---|
| `PI_ROOT` | `%ProgramFiles%\PixInsight` | PixInsight install root |
| `PI_BIN`, `PI_EXE` | derived from `PI_ROOT` | binary directory / executable |
| `VS` | discovered via `vswhere` | Visual Studio, any edition (Windows) |
| `VCVARS`, `CMAKE`, `NINJA_DIR` | derived from `VS` | toolchain components |
| `PCL_BUILD_OUT` | `%USERPROFILE%\pcl-build` | where `PCL-pxi.lib` is built |
| `PCLINCDIR`, `PCLLIBDIR` | derived | PCL headers / library |

**Signing** (only if you publish your own builds, see [`docs/SIGNING.md`](docs/SIGNING.md))

| Variable | Default | Purpose |
|---|---|---|
| `PI_SIGN_KEY`, `PI_SIGN_DEVELOPER_ID` | none | key material, how CI supplies it |
| `PI_SIGN_KEY_FILE` | `~/.pixinsight-mcp/signing-key.json` | exported key used for local signing |

Non-standard install? Set the variable and run normally:

```bash
# Windows
set PI_ROOT=D:\Astro\PixInsight && node module\build.mjs

# macOS / Linux
PI_ROOT=/opt/PixInsight node module/build.mjs
```

---

## Platform

**Cross-platform by design. Windows is currently the only platform it has been *run* on.**

Nothing in the architecture is Windows-specific: the MCP server is Node, the bridge is plain
files, the handlers are PJSR, and the build tooling is Node with per-platform branches.
PixInsight ships PCL project files for all three systems, and the module builds with CMake
everywhere.

| | Status |
|---|---|
| Windows | **verified**, build, sign, install and release all exercised |
| macOS | written, **not yet run** (`src/pcl/macosx/g++`, clang) |
| Linux | written, **not yet run** (`src/pcl/linux/g++`, g++) |

CI compiles all three on every change, so they are known to *build*; what is unverified is
running them. Remaining work is verification, not authoring.

> **Unverified is not the same as unsupported.** Non-Windows instructions are present throughout
> the docs and should be corrected when someone runs them, not deleted for being untested.

---

## Repository layout

```
src/                  MCP server (TypeScript to build/)
  tools/              tool definitions: processing, image-management, measurement,
                      render, session, instances, export
  pjsr/               PJSR script bodies the measurement/render tools send over the bridge
  bridge/             file-bridge client
test/                 node --test suites (bridge client, handler generation)
module/               native PixInsight module, THE RUNTIME
  src/                C++ sources; BridgeHandlersJS.h is GENERATED
  config.mjs          resolved paths/toolchain per platform (run it to inspect)
  gen-handlers.mjs    regenerates BridgeHandlersJS.h from the JS watcher
  build-pcl.mjs       builds the PCL static library (once)
  build.mjs           regenerate handlers, then compile
  sign.mjs            sign a module in Node (no PixInsight)
  sign-xri.mjs        sign a repository index
  signing.mjs         code-file signing construction, key loading, .xsgn format
  xml-canonical.mjs   .xri canonicalisation and signing construction
  ed25519.mjs         Ed25519 from an expanded key, which node:crypto cannot do
  export-signing-key.js  one-time key export, run inside PixInsight
  install.mjs         install module + .xsgn (admin/root)
  test-fixtures/      signing fixtures captured from PixInsight (public data only)
pjsr/
  pixinsight-mcp-watcher.js   JS watcher, SOURCE OF TRUTH for handler logic
docs/
  SIGNING.md          both signing constructions, and how they were established
  RELEASING.md        tag-driven module release
  bridge-protocol.md  bridge wire format
  facts.md            verified tool traps and gotchas
  architecture.md     deeper design notes
scripts/
  ping-watcher.mjs    bridge round-trip test
  build-pi-repo.mjs   rebuild the update repository package and index
.github/workflows/    ci, module-build, module-release
```

> **Handler logic lives in `pjsr/pixinsight-mcp-watcher.js` only.**
> `module/src/BridgeHandlersJS.h` is generated from it by `gen-handlers.mjs`, which `build.mjs`
> runs automatically. Never edit the generated header by hand.

---

## Security and signing

PixInsight refuses to load unsigned modules by default, so distribution requires a signing
identity. Modules here are signed with a Certified PixInsight Developer identity, and the update
repository index is signed as well, so PixInsight can confirm both the publisher and that nothing
was altered in transit.

Signing runs entirely in Node, with **no PixInsight involved**, which is why CI can cut a fully
signed release on a runner that has none installed. PixInsight is needed exactly once, to export
the signing key. Both constructions, how they were established, and the security caveats are in
[`docs/SIGNING.md`](docs/SIGNING.md).

---

## Origins

This project began in 2026 as a fork of
[aescaffre/pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp) and has since become an
independent codebase. What carries forward is the idea and its foundation: **the file-bridge
contract**, the **PJSR handler bodies** (ours are generated from a watcher descended from the
original), and the **MCP server skeleton**.

What replaced the rest: the native module (the original had none), the generic
`run_process` / `get_process_parameters` design in place of per-process tools, the measurement
layer, the signed update repository, the Windows platform layer, and npm packaging.

The original's `giga-run.mjs` pipeline, `scripts/run-pipeline.mjs`, config editor, sample target
configs and `agents/` are **not** part of this codebase. They described a different product, a
Node pipeline driving PixInsight through a *blocking* script, which is the specific problem the
native module exists to solve. Git history retains them.

---

## Credits

- **Alain Escaffre** ([@aescaffre](https://github.com/aescaffre)), originator of the project this
  one grew from: the file bridge, the agentic architecture, and the PJSR watcher whose handler
  logic still runs here. Developed as a member of [**Astro ARO**](https://astrolentejo.fr), a
  remote observatory in the Alentejo Dark Sky Reserve (Portugal), Bortle 2-3.
- **Andre Couto** ([@4ndr3c0ut0](https://github.com/4ndr3c0ut0)), V8 runtime port of the watcher
  for PixInsight 1.9.4+ "Lockhart"
  ([PR #1](https://github.com/aescaffre/pixinsight-mcp/pull/1) on the original repository).
- **pardovot**, native PixInsight module, generic process runner, measurement and knowledge
  layer, signing and release pipeline, Windows port, packaging.

> Alain's and Andre's commits are preserved in this repository's history. GitHub does not link
> Alain's to his profile because they were authored with a local hostname email address
> (`@MacBook-Pro-de-Alain.local`) that maps to no account, the same is true in his own
> repository. The omission is a GitHub matching artifact, not a statement about authorship.

## License

MIT © Alain Escaffre (original work) and pardovot. See [LICENSE](LICENSE).
