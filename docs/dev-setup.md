# Development Setup

Everything here is cross platform. Where a command differs per platform, all three are given.

| Platform | Status |
|---|---|
| Windows 11 | verified: `npm test`, every tool against a live PixInsight, instance routing and the not running guard |
| Linux | unverified |
| macOS | unverified |

## Prerequisites

- Node.js 20.19 or later for development (ESLint needs it), installed for the same OS that runs
  PixInsight. The published server runs on Node 18 or later.
- PixInsight 1.9.4 "Lockhart" or later.
- An MCP client.

No compiler, no signing identity and nothing installed inside PixInsight.

## Paths

Nothing is hardcoded. `src/pixinsight.ts` probes per platform and every value takes an environment
override:

| OS | Install root (`PI_ROOT`) | Executable |
|---|---|---|
| Windows | `%ProgramFiles%\PixInsight` | `bin\PixInsight.exe` |
| macOS | `/Applications/PixInsight` | `PixInsight.app/Contents/MacOS/PixInsight` |
| Linux | `/opt/PixInsight` | `bin/PixInsight.sh` |

Installed somewhere else? Set `PI_ROOT` and the executable follows, or set `PIXINSIGHT_EXE`
directly.

> On Linux the server runs the launcher, never `bin/PixInsight` beside it. `PixInsight.sh` exports
> `LD_LIBRARY_PATH`, `QT_PLUGIN_PATH` and friends first. Without it the bare binary cannot resolve
> PixInsight's bundled shared libraries and exits immediately (on Ubuntu 24.04, at
> `libssh2.so.1: cannot open shared object file`).

## Project setup

```bash
git clone https://github.com/pardovot/pixinsight-mcp.git
cd pixinsight-mcp
npm install
npm run build          # tsc -> build/, the handler bundle, the handler drift check
```

Register the local build with your client, not the published package. `npx -y
@pardovot/pixinsight-mcp` inside the repo resolves to the checkout and shadows what you meant to
test:

```bash
claude mcp add pixinsight node /absolute/path/to/pixinsight-mcp/build/index.js
```

Any client that takes an `mcp.json`:

```json
{
  "mcpServers": {
    "pixinsight": {
      "command": "node",
      "args": ["/absolute/path/to/pixinsight-mcp/build/index.js"]
    }
  }
}
```

The server and PixInsight must run in the same OS environment: the server starts PixInsight's own
executable to hand commands over, and PixInsight opens every image path the assistant passes
verbatim.

## The edit loop

```bash
npm run build     # then restart the MCP client
npm test          # lint, build and the test suites
```

That covers `src/` and `pjsr/`. Every command includes the handler bundle afresh, so a change
confined to `pjsr/` takes effect on the next call without restarting the client.

To test the package exactly as npm would serve it:

```bash
npm pack                                   # runs the build, writes pardovot-pixinsight-mcp-<version>.tgz
claude mcp add pixinsight-pack -- npx -y /absolute/path/to/pardovot-pixinsight-mcp-<version>.tgz
```

## Running PixInsight

Start it normally. Check the server can reach it:

```bash
npm run ping
```

## Running a second instance

1. Start the second PixInsight in its own slot:

   ```bash
   # Windows
   & "$env:ProgramFiles\PixInsight\bin\PixInsight.exe" -n=2
   # macOS
   /Applications/PixInsight/PixInsight.app/Contents/MacOS/PixInsight -n=2
   # Linux
   /opt/PixInsight/bin/PixInsight.sh -n=2
   ```

2. The server drives the first running instance. Say "use instance 2" and the assistant calls
   `use_instance`, which checks the slot answers before switching. `list_instances` shows how many
   instances are running. `PIXINSIGHT_MCP_INSTANCE=2` pins a session to slot 2 from the start.

> Two instances share one GPU, so BlurXTerminator, StarXTerminator and NoiseXTerminator running in
> both at once contend for it.

## Troubleshooting

**MCP server not connecting.** Check the client's logs. Use an absolute path to `node` if it is
not on the client's PATH, and confirm `build/index.js` exists.

**"PixInsight not found at ...".** The executable was not where the server looked. Set `PI_ROOT`
or `PIXINSIGHT_EXE`.

**Commands time out.** PixInsight runs requests only when its main thread is free, so a long
process or an open modal dialog holds everything behind it. Check PixInsight's window and its
Process Console, which also shows handler errors.

**A process "failed" with no reason.** Many processes report only to the Process Console, a
missing license for example. The error result says so, read the console.
