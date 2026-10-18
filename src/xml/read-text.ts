import { readFileBytes } from "../io/host-path.js";
import type { PathEnvironment } from "../io/host-path.js";
import { loadXml } from "./parser.js";
import type { XmlDocument } from "./dom.js";

/**
 * `File.ReadAllText(path)` as .NET Framework 4.8 does it: the encoding is picked from a byte-order mark and is UTF-8
 * without one, and a byte sequence the encoding cannot decode becomes U+FFFD instead of an error. The `encoding`
 * of an XML declaration is never looked at.
 *
 * @spec IMP-007 MAN-003
 */
export function readAllText(bytes: Uint8Array): string {
  const length = bytes.length;
  const at = (index: number): number => bytes[index] ?? -1;
  if (length >= 2 && at(0) === 0xfe && at(1) === 0xff) return decodeUtf16(bytes, 2, true);
  if (length >= 2 && at(0) === 0xff && at(1) === 0xfe) {
    if (length >= 4 && at(2) === 0 && at(3) === 0) return decodeUtf32(bytes, 4, false);
    return decodeUtf16(bytes, 2, false);
  }
  if (length >= 3 && at(0) === 0xef && at(1) === 0xbb && at(2) === 0xbf) return decodeUtf8(bytes, 3);
  if (length >= 4 && at(0) === 0 && at(1) === 0 && at(2) === 0xfe && at(3) === 0xff) return decodeUtf32(bytes, 4, true);
  return decodeUtf8(bytes, 0);
}

const REPLACEMENT = "�";

function isContinuation(byte: number): boolean {
  return byte >= 0x80 && byte <= 0xbf;
}

/**
 * The UTF-8 decoder of .NET Framework. An invalid byte becomes one U+FFFD, and so does a valid prefix that stops
 * short (up to three bytes). A lead byte whose second byte is a continuation byte that its range forbids
 * (E0 80, ED A0, F0 80, F4 90) is replaced together with that byte, which Node's decoder does not do.
 */
function decodeUtf8(bytes: Uint8Array, start: number): string {
  const parts: string[] = [];
  let ascii = start;
  const flush = (end: number) => {
    if (end > ascii) parts.push(Buffer.from(bytes.subarray(ascii, end)).toString("latin1"));
  };
  const length = bytes.length;
  let i = start;
  while (i < length) {
    const lead = bytes[i] as number;
    if (lead < 0x80) {
      i += 1;
      continue;
    }
    flush(i);
    let consumed: number;
    let text: string;
    if (lead < 0xc2 || lead > 0xf4) {
      consumed = 1;
      text = REPLACEMENT;
    } else {
      const size = lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;
      const second = i + 1 < length ? (bytes[i + 1] as number) : -1;
      let lowest = 0x80;
      let highest = 0xbf;
      if (lead === 0xe0) lowest = 0xa0;
      else if (lead === 0xed) highest = 0x9f;
      else if (lead === 0xf0) lowest = 0x90;
      else if (lead === 0xf4) highest = 0x8f;
      if (second < 0) {
        // a lead byte at the very end: the decoder never completes it, and StreamReader drops it
        consumed = 1;
        text = "";
      } else if (!isContinuation(second)) {
        consumed = 1;
        text = REPLACEMENT;
      } else if (second < lowest || second > highest) {
        consumed = 2;
        text = REPLACEMENT;
      } else {
        let valid = 2;
        while (valid < size && i + valid < length && isContinuation(bytes[i + valid] as number)) valid += 1;
        if (valid < size) {
          consumed = valid;
          text = i + valid >= length ? "" : REPLACEMENT;
        } else {
          consumed = size;
          text = Buffer.from(bytes.subarray(i, i + size)).toString("utf8");
        }
      }
    }
    parts.push(text);
    i += consumed;
    ascii = i;
  }
  flush(length);
  return parts.join("");
}

function decodeUtf16(bytes: Uint8Array, start: number, bigEndian: boolean): string {
  const units: number[] = [];
  let i = start;
  for (; i + 1 < bytes.length; i += 2) {
    const first = bytes[i] as number;
    const second = bytes[i + 1] as number;
    units.push(bigEndian ? (first << 8) | second : (second << 8) | first);
  }
  let text = "";
  for (let k = 0; k < units.length; k += 1) {
    const unit = units[k] as number;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (k + 1 >= units.length) break;
      const next = units[k + 1] as number;
      if (next >= 0xdc00 && next <= 0xdfff) {
        text += String.fromCharCode(unit, next);
        k += 1;
      } else text += REPLACEMENT;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) text += REPLACEMENT;
    else text += String.fromCharCode(unit);
  }
  return text;
}

function decodeUtf32(bytes: Uint8Array, start: number, bigEndian: boolean): string {
  let text = "";
  let i = start;
  for (; i + 3 < bytes.length; i += 4) {
    const b = [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]] as number[];
    const value = bigEndian
      ? ((b[0] as number) * 0x1000000) + ((b[1] as number) << 16) + ((b[2] as number) << 8) + (b[3] as number)
      : ((b[3] as number) * 0x1000000) + ((b[2] as number) << 16) + ((b[1] as number) << 8) + (b[0] as number);
    text += value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff) ? REPLACEMENT : String.fromCodePoint(value);
  }
  return text;
}

/**
 * `IOWrapper.XmlDocumentLoad(path)`: the path goes through the engine's path rules (MAN-004, MAN-033), the file is read
 * with {@link readAllText}, and the text is loaded into a new document that drops white space. A missing file, folder
 * or illegal path fails with the exceptions of .NET (MAN-003).
 * @spec IMP-007 IMP-016 IMP-017 IMP-018 LP-010 LP-022 MAN-003 MAN-004
 */
export function xmlDocumentLoad(path: string | null, environment: PathEnvironment = {}): XmlDocument {
  return loadXml(readAllText(readFileBytes(path, environment)), { preserveWhitespace: false });
}
