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
 * Override with the PIXINSIGHT_EXE environment variable — a hardcoded path is
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

export const DEFAULT_CONFIG: BridgeConfig = {
  bridgeDir: process.env.PIXINSIGHT_MCP_BRIDGE_DIR ?? "~/.pixinsight-mcp/bridge",
  pollIntervalMs: envInt("PIXINSIGHT_MCP_POLL_INTERVAL_MS", 200),
  // Timeouts are hardware- and framesize-dependent; a slow machine or very
  // large frames legitimately need more than these defaults.
  defaultTimeoutMs: envInt("PIXINSIGHT_MCP_TIMEOUT_MS", 300_000),        // 5 minutes
  extendedTimeoutMs: envInt("PIXINSIGHT_MCP_EXTENDED_TIMEOUT_MS", 3_600_000), // 1 hour
  pixinsightPath: defaultPixInsightPath(),
  automationMode: true,
};
