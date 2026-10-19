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

/**
 * `Path.Combine(params string[])`, which `IOWrapper.PathCombine` forwards to. Every element is checked for null and then for
 * illegal characters, in order. Empty elements are skipped, a rooted element restarts the path, and the others are joined with
 * one `\` unless the path so far ends in `\`, `/` or `:`.
 * @spec MAN-030 LP-031 LP-032
 */
export function pathCombineAll(...paths: (string | null)[]): string {
  let combined = "";
  for (const path of paths) {
    if (path === null) throw new ArgumentNullException("paths");
    checkInvalidPathChars(path);
    if (path.length === 0) continue;
    if (combined.length === 0 || isPathRooted(path)) {
      combined = path;
      continue;
    }
    const last = combined.charAt(combined.length - 1);
    combined += last === "\\" || last === "/" || last === ":" ? path : `\\${path}`;
  }
  return combined;
}

/** `Path.GetPathRoot`'s length for the forms the engine meets: `\\server\share`, `X:\`, `X:` and a leading `\`. */
function rootLength(path: string): number {
  const isSeparator = (index: number): boolean => path.charAt(index) === "\\";
  if (isSeparator(0)) {
    if (!isSeparator(1)) return 1;
    let at = 2;
    let boundaries = 2;
    while (at < path.length && (!isSeparator(at) || --boundaries > 0)) at += 1;
    return at;
  }
  if (path.charAt(1) === ":") return isSeparator(2) ? 3 : 2;
  return 0;
}

/**
 * The text `Path.GetDirectoryName` works on: `/` folded to `\`, repeated separators (after a leading UNC pair) collapsed, `.`
 * segments dropped, and a `..` segment cancelling the segment before it, or kept when there is none to cancel in a relative
 * path.
 */
function normalizeSeparators(path: string): string {
  const folded = path.replace(/\//g, "\\");
  const root = rootLength(folded);
  const rootText = folded.slice(0, root).replace(/\\+$/, "\\");
  const segments: string[] = [];
  for (const segment of folded.slice(root).split("\\")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
      else if (root === 0) segments.push(segment);
      continue;
    }
    segments.push(segment);
  }
  const trailing = folded.endsWith("\\") && segments.length > 0 ? "\\" : "";
  const joint = rootText.startsWith("\\\\") && !rootText.endsWith("\\") && segments.length > 0 ? "\\" : "";
  return rootText + joint + segments.join("\\") + trailing;
}

/**
 * `Path.GetDirectoryName`: the path up to its last separator, as .NET Framework 4.8 gives it after folding `/` to `\` and
 * resolving `.` and `..` segments (a path with no folder part gives the empty string). A null path gives null, and so does a
 * root. An empty path, or one of white space only, throws `ArgumentException`, and so does a path with an illegal character.
 * @spec LP-010 LP-020
 */
export function getDirectoryName(path: string | null): string | null {
  if (path === null) return null;
  checkInvalidPathChars(path);
  if (/^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/.test(path)) {
    throw new ArgumentException("The path is not of a legal form.");
  }
  const normalized = normalizeSeparators(path);
  const root = rootLength(normalized);
  if (normalized.length <= root) return null;
  let at = normalized.length;
  while (at > root && normalized.charAt(--at) !== "\\");
  return normalized.slice(0, at);
}
