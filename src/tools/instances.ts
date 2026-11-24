import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";
import { MAX_INSTANCE_SLOT } from "../config.js";
import { runningPixInsightProcesses } from "../pixinsight.js";
import { textContent } from "./content.js";
import { registerTool } from "./register.js";

// PixInsight runs each instance in a slot (PixInsight -n=N), and commands reach a slot through
// the command line interface. Slots cannot be listed without PixInsight showing a dialog, so
// list_instances reports the running processes and use_instance proves a slot with a harmless
// command.

// A probe that has not answered in this time is treated as unreachable.
const PROBE_TIMEOUT_MS = 60_000;

export function registerInstanceTools(server: McpServer, bridge: BridgeClient): void {
  const describeTarget = () => {
    const slot = bridge.getInstance();
    return slot === null ? "the first running instance" : `instance ${slot}`;
  };

  registerTool(server,
    "list_instances",
    "Report how many PixInsight instances are running and which one this session drives. " +
      "Use when the user refers to a specific instance or you need to confirm the target.",
    {},
    async () => {
      const running = await runningPixInsightProcesses();
      if (running === null) return textContent(`Could not read the process list. This session drives ${describeTarget()}.`);
      if (running.length === 0) return textContent("PixInsight is not running.");
      return textContent(
        `${running.length} PixInsight instance${running.length === 1 ? "" : "s"} running ` +
        `(process ${running.join(", ")}). This session drives ${describeTarget()}. ` +
        "An instance started with PixInsight -n=N runs in slot N, and the first one started is slot 1.");
    },
  );

  registerTool(server,
    "use_instance",
    "Route all subsequent PixInsight commands to instance N (as started with PixInsight -n=N). " +
      "Call this when the user says 'use instance N'. Only needed when more than one instance " +
      "is running, otherwise the server already targets the running one.",
    { instance: z.number().int().min(1).max(MAX_INSTANCE_SLOT).describe("Instance slot number to drive") },
    async ({ instance }) => {
      // The probe targets the slot for itself, so calls made meanwhile keep going to the current one.
      try {
        const { images } = await bridge.request<{ images: { id: string }[] }>(
          "list_open_images", {}, { timeoutMs: PROBE_TIMEOUT_MS, instance });
        bridge.setInstance(instance);
        const open = images.length ? images.map((image) => image.id).join(", ") : "none";
        return textContent(`Now driving PixInsight instance ${instance}. Open images: ${open}.`);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not reach instance ${instance}: ${reason} Still driving ${describeTarget()}.`, { cause: error });
      }
    },
  );
}
