import { ArgumentException, ArgumentNullException } from "./errors.js";

/**
 * `System.IO.Path` as .NET Framework implements it for Windows paths. The engine builds Windows path strings on every
 * platform (MAN-033), so these functions are pure string functions that do not look at the host.
 */

/** The characters `Path.CheckInvalidPathChars` refuses: the controls below U+0020 and `"`, `<`, `>`, `|`. */
function isInvalidPathChar(code: number): boolean {
  return code < 0x20 || code === 0x22 || code === 0x3c || code === 0x3e || code === 0x7c;
}

/** `Path.CheckInvalidPathChars`: throws `ArgumentException` for a path with an illegal character. */
export function checkInvalidPathChars(path: string): void {
  for (let i = 0; i < path.length; i += 1) {
    if (isInvalidPathChar(path.charCodeAt(i))) throw new ArgumentException("Illegal characters in path.");
  }
}

/**
 * `Path.IsPathRooted`: true when the path starts with `\` or `/`, or has `:` as its second character. It checks the
 * path for illegal characters first. A null path is not rooted.
 * @spec MAN-030
 */
export function isPathRooted(path: string | null): boolean {
  if (path === null) return false;
  checkInvalidPathChars(path);
  const first = path.charAt(0);
  return first === "\\" || first === "/" || path.charAt(1) === ":";
}

/**
 * `Path.Combine(path1, path2)`: both arguments are checked for null, then for illegal characters. An empty second path
 * gives the first; an empty first gives the second; a rooted second path is returned as it is; otherwise the two are
 * joined with one `\`, unless the first ends in `\`, `/` or `:`.
 * @spec MAN-030
 */
export function pathCombine(path1: string | null, path2: string | null): string {
  if (path1 === null || path2 === null) throw new ArgumentNullException(path1 === null ? "path1" : "path2");
  checkInvalidPathChars(path1);
  checkInvalidPathChars(path2);
  if (path2.length === 0) return path1;
  if (path1.length === 0) return path2;
  if (isPathRooted(path2)) return path2;
  const last = path1.charAt(path1.length - 1);
  return last === "\\" || last === "/" || last === ":" ? path1 + path2 : `${path1}\\${path2}`;
}
