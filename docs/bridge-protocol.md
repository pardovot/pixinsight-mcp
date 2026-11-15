# Bridge Protocol

For each call the MCP server writes a command file and a short driver script, then asks the
running PixInsight to execute the script through its command line interface:

```
PixInsight -x=<bridge>/scripts/<id>.js          first running instance
PixInsight -x=N:<bridge>/scripts/<id>.js        instance in slot N
```

The driver includes the handler bundle (`build/pjsr/mcp-handlers.js`), reads the command, passes it
to `dispatchCommand`, and writes the result file. Nothing is installed inside PixInsight.

## Files

```
~/.pixinsight-mcp/bridge/     PIXINSIGHT_MCP_BRIDGE_DIR overrides
  commands/<id>.json          the request, written by the server
  scripts/<id>.js             the driver PixInsight executes
  results/<id>.json           the outcome, written by the driver
```

Both sides write to `<name>.tmp` and rename, so a reader never sees a partial file. The server
deletes all three files of a call once it has the result or gives up. At startup it also deletes
any bridge file older than ten minutes, left by a session that died during a call.

## Command

```json
{
  "id": "0b6c0f9e-1f3e-4b52-9a4e-6b1f1d0e2c11",
  "timestamp": "2026-11-15T09:12:03.512Z",
  "tool": "run_process",
  "parameters": { "processId": "GradientCorrection", "settings": {} },
  "targetView": "M106"
}
```

| Field | Meaning |
|---|---|
| `id` | UUID, also the file name of the driver and the result |
| `timestamp` | Creation time. The handlers refuse a command older than ten minutes, so a request PixInsight reaches only after a long process never fires once its caller has given up |
| `tool` | Verb, a key of `ROUTES` in `pjsr/dispatch.js` |
| `parameters` | Verb arguments, as JSON |
| `targetView` | View a process runs on, or `null` to run it globally. Only `run_process` uses it |

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
| `Timeout` | No result within the timeout. The call may still run later, its result is then cleaned up |
| `MalformedResult` | The result file stayed unparseable for two seconds |

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
| `get_process_parameters` | `processId` | `parameters`, name to default value |
| `get_history`, `undo`, `redo` | `viewId`, and `steps` for undo and redo | `historyIndex`, `canUndo`, `canRedo`, and `undone` or `redone` |
| `get_full_history` | `viewId`, `maxParamLines` | the history position, `stepCount`, `steps[]` |
| `snapshot`, `restore` | `viewId`, `snapshotId` | `snapshotId` and geometry, or `historyIndex` |
| `export_container` | `viewId`, `outputPath`, `iconName`, `fromIndex`, `toIndex` | `path`, `count`, `processes`, `fromIndex`, `toIndex` |
| `get_noise`, `get_background_gradient`, `get_background_neutrality`, `get_star_metrics`, `get_structure_color` | `viewId` and the options of each verb | the measurement |
| `render_view` | `viewId`, `outputPath`, `stf`, `rect`, `downsample`, `quality` | `path`, `width`, `height`, the stretch applied, `warnings` |

The MCP tool definitions in `src/tools/` document each option.
