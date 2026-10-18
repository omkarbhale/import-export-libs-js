import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, win32 } from "node:path";
import { isWhiteSpace } from "./dotnet-text.js";
import {
  ArgumentException,
  ArgumentNullException,
  DirectoryNotFoundException,
  FileNotFoundException,
  NotSupportedException,
  PathNotUsableError,
  UnauthorizedAccessException,
} from "./errors.js";

/**
 * The file layer: the one place where the Windows path strings the engine builds (MAN-033) meet the host's file
 * system. On Windows a path goes through the engine's `NormalizeLongPath` (MAN-004); elsewhere it becomes a POSIX path.
 */

/** What the layer needs to know about the host. Tests give both, to follow the Windows rules on another platform. */
export interface PathEnvironment {
  /** The host platform; the default is `process.platform`. */
  platform?: NodeJS.Platform;
  /** The current directory, a Windows path when the platform is `win32`; the default is `process.cwd()`. */
  cwd?: string;
}

/** The full path at which `NormalizeLongPath` switches to the `\\?\` form. */
const LONG_PATH_LIMIT = 255;

/**
 * `IOWrapper.NormalizeLongPath`. A null or empty path is returned as it is. Otherwise every leading `\` and `?` is
 * removed (bug MAN-005: a UNC or drive-less path becomes relative), the full path of the rest is computed, which throws
 * as `Path.GetFullPath` does, and the result is `\\?\` followed by the full path when that is 255 characters or longer,
 * and the trimmed path otherwise.
 * @spec MAN-004 MAN-005
 */
export function normalizeLongPath(path: string | null, environment: PathEnvironment = {}): string | null {
  if (path === null || path.length === 0) return path;
  let start = 0;
  while (start < path.length && (path.charAt(start) === "\\" || path.charAt(start) === "?")) start += 1;
  const trimmed = path.slice(start);
  const full = getFullPath(trimmed, environment.cwd ?? process.cwd());
  return full.length >= LONG_PATH_LIMIT ? `\\\\?\\${full}` : trimmed;
}

/**
 * `Path.GetFullPath` against the current directory, with .NET Framework's validation: a path of white space only is
 * not of a legal form, a control character or `"`, `<`, `>`, `|`, `?`, `*` is illegal, and `:` is allowed only as
 * the second character after a drive letter. Separators are folded to `\`, `.` and `..` segments are resolved, and
 * trailing dots (and trailing spaces of the whole path) are dropped.
 */
function getFullPath(path: string, cwd: string): string {
  let blank = true;
  for (let i = 0; i < path.length && blank; i += 1) blank = isWhiteSpace(path.charCodeAt(i));
  if (blank) throw new ArgumentException("The path is not of a legal form.");
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x22 || code === 0x3c || code === 0x3e || code === 0x7c || code === 0x3f || code === 0x2a) {
      throw new ArgumentException("Illegal characters in path.");
    }
  }
  const colon = path.indexOf(":");
  if (colon >= 0 && !(colon === 1 && /^[A-Za-z]$/.test(path.charAt(0)) && path.indexOf(":", 2) < 0)) {
    throw new NotSupportedException("The given path's format is not supported.");
  }
  let input = path;
  const drive = /^([A-Za-z]):(?![\\/])/.exec(path);
  if (drive) {
    // `X:rest` is relative to the current directory of drive X: the current directory when X is its drive, else the root.
    const letter = drive[1] as string;
    const sameDrive = cwd.charAt(1) === ":" && cwd.charAt(0).toLowerCase() === letter.toLowerCase();
    input = sameDrive ? win32.join(cwd, path.slice(2)) : `${letter.toUpperCase()}:\\${path.slice(2)}`;
  }
  const folded = input.replace(/\//g, "\\");
  let full = win32.resolve(cwd, folded);
  const root = win32.parse(full).root;
  const rest = full.slice(root.length);
  const segments = rest.split("\\").map((segment, index, all) =>
    index < all.length - 1 && /[^.]/.test(segment) ? segment.replace(/\.+$/, "") : segment,
  );
  full = root + segments.join("\\");
  if (full.length > root.length) full = root + full.slice(root.length).replace(/[. ]+$/, "");
  return full;
}

/**
 * Turns a Windows path string into the path the host opens (MAN-033). On Windows that is `NormalizeLongPath`; on other
 * platforms the path must be relative or rooted by `\` only, and every `\` becomes `/`. A drive or a `\\host` share has no
 * meaning there, and the layer stops with {@link PathNotUsableError}. A null or empty path is returned as it is.
 * @spec MAN-004 MAN-005 MAN-033
 */
export function toHostPath(path: string | null, environment: PathEnvironment = {}): string | null {
  if (path === null || path.length === 0) return path;
  if ((environment.platform ?? process.platform) === "win32") return normalizeLongPath(path, environment);
  if (/^[A-Za-z]:/.test(path) || path.startsWith("\\\\")) throw new PathNotUsableError(path);
  return path.replace(/\\/g, "/");
}

const EMPTY_PATH = "Empty path name is not legal.";

/** Turns a Node file-system failure into the exception .NET raises for the same failure. */
function translateFileError(error: unknown, hostPath: string, forWrite: boolean): unknown {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const full = resolve(hostPath);
  switch (code) {
    case "ENOENT":
      return forWrite || !existsSync(dirname(full)) ? new DirectoryNotFoundException(full) : new FileNotFoundException(full);
    case "ENOTDIR":
      return new DirectoryNotFoundException(full);
    case "EISDIR":
    case "EACCES":
    case "EPERM":
      return new UnauthorizedAccessException(full);
    default:
      return error;
  }
}

/**
 * The bytes of a file as `File.ReadAllText` reads them, after the path rules. A null path throws
 * `ArgumentNullException`, an empty one `ArgumentException`, and a missing file or folder the exceptions of .NET.
 * @spec MAN-003 MAN-004 MAN-033
 */
export function readFileBytes(path: string | null, environment: PathEnvironment = {}): Buffer {
  const host = toHostPath(path, environment);
  if (host === null) throw new ArgumentNullException("path");
  if (host.length === 0) throw new ArgumentException(EMPTY_PATH);
  try {
    return readFileSync(host);
  } catch (error) {
    throw translateFileError(error, host, false);
  }
}

/**
 * Creates or truncates a file and writes the bytes, after the path rules. A null path throws `ArgumentNullException`
 * (`Path cannot be null.`), an empty one `ArgumentException`, and a missing folder `DirectoryNotFoundException`.
 * @spec MAN-004 MAN-006 MAN-033
 */
export function writeFileBytes(path: string | null, data: Uint8Array, environment: PathEnvironment = {}): void {
  const host = toHostPath(path, environment);
  if (host === null) throw new ArgumentNullException("path", "Path cannot be null.");
  if (host.length === 0) throw new ArgumentException(EMPTY_PATH);
  try {
    writeFileSync(host, data);
  } catch (error) {
    throw translateFileError(error, host, true);
  }
}
