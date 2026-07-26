# Plan: multi-instance bridge isolation (2 Claude sessions ↔ 2 PixInsight instances)

Status: CODE IMPLEMENTED 2026-07-26, plus a heartbeat auto-detect layer added
on top (the manual `PIXINSIGHT_MCP_INSTANCE` per-session env was rejected as
clunky). Now: watchers write `bridge-N/heartbeat.json` every ~2s; the server
scans heartbeats at startup and auto-targets the single live instance, or (with
several live) defaults to the lowest and switches on a `use_instance` tool call
("use instance N" in the prompt). Env pins still work as a manual override.
New code: module heartbeat (BridgePoller), JS watcher mirror, `src/bridge/
discover.ts`, retargetable BridgeClient, `src/tools/instances.ts`
(list_instances/use_instance), auto-detect in index.ts. Tests:
`test/bridge-dir.test.mjs`, `test/bridge-discover.test.mjs`. Module now 1.3.2.

Manual steps remaining (need the dev machine, cannot run from the agent):
  1. Native module rebuild-sign-install (`module:sign` → `module:install` as
     admin, PixInsight closed) to ship 1.3.2 (heartbeat). Build already done.
  2. E2E verification (launch a `-n=2` instance; open both Watcher panels;
     confirm auto-detect picks the single live one and "use instance N" switches
     when both are up).

Open questions resolved: (1) `CoreApplication.instance` exists on 1.9.4 and
returns the slot (probed: slot 1 → `1`); env fallback (`PIXINSIGHT_MCP_INSTANCE`)
wired anyway. (2) `install.mjs`/repo packaging have no bridge refs, unaffected.
TS side + drift check green, no `HANDLERS_REVISION` bump (dir constants kept
outside the handler sentinels; hash lock unchanged). Server-side resolution
covered by `test/bridge-dir.test.mjs`.

Original plan below, for reference.

## Goal

Run N PixInsight instances and N Claude sessions on one machine, each pair isolated: commands
from session A never land on instance B. Today that fails silently, both instances poll the
same commands dir and whichever timer fires first steals the command.

## Current state (verified 2026-07-26)

The bridge dir `~/.pixinsight-mcp/bridge` is hardcoded in FOUR spots:

1. `module/src/BridgePoller.cpp:23` (`Initialize()`), poller dirs.
2. `module/src/BridgePoller.cpp:139-140` (`HandleCommandFile()`), the JS wrapper re-derives
   the RESULT path from `File.homeDirectory` instead of using `m_resultsDir`. Must be fixed
   even for single-instance hygiene.
3. `pjsr/pixinsight-mcp-watcher.js:31` (`BRIDGE_DIR`), the legacy JS watcher's own polling
   loop. NOTE: the embedded HANDLER section contains NO dir references (verified), so this
   change does NOT touch `BridgeHandlersJS.h` semantics → **no `HANDLERS_REVISION` bump**,
   but `scripts/handlers-rev.lock.json` will flag if the handler-section hash moves, keep the
   dir constants outside the handler section.
4. `src/types.ts:110` (`DEFAULT_CONFIG.bridgeDir`), with a comment explaining a server-only
   override would silently break the bridge (true today; this plan makes both sides agree).

## Design

Convention keyed on the PixInsight **instance slot** (PI supports numbered instances,
`PixInsight.exe -n=N`):

- Slot 1 (default): `~/.pixinsight-mcp/bridge` (unchanged, full back-compat).
- Slot N>1: `~/.pixinsight-mcp/bridge-<N>`.

Server side: `PIXINSIGHT_MCP_BRIDGE_DIR` env var, explicit path override (wins over
everything). Convenience alias `PIXINSIGHT_MCP_INSTANCE=N` → resolves the slot convention.
Per-session wiring: each Claude session registers its own MCP server with the env var, e.g.
`claude mcp add pixinsight --env PIXINSIGHT_MCP_INSTANCE=2 -- node build/index.js`.

## Changes

### module (C++), one rebuild-sign-install cycle
- `BridgePoller::Initialize()`: resolve slot → derive `m_bridgeDir` per convention.
  Slot resolution, in order of preference (VERIFY first, see Open questions):
  1. PJSR: `coreApplication.instance` via a one-shot `Module->EvaluateScript` (Initialize
     runs at Start on the root thread, so EvaluateScript is legal there; do NOT do this at
     module-install time, same class of trap as the Timer-at-install crash).
  2. If a native PCL getter exists (`PixInsightSettings`?), prefer it.
- `HandleCommandFile()`: pass `m_resultsDir` INTO the JS wrapper string (escaped path
  literal) instead of re-deriving from `File.homeDirectory` (:139-140).
- Show the resolved dir in the interface panel (it already prints `Bridge:`), free debugging.
- Version: patch bump via the normal `module/version.mjs` auto-bump (module sources changed,
  handlers did not).

### watcher JS (legacy channel, keep in sync)
- `pjsr/pixinsight-mcp-watcher.js:31`: same slot resolution (`coreApplication.instance`),
  keep it OUTSIDE the handler section so the handlers hash/lock is untouched.

### MCP server (TS)
- `src/types.ts`: `bridgeDir` = `PIXINSIGHT_MCP_BRIDGE_DIR` || slot convention from
  `PIXINSIGHT_MCP_INSTANCE` || default. Update the "single canonical location" comment to
  describe the shared convention instead.
- Startup banner already prints the bridge dir (`src/index.ts:50`), keep.

### Docs
- `docs/bridge-protocol.md`: dir convention section.
- `docs/dev-setup.md`: how to run a second instance (`-n=2`) + register a second MCP server.

## Verification

1. Unit: bridge-client test for env resolution (both vars, precedence).
2. `npm run build` (drift check must stay green, no rev bump expected).
3. E2E: start PI slot 1 + slot 2 (`-n=2`), two MCP servers with `PIXINSIGHT_MCP_INSTANCE=1/2`;
   `open_image` a different file through each; `list_open_images` on each must show ONLY its
   own; confirm `~/.pixinsight-mcp/bridge-2/` exists and slot 1 layout is unchanged.
4. Back-compat: single instance + no env vars behaves byte-identically.

## Cautions / scope notes

- Two PI instances share one GPU: parallel BXT/SXT/NXT will contend, that's a throughput
  fact, not a bridge bug; don't chase it as one.
- Parallel TRAINING runs: processing isolates fine, but retro/KB-edit phases write shared
  files (`docs/PROCESSING_JOURNAL.md`, playbooks) and kb-gate uses fixed view ids/result
  dirs. Serialize retro+gate across sessions; only the processing phase parallelizes.
- The shutdown file (`BRIDGE_DIR/shutdown`, watcher.js:807) inherits isolation for free once
  BRIDGE_DIR is per-slot.

## Open questions (answer before coding)

1. Verify `coreApplication.instance` exists and returns the slot in PJSR on 1.9.4 (run
   `run_script` with it; also check inside a `-n=2` instance). If absent, find the PCL/PJSR
   equivalent or fall back to an env var read (`PIXINSIGHT_MCP_INSTANCE` set when launching
   PI) + dialog override.
2. Does `install.mjs`/repo packaging care about the bridge dir? (Believed no, verify.)
