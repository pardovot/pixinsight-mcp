# Architecture

A stdio MCP server drives a running PixInsight. PixInsight has no socket or HTTP API, and nothing
written in PJSR can stay resident without holding the main thread, so each command is delivered as
a short script through PixInsight's documented command line interface (`PixInsight -x=<script>`).
The script runs in the user's own session, writes a result file and returns. The wire format is in
[bridge-protocol.md](bridge-protocol.md).

```
  MCP client
        │  MCP (stdio, JSON-RPC 2.0)
        ▼
  MCP server, src/ (TypeScript → build/)
        │  writes commands/<id>.json and scripts/<id>.js
        │  runs PixInsight -x=[<slot>:]scripts/<id>.js
        ▼
  PixInsight, the user's session
        │  #include build/pjsr/mcp-handlers.js, dispatchCommand(command)
        ▼
  results/<id>.json, read by the server
```

## Code layout

```
src/
  index.ts              server entry, registers the tool groups
  config.ts             bridge directory, instance slot and timeouts from the environment
  pixinsight.ts         the PixInsight executable per platform, the running process check
  bridge/protocol.ts    command and result types
  bridge/client.ts      BridgeClient: command files, driver script, -x handoff, result polling
  facts/                verified tool defects, and the guard run_process checks them with
  tools/                one file per tool group, plus register.ts, content.ts and fields.ts
pjsr/
  core.js               shared helpers: the global object, requireView, success
  images.js processes.js history.js export.js render.js
  measure-common.js     helpers of the measurement verbs, one measure-*.js file per verb
  dispatch.js           ROUTES, verb to handler, and dispatchCommand
scripts/
  build-pjsr-bundle.mjs joins pjsr/ into build/pjsr/mcp-handlers.js
  check-handler-drift.mjs
  ping.mjs
test/                   node --test suites, no PixInsight needed
```

## MCP server

- `BridgeClient.call` runs one verb and returns the result, `BridgeClient.request` returns its
  outputs or throws the handler's error.
- Tools are registered through `src/tools/register.ts`. Every argument list is a strict object, so
  a misspelled argument fails the call instead of being dropped while the tool runs with defaults,
  and a thrown error becomes an error result the assistant can read.
- `run_process` runs any PixInsight process by class name and `get_process_parameters` lists its
  settable parameters. Every process is `new X, set parameters, executeOn(view)`, so one generic
  tool covers all of them and there are no per process tools. With processId `Script` it runs a
  script file through the `run_script` verb, and `get_process_parameters("Script")` describes the
  settings (`src/tools/script.ts`).
- `run_process` checks each call against `src/facts/facts.ts` first and refuses the ones that hit
  a verified defect. `PIXINSIGHT_MCP_ALLOW_UNSAFE=1` on the server process disarms that, it is
  deliberately not a tool parameter.

## Handlers

- Everything that runs inside PixInsight lives in `pjsr/`. The server sends a verb and its
  parameters as data, never PJSR source, and the driver script is fixed boilerplate that calls
  `dispatchCommand`.
- The bundle is built with the server and ships in the npm package next to it, so the two cannot
  drift apart. Every driver includes it afresh, so a handler change is live on the next command.
- `scripts/check-handler-drift.mjs`, part of `npm run build`, fails when a tool sends a parameter
  its handler never reads.

## Script runs

`run_process` with processId `Script` sends the `run_script` verb. Its driver includes the named
script file inside `runIncludedScript`, on the engine the script declares. The function's parameters
shadow `Parameters`, `Dialog`, `MessageBox`, `console` and the file pickers, and keep the script's
top level declarations out of the persistent global scope.

| File | Part |
|---|---|
| `pjsr/scripts.js` | The handler: the sandbox (`Parameters`, message boxes, pickers), the engine for the run, the result |
| `pjsr/script-engines.js` | Taking over dialogs and the console on each engine, and applying a dialog's settings |
| `pjsr/script-controls.js` | Finding, describing and setting a dialog's controls, one table entry per kind of control |

- The legacy engine resolves native methods through prototypes, so `Dialog.prototype.execute` is
  patched and a dialog is never shown, and `ok`, `cancel` and `done` record how a handler closed it.
- On V8 `execute` cannot be replaced, so the `Dialog` substitute builds the real dialog and a timer
  drives it once it has been open for two checks, each time the script opens it. A dialog closed
  while `execute` is still showing it stays modal and invisible, so one that stays hidden while its
  run goes on is closed once more. A script's own `onShow` is wrapped, since it may run processes
  that let the timer run during `show()`, and the dialog counts as open once it has returned. The
  run never adds an event handler the script did not set, such as `onExecute`: PixInsight keeps it
  connected after the run, and calls into the finished script.
- A dialog is driven by setting its controls and clicking the requested button or its own OK
  button, so the script's handlers run as they would for a user. A run is stopped after 10 dialogs
  or 30 messages, since a script that keeps asking gets the same answer every time.
- Controls are found through the properties a script assigns and, on V8, a dialog's children. A
  control's label is the one laid out beside or above it, read from positions, which a dialog has
  even when never shown. On the legacy engine a control only a local variable holds cannot be
  reached: the engine does not list children, and recording controls at construction or sampling
  positions with `childByPos` make PixInsight read freed memory in later runs.
- A run's objects are garbage collected before it returns. A script's dialogs otherwise live on
  until some later collection, and their controls keep reacting to PixInsight, a view list to an
  image closing, calling into the finished script. With enough of them left over, PixInsight reads
  freed memory.

## Instances

PixInsight runs up to 256 instances, one per slot (`-n=N`). With no slot selected the server
targets the first running instance (`-x=<script>`), otherwise `-x=N:<script>`. A request to an
empty slot makes PixInsight show a modal error and wait. The process that hands a request over
normally exits within about a second, even when the instance is busy, so one still alive after
15 s is killed, which also closes the dialog.

## Design decisions

- **Command line handoff, not a resident listener.** PJSR is single threaded: a running script
  holds the main thread, modeless script interfaces do not exist, and a background `Timer` dies
  with the script. The `-x` interface is the one route in that needs nothing installed inside
  PixInsight, at about a second per call.
- **One generic process runner.** A `run_bxt` style wrapper restricts the parameter set and needs
  maintaining per process.
- **Measure, configure, verify.** The tools push the assistant to measure the image before
  configuring a process and to measure again after, since unchanged statistics mean the process
  did nothing.
- **A modal blocks everything.** Any dialog a process raises holds every later command, for
  example Crop on a view with a spline astrometric solution.
