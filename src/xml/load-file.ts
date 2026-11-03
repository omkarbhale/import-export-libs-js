import { readFileBytes } from "../io/host-path.js";
import type { PathEnvironment } from "../io/host-path.js";
import { utf8Text } from "../io/utf8.js";
import type { XmlDocument } from "./dom.js";
import { XmlException } from "./errors.js";
import { loadXml } from "./parser.js";
import { readAllText } from "./read-text.js";

/**
 * `XmlDocument.Load(path)` as the 12.0 engine reads a file (MAN-003, IMP-007): the XML reader opens the file and decodes it
 * itself, where 14.0.7 reads the text first and calls `LoadXml`. The reader
 *
 * - picks its first encoding from the bytes: a UTF-8, UTF-16 or UTF-32 byte-order mark, a UTF-16 or UTF-32 file that begins with
 *   `<` and has none, and UTF-8 otherwise;
 * - switches to the encoding the XML declaration names, and refuses a name the framework does not know
 *   (`System does not support '…' encoding. Line 1, position …`) and `utf-16` or `utf-32` over bytes without a Unicode mark
 *   (`There is no Unicode byte order mark. Cannot switch to Unicode.`);
 * - throws `Invalid character in the given encoding. Line …, position …` for a byte sequence the UTF-8 or UTF-16 decoder
 *   cannot read, where 14.0.7 gives U+FFFD.
 *
 * The parse itself is {@link loadXml}'s, with white space dropped.
 *
 * @spec IMP-007 MAN-003
 */

type Unicode = "utf-8" | "utf-16le" | "utf-16be" | "utf-32le" | "utf-32be";

interface Detected {
  encoding: Unicode;
  /** Bytes of the byte-order mark. */
  skip: number;
}

const NOT_UNICODE = "There is no Unicode byte order mark. Cannot switch to Unicode.";

/** The reader's first choice of encoding (`XmlTextReaderImpl.DetectEncoding`). */
function detect(bytes: Uint8Array): Detected {
  const at = (index: number): number => (index < bytes.length ? (bytes[index] as number) : -1);
  const [b0, b1, b2, b3] = [at(0), at(1), at(2), at(3)];
  if (bytes.length >= 2) {
    if (b0 === 0xfe && b1 === 0xff) return { encoding: "utf-16be", skip: 2 };
    if (b0 === 0xff && b1 === 0xfe) {
      return b2 === 0 && b3 === 0 && bytes.length >= 4 ? { encoding: "utf-32le", skip: 4 } : { encoding: "utf-16le", skip: 2 };
    }
    if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) return { encoding: "utf-8", skip: 3 };
    if (b0 === 0 && b1 === 0) {
      if (b2 === 0xfe && b3 === 0xff) return { encoding: "utf-32be", skip: 4 };
      if (b2 === 0 && b3 === 0x3c) return { encoding: "utf-32be", skip: 0 };
    }
    if (b0 === 0x3c && b1 === 0) return b2 === 0 && b3 === 0 ? { encoding: "utf-32le", skip: 0 } : { encoding: "utf-16le", skip: 0 };
    if (b0 === 0 && b1 === 0x3c) return { encoding: "utf-16be", skip: 0 };
  }
  return { encoding: "utf-8", skip: 0 };
}

/** The line and the column (both from 1, in UTF-16 units) of the character that follows `prefix`. */
function positionAfter(prefix: string): [line: number, position: number] {
  let line = 1;
  let last = -1;
  for (let i = 0; i < prefix.length; i += 1) {
    if (prefix.charCodeAt(i) === 0x0a) {
      line += 1;
      last = i;
    }
  }
  return [line, prefix.length - last];
}

function invalidCharacter(prefix: string): XmlException {
  const [line, position] = positionAfter(prefix);
  return new XmlException("Invalid character in the given encoding.", line, position);
}

/** A strict UTF-8 decoder: the text before the first byte sequence .NET's strict `UTF8Encoding` refuses throws. */
function decodeUtf8Strict(bytes: Uint8Array, start: number): string {
  const text: string[] = [];
  let length = 0;
  let i = start;
  const fail = (): never => {
    throw invalidCharacter(text.join(""));
  };
  while (i < bytes.length) {
    const lead = bytes[i] as number;
    if (lead < 0x80) {
      text.push(String.fromCharCode(lead));
      length += 1;
      i += 1;
      continue;
    }
    if (lead < 0xc2 || lead > 0xf4) fail();
    const size = lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;
    if (i + size > bytes.length) fail();
    let lowest = 0x80;
    let highest = 0xbf;
    if (lead === 0xe0) lowest = 0xa0;
    else if (lead === 0xed) highest = 0x9f;
    else if (lead === 0xf0) lowest = 0x90;
    else if (lead === 0xf4) highest = 0x8f;
    const second = bytes[i + 1] as number;
    if (second < lowest || second > highest) fail();
    for (let k = 2; k < size; k += 1) {
      const continuation = bytes[i + k] as number;
      if (continuation < 0x80 || continuation > 0xbf) fail();
    }
    const decoded = utf8Text(bytes.subarray(i, i + size));
    text.push(decoded);
    length += decoded.length;
    i += size;
  }
  return text.join("");
}

