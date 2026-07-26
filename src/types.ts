// Bridge protocol types

export interface BridgeCommand {
  id: string;
  timestamp: string;
  tool: string;
  process: string;
  parameters: Record<string, unknown>;
  executeMethod?: "executeGlobal" | "executeOn";
  targetView?: string | null;
}

export interface BridgeResultSuccess {
  id: string;
  timestamp: string;
  status: "success";
  process: string;
  duration_ms: number;
  outputs: Record<string, unknown>;
  message?: string;
}

export interface BridgeResultError {
  id: string;
  timestamp: string;
  status: "error";
  process: string;
  duration_ms: number;
  error: {
    message: string;
    type?: string;
    stack?: string;
  };
}

export interface BridgeResultRunning {
  id: string;
  timestamp: string;
  status: "running";
  process: string;
  duration_ms: number;
  message?: string;
}

export type BridgeResult = BridgeResultSuccess | BridgeResultError | BridgeResultRunning;

// Image types

export interface ImageInfo {
  id: string;
  filePath: string | null;
  width: number;
  height: number;
  channels: number;
  isColor: boolean;
  bitDepth: number;
}

export interface ImageStatistics {
  channel: number;
  channelName: string;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
}

// Configuration

export interface BridgeConfig {
  bridgeDir: string;
  pollIntervalMs: number;
  defaultTimeoutMs: number;
  extendedTimeoutMs: number;
  pixinsightPath: string;
  automationMode: boolean;
}

/**
 * Conventional PixInsight executable location for the current platform.
 * Override with the PIXINSIGHT_EXE environment variable, a hardcoded path is
 * wrong for anyone who installed elsewhere (another drive, a non-English
 * Program Files, a custom prefix).
 */
function defaultPixInsightPath(): string {
  if (process.env.PIXINSIGHT_EXE) return process.env.PIXINSIGHT_EXE;
  switch (process.platform) {
    case "win32": {
      const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
      return `${programFiles}\\PixInsight\\bin\\PixInsight.exe`;
    }
    case "darwin":
      return "/Applications/PixInsight/PixInsight.app/Contents/MacOS/PixInsight";
    default:
      return "/opt/PixInsight/bin/PixInsight";
  }
}

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/**
 * Resolve the bridge directory, shared convention with the C++ module and the
 * PJSR watcher (both resolve the same slot the same way). Precedence:
 *   1. PIXINSIGHT_MCP_BRIDGE_DIR  explicit path, wins over everything.
 *   2. PIXINSIGHT_MCP_INSTANCE=N  slot convention (matches PixInsight -n=N).
 *   3. default slot 1.
 * Slot 1 keeps the historical path (full back-compat); slot N>1 gets a
 * per-slot suffix so two instances never poll the same commands dir.
 */
export function resolveBridgeDir(): string {
  const explicit = process.env.PIXINSIGHT_MCP_BRIDGE_DIR;
  if (explicit) return explicit;
  const slot = Number.parseInt(process.env.PIXINSIGHT_MCP_INSTANCE ?? "", 10);
  if (Number.isFinite(slot) && slot > 1) return `~/.pixinsight-mcp/bridge-${slot}`;
  return "~/.pixinsight-mcp/bridge";
}

/**
 * True when the user pinned a bridge target via env (explicit dir or slot).
 * When pinned, the server honors it verbatim and skips heartbeat auto-detection;
 * when not, it auto-detects the live PixInsight instance at startup.
 */
export function hasExplicitBridgePin(): boolean {
  return Boolean(process.env.PIXINSIGHT_MCP_BRIDGE_DIR || process.env.PIXINSIGHT_MCP_INSTANCE);
}

export const DEFAULT_CONFIG: BridgeConfig = {
  // Per-instance bridge location, kept in lockstep with the C++ module and the
  // PJSR watcher via the shared slot convention in resolveBridgeDir(). An
  // out-of-band server-only override would still break the bridge, so both
  // sides must agree; that is why this is a convention, not a free-form path.
  bridgeDir: resolveBridgeDir(),
  pollIntervalMs: envInt("PIXINSIGHT_MCP_POLL_INTERVAL_MS", 200),
  // Timeouts are hardware- and framesize-dependent; a slow machine or very
  // large frames legitimately need more than these defaults.
  defaultTimeoutMs: envInt("PIXINSIGHT_MCP_TIMEOUT_MS", 300_000),        // 5 minutes
  extendedTimeoutMs: envInt("PIXINSIGHT_MCP_EXTENDED_TIMEOUT_MS", 3_600_000), // 1 hour
  pixinsightPath: defaultPixInsightPath(),
  automationMode: true,
};
