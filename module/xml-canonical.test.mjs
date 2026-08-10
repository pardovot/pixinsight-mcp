// Proves the Node .xri canonicaliser reproduces PixInsight, on two independent
// checks against fixtures captured from PixInsight 1.9.4 (module/test-fixtures/xri):
//
//   Layer 1: serializeCompact(parse(input)) is byte-identical to PixInsight's
//            own .canonical output (no crypto involved).
//   Both:    the recovered preimage verifies against PixInsight's real
//            signature for each probe (public key only).
//
// The fixtures are synthetic documents plus PixInsight's public signatures; no
// private key material is committed.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseXml, serializeCompact, xriPreimage } from "./xml-canonical.mjs";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "test-fixtures", "xri");
const PROBES = [
  "flat",
  "indented",
  "indented2",
  "odd",
  "oneline",
  "textonly",
  // Entity handling: preserved references, references in an attribute, and a
  // literal '>' that PixInsight escapes on the way out.
  "entity-text",
  "entity-mixed",
  "entity-literalgt",
];

const stripDeclaration = (text) => text.replace(/^<\?xml[^>]*\?>/, "");

const { developerId, publicKeyHex } = JSON.parse(fs.readFileSync(path.join(fixtures, "pubkey.json"), "utf8"));
const publicKey = crypto.createPublicKey({
  key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyHex, "hex")]),
  format: "der",
  type: "spki",
});

// The real updates.xri, captured because it exercises what the synthetic
// probes missed: an apostrophe in text content, which PixInsight escapes as
// &apos;. It has no signature fixture, so only the serialisation is checked.
test("realworld updates.xri: compact serialisation matches PixInsight", () => {
  const input = fs.readFileSync(path.join(fixtures, "realworld.xri.input"), "utf8");
  const canonical = fs.readFileSync(path.join(fixtures, "realworld.xri.canonical"), "utf8");
  const { root } = parseXml(input);
  assert.equal(serializeCompact(root), stripDeclaration(canonical));
});

test("text apostrophes are escaped, attribute apostrophes are not", () => {
  const { root } = parseXml(`<xri version="1.0"><p note="it's">it's</p></xri>`);
  assert.equal(serializeCompact(root), `<xri version="1.0"><p note="it's">it&apos;s</p></xri>`);
});

for (const probe of PROBES) {
  const input = fs.readFileSync(path.join(fixtures, `${probe}.xri.input`), "utf8");
  const canonical = fs.readFileSync(path.join(fixtures, `${probe}.xri.canonical`), "utf8");
  const signed = fs.readFileSync(path.join(fixtures, `${probe}.xri`), "utf8");
  const { root } = parseXml(input);

  test(`${probe}: compact serialisation matches PixInsight`, () => {
    assert.equal(serializeCompact(root), stripDeclaration(canonical));
  });

  test(`${probe}: recovered preimage verifies against PixInsight's signature`, () => {
    const element = signed.match(/<Signature\s+([^>]*)>([^<]+)<\/Signature>/);
    assert.ok(element, "fixture has a <Signature> element");
    const signatureDev = element[1].match(/developerId="([^"]+)"/)[1];
    const timestamp = element[1].match(/timestamp="([^"]+)"/)[1];
    assert.equal(signatureDev, developerId);

    const preimage = xriPreimage(root, signatureDev, timestamp);
    assert.equal(crypto.verify(null, preimage, publicKey, Buffer.from(element[2], "base64")), true);
  });
}

test("guard: CDATA is refused rather than mis-signed", () => {
  assert.throws(() => parseXml('<xri version="1.0"><![CDATA[x]]></xri>'), /unsupported markup/);
});

test("guard: an unknown entity is refused rather than guessed at", () => {
  assert.throws(() => parseXml('<xri version="1.0"><p>a&nbsp;b</p></xri>'), /unknown entity/);
});

test("guard: a numeric character reference is refused", () => {
  assert.throws(() => parseXml('<xri version="1.0"><p>a&#62;b</p></xri>'), /numeric character reference/);
});

test("entities: a literal '>' is escaped, matching PixInsight", () => {
  const { root } = parseXml('<xri version="1.0"><q>a > b</q></xri>');
  assert.equal(serializeCompact(root), '<xri version="1.0"><q>a &gt; b</q></xri>');
});
