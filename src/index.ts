#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeClient } from "./bridge/client.js";
import { registerImageManagementTools } from "./tools/image-management.js";

// package.json ships next to build/ in the npm package, so it is the one version source.
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
  version: string;
};

const TOOL_GROUPS = [
  registerImageManagementTools,
];

const bridge = new BridgeClient();
await bridge.ensureDirectories();
const stale = await bridge.cleanStaleFiles();

const server = new McpServer({ name: "pixinsight-mcp", version: packageJson.version });
for (const register of TOOL_GROUPS) register(server, bridge);
await server.connect(new StdioServerTransport());

// stdout carries the MCP protocol, so diagnostics go to stderr.
console.error(`pixinsight-mcp ${packageJson.version} ready, bridge ${bridge.bridgeDir}` +
  (stale ? `, removed ${stale} stale bridge file(s)` : ""));
