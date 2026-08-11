# PixInsight MCP

An MCP server that lets Claude drive PixInsight: open images, measure them, run any installed
process, read the results back. PixInsight stays responsive while it works, so you can watch and
intervene.

Cross-platform by design. Run and verified on Windows; macOS and Linux compile in CI but have not
been run yet.

## Install

**1. MCP server**

```bash
claude mcp add pixinsight -- npx -y @pardovot/pixinsight-mcp
```

**2. PixInsight module.** `Resources > Updates > Manage Repositories`, add:

```
https://raw.githubusercontent.com/pardovot/pixinsight-mcp/dist/
```

Then `Resources > Updates > Check for Updates` and restart. Signed with a Certified PixInsight
Developer identity, so the dialog shows *Verified. Certified developer: OfirPardo*.

**3. Start it.** `Process > Utilities > MCP Watcher > Start`, then ask Claude to list your open
images. If it answers, you are connected.

Requires PixInsight 1.9.4+ (V8 engine), Node 18+, and Claude Code or Claude Desktop.

## Tools

24 tools. Bold ones carry the work.

| Category | Tools |
|---|---|
| Execution | **`run_process`**, **`get_process_parameters`**, **`run_script`** |
| Images | `list_open_images`, `open_image`, `save_image`, `close_image`, **`get_image_statistics`** |
| Measurement | **`get_noise`**, **`get_background_gradient`**, `get_background_neutrality`, **`get_star_metrics`**, `get_structure_color` |
| Rendering | **`render_view`**, **`render_critic_pack`** |
| History | `get_history`, `get_full_history`, `undo`, `redo`, `snapshot`, `restore` |
| Instances | `list_instances`, `use_instance` |
| Export | `export_container` |

`run_process` runs **any** process by class name, including third-party ones you have installed,
so nothing needs adding when you install a new tool. Per-process wrappers (`run_bxt`, `sharpen`,
`stretch_image`) were removed in July 2026 and should not come back.

Measurement tools exist so settings come from your frame instead of a tutorial. Two traps:
`get_noise` returns an MRS estimate, `stdDev` is signal-dominated on astro frames and will lie to
you; `get_background_neutrality` needs `mode:'poststretch'` after stretching, the sky-band metric
is only valid pre-curve.

Definitions live in `src/tools/*.ts`. Verified gotchas: [`docs/facts.md`](docs/facts.md).

## How it works

```
  Claude
    │  MCP (stdio)
  MCP server                    src/ (TypeScript)
    │  file bridge              ~/.pixinsight-mcp/bridge/{commands,results}
  MCPWatcher-pxm.dll            pcl::Timer on PixInsight's event loop
    │  MetaModule::EvaluateScript
  Embedded JS handlers          generated from pjsr/pixinsight-mcp-watcher.js
  PixInsight
```

PixInsight has no socket or HTTP API, so a file bridge is the only route in. Round trip is about
one poll interval, 300 ms by default.

The runtime is a compiled module rather than a PJSR script because a running script holds
PixInsight's only thread, which blocks the interface until it returns. The module's timer fires
on the event loop instead. It stays a thin shell: every command is delegated to JS handlers
embedded at build time, so handler logic lives in one place and C++ only supplies the timer.

> Anything that can write to `~/.pixinsight-mcp/bridge/commands` can run arbitrary code inside
> PixInsight. Keep the directory user-private, never on a shared or synced path.

## Platform

| | |
|---|---|
| Windows | verified: build, sign, install, release |
| macOS | compiles in CI, not yet run (`src/pcl/macosx/g++`, clang) |
| Linux | compiles in CI, not yet run (`src/pcl/linux/g++`, g++) |

Nothing in the design is Windows-specific: Node server, file bridge, PJSR handlers, CMake build
with per-platform branches. Non-Windows instructions stay in the docs and should be corrected by
whoever runs them first, not deleted for being untested.

## Building from source

Needs a C++ toolchain (MSVC, or g++/clang).

