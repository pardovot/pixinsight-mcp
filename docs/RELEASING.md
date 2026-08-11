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

## Channels: test before you ship

Three tiers. Use the lowest one that can catch the bug you are looking for.

| tier | module | MCP server | who sees it |
|---|---|---|---|
| local | `module:build` → `module:sign` → `module:install` | client points at `<repo>/build/index.js` | you, no publishing |
| sandbox | `dist-sandbox` branch, added as a second repository URL in PixInsight | `npm publish --tag next`, install `@pardovot/pixinsight-mcp@next` | you and anyone given the URL |
| production | `dist` | `npm publish` (latest) | everyone |

**Sandbox is NOT part of the routine.** Local install plus CI is the normal path. What a local
install cannot see, the `arch` declaration, the zip layout and the `updates.xri`, is covered by
`test/packaging.test.mjs`, which runs the packager against synthetic binaries on every pull
request. That is where the macOS bug of 2026-08-11 would now be caught, and it is caught before
anyone decides to publish rather than after.

Reach for sandbox only when you change the **packaging format itself**, a new archive layout, a
new platform, a signing change, because the one thing no test can simulate is PixInsight's own
install flow. PixInsight's repository reference recommends the practice under "Testing Updates:
Sandbox Repositories".

To publish one: **Actions → Module Release (publish) → Run workflow**, channel `sandbox`. It
builds, signs and packages identically to a real release and pushes to `dist-sandbox`, creating
the branch on demand. In PixInsight, add the second URL alongside the production one:

```
https://raw.githubusercontent.com/pardovot/pixinsight-mcp/dist-sandbox/
```

Remove the URL when you are done, and delete the branch, so a stale build cannot be served months
later. A tag never publishes there.

**Versioning across channels.** PixInsight delivers by version, so a version installed from
sandbox will NOT be re-delivered from production. Keep it simple: sandbox and production share the
same version, and once a sandbox build is verified you publish that same version to `dist`.
Everyone except the tester receives it fresh, and the tester already has the identical binary.

A tag always publishes to production. A manual run defaults to sandbox, so the easy path is the
safe one.

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
- **Modules are signed by CI** - see `docs/SIGNING.md`. Signing runs in Node with no PixInsight
  on the runner, using the `PI_SIGN_KEY` and `PI_SIGN_DEVELOPER_ID` secrets; the release job
  fails if they are missing rather than publishing modules nobody can install. `updates.xri`
  itself is signed too, by the `Sign the repository index` step (`npm run repo:sign`), using the
  same secrets.
- Native modules are **per-OS compiled binaries** (`.dll`/`.so`/`.dylib`). Each OS gets its own
  `<platform>` package in `updates.xri`; the app installs only the one matching the user's
  OS/arch.
- **macOS is a universal binary, declared `arch="all"`.** `module/build.mjs` builds both slices on
  the macOS runner and joins them with `lipo`. `scripts/build-pi-repo.mjs` **refuses to publish** a
  thin arm64 dylib and downgrades a thin x86_64 one to `arch="x64"` with a warning.
  - Why one package and not two: on macOS the update system picks by **which PixInsight build the
    user installed, not by their CPU** (an x64 PixInsight on Apple Silicon takes x64 packages), and
    a fat binary satisfies both builds from one artifact with one signature. It is also what RC
    Astro ships for 1.9.4, and the documented `arch` tokens are
    `noarch`/`any`/`all`/`x86`/`i386`/`i586`/`i686`/`x86_64`/`x64`, with no `arm64`.
  - Per-arch macOS packages are nevertheless possible: StarNet ships separate macOS x64 and ARM64
    lanes from one repository, because those two builds differ beyond the instruction set (ONNX/ORT
    vs CoreML). Split only if we ever have a difference like that to express.
  - The fat file is **ad-hoc code-signed** (`codesign -s -`) right after `lipo`, because Apple
    Silicon will not load unsigned code. That must happen **before** `module/sign.mjs`, whose
    signature covers the file bytes.
- **PCL is cached as a release asset, not with `actions/cache`.** The static library depends only
  on the PCL commit, never on our branch, but Actions caches are readable only by the ref that
  wrote them, their children, and the default branch, and that cannot be turned off (cache entries
  are attacker-writable, so the partitioning is a security boundary). Release runs are
  tag-triggered, so every cache a release wrote was scoped to `refs/tags/module-v*` and never read
  again: `module-v1.3.2` and `v1.3.3` both rebuilt PCL from scratch on all three OSes (~9-13 min
  each), and their cache entries show `last_accessed_at == created_at`.
  - `module-build.yml` instead keeps `pcl-<OS>-<pcl-sha12>.tar.gz` on the **`pcl-sdk`** prerelease.
    Release assets are repo-scoped: one upload per PCL commit serves every branch, tag, PR and
    release, with no eviction and no dependency on which branch is the default. A job that finds
    its asset skips the PCL build entirely. A job that does not, builds it and uploads it, then
    deletes assets for superseded PCL commits.
  - `pcl-sdk` is **not a product release**. Don't delete it, and don't confuse it with
    `module-v*` tags. Deleting it just costs one rebuild per OS.
  - Fork PRs get a read-only token, so they restore but never publish. That is fine, they simply
    build PCL themselves.
  - If a run still shows a long "Build PCL static library" step, check whether PixInsight
    published a new PCL commit: a changed SHA is a new asset name, and the first run after that
    legitimately rebuilds.
