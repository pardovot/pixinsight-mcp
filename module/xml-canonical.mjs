// PixInsight .xri (repository index) signing, in Node, no PixInsight.
//
// Unlike a code file (see signing.mjs), an .xri is signed over a CANONICAL
// rendering of its root element, not the file bytes:
//
//   compact   = Serialize( root, autoFormat=false )          // this file, layer 1
//   canonical = normalise( compact )                         // this file, layer 2
//   message   = canonical || "\n" || developerId || "\n" || timestamp
//   preimage  = SHA-512( message )
//   signature = Ed25519( preimage )
//
// Recovered from PixInsight.exe 1.9.4 x64 (Security::GenerateXMLSignature,
// FUN_142100f10 at image base 0x140000000) and reproduced byte for byte against
// six probe signatures. See docs/SIGNING.md.
//
// The two layers, and why both are needed:
//   Layer 1, serializeCompact, reproduces PixInsight's XMLElement::Serialize
//   with autoFormat=false: attributes double-quoted and single-spaced, empty
//   elements self-closed, whitespace-only text nodes between elements dropped,
//   content text and comments kept verbatim, attribute order preserved, no
//   indentation. This is what its .canonical output contains.
//   Layer 2, canonicalizeRoot, is the second-parse normalisation the signer
//   applies on top: comments dropped, text nodes whitespace-collapsed and
//   trimmed. It is the reference construction that session recovered.
//
// Entities [verified]: PixInsight decodes references when parsing and
// re-escapes when serialising, so `&gt;` survives as `&gt;` and a LITERAL `>`
// in the source comes back as `&gt;`. The canonical form is therefore not the
// source bytes, and this file reproduces the same round trip.
//
// UNTESTED by the probe set (our updates.xri contains none of these): CDATA
// sections, numeric character references, named entities beyond the five XML
// built-ins, namespaced names, and quotes inside attribute values. The guards
// below reject what would otherwise be silently mis-signed.

import fs from "node:fs";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Parser: a minimal recursive-descent reader for the xri subset.
// ---------------------------------------------------------------------------

const isSpace = (ch) => ch === " " || ch === "\t" || ch === "\n" || ch === "\v" || ch === "\f" || ch === "\r";
const isAllSpace = (text) => {
  for (const ch of text) if (!isSpace(ch)) return false;
  return true;
};

