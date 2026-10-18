/**
 * `Path.GetInvalidFileNameChars()` of .NET Framework on Windows: `"`, `<`, `>`, `|`, U+0000 to U+001F, `:`, `*`, `?`,
 * `\` and `/`. Only the membership matters.
 *
 * @spec EXP-418
 */
export const INVALID_FILE_NAME_CHARS: ReadonlySet<string> = new Set([
  '"',
  "<",
  ">",
  "|",
  ...Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)),
  ":",
  "*",
  "?",
  "\\",
  "/",
]);

/** True when the name has no character of {@link INVALID_FILE_NAME_CHARS}. An empty name has none either. */
export function hasOnlyValidFileNameChars(name: string): boolean {
  for (const unit of name) {
    if (INVALID_FILE_NAME_CHARS.has(unit)) return false;
  }
  return true;
}
