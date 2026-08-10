# PixInsight MCP Watcher, native module (thin shell)

A compiled **PixInsight module** (PCL, C++) that runs the MCP bridge poller as a
**non-blocking, event-loop-integrated timer**, the one thing a PJSR *script*
cannot do.

## Why this exists

The JS watcher (`../pjsr/pixinsight-mcp-watcher.js`) works, but it must run a
foreground `for(;;)` loop. A running script **holds PixInsight's single main
thread**, so the whole application is "busy" and you cannot pan, zoom, run a
process, or review anything while it polls. We verified there is no way around
this for a script: a persistent background `Timer` does not survive the script
returning (PixInsight tears down the script context on return).

A **module** is different. It is a plugin compiled *into* the application. It can
install a `pcl::Timer` that fires on the **application's own event loop during
idle**, exactly like the real-time preview updates while you interact. The app
is never "busy running a script"; the timer just ticks between your actions. So:

- PixInsight stays **fully interactive** while the watcher runs.
- You can **review Claude's work at any time**, no stop/resume, no second
  instance, no separate workspace.

This is the only architecture that delivers that.

## "Thin shell" scope

The module is a **thin non-blocking shell around the JS handlers**. It:

- Registers a Process + Interface (`MCP Watcher`, under the `Utilities` category).
- Owns a periodic `pcl::Timer` (default 300 ms) that polls
  `~/.pixinsight-mcp/bridge/commands` and writes results to `.../results`.
- **Delegates every command to the embedded JS handlers** via
  `MetaModule::EvaluateScript` on the root thread.
- Exposes a tiny UI: status + Start/Stop, so the timer is easy to control.

Full command coverage (delegated, not reimplemented in C++): `list_open_images`,
`open_image`, `save_image`, `close_image`, `get_image_statistics`,
`run_pixelmath`, `run_process`, `get_process_parameters`, `run_script`,
`get_history`, `undo`, `redo`, `snapshot`, `restore`.

### Handler logic lives in ONE place

`src/BridgeHandlersJS.h` is **generated** from `../pjsr/pixinsight-mcp-watcher.js`
by `gen-handlers.mjs`, which `build.mjs` runs automatically on every build. Edit the
**JS watcher**, never the generated header.

> MSVC caps string literals at ~16 KB (C2026), so the generator emits the JS as
> chunked adjacent raw string literals, which the compiler concatenates.

## Files

- `src/MCPWatcherModule.{h,cpp}`  , module metadata + install entry point
- `src/MCPWatcherProcess.{h,cpp}` , MetaProcess (so it appears in Process Explorer)
- `src/MCPWatcherInterface.{h,cpp}`, ProcessInterface: hosts the pcl::Timer + UI
- `src/BridgePoller.{h,cpp}`      , file polling + command dispatch (the real work)
- `src/BridgeHandlersJS.h`        , **generated**; embedded JS handlers
- `src/Version.h`                 , module version (shown in the dialog)

## JSON

The bridge exchanges JSON files and PCL ships no JSON parser, but the module
does not need one. It extracts the envelope fields (`id`, `tool`) with a small
hand parser in `BridgePoller`, then hands the **raw JSON straight to the JS
handlers**, where JSON is a native value. No C++ JSON library is required.

## JS delegation, how it works

Rather than porting handlers to C++, `BridgePoller` builds a delegating script and
evaluates it on the root thread via `MetaModule::EvaluateScript`. The embedded
handler source (`BridgeHandlersJS.h`) is generated from the JS watcher, so handler
logic exists in exactly one place and the C++ side stays a non-blocking shell.

## Build

The build scripts are **Node** (`.mjs`) and cross-platform, no `.bat`/`.sh`, so
every platform uses the same entry points. Node is already a dependency of this
project, so no extra toolchain is needed to *run* them.

```
npm run module:config       # print the resolved configuration for this machine
```

Every path is derived and every value is env-overridable, see the Configuration
table in the top-level README. Nothing is hardcoded to one machine.

**Toolchain per platform:**

| | Compiler | PCL built with |
|---|---|---|
| **Windows** *(verified)* | MSVC (VS 2017+, any edition, located via `vswhere`) | MSBuild + `src/pcl/windows/vc17/PCL.vcxproj` |
| **macOS** *(unverified)* | clang/g++ | `make` in `src/pcl/macosx/g++` |
| **Linux** *(unverified)* | g++ | `make` in `src/pcl/linux/g++` |

The **PCL SDK ships inside PixInsight**: headers in `<PixInsight>/include/pcl`,
full source in `<PixInsight>/src/pcl`, and per-platform project files as above.
The module itself builds with CMake everywhere.

> The macOS/Linux branches are written from PixInsight's own bundled makefiles
> but have not been run yet, the module has only been built on Windows so far.
> Expect to debug rather than to author when porting.

Steps:

1. **Build PCL once** (no prebuilt library ships):
   ```
   npm run module:pcl
   ```
   Produces the static library in `~/pcl-build/lib`, a writable location, because the
   PixInsight install directory is read-only. Pass `--force` to rebuild.

2. **Build the module**:
   ```
   npm run module:build
   ```
   Regenerates the embedded handlers, sets up the compiler environment (on Windows,
   `vcvars64`), points CMake at the PCL SDK, and builds `module/build/MCPWatcher-pxm.*`.

3. **Sign** (`npm run module:sign`), then **install** (`npm run module:install`, admin/root) -
   see Signing below. Or PixInsight → Process → Modules → Install Modules → select the module.

