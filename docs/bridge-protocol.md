# Bridge Protocol

For each call the MCP server writes a command file and a short driver script, then asks the
running PixInsight to execute the script through its command line interface:

```
PixInsight -x=<bridge>/scripts/<id>.js          first running instance
PixInsight -x=N:<bridge>/scripts/<id>.js        instance in slot N
```

The driver includes the handler bundle (`build/pjsr/mcp-handlers.js`), reads the command, passes it
to `dispatchCommand`, and writes the result file. Nothing is installed inside PixInsight.

A `run_script` call's script arguments follow the driver's path, `-x=<driver>,arg1,arg2`, and the
script reads them as `Runtime.jsArguments`, or `jsArguments` on the legacy engine. PixInsight splits
the list at commas, so an argument with a comma, a quote or a line break is refused. A `run_script`
driver starts with `#engine v8` when the script declares it, and includes the script inside a
function the handler calls:

```
function runIncludedScript( Parameters, Dialog, MessageBox, console, ... ) {
#include "<script path>"
}
runIncludedScript.shadowedNames = ["Parameters", "Dialog", "MessageBox", "console", ...];
```

## Files

```
~/.pixinsight-mcp/bridge/     PIXINSIGHT_MCP_BRIDGE_DIR overrides
  commands/<id>.json          the request, written by the server
  scripts/<id>.js             the driver PixInsight executes
  results/<id>.started        PixInsight's process id, written by the driver as the command starts
  results/<id>.json           the outcome, written by the driver
```

Both sides write to `<name>.tmp` and rename, so a reader never sees a partial file. The server
deletes all four files of a call once it has the result or gives up. At startup it also deletes
any bridge file older than ten minutes, left by a session that died during a call.

## Command

```json
{
  "id": "0b6c0f9e-1f3e-4b52-9a4e-6b1f1d0e2c11",
  "timestamp": "2026-11-15T09:12:03.512Z",
  "tool": "run_process",
  "parameters": { "processId": "GradientCorrection", "settings": {} },
  "targetView": "M106",
  "heartbeat": 1795477923512
}
```

| Field | Meaning |
|---|---|
| `id` | UUID, also the file name of the driver and the result |
| `timestamp` | Creation time |
| `tool` | Verb, a key of `ROUTES` in `pjsr/dispatch.js` |
| `parameters` | Verb arguments, as JSON |
| `targetView` | View a process or script runs on, or `null` to run it globally. Only `run_process` and `run_script` use it |
| `heartbeat` | Epoch milliseconds, refreshed by the server every 10 s until the command starts. The driver skips a command whose heartbeat is older than a minute, so a request PixInsight reaches only after its server gave up or died never fires |

## Result

```json
{
  "id": "0b6c0f9e-1f3e-4b52-9a4e-6b1f1d0e2c11",
  "status": "success",
  "duration_ms": 5711,
  "outputs": { "processId": "GradientCorrection", "applied": [] },
  "message": "GradientCorrection executed on M106 (defaults)"
}
```

```json
{
  "id": "0b6c0f9e-1f3e-4b52-9a4e-6b1f1d0e2c11",
  "status": "error",
  "duration_ms": 1,
  "error": { "type": "Error", "message": "No open view named M106", "stack": "..." }
}
```

`duration_ms` is measured inside PixInsight for results the driver writes, and by the server for
the errors below, which it produces itself:

| `error.type` | When |
|---|---|
| `DispatchError` | PixInsight not running, executable not found, or the target slot has no instance |
| `PixInsightExited` | PixInsight exited before the command started, or the process that started it exited, usually a crash |
| `Cancelled` | The client cancelled the request. A command not yet started never runs, a running one finishes |
| `Timeout` | No result within `PIXINSIGHT_MCP_TIMEOUT_MS` or a call's own limit, saying whether the command started |
| `MalformedResult` | The result file stayed unparseable for two seconds |

## Waiting

A call has no time limit unless `PIXINSIGHT_MCP_TIMEOUT_MS` sets one, since a command may queue
behind other work and then run for hours. While it waits the server checks the PixInsight
processes every 2 s: before the started marker exists any running instance counts, after it the
process it names. When the client asks for progress, the server reports every 10 s whether the
command is still queued or running.

## Handoff

The PixInsight process started for each call passes the request to the running instance and exits
within about a second, even while that instance is busy. Requests that arrive while PixInsight is
busy wait in its own queue and run in order, one at a time. The server issues calls serially.

Two cases would otherwise end in a modal dialog:

- When PixInsight is not running, the server finds no PixInsight process and returns a
  `DispatchError` without starting anything.
- A request to a slot with no instance makes PixInsight show an "instance is not running" error
  and wait. A handoff process still alive 15 s after it started is killed, which closes the
  dialog, and the call fails with a message naming the slot.

A queued driver whose files the server has already removed is skipped by PixInsight without any
message.

## Verbs

| Verb | Parameters | Outputs |
|---|---|---|
| `list_open_images` | | `images[]`: `id`, `filePath`, `width`, `height`, `channels`, `isColor`, `bitDepth` |
| `open_image` | `filePath` | `id`, `width`, `height`, `channels` |
| `save_image` | `viewId`, `filePath`, `overwrite`, `compression` | `filePath`, `hints`, `bytes` |
| `close_image` | `viewId` | |
| `get_image_statistics` | `viewId` | `statistics[]`: `channelName`, `mean`, `median`, `stdDev`, `min`, `max` |
| `run_process` | `processId`, `settings`, plus `targetView` | `processId`, `applied` |
| `run_script` | `filePath`, `parameters`, `dialogs[]` with `controls` and `button`, `answers`, `inspect`, plus `targetView` | `engine`, `milliseconds`, `historyBefore`, `historyAfter`, `newWindows`, `dialogs[]` with `controls`, `applied`, `clicked`, `messages`, `output`, `unusedAnswers` |
| `get_process_parameters` | `processId` | `parameters`, name to default value |
| `get_history`, `undo`, `redo` | `viewId`, and `steps` for undo and redo | `historyIndex`, `canUndo`, `canRedo`, and `undone` or `redone` |
| `get_full_history` | `viewId`, `maxParamLines` | the history position, `stepCount`, `steps[]` |
| `snapshot`, `restore` | `viewId`, `snapshotId` | `snapshotId` and geometry, or `historyIndex` |
| `export_container` | `viewId`, `outputPath`, `iconName`, `fromIndex`, `toIndex` | `path`, `count`, `processes`, `fromIndex`, `toIndex` |
| `get_noise`, `get_background_gradient`, `get_background_neutrality`, `get_star_metrics`, `get_structure_color` | `viewId` and the options of each verb | the measurement |
| `render_view` | `viewId`, `outputPath`, `stf`, `rect`, `downsample`, `quality` | `path`, `width`, `height`, the stretch applied, `warnings` |

The MCP tool definitions in `src/tools/` document each option.
