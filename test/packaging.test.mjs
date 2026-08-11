// Packaging tests for scripts/build-pi-repo.mjs, the step that decides what the
// PixInsight update repository actually claims: which architecture each package
// declares, and where the binary lands inside the zip.
//
// Why this exists: on 2026-08-11 an arm64-only dylib shipped declared as
// arch="x64". Nothing caught it, because a local module install bypasses the
// package entirely and this script only ever ran inside the release job. These
// tests run it against synthetic binaries, so the class of bug is caught on a
// pull request instead of after publishing.
//
// No PixInsight and no compiler needed: the packager only reads file headers.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- synthetic binaries ------------------------------------------------------
// Only the first 8 bytes matter to the packager.
const machO = (magic, cpuType, bigEndian) => {
  const buffer = Buffer.alloc(64);
  if (bigEndian) {
    buffer.writeUInt32BE(magic, 0);
    buffer.writeUInt32BE(cpuType, 4); // slice count for a fat header
  } else {
    buffer.writeUInt32LE(magic, 0);
    buffer.writeUInt32LE(cpuType, 4);
  }
  return buffer;
};
const FAT = () => machO(0xcafebabe, 2, true);
const THIN_X86_64 = () => machO(0xfeedfacf, 0x01000007, false);
const THIN_ARM64 = () => machO(0xfeedfacf, 0x0100000c, false);
const NOT_MACHO = () => Buffer.from("this is not a Mach-O binary at all, just text");

/** Entry names, read from the central directory rather than scanned for. */
function zipEntryNames(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.notEqual(eocd, -1, "zip has no end-of-central-directory record");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, "bad central directory header");
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.toString("ascii", offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

/** Stage binaries per platform and run the packager against temp directories. */
async function pack(t, platforms) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-pack-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const buildDir = path.join(root, "build");
  const outDir = path.join(root, "pi-repo");

  for (const [osName, { ext, bytes, signed = true }] of Object.entries(platforms)) {
    const dir = path.join(buildDir, osName);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `MCPWatcher-pxm${ext}`), bytes);
    if (signed) await fs.writeFile(path.join(dir, "MCPWatcher-pxm.xsgn"), "<xsgn/>");
  }

  const result = spawnSync(process.execPath, [path.join(repo, "scripts", "build-pi-repo.mjs")], {
    encoding: "utf8",
    env: { ...process.env, MCP_BUILD_DIR: buildDir, MCP_PI_REPO_DIR: outDir },
  });
  const xriPath = path.join(outDir, "updates.xri");
  const xri = await fs.readFile(xriPath, "utf8").catch(() => null);
  return { result, xri, outDir };
}

const platformLine = (xri, osName) =>
  xri.split("\n").find((line) => line.includes(`<platform os="${osName}"`)) ?? "";

// --- tests -------------------------------------------------------------------

test("a universal macOS dylib is published as arch=all, in MacOS/", async (t) => {
  const { result, xri, outDir } = await pack(t, {
    windows: { ext: ".dll", bytes: Buffer.from("MZ fake dll") },
    linux: { ext: ".so", bytes: Buffer.from("\x7fELF fake so") },
    macosx: { ext: ".dylib", bytes: FAT() },
  });
  assert.equal(result.status, 0, result.stderr);

  assert.match(platformLine(xri, "windows"), /arch="x64"/);
  assert.match(platformLine(xri, "linux"), /arch="x64"/);
  assert.match(platformLine(xri, "macosx"), /arch="all"/);

  // The install path is the archive's internal layout: bin/ everywhere except
  // macOS, where it is the app bundle's MacOS/ directory.
  const names = async (file) => zipEntryNames(await fs.readFile(path.join(outDir, file)));
  assert.deepEqual((await names("mcpwatcher-module-windows.zip")).sort(), [
    "bin/MCPWatcher-pxm.dll",
    "bin/MCPWatcher-pxm.xsgn",
  ]);
  assert.deepEqual((await names("mcpwatcher-module-linux.zip")).sort(), [
    "bin/MCPWatcher-pxm.so",
    "bin/MCPWatcher-pxm.xsgn",
  ]);
  assert.deepEqual((await names("mcpwatcher-module-macosx.zip")).sort(), [
    "MacOS/MCPWatcher-pxm.dylib",
    "MacOS/MCPWatcher-pxm.xsgn",
  ]);
});

test("a thin arm64 dylib is refused, it cannot be expressed in the format", async (t) => {
  const { result, xri } = await pack(t, { macosx: { ext: ".dylib", bytes: THIN_ARM64() } });
  assert.notEqual(result.status, 0, "publishing an arm64-only dylib must fail");
  assert.match(result.stderr, /THIN arm64/);
  assert.equal(xri, null, "no updates.xri should be written");
});

test("a thin x86_64 dylib degrades to arch=x64 with a warning", async (t) => {
  const { result, xri } = await pack(t, { macosx: { ext: ".dylib", bytes: THIN_X86_64() } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(platformLine(xri, "macosx"), /arch="x64"/);
  assert.match(result.stdout, /THIN x86_64/);
});

test("a non Mach-O file is refused rather than shipped", async (t) => {
  const { result } = await pack(t, { macosx: { ext: ".dylib", bytes: NOT_MACHO() } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a Mach-O binary/);
});

test("an unsigned binary is skipped, PixInsight would reject it anyway", async (t) => {
  const { result, xri } = await pack(t, {
    windows: { ext: ".dll", bytes: Buffer.from("MZ fake dll"), signed: false },
    macosx: { ext: ".dylib", bytes: FAT() },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /UNSIGNED, skipped/);
  assert.equal(platformLine(xri, "windows"), "", "an unsigned platform must not appear");
  assert.match(platformLine(xri, "macosx"), /arch="all"/);
});

test("packaging is reproducible: identical inputs give an identical sha1", async (t) => {
  const inputs = { macosx: { ext: ".dylib", bytes: FAT() } };
  const first = await pack(t, inputs);
  const second = await pack(t, inputs);
  const sha = (xri) => xri.match(/sha1="([0-9a-f]+)"/)?.[1];
  assert.ok(sha(first.xri));
  assert.equal(sha(first.xri), sha(second.xri));
});