// --- entity handling --------------------------------------------------------
// PixInsight decodes on parse and re-escapes on serialize [verified], so the
// two must be symmetric here or the canonical bytes drift.

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
// An entity reference: &name; or a numeric &#nn; / &#xnn;
const ENTITY = /&(#x?[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g;

function decodeEntities(text) {
  return text.replace(ENTITY, (match, body) => {
    if (body[0] === "#") {
      // Numeric references are untested against PixInsight; refuse rather than
      // guess, since decoding changes the canonical bytes.
      throw new Error(`numeric character reference '${match}' in an xri document; canonicalisation untested`);
    }
    const decoded = NAMED_ENTITIES[body];
    if (decoded === undefined)
      throw new Error(`unknown entity '${match}' in an xri document; canonicalisation untested`);
    return decoded;
  });
}

/*
 * Escaping follows pcl::XML::EncodedText (src/pcl/XML.cpp:290), which always
 * replaces & " < > and additionally ' when its `apos` flag is set. Text nodes
 * pass the default apos=true (XML.h:2062), attribute values pass false
 * (XML.h:799). So a text apostrophe becomes &apos; even though XML does not
 * require it, which is what a naive serialiser gets wrong.
 * The ampersand must be replaced first, or later replacements re-escape it.
 */
const escapeCommon = (text) =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeText = (text) => escapeCommon(text).replace(/'/g, "&apos;");
const escapeAttribute = (value) => escapeCommon(value);

export function parseXml(text) {
  let pos = 0;

  const fail = (message) => {
    throw new Error(`XML parse error at offset ${pos}: ${message}`);
  };
  const skipSpace = () => {
    while (pos < text.length && isSpace(text[pos])) pos++;
  };
  const readName = () => {
    const start = pos;
    while (pos < text.length && !isSpace(text[pos]) && text[pos] !== ">" && text[pos] !== "/" && text[pos] !== "=")
      pos++;
    if (pos === start) fail("expected a name");
    return text.slice(start, pos);
  };

  // Optional BOM and XML declaration.
  if (text.charCodeAt(0) === 0xfeff) pos = 1;
  skipSpace();
  let declaration = null;
  if (text.startsWith("<?xml", pos)) {
    const end = text.indexOf("?>", pos);
    if (end < 0) fail("unterminated XML declaration");
    declaration = text.slice(pos, end + 2);
    pos = end + 2;
  }

  const parseAttributes = () => {
    const attrs = [];
    for (;;) {
      skipSpace();
      const ch = text[pos];
      if (ch === ">" || ch === "/" || ch === undefined) break;
      const name = readName();
      skipSpace();
      if (text[pos] !== "=") fail(`expected '=' after attribute '${name}'`);
      pos++;
      skipSpace();
      const quote = text[pos];
      if (quote !== '"' && quote !== "'") fail("expected a quoted attribute value");
      pos++;
      const end = text.indexOf(quote, pos);
      if (end < 0) fail("unterminated attribute value");
      attrs.push({ name, value: decodeEntities(text.slice(pos, end)) });
      pos = end + 1;
    }
    return attrs;
  };

  const parseNodes = () => {
    const nodes = [];
    while (pos < text.length) {
      if (text.startsWith("</", pos)) break; // closing tag: hand back to caller
      if (text.startsWith("<!--", pos)) {
        const end = text.indexOf("-->", pos + 4);
        if (end < 0) fail("unterminated comment");
        nodes.push({ type: "comment", value: text.slice(pos + 4, end) });
        pos = end + 3;
        continue;
      }
      if (text.startsWith("<![CDATA[", pos) || text.startsWith("<!", pos) || text.startsWith("<?", pos)) {
        // CDATA, DOCTYPE and processing instructions are not part of the xri
        // vocabulary; refuse rather than mis-canonicalise them.
        fail("unsupported markup (CDATA, DOCTYPE or processing instruction) in an xri document");
      }
      if (text[pos] === "<") {
        nodes.push(parseElement());
        continue;
      }
      const next = text.indexOf("<", pos);
      const end = next < 0 ? text.length : next;
      nodes.push({ type: "text", value: decodeEntities(text.slice(pos, end)) });
      pos = end;
    }
    return nodes;
  };

  function parseElement() {
    pos++; // consume '<'
    const name = readName();
    const attrs = parseAttributes();
    skipSpace();
    if (text.startsWith("/>", pos)) {
      pos += 2;
      return { type: "element", name, attrs, children: [] };
    }
    if (text[pos] !== ">") fail(`expected '>' to close start tag <${name}>`);
    pos++;
    const children = parseNodes();
    if (!text.startsWith("</", pos)) fail(`expected closing tag for <${name}>`);
    pos += 2;
    const closeName = readName();
    if (closeName !== name) fail(`mismatched closing tag: <${name}> closed by </${closeName}>`);
    skipSpace();
    if (text[pos] !== ">") fail(`expected '>' in closing tag </${name}>`);
    pos++;
    return { type: "element", name, attrs, children };
  }

  const roots = parseNodes().filter((node) => node.type === "element");
  if (roots.length !== 1) fail(`expected exactly one root element, found ${roots.length}`);
  return { declaration, root: roots[0] };
}

// ---------------------------------------------------------------------------
// Layer 1: compact serialisation (XMLElement::Serialize, autoFormat=false).
// ---------------------------------------------------------------------------

/** Reject content the probe set never exercised, so it fails loud, not silent. */
function assertSignable(node) {
  if (node.type === "text" || node.type === "comment") return;
  for (const attr of node.attrs)
    if (attr.name.includes(":")) throw new Error(`namespaced attribute '${attr.name}'; canonicalisation untested`);
  if (node.name.includes(":")) throw new Error(`namespaced element '${node.name}'; canonicalisation untested`);
  for (const child of node.children) assertSignable(child);
}

export function serializeCompact(node) {
  if (node.type === "text") return escapeText(node.value);
  if (node.type === "comment") return `<!--${node.value}-->`;
  if (node.type === "element") {
    let out = `<${node.name}`;
    for (const attr of node.attrs) out += ` ${attr.name}="${escapeAttribute(attr.value)}"`;
    // Whitespace-only text nodes (indentation between elements) are dropped;
    // an element with nothing else left self-closes.
    const kept = node.children.filter((child) => !(child.type === "text" && isAllSpace(child.value)));
    if (kept.length === 0) return out + "/>";
    out += ">";
    for (const child of kept) out += serializeCompact(child);
    return out + `</${node.name}>`;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Layer 2: the second-parse normalisation (reference construction).
// Reproduced from scratchpad/xri-preimage.mjs, proven against the probes.
// ---------------------------------------------------------------------------

const XML_SPACE = " \\t\\n\\v\\f\\r";
const XML_SPACE_RUN = /[ \t\n\v\f\r]+/g;
const trimXml = (text) => text.replace(new RegExp(`^[${XML_SPACE}]+|[${XML_SPACE}]+$`, "g"), "");
// One markup item: a comment (capture group 1) or any other tag.
const MARKUP = /(<!--[\s\S]*?-->)|<[^>]*>/g;

export function canonicalizeRoot(compact) {
  const normalizeText = (text) => trimXml(text.replace(XML_SPACE_RUN, " "));
  let out = "";
  let last = 0;
  for (const match of compact.matchAll(MARKUP)) {
    out += normalizeText(compact.slice(last, match.index));
    if (match[1] === undefined) out += match[0]; // keep tags, drop comments
    last = match.index + match[0].length;
  }
  return trimXml(out + normalizeText(compact.slice(last)));
}

// ---------------------------------------------------------------------------
// Preimage + signing.
// ---------------------------------------------------------------------------

/** Canonical signed bytes for a parsed root element. */
export function xriCanonical(root) {
  assertSignable(root);
  return canonicalizeRoot(serializeCompact(root));
}

export function xriPreimage(root, developerId, timestamp) {
  const message = `${xriCanonical(root)}\n${developerId}\n${timestamp}`;
  return crypto.createHash("sha512").update(message, "utf8").digest();
}

/** PixInsight's timestamp: ISO 8601, milliseconds, "Z" (same as code files). */
export const signingTimestamp = (date = new Date()) => date.toISOString();

/**
 * Sign an .xri file in place: append a <Signature> element after the root.
 * The signature covers only the canonical root, so the file's own formatting
 * is irrelevant, we keep it and simply append.
 *
 * @param {object} key   from signing.mjs loadSigningKey()
 * @param {(expandedKey:Buffer,message:Buffer,publicKey:Buffer)=>Buffer} sign
 */
export function signXriFile(filePath, key, sign, { timestamp = signingTimestamp() } = {}) {
  const text = fs.readFileSync(filePath, "utf8");
  const { root } = parseXml(text);
  const signature = sign(key.expandedKey, xriPreimage(root, key.developerId, timestamp), key.publicKey);

  const body = text.replace(/\s*$/, "");
  const element =
    `<Signature developerId="${key.developerId}" timestamp="${timestamp}" encoding="Base64">` +
    signature.toString("base64") +
    `</Signature>`;
  fs.writeFileSync(filePath, `${body}\n${element}\n`);
  return { timestamp, signature };
}
