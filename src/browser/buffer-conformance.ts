/**
 * The conformance cases that prove the browser's `Buffer` (the `buffer` package, `buffer-shim.ts`) equal to Node's for every
 * call the core makes (roadmap/browser-host.md, D5 and D14). Test support only: nothing under `src/` imports it except its two
 * tests, and it is not part of any bundle.
 *
 * A case is one (method, encoding, corpus) triple. `method` and `encoding` together are the *usage key* (`Buffer.from(string):utf8`,
 * `#toString:latin1`, `#swap16`): the same key the guard test (`buffer-usage.test.ts`) derives from the core's source, so a new
 * `Buffer` call in the core fails the guard until a case with its key is added here. `run` performs the operation on the class it
 * is given and returns what a caller can observe (bytes as hex, strings, lengths, whether the result is a `Buffer`); the suite
 * runs each item of the corpus on Node's `Buffer` and on the shim and requires the two observations to be equal.
 *
 * Corpora are seeded, so a failure reproduces.
 * @spec HOST-262
 */
import type { Buffer as NodeBuffer } from "node:buffer";
import { utf8Bytes, utf8Text } from "../io/utf8.js";

export type BufferClass = typeof NodeBuffer;

export interface ConformanceCase<T = unknown> {
  /** The call, as in the usage key: `Buffer.from(string)`, `#toString`, `#swap16`. */
  method: string;
  /** The encoding the call is given (`""` when it takes none). */
  encoding: string;
  /** The name of the corpus. */
  corpus: string;
  items: readonly T[];
  /** Performs the call on one item and returns the observable result. */
  run(B: BufferClass, item: T): unknown;
  /**
   * What Node's `Buffer` gives for the same item, when the call under test is not a `Buffer` call (a helper that must equal it).
   * The suite then requires `run` to equal it on Node and on the shim, instead of comparing the two runs with each other.
   */
  reference?(B: BufferClass, item: T): unknown;
  /** The items are expected to make the call throw: both implementations must, and their messages are noted. */
  throws?: boolean;
  /**
   * Why the shim is known to differ from Node on some items of this case. The case does not fail on a difference; the suite counts
   * the items that differ (and requires some to, so the reason stays true), and the guard test forbids the core from calling this
   * method directly: it goes through a helper whose own case, over the same corpus, must be equal.
   */
  differs?: string;
}

/** Runs `run` with the global `Buffer` set to `B`, for the helpers (`io/utf8.ts`) that read it at call time. */
export function withGlobalBuffer<T>(B: BufferClass, run: () => T): T {
  const holder = globalThis as unknown as { Buffer: BufferClass };
  const saved = holder.Buffer;
  holder.Buffer = B;
  try {
    return run();
  } finally {
    holder.Buffer = saved;
  }
}

const SHIM_UTF8_ENCODE =
  "the buffer package drops the last unpaired high surrogate of a string that ends in two or more of them, so its UTF-8 is shorter than Node's";
const SHIM_UTF8_DECODE =
  "the buffer package emits one U+FFFD per byte of a truncated or invalid multi-byte sequence, where Node emits one per maximal subpart";

/** The usage key of a case, as the guard derives it from source. */
export function usageKey(method: string, encoding: string): string {
  return encoding === "" ? method : `${method}:${encoding}`;
}

/** mulberry32: the same seeded generator the other differential tests use. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// String corpora
// ---------------------------------------------------------------------------------------------------------------------------

/** Every code unit from U+0000 to U+FFFF, in blocks of 256 (so the surrogate range is covered as lone code units too). */
function bmpBlocks(): string[] {
  const blocks: string[] = [];
  for (let start = 0; start < 0x10000; start += 0x100) {
    const units: number[] = [];
    for (let unit = start; unit < start + 0x100; unit++) units.push(unit);
    blocks.push(String.fromCharCode(...units));
  }
  return blocks;
}

const LONE_SURROGATES: string[] = [
  "\ud800", "\udbff", "\udc00", "\udfff", "\ud800\ud800", "\udbff\udbff", "\udc00\udc00", "\udc00\ud800", "\udfff\udbff",
  "a\ud800", "\ud800a", "\udc00b", "b\udc00", "a\ud800b", "a\udc00b", "\ud800a\udc00", "\udc00\ud800a",
  "\ud83d", "x\ud83d", "\ude00", "\ude00x", "😀\ud83d", "\ude00😀", "\ud83d😀", "😀\ude00",
  "\u0000\ud800\u0000", "\u007f\udc00\u0080", "ÿ\ud800Ā",
];

