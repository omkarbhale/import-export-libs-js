/** Character classes of the XML 1.0 (fourth edition) grammar, as `XmlTextReader` applies them. */

export const XMLNS_NS = "http://www.w3.org/2000/xmlns/";
export const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** XML white space: space, tab, CR, LF. */
export function isXmlWhitespace(unit: number): boolean {
  return unit === 0x20 || unit === 0x09 || unit === 0x0a || unit === 0x0d;
}

/** A code point XML allows in a document (Char production). */
export function isXmlChar(codePoint: number): boolean {
  return (
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0d ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

/** Raw characters `XmlTextReader` rejects in text, attribute values, comments and CDATA. */
export const INVALID_XML_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

// The fourth edition's Letter classes follow Unicode 2.0. Unicode letter categories are the closest property
// available to a regular expression. Real item and package names are ASCII identifiers.
const NAME_START = /^[\p{L}\p{Nl}_]$/u;
const NAME_CHAR = /^[\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Me}._\-·ːˑ·ـๆໆ々〱-〵ゝゞー-ヾ]$/u;

/** A character that can start an NCName. Characters outside the Basic Multilingual Plane never can. */
export function isNameStartChar(character: string): boolean {
  return character.length === 1 && NAME_START.test(character);
}

/** A character that can continue an NCName. */
export function isNameChar(character: string): boolean {
  return character.length === 1 && NAME_CHAR.test(character);
}

/** The UTF-16 length of the code point that starts at `index`. */
export function codePointAt(text: string, index: number): { character: string; codePoint: number } {
  const codePoint = text.codePointAt(index) ?? 0;
  return { character: String.fromCodePoint(codePoint), codePoint };
}

/** `0x` and at least two upper-case hexadecimal digits, as .NET formats a character in a message. */
export function hexValue(codePoint: number): string {
  return `0x${codePoint.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** A character as .NET shows it in a message: NUL appears as a full stop. */
export function displayCharacter(character: string): string {
  return character === "\u0000" ? "." : character;
}
