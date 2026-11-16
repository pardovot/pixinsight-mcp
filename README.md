# PixInsight MCP

An MCP server that lets an AI assistant drive PixInsight: open images, measure them, run any
installed process, read the results back. Everything runs in your own PixInsight session, so you
can watch the work happen and take over between steps.

## Install

**1. MCP server.** Any MCP client works, this is a stock stdio server with no client specific code.

Claude Code:

```bash
claude mcp add pixinsight -- npx -y @pardovot/pixinsight-mcp
```

Claude Desktop, Cursor, Windsurf and anything else that takes an `mcp.json`:

```json
{
  "mcpServers": {
    "pixinsight": { "command": "npx", "args": ["-y", "@pardovot/pixinsight-mcp"] }
  }
}
```

Codex CLI, in `~/.codex/config.toml`:

```toml
[mcp_servers.pixinsight]
command = "npx"
args = ["-y", "@pardovot/pixinsight-mcp"]
```

On Windows, if a client cannot resolve `npx`, use `"command": "cmd"` with
`"args": ["/c", "npx", "-y", "@pardovot/pixinsight-mcp"]`.

**2. Start PixInsight** and ask your assistant to list your open images. If it answers, you are
connected. Nothing is installed inside PixInsight.

Requires PixInsight 1.9.4 or later and Node 18 or later.

## Tools

| Category | Tools |
|---|---|
| Processes | `run_process`, `get_process_parameters` |
| Images | `list_open_images`, `open_image`, `save_image`, `close_image`, `get_image_statistics` |
| Measurement | `get_noise`, `get_background_gradient`, `get_background_neutrality`, `get_star_metrics`, `get_structure_color` |
| Rendering | `render_view` |
| History | `get_history`, `get_full_history`, `undo`, `redo`, `snapshot`, `restore` |
| Instances | `list_instances`, `use_instance` |
| Export | `export_container` |

`run_process` runs any process by class name, third party ones included, so a newly installed tool
needs nothing added here. Calls that hit a verified tool defect (a parameter that does nothing, a
setting that hangs PixInsight) are refused with what to do instead, see `src/facts/facts.ts`.

With processId `Script` it runs a script instead, named as in the Script menu or by file path,
through the script's own code and with no user interaction. `inspect` lists the script's dialog
with its controls and buttons, `controls` sets them by name or label (an image picker takes a view
id, a color box `#RRGGBB`, a list the items to check), and `button` clicks one, or else the dialog's
own OK button is clicked so its handler reads the settings. `dialogs` gives settings per dialog for
scripts that open more than one. `parameters` reach scripts that read them like a script instance
dropped on the view. `answers` picks the button for message boxes by a fragment of their text,
others get their first button, and file pickers are cancelled, all reported back. A script that
keeps asking for something the run cannot give is stopped. Windows a script opens stay open and are
listed in the result.

The measurement tools exist so settings come from your frame rather than a tutorial. `get_noise`
returns an MRS estimate, since `stdDev` is dominated by signal on astro frames.
`get_background_neutrality` needs `mode:'poststretch'` once the image is stretched.

## How it works

```
  MCP client
    │  MCP (stdio)
  MCP server                    src/ (TypeScript)
    │  PixInsight -x=<script>   PixInsight's command line interface
  Your PixInsight session
    │  #include
  Handler bundle                build/pjsr/mcp-handlers.js, built from pjsr/
```

For each command the server writes the request to `~/.pixinsight-mcp/bridge/commands`, writes a
short script that includes the handler bundle, and asks the running PixInsight to execute it with
the documented `-x` option. The script runs in your own session, writes its result to
`~/.pixinsight-mcp/bridge/results`, and returns. A call costs about a second on top of the work,
most of it starting the short lived PixInsight process that hands the request over.

PixInsight is busy while a command runs, as it would be had you started the process yourself, and
fully usable between commands. Requests that arrive while it is busy wait in PixInsight's own
queue. The server checks that PixInsight is running before each call, so a closed application
gives an error rather than a dialog.

> Anything that can write to `~/.pixinsight-mcp/bridge` can get code run inside PixInsight. Keep
> the directory private to your user, never on a shared or synced path.

## Several instances

PixInsight can run several instances, each in its own slot (`PixInsight -n=2`). The server drives
the first running instance unless told otherwise. Say "use instance 2" and the assistant calls
`use_instance`, which proves the slot with a harmless command before switching. `list_instances`
reports how many instances are running, and `PIXINSIGHT_MCP_INSTANCE=N` pins a slot for a whole
session.

## Platform

The server, the command line interface and the handlers are the same everywhere, only the
executable is found per platform:

| | Executable | Status |
|---|---|---|
| Windows | `%ProgramFiles%\PixInsight\bin\PixInsight.exe` | verified |
| macOS | `/Applications/PixInsight/PixInsight.app/Contents/MacOS/PixInsight` | unverified |
| Linux | `/opt/PixInsight/bin/PixInsight.sh` | unverified |

## Configuration

Every path is a default an environment variable overrides, so a stock install needs nothing.

| Variable | Default | Purpose |
|---|---|---|
| `PI_ROOT` | probed | PixInsight install root, the executable is derived from it |
| `PIXINSIGHT_EXE` | derived | PixInsight executable, overrides `PI_ROOT` |
| `PIXINSIGHT_MCP_INSTANCE` | first running | instance slot to drive |
| `PIXINSIGHT_MCP_BRIDGE_DIR` | `~/.pixinsight-mcp/bridge` | where command, script and result files go |
| `PIXINSIGHT_MCP_TIMEOUT_MS` | `300000` | timeout of each command |
| `PIXINSIGHT_MCP_POLL_INTERVAL_MS` | `200` | result poll interval |
| `PIXINSIGHT_MCP_ALLOW_UNSAFE` | unset | `1` disarms the refusal of known tool defects |

## Building from source

```bash
npm install
npm run build    # compiles src/, builds the handler bundle, runs the handler drift check
npm test         # lint, build and the test suites
```

Local setup and the layout of the code: [`docs/dev-setup.md`](docs/dev-setup.md) and
[`docs/architecture.md`](docs/architecture.md).

## License

MIT, see [LICENSE](LICENSE).
