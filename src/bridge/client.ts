import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink, readdir, rename, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { BridgeCommand, BridgeResult, BridgeConfig } from "../types.js";
import { DEFAULT_CONFIG } from "../types.js";

function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Must match HANDLERS_REVISION in pjsr/pixinsight-mcp-watcher.js; the drift
// test (scripts/check-handler-drift.mjs) enforces equality. Coarse skew
// detector: per-feature markers (save_image outputs.hints) stay the pattern
// for gaps that must hard-error.
export const EXPECTED_HANDLERS_REV = 1;

export class BridgeClient {
  private config: BridgeConfig;
  // Set via setBridgeDir() in the constructor (and on runtime instance switches).
  private commandsDir!: string;
  private resultsDir!: string;
  private logsDir!: string;
  private revWarned = false;

  constructor(config?: Partial<BridgeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setBridgeDir(this.config.bridgeDir);
  }

  /**
   * Retarget every subsequent command at a different bridge dir. Used to switch
   * the active PixInsight instance at runtime (auto-detect on startup, or a
   * "use instance N" request), so one server can drive whichever instance is
   * named without re-registering. Commands are issued serially, so switching
   * between calls is safe.
   */
  setBridgeDir(bridgeDir: string): void {
    this.config = { ...this.config, bridgeDir };
    const expanded = expandHome(bridgeDir);
    this.commandsDir = join(expanded, "commands");
    this.resultsDir = join(expanded, "results");
    this.logsDir = join(expanded, "logs");
  }

  /** Absolute (home-expanded) bridge dir this client currently targets. */
  getBridgeDir(): string {
    return expandHome(this.config.bridgeDir);
  }

  async ensureDirectories(): Promise<void> {
    await mkdir(this.commandsDir, { recursive: true });
    await mkdir(this.resultsDir, { recursive: true });
    await mkdir(this.logsDir, { recursive: true });
  }

  async sendCommand(
    tool: string,
    process: string,
    parameters: Record<string, unknown>,
    options?: {
      executeMethod?: "executeGlobal" | "executeOn";
      targetView?: string | null;
      timeoutMs?: number;
    }
  ): Promise<BridgeResult> {
    await this.ensureDirectories();

    const id = randomUUID();
    const command: BridgeCommand = {
      id,
      timestamp: new Date().toISOString(),
      tool,
      process,
      parameters,
      executeMethod: options?.executeMethod ?? "executeGlobal",
      targetView: options?.targetView ?? null,
    };

    // Atomic write: "<id>.tmp" (outside the watcher's *.json glob) then rename,
    // so the watcher never picks up a partially written command file.
    const commandPath = join(this.commandsDir, `${id}.json`);
    const tmpPath = join(this.commandsDir, `${id}.tmp`);
    await writeFile(tmpPath, JSON.stringify(command, null, 2), "utf-8");
    await rename(tmpPath, commandPath);

    const timeoutMs = options?.timeoutMs ?? this.config.defaultTimeoutMs;
    const result = await this.waitForResult(id, timeoutMs);
    return this.checkHandlersRev(result);
  }

  // Revision skew handling. Only success results carry the marker (error
  // envelopes are built outside dispatchCommand). A module OLDER than the
  // server is dangerous, the server may rely on handler behavior it lacks, so
  // every command hard-errors with fix instructions (fail loudly; a rebuild
  // cycle is ~1 min). A NEWER module presumably keeps old behavior, so it only
  // gets a one-time warning appended to the result. stderr is near-invisible
  // in an agent session, which is why both surface in the result itself.
  private checkHandlersRev(result: BridgeResult): BridgeResult {
    if (result.status !== "success") return result;
    const rev = (result.outputs as Record<string, unknown>)?.handlersRev;
    if (rev === EXPECTED_HANDLERS_REV) return result;

    const reinstall =
      "Rebuild and reinstall the module: npm run module:build, module:sign, then " +
      "module:install as admin with PixInsight closed, then restart the MCP server.";

    if (rev === undefined || Number(rev) < EXPECTED_HANDLERS_REV) {
      const detail = rev === undefined
        ? "predates handler revision reporting"
        : `reports handler revision ${rev}, this server expects ${EXPECTED_HANDLERS_REV}`;
      if (!this.revWarned) {
        this.revWarned = true;
        console.error(`[pixinsight-mcp] installed MCPWatcher module ${detail}. ${reinstall}`);
      }
      return {
        id: result.id,
        timestamp: result.timestamp,
        status: "error",
        process: result.process,
        duration_ms: result.duration_ms,
        error: {
          message:
            `The command ran, but the installed MCPWatcher module ${detail}, so this server ` +
            `cannot trust its handler behavior. ${reinstall}`,
          type: "HandlersRevisionMismatch",
        },
      };
    }

    // Module newer than server: warn once, in the result the agent actually reads.
    if (!this.revWarned) {
      this.revWarned = true;
      const note =
        `[pixinsight-mcp] installed module reports handler revision ${rev}, this server ` +
        `expects ${EXPECTED_HANDLERS_REV}; the module is newer, update/rebuild the MCP server.`;
      console.error(note);
      result.message = (result.message ? result.message + "\n" : "") + "WARNING: " + note;
    }
    return result;
  }

