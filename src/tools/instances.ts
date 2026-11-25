import { setTimeout as delay } from "node:timers/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { currentCallContext } from "../bridge/call-context.js";
import type { BridgeClient } from "../bridge/client.js";
import { MAX_INSTANCE_SLOT } from "../config.js";
import { launchPixInsight, runningPixInsightProcesses } from "../pixinsight.js";
import { textContent } from "./content.js";
import { registerTool } from "./register.js";

// PixInsight runs each instance in a slot (PixInsight -n=N), and commands reach a slot through
// the command line interface. Slots cannot be listed without PixInsight showing a dialog, so
// list_instances reports the running processes and use_instance proves a slot with a harmless
// command. start_instance starts PixInsight itself, which is a process launch, not a command.

// A probe that has not answered in this time is treated as unreachable.
const PROBE_TIMEOUT_MS = 60_000;

// How long a started instance may take to answer, and how often its process is looked for.
const START_TIMEOUT_MS = 180_000;
const START_POLL_MS = 1_000;
// A request sent while PixInsight starts up is accepted and then never runs, so each probe of a
// starting instance gets a short limit and the next one is sent. An idle instance answers in
// under two seconds.
const START_PROBE_TIMEOUT_MS = 5_000;
const MS_PER_SECOND = 1_000;

const slotField = z.number().int().min(1).max(MAX_INSTANCE_SLOT);

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

  const probe = (slot: number | null) =>
    bridge.call("list_open_images", {}, { instance: slot, timeoutMs: START_PROBE_TIMEOUT_MS });

  registerTool(server,
    "start_instance",
    "Start PixInsight and wait until it answers commands. Without instance it starts the one this session " +
      "drives, which needs no PixInsight running yet. With instance N it starts another one in slot N " +
      "(PixInsight -n=N), then call use_instance to drive it. Call this when the user asks to start " +
      "PixInsight, or when a command reports that it is not running.",
    { instance: slotField.optional().describe("Slot to start the instance in") },
    async ({ instance }) => {
      const slot = instance ?? bridge.getInstance();
      const name = slot === null ? "PixInsight" : `PixInsight instance ${slot}`;
      const before = await runningPixInsightProcesses();
      if (before !== null && before.length > 0) {
        if (slot === null)
          throw new Error(`PixInsight is already running (process ${before.join(", ")}). Pass instance to start another one in a free slot.`);
        // Any outcome but a refused handoff means an instance holds the slot, busy or not.
        const held = await probe(slot);
        if (held.status === "success" || held.error.type !== "DispatchError") throw new Error(`${name} is already running.`);
      }

      const started = Date.now();
      const { signal } = currentCallContext();
      await launchPixInsight(slot);
      while (!signal?.aborted && Date.now() - started < START_TIMEOUT_MS) {
        // A request sent before the process exists finds no instance, so the process is waited for first.
        const running = await runningPixInsightProcesses();
        const processStarted = running === null || running.some((processId) => !before?.includes(processId));
        if (processStarted && (await probe(slot)).status === "success") {
          const seconds = Math.round((Date.now() - started) / MS_PER_SECOND);
          return textContent(`Started ${name}, it answered after ${seconds} s. This session drives ${describeTarget()}.`);
        }
        await delay(START_POLL_MS);
      }
      throw new Error(signal?.aborted
        ? `The call was cancelled. ${name} was started and may still be coming up.`
        : `${name} was started but did not answer within ${START_TIMEOUT_MS / MS_PER_SECOND} s. It may be showing a dialog.`);
    },
  );

  registerTool(server,
    "use_instance",
    "Route all subsequent PixInsight commands to instance N (as started with PixInsight -n=N). " +
      "Call this when the user says 'use instance N'. Only needed when more than one instance " +
      "is running, otherwise the server already targets the running one.",
    { instance: slotField.describe("Instance slot number to drive") },
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
