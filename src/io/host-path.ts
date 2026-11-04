import type { Engine } from "../engines.js";
import { defaultHost, defaultHostEnv } from "../host/default-host.js";
import type { HostEnv, HostFs, HostFsError } from "../host/types.js";
import { isWhiteSpace } from "./dotnet-text.js";
import { flavourOf, posix, win32 } from "./path.js";
import {
  ArgumentException,
  ArgumentNullException,
  DirectoryNotFoundException,
  FileNotFoundException,
  NotSupportedException,
  PathNotUsableError,
  PathTooLongException,
  UnauthorizedAccessException,
} from "./errors.js";

/**
 * The file layer: the one place where the Windows path strings the engine builds (MAN-033) meet the host's file
 * system. On Windows a path goes through the engine's `NormalizeLongPath` (MAN-004); elsewhere it becomes a POSIX path.
 */

/** What the layer needs to know about the host. Tests give both, to follow the Windows rules on another platform. */
export interface PathEnvironment {
  /** The platform whose path rules the run follows; the default is the platform of the host environment (HOST-203). */
  platform?: NodeJS.Platform;
  /** The current directory, a Windows path when the platform is `win32`; the default is the current directory of the host environment (HOST-203). */
  cwd?: string;
  /**
   * False when the engine hands every path to the file functions as it built it, with no `NormalizeLongPath`: the 12.0 engine
   * (EXP-421, MAN-004). The default is true.
   */
  normalizePaths?: boolean;
  /**
   * The file system the layer reads and writes through (HOST-200, HOST-210); the default is the file system of the default host
   * (`defaultHost().fs`), the Node file system on Node. The layer in this file and in `windows-fs.ts` honours it; the package listing and
   * the log file do not yet.
   */
  fs?: HostFs;
  /** The rest of the machine (HOST-200, HOST-203); the default is the environment of the running platform (`defaultHostEnv()`). */
  host?: HostEnv;
}

/**
 * The platform and the current directory a run follows: the environment's own `platform` and `cwd` where it has them, else the
 * host's (HOST-203). The host is asked for the current directory only when the environment has none.
 * @spec HOST-203
 */
export function envOf(environment: PathEnvironment): { readonly platform: string; readonly cwd: string } {
  const host = environment.host ?? defaultHostEnv();
  return {
    platform: environment.platform ?? host.platform,
    get cwd() {
      return environment.cwd ?? host.cwd();
    },
  };
}

/**
 * The file system a run reads and writes through: the environment's own `fs` where it has one, else the default host's (HOST-210).
 * @spec HOST-210
 */
export function fsOf(environment: PathEnvironment): HostFs {
  return environment.fs ?? defaultHost().fs;
}

/** The environment as an engine sees it: 12.0 has no path normalisation (EXP-421), the other engines have it. */
export function pathEnvironmentFor(environment: PathEnvironment, engine: Engine): PathEnvironment {
  return engine === "12.0" ? { ...environment, normalizePaths: false } : environment;
}

/** The full path at which `NormalizeLongPath` switches to the `\\?\` form. */
const LONG_PATH_LIMIT = 255;

/** `Path.GetFullPath` of .NET Framework 4.8 refuses an absolute input of 259 characters and a relative one of 258 (EXP-421). */
const ABSOLUTE_INPUT_LIMIT = 259;
const RELATIVE_INPUT_LIMIT = 258;

/**
 * `IOWrapper.NormalizeLongPath`. A null or empty path is returned as it is. Otherwise every leading `\` and `?` is
 * removed (bug MAN-005: a UNC or drive-less path becomes relative), the full path of the rest is computed, which throws
 * as `Path.GetFullPath` does, and the result is `\\?\` followed by the full path when that is 255 characters or longer,
 * and the trimmed path otherwise.
 * @spec MAN-004 MAN-005 EXP-421 EXP-422
 */
export function normalizeLongPath(path: string | null, environment: PathEnvironment = {}): string | null {
  if (path === null || path.length === 0) return path;
  let start = 0;
  while (start < path.length && (path.charAt(start) === "\\" || path.charAt(start) === "?")) start += 1;
  const trimmed = path.slice(start);
  const absolute = /^[A-Za-z]:|^[\\/]/.test(trimmed);
  if (trimmed.length >= (absolute ? ABSOLUTE_INPUT_LIMIT : RELATIVE_INPUT_LIMIT)) throw new PathTooLongException();
  const full = getFullPath(trimmed, envOf(environment).cwd);
  return full.length >= LONG_PATH_LIMIT ? `\\\\?\\${full}` : trimmed;
}

/**
 * `Path.GetFullPath` against the current directory, with .NET Framework's validation: a path of white space only is
 * not of a legal form, a control character or `"`, `<`, `>`, `|`, `?`, `*` is illegal, and `:` is allowed only as
 * the second character after a drive letter. Separators are folded to `\`, `.` and `..` segments are resolved, and
 * trailing dots (and trailing spaces of the whole path) are dropped.
 */
