# PixInsight MCP Watcher — native module (thin shell)

A compiled **PixInsight module** (PCL, C++) that runs the MCP bridge poller as a
**non-blocking, event-loop-integrated timer** — the one thing a PJSR *script*
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
idle** — exactly like the real-time preview updates while you interact. The app
is never "busy running a script"; the timer just ticks between your actions. So:

- PixInsight stays **fully interactive** while the watcher runs.
- You can **review Claude's work at any time** — no stop/resume, no second
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

- `src/MCPWatcherModule.{h,cpp}`   — module metadata + install entry point
- `src/MCPWatcherProcess.{h,cpp}`  — MetaProcess (so it appears in Process Explorer)
- `src/MCPWatcherInterface.{h,cpp}` — ProcessInterface: hosts the pcl::Timer + UI
- `src/BridgePoller.{h,cpp}`       — file polling + command dispatch (the real work)
- `src/BridgeHandlersJS.h`         — **generated**; embedded JS handlers
- `src/Version.h`                  — module version (shown in the dialog)

## JSON

The bridge exchanges JSON files and PCL ships no JSON parser — but the module
does not need one. It extracts the envelope fields (`id`, `tool`) with a small
hand parser in `BridgePoller`, then hands the **raw JSON straight to the JS
handlers**, where JSON is a native value. No C++ JSON library is required.

## JS delegation — how it works

Rather than porting handlers to C++, `BridgePoller` builds a delegating script and
evaluates it on the root thread via `MetaModule::EvaluateScript`. The embedded
handler source (`BridgeHandlersJS.h`) is generated from the JS watcher, so handler
logic exists in exactly one place and the C++ side stays a non-blocking shell.

## Build

The build scripts are **Node** (`.mjs`) and cross-platform — no `.bat`/`.sh`, so
every platform uses the same entry points. Node is already a dependency of this
project, so no extra toolchain is needed to *run* them.

```
npm run module:config       # print the resolved configuration for this machine
```

Every path is derived and every value is env-overridable — see the Configuration
table in the top-level README. Nothing is hardcoded to one machine.

**Toolchain per platform:**

| | Compiler | PCL built with |
|---|---|---|
| **Windows** *(verified)* | MSVC (VS 2017+, any edition — located via `vswhere`) | MSBuild + `src/pcl/windows/vc17/PCL.vcxproj` |
| **macOS** *(unverified)* | clang/g++ | `make` in `src/pcl/macosx/g++` |
| **Linux** *(unverified)* | g++ | `make` in `src/pcl/linux/g++` |

The **PCL SDK ships inside PixInsight**: headers in `<PixInsight>/include/pcl`,
full source in `<PixInsight>/src/pcl`, and per-platform project files as above.
The module itself builds with CMake everywhere.

> The macOS/Linux branches are written from PixInsight's own bundled makefiles
> but have not been run yet — the module has only been built on Windows so far.
> Expect to debug rather than to author when porting.

Steps:

1. **Build PCL once** (no prebuilt library ships):
   ```
   npm run module:pcl
   ```
   Produces the static library in `~/pcl-build/lib` — a writable location, because the
   PixInsight install directory is read-only. Pass `--force` to rebuild.

2. **Build the module**:
   ```
   npm run module:build
   ```
   Regenerates the embedded handlers, sets up the compiler environment (on Windows,
   `vcvars64`), points CMake at the PCL SDK, and builds `module/build/MCPWatcher-pxm.*`.

3. **Sign** (`npm run module:sign`), then **install** (`npm run module:install`, admin/root) —
   see Signing below. Or PixInsight → Process → Modules → Install Modules → select the module.

Build flags mirror PixInsight's own `PCL.vcxproj`: C++20, `/MD`, `/arch:AVX2`,
defines `__PCL_WINDOWS __PCL_AVX2 __PCL_FMA` etc. (encoded in `CMakeLists.txt`).

> First-link caveat: the module links `PCL-pxi.lib`; if MSVC reports unresolved
> host/Qt-backed symbols at link time, add the matching `*.lib` to
> `target_link_libraries` in `CMakeLists.txt` and rebuild. Expected to need
> iteration on the first real build.

## Signing

`AllowUnsignedModuleInstallation = false` by default — unsigned modules are
**blocked** (stricter than scripts). So a build must be signed with a CPD
identity before `install.mjs` will accept it.

Signing is **fully automatable**: the core application accepts signing arguments
directly on the command line — no GUI, no CodeSign dialog, no PJSR script.

```
npm run module:sign                       # sign the built module
node module/sign.mjs pi-repo/updates.xri  # sign an update repo file in place
```

