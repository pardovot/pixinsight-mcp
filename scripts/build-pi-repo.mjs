// Builds the PixInsight update-repository packages for the native MCP Watcher
// MODULE and generates pi-repo/updates.xri.
//
// The repo channel ships the compiled non-blocking module (MCPWatcher-pxm.*),
// NOT the old blocking JS watcher — so users install/update it straight from
// PixInsight's Resources > Updates. Format per the PixInsight Repository
// Reference (type="module"; the archive's internal directory layout is the
// install path relative to the PixInsight root):
//   Windows / Linux / FreeBSD :  bin/MCPWatcher-pxm.{dll,so}   (+ .xsgn)
//   macOS                      :  MacOS/MCPWatcher-pxm.dylib    (+ .xsgn)
//
// Cross-platform + pure Node (zip written directly via node:zlib; no deps).
// Reproducible: fixed zip entry order + timestamps, so identical module
// binaries produce a byte-identical package (stable sha1).
//
// Packages WHAT EXISTS: it probes module/build/ for each platform's binary and
// emits a <platform>/<package> only for those present (+ a signed .xsgn). On a
// given machine you build+sign one platform; collect the others' builds into
// module/build/ (or run this on each) to publish all three.
//
// Usage:  node scripts/build-pi-repo.mjs   (npm run repo:build)
//
// ⚠ SIGNING TEMPORARILY DISABLED (pending Certified PixInsight Developer status).
// The distributed repo ships the module UNSIGNED and updates.xri UNSIGNED. Reason:
// our only signing identity is LOCAL (developerId 0104952866723499). On another
// machine that identity is untrusted, and PixInsight REJECTS an untrusted-signed
// repo/module outright — whereas an UNSIGNED repo triggers a user-confirmation
// prompt and installs. So for distribution, no signature beats a local one.
//   - This script no longer requires/embeds the module .xsgn (binary-only zip).
//   - Do NOT run `node module/sign.mjs pi-repo/updates.xri` — leave the xri unsigned.
// Local install (module:install) still uses the signed module and is unaffected.
// RE-ENABLE once a CPD identity exists: restore the .xsgn packaging below and the
// updates.xri sign step. sign.mjs and `npm run module:sign` are kept intact.
// Full checklist: docs/POST-CDP-SIGNING.md

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(repo, "module", "build");
const piRepoDir = path.join(repo, "pi-repo");
const xriPath = path.join(piRepoDir, "updates.xri");
const versionHeader = path.join(repo, "module", "src", "Version.h");

const MODULE_BASE = "MCPWatcher-pxm"; // module Id + "-pxm" (see module/config.mjs)

// os/arch values and install directory per the PixInsight Repository Reference.
// arch "x64" == "x86_64". macOS binaries live in MacOS/, not bin/.
const PLATFORMS = [
  { os: "windows", arch: "x64", ext: ".dll", dir: "bin" },
  { os: "linux", arch: "x64", ext: ".so", dir: "bin" },
  { os: "macosx", arch: "x64", ext: ".dylib", dir: "MacOS" },
];
const PI_VERSION_RANGE = "1.9.4:1.9.99";

// ---------------------------------------------------------------------------
// Reproducible zip writer (raw deflate; fixed DOS timestamp so the sha1 depends
// only on the entry names + contents).
// ---------------------------------------------------------------------------
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01
const DOS_TIME = 0;

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

function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "ascii");
    const crc = crc32(data);
    const compressed = deflateRawSync(data, { level: 9 });

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(DOS_TIME, 12);
    cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(compressed.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, nameBuf]));

    chunks.push(local, nameBuf, compressed);
    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

// ---------------------------------------------------------------------------
function readVersion() {
  const src = fs.readFileSync(versionHeader, "utf8");
  const m = src.match(/MCPWATCHER_VERSION_STR\s+"([^"]+)"/);
  return m ? m[1] : "0.0.0";
}
function fmtDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// Build one package per platform whose binary is present in module/build/.
// UNSIGNED distribution (see header): the module .xsgn is intentionally NOT
// bundled — an untrusted local signature is rejected on other machines, while an
// unsigned module installs after a confirmation prompt.
const version = readVersion();
const built = [];
let newestMtime = 0;

