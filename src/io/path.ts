/**
 * The path functions of the file layer, as pure string functions that run the same on every host. The engine's path strings
 * are Windows paths whatever the OS (MAN-033), so the `win32` rules are needed in a browser as much as on Node, and a browser
 * has no Node `path` module. Both flavours cover only the functions the core uses, and they are written from the documented
 * behaviour of Node's `path` module; `path.test.ts` compares every function with it over hand-written edge cases and a
 * generated corpus.
 *
 * Nothing here reads the process: where Node's `resolve` and `relative` consult `process.cwd()`, the functions here take
 * the current directory as their first argument ({@link PathFlavour.resolveFrom}, {@link PathFlavour.relativeFrom}).
 *
 * @spec HOST-202
 */

/** The result of {@link PathFlavour.parse}. */
export interface ParsedPath {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
}

/** One set of path rules: POSIX, or Windows (drives, UNC shares, `\` and `/`, case-insensitive comparison). */
export interface PathFlavour {
  readonly sep: "/" | "\\";
  /** Joins the non-empty segments with the separator, then normalises the result; `"."` when there is none. */
  join(...segments: string[]): string;
  /** The parent of a path: everything before its last segment, its root when there is no other, `"."` when it has none. */
  dirname(path: string): string;
  /** Folds separators, resolves `.` and `..` segments, keeps a trailing separator, keeps the root. */
  normalize(path: string): string;
  /** Splits a path into root, directory, base name, name and extension. */
  parse(path: string): ParsedPath;
  isAbsolute(path: string): boolean;
  /** The last segment of a path, without `suffix` when it ends with it (and is not the same as it). */
  basename(path: string, suffix?: string): string;
  /**
   * Node's `resolve` with the current directory given: the segments are resolved from right to left until an absolute path
   * is formed, and `cwd` stands in for `process.cwd()` when none is.
   */
  resolveFrom(cwd: string, ...segments: string[]): string;
  /** Node's `relative` with the current directory given: the path that leads from `from` to `to`. */
  relativeFrom(cwd: string, from: string, to: string): string;
}

/** The flavour a host platform's own file system follows: `win32` for `"win32"`, POSIX for any other name. */
export function flavourOf(platform: string): PathFlavour {
  return platform === "win32" ? win32 : posix;
}

const SLASH = 0x2f;
const BACKSLASH = 0x5c;
const DOT = 0x2e;
const COLON = 0x3a;

function isDriveLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/**
 * Resolves `.` and `..` in the segments of a path that has no root. A `..` removes the segment before it; with nothing to remove
 * it is kept when the path may rise above where it starts (a relative path), and dropped otherwise (an absolute one).
 */
function foldSegments(tail: string, isSeparator: (code: number) => boolean, rise: boolean, separator: string): string {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i <= tail.length; i += 1) {
    if (i < tail.length && !isSeparator(tail.charCodeAt(i))) continue;
    const segment = tail.slice(start, i);
    start = i + 1;
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (rise) out.push("..");
    } else out.push(segment);
  }
  return out.join(separator);
}

/** Where the last segment of a path lies, and where its extension starts. */
interface TailScan {
  /** The index at which the last segment starts: after the last separator that follows a name character, else `initialStart`. */
  startPart: number;
  /** The index after the last name character, -1 when there is none. */
  end: number;
  startDot: number;
  /** True when the segment has an extension: it has a dot that is not the whole of `.` or `..`. */
  dotted: boolean;
}

/** Scans a path backwards from its end down to `from`, for the segment that `parse` splits into name and extension. */
function scanTail(path: string, from: number, isSeparator: (code: number) => boolean, initialStart: number): TailScan {
  let startDot = -1;
  let startPart = initialStart;
  let end = -1;
  let inSeparators = true;
  // 0: no dot seen after the name's last character, 1: only the dot at `startDot`, -1: a dot and then other characters
  let dotState = 0;
  for (let i = path.length - 1; i >= from; i -= 1) {
    const code = path.charCodeAt(i);
    if (isSeparator(code)) {
      if (!inSeparators) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      inSeparators = false;
      end = i + 1;
    }
    if (code === DOT) {
      if (startDot === -1) startDot = i;
      else if (dotState !== 1) dotState = 1;
    } else if (startDot !== -1) dotState = -1;
  }
  const dotted = !(startDot === -1 || dotState === 0 || (dotState === 1 && startDot === end - 1 && startDot === startPart + 1));
  return { startPart, end, startDot, dotted };
}

