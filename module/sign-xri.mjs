// Sign a PixInsight .xri repository index in place, no PixInsight involved.
//
//   node module/sign-xri.mjs <file.xri> [<file.xri> ...]
//   node module/sign-xri.mjs --verify <file.xri>
//
// Appends a <Signature> element covering the canonical root (see
// module/xml-canonical.mjs and docs/SIGNING.md). The key resolves exactly as
// for module signing: PI_SIGN_KEY + PI_SIGN_DEVELOPER_ID, else the exported
// ~/.pixinsight-mcp/signing-key.json.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadSigningKey } from "./signing.mjs";
import { signWithExpandedKey } from "./ed25519.mjs";
import { parseXml, xriPreimage, signXriFile } from "./xml-canonical.mjs";

/** Verify an .xri that already carries a <Signature>, using the public key. */
function verifyXriFile(filePath, key) {
  const text = fs.readFileSync(filePath, "utf8");
  const element = text.match(/<Signature\s+([^>]*)>([^<]+)<\/Signature>/);
  if (!element) return false;
  const developerId = element[1].match(/developerId="([^"]+)"/)[1];
  const timestamp = element[1].match(/timestamp="([^"]+)"/)[1];

  // The signed root is the document without the appended <Signature>.
  const body = text.slice(0, text.indexOf("<Signature")).replace(/\s*$/, "");
  const { root } = parseXml(body);
  const publicKey = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.publicKey]),
    format: "der",
    type: "spki",
  });
  return crypto.verify(null, xriPreimage(root, developerId, timestamp), publicKey, Buffer.from(element[2], "base64"));
}

function main() {
  const args = process.argv.slice(2);
  const verifyOnly = args.includes("--verify");
  const files = args.filter((arg) => !arg.startsWith("--")).map((file) => path.resolve(file));
  if (files.length === 0) throw new Error("usage: node module/sign-xri.mjs [--verify] <file.xri> ...");

  const key = loadSigningKey();

  if (verifyOnly) {
    let failures = 0;
    for (const file of files) {
      const ok = verifyXriFile(file, key);
      console.log(`  ${ok ? "valid    " : "INVALID  "} ${path.basename(file)}`);
      if (!ok) failures++;
    }
    if (failures) throw new Error(`${failures} file(s) failed verification.`);
    return;
  }

  console.log(`  developer: ${key.developerId}\n`);
  for (const file of files) {
    signXriFile(file, key, signWithExpandedKey);
    // Verify what we just wrote; a signature that cannot be checked is worse
    // than none, because PixInsight then rejects the repository unhelpfully.
    if (!verifyXriFile(file, key)) throw new Error(`Wrote a signature that does not verify: ${file}`);
    console.log(`  signed ${path.basename(file)}`);
  }
  console.log("\n[OK] all signatures verify.");
}

try {
  main();
} catch (err) {
  console.error(`\n[ERROR] ${err.message}`);
  process.exit(1);
}