/** Astral characters: the first and last code points, famous ones, and a stride over the whole range. */
function astral(): string[] {
  const out: string[] = [
    String.fromCodePoint(0x10000), String.fromCodePoint(0x10ffff), String.fromCodePoint(0x1f600), String.fromCodePoint(0x1d11e),
    String.fromCodePoint(0xfffff), String.fromCodePoint(0x10400, 0x10401, 0x10402), String.fromCodePoint(0x1f468, 0x200d, 0x1f469),
  ];
  for (let start = 0x10000; start <= 0x10ffff; start += 0x1111) {
    const points: number[] = [];
    for (let i = 0; i < 16 && start + i <= 0x10ffff; i++) points.push(start + i);
    out.push(String.fromCodePoint(...points));
  }
  return out;
}

const MIXED: string[] = [
  "a\ud800b😀\0\x7f\x80\xffĀ﻿",
  "﻿<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n<AML>é€😀</AML>",
  "\0😀\0\udc00\0\ud800\0",
  "\xff😀\x80𐈀\x7f",
  "߿ࠀ퟿￿𐀀􏿿",
  "café über €100 — 𝓐𝓑 \u0000 end",
  "<Item type=\"Method\" id=\"AB\" a=\"\ud800\" b=\"\ude00\"/>",
];

const BOUNDARIES: string[] = [
  "\0", "\0\0\0", "a\0b", "\x7f", "\x80", "\xff", "\x7f\x80\xff", "\x00\x7f\x80\xffĀ", "Ā", "߿", "ࠀ",
  "퟿", "", "￿", "﻿", "￾", "�", "\u007f\u0080߿ࠀ￿",
];

/** 500 strings up to 10 kB of UTF-16 code units, drawn from every class: ASCII, latin1, BMP, lone surrogates, astral pairs. */
function randomStrings(count: number, maxUnits: number): string[] {
  const next = seeded(0x0b0ffe7);
  const strings: string[] = [];
  for (let i = 0; i < count; i++) {
    const length = i === 0 ? 0 : i === 1 ? maxUnits : Math.floor(next() * (maxUnits + 1));
    const units: number[] = [];
    while (units.length < length) {
      const pick = next();
      if (pick < 0.3) units.push(Math.floor(next() * 0x80));
      else if (pick < 0.4) units.push(0x80 + Math.floor(next() * 0x80));
      else if (pick < 0.5) units.push(0x100 + Math.floor(next() * 0xff00));
      else if (pick < 0.6) units.push(0xd800 + Math.floor(next() * 0x800));
      else if (pick < 0.9) {
        const point = 0x10000 + Math.floor(next() * 0x100000);
        const rest = point - 0x10000;
        units.push(0xd800 + (rest >> 10), 0xdc00 + (rest & 0x3ff));
      } else units.push(Math.floor(next() * 0x10000));
    }
    strings.push(String.fromCharCode(...units.slice(0, length)));
  }
  return strings;
}

