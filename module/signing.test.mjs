// Tests for the signing construction. These need no key and no PixInsight.
//
// The construction itself was established by reproducing ten PixInsight
// signatures byte for byte; those probe artifacts are not committed (they
// carry key material), so what is guarded here is everything that can be
// checked without a secret: the Ed25519 implementation, the preimage layout,
// and the .xsgn document shape.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { validate, signWithExpandedKey, publicKeyFromScalar } from "./ed25519.mjs";
import { modulePreimage, xsgnDocument, signingTimestamp } from "./signing.mjs";

/** An expanded key derived from a seed, the way node:crypto would internally. */
function expandedKeyFromSeed(seed) {
  const expanded = crypto.createHash("sha512").update(seed).digest();
  const scalar = Buffer.from(expanded.subarray(0, 32));
  scalar[0] &= 248;
  scalar[31] &= 127;
  scalar[31] |= 64;
  return Buffer.concat([scalar, expanded.subarray(32)]);
}

test("ed25519: expanded-key signing matches node:crypto", () => {
  assert.equal(validate(), true);
});

test("ed25519: signatures verify under node:crypto", () => {
  const seed = crypto.randomBytes(32);
  const expandedKey = expandedKeyFromSeed(seed);
  const publicKey = publicKeyFromScalar(expandedKey.subarray(0, 32));
  const message = Buffer.from("probe message");

  const signature = signWithExpandedKey(expandedKey, message, publicKey);
  const verified = crypto.verify(
    null,
    message,
    crypto.createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey]),
      format: "der",
      type: "spki",
    }),
    signature,
  );
  assert.equal(verified, true);
});

test("ed25519: rejects a key of the wrong length", () => {
  assert.throws(() => signWithExpandedKey(Buffer.alloc(32), Buffer.from("x"), Buffer.alloc(32)), /64 bytes/);
});

test("preimage: raw file bytes, not a digest of them", () => {
  const data = Buffer.from("A");
  const expected = crypto
    .createHash("sha512")
    .update(data)
    .update("OfirPardo", "utf8")
    .update("2026-08-10T12:41:01.671Z", "utf8")
    .update("", "utf8")
    .digest();

  assert.deepEqual(
    modulePreimage({ data, developerId: "OfirPardo", timestamp: "2026-08-10T12:41:01.671Z" }),
    expected,
  );
});

test("preimage: entitlements are newline-joined and last", () => {
  const base = { data: Buffer.from("A"), developerId: "dev", timestamp: "2026-01-01T00:00:00.000Z" };
  const joined = crypto
    .createHash("sha512")
    .update(base.data)
    .update(base.developerId, "utf8")
    .update(base.timestamp, "utf8")
    .update("file-system\nnetwork", "utf8")
    .digest();

  assert.deepEqual(modulePreimage({ ...base, entitlements: ["file-system", "network"] }), joined);
  // No entitlements must be identical to the empty string, which is what makes
  // our own unentitled modules reproducible.
  assert.deepEqual(modulePreimage(base), modulePreimage({ ...base, entitlements: [] }));
});

test("preimage: the timestamp is covered", () => {
  const base = { data: Buffer.from("A"), developerId: "dev" };
  assert.notDeepEqual(
    modulePreimage({ ...base, timestamp: "2026-01-01T00:00:00.000Z" }),
    modulePreimage({ ...base, timestamp: "2026-01-01T00:00:00.001Z" }),
  );
});

test("timestamp: ISO 8601 with milliseconds and Z", () => {
  assert.match(signingTimestamp(new Date(Date.UTC(2026, 7, 10, 12, 41, 1, 671))), /^2026-08-10T12:41:01\.671Z$/);
});

test("xsgn: carries the signature, timestamp and developer id", () => {
  const document = xsgnDocument({
    developerId: "OfirPardo",
    timestamp: "2026-08-10T12:41:01.671Z",
    creationTime: "2026-08-10T12:41:01.671Z",
    signature: Buffer.alloc(64, 7),
  });
  assert.match(document, /<Signature version="1\.0" developerId="OfirPardo">/);
  assert.match(document, /<Timestamp>2026-08-10T12:41:01\.671Z<\/Timestamp>/);
  assert.match(document, /<CodeSignature encoding="Base64">[A-Za-z0-9+/=]+<\/CodeSignature>/);
  assert.ok(document.endsWith("</xsgn>\n"));
});
