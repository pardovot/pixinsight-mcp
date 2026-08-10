// Sign the built module (or any module binary) with the project's signing key.
//
//   node module/sign.mjs                    sign the built module
//   node module/sign.mjs <file> [<file>...] sign specific binaries
//   node module/sign.mjs --verify <file>    check a file against its .xsgn
//
// No PixInsight, no password prompt, no GUI: the signature is computed directly
// (see module/signing.mjs for the construction and how it was established).
// This works identically on every platform, and signs any platform's binary,
// the core signs bytes and never parses the module, so a Linux .so and a macOS
// .dylib can both be signed here on Windows [verified].
//
// The key comes from PI_SIGN_KEY + PI_SIGN_DEVELOPER_ID, or from the file
// written once by module/export-signing-key.js. PixInsight is required only for
// that one-time export.
//
// Previously this shelled out to PixInsight's --sign-module-file, which needed
// the app installed, the password on the command line, and ~5 s per run; and
// which, on this machine, began failing at startup with a V8 ProcessContainer
// error. Signing directly removes all of that.

import fs from "node:fs";
import path from "node:path";
import * as cfg from "./config.mjs";
import { loadSigningKey, signModuleFile, verifyModuleFile } from "./signing.mjs";

function main() {
  const args = process.argv.slice(2);
  const verifyOnly = args.includes("--verify");
  const targets = args.filter((arg) => !arg.startsWith("--"));
  const files = (targets.length > 0 ? targets : [cfg.modulePath]).map((file) => path.resolve(file));

  for (const file of files)
    if (!fs.existsSync(file))
      throw new Error(
        file === cfg.modulePath ? `Not built yet: ${file} (run npm run module:build)` : `File not found: ${file}`,
      );

  if (verifyOnly) {
    let failures = 0;
    for (const file of files) {
      const signaturePath = file.replace(/\.[^.]+$/, ".xsgn");
      if (!fs.existsSync(signaturePath)) {
        console.log(`  MISSING   ${path.basename(signaturePath)}`);
        failures++;
        continue;
      }
      const ok = verifyModuleFile(file, signaturePath);
      console.log(`  ${ok ? "valid    " : "INVALID  "} ${path.basename(file)}`);
      if (!ok) failures++;
    }
    if (failures > 0) throw new Error(`${failures} file(s) failed verification.`);
    return;
  }

  const key = loadSigningKey();
  console.log(`  developer: ${key.developerId}\n`);

  const written = [];
  for (const file of files) {
    const signaturePath = signModuleFile(file, key);
    // Verify what we just wrote: a signature that cannot be checked is worse
    // than none, because PixInsight rejects the module with an unhelpful error.
    if (!verifyModuleFile(file, signaturePath))
      throw new Error(`Wrote a signature that does not verify: ${signaturePath}`);
    written.push(signaturePath);
  }

  console.log("[OK] Signed:");
  for (const signaturePath of written) console.log(`     ${signaturePath}`);
  console.log("     Next: node module/install.mjs   (needs administrator/root, PixInsight closed)");
}

try {
  main();
} catch (err) {
  console.error(`\n[ERROR] ${err.message}`);
  process.exit(1);
}
