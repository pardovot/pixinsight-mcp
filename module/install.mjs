// Install the built module and its signature into PixInsight's binary directory.
//
//   node module/install.mjs
//
// The PixInsight install directory is not user-writable, so the copy needs
// elevation. Rather than make you open an Administrator terminal, this
// self-elevates: on Windows it triggers a single UAC prompt; on macOS/Linux it
// re-runs the copy under sudo. Close PixInsight first so the module file is not
// locked.
//
// Both files are required: with AllowUnsignedModuleInstallation=false (the
// default) PixInsight rejects a module whose signature is missing or stale.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as cfg from "./config.mjs";

const isElevatedRun = process.argv.includes("--elevated");
const resultArg = process.argv.find((a) => a.startsWith("--result="));
const resultFile = resultArg ? resultArg.slice("--result=".length) : null;

const targets = [cfg.modulePath, cfg.signaturePath];

/** Copy both files into piBin. Returns {ok, copied[], error?}. */
function copyAll() {
  const copied = [];
  for (const source of targets) {
    const destination = path.join(cfg.piBin, path.basename(source));
    try {
      fs.copyFileSync(source, destination);
      copied.push(destination);
    } catch (err) {
      return { ok: false, copied, code: err.code, error: describeCopyError(err, destination) };
    }
  }
  return { ok: true, copied };
}

function describeCopyError(err, destination) {
  if (err.code === "EBUSY" || err.code === "ETXTBSY")
    return `${destination} is locked — close PixInsight and try again.`;
  if (err.code === "EACCES" || err.code === "EPERM")
    return `Permission denied writing ${destination}`;
  return `${err.code}: ${err.message}`;
}

/** Re-run this script elevated to perform the copy. Returns true on success. */
function elevateAndCopy() {
  const scriptPath = process.argv[1];
  const tmp = path.join(os.tmpdir(), `mcpwatcher-install-${process.pid}.json`);
  fs.rmSync(tmp, { force: true });

  if (cfg.isWindows) {
    // Single UAC prompt. The elevated process runs hidden and reports back
    // through the result file, since its console is separate from this one.
    const psq = (s) => `'${s.replace(/'/g, "''")}'`; // PowerShell single-quote escaping
    const fileArg = psq(process.execPath);
    const argList = [scriptPath, "--elevated", `--result=${tmp}`].map(psq).join(",");
    const ps =
      `$p = Start-Process -FilePath ${fileArg} -ArgumentList ${argList} ` +
      `-Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
    console.log("Requesting administrator access (accept the UAC prompt) ...");
    spawnSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
  } else {
    // sudo prompts in this same terminal.
    console.log("Re-running the copy under sudo ...");
    spawnSync("sudo", [process.execPath, scriptPath, "--elevated", `--result=${tmp}`], {
      stdio: "inherit",
    });
  }

  if (!fs.existsSync(tmp)) {
    console.error("\n[ERROR] Elevation was cancelled or failed; nothing was installed.");
    return false;
  }
  const report = JSON.parse(fs.readFileSync(tmp, "utf8"));
  fs.rmSync(tmp, { force: true });
  if (!report.ok) {
    console.error(`\n[ERROR] ${report.error}`);
    return false;
  }
  for (const d of report.copied) console.log(`  [OK] ${d}`);
  return true;
}

function validate() {
  if (!fs.existsSync(cfg.modulePath))
    throw new Error(`Not built yet: ${cfg.modulePath}\nRun: node module/build.mjs`);
  if (!fs.existsSync(cfg.signaturePath))
    throw new Error(
      `Signature missing: ${cfg.signaturePath}\nSign it first: node module/sign.mjs`,
    );
  // A rebuild after signing silently invalidates the signature; catch it here
  // rather than let PixInsight reject the module with an unhelpful error.
  if (fs.statSync(cfg.modulePath).mtimeMs > fs.statSync(cfg.signaturePath).mtimeMs)
    throw new Error(
      "Signature is OLDER than the module - it was invalidated by a rebuild.\n" +
        `  ${cfg.modulePath}\n  ${cfg.signaturePath}\n` +
        "Re-sign it, then run this again: node module/sign.mjs",
    );
  if (!fs.existsSync(cfg.piBin))
    throw new Error(`PixInsight binary directory not found: ${cfg.piBin}\nSet PI_ROOT to override.`);
}

function main() {
  // The elevated child just copies and reports; the parent already validated.
  if (isElevatedRun) {
    const result = copyAll();
    if (resultFile) fs.writeFileSync(resultFile, JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  }

  validate();
  console.log(`Installing to ${cfg.piBin} ...`);

  // Try the copy directly first — it succeeds without a prompt when already
  // running elevated, or wherever piBin happens to be user-writable.
  const first = copyAll();
  if (first.ok) {
    for (const d of first.copied) console.log(`  [OK] ${d}`);
  } else if (first.code === "EACCES" || first.code === "EPERM") {
    if (!elevateAndCopy()) process.exit(1);
  } else {
    throw new Error(first.error);
  }

  console.log("\nStart PixInsight; it auto-loads modules from its bin directory, or use");
  console.log("  Process > Modules > Install Modules");
}

try {
  main();
} catch (err) {
  console.error(`\n[ERROR] ${err.message}`);
  process.exit(1);
}
