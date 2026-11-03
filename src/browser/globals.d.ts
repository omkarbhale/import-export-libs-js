/**
 * The ambient `Buffer` of the browser typecheck (`tsconfig.browser.json`, which compiles with `types: []` and so has no Node types).
 *
 * The core keeps `Buffer` on purpose (roadmap/browser-host.md, D5): the engine's byte-exact encodings (UTF-8 BOMs, latin1, UTF-16
 * with `swap16`, lone surrogates) are written against it, and the browser bundle gets the `buffer` package injected in its place.
 * This declaration is therefore the contract that shim must meet: it lists exactly the statics and methods the core calls, no
 * more, and that list is what the shim's conformance suite tests against Node's `Buffer`. Adding a Buffer call to the core means
 * adding it here, and a test for it there.
 *
 * It is an ambient script, not a module, so it declares the global class. The base project (`tsconfig.json`) has `@types/node`
 * and excludes this file, because both would declare `Buffer`.
 */

/** The encodings the core passes to `Buffer`: `from(text, encoding)` and `toString(encoding)`. */
type BufferEncoding = "utf8" | "utf-8" | "utf16le" | "utf-16le" | "latin1" | "binary" | "ascii" | "hex" | "base64";

declare class Buffer extends Uint8Array {
  /** `Buffer.from(text, encoding)`: the bytes of a string in an encoding (default `utf8`). */
  static from(text: string, encoding?: BufferEncoding): Buffer;
  /** `Buffer.from(bytes)`: a copy of an array of byte values, or of the bytes of a `Uint8Array`. */
  static from(bytes: ArrayLike<number> | Iterable<number>): Buffer;
  /** `Buffer.from(arrayBuffer, byteOffset, length)`: a view of the memory of an `ArrayBuffer`, not a copy. */
  static from(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Buffer;
  /** `Buffer.concat(list, totalLength)`: one new buffer with the bytes of each chunk in order. */
  static concat(list: readonly Uint8Array[], totalLength?: number): Buffer;
  /** `Buffer.alloc(size, fill)`: a zero-filled (or `fill`-filled) buffer of `size` bytes. */
  static alloc(size: number, fill?: number): Buffer;
  /** `Buffer.byteLength(text, encoding)`: how many bytes the string takes in the encoding. */
  static byteLength(text: string, encoding?: BufferEncoding): number;
  /** `Buffer.isBuffer(value)`: true for a `Buffer` and false for a plain `Uint8Array`. */
  static isBuffer(value: unknown): value is Buffer;

  /** `buffer.toString(encoding, start, end)`: decodes the bytes (default `utf8`). */
  toString(encoding?: BufferEncoding, start?: number, end?: number): string;
  /** `buffer.swap16()`: swaps each pair of bytes in place and returns the buffer. */
  swap16(): this;
  /** `buffer.subarray(start, end)`: a view that shares the memory, and is itself a `Buffer`. */
  subarray(start?: number, end?: number): Buffer;
}