export function stringCorpora(): Record<string, string[]> {
  return {
    empty: [""],
    "bmp-blocks": bmpBlocks(),
    "lone-surrogates": LONE_SURROGATES,
    astral: astral(),
    mixed: MIXED,
    boundaries: BOUNDARIES,
    "random-500": randomStrings(500, 10_000),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Byte corpora
// ---------------------------------------------------------------------------------------------------------------------------

function bytesOf(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

const UTF8_INVALID: Uint8Array[] = [
  bytesOf(0x80), bytesOf(0xbf), bytesOf(0xc0, 0x80), bytesOf(0xc1, 0xbf), bytesOf(0xc2), bytesOf(0xc2, 0x41), bytesOf(0xdf),
  bytesOf(0xe0, 0x80, 0x80), bytesOf(0xe0, 0x9f, 0xbf), bytesOf(0xe0, 0xa0), bytesOf(0xe2, 0x82), bytesOf(0xe2, 0x28, 0xa1),
  bytesOf(0xed, 0xa0, 0x80), bytesOf(0xed, 0xbf, 0xbf), bytesOf(0xed, 0x9f, 0xbf), bytesOf(0xee, 0x80),
  bytesOf(0xf0, 0x80, 0x80, 0x80), bytesOf(0xf0, 0x8f, 0xbf, 0xbf), bytesOf(0xf0, 0x90, 0x80), bytesOf(0xf0, 0x9f, 0x98),
  bytesOf(0xf0, 0x9f), bytesOf(0xf0), bytesOf(0xf4, 0x8f, 0xbf, 0xbf), bytesOf(0xf4, 0x90, 0x80, 0x80), bytesOf(0xf5, 0x80, 0x80, 0x80),
  bytesOf(0xf8, 0x88, 0x80, 0x80, 0x80), bytesOf(0xfc, 0x84, 0x80, 0x80, 0x80, 0x80), bytesOf(0xfe), bytesOf(0xff), bytesOf(0xff, 0xfe),
  bytesOf(0x41, 0x80, 0x42), bytesOf(0x41, 0xc3), bytesOf(0xc3, 0xc3, 0xa9), bytesOf(0xe2, 0x82, 0x41), bytesOf(0xf0, 0x9f, 0x98, 0x41),
  bytesOf(0xef, 0xbb, 0xbf), bytesOf(0xef, 0xbb, 0xbf, 0x41), bytesOf(0xef, 0xbf, 0xbd), bytesOf(0xc0), bytesOf(0xc1),
  bytesOf(0xed, 0xa0), bytesOf(0xed, 0xa0, 0x80, 0xed, 0xb0, 0x80), bytesOf(0x80, 0x80, 0x80, 0x80), bytesOf(0xe1, 0x80, 0xe1, 0x80),
];

function allBytes(): Uint8Array[] {
  const ascending = new Uint8Array(256).map((_, i) => i);
  const descending = new Uint8Array(256).map((_, i) => 255 - i);
  return [ascending, descending, bytesOf(0), bytesOf(0x7f), bytesOf(0x80), bytesOf(0xff), bytesOf(0x00, 0x7f, 0x80, 0xff)];
}

function randomBytes(count: number, maxLength: number, highBias: boolean): Uint8Array[] {
  const next = seeded(highBias ? 0x5eed02 : 0x5eed01);
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const length = i === 0 ? 0 : i === 1 ? maxLength : Math.floor(next() * (maxLength + 1));
    const bytes = new Uint8Array(length);
    for (let j = 0; j < length; j++) bytes[j] = highBias && next() < 0.7 ? 0x80 + Math.floor(next() * 0x80) : Math.floor(next() * 256);
    out.push(bytes);
  }
  return out;
}

/** The UTF-8 of every string corpus, as Node encodes it: valid UTF-8 (lone surrogates already replaced). */
function utf8Of(B: BufferClass, corpora: Record<string, string[]>): Uint8Array[] {
  return Object.values(corpora).flatMap((strings) => strings.map((text) => Uint8Array.from(B.from(text, "utf8"))));
}

export function byteCorpora(B: BufferClass, strings: Record<string, string[]>): Record<string, Uint8Array[]> {
  return {
    empty: [new Uint8Array(0)],
    "all-bytes": allBytes(),
    "utf8-valid": utf8Of(B, strings),
    "utf8-invalid": UTF8_INVALID,
    "random-500": randomBytes(500, 10_000, false),
    "random-high-bytes": randomBytes(100, 2_000, true),
  };
}

/** Standard, padded base64 of random bytes of every length 0 to 99, plus a few long ones. */
function base64Canonical(B: BufferClass): string[] {
  const next = seeded(0xb64);
  const out: string[] = [];
  for (let length = 0; length < 100; length++) {
    const bytes = new Uint8Array(length).map(() => Math.floor(next() * 256));
    out.push(B.from(bytes).toString("base64"));
  }
  for (const length of [255, 256, 1000, 4097, 10_000]) out.push(B.from(new Uint8Array(length).map(() => Math.floor(next() * 256))).toString("base64"));
  return out;
}

/** Input a base64 decoder has to decide about: not what the core receives (it round-trips its own output), but where decoders differ. */
const BASE64_LOOSE: string[] = [
  "QQ", "QUI", "QUJD", "QQ=", "QQ==", "QUI=", "QQ===", "=", "==", "====", "A", "AAA", "Q Q = =", "QU\nJD", "QU\r\nJD\r\n", " QUJD ", "\tQUJD\t",
  "+/+/", "-_-_", "-_", "+-/_", "QU!JD", "QUJD!", "!QUJD", "QUJD====", "QU=JD", "=QUJD", "éQUJD", "QUJDé", "\ud800QUJD", "",
];

export function base64Corpora(B: BufferClass): Record<string, string[]> {
  return { canonical: base64Canonical(B), loose: BASE64_LOOSE };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------------------------------------------------------

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** What a caller can see of a byte result: its bytes, its length, and whether it is a `Buffer`. */
function seen(B: BufferClass, value: Uint8Array): { hex: string; length: number; isBuffer: boolean } {
  let hex = "";
  for (let i = 0; i < value.length; i++) hex += HEX[value[i] as number];
  return { hex, length: value.length, isBuffer: B.isBuffer(value) };
}

const ENCODINGS_OF_STRING = ["utf8", "utf16le", "latin1"] as const;
const DECODINGS = ["utf8", "latin1", "utf16le", "base64"] as const;

/** The `enc` and `dec` of `manifest/hashtable-cases.ts`: a string as the base64 of its UTF-16LE code units, and back. */
function encodeUnits(B: BufferClass, text: string): string {
  const b = B.alloc(text.length * 2);
  for (let i = 0; i < text.length; i++) b.writeUInt16LE(text.charCodeAt(i), 2 * i);
  return b.toString("base64");
}
function decodeUnits(B: BufferClass, b64: string): string {
  const b = B.from(b64, "base64");
  let text = "";
  for (let i = 0; i < b.length; i += 2) text += String.fromCharCode(b.readUInt16LE(i));
  return text;
}

interface Slice {
  bytes: Uint8Array;
  start?: number;
  end?: number;
}

/** A few (start, end) pairs per byte string: whole, a prefix, a suffix, an interior range, an empty range, past the end, negative. */
function slicesOf(corpus: Uint8Array[]): Slice[] {
  const out: Slice[] = [];
  for (const bytes of corpus) {
    const n = bytes.length;
    out.push({ bytes }, { bytes, start: 0, end: Math.floor(n / 2) }, { bytes, start: Math.floor(n / 3) }, { bytes, start: Math.floor(n / 4), end: Math.floor((3 * n) / 4) });
    out.push({ bytes, start: 1, end: 1 }, { bytes, start: n + 5 }, { bytes, start: 0, end: n + 5 }, { bytes, start: -3 }, { bytes, start: 2, end: 1 });
  }
  return out;
}

/** The list a test can run: every case, with its triple. Built from Node's `Buffer` only to generate corpora. */
export function buildCases(B: BufferClass): ConformanceCase[] {
  const strings = stringCorpora();
  const bytes = byteCorpora(B, strings);
  const base64 = base64Corpora(B);
  const cases: ConformanceCase[] = [];
  const add = <T>(entry: ConformanceCase<T>): void => void cases.push(entry as ConformanceCase);

  // Buffer.from(string, encoding): the bytes of text.
  for (const encoding of ENCODINGS_OF_STRING) {
    for (const [corpus, items] of Object.entries(strings)) {
      add({ method: "Buffer.from(string)", encoding, corpus, items, ...(encoding === "utf8" ? { differs: SHIM_UTF8_ENCODE } : {}), run: (b, text: string) => seen(b, b.from(text, encoding)) });
    }
  }
  // The default encoding (utf8) and `Buffer.from(base64text, "base64")`.
  for (const [corpus, items] of Object.entries(strings)) {
    add({ method: "Buffer.from(string)", encoding: "default", corpus, items, differs: SHIM_UTF8_ENCODE, run: (b, text: string) => seen(b, b.from(text)) });
  }
  for (const [corpus, items] of Object.entries(base64)) {
    add({ method: "Buffer.from(string)", encoding: "base64", corpus: `base64-${corpus}`, items, run: (b, text: string) => seen(b, b.from(text, "base64")) });
  }
  // Buffer.from(string) with an encoding the engine never passes: both must throw.
  add({ method: "Buffer.from(string)", encoding: "unknown", corpus: "throws", items: ["abc", ""], throws: true, run: (b, text: string) => b.from(text, "no-such-encoding" as BufferEncoding) });

  // Buffer.from(bytes): a copy of an array of numbers (`singleByte`, the BOMs) or of a Uint8Array (`Buffer.from(bytes.subarray(...))`).
  add({
    method: "Buffer.from(bytes)",
    encoding: "",
    corpus: "number-arrays",
    items: [[], [0], [0xef, 0xbb, 0xbf], [0xff, 0xfe], [0xfe, 0xff], Array.from({ length: 256 }, (_, i) => i), Array.from({ length: 256 }, (_, i) => 255 - i), [0x3f, 0x3f, 0x3f]],
    run: (b, values: number[]) => seen(b, b.from(values)),
  });
  add({
    method: "Buffer.from(bytes)",
    encoding: "",
    corpus: "number-arrays-out-of-range",
    items: [[256], [-1], [3.7], [Number.NaN], [0x1ff, 0x100, 0x101], [-256, -255], [1e10], [Number.POSITIVE_INFINITY], [0.5, 255.9]],
    run: (b, values: number[]) => seen(b, b.from(values)),
  });
  for (const [corpus, items] of Object.entries(bytes)) {
    add({ method: "Buffer.from(bytes)", encoding: "", corpus: `uint8array-${corpus}`, items, run: (b, source: Uint8Array) => seen(b, b.from(source)) });
  }
  // It copies: writing to the source afterwards, or to the result, leaves the other alone. Also the exact pattern of the loaders.
  add({
    method: "Buffer.from(bytes)",
    encoding: "",
    corpus: "copies-subarray",
    items: [bytesOf(1, 2, 3, 4, 5, 6, 7, 8), allBytes()[0] as Uint8Array, bytesOf(0xe2, 0x82, 0xac, 0x41)],
    run: (b, item: Uint8Array) => {
      const source = Uint8Array.from(item);
      const sub = source.subarray(1, source.length - 1);
      const copy = b.from(sub);
      const before = seen(b, copy);
      sub.fill(0xaa);
      const afterSourceWrite = seen(b, copy);
      copy.fill(0x55);
      return { before, afterSourceWrite, sourceAfterCopyWrite: seen(b, source) };
    },
  });
  add({
    method: "Buffer.from(bytes)",
    encoding: "",
    corpus: "copies-buffer",
    items: [bytesOf(1, 2, 3), bytesOf(), bytesOf(0xff, 0, 0xff)],
    run: (b, source: Uint8Array) => {
      const original = b.from(source);
      const copy = b.from(original);
      original.fill(9);
      return { copy: seen(b, copy), original: seen(b, original) };
    },
  });

  // Buffer.from(arrayBuffer, byteOffset, length): a view of the memory, not a copy.
  add({
    method: "Buffer.from(arraybuffer)",
    encoding: "",
    corpus: "aliases-the-memory",
    items: [
      { size: 16, offset: undefined, length: undefined },
      { size: 16, offset: 4, length: undefined },
      { size: 16, offset: 4, length: 8 },
      { size: 16, offset: 16, length: 0 },
      { size: 0, offset: 0, length: 0 },
    ],
    run: (b, item: { size: number; offset: number | undefined; length: number | undefined }) => {
      const memory = new ArrayBuffer(item.size);
      const view = new Uint8Array(memory);
      view.forEach((_, i) => (view[i] = i + 1));
      const buffer = item.offset === undefined ? b.from(memory) : item.length === undefined ? b.from(memory, item.offset) : b.from(memory, item.offset, item.length);
      const before = seen(b, buffer);
      if (buffer.length > 0) buffer[0] = 0xee;
      if (view.length > 3) view[3] = 0xdd;
      return { before, after: seen(b, buffer), memory: seen(b, b.from(view)) };
    },
  });
  add({ method: "Buffer.from(arraybuffer)", encoding: "", corpus: "throws", items: [{ offset: 99 }, { offset: 4, length: 99 }], throws: true, run: (b, item: { offset: number; length?: number }) => b.from(new ArrayBuffer(16), item.offset, item.length) });

  // Buffer.concat(list, totalLength?)
  const chunkLists = (corpus: Uint8Array[]): Uint8Array[][] => {
    const lists: Uint8Array[][] = [[]];
    for (let i = 0; i < corpus.length; i += 3) lists.push(corpus.slice(i, i + 1 + (i % 4)));
    return lists;
  };
  const asBuffers = (b: BufferClass, list: Uint8Array[]): Uint8Array[] => list.map((chunk, i) => (i % 2 === 0 ? b.from(chunk) : chunk));
  for (const [corpus, items] of Object.entries(bytes)) {
    add({ method: "Buffer.concat", encoding: "", corpus: `without-length-${corpus}`, items: chunkLists(items), run: (b, list: Uint8Array[]) => seen(b, b.concat(asBuffers(b, list))) });
    add({
      method: "Buffer.concat",
      encoding: "",
      corpus: `with-total-length-${corpus}`,
      items: chunkLists(items),
      run: (b, list: Uint8Array[]) => {
        const total = list.reduce((sum, chunk) => sum + chunk.length, 0);
        return { exact: seen(b, b.concat(asBuffers(b, list), total)), shorter: seen(b, b.concat(asBuffers(b, list), Math.floor(total / 2))), longer: seen(b, b.concat(asBuffers(b, list), total + 7)), zero: seen(b, b.concat(asBuffers(b, list), 0)) };
      },
    });
  }
  add({
    method: "Buffer.concat",
    encoding: "",
    corpus: "bom-patterns",
    items: ["", "plain", "é€😀", "\ud800lone"],
    run: (b, text: string) => ({
      utf8: seen(b, b.concat([b.from([0xef, 0xbb, 0xbf]), b.from(text, "utf8")])),
      utf16le: seen(b, b.concat([b.from([0xff, 0xfe]), b.from(text, "utf16le")])),
      utf16be: seen(b, b.concat([b.from([0xfe, 0xff]), b.from(text, "utf16le").swap16()])),
    }),
  });
  add({ method: "Buffer.concat", encoding: "", corpus: "does-not-alias-its-input", items: [[bytesOf(1, 2), bytesOf(3)]], run: (b, list: Uint8Array[]) => { const joined = b.concat(list); joined.fill(0xff); return list.map((chunk) => seen(b, chunk)); } });
  add({ method: "Buffer.concat", encoding: "", corpus: "throws", items: [["not a buffer"], [bytesOf(1), "x"], [null]], throws: true, run: (b, list: unknown[]) => b.concat(list as Uint8Array[]) });

  // Buffer.alloc(size, fill?)
  add({ method: "Buffer.alloc", encoding: "", corpus: "sizes", items: [0, 1, 2, 3, 255, 256, 1000, 10_000], run: (b, size: number) => seen(b, b.alloc(size)) });
  add({ method: "Buffer.alloc", encoding: "", corpus: "filled", items: [0, 1, 0xff, 0x100, -1, 7.9], run: (b, fill: number) => seen(b, b.alloc(9, fill)) });
  add({ method: "Buffer.alloc", encoding: "", corpus: "throws", items: [-1, 2 ** 53], throws: true, run: (b, size: number) => b.alloc(size) });

  // Buffer.byteLength(text, encoding) and Buffer.isBuffer(value)
  for (const encoding of [...ENCODINGS_OF_STRING, "base64"] as const) {
    for (const [corpus, items] of Object.entries(encoding === "base64" ? { canonical: base64.canonical as string[] } : strings)) {
      add({ method: "Buffer.byteLength", encoding, corpus, items, ...(encoding === "utf8" ? { differs: SHIM_UTF8_ENCODE } : {}), run: (b, text: string) => b.byteLength(text, encoding) });
    }
  }
  add({
    method: "Buffer.isBuffer",
    encoding: "",
    corpus: "values",
    items: ["buffer", "uint8array", "subarray-of-buffer", "array", "string", "null", "undefined", "number", "object"],
    run: (b, kind: string) => {
      const values: Record<string, unknown> = { buffer: b.from("x"), uint8array: new Uint8Array(1), "subarray-of-buffer": b.from("xyz").subarray(1), array: [1], string: "x", null: null, undefined: undefined, number: 1, object: {} };
      return b.isBuffer(values[kind]);
    },
  });

  // buffer.toString(encoding?, start?, end?): the text of bytes.
  for (const encoding of DECODINGS) {
    for (const [corpus, items] of Object.entries(bytes)) {
      add({ method: "#toString", encoding, corpus, items, ...(encoding === "utf8" ? { differs: SHIM_UTF8_DECODE } : {}), run: (b, source: Uint8Array) => b.from(source).toString(encoding) });
    }
  }
  for (const encoding of ["utf8", "latin1"] as const) {
    for (const corpus of ["utf8-valid", "utf8-invalid", "random-500"]) {
      add({ method: "#toString", encoding, corpus: `${corpus}-range`, items: slicesOf((bytes[corpus] as Uint8Array[]).slice(0, 60)), ...(encoding === "utf8" ? { differs: SHIM_UTF8_DECODE } : {}), run: (b, item: Slice) => b.from(item.bytes).toString(encoding, item.start, item.end) });
    }
  }
  // The loaders decode a window of a larger array: `Buffer.from(bytes.subarray(i, i + n)).toString(...)`.
  for (const encoding of ["utf8", "latin1"] as const) {
    add({
      method: "#toString",
      encoding,
      corpus: "window-of-larger-array",
      items: (bytes["random-high-bytes"] as Uint8Array[]).slice(0, 40),
      ...(encoding === "utf8" ? { differs: SHIM_UTF8_DECODE } : {}),
      run: (b, source: Uint8Array) => b.from(source.subarray(1, Math.max(1, source.length - 1))).toString(encoding),
    });
  }
  add({ method: "#toString", encoding: "default", corpus: "utf8-valid", items: bytes["utf8-valid"] as Uint8Array[], differs: SHIM_UTF8_DECODE, run: (b, source: Uint8Array) => b.from(source).toString() });
  add({ method: "#toString", encoding: "unknown", corpus: "throws", items: [bytesOf(1, 2, 3), bytesOf(0)], throws: true, run: (b, source: Uint8Array) => b.from(source).toString("no-such-encoding" as BufferEncoding) });

  // The helpers the core uses for UTF-8 (`io/utf8.ts`), run on top of each implementation: equal to Node's `Buffer` over the corpora where the shim alone is not.
  for (const [corpus, items] of Object.entries(strings)) {
    add({
      method: "utf8Bytes",
      encoding: "",
      corpus,
      items,
      run: (b, text: string) => withGlobalBuffer(b, () => seen(b, utf8Bytes(text))),
      reference: (b, text: string) => seen(b, b.from(text, "utf8")),
    });
  }
  for (const [corpus, items] of Object.entries(bytes)) {
    add({
      method: "utf8Text",
      encoding: "",
      corpus,
      items,
      run: (b, source: Uint8Array) => withGlobalBuffer(b, () => utf8Text(source)),
      reference: (b, source: Uint8Array) => b.from(source).toString("utf8"),
    });
  }
  // buffer.swap16(): in place, even lengths only.
  add({
    method: "#swap16",
    encoding: "",
    corpus: "even-length-bytes",
    items: Object.values(bytes).flatMap((corpus) => corpus.map((source) => source.subarray(0, source.length - (source.length % 2)))),
    run: (b, source: Uint8Array) => {
      const buffer = b.from(source);
      const returned = buffer.swap16();
      return { result: seen(b, buffer), returnsItself: returned === buffer };
    },
  });
  for (const [corpus, items] of Object.entries(strings)) {
    add({ method: "#swap16", encoding: "utf16le", corpus: `big-endian-text-${corpus}`, items, run: (b, text: string) => seen(b, b.from(text, "utf16le").swap16()) });
  }
  add({ method: "#swap16", encoding: "", corpus: "throws", items: [1, 3, 5, 99, 1001], throws: true, run: (b, length: number) => b.alloc(length).swap16() });

  // buffer.subarray(start?, end?): a view that shares the memory and is itself a Buffer.
  add({
    method: "#subarray",
    encoding: "",
    corpus: "bounds",
    items: slicesOf([bytesOf(), bytesOf(1), bytesOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), allBytes()[0] as Uint8Array]),
    run: (b, item: Slice) => {
      const buffer = b.from(item.bytes);
      const view = buffer.subarray(item.start, item.end);
      return { ...seen(b, view), byteOffset: view.byteOffset - buffer.byteOffset, bufferLength: buffer.length };
    },
  });
  add({
    method: "#subarray",
    encoding: "",
    corpus: "aliases-the-parent",
    items: [{ start: 0, end: 4 }, { start: 2, end: 6 }, { start: 3, end: undefined }, { start: -4, end: -1 }, { start: 5, end: 5 }],
    run: (b, item: { start: number; end: number | undefined }) => {
      const parent = b.from([1, 2, 3, 4, 5, 6, 7, 8]);
      const view = parent.subarray(item.start, item.end);
      const initial = seen(b, view);
      if (view.length > 0) view[0] = 0xaa;
      view.fill(0xbb, view.length > 1 ? 1 : 0);
      const afterViewWrite = seen(b, parent);
      parent[7] = 0xcc;
      parent[Math.max(0, item.start)] = 0xdd;
      return { initial, afterViewWrite, afterParentWrite: seen(b, view), parent: seen(b, parent) };
    },
  });
  add({
    method: "#subarray",
    encoding: "",
    corpus: "of-a-subarray",
    items: [{ a: [1, 6], b: [1, 3] }, { a: [0, 8], b: [2, 100] }, { a: [4, 8], b: [0, 2] }],
    run: (b, item: { a: [number, number]; b: [number, number] }) => {
      const parent = b.from([1, 2, 3, 4, 5, 6, 7, 8]);
      const inner = parent.subarray(...item.a).subarray(...item.b);
      inner.fill(0xee);
      return { inner: seen(b, inner), parent: seen(b, parent) };
    },
  });
  add({
    method: "#subarray",
    encoding: "",
    corpus: "then-toString-and-concat",
    items: slicesOf((bytes["utf8-valid"] as Uint8Array[]).slice(0, 30)),
    run: (b, item: Slice) => {
      const view = b.from(item.bytes).subarray(item.start, item.end);
      return { text: view.toString("utf8"), joined: seen(b, b.concat([view, view])) };
    },
  });
  add({
    method: "#subarray",
    encoding: "",
    corpus: "of-a-uint8array",
    items: [{ start: 1, end: 5 }, { start: 0, end: 0 }, { start: 3, end: undefined }],
    run: (b, item: { start: number; end: number | undefined }) => {
      const source = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
      const copy = b.from(source.subarray(item.start, item.end));
      source.fill(0);
      return seen(b, copy);
    },
  });

  // buffer.writeUInt16LE(value, offset) and buffer.readUInt16LE(offset): `enc` and `dec` of the hashtable probe cases.
  for (const [corpus, items] of Object.entries(strings)) {
    add({ method: "#writeUInt16LE", encoding: "", corpus: `units-to-base64-${corpus}`, items, run: (b, text: string) => encodeUnits(b, text) });
    add({ method: "#readUInt16LE", encoding: "", corpus: `base64-to-units-${corpus}`, items, run: (b, text: string) => decodeUnits(b, encodeUnits(b, text)) });
  }
  add({
    method: "#writeUInt16LE",
    encoding: "",
    corpus: "values",
    items: [0, 1, 0xff, 0x100, 0x7fff, 0x8000, 0xd800, 0xffff],
    run: (b, value: number) => {
      const buffer = b.alloc(6);
      buffer.writeUInt16LE(value, 2);
      return { written: seen(b, buffer), read: buffer.readUInt16LE(2) };
    },
  });
  add({
    method: "#writeUInt16LE",
    encoding: "",
    corpus: "throws",
    items: [{ value: 0x10000, offset: 0 }, { value: -1, offset: 0 }, { value: 1, offset: 5 }, { value: 1, offset: -1 }],
    throws: true,
    run: (b, item: { value: number; offset: number }) => b.alloc(6).writeUInt16LE(item.value, item.offset),
  });
  add({ method: "#readUInt16LE", encoding: "", corpus: "throws", items: [5, 6, -1, 100], throws: true, run: (b, offset: number) => b.alloc(6).readUInt16LE(offset) });

  // buffer.length
  add({ method: "#length", encoding: "", corpus: "all-results", items: Object.values(bytes).flat().slice(0, 200), run: (b, source: Uint8Array) => [b.from(source).length, b.from(source.subarray(1)).length, b.concat([b.from(source), b.from(source)]).length] });

  return cases;
}
