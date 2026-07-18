// ============================================================================
// Cross-platform helpers (macOS / Windows / Linux)
// Isolates OS-specific process, memory, disk, and temp-path handling so the
// rest of the pipeline stays platform-agnostic.
// ============================================================================
import os from 'os';
import path from 'path';

const isWin = process.platform === 'win32';

// PixInsight process image name per platform.
const PI_PROC = isWin ? 'PixInsight.exe' : 'PixInsight.app';

let _execSync = null;
async function execSync(cmd, opts) {
  if (!_execSync) _execSync = (await import('child_process')).execSync;
  return _execSync(cmd, opts);
}

/**
 * True if a PixInsight process is currently running.
 */
export async function isPixInsightAlive() {
  try {
    if (isWin) {
      const out = (await execSync(
        `tasklist /FI "IMAGENAME eq ${PI_PROC}" /NH`,
        { timeout: 5000 }
      )).toString();
      return out.includes(PI_PROC);
    }
    const out = (await execSync(
      "ps aux | grep '[P]ixInsight.app' | wc -l",
      { timeout: 5000 }
    )).toString().trim();
    return parseInt(out, 10) > 0;
  } catch {
    return false;
  }
}

/**
 * Total resident memory (MB) used by PixInsight process(es), or 0 if unknown.
 */
export async function pixInsightMemMB() {
  try {
    if (isWin) {
      // CSV: "Image","PID","Session","Session#","Mem Usage"  e.g. "1,234 K"
      const out = (await execSync(
        `tasklist /FI "IMAGENAME eq ${PI_PROC}" /FO CSV /NH`
      )).toString().trim();
      if (!out) return 0;
      let kb = 0;
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/"([\d.,]+)\s*K"\s*$/);
        if (m) kb += parseInt(m[1].replace(/[.,]/g, ''), 10);
      }
      return Math.round(kb / 1024);
    }
    const out = (await execSync(
      "ps aux | grep '[P]ixInsight.app' | awk '{s+=$6} END{print s}'"
    )).toString().trim();
    const kb = parseInt(out, 10);
    return kb ? Math.round(kb / 1024) : 0;
  } catch {
    return 0;
  }
}

/**
 * Free space (GB) on the volume containing `p`, or null if unknown.
 */
export async function freeGB(p) {
  try {
    if (isWin) {
      const drive = path.parse(path.resolve(p)).root.replace(/\\$/, ''); // e.g. "C:"
      const out = (await execSync(
        `wmic logicaldisk where "DeviceID='${drive}'" get FreeSpace /value`
      )).toString();
      const m = out.match(/FreeSpace=(\d+)/);
      if (!m) return null;
      return Math.round(parseInt(m[1], 10) / 1e9);
    }
    const out = (await execSync(`df -g '${p}' 2>/dev/null`, { encoding: 'utf-8' }));
    const lines = out.trim().split('\n');
    if (lines.length < 2) return null;
    return parseInt(lines[1].split(/\s+/)[3], 10);
  } catch {
    return null;
  }
}

/**
 * Absolute path inside the OS temp dir.
 */
export function tmpPath(...segments) {
  return path.join(os.tmpdir(), ...segments);
}

/**
 * A path safe to interpolate into PJSR code. PixInsight's File API accepts
 * forward slashes on all platforms; backslashes would be treated as escapes
 * inside the JS string sent to the engine.
 */
export function pjsrPath(p) {
  return p.replace(/\\/g, '/');
}

export { isWin };
