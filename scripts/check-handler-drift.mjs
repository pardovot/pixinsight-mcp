// Fails when a bridge call in src/ sends a parameter its handler in pjsr/ never reads, so a tool
// cannot offer an option PixInsight silently ignores. Static source analysis, runs in npm run build.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pjsrDir = path.join(repoRoot, "pjsr");
const srcDir = path.join(repoRoot, "src");
const errors = [];

// Handler side: verb to handler from ROUTES, and the parameters each handler reads.

const dispatch = fs.readFileSync(path.join(pjsrDir, "dispatch.js"), "utf8");
const routesText = dispatch.slice(dispatch.indexOf("var ROUTES = {"));
const verbToHandler = new Map();
// One `verb: handleName,` entry per line. Group 1 is the verb, group 2 the handler.
for (const route of routesText.slice(0, routesText.indexOf("};")).matchAll(/^\s+(\w+): (handle\w+),?$/gm))
  verbToHandler.set(route[1], route[2]);
if (verbToHandler.size === 0) errors.push("no routes found in pjsr/dispatch.js, parser broken?");

const pjsrSource = fs.readdirSync(pjsrDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => fs.readFileSync(path.join(pjsrDir, name), "utf8"))
  .join("\n");

// Function bodies, split at each top level `function name(`. Group 1 is the function name.
const functionBodies = new Map();
const functionStarts = [...pjsrSource.matchAll(/^function (\w+)\(/gm)];
functionStarts.forEach((start, index) => {
  const end = index + 1 < functionStarts.length ? functionStarts[index + 1].index : pjsrSource.length;
  functionBodies.set(start[1], pjsrSource.slice(start.index, end));
});

function parametersRead(body) {
  const keys = new Set();
  // `command.parameters.<key>`, group 1 is the key.
  for (const read of body.matchAll(/command\.parameters\.(\w+)/g)) keys.add(read[1]);
  // `var <alias> = command.parameters`, group 1 is the alias, then `<alias>.<key>` reads.
  const alias = body.match(/var (\w+) = command\.parameters\b/);
  if (alias)
    for (const read of body.matchAll(new RegExp(`\\b${alias[1]}\\.(\\w+)`, "g"))) keys.add(read[1]);
  return keys;
}

// TS side: the literal parameter object of every bridge.call and bridge.request.

// Top level keys of an object literal's inside, each part being `key: value` or a shorthand `key`.
function topLevelKeys(objectText) {
  const keys = [];
  let depth = 0;
  let part = "";
  const addKey = (text) => {
    // Group 1 is the property name.
    const match = text.trim().match(/^(\w+)\s*(?::|$)/);
    if (match) keys.push(match[1]);
  };
  for (const character of objectText) {
    if ("({[".includes(character)) depth++;
    else if (")}]".includes(character)) depth--;
    if (character === "," && depth === 0) {
      addKey(part);
      part = "";
    } else {
      part += character;
    }
  }
  addKey(part);
  return keys;
}

// `.call("verb"` or `.request<Type>("verb"`. Group 1 is the verb.
const CALL_PATTERN = /\.(?:call|request)(?:<[^(]*?>)?\(\s*"(\w+)"\s*/g;

function sentParameters(source) {
  const sends = [];
  for (const match of source.matchAll(CALL_PATTERN)) {
    let index = match.index + match[0].length;
    if (source[index] !== ",") continue;
    const start = index + 1;
    let depth = 0;
    for (; index < source.length; ++index) {
      const character = source[index];
      if ("({[".includes(character)) {
        depth++;
      } else if (")}]".includes(character)) {
        if (depth === 0) break;
        depth--;
      } else if (character === "," && depth === 0 && index > start) {
        break;
      }
    }
    const argument = source.slice(start, index).trim();
    if (!argument.startsWith("{") || !argument.endsWith("}")) continue;
    sends.push({ verb: match[1], keys: topLevelKeys(argument.slice(1, -1)) });
  }
  return sends;
}

function* typeScriptFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* typeScriptFiles(entryPath);
    else if (entry.name.endsWith(".ts")) yield entryPath;
  }
}

for (const filePath of typeScriptFiles(srcDir)) {
  const file = path.relative(repoRoot, filePath);
  for (const { verb, keys } of sentParameters(fs.readFileSync(filePath, "utf8"))) {
    const handler = verbToHandler.get(verb);
    if (!handler) {
      errors.push(`${file}: sends verb "${verb}" but pjsr/dispatch.js has no route for it`);
      continue;
    }
    const body = functionBodies.get(handler);
    if (!body) {
      errors.push(`pjsr/dispatch.js: route "${verb}" points at missing function ${handler}`);
      continue;
    }
    const reads = parametersRead(body);
    for (const key of keys)
      if (!reads.has(key)) errors.push(`${file}: "${verb}" sends parameter "${key}" but ${handler} never reads it`);
  }
}

if (errors.length) {
  console.error("Handler drift check failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`Handler drift check OK (${verbToHandler.size} verbs)`);