```bash
npm run module:pcl       # once, builds PCL from PixInsight's bundled source
npm run module:build     # regenerate handlers, compile
npm run module:sign      # needs your own signing identity, see docs/SIGNING.md
npm run module:install   # admin/root, PixInsight closed
```

`node module/config.mjs` prints every path resolved on your machine. `install.mjs` copies the
module and its `.xsgn`, and refuses a signature older than the binary.

Handler logic lives in `pjsr/pixinsight-mcp-watcher.js` only. `module/src/BridgeHandlersJS.h` is
generated from it; never edit it by hand.

## Configuration

Every path is a default an environment variable overrides, derived rather than hardcoded, so a
stock install needs nothing.

| Variable | Default | Purpose |
|---|---|---|
| `PIXINSIGHT_EXE` | probed | PixInsight executable |
| `PIXINSIGHT_MCP_TIMEOUT_MS` | `300000` | per-command timeout |
| `PIXINSIGHT_MCP_EXTENDED_TIMEOUT_MS` | `3600000` | long operations |
| `PIXINSIGHT_MCP_POLL_INTERVAL_MS` | `200` | bridge poll cadence |
| `PI_ROOT` | `%ProgramFiles%\PixInsight` | install root, build scripts derive the rest |
| `PCL_BUILD_OUT` | `%USERPROFILE%\pcl-build` | where `PCL-pxi.lib` lands |
| `PI_SIGN_KEY`, `PI_SIGN_DEVELOPER_ID` | none | signing, how CI supplies it |
| `PI_SIGN_KEY_FILE` | `~/.pixinsight-mcp/signing-key.json` | exported key for local signing |

```bash
PI_ROOT=/opt/PixInsight node module/build.mjs
```

## Signing

PixInsight refuses unsigned modules by default. Modules and the repository index are both signed,
in Node, with no PixInsight involved, which is why CI can publish a signed release from a runner
that has none installed. PixInsight is needed once, to export the key.

Both constructions and the security caveats: [`docs/SIGNING.md`](docs/SIGNING.md).
Release process: [`docs/RELEASING.md`](docs/RELEASING.md).

## Layout

```
src/                MCP server: tools/, pjsr/, bridge/
module/             native module (the runtime), build/sign/install tooling
pjsr/               JS watcher, source of truth for handler logic
docs/               SIGNING, RELEASING, bridge-protocol, facts, architecture
scripts/            ping-watcher, build-pi-repo
test/               node --test suites
```

## Origins

Began in 2026 as a fork of [aescaffre/pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp),
independent codebase since. Carried forward: the file-bridge contract, the PJSR handler bodies,
the MCP server skeleton. Added here: the native module, the generic process runner, the
measurement layer, signing and the update repository, npm packaging.

The original's `giga-run.mjs` pipeline, `run-pipeline.mjs`, config editor and `agents/` are not
part of this codebase. They drove PixInsight through a blocking script, which is the problem the
native module exists to solve. Git history retains them.

## Credits

- **Alain Escaffre** ([@aescaffre](https://github.com/aescaffre)), originator of the project this
  one grew from: the file bridge, the agentic architecture, and the PJSR watcher whose handler
  logic still runs here. Developed as a member of [**Astro ARO**](https://astrolentejo.fr), a
  remote observatory in the Alentejo Dark Sky Reserve (Portugal), Bortle 2-3.
- **Andre Couto** ([@4ndr3c0ut0](https://github.com/4ndr3c0ut0)), V8 runtime port of the watcher
  for PixInsight 1.9.4+ "Lockhart"
  ([PR #1](https://github.com/aescaffre/pixinsight-mcp/pull/1) on the original repository).
- **pardovot**, native module, generic process runner, measurement and knowledge layer, signing
  and release pipeline, packaging.

> Alain's and Andre's commits are preserved in this repository's history. GitHub does not link
> Alain's to his profile because they were authored with a local hostname email address
> (`@MacBook-Pro-de-Alain.local`) that maps to no account, the same is true in his own repository.
> A GitHub matching artifact, not a statement about authorship.

## License

MIT © Alain Escaffre (original work) and pardovot. See [LICENSE](LICENSE).
