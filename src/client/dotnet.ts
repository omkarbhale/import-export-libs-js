import { XPathException, XmlException } from "../xml/errors.js";

/**
 * The few .NET behaviours the client reproduces: an exception that carries its
 * full type name, which IOM writes into the faults it makes (WIRE-050), the
 * exception types the engine catches by name (EXP-054), `string.IsNullOrWhiteSpace`,
 * and `int.Parse` / `int.TryParse` with the invariant culture and
 * `NumberStyles.Integer` (WIRE-021).
 */

/** A .NET exception, named by its full type name. */
export class DotNetException extends Error {
  constructor(
    readonly typeName: string,
    message: string,
  ) {
    super(message);
    this.name = typeName;
  }

  /** `<type full name>: <message>`, the faultstring IOM writes for an exception. */
  get faultString(): string {
    return `${this.typeName}: ${this.message}`;
  }
}

/** `System.Xml.XmlException`, whether it came from the client's parser or from the XML core. */
export function isXmlException(error: unknown): error is Error {
  return error instanceof XmlException || (error instanceof DotNetException && error.typeName === "System.Xml.XmlException");
}

/** `System.Xml.XPath.XPathException`. */
export function isXPathException(error: unknown): error is Error {
  return error instanceof XPathException || (error instanceof DotNetException && error.typeName === "System.Xml.XPath.XPathException");
}

/** `System.NullReferenceException`. */
export function isNullReference(error: unknown): error is Error {
  return error instanceof DotNetException && error.typeName === "System.NullReferenceException";
}

/** The exception .NET throws for a member used on a null reference. */
export function nullReference(): DotNetException {
  return new DotNetException("System.NullReferenceException", "Object reference not set to an instance of an object.");
}

const WHITE_SPACE = /^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;

/** `string.IsNullOrWhiteSpace`: .NET's `Char.IsWhiteSpace` set, which is not JavaScript's `\s`. */
export function isNullOrWhiteSpace(text: string | null | undefined): boolean {
  return text === null || text === undefined || WHITE_SPACE.test(text);
}

const WHITE_SPACE_CHARACTER = /[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;

/** `string.Trim()`: removes .NET's white space from both ends (JavaScript's `trim` also removes U+FEFF and leaves U+0085). */
export function trimWhiteSpace(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && WHITE_SPACE_CHARACTER.test(text.charAt(start))) start += 1;
  while (end > start && WHITE_SPACE_CHARACTER.test(text.charAt(end - 1))) end -= 1;
  return text.slice(start, end);
}

const INT32_FORMAT = /^[\t\n\v\f\r ]*([+-]?)([0-9]+)[\t\n\v\f\r ]*$/;

/** `int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out value)`; undefined when it fails. */
export function tryParseInt32(text: string | null | undefined): number | undefined {
  if (text === null || text === undefined) return undefined;
  const match = INT32_FORMAT.exec(text);
  if (!match) return undefined;
  const value = Number(`${match[1] ?? ""}${match[2] ?? ""}`);
  return Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647 ? value : undefined;
}

/** `int.Parse(text, CultureInfo.InvariantCulture)`, with the exceptions .NET Framework throws. */
export function parseInt32(text: string | null | undefined): number {
  if (text === null || text === undefined) {
    throw new DotNetException("System.ArgumentNullException", "Value cannot be null.\r\nParameter name: String");
  }
  const match = INT32_FORMAT.exec(text);
  if (!match) throw new DotNetException("System.FormatException", "Input string was not in a correct format.");
  const value = tryParseInt32(text);
  if (value === undefined) {
    throw new DotNetException("System.OverflowException", "Value was either too large or too small for an Int32.");
  }
  return value;
}
