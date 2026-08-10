// Builds the PixInsight update-repository packages for the native MCP Watcher
// MODULE and generates pi-repo/updates.xri.
//
// The repo channel ships the compiled non-blocking module (MCPWatcher-pxm.*),
// NOT the old blocking JS watcher, so users install/update it straight from
// PixInsight's Resources > Updates. Format per the PixInsight Repository
// Reference (type="module"; the archive's internal directory layout is the
// install path relative to the PixInsight root):
//   Windows / Linux / FreeBSD :  bin/MCPWatcher-pxm.{dll,so}   (+ .xsgn)
//   macOS                      :  MacOS/MCPWatcher-pxm.dylib    (+ .xsgn)
// The macOS .dylib is ONE universal binary covering Apple Silicon and Intel;
// see PLATFORMS below for why it cannot be two per-arch packages.
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
// SIGNING: each platform's binary must be signed (npm run module:sign) before it
// is packaged; an unsigned module is REJECTED by PixInsight on install, so a
// platform without a .xsgn is skipped rather than shipped broken.
//
// Binaries are found either per platform in module/build/<os>/ (how a
// multi-platform release is staged) or flat in module/build/ (a local
// single-platform build). Each binary's signature must sit beside it: the
// signature file name is derived from the binary, so all three platforms
// staged flat in one directory would collide on MCPWatcher-pxm.xsgn.
//
// This script does NOT sign updates.xri; signing is a separate step, the same
// split as module:build / module:sign:
//   npm run repo:sign     (node module/sign-xri.mjs pi-repo/updates.xri)
// The release workflow runs it automatically. An unsigned index still installs,
// but PixInsight asks the user to confirm first. See docs/SIGNING.md.

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
// arch "x64" == "x86_64". macOS binaries live in MacOS/, not bin/: that is the
// binary directory inside the application bundle, which is the macOS install
// root ("Deployment Directories" in the reference).
//
// macOS is ONE universal binary declared arch="all", which is what RC Astro
// ships for 1.9.4 and what the documented arch tokens support (the reference
// lists noarch/any/all/x86/i386/i586/i686/x86_64/x64, no arm64).
//
// Per-arch macOS packages do exist in the wild - StarNet ships separate x64 and
// ARM64 macOS lanes because their two builds use different inference backends -
// so the update system can evidently address arm64 somehow. We deliberately do
// not: on macOS the package is selected by which PixInsight BUILD the user
// installed, not by their CPU, and a fat binary satisfies both builds from one
// artifact with one signature. We have no per-arch difference that would pay
// for a second package. macArchAttribute below keeps the "all" claim honest.
const PLATFORMS = [
  { os: "windows", arch: "x64", ext: ".dll", dir: "bin" },
  { os: "linux", arch: "x64", ext: ".so", dir: "bin" },
  { os: "macosx", arch: "all", ext: ".dylib", dir: "MacOS" },
];
const PI_VERSION_RANGE = "1.9.4:1.9.99";

// Mach-O headers, enough to tell a universal binary from a thin one.
const FAT_MAGIC = 0xcafebabe; // universal, 32-bit table, always big-endian
const FAT_MAGIC_64 = 0xcafebabf; // universal, 64-bit table
const MH_MAGIC_64 = 0xfeedfacf; // thin 64-bit, little-endian on x86_64/arm64
const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;

/**
 * Verify the macOS binary really is universal, and return the arch attribute to
 * publish it under. A thin x86_64 dylib is still publishable, just Intel-only;
 * a thin arm64 one is not publishable at all, since the format cannot express
 * that architecture. Shipping either as arch="all" would hand half of macOS a
 * module their PixInsight cannot load.
 */
