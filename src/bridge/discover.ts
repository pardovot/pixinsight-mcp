import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Instance discovery for the multi-instance bridge. Each running PixInsight
 * watcher (native module or PJSR fallback) refreshes `<bridgeDir>/heartbeat.json`
 * every ~2s; we judge liveness by that file's MTIME (same machine, same clock,
 * so no timezone/skew games) and read the JSON only for identity. This lets the
 * MCP server auto-detect which instances are up without pinging the bridge.
 */

export interface InstanceInfo {
  slot: number;
  bridgeDir: string; // absolute
  live: boolean;
  ageMs: number | null; // ms since the heartbeat's mtime; null if no heartbeat
  pid?: number;
  version?: string;
}

// A watcher writes every ~2s; allow ~3 missed beats before calling it down.
export const LIVE_WINDOW_MS = 6000;

/** Slot number for a bridge dir NAME, or null if it is not a bridge dir. */
function slotOfDirName(name: string): number | null {
  if (name === "bridge") return 1;
  const m = /^bridge-(\d+)$/.exec(name);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    if (n > 1) return n;
  }
  return null;
}

export async function discoverInstances(
  now = Date.now(),
  baseDir = join(homedir(), ".pixinsight-mcp")
): Promise<InstanceInfo[]> {
  let entries: string[];
  try {
    entries = await readdir(baseDir);
  } catch {
    return []; // ~/.pixinsight-mcp does not exist yet
  }

  const infos: InstanceInfo[] = [];
  for (const name of entries) {
    const slot = slotOfDirName(name);
    if (slot === null) continue;

    const bridgeDir = join(baseDir, name);
    const hbPath = join(bridgeDir, "heartbeat.json");
    let ageMs: number | null = null;
    let pid: number | undefined;
    let version: string | undefined;

    try {
      const st = await stat(hbPath);
      ageMs = now - st.mtimeMs;
      try {
        const parsed = JSON.parse(await readFile(hbPath, "utf8")) as Record<string, unknown>;
        if (typeof parsed.pid === "number") pid = parsed.pid;
        if (typeof parsed.version === "string") version = parsed.version;
      } catch {
        // Identity is best-effort (e.g. caught mid-write); mtime still counts.
      }
    } catch {
      // No heartbeat file: an old/never-started or stopped watcher. Not live.
    }

    const live = ageMs !== null && ageMs < LIVE_WINDOW_MS;
    infos.push({ slot, bridgeDir, live, ageMs, pid, version });
  }

  infos.sort((a, b) => a.slot - b.slot);
  return infos;
}
