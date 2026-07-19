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

## "Thin shell" scope (this MVP)

The goal of this first cut is to **prove the non-blocking timer architecture**,
not to reimplement every command handler. It:

- Registers a Process + Interface (`MCP Watcher`, under the `Utilities` category).
- Owns a periodic `pcl::Timer` (default 300 ms) that polls
  `~/.pixinsight-mcp/bridge/commands` and writes results to `.../results`.
- Implements a **minimal native handler set** (`ping`, `list_open_images`) so we
  can confirm the bridge round-trips *while PixInsight remains usable*.
- Exposes a tiny UI: status + Start/Stop, so the timer is easy to control.

Once the architecture is confirmed, we extend `BridgePoller::Dispatch()` with the
remaining handlers (open/save/close image, statistics, run_pixelmath, the
process wrappers) — either natively in C++ (preferred, full module) or by
delegating a tick to the existing JS logic (see "JS delegation" below).

## Files

- `src/MCPWatcherModule.{h,cpp}`   — module metadata + install entry point
- `src/MCPWatcherProcess.{h,cpp}`  — MetaProcess (so it appears in Process Explorer)
- `src/MCPWatcherInterface.{h,cpp}` — ProcessInterface: hosts the pcl::Timer + UI
- `src/BridgePoller.{h,cpp}`       — file polling + command dispatch (the real work)
- `src/json.hpp`                   — (TODO) single-header JSON lib, see below

## JSON

The bridge exchanges JSON files. PCL ships no JSON parser. For the MVP the
envelope fields we need (`id`, `tool`) are extracted with a tiny hand parser in
`BridgePoller`. For full command parameters, drop in
[`nlohmann/json`](https://github.com/nlohmann/json) as `src/json.hpp` and switch
`BridgePoller` to it (integration point marked `// TODO(json)`).

## JS delegation (optional, for the "thinnest" shell)

Instead of porting handlers to C++, the timer tick could execute the existing JS
watcher's per-command logic. The clean way is to refactor
`../pjsr/pixinsight-mcp-watcher.js` to expose a `processPendingCommands()` that
does NOT loop, then have the module run it once per tick. Running PJSR from a
module needs the core script-execution API — marked `// TODO(js-delegation)` in
`MCPWatcherInterface`. Deferred until we confirm that API on the installed PCL.

## Build (deferred — not built yet)

Requires the PixInsight Class Library (PCL) and a C++17 toolchain.

1. Clone PCL: https://gitlab.com/pixinsight/PCL  → set `PCLDIR`, `PCLSRCDIR`,
   `PCLINCDIR`, `PCLLIBDIR`, `PCLBINDIR` env vars.
2. On Windows: MSVC (Visual Studio Build Tools, x64). PixInsight modules build
   as `.dll` named `MCPWatcher-pxm.dll`.
3. Use the PCL module makefile pattern (see PCL's `src/modules/processes/*` for
   templates) or a CMake wrapper. A skeleton `Makefile` will be added once the
   toolchain is chosen.
4. Install the built `*-pxm.dll` into `<PixInsight>/bin/` (or via
   Process > Modules > Install Modules).

## Signing

`AllowUnsignedModuleInstallation = false` by default — unsigned modules are
**blocked** (stricter than scripts). Options: sign the module with a CPD
identity, or enable unsigned module installation in that instance's security
preferences for local testing.

## Status

**Scaffold only — not compiled or tested.** PCL API signatures below follow
standard PCL conventions but must be checked against the installed PCL version;
uncertain spots are marked `// TODO(pcl)`.
