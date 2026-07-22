#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeClient } from "./bridge/client.js";
import { registerImageManagementTools } from "./tools/image-management.js";
import { registerProcessingTools } from "./tools/processing.js";
import { registerSessionTools } from "./tools/session.js";

// Single version source: package.json (shipped alongside build/ in the npm package).
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8")
) as { version: string };

async function main() {
  const server = new McpServer({
    name: "pixinsight-mcp",
    version,
  });

  const bridge = new BridgeClient();

  // Ensure bridge directories exist on startup
  await bridge.ensureDirectories();

  // Reap leftovers from dead sessions: stale command files (which the watcher
  // would otherwise execute, minutes or days late, the next time it starts) and
  // orphaned result files (written after a client timed out and stopped reading).
  const reaped = await bridge.cleanStaleCommands();
  if (reaped > 0) console.error(`Cleaned ${reaped} stale bridge file(s)`);

  // Register all tool categories
  registerImageManagementTools(server, bridge);
  registerProcessingTools(server, bridge);
  registerSessionTools(server, bridge);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error("PixInsight MCP Server started (stdio transport)");
  console.error(`Bridge directory: ${bridge.getConfig().bridgeDir}`);
}

main().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
