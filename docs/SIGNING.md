# Code signing

Modules are signed **in this repo's own tooling**, with no PixInsight involved.
`npm run module:sign` computes the signature directly, which is why CI can cut a
fully signed release on a runner that has no PixInsight installed.

PixInsight is needed exactly once, to export the signing key.

## The construction

```
preimage  = SHA-512( fileBytes || developerId || timestamp || entitlements.join("\n") )
signature = Ed25519( preimage )
```

All text UTF-8, no separators between fields, and `timestamp` is the exact
string written into the `.xsgn` `<Timestamp>` element (ISO 8601, milliseconds,
`Z`). Details that are easy to get wrong:

- the **raw file bytes** go into the preimage, not a digest of them;
- the **timestamp is signed**, so signing the same file twice gives different
  signatures even though Ed25519 is deterministic;
- **entitlements come last**, newline-joined, and an empty list contributes the
  empty string (our module ships none);
- the core **never parses the module**, it signs bytes. A Linux `.so` and a
  macOS `.dylib` can therefore be signed on Windows [verified], which is what
  makes a single-machine or single-runner multi-platform release possible.

The private key in a `.xssk` is stored **expanded** (clamped scalar ‖ nonce
prefix), not as a seed. `node:crypto` can only sign from a seed, so
`module/ed25519.mjs` evaluates the Ed25519 equations directly. It self-checks
against `node:crypto` on the seed path in the test suite.

## How this was established

Empirically, in 2026-08. A PJSR probe generated signatures over controlled
inputs (same content under different names, empty file, one entitlement, two
entitlements, the same file twice, `.so`/`.dylib`), then a search over
candidate constructions was verified against them with the public key.

The result is not inferred, it is **reproduced**: signing those ten probe files
in Node yields byte-identical output to PixInsight. For a deterministic
signature scheme that is proof rather than resemblance.

Two things a probe cannot settle:

- **Entitlement ordering.** The two probe names were already alphabetical, so
  "given order" and "sorted" are indistinguishable. Irrelevant while we ship no
  entitlements; add a probe with reversed names before relying on it.
- **The `.xri` signature.** A repository file is signed *in place*: PixInsight
  re-serialises the document (it rewrote `<xri version="1.0">\n</xri>` as
  `<xri version="1.0"/>`) and appends a `<Signature developerId= timestamp=
  encoding="Base64">` element after the root. The same field layout verifies for
  a trivial single-line document but not for a realistic multi-line one, and
  line-ending normalisation is not the difference. So the signed bytes are a
  canonical serialisation that still has to be recovered. To pick this up: probe
  with deliberately odd input (single-quoted attributes, ragged indentation,
  comments, empty elements) and diff what comes back.

`updates.xri` therefore ships **unsigned**. That is a much smaller problem than
it sounds: an unsigned repository index makes PixInsight show a confirmation
prompt, while an unsigned *module* is refused outright.

## Exporting the key

Run `module/export-signing-key.js` once inside PixInsight (Script Editor, F9).
It decrypts the `.xssk` via `Security.loadSigningKeysFile()`, the only thing
that can (the `.xssk` KDF is unpublished), and writes:

```
~/.pixinsight-mcp/signing-key.json
```

containing `developerId`, the expanded private key, and the public key.

⚠ **That file holds your private key with the password protection removed.**
Anyone who has it can sign as you. The same applies to the CI secret below.

## Signing

```bash
npm run module:sign                    # sign module/build/MCPWatcher-pxm.*
node module/sign.mjs <file> [<file>…]  # sign specific binaries
node module/sign.mjs --verify <file>   # check a file against its .xsgn
```

Signing verifies what it just wrote before reporting success: a signature that
does not check out is worse than none, because PixInsight then rejects the
module with an unhelpful error.

Key resolution: `PI_SIGN_KEY` + `PI_SIGN_DEVELOPER_ID` from the environment
(how CI supplies it), otherwise `~/.pixinsight-mcp/signing-key.json`.

## CI

`.github/workflows/module-release.yml` signs each platform's binary after the
build and before packaging, using the `PI_SIGN_KEY` and `PI_SIGN_DEVELOPER_ID`
repository secrets. Without them the job **fails** rather than publishing
unsigned modules that no one could install.

Binaries are staged one directory per platform (`module/build/<os>/`) because a
signature file name is derived from its binary, so three platforms in one
directory would collide on a single `MCPWatcher-pxm.xsgn`.

## What changed, and why the old notes are wrong

Until 2026-08 this project believed signing required PixInsight, on two grounds
recorded in `module/README.md`: the private key was "encrypted under an
undocumented KDF", and the module preimage was undocumented (943 brute-forced
constructions had found no match).

The first is bypassed rather than broken, `Security.loadSigningKeysFile()`
hands the decrypted key straight to PJSR. The second simply fell to a larger,
better-targeted search once arbitrary probe signatures could be generated on
demand. The KDF itself remains unbroken and unexamined; nothing here depends on
it.

The previous flow (`PixInsight.exe --sign-module-file`, ~5 s per run, password
on the command line) is preserved in git history. It also required the app to
start, which on the development machine began failing with a fatal V8
`ProcessContainer` error during `-r=` startup.
