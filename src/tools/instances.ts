import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { discoverInstances } from "../bridge/discover.js";

/**
 * Multi-instance routing tools. N PixInsight instances (PixInsight.exe -n=N)
 * write per-slot bridges; the server auto-detects the live one at startup. When
 * more than one is live, the user says "use instance 2" in the prompt and the
 * agent calls use_instance to route there, no env vars or re-registration.
 *
 * These are server-orchestration tools (they pick which bridge dir to talk to),
 * not bridge verbs, so the logic is TS-side by nature: the module cannot see the
 * conversation that decides which instance to drive.
 */
export function registerInstanceTools(server: McpServer, bridge: BridgeClient): void {

  function formatList(): Promise<string> {
    return discoverInstances().then((instances) => {
      if (instances.length === 0) {
        return "No PixInsight bridge instances found. Launch PixInsight and open the MCP Watcher panel.";
      }
      const active = bridge.getBridgeDir();
      const lines = instances.map((i) => {
        const mark = i.bridgeDir === active ? " (active)" : "";
        const state = i.live ? "live" : "down";
        const id = [i.version ? `v${i.version}` : null, i.pid ? `pid ${i.pid}` : null]
          .filter(Boolean)
          .join(", ");
        return `- instance ${i.slot}: ${state}${id ? ` [${id}]` : ""}${mark}`;
      });
      return lines.join("\n");
    });
  }

  // list_instances, what PixInsight instances exist and which one is active.
  server.tool(
    "list_instances",
    "List the PixInsight instances the bridge can see, whether each is live (its watcher " +
      "is running), and which one this session is currently driving. Use when the user " +
      "refers to a specific instance or you need to confirm the active target.",
    {},
    async () => ({ content: [{ type: "text" as const, text: await formatList() }] })
  );

  // use_instance, route subsequent commands to a specific live instance.
  server.tool(
    "use_instance",
    "Route all subsequent PixInsight commands at instance N (as launched with PixInsight.exe " +
      "-n=N). Call this when the user says 'use instance N'. Only needed when more than one " +
      "instance is live; with a single live instance the server already targets it.",
    { instance: z.number().int().min(1).describe("Instance/slot number to drive") },
    async ({ instance }) => {
      const instances = await discoverInstances();
      const match = instances.find((i) => i.slot === instance);
      const live = instances.filter((i) => i.live).map((i) => i.slot);

      if (!match || !match.live) {
        return {
          content: [{
            type: "text" as const,
            text:
              `Instance ${instance} is not live. ` +
              (live.length
                ? `Live instances: ${live.join(", ")}. Launch it (PixInsight.exe -n=${instance}) and open the MCP Watcher panel, or pick a live one.`
                : `No live instances detected. Open the MCP Watcher panel in the PixInsight instance you want to drive.`),
          }],
          isError: true,
        };
      }

      bridge.setBridgeDir(match.bridgeDir);
      await bridge.ensureDirectories();
      return {
        content: [{
          type: "text" as const,
          text: `Now driving PixInsight instance ${instance}${match.version ? ` (v${match.version})` : ""}. Bridge: ${match.bridgeDir}`,
        }],
      };
    }
  );
}