/** The tail of `parse` for a path whose root ends at `rootEnd`. */
function parseTail(path: string, rootEnd: number, isSeparator: (code: number) => boolean): ParsedPath {
  const result: ParsedPath = { root: path.slice(0, rootEnd), dir: "", base: "", ext: "", name: "" };
  const { startPart, end, startDot, dotted } = scanTail(path, rootEnd, isSeparator, rootEnd);
  if (end !== -1) {
    result.base = path.slice(startPart, end);
    result.name = dotted ? path.slice(startPart, startDot) : result.base;
    result.ext = dotted ? path.slice(startDot, end) : "";
  }
  result.dir = startPart > 0 && startPart !== rootEnd ? path.slice(0, startPart - 1) : result.root;
  return result;
}

/**
 * `basename`. With a suffix that is not longer than the path, Node's rules are these: a path that is the suffix gives the empty
 * string; one made of separators only is returned as it is (after a drive), where without a suffix it gives the empty string; a
 * last segment that ends with the suffix, and is not the suffix, loses it; otherwise the segment comes without its trailing
 * separators, except that a segment that the suffix only partly matches from its end, because the suffix is longer, keeps them.
 */
function baseName(path: string, from: number, isSeparator: (code: number) => boolean, suffix: string | undefined): string {
  const withSuffix = suffix !== undefined && suffix.length > 0 && suffix.length <= path.length;
  if (withSuffix && suffix === path) return "";
  let end = path.length;
  while (end > from && isSeparator(path.charCodeAt(end - 1))) end -= 1;
  if (end === from) return withSuffix ? path.slice(from) : "";
  let start = end;
  while (start > from && !isSeparator(path.charCodeAt(start - 1))) start -= 1;
  const base = path.slice(start, end);
  if (!withSuffix || suffix === base) return base;
  if (base.endsWith(suffix)) return base.slice(0, base.length - suffix.length);
  return suffix.endsWith(base) ? path.slice(start) : base;
}

// ---------------------------------------------------------------------------------------------------------------------
// POSIX
// ---------------------------------------------------------------------------------------------------------------------

const isSlash = (code: number): boolean => code === SLASH;

function posixNormalize(path: string): string {
  if (path.length === 0) return ".";
  const absolute = path.charCodeAt(0) === SLASH;
  let tail = foldSegments(path, isSlash, !absolute, "/");
  if (tail.length === 0 && !absolute) tail = ".";
  if (tail.length > 0 && path.charCodeAt(path.length - 1) === SLASH) tail += "/";
  return absolute ? `/${tail}` : tail;
}

function posixResolve(cwd: string, segments: string[]): string {
  let tail = "";
  let absolute = false;
  for (let i = segments.length - 1; i >= 0 && !absolute; i -= 1) {
    const path = segments[i] as string;
    if (path.length === 0) continue;
    tail = `${path}/${tail}`;
    absolute = path.charCodeAt(0) === SLASH;
  }
  // the current directory is the last resort: it is where the segments start when none of them is absolute
  if (!absolute && cwd.length > 0) {
    tail = `${cwd}/${tail}`;
    absolute = cwd.charCodeAt(0) === SLASH;
  }
  const folded = foldSegments(tail, isSlash, !absolute, "/");
  if (absolute) return `/${folded}`;
  return folded.length > 0 ? folded : ".";
}

function posixRelative(cwd: string, from: string, to: string): string {
  if (from === to) return "";
  const fromFull = posixResolve(cwd, [from]);
  const toFull = posixResolve(cwd, [to]);
  if (fromFull === toFull) return "";
  const fromParts = fromFull.split("/").filter((part) => part.length > 0);
  const toParts = toFull.split("/").filter((part) => part.length > 0);
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common += 1;
  const up = fromParts.length - common;
  return [...Array.from({ length: up }, () => ".."), ...toParts.slice(common)].join("/");
}

/** `parse` of a POSIX path. Its name part starts at the beginning of the path unless a separator is found after a non-separator. */
function posixParse(path: string): ParsedPath {
  const result: ParsedPath = { root: "", dir: "", base: "", ext: "", name: "" };
  if (path.length === 0) return result;
  const rooted = path.charCodeAt(0) === SLASH;
  const start = rooted ? 1 : 0;
  if (rooted) result.root = "/";
  const parsed = scanTail(path, start, isSlash, 0);
  // the root is not part of the name even when no separator follows it
  const nameFrom = parsed.startPart === 0 ? start : parsed.startPart;
  if (parsed.end !== -1) {
    result.base = path.slice(nameFrom, parsed.end);
    result.name = parsed.dotted ? path.slice(nameFrom, parsed.startDot) : result.base;
    result.ext = parsed.dotted ? path.slice(parsed.startDot, parsed.end) : "";
  }
  if (parsed.startPart > 0) result.dir = path.slice(0, parsed.startPart - 1);
  else if (rooted) result.dir = "/";
  return result;
}

