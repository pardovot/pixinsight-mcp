// Automatic module version bumping, called by build.mjs before compiling.
//
// The bump SIZE is mechanical, only a protocol-breaking MAJOR needs a human:
//   - MINOR:  HANDLERS_REVISION grew since the lock -> new capability.
//   - PATCH:  shipped sources changed (C++/CMake/handler section) without a
//             handlersRev bump.
//   - MAJOR:  hand-edit Version.h; any manual version ahead of the lock is
//             adopted as-is.
// Repeated builds of unchanged sources do not bump, but every build whose
// sources differ gets its own version, so an installed dev build is always
// identifiable (dev iteration inflates PATCH; that is deliberate, numbers are
// free and the PI updater only needs monotonicity).
//
// module/version.lock.json {version, handlersRev, hash} is committed; the hash
// covers module/src (excluding generated files and Version.h itself) +
// CMakeLists.txt + the watcher's handler section.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { moduleDir, repoRoot } from "./config.mjs";

const versionHeader = path.join(moduleDir, "src", "Version.h");
const lockPath = path.join(moduleDir, "version.lock.json");
const watcherPath = path.join(repoRoot, "pjsr", "pixinsight-mcp-watcher.js");
const GENERATED = new Set(["BridgeHandlersJS.h", "BuildTimestamp.h", "Version.h"]);

const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

function readVersion() {
  const m = read(versionHeader).match(/MCPWATCHER_VERSION_STR\s+"(\d+)\.(\d+)\.(\d+)"/);
  if (!m) throw new Error(`cannot parse MCPWATCHER_VERSION_STR in ${versionHeader}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function readHandlersRev() {
  const m = read(watcherPath).match(/var HANDLERS_REVISION = (\d+);/);
  if (!m) throw new Error("HANDLERS_REVISION not found in watcher JS");
  return Number(m[1]);
}

function sourcesHash() {
  const h = crypto.createHash("sha256");
  const srcDir = path.join(moduleDir, "src");
  for (const f of fs.readdirSync(srcDir).sort()) {
    if (GENERATED.has(f) || !/\.(cpp|h)$/.test(f)) continue;
    h.update(f + "\0" + read(path.join(srcDir, f)) + "\0");
  }
  h.update("CMakeLists.txt\0" + read(path.join(moduleDir, "CMakeLists.txt")) + "\0");
  const watcher = read(watcherPath);
  const begin = watcher.indexOf("__MCP_HANDLERS_BEGIN__");
  const end = watcher.indexOf("__MCP_HANDLERS_END__");
  if (begin === -1 || end === -1) throw new Error("handler sentinels not found in watcher JS");
  h.update("handlers\0" + watcher.slice(begin, end));
  return h.digest("hex");
}

function writeVersionHeader([major, minor, release]) {
  const now = new Date();
  const text = fs
    .readFileSync(versionHeader, "utf8")
    .replace(/(MCPWATCHER_VERSION_MAJOR\s+)\d+/, `$1${major}`)
    .replace(/(MCPWATCHER_VERSION_MINOR\s+)\d+/, `$1${minor}`)
    .replace(/(MCPWATCHER_VERSION_RELEASE\s+)\d+/, `$1${release}`)
    .replace(/(MCPWATCHER_VERSION_STR\s+)"[^"]+"/, `$1"${major}.${minor}.${release}"`)
    .replace(/(MCPWATCHER_RELEASE_YEAR\s+)\d+/, `$1${now.getFullYear()}`)
    .replace(/(MCPWATCHER_RELEASE_MONTH\s+)\d+/, `$1${now.getMonth() + 1}`)
    .replace(/(MCPWATCHER_RELEASE_DAY\s+)\d+/, `$1${now.getDate()}`);
  fs.writeFileSync(versionHeader, text);
}

const str = (v) => v.join(".");
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Sync Version.h with reality; returns {version, action}. */
export function syncVersion() {
  const version = readVersion();
  const handlersRev = readHandlersRev();
  const hash = sourcesHash();
  const writeLock = (v) =>
    fs.writeFileSync(lockPath, JSON.stringify({ version: str(v), handlersRev, hash }, null, 2) + "\n");

  if (!fs.existsSync(lockPath)) {
    writeLock(version);
    return { version: str(version), action: "lock initialized (commit module/version.lock.json)" };
  }
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const lockVersion = lock.version.split(".").map(Number);

  const dv = cmp(version, lockVersion);
  if (dv < 0) throw new Error(`Version.h ${str(version)} is behind the lock ${lock.version}`);
  if (handlersRev < lock.handlersRev)
    throw new Error(`HANDLERS_REVISION ${handlersRev} is behind the lock ${lock.handlersRev}`);
  if (dv > 0) {
    // Manual bump (the MAJOR path, or any deliberate hand edit): adopt it.
    writeLock(version);
    return { version: str(version), action: `manual bump adopted (was ${lock.version})` };
  }

  let next = null, action = null;
  if (handlersRev > lock.handlersRev) {
    next = [version[0], version[1] + 1, 0];
    action = `minor bump, handlersRev ${lock.handlersRev} -> ${handlersRev}`;
  } else if (hash !== lock.hash) {
    next = [version[0], version[1], version[2] + 1];
    action = "patch bump, module sources changed";
  } else {
    return { version: str(version), action: null };
  }
  writeVersionHeader(next);
  writeLock(next);
  return { version: str(next), action: `${action} (commit Version.h + version.lock.json)` };
}

if (process.argv[1] && process.argv[1].endsWith("version.mjs")) {
  const { version, action } = syncVersion();
  console.log(`Module version: ${version}${action ? ` [${action}]` : " (unchanged)"}`);
}
