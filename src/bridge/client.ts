import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink, readdir } from "node:fs/promises";
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

export class BridgeClient {
  private config: BridgeConfig;
  private commandsDir: string;
  private resultsDir: string;
  private logsDir: string;

  constructor(config?: Partial<BridgeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const bridgeDir = expandHome(this.config.bridgeDir);
    this.commandsDir = join(bridgeDir, "commands");
    this.resultsDir = join(bridgeDir, "results");
    this.logsDir = join(bridgeDir, "logs");
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

    const commandPath = join(this.commandsDir, `${id}.json`);
    await writeFile(commandPath, JSON.stringify(command, null, 2), "utf-8");

    const timeoutMs = options?.timeoutMs ?? this.config.defaultTimeoutMs;
    return this.waitForResult(id, timeoutMs);
  }

  private async waitForResult(id: string, timeoutMs: number): Promise<BridgeResult> {
    const resultPath = join(this.resultsDir, `${id}.json`);
    const startTime = Date.now();
    // When a result file exists but won't parse, it is one of two things:
    //   (a) a partial write we caught mid-flight → transient, retry briefly;
    //   (b) a genuinely malformed result the watcher delivered → permanent.
    // The old code could not tell them apart and re-polled (b) until the full
    // timeout — the real cause of Run 1's phantom "timeouts on success": a
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
          // File vanished / read raced — retry
          await sleep(this.config.pollIntervalMs);
          continue;
        }

        let result: BridgeResult;
        try {
          result = JSON.parse(data) as BridgeResult;
        } catch {
          // Unparseable. Tolerate a brief partial-write window; past that, treat
          // it as a delivered-but-malformed result and fail fast — never poll on.
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
                "The watcher delivered a result that is not valid JSON — the command likely " +
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
    try {
      const files = await readdir(this.commandsDir);
      let cleaned = 0;
      for (const file of files) {
        if (file.endsWith(".json")) {
          const filePath = join(this.commandsDir, file);
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
        }
      }
      return cleaned;
    } catch {
      return 0;
    }
  }

  getConfig(): BridgeConfig {
    return { ...this.config };
  }
}
