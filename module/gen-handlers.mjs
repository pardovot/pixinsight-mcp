// Regenerate src/BridgeHandlersJS.h from the JS watcher's handler section plus
// the recipe scripts in RECIPE_FILES.
//
// Handler logic lives in ONE place, pjsr/pixinsight-mcp-watcher.js. This
// embeds it into the C++ module so the module stays a thin non-blocking shell.
// The recipes are embedded too, so run_recipe only ever calls code that ships
// inside the module.
// build.mjs runs this automatically; a stale header means the module silently
// ships old handler logic.
//
// Cross-platform replacement for the former gen-handlers.sh (which required
// Git Bash on Windows). Output is byte-identical to that script's.

import fs from "node:fs";
import path from "node:path";
import { repoRoot, moduleDir } from "./config.mjs";

const BEGIN = "__MCP_HANDLERS_BEGIN__";
const END = "__MCP_HANDLERS_END__";
// MSVC caps string literals at ~16 KB (C2026), so the JS is emitted as adjacent
// raw string literals which the compiler concatenates.
const CHUNK_LINES = 80;

const source = path.join(repoRoot, "pjsr", "pixinsight-mcp-watcher.js");
// Each file defines entry functions listed in RECIPE_ENTRY_POINTS (watcher JS).
export const RECIPE_FILES = [
  "recipes/osc-rgb-linear.js",
  "scripts/crop-select.js",
  "scripts/profile.js",
];
const output = path.join(moduleDir, "src", "BridgeHandlersJS.h");

export function generate(outputPath = output) {
  const lines = fs.readFileSync(source, "utf8").split(/\r?\n/);

  const start = lines.findIndex((l) => l.includes(BEGIN));
  if (start === -1) throw new Error(`sentinel ${BEGIN} not found in ${source}`);
  const end = lines.findIndex((l, i) => i > start && l.includes(END));
  if (end === -1) throw new Error(`sentinel ${END} not found in ${source}`);

  const body = lines.slice(start + 1, end);
  if (body.length === 0) throw new Error("handler section is empty, refusing to emit an empty header");
  for (const recipe of RECIPE_FILES) {
    body.push("", `// ---- ${recipe} ----`);
    body.push(...fs.readFileSync(path.join(repoRoot, recipe), "utf8").split(/\r?\n/));
  }

  const out = [
    "// Auto-generated from pjsr/pixinsight-mcp-watcher.js (handler section) and the recipe scripts.",
    "// Regenerate with: node module/gen-handlers.mjs",
    "#ifndef __BridgeHandlersJS_h",
    "#define __BridgeHandlersJS_h",
    "namespace pcl {",
    "static const char* const MCP_HANDLERS_JS =",
  ];

  body.forEach((line, i) => {
    if (i % CHUNK_LINES === 0) {
      if (i > 0) out.push(')MCPJS"');
      out.push('R"MCPJS(');
    }
    out.push(line);
  });
  out.push(')MCPJS"');
  out.push(";");
  out.push("} // namespace pcl");
  out.push("#endif");

  // Trailing newline, LF line endings, matches the previous shell version and
  // keeps the file stable across platforms.
  const text = out.join("\n") + "\n";
  fs.writeFileSync(outputPath, text, "utf8");
  return { output: outputPath, lines: out.length };
}

if (process.argv[1] && process.argv[1].endsWith("gen-handlers.mjs")) {
  const { output: file, lines } = generate();
  console.log(`wrote ${file} (${lines} lines)`);
}
