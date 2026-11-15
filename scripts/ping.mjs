// Checks that the built server can reach PixInsight: sends one harmless command through the bridge
// and prints the open images. PixInsight must be running.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PING_TIMEOUT_MS = 60_000;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { BridgeClient } = await import(pathToFileURL(path.join(repoRoot, "build", "bridge", "client.js")).href);

const bridge = new BridgeClient();
const started = Date.now();
const result = await bridge.call("list_open_images", {}, { timeoutMs: PING_TIMEOUT_MS });
if (result.status !== "success") {
  console.error(`No answer from PixInsight: ${result.error.message}`);
  process.exit(1);
}
console.log(`PixInsight answered in ${Date.now() - started}ms`);
console.log("Images:", JSON.stringify(result.outputs.images.map((image) => image.id)));
