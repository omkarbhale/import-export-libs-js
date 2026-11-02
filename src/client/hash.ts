/**
 * Synchronous MD5 (RFC 1321) and SHA-256 (FIPS 180-4) over bytes, in plain
 * TypeScript: no dependency and nothing from Node. The password digest
 * is computed in the constructors of the connection classes, so it has to be
 * synchronous (Web Crypto is not) and the same on every host (Web Crypto has
 * no MD5).
 *
 * @spec HOST-240
 */

const HEX = "0123456789abcdef";

function toHex(words: Uint32Array, littleEndian: boolean): string {
  let out = "";
  for (const word of words) {
    for (let i = 0; i < 4; i++) {
      const byte = littleEndian ? (word >>> (8 * i)) & 0xff : (word >>> (24 - 8 * i)) & 0xff;
      out += HEX.charAt(byte >>> 4) + HEX.charAt(byte & 15);
    }
  }
  return out;
}

/**
 * Calls `block` with every 64-byte block of the message, in order: the whole
 * blocks straight from the input, then the tail followed by the 0x80 byte,
 * zeros and the 64-bit bit length (little-endian for MD5, big-endian for
 * SHA-256) as one or two more blocks. `block` gets the bytes and the offset
 * of the block in them.
 */
function eachBlock(bytes: Uint8Array, littleEndian: boolean, block: (data: Uint8Array, offset: number) => void): void {
  const length = bytes.length;
  const whole = length - (length % 64);
  for (let offset = 0; offset < whole; offset += 64) block(bytes, offset);
  const tail = new Uint8Array(length % 64 < 56 ? 64 : 128);
  tail.set(bytes.subarray(whole));
  tail[length - whole] = 0x80;
  const view = new DataView(tail.buffer);
  const bitsLow = (length << 3) >>> 0;
  const bitsHigh = Math.floor(length / 0x20000000);
  if (littleEndian) {
    view.setUint32(tail.length - 8, bitsLow, true);
    view.setUint32(tail.length - 4, bitsHigh, true);
  } else {
    view.setUint32(tail.length - 8, bitsHigh, false);
    view.setUint32(tail.length - 4, bitsLow, false);
  }
  for (let offset = 0; offset < tail.length; offset += 64) block(tail, offset);
}

/** Per-round left-rotation amounts of MD5 (RFC 1321 section 3.4). */
const MD5_SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** MD5's T table: floor(2^32 * abs(sin(i + 1))). */
const MD5_K = Uint32Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000));

/** The lowercase hex of the MD5 digest of the bytes. */
export function md5Hex(bytes: Uint8Array): string {
  const m = new Int32Array(16);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476;
  eachBlock(bytes, true, (data, offset) => {
    for (let i = 0, j = offset; i < 16; i++, j += 4) {
      m[i] = data[j]! | (data[j + 1]! << 8) | (data[j + 2]! << 16) | (data[j + 3]! << 24);
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 16; i++) {
      const sum = (a + ((b & c) | (~b & d)) + MD5_K[i]! + m[i]!) | 0;
      const shift = MD5_SHIFT[i]!;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
    }
    for (let i = 16; i < 32; i++) {
      const sum = (a + ((d & b) | (~d & c)) + MD5_K[i]! + m[(5 * i + 1) & 15]!) | 0;
      const shift = MD5_SHIFT[i]!;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
    }
    for (let i = 32; i < 48; i++) {
      const sum = (a + (b ^ c ^ d) + MD5_K[i]! + m[(3 * i + 5) & 15]!) | 0;
      const shift = MD5_SHIFT[i]!;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
    }
    for (let i = 48; i < 64; i++) {
      const sum = (a + (c ^ (b | ~d)) + MD5_K[i]! + m[(7 * i) & 15]!) | 0;
      const shift = MD5_SHIFT[i]!;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  });
  return toHex(Uint32Array.of(a0, b0, c0, d0), true);
}

/** SHA-256's round constants (FIPS 180-4 section 4.2.2). */
const SHA256_K = Uint32Array.of(
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** The lowercase hex of the SHA-256 digest of the bytes. */
export function sha256Hex(bytes: Uint8Array): string {
  const w = new Int32Array(64);
  const h = Int32Array.of(
    0x6a09e667, 0xbb67ae85 | 0, 0x3c6ef372, 0xa54ff53a | 0, 0x510e527f, 0x9b05688c | 0, 0x1f83d9ab, 0x5be0cd19,
  );
  eachBlock(bytes, false, (data, offset) => {
    for (let i = 0, j = offset; i < 16; i++, j += 4) {
      w[i] = (data[j]! << 24) | (data[j + 1]! << 16) | (data[j + 2]! << 8) | data[j + 3]!;
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!;
      const w2 = w[i - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + SHA256_K[i]! + w[i]!) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0;
    h[5] = (h[5]! + f) | 0;
    h[6] = (h[6]! + g) | 0;
    h[7] = (h[7]! + hh) | 0;
  });
  return toHex(Uint32Array.from(h), false);
}
