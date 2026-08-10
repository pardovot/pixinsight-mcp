// Debug helper: diff PixInsight's canonical rendering of an .xri against ours.
//
//   node scripts/diff-xri-canonical.mjs <theirs.txt> <ours.txt>
//
// "theirs" is XMLDocument.parse(file).serialize() captured from PixInsight;
// its XML declaration is stripped before comparing, since the signed document
// is the root element alone.

import fs from "node:fs";

const [theirsPath, oursPath] = process.argv.slice(2);
if (!theirsPath || !oursPath) throw new Error("usage: node scripts/diff-xri-canonical.mjs <theirs> <ours>");

const theirs = fs.readFileSync(theirsPath, "utf8").replace(/^<\?xml[^>]*\?>/, "");
const ours = fs.readFileSync(oursPath, "utf8");

console.log(`theirs: ${Buffer.byteLength(theirs)} bytes`);
console.log(`ours  : ${Buffer.byteLength(ours)} bytes`);

if (theirs === ours) {
  console.log("\nIDENTICAL");
  process.exit(0);
}

let at = 0;
while (at < theirs.length && at < ours.length && theirs[at] === ours[at]) at++;
const window = (text) => JSON.stringify(text.slice(Math.max(0, at - 70), at + 70));
console.log(`\nfirst difference at offset ${at}`);
console.log(`theirs: ${window(theirs)}`);
console.log(`ours  : ${window(ours)}`);
process.exitCode = 1;