Build flags mirror PixInsight's own `PCL.vcxproj`: C++20, `/MD`, `/arch:AVX2`,
defines `__PCL_WINDOWS __PCL_AVX2 __PCL_FMA` etc. (encoded in `CMakeLists.txt`).

> First-link caveat: the module links `PCL-pxi.lib`; if MSVC reports unresolved
> host/Qt-backed symbols at link time, add the matching `*.lib` to
> `target_link_libraries` in `CMakeLists.txt` and rebuild. Expected to need
> iteration on the first real build.

## Signing

`AllowUnsignedModuleInstallation = false` by default, unsigned modules are
**blocked** (stricter than scripts). So a build must be signed before
`install.mjs` will accept it. The identity is the CPD id `OfirPardo`, which
resolves by name on any install.

Signing needs **no PixInsight**. `sign.mjs` computes the signature directly:

```
npm run module:sign                    # sign the built module
node module/sign.mjs <file> [<file>…]  # sign specific binaries
node module/sign.mjs --verify <file>   # check a file against its .xsgn
```

Any platform's binary can be signed on any platform, and CI signs its own
releases. PixInsight is required exactly once, to export the key
(`module/export-signing-key.js`).

Full reference, including the construction and how it was proven:
**[`docs/SIGNING.md`](../docs/SIGNING.md)**.

> **Keys file is `.xssk`** ("PixInsight XML Secure Signing Keys"), not `.xkeys`.
> It is XML holding an Ed25519 key pair, with the private key encrypted under a
> "custom algorithm based on AES-256" (Pleiades' wording; KDF unpublished).

> **The password is only needed once**, by `export-signing-key.js`, and it is
> typed into a PixInsight dialog. Signing itself never sees it, so the old
> hazards (password visible in the process table, `cmd` mangling `"` or `%`)
> are gone with the CLI round-trip that created them.

### Signing outside PixInsight, retracted

This section used to argue that signing outside PixInsight was impractical. It
was wrong, and the reasoning is kept here because the *shape* of the error is
worth remembering.

The two claimed blockers:

- **"The `.xssk` private key is encrypted with an undocumented KDF."** True, and
  irrelevant. `Security.loadSigningKeysFile()` hands the decrypted key straight
  to PJSR as a `ByteArray`. The KDF never had to be broken, only bypassed. The
  blocker was stated in terms of the obstacle rather than the goal.
- **"The module preimage is undocumented, 943 constructions found no match."**
  Also true, but the search had been run against a *fixed* known-good Pleiades
  signature. Once the key was in hand, probe signatures could be generated over
  chosen inputs on demand, and a ~1M-candidate search found the construction in
  95 seconds. The earlier failure measured the search, not the problem.

What holds up: the signature is stock Ed25519 over SHA-512, there is no
standalone signing tool in `bin/`, and `Security` lives in the closed core.

See [`docs/SIGNING.md`](../docs/SIGNING.md) for the construction, and for the
one piece that remains unrecovered, the `.xri` repository signature.

### The full build flow

```
build.mjs     regenerate embedded handlers -> compile -> warn "unsigned"
sign.mjs      sign in Node -> produce .xsgn -> verify it before reporting success
install.mjs   verify module + .xsgn, and that .xsgn is NOT older than the module
              -> copy both to <PixInsight>\bin  (ADMIN, PixInsight closed)
```

The staleness check matters: rebuilding after signing silently invalidates the
signature, and PixInsight then rejects the module with an unhelpful error.

## Useful command-line flags

Confirmed present in the 1.9.4 binary:

| Flag | Effect |
|---|---|
| `--automation-mode` | no graphical effects, no informative/warning dialogs, saves no preferences |
| `-n[=<slot>]` / `--new` | new instance in slot 1-256 |
| `-y[=<slot>]` / `--yield` | yield to an already-running instance |
| `-r=<script>` | run a PJSR script after startup (repeatable, ordered) |
| `-x=[<slot>:]<script>` | send a script-execution IPC command **to a running instance** |
| `--force-exit` | exit after all `-r` scripts complete |
| `--no-modules`, `--no-startup-scripts`, `--no-splash` | the real startup-time reducers |
| `-e` / `--enumerate` | list running instances + PIDs |
| `--terminate=<slot>` | terminate an instance |

There is **no** `--headless` / `--no-gui` / offscreen mode, a GUI process always
starts, even in automation mode.

> Paths passed inside `-r="script,key=value,..."` must be **Windows-style**
> (`C:/...` or `C:\...`). A Unix-style path is accepted by the launcher but the
> script cannot resolve it, and it fails with no visible output.

## Status

**Working end-to-end.** Built on Windows x64 (VS 2022 BuildTools MSVC 14.44, PCL
from PixInsight 1.9.4), signed, installed, and verified: the bridge round-trips
**while PixInsight stays fully interactive**. Full handler coverage via JS
delegation (see above). Current version is in `src/Version.h`, and is shown in the
module's dialog.

## Hard-won gotchas

- **Do not construct Qt-backed objects (`Timer`) at module-install time**, it
  crashes `InitializePixInsightModule`. Allocate lazily on Start.
- **`Version()` must use the `PCL_MODULE_VERSION` macro**, not a hand-rolled string.
- **MSVC caps string literals at ~16 KB**, hence the chunked raw literals in the
  generated `BridgeHandlersJS.h`.
- **A PJSR script cannot do this.** A running script holds PixInsight's single main
  thread, and a background `Timer` does not survive the script returning (verified).
  That is the entire reason this module exists.