function decodeUtf16Strict(bytes: Uint8Array, start: number, bigEndian: boolean): string {
  const units: string[] = [];
  for (let i = start; i + 1 < bytes.length; i += 2) {
    const first = bytes[i] as number;
    const second = bytes[i + 1] as number;
    units.push(String.fromCharCode(bigEndian ? (first << 8) | second : (second << 8) | first));
  }
  const text: string[] = [];
  for (let k = 0; k < units.length; k += 1) {
    const unit = (units[k] as string).charCodeAt(0);
    const prefix = (): string => text.join("");
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = k + 1 < units.length ? (units[k + 1] as string).charCodeAt(0) : -1;
      if (next < 0xdc00 || next > 0xdfff) throw invalidCharacter(prefix());
      text.push(units[k] as string, units[k + 1] as string);
      k += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw invalidCharacter(prefix());
    } else {
      text.push(units[k] as string);
    }
  }
  return text.join("");
}

function decodeUtf32Strict(bytes: Uint8Array, start: number, bigEndian: boolean): string {
  const text: string[] = [];
  for (let i = start; i + 3 < bytes.length; i += 4) {
    const b = [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]] as number[];
    const value = bigEndian
      ? (b[0] as number) * 0x1000000 + ((b[1] as number) << 16) + ((b[2] as number) << 8) + (b[3] as number)
      : (b[3] as number) * 0x1000000 + ((b[2] as number) << 16) + ((b[1] as number) << 8) + (b[0] as number);
    if (value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) throw invalidCharacter(text.join(""));
    text.push(String.fromCodePoint(value));
  }
  return text.join("");
}

function decodeUnicode(bytes: Uint8Array, detected: Detected): string {
  switch (detected.encoding) {
    case "utf-8":
      return decodeUtf8Strict(bytes, detected.skip);
    case "utf-16le":
      return decodeUtf16Strict(bytes, detected.skip, false);
    case "utf-16be":
      return decodeUtf16Strict(bytes, detected.skip, true);
    case "utf-32le":
      return decodeUtf32Strict(bytes, detected.skip, false);
    case "utf-32be":
      return decodeUtf32Strict(bytes, detected.skip, true);
  }
}

/** The encoding the declaration names and where its name starts (a 1-based column), when the text opens with a declaration. */
function declaredEncoding(head: string): { name: string; position: number } | undefined {
  const match = /^<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*("[^"]*"|'[^']*')[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(["'])([^"']*)\2/.exec(head);
  if (!match) return undefined;
  const name = match[3] as string;
  return { name, position: match[0].length - name.length };
}

const LATIN1 = new Set(["iso-8859-1", "iso_8859-1", "latin1", "l1", "ibm819", "cp819", "iso8859-1", "iso-ir-100", "csisolatin1"]);
const ASCII = new Set(["us-ascii", "ascii", "ansi_x3.4-1968", "iso646-us", "us", "cp367", "ibm367", "csascii", "iso-ir-6"]);
const UTF8_ALIASES = new Set(["utf8", "unicode-1-1-utf-8", "unicode-2-0-utf-8", "x-unicode11utf8", "x-unicode20utf8"]);
const WIDE = new Map<string, Unicode>([
  ["ucs-2", "utf-16le"],
  ["utf-16", "utf-16le"],
  ["iso-10646-ucs-2", "utf-16le"],
  ["ucs-4", "utf-32le"],
  ["utf-32", "utf-32le"],
  ["iso-10646-ucs-4", "utf-32le"],
]);

/** Decodes the bytes after the declaration named `name` (not utf-8, not a wide name): the framework's encoding of that name. */
function decodeNamed(bytes: Uint8Array, start: number, name: string): string | undefined {
  if (LATIN1.has(name)) return Buffer.from(bytes.subarray(start)).toString("latin1");
  if (ASCII.has(name)) {
    return Array.from(bytes.subarray(start), (byte) => (byte < 0x80 ? String.fromCharCode(byte) : "?")).join("");
  }
  if (UTF8_ALIASES.has(name)) return readAllText(bytes.subarray(start));
  try {
    return new TextDecoder(name).decode(bytes.subarray(start));
  } catch {
    return undefined;
  }
}

/**
 * The text of an XML file as the reader of `XmlDocument.Load(path)` decodes it. An XML declaration that names another encoding
 * than the one the bytes were detected as switches to it; the bytes before the declaration are plain ASCII in every encoding
 * the reader accepts here, so the whole file is decoded in the final encoding.
 */
export function decodeXmlFile(bytes: Uint8Array): string {
  const detected = detect(bytes);
  // the declaration, read in the first encoding (a lenient look at the first bytes: the declaration is short)
  const head = ((): string => {
    const lead = bytes.subarray(0, detected.skip + 2000);
    try {
      return decodeUnicode(lead, detected);
    } catch {
      return detected.encoding === "utf-8" ? Buffer.from(lead.subarray(detected.skip)).toString("latin1") : "";
    }
  })();
  const declared = declaredEncoding(head);
  if (declared === undefined) return decodeUnicode(bytes, detected);
  const name = declared.name.toLowerCase();

  const wide = WIDE.get(name);
  if (wide !== undefined) {
    if (detected.encoding === "utf-8") throw new XmlException(NOT_UNICODE);
    return decodeUnicode(bytes, detected);
  }
  if (name === "utf-8") return detected.encoding === "utf-8" ? decodeUnicode(bytes, detected) : decodeUtf8Strict(bytes, 0);
  const text = decodeNamed(bytes, detected.skip, name);
  if (text === undefined) throw new XmlException(`System does not support '${declared.name}' encoding.`, 1, declared.position);
  return text;
}

/** `XmlDocument.Load(path)`: the file after the path rules (none for 12.0, MAN-004), decoded by the reader, parsed with white space dropped. */
export function xmlDocumentLoadFile(path: string | null, environment: PathEnvironment = {}): XmlDocument {
  return loadXml(decodeXmlFile(readFileBytes(path, environment)), { preserveWhitespace: false });
}
