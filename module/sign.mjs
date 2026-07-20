// Sign the built module (or any signable file) with PixInsight's native
// command-line signing support.
//
//   node module/sign.mjs                       sign the built module
//   node module/sign.mjs ../pi-repo/updates.xri  sign an update repo file in place
//   node module/sign.mjs <file> [<file> ...]
//
// The core application accepts --sign-module-file / --sign-xml-file directly,
// so no GUI and no PJSR script are involved. With --no-modules this takes ~5 s.
// This works identically on all platforms; only the executable path differs.
//
// SECURITY: the password is passed via --xssk-password, so it is visible in the
// process table for the few seconds the process lives. Pleiades' own guidance is
// to do this only on a trusted machine. It is never written to disk.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import * as cfg from "./config.mjs";

/** Read a line from the TTY without echoing it. */
function promptPassword(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error("stdin is not a TTY — cannot prompt for the signing password."));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Suppress echo: swallow everything the readline interface tries to write
    // after the prompt itself.
    let muted = false;
    const write = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = (chunk) => {
      if (!muted && write) write(chunk);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

function signArgumentFor(file) {
  // .xri update-repository files are XML signatures, signed IN PLACE.
  // Everything else is treated as a module binary.
  return path.extname(file).toLowerCase() === ".xri"
    ? `--sign-xml-file=${file}`
    : `--sign-module-file=${file}`;
}

async function main() {
  const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const files = (targets.length > 0 ? targets : [cfg.modulePath]).map((f) => path.resolve(f));

  if (!fs.existsSync(cfg.piExe)) {
    throw new Error(`PixInsight not found: ${cfg.piExe}\nSet PIXINSIGHT_EXE or PI_ROOT to override.`);
  }
  if (!fs.existsSync(cfg.signKeys)) {
    throw new Error(`Signing keys file not found: ${cfg.signKeys}\nSet PI_SIGN_KEYS to your .xssk file.`);
  }
  for (const file of files) {
    if (!fs.existsSync(file)) {
      throw new Error(
        file === cfg.modulePath ? `Not built yet: ${file} (run build first)` : `File not found: ${file}`,
      );
    }
    console.log(`  target: ${file}`);
  }
  console.log(`  keys  : ${cfg.signKeys}\n`);

  const password = await promptPassword("Signing password: ");
  if (!password) throw new Error("No password entered.");

  console.log("Signing ...");
  const result = spawnSync(
    cfg.piExe,
    [
      `-n=${cfg.signSlot}`,
      "--automation-mode",
      "--no-startup-scripts",
      "--no-modules",
      `--xssk-file=${cfg.signKeys}`,
      `--xssk-password=${password}`,
      ...files.map(signArgumentFor),
      "--force-exit",
    ],
    { stdio: "inherit" },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Signing failed (exit ${result.status}). PixInsight prints the reason above — ` +
        'a wrong password reports "LoadSigningKeysFile(): wrong password".',
    );
  }

  console.log("\n[OK] Signed.");
  console.log("     Next: node module/install.mjs   (needs administrator/root, PixInsight closed)");
}

main().catch((err) => {
  console.error(`\n[ERROR] ${err.message}`);
  process.exit(1);
});