export function getFullPath(path: string, cwd: string): string {
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
  let full = win32.resolveFrom(cwd, folded);
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
 * Turns a Windows path string into the path the host opens (MAN-033). On Windows that is `NormalizeLongPath` (none for the 12.0
 * engine, which uses the path as built); on other
 * platforms the path must be relative or rooted by `\` only, and every `\` becomes `/`. A drive or a `\\host` share has no
 * meaning there, and the layer stops with {@link PathNotUsableError}. A null or empty path is returned as it is.
 * @spec MAN-004 MAN-005 MAN-033 LP-010 HOST-216
 */
export function toHostPath(path: string | null, environment: PathEnvironment = {}): string | null {
  if (path === null || path.length === 0) return path;
  if (envOf(environment).platform === "win32") return environment.normalizePaths === false ? path : normalizeLongPath(path, environment);
  if (/^[A-Za-z]:/.test(path) || path.startsWith("\\\\")) throw new PathNotUsableError(path);
  // Windows resolves `.` and `..` segments in the text before it opens anything, so `x\..\f` reaches `f` although `x` does not exist
  return posix.normalize(path.replace(/\\/g, "/"));
}

const EMPTY_PATH = "Empty path name is not legal.";

/**
 * `IOWrapper.FileExists`: true for a file, and false for a folder, a missing path, a null or empty path and a path the host
 * cannot name, which `File.Exists` answers with false instead of throwing.
 * @spec EXP-502 HOST-210
 */
export function fileExists(path: string | null, environment: PathEnvironment = {}): boolean {
  try {
    const host = toHostPath(path, environment);
    return host !== null && host.length > 0 && fsOf(environment).stat(host).isFile;
  } catch {
    return false;
  }
}

/**
 * `IOWrapper.DirectoryGetParentFullName`: `Directory.GetParent(path).FullName`, the full path of the folder that holds the
 * file or folder at `path`. A relative path is resolved against the current directory. A Windows path (a drive, or a `\`
 * anywhere in it: the engine joins the names of a path with `\`, so `/tmp/pack\imports.mf` is one) keeps its Windows form on
 * every host; any other path is a host path.
 * @spec IMP-402 LP-004
 */
export function directoryGetParentFullName(path: string, environment: PathEnvironment = {}): string {
  const env = envOf(environment);
  if (env.platform === "win32" || /^[A-Za-z]:|\\/.test(path)) return win32.dirname(getFullPath(path, env.cwd));
  return posix.dirname(posix.resolveFrom(env.cwd, path));
}

/**
 * Turns a file-system failure into the exception .NET raises for the same failure, by the error's `code` (HOST-201). The full path
 * in the exception is the host path resolved against the environment's current directory, not the process's (HOST-211), by the
 * rules of the host's own file system (HOST-202); whether the folder of a missing file exists is asked of the environment's file
 * system (HOST-210).
 * @spec HOST-201 HOST-210 HOST-211
 */
export function translateFileError(error: unknown, hostPath: string, forWrite: boolean, environment: PathEnvironment = {}): unknown {
  const code = (error as HostFsError | undefined)?.code;
  const env = envOf(environment);
  const host = flavourOf(env.platform);
  const full = host.resolveFrom(env.cwd, hostPath);
  switch (code) {
    case "ENOENT":
      return forWrite || !fsOf(environment).exists(host.dirname(full)) ? new DirectoryNotFoundException(full) : new FileNotFoundException(full);
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
 * @spec MAN-003 MAN-004 MAN-033 HOST-210
 */
export function readFileBytes(path: string | null, environment: PathEnvironment = {}): Buffer {
  const host = toHostPath(path, environment);
  if (host === null) throw new ArgumentNullException("path");
  if (host.length === 0) throw new ArgumentException(EMPTY_PATH);
  try {
    const bytes = fsOf(environment).readFile(host);
    return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } catch (error) {
    throw translateFileError(error, host, false, environment);
  }
}

/**
 * Creates or truncates a file and writes the bytes, after the path rules. A null path throws `ArgumentNullException`
 * (`Path cannot be null.`), an empty one `ArgumentException`, and a missing folder `DirectoryNotFoundException`.
 * @spec MAN-004 MAN-006 MAN-033 HOST-210
 */
export function writeFileBytes(path: string | null, data: Uint8Array, environment: PathEnvironment = {}): void {
  const host = toHostPath(path, environment);
  if (host === null) throw new ArgumentNullException("path", "Path cannot be null.");
  if (host.length === 0) throw new ArgumentException(EMPTY_PATH);
  try {
    fsOf(environment).writeFile(host, data);
  } catch (error) {
    throw translateFileError(error, host, true, environment);
  }
}
