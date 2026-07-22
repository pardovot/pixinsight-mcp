// Builds the PixInsight update package zip and syncs the updates.xri sha1.
// Bundles the watcher .js and, if present, its .xsgn signature — both under
// src/scripts/PixInsightMCP/ (paths extract relative to the PixInsight install).
//
// Cross-platform replacement for the former build-pi-repo.ps1. Pure Node: the
// zip is written directly (local headers + central directory + EOCD, raw
// deflate via node:zlib) — no dependencies.
//
// Reproducible: fixed entry order and a fixed timestamp, so identical inputs
// produce a byte-identical zip (stable sha1) on the same Node/zlib version.
//
// Usage:  node scripts/build-pi-repo.mjs   (npm run repo:build)
//
// NOTE: updates.xri is code-signed. After this script changes its sha1, you
// MUST re-sign it:  node module/sign.mjs pi-repo/updates.xri

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcJs = path.join(repo, "pjsr", "pixinsight-mcp-watcher.js");
const srcSgn = path.join(repo, "pjsr", "pixinsight-mcp-watcher.xsgn"); // optional
const zipPath = path.join(repo, "pi-repo", "pixinsight-mcp-watcher.zip");
const xriPath = path.join(repo, "pi-repo", "updates.xri");
const base = "src/scripts/PixInsightMCP/";

// Fixed timestamp (2026-01-01 00:00:00 UTC) in MS-DOS format, same as the .ps1
// used. Without this, every build stamps the current time → new sha1 each run.
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // yyyy-mm-dd
const DOS_TIME = 0; // 00:00:00

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zip writer: fixed order, deflate, no extra fields — deterministic output. */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "ascii");
    const crc = crc32(data);
    const compressed = deflateRawSync(data, { level: 9 });

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); // central directory signature
    cen.writeUInt16LE(20, 4); // version made by
    cen.writeUInt16LE(20, 6); // version needed
    cen.writeUInt16LE(0, 8); // flags
    cen.writeUInt16LE(8, 10); // method
    cen.writeUInt16LE(DOS_TIME, 12);
    cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(compressed.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    // extra/comment/disk/attrs all zero (offsets 30-37)
    cen.writeUInt32LE(offset, 42); // local header offset
    central.push(Buffer.concat([cen, nameBuf]));

    chunks.push(local, nameBuf, compressed);
    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16); // central directory offset
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

const entries = [{ name: base + "pixinsight-mcp-watcher.js", data: fs.readFileSync(srcJs) }];
console.log(`  + ${entries[0].name}`);
if (fs.existsSync(srcSgn)) {
  entries.push({ name: base + "pixinsight-mcp-watcher.xsgn", data: fs.readFileSync(srcSgn) });
  console.log(`  + ${entries[1].name}`);
  console.log("signature: INCLUDED");
} else {
  console.log("signature: none (unsigned package)");
}

const zip = buildZip(entries);
fs.writeFileSync(zipPath, zip);

const sha1 = createHash("sha1").update(zip).digest("hex");
console.log(`sha1: ${sha1}`);

// Patch the sha1 attribute in updates.xri. Keep it ASCII-only, UTF-8 no BOM —
// the file gets code-signed, so re-encoding it would invalidate the signature.
const content = fs.readFileSync(xriPath, "utf8");
const patched = content.replace(/sha1="[0-9a-f]{40}"/, `sha1="${sha1}"`);
fs.writeFileSync(xriPath, patched, "utf8");
console.log(`updated ${xriPath}`);
console.log("REMINDER: updates.xri must be re-signed: node module/sign.mjs pi-repo/updates.xri");
