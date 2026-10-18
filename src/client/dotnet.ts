/**
 * The few .NET behaviours the client reproduces: an exception that carries its
 * full type name, which IOM writes into the faults it makes (WIRE-050), and
 * `int.Parse` / `int.TryParse` with the invariant culture and
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
