# Vendored PCL Windows build project (vc17)

`PCL.vcxproj` (+ `.filters`) for building the **PCL static library on Windows**
(MSBuild, toolset v143 / VS 2022).

## Why this is here

The official open-source PCL repository (`gitlab.com/pixinsight/PCL`) ships the
Linux and macOS build projects (`src/pcl/{linux,macosx}/g++`) but **not** the
Windows vc17 project — `src/pcl/windows/vc17/PCL.vcxproj` is absent there. CI
runners have no PixInsight install to source it from, so these files are vendored
here and overlaid into the cloned PCL tree by `.github/workflows/module-build.yml`
before the Windows PCL build.

Locally, nothing uses these files — `module/build-pcl.mjs` reads the vc17 project
straight from your PixInsight install (`<PI_ROOT>/src/pcl/windows/vc17/`).

## Provenance & license

Copied verbatim from a stock PixInsight 1.9.4 install
(`<PI_ROOT>/src/pcl/windows/vc17/`). Part of the PixInsight Class Library, subject
to the **PixInsight Class Library License (PCLL)** — see the PCL repository's
`COPYING.md` / `LICENSE`. Unmodified; the project references sources relatively
(`..\..\*.cpp`) and resolves include/lib paths from the `PCLINCDIR` / `PCLSRCDIR`
/ `PCLLIBDIR64` environment variables that `build-pcl.mjs` sets.

## Updating

If PixInsight's PCL updates the Windows project, refresh these from a current
install's `src/pcl/windows/vc17/`.
