/**
 * The few .NET string behaviours the manifest and path rules depend on.
 */

/** `Char.IsWhiteSpace` for a UTF-16 code unit: the set `String.Trim` removes (MAN-012). */
export function isWhiteSpace(code: number): boolean {
  return (
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

/** True for null, the empty string and a string of white space only: `String.IsNullOrWhiteSpace`. */
export function isNullOrWhiteSpace(text: string | null | undefined): boolean {
  if (text === null || text === undefined) return true;
  for (let i = 0; i < text.length; i += 1) if (!isWhiteSpace(text.charCodeAt(i))) return false;
  return true;
}

/**
 * `string.Format` with the invariant culture, for the `{0}` placeholders of the engine's message templates. A null
 * argument formats as the empty string.
 */
export function formatMessage(template: string, ...args: (string | null | undefined)[]): string {
  return template.replace(/\{(\d+)\}/g, (_, index: string) => args[Number(index)] ?? "");
}
