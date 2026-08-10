# Code signing

Modules are signed **in this repo's own tooling**, with no PixInsight involved.
`npm run module:sign` computes the signature directly, which is why CI can cut a
fully signed release on a runner that has no PixInsight installed.

PixInsight is needed exactly once, to export the signing key.

## The construction, code files

Modules, scripts and any other signed code file:

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

### How this was established

Empirically, in 2026-08. A PJSR probe generated signatures over controlled
inputs (same content under different names, empty file, one entitlement, two
entitlements, the same file twice, `.so`/`.dylib`), then a search over
candidate constructions was verified against them with the public key.

The result is not inferred, it is **reproduced**: signing those ten probe files
in Node yields byte-identical output to PixInsight. For a deterministic
signature scheme that is proof rather than resemblance.

One thing a probe cannot settle: **entitlement ordering.** The two probe names
were already alphabetical, so "given order" and "sorted" are indistinguishable.
Irrelevant while we ship no entitlements; add a probe with reversed names before
relying on it.

## The construction, XML files

A repository index is signed *in place*: PixInsight appends a
`<Signature developerId= timestamp= encoding="Base64">` element after the root
element and rewrites the file. Unlike a code file, what gets signed is **not the
file bytes**, it is a canonical rendering of the root element alone:

```
canonical = Trim( Serialize( Parse( Serialize( rootElement ) ) ) )
message   = canonical || "\n" || developerId || "\n" || timestamp
preimage  = SHA-512( message )
signature = Ed25519( preimage )
```

Note the newline separators, which the code-file layout does not have. All text
UTF-8. `timestamp` is again the exact string written into the `timestamp`
attribute.

`Serialize` is `XMLElement::Serialize` with **`autoFormat = false`**, so the
canonical form is compact: no indentation and no line breaks introduced,
whitespace-only text nodes dropped, single-quoted attributes normalised to
double, `<x></x>` collapsed to `<x/>`, attribute order preserved. The
`<Signature>` element is not part of it, and neither is the XML declaration,
so **the formatting of the file on disk is irrelevant to the signature.**

**Escaping is not passthrough** [verified]. Entity references are decoded when
the document is parsed and re-escaped when it is serialised, so the canonical
bytes are not the source bytes: a literal `>` in the input comes back as
`&gt;`. The rules are `pcl::XML::EncodedText` (`src/pcl/XML.cpp:290`), which
always replaces `&`, `"`, `<`, `>`, and additionally `'` when its `apos` flag
is set. Text nodes pass the default `apos = true` (`XML.h:2062`), attribute
values pass `false` (`XML.h:799`):

| | `&` `"` `<` `>` | `'` |
|---|---|---|
| text content | escaped | escaped as `&apos;` |
| attribute values | escaped | left as-is |

The apostrophe rule is the one a reasonable implementation gets wrong, XML does
not require escaping `'` in text. Our own `updates.xri` contains one
("PixInsight's event loop"), and getting it wrong produced a signature
PixInsight reported as `valid: false`.

The serialize/parse/serialize round trip is not redundant. The intermediate
`Parse` runs with parser options `0xf` rather than the defaults used to read the
file, and those options are what actually canonicalise the content:

- **comments are dropped**;
- **text nodes are space-normalised**, runs of white space collapsed to a single
  space and the result trimmed.

Both were confirmed behaviourally against the probes, not read off an enum.

### How this was established

By disassembling the core binary, after five search passes from outside had
failed. The route, for anyone repeating it: the PJSR binding table maps
`generateXMLSignature` to its native implementation, which parses the file and
delegates to the signing routine proper (`FUN_142100f10` in PixInsight 1.9.4
x64, image base `0x140000000`). That routine reads directly as the recipe above.

The result is **reproduced, not inferred**: it verifies against all six probe
signatures (flat, indented, the same document twice, one-line, oddly formatted
with comments and single quotes, whitespace-heavy text). The two probes that a
naive reading also satisfies are the two with no comments and no padded text
nodes, so the normalisation rules are genuinely exercised.

For the record, what had been **ruled out** from outside, and why it could not
have worked: every layout over the *written document* or the *input bytes*
(~1400 renderings), and 8200 field layouts over the declaration-stripped
serialisation. All of them missed because they lacked the newline separators and
the second-parse normalisation, neither of which is observable in the output.

The public specification was right but not sufficient: per [The PixInsight Script
Code Signing System](https://pixinsight.com/doc/docs/ScriptCodeSigning/ScriptCodeSigning.html),
§9, the signature is "for the **canonicalized root xri element**". It does not
say what canonicalised means. (pixinsight.com returns 403 to plain fetches; read
it in a browser.)

### Signing an index

```bash
npm run repo:sign      # node module/sign-xri.mjs pi-repo/updates.xri
npm run repo:verify
```

`scripts/build-pi-repo.mjs` does not sign, the same split as
`module:build` / `module:sign`; the release workflow runs `repo:sign` after
assembling. The implementation is `module/xml-canonical.mjs`, and
`module/xml-canonical.test.mjs` holds it to fixtures captured from PixInsight
(`module/test-fixtures/xri/`, public signatures only, no key material):

- **layer 1**, our compact serialisation is byte-identical to PixInsight's own
  for ten documents, including the real `updates.xri`;
- **both layers**, the recovered preimage verifies against PixInsight's real
  signature for each of the nine signed probes.

End to end: a signature produced by Node for the real `updates.xri` was
confirmed by PixInsight's own validator, `Security.getXMLSignature()` reporting
`valid: true`. That, not our own verifier agreeing with itself, is the proof.

**Untested**, and refused loudly rather than guessed at: CDATA sections,
numeric character references (`&#62;`), named entities beyond the five XML
built-ins, and namespaced element or attribute names.

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
