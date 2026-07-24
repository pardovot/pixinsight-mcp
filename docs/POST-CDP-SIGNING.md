# Re-enabling signed distribution (after CDP registration)

**Status:** distribution signing is **temporarily disabled** (as of 2026-07-24). The
public update repo (`pi-repo/`) ships an **unsigned** `updates.xri` and an **unsigned**
module (binary-only zip, no `.xsgn`).

## Why it's disabled

Our only signing identity is **local** — `key.xssk` has
`developerId="0104952866723499"`, which `Security.getModuleSignature()` reports as
*"Unknown code signing identity"*. A local identity is trusted **only on machines where
this PixInsight license is activated**. On anyone else's machine:

- a **local-signed** repo/module → **untrusted → rejected outright** (can't install);
- an **unsigned** repo → PixInsight shows a **confirmation prompt**, then installs.

So until we have a real Certified PixInsight Developer (CPD) identity, unsigned is the
*only* form that installs for other users. (Local install via `npm run module:install` is
unaffected — it uses the signed module and works on our own licensed machine.)

## What "getting CDP" changes

You register with Pleiades Astrophoto as a Certified PixInsight Developer and receive a
signing identity whose `developerId` resolves **by name** on every PixInsight install
(like the built-in `PTeam`), instead of "Unknown code signing identity". In practice you
get an updated/new `.xssk` keys file tied to that CPD identity.

## Re-enable checklist

1. **Install the CPD keys.** Put the CPD-registered `.xssk` where the tooling looks for it
   (`~/key.xssk`, or set `PI_SIGN_KEYS`). Confirm the identity resolves — sign a throwaway
   module and check `Security.getModuleSignature()` no longer says "Unknown".

2. **Restore `.xsgn` packaging in `scripts/build-pi-repo.mjs`** (reverting the 2026-07-24
   unsigned change). In the per-platform loop:
   - re-add the `sgnPath` existence check that **skips** a platform whose module isn't
     signed;
   - add the `.xsgn` entry back to the zip `entries` array
     (`{ name: `${plat.dir}/${MODULE_BASE}.xsgn`, data: fs.readFileSync(sgnPath) }`).
   - restore the header/summary/reminder text to describe signed distribution.

   (Git history for `scripts/build-pi-repo.mjs` has the exact prior code.)

3. **Run the full signed pipeline:**
   ```
   npm run module:build                       # build the module (.dll/.so/.dylib)
   npm run module:sign                         # sign it -> module/build/MCPWatcher-pxm.xsgn
   npm run repo:build                          # package module + .xsgn, write updates.xri
   node module/sign.mjs pi-repo/updates.xri    # sign the repo file IN PLACE (adds <Signature>)
   ```

4. **Verify the artifacts:**
   - `pi-repo/updates.xri` ends with a `<Signature developerId="...">` block whose
     `developerId` is the **CPD** identity (not `0104952866723499`);
   - `pi-repo/mcpwatcher-module-windows.zip` contains **both** `bin/MCPWatcher-pxm.dll`
     **and** `bin/MCPWatcher-pxm.xsgn`;
   - on a **second** machine (not license-activated for our local id), adding the repo URL
     installs **without** a "unsigned / untrusted" warning.

5. **Publish** `pi-repo/` to the repository URL.

## Cross-platform reminder

`repo:build` only packages platforms whose binary is present in `module/build/`. To ship a
signed repo for all three OSes, build **and sign** the module on each platform (or collect
each platform's signed `.dll`/`.so`/`.dylib` + `.xsgn` into `module/build/`) before running
`repo:build`.

## Not affected by this toggle

- `module/sign.mjs` and `npm run module:sign` — kept intact, still sign the local module.
- `module/install.mjs` — local install, still copies the signed `.dll` + `.xsgn` to `bin/`.
- The `module:build` step — unchanged.
