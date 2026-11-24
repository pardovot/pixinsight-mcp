import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface BridgeConfig {
  /** Absolute path of the directory that holds command, script and result files. */
  bridgeDir: string;
  /** PixInsight instance slot to target (-n=N), or null for the first running instance. */
  instance: number | null;
  pollIntervalMs: number;
  /** Longest a call may take, or null to wait as long as PixInsight is alive. */
  defaultTimeoutMs: number | null;
}

/** PixInsight runs up to 256 instances, in slots 1 to 256. */
export const MAX_INSTANCE_SLOT = 256;

const DEFAULT_POLL_INTERVAL_MS = 200;

function positiveIntFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * PIXINSIGHT_MCP_BRIDGE_DIR, else ~/.pixinsight-mcp/bridge. A leading ~/ is expanded, and a relative
 * path is taken from the server's working directory, since PixInsight would read it from its own.
 */
export function resolveBridgeDir(): string {
  const configured = process.env.PIXINSIGHT_MCP_BRIDGE_DIR;
  if (!configured) return join(homedir(), ".pixinsight-mcp", "bridge");
  if (configured.startsWith("~/")) return join(homedir(), configured.slice(2));
  return isAbsolute(configured) ? configured : resolve(configured);
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
    defaultTimeoutMs: positiveIntFromEnv("PIXINSIGHT_MCP_TIMEOUT_MS", 0) || null,
  };
}
