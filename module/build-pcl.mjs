// One-time build of the PCL static library from the PCL source bundled with
// PixInsight. Output goes to a writable directory, because the PixInsight
// install directory is read-only.
//
//   node module/build-pcl.mjs [--force]
//
// Verified on: Windows (MSBuild + PCL.vcxproj).
// macOS/Linux use PixInsight's own bundled makefiles — written from those
// makefiles, not yet verified.

import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import * as cfg from "./config.mjs";

const force = process.argv.includes("--force");

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}`);
}

function main() {
  const outDir = cfg.pclLibDir;
  const intDir = `${cfg.pclBuildOut}/obj`;

  if (fs.existsSync(cfg.pclLibPath) && !force) {
    console.log(`[OK] ${cfg.pclLibName} already built: ${cfg.pclLibPath}`);
    console.log("     Pass --force to rebuild (needed if PCL source or flags changed).");
    return;
  }

  if (!fs.existsSync(cfg.pclProjectDir)) {
    throw new Error(
      `PCL project directory not found: ${cfg.pclProjectDir}\n` +
        `Is PI_ROOT correct? Currently: ${cfg.piRoot}`,
    );
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(intDir, { recursive: true });

  console.log(`Building ${cfg.pclLibName} ...`);
  console.log(`  project : ${cfg.pclProjectDir}`);
  console.log(`  output  : ${cfg.pclLibPath}\n`);

  // PCL's build references these env vars for its include paths; without them
  // the compiler cannot find pcl/*.h.
  const buildEnv = {
    ...process.env,
    PCLDIR: cfg.piRoot,
    PCLINCDIR: cfg.pclIncDir,
    PCLSRCDIR: cfg.pclSrcDir,
    PCLLIBDIR: outDir,
    PCLLIBDIR64: outDir,
    PCLBINDIR: cfg.piBin,
    PCLBINDIR64: cfg.piBin,
  };

  if (cfg.isWindows) {
    if (!fs.existsSync(cfg.msbuild)) {
      throw new Error(`MSBuild not found: ${cfg.msbuild}\nSet MSBUILD or VS to override.`);
    }
    if (!fs.existsSync(cfg.pclVcxproj)) {
      throw new Error(`PCL.vcxproj not found: ${cfg.pclVcxproj}`);
    }
    // Trailing separator is doubled so MSBuild does not read \" as an escaped
    // quote and merge the OutDir/IntDir arguments.
    run(
      cfg.msbuild,
      [
        cfg.pclVcxproj,
        "/p:Configuration=Release",
        "/p:Platform=x64",
        `/p:OutDir=${outDir}\\\\`,
        `/p:IntDir=${intDir}\\\\`,
        "/m",
        "/verbosity:minimal",
      ],
      { env: buildEnv },
    );
  } else {
    // PixInsight ships per-arch makefiles (makefile-x64, makefile-arm64) with a
    // top-level Makefile that delegates to the right one.
    run(cfg.make, ["-C", cfg.pclProjectDir, "-j", String(os.cpus().length)], { env: buildEnv });
  }

  if (!fs.existsSync(cfg.pclLibPath)) {
    console.warn(`\n[WARN] Build reported success but ${cfg.pclLibName} is not in ${outDir}.`);
    console.warn("       Check the build output above for the actual library location.");
    return;
  }
  console.log(`\n[OK] ${cfg.pclLibName} -> ${cfg.pclLibPath}`);
}

try {
  main();
} catch (err) {
  console.error(`\n[ERROR] ${err.message}`);
  process.exit(1);
}
