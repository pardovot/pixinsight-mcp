// Shared configuration for the module build/sign/install scripts.
//
// Cross-platform by design: every path is DERIVED (env var, home dir, platform
// convention) rather than hardcoded, and every value can be overridden with an
// environment variable. A stock install needs no configuration.
//
// Verified on: Windows, Linux, and macOS (Apple Silicon, PixInsight 1.9.4 in
// /Applications/PixInsight) - path derivation through build, sign and install.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

// The application bundle holds ONLY the core executables (PixInsight,
// PixInsightUpdater, updater2, updater3). Everything else - include/, src/,
// lib/, library/, bin/ and the module directory - sits beside it under PI_ROOT,
// so the bundle is used to locate the executable and nothing else. A bare PCL
// source checkout, which is what CI points PI_ROOT at, has no bundle at all.
const macBundleTree = isMac ? path.join(piRoot, "PixInsight.app", "Contents") : null;

// Where a third-party module is installed. On macOS that is <PI_ROOT>/MacOS,
// NOT the bundle's Contents/MacOS: PixInsight's own updater installs there
// (etc/update/installed.xri records StarNet2 and this module landing in
// MacOS/), and scripts/build-pi-repo.mjs already publishes the macOS package
// with that same internal directory. Writing into Contents/MacOS would both
// miss the directory PixInsight scans and break the bundle's code signature.
// <PI_ROOT>/bin exists on macOS too, but it holds the stock modules that ship
// with PixInsight, so it is only a fallback.
export const piBin = env(
  "PI_BIN",
  isMac ? probe([path.join(piRoot, "MacOS"), path.join(piRoot, "bin")]) : path.join(piRoot, "bin"),
);
// Linux ships the real binary next to a launcher script that sets
// LD_LIBRARY_PATH and the Qt plugin paths; the binary alone dies with
// "libssh2.so.1: cannot open shared object file". Prefer the launcher, which is
// also what the installer symlinks onto PATH as /usr/bin/PixInsight.
export const piExe = env(
  "PIXINSIGHT_EXE",
  env(
    "PI_EXE",
    isMac
      ? path.join(macBundleTree, "MacOS", "PixInsight")
      : isWindows
        ? path.join(piBin, "PixInsight.exe")
        : probe([path.join(piBin, "PixInsight.sh"), path.join(piBin, "PixInsight")]),
  ),
);

// --- The module we build ----------------------------------------------------

/** PixInsight modules are "<Id>-pxm.<ext>" with no lib prefix. */
export const moduleExt = isWindows ? ".dll" : isMac ? ".dylib" : ".so";
export const moduleName = `MCPWatcher-pxm${moduleExt}`;

/**
 * macOS ships ONE universal module holding both slices. PixInsight's XRI format
 * has no arm64 architecture token (see scripts/build-pi-repo.mjs), so a fat
 * binary declared arch="all" is the only way to serve Apple Silicon and Intel;
 * it is also what other module vendors ship. PCL builds each slice separately,
 * from the per-arch makefiles PixInsight generates, and build.mjs joins the two
 * module slices with lipo.
 */
export const macTargets = [
  { arch: "x64", appleArch: "x86_64", makefile: "makefile-x64" },
  { arch: "arm64", appleArch: "arm64", makefile: "makefile-arm64" },
];

/** Matches PCL's own -mmacosx-version-min in src/pcl/macosx/g++/makefile-*. */
export const macDeploymentTarget = env("MACOSX_DEPLOYMENT_TARGET", "14");

export const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(moduleDir, "..");
export const buildDir = env("MCP_BUILD_DIR", path.join(moduleDir, "build"));
export const modulePath = path.join(buildDir, moduleName);
export const signaturePath = path.join(buildDir, "MCPWatcher-pxm.xsgn");

// --- PCL SDK ----------------------------------------------------------------

// Headers ship inside PixInsight. The static library is built by build-pcl into
// a writable location, because the PixInsight install dir is read-only.
// piRoot first: that is the layout of a Windows, Linux or macOS install alike,
// and of a plain PCL checkout. The bundle fallback covers a layout that keeps
// these inside Contents/; a stock macOS install does not (verified 1.9.4).
export const pclIncDir = env(
  "PCLINCDIR",
  probe([path.join(piRoot, "include"), macBundleTree && path.join(macBundleTree, "include")]),
);
export const pclSrcDir = env(
  "PCLSRCDIR",
  probe([path.join(piRoot, "src"), macBundleTree && path.join(macBundleTree, "src")]),
);
export const pclBuildOut = env("PCL_BUILD_OUT", path.join(os.homedir(), "pcl-build"));
export const pclLibDir = env("PCLLIBDIR", path.join(pclBuildOut, "lib"));
export const pclLibName = isWindows ? "PCL-pxi.lib" : "libPCL-pxi.a";
export const pclLibPath = path.join(pclLibDir, pclLibName);

/**
 * Where each macOS slice's PCL library goes. Both per-arch makefiles end with
 * `cp libPCL-pxi.a $PCLLIBDIR64` under the SAME file name, so a shared output
 * directory silently keeps only whichever ran last - the bug that made every
 * macOS build link against arm64 PCL. One directory per slice avoids it.
 * Windows/Linux build a single architecture and keep the flat directory.
 */
export const pclLibDirFor = (arch) => (isMac ? path.join(pclLibDir, arch) : pclLibDir);
export const pclLibPathFor = (arch) => path.join(pclLibDirFor(arch), pclLibName);

/** Every PCL library this platform needs before the module can link. */
export const pclLibPaths = isMac
  ? macTargets.map((target) => pclLibPathFor(target.arch))
  : [pclLibPath];

/** Architecture subdirectory used by PixInsight's own makefiles. */
export const pclArch = process.arch === "arm64" ? "arm64" : "x64";

/** Directory holding the platform's PCL makefile / vcxproj, under a source root. */
export const pclProjectDirIn = (srcDir) =>
  isWindows
    ? path.join(srcDir, "pcl", "windows", "vc17")
    : path.join(srcDir, "pcl", isMac ? "macosx" : "linux", "g++");

export const pclProjectDir = pclProjectDirIn(pclSrcDir);

export const pclVcxproj = path.join(pclProjectDir, "PCL.vcxproj");

/**
 * Writable copy of the PCL source tree. PixInsight's generated makefiles compile
 * in-tree, so a read-only install (root-owned /opt/PixInsight, a system-owned
 * app bundle) cannot be built in place; build-pcl mirrors the tree here instead.
 */
export const pclSrcMirror = env("PCL_SRC_MIRROR", path.join(pclBuildOut, "src"));

// --- Code signing -----------------------------------------------------------

export const signKeys = env("PI_SIGN_KEYS", path.join(os.homedir(), "key.xssk"));
/** PixInsight instance slot for the short-lived signing process, [1,256]. */
export const signSlot = env("PI_SIGN_SLOT", "7");

// --- Toolchain (Windows) ----------------------------------------------------

/**
 * Locate Visual Studio with vswhere, which ships with every VS 2017+ install.
 * Works for Community, Professional, Enterprise and BuildTools, any version -
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
    // The install destination, and the value most likely to be wrong on a
    // non-standard layout, so it belongs in the summary.
    ["PI_BIN", piBin],
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
