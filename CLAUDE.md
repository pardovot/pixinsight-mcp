# pixinsight-mcp

`github.com/pardovot/pixinsight-mcp`, npm `@pardovot/pixinsight-mcp`. Connection check:
`npm run ping`. Layout: `docs/architecture.md`.

## ⛔ CROSS PLATFORM BY DEFAULT
Every new script, path and default is written cross platform from the start, not ported later.
- **Node, not shell.** New tooling goes in `.mjs`, exposed via `npm run` scripts. No `.bat` or
  `.sh`: a per OS shim gives one platform a shortcut the others lack.
- **Derive paths, never hardcode them**: `process.env.ProgramFiles`, `os.homedir()`, `path.join()`,
  per platform candidate probing. No literal `C:\...` or `/Applications/...` outside a per platform
  fallback branch.
- **Windows only is a fact about testing, not about design.** Write all three branches and mark
  which are verified. Unverified is not unsupported, never delete another platform's branch or
  instructions.
- Genuinely platform bound pieces (the executable path, `tasklist` vs `pgrep`) get per platform
  branches in one module, `src/pixinsight.ts`.

## Environment
- Dev machine: Windows 11, stock PixInsight install.
- Linux and macOS: unverified. On Linux `bin/PixInsight` is not launchable, the launcher
  `bin/PixInsight.sh` is, so that is what the server runs. Setup per platform: `docs/dev-setup.md`.
- **PixInsight 1.9.4+ "Lockhart" has two script engines.** A script runs on V8 only when it
  declares `#engine v8`, every other script runs on the legacy engine. The bridge driver runs on the
  legacy engine, except a Script run of a V8 script, so `pjsr/` must run on both. The legacy engine
  has no `globalThis` (`pjsr/core.js` captures the global object with `Function("return this")()`).
  `processEvents()` is a global function on both engines.
- PJSR files use `var` at top level: every `-x` script runs in one persistent global scope, so the
  bundle is evaluated again on each command, and a second top level `const` or `let` of the same
  name throws.
- The legacy engine accepts arrow functions, `let`/`const` inside functions and trailing commas in
  array and object literals. It rejects `class`, template literals, trailing commas in calls and
  parameters, `?.` and `??` with a syntax error that kills the whole driver, so the command times
  out. ESLint enforces this on `pjsr/`.
- PixInsight's preprocessor reads a slash star as the start of a block comment even inside a line
  comment, string or regex, and swallows the code up to the next star slash, so every command fails
  to parse and times out. `scripts/build-pjsr-bundle.mjs` refuses to build a `pjsr/` file that
  contains one.
- On V8, native methods are read only own properties of each instance (`dialog.execute`,
  `console.writeln`), and a native class such as `Dialog` can only be built with `new` or
  `Reflect.construct`. On the legacy engine they live on the prototype and can be patched there.

## The command line transport
PJSR is single threaded: a running script holds the main thread, modeless script interfaces do not
exist, and a background `Timer` dies with the script, so nothing can stay resident inside
PixInsight. Each command is instead a short driver script handed to the running instance with
`PixInsight -x=[<slot>:]<script>` (`BridgeClient.dispatch` in `src/bridge/client.ts`). The driver
includes the bundle, calls `dispatchCommand`, writes the result and returns.
- About 1.2 s per call on top of the work, nearly all of it starting the handoff process. Requests
  sent while PixInsight is busy queue in PixInsight and run in order.
- A request to an empty slot (or `-e`, `--help`) shows a **modal** dialog and the handoff process
  waits on it, which is why the server checks for a running PixInsight first and kills a handoff
  still alive after 15 s, which closes the dialog.
- Any modal a process raises blocks every later command, e.g. Crop on a view with a spline
  astrometric solution (Crop's `noGUIMessages` parameter exists to suppress it, untested).
- `executeOn`/`executeGlobal` return false when a process refuses to run (a missing license
  reports only in the Process Console). The handlers turn that into an error, never a success.

## ⛔ ONE GENERIC PROCESS RUNNER
**Never add a per process MCP tool.** `run_process(processId, viewId?, settings?)` runs any process
by class name and `get_process_parameters(processId)` lists its settable parameters. A `run_bxt`,
`denoise` or `run_pixelmath` style wrapper restricts the parameter set and needs maintaining per
process.

Verified tool defects go in `src/facts/facts.ts`, where `run_process` enforces them: objective,
reproducible tool behaviour only, never a preference.

## ⛔ WHERE LOGIC LIVES

| Home | For |
|---|---|
| `pjsr/*.js` | Everything that runs in PixInsight, one file per verb group, routed in `pjsr/dispatch.js` |
| `src/tools/*.ts` | Tool definitions, input validation, formatting results for the assistant |

The server sends a verb and its parameters as data, never PJSR source. The one exception is a
Script run (`run_process` with processId `Script`): its driver includes the script file the caller
names, inside `runIncludedScript`, on the engine the script declares (`driverSource` in
`src/bridge/client.ts`, the handler in `pjsr/scripts.js` with `pjsr/script-engines.js` and
`pjsr/script-controls.js`). A new PJSR file is added to
`PJSR_SOURCES` in `scripts/build-pjsr-bundle.mjs`, a new verb to `ROUTES`.

⛔ **Never implement a verb on both sides.** Two implementations drift, and the handler is left
silently wrong: a `save_image` that adds compression on the TS side leaves the handler writing
uncompressed files for every other caller.

`scripts/check-handler-drift.mjs` (runs in `npm run build`) fails when a tool sends a bridge
parameter its handler never reads.

`npm run lint` checks code and formatting, `npm run lint:fix` fixes what it can. `npm test` runs
lint, build and the tests. `npm run build` covers both sides. `npm run smoke:scripts` checks
Script runs against a running PixInsight, run it after a change to a `pjsr/script*.js` file, and
look for access violations (`C0000005`) in the Process Console afterwards: PixInsight catches them,
so no check fails. A handler change is live on the next
command, since every driver includes the bundle afresh, a TS change needs an MCP restart.