  private async waitForResult(id: string, timeoutMs: number): Promise<BridgeResult> {
    const resultPath = join(this.resultsDir, `${id}.json`);
    const startTime = Date.now();
    // When a result file exists but won't parse, it is one of two things:
    //   (a) a partial write we caught mid-flight → transient, retry briefly;
    //   (b) a genuinely malformed result the watcher delivered → permanent.
    // The old code could not tell them apart and re-polled (b) until the full
    // timeout, the real cause of Run 1's phantom "timeouts on success": a
    // re-entrancy bug wrote raw (non-JSON) text and we silently waited it out.
    // Now we give a short grace for (a), then surface (b) as an error instead.
    const MALFORMED_GRACE_MS = 2000;
    let unparseableSince: number | null = null;

    while (Date.now() - startTime < timeoutMs) {
      if (existsSync(resultPath)) {
        // Small delay to ensure the file is fully written
        await sleep(50);
        let data: string;
        try {
          data = await readFile(resultPath, "utf-8");
        } catch {
          // File vanished / read raced, retry
          await sleep(this.config.pollIntervalMs);
          continue;
        }

        let result: BridgeResult;
        try {
          result = JSON.parse(data) as BridgeResult;
        } catch {
          // Unparseable. Tolerate a brief partial-write window; past that, treat
          // it as a delivered-but-malformed result and fail fast, never poll on.
          if (unparseableSince === null) unparseableSince = Date.now();
          if (Date.now() - unparseableSince < MALFORMED_GRACE_MS) {
            await sleep(this.config.pollIntervalMs);
            continue;
          }
          try { await unlink(resultPath); } catch {}
          return {
            id,
            timestamp: new Date().toISOString(),
            status: "error",
            process: "malformed-result",
            duration_ms: Date.now() - startTime,
            error: {
              message:
                "The watcher delivered a result that is not valid JSON, the command likely " +
                "ran but its result was corrupted (e.g. a re-entrant execution). Verify the " +
                "image state before retrying. Raw result (truncated): " +
                JSON.stringify(data.slice(0, 200)),
              type: "MalformedResult",
            },
          };
        }
        unparseableSince = null;

        // "running" ack: the watcher picked the command up and the process is
        // underway. Keep polling for the terminal result.
        if (result.status === "running") {
          await sleep(this.config.pollIntervalMs);
          continue;
        }

        try { await unlink(resultPath); } catch {}
        return result;
      }
      await sleep(this.config.pollIntervalMs);
    }

    return {
      id,
      timestamp: new Date().toISOString(),
      status: "error",
      process: "timeout",
      duration_ms: Date.now() - startTime,
      error: {
        message: `Command timed out after ${timeoutMs}ms. The PJSR watcher may not be running in PixInsight.`,
        type: "Timeout",
      },
    };
  }

  async isWatcherAlive(): Promise<boolean> {
    // Send a ping-like command and see if we get a response
    try {
      const result = await this.sendCommand(
        "list_open_images",
        "__internal__",
        {},
        { timeoutMs: 5000 }
      );
      return result.status === "success";
    } catch {
      return false;
    }
  }

  async cleanStaleCommands(): Promise<number> {
    let cleaned = 0;
    try {
      const files = await readdir(this.commandsDir);
      for (const file of files) {
        const filePath = join(this.commandsDir, file);
        if (file.endsWith(".json")) {
          try {
            const data = await readFile(filePath, "utf-8");
            const cmd = JSON.parse(data) as BridgeCommand;
            const age = Date.now() - new Date(cmd.timestamp).getTime();
            // Remove commands older than 10 minutes
            if (age > 600_000) {
              await unlink(filePath);
              cleaned++;
            }
          } catch {
            // Malformed file, remove it
            await unlink(filePath);
            cleaned++;
          }
        } else if (file.endsWith(".tmp")) {
          // Orphan from a crash between write and rename. No parseable
          // timestamp inside, use mtime, same 10-minute threshold.
          try {
            const { mtimeMs } = await stat(filePath);
            if (Date.now() - mtimeMs > 600_000) {
              await unlink(filePath);
              cleaned++;
            }
          } catch {}
        }
      }
    } catch {
      // commandsDir unreadable, still try the results side below.
    }
    // Results side: a result written after its client timed out (or died) has
    // no reader and would otherwise accumulate forever. Same 10-minute
    // threshold, by mtime, result files carry the watcher's timestamp, but
    // mtime works for .tmp orphans too and one rule covers both.
    try {
      const files = await readdir(this.resultsDir);
      for (const file of files) {
        if (!file.endsWith(".json") && !file.endsWith(".tmp")) continue;
        const filePath = join(this.resultsDir, file);
        try {
          const { mtimeMs } = await stat(filePath);
          if (Date.now() - mtimeMs > 600_000) {
            await unlink(filePath);
            cleaned++;
          }
        } catch {}
      }
    } catch {}
    return cleaned;
  }

  getConfig(): BridgeConfig {
    return { ...this.config };
  }
}