for (const plat of PLATFORMS) {
  const binPath = path.join(buildDir, MODULE_BASE + plat.ext);
  if (!fs.existsSync(binPath)) {
    console.log(`  - ${plat.os}: no ${MODULE_BASE}${plat.ext} in module/build/ — skipped`);
    continue;
  }
  const entries = [
    { name: `${plat.dir}/${MODULE_BASE}${plat.ext}`, data: fs.readFileSync(binPath) },
  ];
  const zip = buildZip(entries);
  const fileName = `mcpwatcher-module-${plat.os}.zip`;
  fs.writeFileSync(path.join(piRepoDir, fileName), zip);
  const sha1 = createHash("sha1").update(zip).digest("hex");
  newestMtime = Math.max(newestMtime, fs.statSync(binPath).mtimeMs);
  built.push({ plat, fileName, sha1 });
  console.log(`  + ${plat.os}/${plat.arch}: ${fileName}  (${plat.dir}/${MODULE_BASE}${plat.ext}, unsigned)  sha1=${sha1}`);
}

if (built.length === 0) {
  console.error("\n[ERROR] No module binary found in module/build/.");
  console.error("        Run: npm run module:build, then retry.");
  process.exit(1);
}

// Remove the retired JS-watcher package if it is still lying around.
const oldZip = path.join(piRepoDir, "pixinsight-mcp-watcher.zip");
if (fs.existsSync(oldZip)) {
  fs.rmSync(oldZip);
  console.log("  - removed stale pixinsight-mcp-watcher.zip (JS-watcher package retired)");
}

// ---------------------------------------------------------------------------
// Generate updates.xri (unsigned — sign.mjs appends the <Signature> block).
// <metadata> is declared once and referenced by every platform's <package>.
// ---------------------------------------------------------------------------
const releaseDate = fmtDate(new Date(newestMtime));
const metaId = `${releaseDate}-mcpwatcher-module`;

const platformBlocks = built
  .map(
    ({ plat, fileName, sha1 }) =>
      `   <platform os="${plat.os}" arch="${plat.arch}" version="${PI_VERSION_RANGE}">\n` +
      `      <package fileName="${fileName}" sha1="${sha1}" type="module" metadata="${metaId}"/>\n` +
      `   </platform>`,
  )
  .join("\n");

const xri =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<xri version="1.0">\n` +
  `   <description>\n` +
  `      <p>\n` +
  `         PixInsight MCP Watcher - installs the non-blocking native module\n` +
  `         (MCPWatcher-pxm) that lets AI assistants drive PixInsight via the\n` +
  `         @pardovot/pixinsight-mcp MCP server. https://github.com/pardovot/pixinsight-mcp\n` +
  `      </p>\n` +
  `   </description>\n` +
  `   <metadata id="${metaId}" releaseDate="${releaseDate}">\n` +
  `      <title>\n` +
  `         PixInsight MCP Watcher Module ${version}\n` +
  `      </title>\n` +
  `      <description>\n` +
  `         <p>\n` +
  `            Non-blocking bridge module: a pcl::Timer on PixInsight's event loop\n` +
  `            polls ~/.pixinsight-mcp/bridge for commands from the MCP server and\n` +
  `            runs them while PixInsight stays fully interactive. Open it under\n` +
  `            Process &gt; Utilities &gt; MCP Watcher.\n` +
  `         </p>\n` +
  `      </description>\n` +
  `   </metadata>\n` +
  platformBlocks +
  `\n</xri>\n`;

fs.writeFileSync(xriPath, xri, "utf8");
console.log(`\nwrote ${xriPath}  (version ${version}, releaseDate ${releaseDate}, ${built.length} platform(s))`);
console.log("This repo is UNSIGNED (pre-CDP): other machines get a confirmation prompt, then install.");
console.log("Do NOT sign updates.xri — a local-identity signature is rejected on other machines.");
