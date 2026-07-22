# Command Bridge Protocol

## Overview

The bridge protocol defines how the MCP server and the watcher (native module, or the fallback PJSR watcher script) communicate through the filesystem. It uses JSON files in a shared directory.

## Directory Structure

```
~/.pixinsight-mcp/
  bridge/
    commands/     # MCP server writes here, watcher reads + deletes
    results/      # Watcher writes here, MCP server reads + deletes
    logs/         # Reserved (created but currently unused)
```

Both sides write files atomically: content goes to `<id>.tmp` (outside every
`*.json` glob) and is then renamed to `<id>.json`, so a reader never sees a
partial file.

## Command File Format

Written by the MCP server to `bridge/commands/{id}.json`. Example — `run_process`
applying AutomaticBackgroundExtractor to an open view:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-01-15T10:30:00.000Z",
  "tool": "run_process",
  "process": "AutomaticBackgroundExtractor",
  "parameters": {
    "processId": "AutomaticBackgroundExtractor",
    "settings": {
      "targetCorrection": 1,
      "replaceTarget": true
    }
  },
  "executeMethod": "executeOn",
  "targetView": "master_hoo"
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `id` | string (UUID) | Unique command identifier |
| `timestamp` | string (ISO 8601) | When the command was created |
| `tool` | string | MCP tool name that originated this command |
| `process` | string | PixInsight process class name |
| `parameters` | object | Process parameters (keys match PJSR property names) |
| `executeMethod` | string | `"executeGlobal"` or `"executeOn"` |
| `targetView` | string \| null | View ID for `executeOn`, null for `executeGlobal` |

## Result File Format

Written by the watcher to `bridge/results/{id}.json`:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-01-15T10:30:05.000Z",
  "status": "success",
  "process": "AutomaticBackgroundExtractor",
  "duration_ms": 4523,
  "outputs": {
    "processId": "AutomaticBackgroundExtractor",
    "applied": ["targetCorrection", "replaceTarget"]
  },
  "message": "AutomaticBackgroundExtractor executed on master_hoo [targetCorrection, replaceTarget]"
}
```

### Error Result

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-01-15T10:30:02.000Z",
  "status": "error",
  "process": "AutomaticBackgroundExtractor",
  "duration_ms": 150,
  "error": {
    "message": "View not found: master_hoo",
    "type": "Error",
    "stack": "..."
  }
}
```

### Status Values

| Status | Meaning |
|---|---|
| `success` | Process completed successfully |
| `error` | Process failed with an error |
| `running` | Reserved: an in-progress ack. The client handles it (keeps polling), but no current watcher emits it |

## Special Commands

Beyond direct process execution, some commands have special handling:

### `list_open_images`

```json
{
  "id": "...",
  "tool": "list_open_images",
  "process": "__internal__",
  "parameters": {}
}
```

Result:
```json
{
  "id": "...",
  "status": "success",
  "outputs": {
    "images": [
      {
        "id": "light_001",
        "filePath": "/data/lights/light_001.xisf",
        "width": 4656,
        "height": 3520,
        "channels": 3,
        "isColor": true,
        "bitDepth": 32
      }
    ]
  }
}
```

### `get_image_statistics`

```json
{
  "id": "...",
  "tool": "get_image_statistics",
  "process": "__internal__",
  "parameters": {
    "viewId": "light_001"
  }
}
```

### `run_script`

Execute an arbitrary PJSR script:

```json
{
  "id": "...",
  "tool": "run_script",
  "process": "__script__",
  "parameters": {
    "code": "console.writeln('Hello from PJSR');"
  }
}
```

## Polling & Timeouts

### MCP Server Side
- Poll `bridge/results/{id}.json` every **200 ms** (`PIXINSIGHT_MCP_POLL_INTERVAL_MS`)
- Default timeout: **300 seconds** (5 minutes) — `PIXINSIGHT_MCP_TIMEOUT_MS`
- On timeout: return an error to the MCP host (the command may still complete
  in PixInsight; its late result file is reaped by the stale cleanup below)
- A result file that stays unparseable past a ~2 s grace window is surfaced as
  a `MalformedResult` error instead of being polled until timeout

### Watcher Side
- Native module: a `pcl::Timer` polls `bridge/commands/` every **300 ms**
- JS watcher (fallback): effective idle cadence ~**500 ms** (25 × 20 ms sleeps)
- Write result immediately after the process completes (or fails)
- Delete the command file after writing the result

### Stale commands
Both sides enforce a **10-minute** age limit:
- The MCP server deletes leftover command files older than 10 minutes at
  startup, and reaps orphaned result files the same way.
- The watcher refuses to execute a command whose `timestamp` is older than
  10 minutes (writes an error result instead), so commands queued by a dead
  session never fire late with surprising side effects.

## Concurrency

- The watcher processes **one command at a time** (PixInsight is single-threaded for most operations)
- The MCP server should queue commands and wait for each to complete before sending the next

## Configuration

The bridge directory is fixed at `~/.pixinsight-mcp/bridge` — the module and the
watcher hardcode it, so a server-only override would silently break the bridge.
The MCP server reads these environment variables (see `src/types.ts`):

| Variable | Default | Meaning |
|---|---|---|
| `PIXINSIGHT_MCP_POLL_INTERVAL_MS` | `200` | Result-poll interval |
| `PIXINSIGHT_MCP_TIMEOUT_MS` | `300000` | Per-command timeout |
| `PIXINSIGHT_MCP_EXTENDED_TIMEOUT_MS` | `3600000` | Reserved for long operations (not currently used by any tool) |
| `PIXINSIGHT_EXE` | per-platform default | PixInsight executable path |
