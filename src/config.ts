import { homedir } from "node:os";
import { join } from "node:path";

export interface BridgeConfig {
  /** Absolute path of the directory that holds command, script and result files. */
  bridgeDir: string;
  /** PixInsight instance slot to target (-n=N), or null for the first running instance. */
  instance: number | null;
  pollIntervalMs: number;
  defaultTimeoutMs: number;
}

/** PixInsight runs up to 256 instances, in slots 1 to 256. */
export const MAX_INSTANCE_SLOT = 256;

const DEFAULT_POLL_INTERVAL_MS = 200;
// Hardware and frame size dependent, a slow machine or very large frames legitimately need more.
const DEFAULT_TIMEOUT_MS = 300_000;

function positiveIntFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** PIXINSIGHT_MCP_BRIDGE_DIR, else ~/.pixinsight-mcp/bridge. A leading ~/ is expanded. */
export function resolveBridgeDir(): string {
  const configured = process.env.PIXINSIGHT_MCP_BRIDGE_DIR;
  if (!configured) return join(homedir(), ".pixinsight-mcp", "bridge");
  return configured.startsWith("~/") ? join(homedir(), configured.slice(2)) : configured;
}

/** PIXINSIGHT_MCP_INSTANCE=N pins the instance slot, else null (first running instance). */
export function resolveInstance(): number | null {
  const slot = Number.parseInt(process.env.PIXINSIGHT_MCP_INSTANCE ?? "", 10);
  return Number.isFinite(slot) && slot >= 1 && slot <= MAX_INSTANCE_SLOT ? slot : null;
}

export function configFromEnv(): BridgeConfig {
  return {
    bridgeDir: resolveBridgeDir(),
    instance: resolveInstance(),
    pollIntervalMs: positiveIntFromEnv("PIXINSIGHT_MCP_POLL_INTERVAL_MS", DEFAULT_POLL_INTERVAL_MS),
    defaultTimeoutMs: positiveIntFromEnv("PIXINSIGHT_MCP_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
  };
}
