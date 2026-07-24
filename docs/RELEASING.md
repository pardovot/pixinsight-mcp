# Releasing the MCP Watcher module

## Version is single-sourced

`module/src/Version.h` (`MCPWATCHER_VERSION_STR`) is the **single source of truth** for the
module version. It is read by the module's own dialog **and** by
`scripts/build-pi-repo.mjs` when generating `updates.xri`. Never hardcode the version
anywhere else.

## The rule: every PUBLISH needs a version bump - building does not

PixInsight's update system decides whether to deliver a package **by its version**. If you
publish two different binaries under the same version, users who already installed the first
are **never offered** the second. Therefore:

- **Publishing to users ⇒ bump `MCPWATCHER_VERSION_STR`.** No exceptions.
- **Building does NOT need a bump.** Compile-checks run on every change; they publish
  nothing, so the version is irrelevant. Build as often as you like.

This is the resolution to "we have new builds with no new version": those were *builds*, not
*publishes*. Only a release publishes, and only a release requires the bump.

Bump policy (`MAJOR.MINOR.RELEASE`):

| Part | When |
|---|---|
| RELEASE | bug fixes, small changes, rebuilds |
| MINOR | new tools/features, backward-compatible |
| MAJOR | breaking bridge/protocol changes |

## CI workflows

- **Compile-check** - `.github/workflows/module-build.yml`. Runs on module-source changes
  and on demand (`workflow_dispatch`). Builds the module to prove it **compiles**. Publishes
  nothing; needs no version bump. Runners have no PixInsight, so PCL is cloned from the
  official open-source repo (`gitlab.com/pixinsight/PCL`, branch `master`) and fed to the
  existing build scripts via env vars (no change to `module/config.mjs`).
  - **Linux + macOS**: build from the GitLab source directly - it ships
    `src/pcl/{linux,macosx}/g++` build projects. These are the two platforms never verified,
    so CI's main job is here.
  - **Windows**: the public PCL repo omits the Windows vc17 project
    (`src/pcl/windows/vc17/PCL.vcxproj`), which the Windows PCL build needs. We vendor it in
    `module/vendor/pcl-vc17/` (copied from a stock install, PCLL-licensed) and the workflow
    overlays it into the clone before building. So Windows is a full CI target too.

- **Release/publish** - `.github/workflows/module-release.yml`. Tag-driven. Gates the tag
  against `Version.h`, **reuses** the compile-check to build all three binaries, assembles
  `pi-repo/`, and force-pushes it to the single-commit **`dist`** branch. See the ritual below.

## Release ritual

1. Bump `MCPWATCHER_VERSION_STR` (+ `RELEASE_YEAR/MONTH/DAY`) in `module/src/Version.h`.
2. Commit to `main`, then tag: `git tag module-v<version>` (e.g. `module-v1.3.0`).
3. `git push --tags`.
4. `module-release.yml` runs: **asserts the tag == `Version.h`** (fails on mismatch - the
   guard against forgetting to bump or republishing a version), builds all three OSes,
   assembles `pi-repo/`, and **force-pushes it to the single-commit `dist` branch**.
   - The tag prefix is `module-v` and the rest must equal `Version.h` exactly (`module-v1.3.0`
     ⇒ `1.3.0`). A `workflow_dispatch` run skips the tag check and publishes `Version.h` as-is.
5. Users' PixInsight repo URL:
   `https://raw.githubusercontent.com/pardovot/pixinsight-mcp/dist/`
   (`raw.githubusercontent.com` serves directly with no redirect - verified - which
   PixInsight requires.)

> The `dist` URL is the canonical channel. The stale `pi-repo/` copy still committed on
> `main` is unused once `dist` exists - remove it (and switch any repo you added in
> PixInsight from `main/pi-repo/` to `dist/`) once the first `dist` publish is verified.

## Notes

- Why an orphan `dist` branch (not `main`): the built binaries never accumulate in `main`'s
  history, and CI force-pushes `dist` fresh each release so it stays a single commit. `main`
  never gets force-pushed.
- **Signing stays disabled until CDP** - see `docs/POST-CDP-SIGNING.md`. Both the module and
  `updates.xri` ship unsigned (a local-identity signature is rejected on other machines; an
  unsigned repo only prompts, then installs).
- Native modules are **per-OS compiled binaries** (`.dll`/`.so`/`.dylib`) - there is no
  universal binary. Each OS gets its own `<platform>` package in `updates.xri`; the app
  installs only the one matching the user's OS/arch.
