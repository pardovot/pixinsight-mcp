#!/usr/bin/env node
// ============================================================================
// Installer: copies the MCP watcher(s) into the user's PixInsight scripts
// folder so registration is a single Feature Scripts > Add of one folder.
//
// Usage:
//   npx @pardovot/pixinsight-mcp install-watcher [--dest <dir>]
//
// PixInsight cannot auto-register a script from disk — a one-time
// Feature Scripts > Add of the destination folder is still required. After
// that, PixInsight re-reads the script from disk on every run, so future
// `install-watcher` updates need no re-registration.
// ============================================================================
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pjsrDir = path.join(__dirname, 'pjsr');

// Resolve destination: --dest override, else <home>/Documents/PixInsight/scripts/PixInsightMCP
const destFlag = process.argv.indexOf('--dest');
const dest = destFlag !== -1 && process.argv[destFlag + 1]
  ? path.resolve(process.argv[destFlag + 1])
  : path.join(os.homedir(), 'Documents', 'PixInsight', 'scripts', 'PixInsightMCP');

// The V8 watcher only. The SpiderMonkey/ES5 watcher for PixInsight 1.8.9-1.9.3
// was removed: it hardcoded macOS-only #include paths for a plate-solving
// library no handler used, so it failed at load on Windows and Linux.
const watchers = [
  'pixinsight-mcp-watcher.js',   // V8 (PixInsight 1.9.4+)
];

fs.mkdirSync(dest, { recursive: true });
for (const f of watchers) {
  const src = path.join(pjsrDir, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(dest, f));
    console.log(`  copied ${f}`);
  }
}

console.log(`\nWatchers installed to:\n  ${dest}\n`);
console.log('One-time registration (required by PixInsight, GUI only):');
console.log('  PixInsight  >  Script  >  Feature Scripts...  >  Add  >  select the folder above  >  Done');
console.log('\nThen each session:  Script menu  >  PixInsight MCP  >  Start Watcher');
console.log('(requires PixInsight 1.9.4+ / V8)\n');
console.log('Future updates: re-run this command — no re-registration needed.');