`sign.mjs` prompts for the password (never echoed), then runs:

```
PixInsight.exe -n=7 --automation-mode --no-startup-scripts --no-modules ^
  --xssk-file="<keys>.xssk" --xssk-password="..." ^
  --sign-module-file="<module>.dll" --force-exit
```

`--no-modules --no-startup-scripts` cut this to **~5 seconds**. Errors go to
stdout (`*** Fatal Error: LoadSigningKeysFile(): wrong password ...`).

> ⚠️ **On Windows this MUST be launched through `cmd` with the value arguments
> quoted** (`--xssk-password="..."`), which is what `sign.mjs` does. If you shell
> out with `spawnSync(exe, [args])` and no shell, Node synthesises the command
> line and leaves `--xssk-*=value` **unquoted** when the value has no spaces.
> PixInsight then loads the key fine (a *wrong* password still errors cleanly)
> but **crashes during the actual sign** — `STATUS_STACK_BUFFER_OVERRUN`
> (`0xC0000409`), with no message, because a `-n --automation-mode` process has
> no console. The quoting is the fix; this cost real debugging time.

`--sign-xml-file` signs `.xri` **in place** — so the same command re-signs
`pi-repo/updates.xri` after `scripts/build-pi-repo.ps1` rebuilds the zip, replacing
what used to be a manual step.

Success is detected by the **artifact** — a freshly written `.xsgn` — not the exit
code, which is unreliable for this GUI process.

> **Keys file is `.xssk`** ("PixInsight XML Secure Signing Keys"), not `.xkeys`.
> It is XML holding an Ed25519 key pair, with the private key encrypted under a
> "custom algorithm based on AES-256" (Pleiades' wording; KDF unpublished).

> **Password exposure:** `--xssk-password` is visible in the process table for the
> ~5 s the process lives. Pleiades' own guidance is to use it only on a trusted
> machine. Omitting it makes PixInsight prompt interactively instead.

> **Password characters (Windows):** the sign command goes through `cmd`, which
> expands `%PI_SIGN_PASSWORD%` — a password containing `"` or `%` will be
> mangled by cmd's quoting/expansion and fail. If yours does, sign on
> macOS/Linux (argv is passed verbatim there) or change the key's password.

### Why signing cannot be done outside PixInsight

Worth recording, because it looks tractable and is not:

- The signature is **Ed25519** (64-byte signature, 32-byte public keys) over a
  **SHA-512** digest — both stock, trivially reimplementable.
- **Blocker 1:** the `.xssk` private key is encrypted with an undocumented KDF, so
  the key cannot be extracted without the core app.
- **Blocker 2:** the *module* signing preimage is undocumented. (The *script*
  preimage is fully specified at
  [ScriptCodeSigning](https://pixinsight.com/doc/docs/ScriptCodeSigning/ScriptCodeSigning.html);
  the module equivalent never was.) Brute-forcing 943 plausible constructions
  against a known-good Pleiades signature found no match.
- There is **no standalone signing tool** in `bin/`, and the `Security`
  implementation lives in the closed core binary, not in the open PCL source.

Since `--sign-module-file` exists and takes ~5 s, none of this is worth pursuing.

### The full build flow

```
build.mjs     regenerate embedded handlers -> compile -> warn "unsigned"
sign.mjs      prompt password -> native CLI signing (~5 s) -> produce .xsgn
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
| `-n[=<slot>]` / `--new` | new instance in slot 1–256 |
| `-y[=<slot>]` / `--yield` | yield to an already-running instance |
| `-r=<script>` | run a PJSR script after startup (repeatable, ordered) |
| `-x=[<slot>:]<script>` | send a script-execution IPC command **to a running instance** |
| `--force-exit` | exit after all `-r` scripts complete |
| `--no-modules`, `--no-startup-scripts`, `--no-splash` | the real startup-time reducers |
| `-e` / `--enumerate` | list running instances + PIDs |
| `--terminate=<slot>` | terminate an instance |

There is **no** `--headless` / `--no-gui` / offscreen mode — a GUI process always
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

- **Do not construct Qt-backed objects (`Timer`) at module-install time** — it
  crashes `InitializePixInsightModule`. Allocate lazily on Start.
- **`Version()` must use the `PCL_MODULE_VERSION` macro**, not a hand-rolled string.
- **MSVC caps string literals at ~16 KB** — hence the chunked raw literals in the
  generated `BridgeHandlersJS.h`.
- **A PJSR script cannot do this.** A running script holds PixInsight's single main
  thread, and a background `Timer` does not survive the script returning (verified).
  That is the entire reason this module exists.
