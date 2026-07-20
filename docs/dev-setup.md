# Development Setup

## Prerequisites

- **Node.js** >= 18
- **PixInsight** >= 1.8.9 (with scripting support)
- **Claude Desktop** or **Claude Code** (for testing the MCP server)
- **OS**: cross-platform is the goal; **Windows 11 is currently the only tested platform**.
  Nothing in the design is Windows-specific. The build tooling is cross-platform Node
  (`module/*.mjs`) with per-platform branches; PixInsight ships PCL project files for all three
  (`src/pcl/{windows/vc17,macosx/g++,linux/g++}`). The macOS/Linux paths are written but have
  not been run yet. Commands below cover all three platforms; only the Windows ones are verified.

## PixInsight Path

Default installation paths:

| OS | Path |
|---|---|
| macOS | `/Applications/PixInsight/PixInsight.app/Contents/MacOS/PixInsight` |
| Linux | `/opt/PixInsight/bin/PixInsight` (typical) |
| Windows | `C:\Program Files\PixInsight\bin\PixInsight.exe` |

## Project Setup

```bash
# Clone
git clone https://github.com/aescaffre/pixinsight-mcp.git
cd pixinsight-mcp

# Install dependencies (once package.json exists)
npm install

# Build
npm run build

# Create bridge directory
mkdir -p ~/.pixinsight-mcp/bridge/{commands,results,logs}
```

## Running PixInsight in Automation Mode

```powershell
# Windows
& "C:\Program Files\PixInsight\bin\PixInsight.exe" -n --automation-mode

# With a slot number (for IPC)
& "C:\Program Files\PixInsight\bin\PixInsight.exe" -n=1 --automation-mode
```

```bash
# macOS
/Applications/PixInsight/PixInsight.app/Contents/MacOS/PixInsight -n --automation-mode
/Applications/PixInsight/PixInsight.app/Contents/MacOS/PixInsight -n=1 --automation-mode

# Linux
/opt/PixInsight/bin/PixInsight -n --automation-mode
/opt/PixInsight/bin/PixInsight -n=1 --automation-mode
```

## Loading the Watcher Script

1. Open PixInsight
2. Open the Script Editor (Script > Script Editor)
3. Open `pjsr/pixinsight-mcp-watcher.js` from this repo
4. Click **Run** (F9)
5. The watcher will start polling for commands in the Process Console

Alternatively, auto-load on startup:

```powershell
# Windows
& "C:\Program Files\PixInsight\bin\PixInsight.exe" -n --automation-mode `
  -r="<repo>\pjsr\pixinsight-mcp-watcher.js"
```

```bash
# macOS / Linux
<PixInsight> -n --automation-mode \
  -r="<repo>/pjsr/pixinsight-mcp-watcher.js"
```

> With the native module installed (see `module/`), the watcher **script is not needed** —
> the module polls the bridge on PixInsight's own event loop and leaves the app interactive.
> The script is an emergency fallback only, and it freezes PixInsight while it runs.

## Configuring Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Restart Claude Desktop after editing.

## Configuring Claude Code

Add to your project's `.mcp.json` or use the CLI:

```bash
claude mcp add pixinsight node /absolute/path/to/pixinsight-mcp/build/index.js
```

## Testing the Bridge Manually

You can test the file bridge without the MCP server:

### Write a test command:
```bash
cat > ~/.pixinsight-mcp/bridge/commands/test.json << 'EOF'
{
  "id": "test-001",
  "timestamp": "2025-01-01T00:00:00Z",
  "tool": "list_open_images",
  "process": "__internal__",
  "parameters": {}
}
EOF
```

### Check for result:
```bash
# Wait a moment for the watcher to process it
sleep 1
cat ~/.pixinsight-mcp/bridge/results/test-001.json
```

## Project Structure (Planned)

```
pixinsight-mcp/
  docs/                    # Knowledge base (you are here)
  src/
    index.ts               # MCP server entry point
    tools/                 # Tool implementations
    bridge/                # File bridge client (write commands, read results)
    types.ts               # Shared type definitions
  pjsr/
    pixinsight-mcp-watcher.js   # PJSR watcher script for PixInsight
    lib/                        # PJSR helper modules
  build/                   # Compiled output
  package.json
  tsconfig.json
```

## Troubleshooting

### MCP server not connecting
- Check Claude Desktop logs: `~/Library/Logs/Claude/`
- Ensure `node` is in PATH or use absolute path in config
- Verify the build output exists at the configured path

### Watcher not picking up commands
- Check the bridge directory path matches in both server and watcher
- Verify PixInsight's Process Console for watcher output/errors
- Ensure file permissions allow both processes to read/write

### PixInsight process errors
- Check `~/.pixinsight-mcp/bridge/logs/` for detailed logs
- Open PixInsight's Process Console for script errors
- Verify file paths are absolute and files exist
