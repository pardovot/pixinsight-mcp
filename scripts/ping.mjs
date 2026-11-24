// Checks that the built server can reach PixInsight: sends one harmless command through the bridge
// and prints the open images, with what it is waiting on meanwhile. PixInsight must be running.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PING_TIMEOUT_MS = 60_000;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = (file) => import(pathToFileURL(path.join(repoRoot, "build", ...file.split("/"))).href);
const { BridgeClient } = await load("bridge/client.js");
const { runInCallContext } = await load("bridge/call-context.js");
const { runningPixInsightProcesses } = await load("pixinsight.js");

const processes = await runningPixInsightProcesses();
if (processes !== null && processes.length === 0) {
  console.error("PixInsight is not running.");
  process.exit(1);
}
console.log(`PixInsight running (process ${processes?.join(", ") ?? "unknown"}), sending list_open_images`);

const bridge = new BridgeClient();
const started = Date.now();
const reportProgress = async (_seconds, message) => console.log(message);
const result = await runInCallContext({ reportProgress },
  () => bridge.call("list_open_images", {}, { timeoutMs: PING_TIMEOUT_MS }));
if (result.status !== "success") {
  console.error(`No answer from PixInsight: ${result.error.message}`);
  process.exit(1);
}
console.log(`PixInsight answered in ${Date.now() - started}ms`);
console.log("Images:", JSON.stringify(result.outputs.images.map((image) => image.id)));