/** Node's `path.posix` for the functions the core uses. */
export const posix: PathFlavour = {
  sep: "/",
  join(...segments) {
    const joined = segments.filter((segment) => segment.length > 0).join("/");
    return joined.length === 0 ? "." : posixNormalize(joined);
  },
  dirname(path) {
    if (path.length === 0) return ".";
    const rooted = path.charCodeAt(0) === SLASH;
    let end = -1;
    let inSeparators = true;
    for (let i = path.length - 1; i >= 1; i -= 1) {
      if (path.charCodeAt(i) === SLASH) {
        if (!inSeparators) {
          end = i;
          break;
        }
      } else inSeparators = false;
    }
    if (end === -1) return rooted ? "/" : ".";
    if (rooted && end === 1) return "//";
    return path.slice(0, end);
  },
  normalize: posixNormalize,
  parse: posixParse,
  isAbsolute: (path) => path.length > 0 && path.charCodeAt(0) === SLASH,
  basename: (path, suffix) => baseName(path, 0, isSlash, suffix),
  resolveFrom: (cwd, ...segments) => posixResolve(cwd, segments),
  relativeFrom: posixRelative,
};

// ---------------------------------------------------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------------------------------------------------

const isSeparator = (code: number): boolean => code === SLASH || code === BACKSLASH;

/** The root of a Windows path: a drive (`C:`), a UNC share (`\\server\share`) or neither, and whether it is followed by a separator. */
interface Root {
  /** `C:` or `\\server\share`, empty for a path that has none. */
  device: string;
  /** True for a rooted path: `\x`, `C:\x`, `\\server\share`. */
  absolute: boolean;
  /** The index in the path at which the part after the root starts. */
  end: number;
}

/**
 * Reads the root of a Windows path. A UNC root needs a non-empty server and a non-empty share; `\\server` and `\\server\` are
 * not one, and read as a path that starts at the root `\` of the current drive. With `deviceRoots`, as in `normalize` and
 * `resolve`, a path that starts with `\\.\` or `\\?\` and has a name after it has the root `\\.` or `\\?` instead of a share: the name
 * after it is the first segment of the rest, which a `..` can remove.
 */
function readRoot(path: string, deviceRoots = false): Root {
  const first = path.charCodeAt(0);
  if (isSeparator(first)) {
    if (path.length > 1 && isSeparator(path.charCodeAt(1))) {
      let i = 2;
      const serverStart = i;
      while (i < path.length && !isSeparator(path.charCodeAt(i))) i += 1;
      if (i < path.length && i !== serverStart) {
        const server = path.slice(serverStart, i);
        while (i < path.length && isSeparator(path.charCodeAt(i))) i += 1;
        const shareStart = i;
        while (i < path.length && !isSeparator(path.charCodeAt(i))) i += 1;
        if (i !== shareStart) {
          if (deviceRoots && (server === "." || server === "?")) return { device: `\\\\${server}`, absolute: true, end: shareStart };
          return { device: `\\\\${server}\\${path.slice(shareStart, i)}`, absolute: true, end: i };
        }
      }
      return { device: "", absolute: true, end: 0 };
    }
    return { device: "", absolute: true, end: 1 };
  }
  if (isDriveLetter(first) && path.charCodeAt(1) === COLON) {
    const absolute = path.length > 2 && isSeparator(path.charCodeAt(2));
    return { device: path.slice(0, 2), absolute, end: absolute ? 3 : 2 };
  }
  return { device: "", absolute: false, end: 0 };
}

function win32Normalize(path: string): string {
  if (path.length === 0) return ".";
  // a path of one character is not looked at further: a lone `:` stays as it is although a longer path with a colon may change
  if (path.length === 1) return isSeparator(path.charCodeAt(0)) ? "\\" : path;
  const root = readRoot(path, true);
  let tail = root.end < path.length ? foldSegments(path.slice(root.end), isSeparator, !root.absolute, "\\") : "";
  if (tail.length === 0 && !root.absolute) tail = ".";
  if (tail.length > 0 && isSeparator(path.charCodeAt(path.length - 1))) tail += "\\";
  if (!root.absolute && root.device.length === 0 && path.includes(":") && colonCouldNameDrive(path, tail)) return `.\\${tail}`;
  return `${root.device}${root.absolute ? "\\" : ""}${tail}`;
}

