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
import { spawnSync } from "node:child_process";
import * as cfg from "./config.mjs";

/**
 * Read a password from the TTY without echoing it.
 *
 * Reads raw keystrokes rather than overriding readline's private
 * _writeToOutput: that hook is internal, and on Windows it let control
 * characters through into the answer, which produced a malformed argument.
 */
function promptPassword(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) {
      reject(new Error("stdin is not a TTY — set PI_SIGN_PASSWORD in the environment instead."));
      return;
    }

    process.stdout.write(prompt);
    const wasRaw = input.isRaw;
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");

    let value = "";
    const done = (err, result) => {
      input.setRawMode(wasRaw);
      input.pause();
      input.removeListener("data", onData);
      process.stdout.write("\n");
      err ? reject(err) : resolve(result);
    };

    const onData = (chunk) => {
      for (const ch of chunk) {
        switch (ch) {
          case "\r":              // Enter (CR on Windows consoles)
          case "\n":
          case "":          // Ctrl-D
            done(null, value);
            return;
          case "":          // Ctrl-C
            done(new Error("Cancelled."));
            return;
          case "":          // Backspace / Delete
          case "\b":
            value = value.slice(0, -1);
            break;
          default:
            // Ignore any remaining control characters; only keep printable input.
            if (ch >= " ") value += ch;
        }
      }
    };

    input.on("data", onData);
  });
}

/** Describe a password without revealing it, for diagnosing bad input. */
function describePassword(password) {
  const codes = [...password].map((c) => c.codePointAt(0));
  const control = codes.filter((c) => c < 32 || c === 127);
  return [
    `  length          ${password.length}`,
    `  control chars   ${control.length ? control.map((c) => "0x" + c.toString(16)).join(" ") : "none"}`,
    `  non-ascii       ${codes.some((c) => c > 126) ? "yes" : "no"}`,
    `  leading/trailing whitespace  ${password !== password.trim() ? "YES (suspicious)" : "no"}`,
  ].join("\n");
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

  // Prefer an env var when set: it avoids the TTY prompt entirely and is the
  // most reliable path on Windows.
  const password = process.env.PI_SIGN_PASSWORD || (await promptPassword("Signing password: "));
  if (!password) throw new Error("No password entered.");

  if (process.argv.includes("--debug-password")) {
    console.log("Password characteristics (value not shown):");
    console.log(describePassword(password));
  }

  // Use PixInsight's native command-line signing (--sign-module-file /
  // --sign-xml-file). This is fast (~5 s with --no-modules) and is the path
  // that worked from the original .bat.
  //
  // On Windows it MUST be launched through cmd with the value arguments quoted.
  // spawnSync's own command-line synthesis leaves --xssk-*=value unquoted when
  // the value has no spaces, and PixInsight's parser then crashes during the
  // actual sign (a wrong password errors earlier, so only a valid one hit it).
  // cmd expands %PI_SIGN_PASSWORD% from the environment, so the password is
  // never interpolated into a string Node builds and never on Node's argv.
  const started = Date.now();
  const commonFlags = [
    `-n=${cfg.signSlot}`,
    "--automation-mode",
    "--no-startup-scripts",
    "--no-modules",
  ];
  const signFlagFor = (f) =>
    path.extname(f).toLowerCase() === ".xri" ? "--sign-xml-file" : "--sign-module-file";

  console.log("Signing ...");
  let result;
  if (cfg.isWindows) {
    const inner =
      `"${cfg.piExe}" ${commonFlags.join(" ")} ` +
      `--xssk-file="${cfg.signKeys}" --xssk-password="%PI_SIGN_PASSWORD%" ` +
      files.map((f) => `${signFlagFor(f)}="${f}"`).join(" ") +
      " --force-exit";
    result = spawnSync("cmd.exe", ["/d", "/s", "/c", `"${inner}"`], {
      stdio: "inherit",
      windowsVerbatimArguments: true, // pass `inner` through unmangled; cmd does the quoting
      env: { ...process.env, PI_SIGN_PASSWORD: password },
    });
  } else {
    // POSIX: execve takes argv directly — no shell, no command-line synthesis,
    // so each element is delivered verbatim and quoting is a non-issue.
    result = spawnSync(
      cfg.piExe,
      [
        ...commonFlags,
        `--xssk-file=${cfg.signKeys}`,
        `--xssk-password=${password}`,
        ...files.map((f) => `${signFlagFor(f)}=${f}`),
        "--force-exit",
      ],
      { stdio: "inherit" },
    );
  }
  if (result.error) throw result.error;

  // The native CLI writes no result file, and being a console-less GUI process
  // its exit code is unreliable. Verify success by the artifact: each expected
  // signature must exist and be newer than when we launched.
  const signaturePathFor = (f) =>
    path.extname(f).toLowerCase() === ".xri" ? f : f.replace(/\.[^.]+$/, ".xsgn");
  const written = [];
  const missing = [];
  for (const f of files) {
    const sig = signaturePathFor(f);
    if (fs.existsSync(sig) && fs.statSync(sig).mtimeMs >= started) written.push(sig);
    else missing.push(sig);
  }

  if (missing.length) {
    throw new Error(
      `Signing did not produce a fresh signature (exit ${result.status}) for:\n  ` +
        missing.join("\n  ") +
        "\nIf PixInsight reported a wrong password above, re-check it; otherwise see module/README.md.",
    );
  }

  console.log("\n[OK] Signed:");
  for (const sig of written) console.log(`     ${sig}`);
  console.log("     Next: node module/install.mjs   (needs administrator/root, PixInsight closed)");
}

main().catch((err) => {
  console.error(`\n[ERROR] ${err.message}`);
  process.exit(1);
});
