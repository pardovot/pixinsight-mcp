// PixInsight code signing, without PixInsight.
//
// The construction below was recovered empirically and confirmed by
// reproducing ten PixInsight-generated signatures byte for byte (Ed25519 is
// deterministic, so an exact match is proof, not resemblance):
//
//   preimage  = SHA-512( fileBytes || developerId || timestamp || entitlements.join("\n") )
//   signature = Ed25519( preimage )
//
// All text is UTF-8 with no separators, and `timestamp` is the exact string
// written into the .xsgn <Timestamp> element. Notes:
//   - the RAW file bytes go in, not a digest of them;
//   - the timestamp is inside the signed data, so signatures are not stable
//     across runs even though Ed25519 itself is deterministic;
//   - the core never parses the module, it signs bytes, which is why a Linux
//     .so or macOS .dylib can be signed on any platform (verified);
//   - entitlement ORDER is not pinned: the probe's two names were already
//     alphabetical. Our modules ship no entitlements, so this is untested
//     ground rather than a known-good default.
//
// The .xri repository index uses a DIFFERENT construction, over a canonical
// rendering of the root element rather than the file bytes. It lives in
// module/xml-canonical.mjs; do not try to sign an .xri with the code-file
// preimage above. See docs/SIGNING.md.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { signWithExpandedKey, publicKeyFromScalar } from "./ed25519.mjs";

/** Where an exported signing key lives when not supplied through the environment. */
export const defaultKeyPath =
  process.env.PI_SIGN_KEY_FILE || path.join(os.homedir(), ".pixinsight-mcp", "signing-key.json");

/**
 * Load the signing key.
 *
 * In CI it comes from the environment (PI_SIGN_KEY, PI_SIGN_DEVELOPER_ID, and
 * optionally PI_SIGN_PUBLIC_KEY); locally from the JSON file written by
 * module/export-signing-key.js. The key is the EXPANDED private key in hex,
 * exactly as PixInsight reports it.
 */
export function loadSigningKey() {
  let developerId = process.env.PI_SIGN_DEVELOPER_ID;
  let expandedKeyHex = process.env.PI_SIGN_KEY;
  let publicKeyHex = process.env.PI_SIGN_PUBLIC_KEY;

  if (!expandedKeyHex) {
    if (!fs.existsSync(defaultKeyPath))
      throw new Error(
        `No signing key. Set PI_SIGN_KEY + PI_SIGN_DEVELOPER_ID, or export one once with\n` +
          `  module/export-signing-key.js  (run it inside PixInsight)\n` +
          `which writes ${defaultKeyPath}`,
      );
    const stored = JSON.parse(fs.readFileSync(defaultKeyPath, "utf8"));
    developerId = developerId || stored.developerId;
    expandedKeyHex = stored.expandedKeyHex;
    publicKeyHex = publicKeyHex || stored.publicKeyHex;
  }

  if (!developerId) throw new Error("No developer id. Set PI_SIGN_DEVELOPER_ID.");

  const expandedKey = Buffer.from(expandedKeyHex.trim(), "hex");
  if (expandedKey.length !== 64)
    throw new Error(`Signing key must be 64 bytes of hex (expanded form), got ${expandedKey.length}.`);

  // Derive the public key rather than trusting the stored one, and check any
  // stored value against it: a mismatched pair would otherwise produce
  // well-formed signatures that nothing can verify.
  const publicKey = publicKeyFromScalar(expandedKey.subarray(0, 32));
  if (publicKeyHex && !publicKey.equals(Buffer.from(publicKeyHex.trim(), "hex")))
    throw new Error("Signing key mismatch: the private key does not correspond to the public key.");

  return { developerId, expandedKey, publicKey };
}

/** The exact bytes PixInsight signs for a module. */
export function modulePreimage({ data, developerId, timestamp, entitlements = [] }) {
  return crypto
    .createHash("sha512")
    .update(data)
    .update(developerId, "utf8")
    .update(timestamp, "utf8")
    .update(entitlements.join("\n"), "utf8")
    .digest();
}

/** PixInsight's timestamp format: ISO 8601, milliseconds, "Z". */
export const signingTimestamp = (date = new Date()) => date.toISOString();

/** The .xsgn document, reproduced field for field. */
export function xsgnDocument({ developerId, timestamp, creationTime, signature }) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!--\n` +
    `PixInsight XML Code Signature Format - XSGN version 1.0\n` +
    `Created with PixInsight software - https://pixinsight.com/\n` +
    `-->\n` +
    `<xsgn version="1.0" xmlns="http://www.pixinsight.com/xsgn" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.pixinsight.com/xsgn http://pixinsight.com/xsgn/xsgn-1.0.xsd">\n` +
    `   <CreationTime>${creationTime}</CreationTime>\n` +
    `   <Signature version="1.0" developerId="${developerId}">\n` +
    `      <Timestamp>${timestamp}</Timestamp>\n` +
    `      <CodeSignature encoding="Base64">${signature.toString("base64")}</CodeSignature>\n` +
    `   </Signature>\n` +
    `</xsgn>\n`
  );
}

/**
 * Sign one module binary and write its .xsgn beside it.
 *
 * @returns {string} path of the signature file
 */
export function signModuleFile(modulePath, key, { entitlements = [], timestamp = signingTimestamp() } = {}) {
  const data = fs.readFileSync(modulePath);
  const signature = signWithExpandedKey(
    key.expandedKey,
    modulePreimage({ data, developerId: key.developerId, timestamp, entitlements }),
    key.publicKey,
  );
  const signaturePath = modulePath.replace(/\.[^.]+$/, ".xsgn");
  fs.writeFileSync(
    signaturePath,
    xsgnDocument({ developerId: key.developerId, timestamp, creationTime: timestamp, signature }),
  );
  return signaturePath;
}

/** Verify a module against its .xsgn, using node:crypto rather than our own signer. */
export function verifyModuleFile(modulePath, signaturePath) {
  const xml = fs.readFileSync(signaturePath, "utf8");
  // <CodeSignature encoding="Base64">…</CodeSignature> and <Timestamp>…</Timestamp>
  const signature = Buffer.from(xml.match(/<CodeSignature[^>]*>([^<]+)<\/CodeSignature>/)[1], "base64");
  const timestamp = xml.match(/<Timestamp>([^<]+)<\/Timestamp>/)[1];
  const developerId = xml.match(/developerId="([^"]+)"/)[1];
  const publicKey = loadSigningKey().publicKey;

  return crypto.verify(
    null,
    modulePreimage({ data: fs.readFileSync(modulePath), developerId, timestamp }),
    crypto.createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey]),
      format: "der",
      type: "spki",
    }),
    signature,
  );
}