/**
 * A relative path that has a colon must not come out of `normalize` as something Windows reads as a drive: `a\..\C:` would become
 * `C:`. The result is then prefixed with `.\` when it starts like a drive, or when the colon of the original ends a segment
 * or is followed by a separator.
 */
function colonCouldNameDrive(path: string, tail: string): boolean {
  if (tail.length >= 2 && isDriveLetter(tail.charCodeAt(0)) && tail.charCodeAt(1) === COLON) return true;
  for (let index = path.indexOf(":"); index !== -1; index = path.indexOf(":", index + 1)) {
    if (index === path.length - 1 || isSeparator(path.charCodeAt(index + 1))) return true;
  }
  return false;
}

function win32Resolve(cwd: string, segments: string[]): string {
  let device = "";
  let tail = "";
  let absolute = false;
  /** Takes one path into the result, from the right: its tail goes in front of what is there, and its root, when it has one, ends the search. */
  const take = (path: string): void => {
    const root = readRoot(path, true);
    if (root.device.length > 0 && device.length > 0 && root.device.toLowerCase() !== device.toLowerCase()) return;
    if (device.length === 0 && root.device.length > 0) device = root.device;
    if (!absolute) {
      tail = `${path.slice(root.end)}\\${tail}`;
      absolute = root.absolute;
    }
  };
  for (let i = segments.length - 1; i >= 0 && !(absolute && device.length > 0); i -= 1) {
    const path = segments[i] as string;
    if (path.length > 0) take(path);
  }
  if (!(absolute && device.length > 0)) {
    // the current directory fills in what the segments left open. When the segments name a drive that is not the current
    // directory's, the current directory of that drive is its root (Windows keeps one per drive in the `=C:` variables of
    // the process; they are not modelled here)
    let base = cwd;
    if (device.length > 0 && base.slice(0, 2).toLowerCase() !== device.toLowerCase() && base.charAt(2) === "\\") base = `${device}\\`;
    if (base.length > 0) take(base);
  }
  const folded = foldSegments(tail, isSeparator, !absolute, "\\");
  if (absolute) return `${device}\\${folded}`;
  return `${device}${folded}` || ".";
}

/** Node's `join` of Windows paths keeps a leading `\\` as a UNC root only where the first segment starts a UNC path. */
function win32Join(segments: string[]): string {
  const parts = segments.filter((segment) => segment.length > 0);
  if (parts.length === 0) return ".";
  const first = parts[0] as string;
  let joined = parts.join("\\");
  // `\\` + `server` would read as the UNC root `\\server` only when the first segment is itself `\\` or longer: when the
  // first segment is just one separator, or two with nothing after, the extra separators of the joint are not a UNC marker
  let needsFold = true;
  let leading = 0;
  if (isSeparator(first.charCodeAt(0))) {
    leading += 1;
    if (first.length > 1 && isSeparator(first.charCodeAt(1))) {
      leading += 1;
      if (first.length > 2) {
        if (isSeparator(first.charCodeAt(2))) leading += 1;
        else needsFold = false;
      }
    }
  }
  if (needsFold) {
    while (leading < joined.length && isSeparator(joined.charCodeAt(leading))) leading += 1;
    if (leading >= 2) joined = `\\${joined.slice(leading)}`;
  }
  return win32Normalize(joined);
}

function win32Dirname(path: string): string {
  if (path.length === 0) return ".";
  if (path.length === 1) return isSeparator(path.charCodeAt(0)) ? path : ".";
  const root = readRoot(path);
  let offset = 0;
  let rootEnd = -1;
  if (isSeparator(path.charCodeAt(0))) {
    offset = rootEnd = 1;
    if (root.device.length > 0) {
      // a UNC root: the whole path is the root when nothing follows the share
      if (root.end === path.length) return path;
      offset = rootEnd = root.end + 1;
    }
  } else if (root.device.length > 0) {
    offset = rootEnd = root.end;
  }
  let end = -1;
  let inSeparators = true;
  for (let i = path.length - 1; i >= offset; i -= 1) {
    if (isSeparator(path.charCodeAt(i))) {
      if (!inSeparators) {
        end = i;
        break;
      }
    } else inSeparators = false;
  }
  if (end === -1) {
    if (rootEnd === -1) return ".";
    end = rootEnd;
  }
  return path.slice(0, end);
}

