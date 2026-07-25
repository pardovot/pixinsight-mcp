// Handler drift check, runs in `npm run build`.
//
// Guards the failure mode behind the 2026-07-26 save_image incident: a TS tool
// sends a bridge parameter the embedded handler never reads, so the primitive
// silently ignores it. Two checks:
//   1. Every parameter key a src/tools/*.ts sendCommand() sends to a handler
//      verb must be read by that verb's handler in pjsr/pixinsight-mcp-watcher.js
//      (as `command.parameters.<key>` or `<alias>.<key>` where
//      `var <alias> = command.parameters`).
//   2. EXPECTED_HANDLERS_REV (src/bridge/client.ts) must equal
//      HANDLERS_REVISION (watcher JS).
//
// Static source analysis, no build output needed. run_script is exempt: it is
// the generic carrier for TS-side composites (src/pjsr/*.ts).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watcherPath = path.join(repoRoot, "pjsr", "pixinsight-mcp-watcher.js");
const clientPath = path.join(repoRoot, "src", "bridge", "client.ts");
const toolsDir = path.join(repoRoot, "src", "tools");

const errors = [];

// ---------------------------------------------------------------------------
// Watcher side: tool -> handler mapping, and per-handler parameter reads.
// ---------------------------------------------------------------------------

const watcher = fs.readFileSync(watcherPath, "utf8");

const toolToHandler = new Map();
for (const m of watcher.matchAll(/if \(tool === "(\w+)"\) return (handle\w+)\(command\)/g))
  toolToHandler.set(m[1], m[2]);
if (toolToHandler.size === 0) errors.push("no tool routing found in routeCommand, parser broken?");

// Split into function bodies (top-level `function name(` starts a section).
const handlerBodies = new Map();
const fnStarts = [...watcher.matchAll(/^function (\w+)\(/gm)];
for (let i = 0; i < fnStarts.length; ++i) {
  const start = fnStarts[i].index;
  const end = i + 1 < fnStarts.length ? fnStarts[i + 1].index : watcher.length;
  handlerBodies.set(fnStarts[i][1], watcher.slice(start, end));
}

function handlerReads(body) {
  const keys = new Set();
  for (const m of body.matchAll(/command\.parameters\.(\w+)/g)) keys.add(m[1]);
  const alias = body.match(/var (\w+) = command\.parameters/);
  if (alias) {
    const re = new RegExp(`\\b${alias[1]}\\.(\\w+)`, "g");
    for (const m of body.matchAll(re)) keys.add(m[1]);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// TS side: sendCommand("<tool>", <process>, { <keys> }) payloads.
// ---------------------------------------------------------------------------

function topLevelKeys(objText) {
  // objText is the inside of a brace-balanced object literal. Split on
  // depth-0 commas; each part is `key: value` or shorthand `key`.
  const keys = [];
  let depth = 0, part = "";
  const push = (p) => {
    const t = p.trim();
    if (!t) return;
    const m = t.match(/^(\w+)\s*:/) ?? t.match(/^(\w+)$/);
    if (m) keys.push(m[1]);
  };
  for (const ch of objText) {
    if ("({[".includes(ch)) depth++;
    else if (")}]".includes(ch)) depth--;
    if (ch === "," && depth === 0) { push(part); part = ""; }
    else part += ch;
  }
  push(part);
  return keys;
}

function extractSends(source) {
  const sends = [];
  const re = /sendCommand\(\s*"(\w+)"/g;
  for (const m of source.matchAll(re)) {
    const tool = m[1];
    // Walk from the call open-paren, find the third argument's object literal.
    let i = source.indexOf("(", m.index);
    let depth = 0, arg = 0, argStart = i + 1;
    for (; i < source.length; ++i) {
      const ch = source[i];
      if ("({[".includes(ch)) depth++;
      else if (")}]".includes(ch)) {
        depth--;
        if (depth === 0) break;
      } else if (ch === "," && depth === 1) {
        arg++;
        if (arg === 3) break; // params argument fully seen
        argStart = i + 1;
      }
    }
    const paramsText = source.slice(argStart, i).trim();
    if (!paramsText.startsWith("{") || !paramsText.endsWith("}")) continue; // e.g. a variable, skip
    sends.push({ tool, keys: topLevelKeys(paramsText.slice(1, -1)) });
  }
  return sends;
}

for (const file of fs.readdirSync(toolsDir).filter((f) => f.endsWith(".ts"))) {
  const source = fs.readFileSync(path.join(toolsDir, file), "utf8");
  for (const { tool, keys } of extractSends(source)) {
    if (tool === "run_script") continue;
    const handler = toolToHandler.get(tool);
    if (!handler) {
      errors.push(`${file}: sends verb "${tool}" but the watcher has no route for it`);
      continue;
    }
    const body = handlerBodies.get(handler);
    if (!body) {
      errors.push(`watcher: route for "${tool}" points at missing function ${handler}`);
      continue;
    }
    const reads = handlerReads(body);
    for (const key of keys)
      if (!reads.has(key))
        errors.push(
          `${file}: tool "${tool}" sends parameter "${key}" but ${handler} never reads it ` +
            `(the save_image-compression drift class)`
        );
  }
}

// ---------------------------------------------------------------------------
// Revision constants must match.
// ---------------------------------------------------------------------------

const watcherRev = watcher.match(/var HANDLERS_REVISION = (\d+);/)?.[1];
const clientRev = fs.readFileSync(clientPath, "utf8").match(/EXPECTED_HANDLERS_REV = (\d+);/)?.[1];
if (!watcherRev) errors.push("HANDLERS_REVISION not found in watcher JS");
if (!clientRev) errors.push("EXPECTED_HANDLERS_REV not found in client.ts");
if (watcherRev && clientRev && watcherRev !== clientRev)
  errors.push(`revision mismatch: watcher HANDLERS_REVISION=${watcherRev}, client EXPECTED_HANDLERS_REV=${clientRev}`);

if (errors.length) {
  console.error("Handler drift check FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`Handler drift check OK (${toolToHandler.size} verbs, rev ${watcherRev})`);
