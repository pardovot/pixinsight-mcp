// Install the built module and its signature into PixInsight's binary directory.
//
//   node module/install.mjs
//
// Needs elevation (the PixInsight install directory is not user-writable), and
// PixInsight must be closed so the old module file is not locked.
//
// Both files are required: with AllowUnsignedModuleInstallation=false (the
// default) PixInsight rejects a module whose signature is missing or stale.

import fs from "node:fs";
import path from "node:path";
import * as cfg from "./config.mjs";

function main() {
  if (!fs.existsSync(cfg.modulePath)) {
    throw new Error(`Not built yet: ${cfg.modulePath}\nRun: node module/build.mjs`);
  }
  if (!fs.existsSync(cfg.signaturePath)) {
    throw new Error(
      `Signature missing: ${cfg.signaturePath}\n` +
        "The module must be signed before install. Run: node module/sign.mjs",
    );
  }

  // A rebuild after signing silently invalidates the signature, and PixInsight
  // then rejects the module with an unhelpful error. Catch it here instead.
  const moduleTime = fs.statSync(cfg.modulePath).mtimeMs;
  const signatureTime = fs.statSync(cfg.signaturePath).mtimeMs;
  if (moduleTime > signatureTime) {
    throw new Error(
      "Signature is OLDER than the module - it was invalidated by a rebuild.\n" +
        `  ${cfg.modulePath}\n  ${cfg.signaturePath}\n` +
        "Re-sign it, then run this again: node module/sign.mjs",
    );
  }

  if (!fs.existsSync(cfg.piBin)) {
    throw new Error(`PixInsight binary directory not found: ${cfg.piBin}\nSet PI_ROOT to override.`);
  }

  const targets = [cfg.modulePath, cfg.signaturePath];
  console.log(`Installing to ${cfg.piBin} ...`);
  for (const source of targets) {
    const destination = path.join(cfg.piBin, path.basename(source));
    try {
      fs.copyFileSync(source, destination);
      console.log(`  [OK] ${destination}`);
    } catch (err) {
      if (err.code === "EACCES" || err.code === "EPERM") {
        throw new Error(
          `Permission denied writing ${destination}\n` +
            (cfg.isWindows
              ? "Run this from an Administrator terminal, and close PixInsight first."
              : "Run with sudo, and close PixInsight first."),
        );
      }
      if (err.code === "EBUSY" || err.code === "ETXTBSY") {
        throw new Error(`${destination} is locked — close PixInsight and try again.`);
      }
      throw err;
    }
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