function macArchAttribute(binary, declaredArch) {
  const fatMagic = binary.readUInt32BE(0);
  if (fatMagic === FAT_MAGIC || fatMagic === FAT_MAGIC_64) {
    console.log(`    universal binary, ${binary.readUInt32BE(4)} slices`);
    return declaredArch;
  }
  const cpuType = binary.readUInt32LE(0) === MH_MAGIC_64 ? binary.readUInt32LE(4) : 0;
  if (cpuType === CPU_TYPE_X86_64) {
    console.log("  ! macosx: THIN x86_64 dylib, publishing as arch=\"x64\" (Apple Silicon gets nothing).");
    console.log("    Build the universal binary instead: node module/build.mjs on macOS.");
    return "x64";
  }
  if (cpuType === CPU_TYPE_ARM64) {
    throw new Error(
      "macosx: the module is a THIN arm64 dylib, which cannot be published.\n" +
        "        PixInsight's repository format has no arm64 architecture token, so an\n" +
        "        Apple Silicon module can only ship inside a universal binary.\n" +
        "        Rebuild with node module/build.mjs on macOS (it lipos both slices).",
    );
  }
  throw new Error(`macosx: ${MODULE_BASE}.dylib is not a Mach-O binary (magic 0x${binary.readUInt32BE(0).toString(16)}).`);
}

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

// Build one package per platform whose SIGNED binary is present.
const version = readVersion();
const built = [];
let newestMtime = 0;

// pi-repo/ is a build output staging dir (published to the dist branch), not
// tracked on main, so create it on demand.
fs.mkdirSync(piRepoDir, { recursive: true });

for (const plat of PLATFORMS) {
  // Per-platform staging directory first, then the flat local build.
  const candidates = [
    path.join(buildDir, plat.os, MODULE_BASE + plat.ext),
    path.join(buildDir, MODULE_BASE + plat.ext),
  ];
  const binPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!binPath) {
    console.log(`  - ${plat.os}: no ${MODULE_BASE}${plat.ext} in module/build/, skipped`);
    continue;
  }
  const sgnPath = binPath.replace(/\.[^.]+$/, ".xsgn");
  if (!fs.existsSync(sgnPath)) {
    console.log(`  ! ${plat.os}: ${MODULE_BASE}${plat.ext} present but UNSIGNED, skipped (run npm run module:sign)`);
    continue;
  }
  const binary = fs.readFileSync(binPath);
  const arch = plat.os === "macosx" ? macArchAttribute(binary, plat.arch) : plat.arch;
  const entries = [
    { name: `${plat.dir}/${MODULE_BASE}${plat.ext}`, data: binary },
    { name: `${plat.dir}/${MODULE_BASE}.xsgn`, data: fs.readFileSync(sgnPath) },
  ];
  const zip = buildZip(entries);
  const fileName = `mcpwatcher-module-${plat.os}.zip`;
  fs.writeFileSync(path.join(piRepoDir, fileName), zip);
  const sha1 = createHash("sha1").update(zip).digest("hex");
  newestMtime = Math.max(newestMtime, fs.statSync(binPath).mtimeMs);
  built.push({ plat, arch, fileName, sha1 });
  console.log(`  + ${plat.os}/${arch}: ${fileName}  (${plat.dir}/${MODULE_BASE}${plat.ext} + .xsgn)  sha1=${sha1}`);
}

if (built.length === 0) {
  console.error("\n[ERROR] No signed module binary found in module/build/.");
  console.error("        Run: npm run module:build && npm run module:sign, then retry.");
  process.exit(1);
}

// Remove the retired JS-watcher package if it is still lying around.
const oldZip = path.join(piRepoDir, "pixinsight-mcp-watcher.zip");
if (fs.existsSync(oldZip)) {
  fs.rmSync(oldZip);
  console.log("  - removed stale pixinsight-mcp-watcher.zip (JS-watcher package retired)");
}

// ---------------------------------------------------------------------------
// Generate updates.xri. It is signed afterwards by `npm run repo:sign`.
// <metadata> is declared once and referenced by every platform's <package>.
// ---------------------------------------------------------------------------
const releaseDate = fmtDate(new Date(newestMtime));
const metaId = `${releaseDate}-mcpwatcher-module`;

const platformBlocks = built
  .map(
    ({ plat, arch, fileName, sha1 }) =>
      `   <platform os="${plat.os}" arch="${arch}" version="${PI_VERSION_RANGE}">\n` +
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
console.log("Modules are signed. updates.xri is NOT signed yet: run `npm run repo:sign` before");
console.log("publishing, or PixInsight will ask users to confirm an unsigned repository.");
