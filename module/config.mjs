// Shared configuration for the module build/sign/install scripts.
//
// Cross-platform by design: every path is DERIVED (env var, home dir, platform
// convention) rather than hardcoded, and every value can be overridden with an
// environment variable. A stock install needs no configuration.
//
// Verified on: Windows. The macOS/Linux branches are written from PixInsight's
// bundled PCL makefiles but are not yet verified on those platforms.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const platform = process.platform; // 'win32' | 'darwin' | 'linux'
export const isWindows = platform === "win32";
export const isMac = platform === "darwin";

const env = (name, fallback) => process.env[name] || fallback;

/** First existing path from the candidates, else the first candidate. */
const probe = (candidates) => {
  const list = candidates.filter(Boolean);
  return list.find((p) => fs.existsSync(p)) ?? list[0];
};

// --- PixInsight -------------------------------------------------------------

function defaultPiRoot() {
  if (isWindows) {
    return probe(
      [
        process.env.ProgramFiles,
        process.env.ProgramW6432,
        process.env["ProgramFiles(x86)"],
        "C:\\Program Files",
        "D:\\Program Files",
      ].map((base) => path.join(base, "PixInsight")),
    );
  }
  if (isMac) return probe(["/Applications/PixInsight"]);
  return probe(["/opt/PixInsight", "/usr/local/PixInsight"]);
}

export const piRoot = env("PI_ROOT", defaultPiRoot());
export const piBin = env("PI_BIN", path.join(piRoot, "bin"));
export const piExe = env(
  "PIXINSIGHT_EXE",
  env(
    "PI_EXE",
    isMac
      ? path.join(piRoot, "PixInsight.app", "Contents", "MacOS", "PixInsight")
      : path.join(piBin, isWindows ? "PixInsight.exe" : "PixInsight"),
  ),
);

// --- The module we build ----------------------------------------------------

/** PixInsight modules are "<Id>-pxm.<ext>" with no lib prefix. */
export const moduleExt = isWindows ? ".dll" : isMac ? ".dylib" : ".so";
export const moduleName = `MCPWatcher-pxm${moduleExt}`;

export const moduleDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
export const repoRoot = path.resolve(moduleDir, "..");
export const buildDir = env("MCP_BUILD_DIR", path.join(moduleDir, "build"));
export const modulePath = path.join(buildDir, moduleName);
export const signaturePath = path.join(buildDir, "MCPWatcher-pxm.xsgn");

// --- PCL SDK ----------------------------------------------------------------

// Headers ship inside PixInsight. The static library is built by build-pcl into
// a writable location, because the PixInsight install dir is read-only.
export const pclIncDir = env("PCLINCDIR", path.join(piRoot, "include"));
export const pclSrcDir = env("PCLSRCDIR", path.join(piRoot, "src"));
export const pclBuildOut = env("PCL_BUILD_OUT", path.join(os.homedir(), "pcl-build"));
export const pclLibDir = env("PCLLIBDIR", path.join(pclBuildOut, "lib"));
export const pclLibName = isWindows ? "PCL-pxi.lib" : "libPCL-pxi.a";
export const pclLibPath = path.join(pclLibDir, pclLibName);

/** Architecture subdirectory used by PixInsight's own makefiles. */
export const pclArch = process.arch === "arm64" ? "arm64" : "x64";

/** Directory holding the platform's PCL makefile / vcxproj. */
export const pclProjectDir = isWindows
  ? path.join(pclSrcDir, "pcl", "windows", "vc17")
  : path.join(pclSrcDir, "pcl", isMac ? "macosx" : "linux", "g++");

export const pclVcxproj = path.join(pclProjectDir, "PCL.vcxproj");

// --- Code signing -----------------------------------------------------------

export const signKeys = env("PI_SIGN_KEYS", path.join(os.homedir(), "key.xssk"));
/** PixInsight instance slot for the short-lived signing process, [1,256]. */
export const signSlot = env("PI_SIGN_SLOT", "7");

// --- Toolchain (Windows) ----------------------------------------------------

/**
 * Locate Visual Studio with vswhere, which ships with every VS 2017+ install.
 * Works for Community, Professional, Enterprise and BuildTools, any version —
 * a hardcoded path would only work for one of them.
 */
function findVisualStudio() {
  if (process.env.VS) return process.env.VS;
  const programFilesX86 = process.env["ProgramFiles(x86)"] || process.env.ProgramFiles || "C:\\Program Files (x86)";
  const vswhere = path.join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (fs.existsSync(vswhere)) {
    try {
      const found = execFileSync(
        vswhere,
        ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"],
        { encoding: "utf8" },
      ).trim();
      if (found) return found;
    } catch {
      /* fall through to the conventional location */
    }
  }
  return path.join(programFilesX86, "Microsoft Visual Studio", "2022", "BuildTools");
}

export const vs = isWindows ? findVisualStudio() : null;
export const vcvars = isWindows ? env("VCVARS", path.join(vs, "VC", "Auxiliary", "Build", "vcvars64.bat")) : null;
export const msbuild = isWindows ? env("MSBUILD", path.join(vs, "MSBuild", "Current", "Bin", "MSBuild.exe")) : null;
export const cmake = env(
  "CMAKE",
  isWindows
    ? path.join(vs, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "CMake", "bin", "cmake.exe")
    : "cmake",
);
export const ninjaDir = isWindows
  ? env("NINJA_DIR", path.join(vs, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "Ninja"))
  : null;

export const make = env("MAKE", "make");

/** Human-readable summary, for --show and error messages. */
export function describe() {
  const rows = [
    ["platform", `${platform} (${process.arch})`],
    ["PI_ROOT", piRoot],
    ["PI_EXE", piExe],
    ["module", modulePath],
    ["PCLINCDIR", pclIncDir],
    ["PCLLIBDIR", pclLibDir],
    ["PCL project", pclProjectDir],
    ["PI_SIGN_KEYS", signKeys],
  ];
  if (isWindows) rows.push(["VS", vs], ["CMAKE", cmake]);
  else rows.push(["MAKE", make], ["CMAKE", cmake]);
  return rows.map(([k, v]) => `  ${k.padEnd(13)} ${v}`).join("\n");
}

if (process.argv[1] && process.argv[1].endsWith("config.mjs")) {
  console.log("Resolved configuration:\n" + describe());
}
