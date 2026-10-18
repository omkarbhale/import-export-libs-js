import { HTML_ENTITIES } from "./html-entities.js";

/**
 * `System.Net.WebUtility.HtmlEncode` and `HtmlDecode` of .NET Framework 4.8, byte for byte.
 *
 * @spec EXP-120 EXP-406
 */

/**
 * Encodes `"`, `&`, `'`, `<` and `>` as entities and U+00A0 to U+00FF as decimal references. Everything else
 * stays as it is: control characters, U+0100 and above, surrogates (paired or not) and U+FFFD.
 */
export function htmlEncode(value: string): string {
  let result = "";
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    switch (unit) {
      case 0x22:
        result += "&quot;";
        break;
      case 0x26:
        result += "&amp;";
        break;
      case 0x27:
        result += "&#39;";
        break;
      case 0x3c:
        result += "&lt;";
        break;
      case 0x3e:
        result += "&gt;";
        break;
      default:
        result += unit >= 0xa0 && unit <= 0xff ? `&#${unit};` : value.charAt(i);
    }
  }
  return result;
}

const NUMBER_WHITE_SPACE = "\t\n\u000b\f\r ";

/** `uint.TryParse` with `NumberStyles.Integer` (white space and a leading sign) or `AllowHexSpecifier`. */
function parseReference(text: string, hex: boolean): number | null {
  if (hex) return /^[0-9a-fA-F]+$/.test(text) ? Number.parseInt(text, 16) : null;
  let start = 0;
  let end = text.length;
  while (start < end && NUMBER_WHITE_SPACE.includes(text.charAt(start))) start += 1;
  while (end > start && NUMBER_WHITE_SPACE.includes(text.charAt(end - 1))) end -= 1;
  const digits = /^[+]?([0-9]+)$/.exec(text.slice(start, end));
  if (!digits) return /^-0+$/.test(text.slice(start, end)) ? 0 : null;
  const value = Number.parseInt(digits[1] ?? "", 10);
  return value <= 0xffffffff ? value : null;
}

/**
 * Decodes the HTML 4 entity names (case-sensitive, plus `apos`) and numeric references up to U+FFFF, once. A
 * reference needs its closing `;`. Everything it does not recognise stays as written: unknown names, `&#0;`, values
 * above U+FFFF and a missing `;`.
 */
export function htmlDecode(value: string): string {
  if (!value.includes("&")) return value;
  let result = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charAt(i);
    if (ch !== "&") {
      result += ch;
      continue;
    }
    // the reference ends at the next ';'; another '&' first means this one starts nothing
    let end = i + 1;
    while (end < value.length && value[end] !== ";" && value[end] !== "&") end += 1;
    if (end >= value.length || value[end] !== ";") {
      result += ch;
      continue;
    }
    const entity = value.slice(i + 1, end);
    if (entity.length > 1 && entity.startsWith("#")) {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = parseReference(entity.slice(hex ? 2 : 1), hex);
      if (code !== null && code > 0 && code <= 0xffff) {
        result += String.fromCharCode(code);
        i = end;
      } else {
        result += ch;
      }
      continue;
    }
    result += HTML_ENTITIES.get(entity) ?? `&${entity};`;
    i = end;
  }
  return result;
}
