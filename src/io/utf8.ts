/**
 * UTF-8 text to bytes and back, the same on every host.
 *
 * Node's `Buffer` and the `buffer` package that stands in for it in the browser (`browser/buffer-shim.ts`) agree on every call
 * the core makes except these two (found by `browser/buffer-shim.test.ts`, roadmap/browser-host.md D5): the package drops the
 * last unpaired high surrogate of a string that ends in two or more of them when it encodes, and it turns a truncated or
 * invalid multi-byte sequence into more U+FFFD than Node does (Node follows the WHATWG decoder: one per maximal subpart) when it
 * decodes. `TextEncoder` and `TextDecoder` are the WHATWG algorithms in Node and in every browser, and equal Node's `Buffer`
 * byte for byte (the same suite proves it), so the core encodes and decodes UTF-8 through these two functions and never through
 * `Buffer.from(text, "utf8")` or `buffer.toString("utf8")`; `browser/buffer-usage.test.ts` fails on a direct call.
 * @spec HOST-262
 */

const encoder = new TextEncoder();
// A byte-order mark is kept, as `buffer.toString("utf8")` keeps it: the callers decide what a BOM means.
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

/** The UTF-8 bytes of `text`, as a `Buffer` (a lone surrogate becomes U+FFFD, three bytes). Equal to `Buffer.from(text, "utf8")` on Node. */
export function utf8Bytes(text: string): Buffer {
  const bytes = encoder.encode(text);
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
}

/** The text of UTF-8 `bytes`, an invalid sequence replaced as the WHATWG decoder does. Equal to `Buffer.from(bytes).toString("utf8")` on Node. */
export function utf8Text(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
