#!/usr/bin/env node
// ============================================================================
// Launches a dedicated PixInsight instance running the MCP watcher in the
// background, leaving your normal instance (slot 0) free for manual work.
//
//   npx @pardovot/pixinsight-mcp pixinsight-mcp-watch
//   npm run watch                    (from a clone)
//
// Options:
//   --slot <n>   PixInsight instance slot (default 1; your normal one is 0)
//   --pi <path>  Path to the PixInsight executable (else auto/ENV)
//   --dry-run    Print the command without launching
//
// PixInsight executable can also be set via PIXINSIGHT_EXE.
// ============================================================================
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const dryRun = process.argv.includes('--dry-run');
const slot = arg('--slot') || '1';

function findPixInsight() {
  const explicit = arg('--pi') || process.env.PIXINSIGHT_EXE;
  if (explicit) return explicit;
  if (isWin) return 'C:/Program Files/PixInsight/bin/PixInsight.exe';
  if (process.platform === 'darwin')
    return '/Applications/PixInsight/PixInsight.app/Contents/MacOS/PixInsight';
  return '/opt/PixInsight/bin/PixInsight';
}

const pi = findPixInsight();
const watcher = path.join(__dirname, 'pjsr', 'pixinsight-mcp-watcher.js');

if (!fs.existsSync(watcher)) {
  console.error(`Watcher script not found: ${watcher}`);
  process.exit(1);
}
if (!dryRun && !fs.existsSync(pi)) {
  console.error(`PixInsight executable not found: ${pi}`);
  console.error('Pass --pi <path> or set PIXINSIGHT_EXE.');
  process.exit(1);
}

// -n=<slot> forces a separate instance; -r=<script> runs the watcher at startup.
// PixInsight accepts forward slashes on all platforms; use them to avoid any
// backslash parsing quirk in the -r= argument on Windows.
const piArgs = [`-n=${slot}`, `-r=${watcher.replace(/\\/g, '/')}`];

console.log(`PixInsight : ${pi}`);
console.log(`Watcher    : ${watcher}`);
console.log(`Command    : "${pi}" ${piArgs.join(' ')}`);

if (dryRun) {
  console.log('\n[dry-run] not launched.');
  process.exit(0);
}

const child = spawn(pi, piArgs, { detached: true, stdio: 'ignore' });
child.on('error', (e) => {
  console.error(`Failed to launch PixInsight: ${e.message}`);
  process.exit(1);
});
child.unref();

console.log(`\nLaunched watcher instance (slot ${slot}) in the background.`);
console.log('Your normal PixInsight (slot 0) stays free for manual work.');
console.log('Stop it: node scripts/shutdown-watcher.mjs  — or close that instance.');