function win32Parse(path: string): ParsedPath {
  const result: ParsedPath = { root: "", dir: "", base: "", ext: "", name: "" };
  if (path.length === 0) return result;
  if (path.length === 1) {
    if (isSeparator(path.charCodeAt(0))) result.root = result.dir = path;
    else result.base = result.name = path;
    return result;
  }
  let rootEnd = 0;
  const root = readRoot(path);
  if (isSeparator(path.charCodeAt(0))) {
    rootEnd = 1;
    if (root.device.length > 0) rootEnd = root.end === path.length ? root.end : root.end + 1;
  } else if (root.device.length > 0) {
    if (path.length <= 2) {
      result.root = result.dir = path;
      return result;
    }
    rootEnd = 2;
    if (isSeparator(path.charCodeAt(2))) {
      if (path.length === 3) {
        result.root = result.dir = path;
        return result;
      }
      rootEnd = 3;
    }
  }
  return parseTail(path, rootEnd, isSeparator);
}

function win32Relative(cwd: string, from: string, to: string): string {
  if (from === to) return "";
  const fromFull = win32Resolve(cwd, [from]);
  const toFull = win32Resolve(cwd, [to]);
  if (fromFull === toFull) return "";
  const fromLower = fromFull.toLowerCase();
  const toLower = toFull.toLowerCase();
  if (fromLower === toLower) return "";
  let fromStart = 0;
  while (fromStart < fromFull.length && fromFull.charCodeAt(fromStart) === BACKSLASH) fromStart += 1;
  let fromEnd = fromFull.length;
  while (fromEnd - 1 > fromStart && fromFull.charCodeAt(fromEnd - 1) === BACKSLASH) fromEnd -= 1;
  let toStart = 0;
  while (toStart < toFull.length && toFull.charCodeAt(toStart) === BACKSLASH) toStart += 1;
  let toEnd = toFull.length;
  while (toEnd - 1 > toStart && toFull.charCodeAt(toEnd - 1) === BACKSLASH) toEnd -= 1;
  const fromLength = fromEnd - fromStart;
  const toLength = toEnd - toStart;
  const length = Math.min(fromLength, toLength);
  let lastCommonSeparator = -1;
  let i = 0;
  for (; i < length; i += 1) {
    const code = fromLower.charCodeAt(fromStart + i);
    if (code !== toLower.charCodeAt(toStart + i)) break;
    if (code === BACKSLASH) lastCommonSeparator = i;
  }
  if (i !== length) {
    if (lastCommonSeparator === -1) return toFull;
  } else {
    if (toLength > length) {
      if (toLower.charCodeAt(toStart + i) === BACKSLASH) return toFull.slice(toStart + i + 1);
      if (i === 2) return toFull.slice(toStart + i);
    }
    if (fromLength > length) {
      if (fromLower.charCodeAt(fromStart + i) === BACKSLASH) lastCommonSeparator = i;
      else if (i === 2) lastCommonSeparator = 3;
    }
    if (lastCommonSeparator === -1) lastCommonSeparator = 0;
  }
  let out = "";
  for (let k = fromStart + lastCommonSeparator + 1; k <= fromEnd; k += 1) {
    if (k === fromEnd || fromFull.charCodeAt(k) === BACKSLASH) out += out.length === 0 ? ".." : "\\..";
  }
  toStart += lastCommonSeparator;
  if (out.length > 0) return `${out}${toFull.slice(toStart, toEnd)}`;
  if (toFull.charCodeAt(toStart) === BACKSLASH) toStart += 1;
  return toFull.slice(toStart, toEnd);
}

/** Node's `path.win32` for the functions the core uses. */
export const win32: PathFlavour = {
  sep: "\\",
  join: (...segments) => win32Join(segments),
  dirname: win32Dirname,
  normalize: win32Normalize,
  parse: win32Parse,
  isAbsolute(path) {
    if (path.length === 0) return false;
    if (isSeparator(path.charCodeAt(0))) return true;
    return path.length > 2 && isDriveLetter(path.charCodeAt(0)) && path.charCodeAt(1) === COLON && isSeparator(path.charCodeAt(2));
  },
  basename(path, suffix) {
    const from = path.length >= 2 && isDriveLetter(path.charCodeAt(0)) && path.charCodeAt(1) === COLON ? 2 : 0;
    return baseName(path, from, isSeparator, suffix);
  },
  resolveFrom: (cwd, ...segments) => win32Resolve(cwd, segments),
  relativeFrom: win32Relative,
};
