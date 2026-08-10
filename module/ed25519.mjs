// Ed25519 signing from an *expanded* private key (clamped scalar + nonce
// prefix), which is the form PixInsight's .xssk stores and hands to PJSR.
//
// Node's crypto can only sign from a 32-byte seed: it derives the scalar and
// nonce prefix itself via SHA-512. PixInsight gives out the already-expanded
// pair and the seed that produced it is not recoverable, so the signature
// equations are evaluated here directly. This is the only reason a hand-rolled
// implementation exists in this repo; verification elsewhere uses node:crypto.
//
// validate() checks this implementation against node:crypto on the seed path,
// and runs in the test suite.

import crypto from "node:crypto";

const P = 2n ** 255n - 19n;
const L = 2n ** 252n + 27742317777372353535851937790883648493n;

const sha512 = (...parts) => {
  const hash = crypto.createHash("sha512");
  for (const part of parts) hash.update(part);
  return hash.digest();
};

const mod = (value, modulus = P) => ((value % modulus) + modulus) % modulus;

function power(base, exponent, modulus = P) {
  let result = 1n;
  let acc = mod(base, modulus);
  let exp = exponent;
  while (exp > 0n) {
    if (exp & 1n) result = (result * acc) % modulus;
    acc = (acc * acc) % modulus;
    exp >>= 1n;
  }
  return result;
}

const inverse = (value) => power(value, P - 2n);
const D = mod(-121665n * inverse(121666n));

/** Standard Ed25519 base point, hardcoded to avoid a square-root recovery. */
const BASE_X = 15112221349535400772501151409588531511454012693041857206046113283949847762202n;
const BASE_Y = 46316835694926478169428394003475163141307993866256225615783033603165251855960n;
const BASE = { X: BASE_X, Y: BASE_Y, Z: 1n, T: mod(BASE_X * BASE_Y) };
const IDENTITY = { X: 0n, Y: 1n, Z: 1n, T: 0n };

/** Twisted Edwards addition in extended coordinates, a = -1. */
function addPoints(first, second) {
  const a = mod((first.Y - first.X) * (second.Y - second.X));
  const b = mod((first.Y + first.X) * (second.Y + second.X));
  const c = mod(first.T * 2n * D * second.T);
  const d = mod(first.Z * 2n * second.Z);
  const e = mod(b - a);
  const f = mod(d - c);
  const g = mod(d + c);
  const h = mod(b + a);
  return { X: mod(e * f), Y: mod(g * h), T: mod(e * h), Z: mod(f * g) };
}

function multiplyPoint(point, scalar) {
  let result = IDENTITY;
  let addend = point;
  let remaining = scalar;
  while (remaining > 0n) {
    if (remaining & 1n) result = addPoints(result, addend);
    addend = addPoints(addend, addend);
    remaining >>= 1n;
  }
  return result;
}

function encodePoint(point) {
  const zInverse = inverse(point.Z);
  const x = mod(point.X * zInverse);
  const y = mod(point.Y * zInverse);
  const bytes = Buffer.alloc(32);
  let value = y;
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  if (x & 1n) bytes[31] |= 0x80; // the sign of x rides in the top bit
  return bytes;
}

function bytesToNumberLE(bytes) {
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]);
  return value;
}

function numberToBytesLE(value, length) {
  const bytes = Buffer.alloc(length);
  let remaining = value;
  for (let i = 0; i < length; i++) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

/** Public key for an expanded private key, i.e. scalar * BASE. */
export function publicKeyFromScalar(scalarBytes) {
  return encodePoint(multiplyPoint(BASE, bytesToNumberLE(scalarBytes)));
}

/**
 * Sign with an expanded key.
 *
 * @param {Buffer} expandedKey 64 bytes: clamped scalar, then nonce prefix
 * @param {Buffer} message     bytes to sign
 * @param {Buffer} publicKey   32-byte public key, bound into the challenge
 * @returns {Buffer} 64-byte signature
 */
export function signWithExpandedKey(expandedKey, message, publicKey) {
  if (expandedKey.length !== 64) throw new Error(`expanded key must be 64 bytes, got ${expandedKey.length}`);
  if (publicKey.length !== 32) throw new Error(`public key must be 32 bytes, got ${publicKey.length}`);

  const scalar = bytesToNumberLE(expandedKey.subarray(0, 32));
  const noncePrefix = expandedKey.subarray(32);
  const r = mod(bytesToNumberLE(sha512(noncePrefix, message)), L);
  const rPoint = encodePoint(multiplyPoint(BASE, r));
  const challenge = mod(bytesToNumberLE(sha512(rPoint, publicKey, message)), L);
  const s = mod(r + challenge * scalar, L);
  return Buffer.concat([rPoint, numberToBytesLE(s, 32)]);
}

/** Self-check against node:crypto, on a random seed-derived key. */
export function validate() {
  const seed = crypto.randomBytes(32);
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32);

  const expanded = sha512(seed);
  const scalar = Buffer.from(expanded.subarray(0, 32));
  scalar[0] &= 248;
  scalar[31] &= 127;
  scalar[31] |= 64;

  const message = Buffer.from("validation message");
  const ours = signWithExpandedKey(Buffer.concat([scalar, expanded.subarray(32)]), message, publicKey);
  return ours.equals(crypto.sign(null, message, privateKey));
}
