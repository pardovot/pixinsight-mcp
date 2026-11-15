// Locating the PixInsight executable, which the bridge uses to hand commands
// to a running instance through the core application's command line interface.
//
// Paths are derived per platform rather than hardcoded, and every step can be
// overridden with an environment variable, so a stock install needs no
// configuration.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** First candidate that exists, else the first one, so errors name a real path. */
function probe(candidates: string[]): string {
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export function pixinsightRoot(): string {
  const override = process.env.PI_ROOT;
  if (override) return override;

  if (process.platform === "win32") {
    const bases = [
      process.env.ProgramFiles,
      process.env.ProgramW6432,
      process.env["ProgramFiles(x86)"],
      "C:\\Program Files",
    ].filter((base): base is string => Boolean(base));
    return probe(bases.map((base) => join(base, "PixInsight")));
  }
  if (process.platform === "darwin") return probe(["/Applications/PixInsight"]);
  return probe(["/opt/PixInsight", "/usr/local/PixInsight"]);
}

/**
 * The core executable. On Linux the real binary needs the environment that
 * bin/PixInsight.sh sets up, so the launcher is preferred there.
 */
export function pixinsightExecutable(): string {
  const override = process.env.PIXINSIGHT_EXE;
  if (override) return override;

  const root = pixinsightRoot();
  if (process.platform === "win32") return join(root, "bin", "PixInsight.exe");
  if (process.platform === "darwin")
    return join(root, "PixInsight.app", "Contents", "MacOS", "PixInsight");
  return probe([join(root, "bin", "PixInsight.sh"), join(root, "bin", "PixInsight")]);
}

/** PixInsight's preprocessor and path arguments take forward slashes on every platform. */
export function toPixInsightPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/**
 * Process ids of the running PixInsight instances, or null when the process
 * list cannot be read. A request to an instance that is not running makes the
 * core application show a modal error and wait, so callers check this first.
 * Verified on Windows. The pgrep branch is unverified on macOS and Linux.
 */
export async function runningPixInsightProcesses(): Promise<number[] | null> {
  try {
    if (process.platform === "win32") {
      const image = basename(pixinsightExecutable());
      const { stdout } = await execFileAsync(
        "tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"], { windowsHide: true });
      // One CSV row per process: "PixInsight.exe","35228","Console","1","2,084,432 K".
      // Capture group 1 is the process id.
      const rowPattern = /^"[^"]+","(\d+)"/gm;
      return [...stdout.matchAll(rowPattern)].map((row) => Number(row[1]));
    }
    // The core process is named PixInsight on macOS and Linux.
    const { stdout } = await execFileAsync("pgrep", ["-x", "PixInsight"]);
    return stdout.split(/\s+/).filter(Boolean).map(Number);
  } catch (error: unknown) {
    // pgrep exits 1 when nothing matches, which is an answer, not a failure.
    if (error instanceof Error && "code" in error && error.code === 1) return [];
    console.error(`[pixinsight-mcp] could not list processes: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
