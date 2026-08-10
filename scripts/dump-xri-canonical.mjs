// Debug helper: print our canonical rendering of an .xri, for diffing against
// PixInsight's own (XMLDocument.parse().serialize()).
//
//   node scripts/dump-xri-canonical.mjs <file.xri> [outfile]

import fs from "node:fs";
import { parseXml, serializeCompact, canonicalizeRoot } from "../module/xml-canonical.mjs";

const file = process.argv[2];
if (!file) throw new Error("usage: node scripts/dump-xri-canonical.mjs <file.xri> [outfile]");

const text = fs.readFileSync(file, "utf8");
// Ignore any appended <Signature>: it is not part of the signed document.
const body = text.includes("<Signature") ? text.slice(0, text.indexOf("<Signature")) : text;

const { root } = parseXml(body);
const compact = serializeCompact(root);
const canonical = canonicalizeRoot(compact);

if (process.argv[3]) fs.writeFileSync(process.argv[3], compact);

console.log(`compact   : ${Buffer.byteLength(compact)} bytes`);
console.log(`canonical : ${Buffer.byteLength(canonical)} bytes`);
console.log("\n--- compact (layer 1) ---");
console.log(compact);
