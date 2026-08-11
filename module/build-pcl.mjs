// One-time build of the PCL static library from the PCL source bundled with
// PixInsight. Output goes to a writable directory, because the PixInsight
// install directory is read-only.
//
//   node module/build-pcl.mjs [--force]
//
// Verified on: Windows (MSBuild + PCL.vcxproj) and Linux (PixInsight's bundled
// makefiles, mirrored out of the read-only install first - see
// resolveSourceRoot). macOS uses the same makefile path as Linux, one build per
// architecture slice, and is not yet verified.

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

/** Can we create files in this directory? */
function isWritable(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Source root to build from, mirroring the tree first when the install is
 * read-only.
 *
 * PixInsight's generated makefiles compile IN-TREE: the object rule is
 * `./x64/Release/%.o: ../../%.cpp`, resolved against the makefile's own
 * directory, and there is no variable to redirect it (unlike the Windows
 * vcxproj, which takes OutDir/IntDir). A stock install is not user-writable -
 * /opt/PixInsight is root-owned - so `make` there fails on every object file
 * with "Permission denied". CI does not see this because it points PI_ROOT at a
 * freshly cloned, writable PCL checkout.
 *
 * The tree is ~20 MB, so copying it is cheaper than requiring sudo for a build,
 * and it leaves the PixInsight install untouched.
 */
function resolveSourceRoot() {
  const projectDir = cfg.pclProjectDir;
  if (cfg.isWindows || isWritable(projectDir)) return { srcDir: cfg.pclSrcDir, projectDir };

  const mirror = cfg.pclSrcMirror;
  const mirrorProject = cfg.pclProjectDirIn(mirror);
  if (force) fs.rmSync(mirror, { recursive: true, force: true });
  if (!fs.existsSync(mirrorProject)) {
    console.log(`PCL source is read-only (${projectDir}),`);
    console.log(`mirroring it to ${mirror} ...`);
    fs.cpSync(cfg.pclSrcDir, mirror, { recursive: true });
  } else {
    console.log(`Using the writable PCL source mirror at ${mirror}.`);
  }
  return { srcDir: mirror, projectDir: mirrorProject };
}

function main() {
  const outDir = cfg.pclLibDir;
  const intDir = `${cfg.pclBuildOut}/obj`;

  if (cfg.pclLibPaths.every((libPath) => fs.existsSync(libPath)) && !force) {
    for (const libPath of cfg.pclLibPaths) console.log(`[OK] ${cfg.pclLibName} already built: ${libPath}`);
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

  const { srcDir, projectDir } = resolveSourceRoot();

  console.log(`Building ${cfg.pclLibName} ...`);
  console.log(`  project : ${projectDir}`);
  console.log(`  output  : ${cfg.pclLibPath}\n`);

  // PCL's build references these env vars for its include paths; without them
  // the compiler cannot find pcl/*.h.
  const buildEnv = {
    ...process.env,
    PCLDIR: cfg.piRoot,
    PCLINCDIR: cfg.pclIncDir,
    PCLSRCDIR: srcDir,
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
  } else if (cfg.isMac) {
    // macOS needs BOTH slices for the universal module, and the two per-arch
    // makefiles both finish with `cp libPCL-pxi.a $PCLLIBDIR64` under the same
    // name. The bundled top-level Makefile runs them back to back with one
    // output directory, so the second silently overwrites the first. Drive each
    // makefile ourselves with its own PCLLIBDIR64 instead.
    for (const target of cfg.macTargets) {
      const libDir = cfg.pclLibDirFor(target.arch);
      if (fs.existsSync(cfg.pclLibPathFor(target.arch)) && !force) {
        console.log(`[OK] ${target.arch}: already built, skipping.`);
        continue;
      }
      console.log(`\n--- ${target.arch} (${target.appleArch}) ---`);
      fs.mkdirSync(libDir, { recursive: true }); // the makefile's cp needs it to exist
      run(cfg.make, ["-C", projectDir, "-f", target.makefile, "-j", String(os.cpus().length)], {
        env: { ...buildEnv, PCLLIBDIR: libDir, PCLLIBDIR64: libDir },
      });
    }
  } else {
    run(cfg.make, ["-C", projectDir, "-j", String(os.cpus().length)], { env: buildEnv });
  }

  const missing = cfg.pclLibPaths.filter((libPath) => !fs.existsSync(libPath));
  if (missing.length > 0) {
    console.warn(`\n[WARN] Build reported success but ${cfg.pclLibName} is not in ${outDir}.`);
    console.warn("       Check the build output above for the actual library location.");
    console.warn(`       Missing: ${missing.join(", ")}`);
    return;
  }
  for (const libPath of cfg.pclLibPaths) console.log(`\n[OK] ${cfg.pclLibName} -> ${libPath}`);
}

try {
  main();
} catch (err) {
  console.error(`\n[ERROR] ${err.message}`);
  process.exit(1);
}
