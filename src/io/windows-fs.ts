import type { HostFs, HostFsError } from "../host/types.js";
import {
  ArgumentException,
  ArgumentNullException,
  DirectoryNotFoundException,
  IOException,
  PathNotUsableError,
  PathTooLongException,
  UnauthorizedAccessException,
} from "./errors.js";
import { envOf, fsOf, getFullPath, normalizeLongPath } from "./host-path.js";
import type { PathEnvironment } from "./host-path.js";
import { utf8Bytes } from "./utf8.js";
import { NTFS_UPCASE_RUNS } from "./ntfs-upcase-data.js";
import { flavourOf, win32 } from "./path.js";
import type { PathFlavour } from "./path.js";

/**
 * The file system the export writes into: the engine's `Directory` and `File` calls on a Windows volume, reproduced on any
 * host (EXP-420). A path string goes through `NormalizeLongPath` first (EXP-421), then is read as a Windows path whose
 * names follow NTFS: both separators, no empty names, `.` and `..`, trailing dots and spaces dropped as Windows drops them,
 * and names that the volume's upcase table folds together are one name. The names a call finds on the host are the spelling
 * the first creation gave. Exceptions are the .NET Framework ones, with their messages.
 */

const EMPTY_PATH = "Empty path name is not legal.";
const MAX_SEGMENT_LENGTH = 255;

let upcaseTable: Map<number, number> | undefined;

function upcase(unit: number): number {
  if (!upcaseTable) {
    upcaseTable = new Map();
    for (const [first, last, stride, delta] of NTFS_UPCASE_RUNS) {
      for (let at = first; at <= last; at += stride) upcaseTable.set(at, at + delta);
    }
  }
  return upcaseTable.get(unit) ?? unit;
}

/**
 * The key by which NTFS compares names: every UTF-16 unit folded by the volume's upcase table on its own, so a surrogate pair
 * is never folded and `é` differs from `e` followed by U+0301.
 * @spec EXP-420
 */
export function ntfsFoldKey(name: string): string {
  let key = "";
  for (let i = 0; i < name.length; i += 1) key += String.fromCharCode(upcase(name.charCodeAt(i)));
  return key;
}

/** One name of a path, as Windows sees it after the dots and spaces at its end are dealt with. */
interface Segment {
  /** The name to look for or create. */
  name: string;
  /** A name that is followed by more path and still ends in a space: no such name can exist (EXP-420). */
  unreachable: boolean;
  /** The path as the engine wrote it up to and including this name, for the messages of exceptions. */
  text: string;
}

interface ModelPath {
  /** The path rules of the host's own file system, for the host paths that the walk builds (HOST-202). */
  host: PathFlavour;
  /** The host directory the names are looked up from. */
  base: string;
  segments: Segment[];
  /** The whole path as Windows words it in a message: separators folded to `\`, `.` and `..` resolved. */
  text: string;
}

/**
 * The names of a path. `creating` is `Directory.CreateDirectory`, which drops a trailing separator before it makes the last
 * name, so that a last name with trailing dots or spaces is made without them. A name that a separator follows loses one
 * trailing dot and keeps its spaces (a folder `Sp ` cannot be reached, though `Sp` is made by creating it).
 */
function modelPath(path: string, environment: PathEnvironment, creating: boolean): ModelPath {
  const { cwd, platform } = envOf(environment);
  const host = flavourOf(platform);
  const unnormalized = environment.normalizePaths === false;
  // the 12.0 engine passes the path on as built: .NET still refuses an illegal one, but there is no trimming and no length rule
  if (unnormalized) getFullPath(path, cwd);
  const normalized = unnormalized ? path : (normalizeLongPath(path, environment) as string);
  const prefixed = normalized.startsWith("\\\\?\\") ? normalized.slice(4) : normalized;
  const trailingSeparator = !creating && /[\\/]$/.test(prefixed);
  const parts = prefixed.split(/[\\/]/).filter((part) => part !== "");

  let base: string;
  let drive = "";
  const unc = unnormalized && /^[\\/]{2}(?![?\\/])/.test(prefixed);
  if (unc) {
    // a UNC path keeps its server and share (EXP-422); there is no such volume on a host that is not Windows
    if (platform !== "win32") throw new PathNotUsableError(prefixed);
    const [server = "", share = ""] = parts.splice(0, 2);
    base = `\\\\${server}\\${share}\\`;
  } else if (/^[A-Za-z]:/.test(prefixed)) {
    if (platform !== "win32") throw new PathNotUsableError(prefixed);
    drive = `${(prefixed.charAt(0)).toUpperCase()}:`;
    base = `${drive}\\`;
    parts.shift();
  } else if (/^[\\/]/.test(prefixed)) {
    base = platform === "win32" ? win32.parse(win32.resolveFrom(cwd)).root : "/";
  } else {
    base = cwd;
  }
  let baseText = platform === "win32" ? win32.resolveFrom(cwd, base) : base.replace(/\//g, "\\");
  baseText = baseText.replace(/\\+$/, "");

  const segments: Segment[] = [];
  const raws: string[] = [];
  for (const [index, part] of parts.entries()) {
    if (part === ".") continue;
    if (part === "..") {
      if (segments.length > 0) {
        segments.pop();
        raws.pop();
      } else {
        base = host.dirname(base);
        baseText = baseText.slice(0, Math.max(baseText.lastIndexOf("\\"), 0));
      }
      continue;
    }
    const last = index === parts.length - 1 && !trailingSeparator;
    let name = part;
    if (last) name = part.replace(/[. ]+$/, "");
    else if (/[^.]\.$/.test(part)) name = part.slice(0, -1);
    if (name.length === 0) continue;
    if (name.length > MAX_SEGMENT_LENGTH) throw new PathTooLongException();
    raws.push(part);
    segments.push({ name, unreachable: !last && name.endsWith(" "), text: `${baseText}\\${raws.join("\\")}` });
  }
  const text = segments.length > 0 ? (segments[segments.length - 1] as Segment).text : baseText || "\\";
  return { host, base, segments, text };
}

interface Entry {
  name: string;
  isDirectory: boolean;
}

/** The entry of a directory that has this name on the volume: the same spelling if there is one, else the first fold-equal one. */
function lookup(directory: string, name: string, host: PathFlavour, fs: HostFs): Entry | undefined {
  try {
    return { name, isDirectory: fs.stat(host.join(directory, name)).isDirectory };
  } catch {
    // not under this spelling
  }
  let names: string[];
  try {
    names = fs.readdir(directory).map((entry) => entry.name);
  } catch {
    return undefined;
  }
  const key = ntfsFoldKey(name);
  const found = names.filter((candidate) => ntfsFoldKey(candidate) === key).sort()[0];
  if (found === undefined) return undefined;
  try {
    return { name: found, isDirectory: fs.stat(host.join(directory, found)).isDirectory };
  } catch {
    return undefined;
  }
}

/** `NUL` is a device: a folder of that name cannot be written to (EXP-417). */
const isDevice = (name: string): boolean => ntfsFoldKey(name) === "NUL";

/** The host directory a walk over the first names reached, or undefined where a name is missing. */
function walk(model: ModelPath, count: number, fs: HostFs): string | undefined {
  let current = model.base;
  for (const segment of model.segments.slice(0, count)) {
    if (segment.unreachable || isDevice(segment.name)) return undefined;
    const entry = lookup(current, segment.name, model.host, fs);
    if (!entry?.isDirectory) return undefined;
    current = model.host.join(current, entry.name);
  }
  return current;
}

function checked(path: string | null, action: string): string | undefined {
  if (path === null) {
    if (action === "exists") return undefined;
    throw action === "write" ? new ArgumentNullException("path", "Path cannot be null.") : new ArgumentNullException("path");
  }
  if (path.length === 0) {
    if (action === "exists") return undefined;
    throw new ArgumentException(EMPTY_PATH);
  }
  return path;
}

/**
 * `IOWrapper.DirectoryExists`: true for a folder, false for a file, a missing path and a path that Windows cannot reach. A
 * path that is not legal throws as `NormalizeLongPath` does.
 * @spec EXP-420 EXP-421 HOST-210
 */
export function directoryExists(path: string | null, environment: PathEnvironment = {}): boolean {
  const given = checked(path, "exists");
  if (given === undefined) return false;
  const model = modelPath(given, environment, false);
  return walk(model, model.segments.length, fsOf(environment)) !== undefined;
}

/**
 * `IOWrapper.DirectoryCreateDirectory`: creates the folder and every missing folder above it, and does nothing for one that
 * exists. A name followed by more path that still ends in a space is made without the space and then fails the walk
 * (`DirectoryNotFoundException`); a file where a folder is needed is an `IOException` for the last name.
 * @spec EXP-417 EXP-420 EXP-421 HOST-210
 */
export function directoryCreateDirectory(path: string | null, environment: PathEnvironment = {}): void {
  const given = checked(path, "create") as string;
  const model = modelPath(given, environment, true);
  const fs = fsOf(environment);
  let current = model.base;
  for (const [index, segment] of model.segments.entries()) {
    if (isDevice(segment.name)) return;
    const entry = lookup(current, segment.name, model.host, fs);
    if (entry?.isDirectory) {
      current = model.host.join(current, entry.name);
      continue;
    }
    if (entry) {
      if (index === model.segments.length - 1) {
        throw new IOException(`Cannot create "${model.text}\\" because a file or directory with the same name already exists.`);
      }
      throw new DirectoryNotFoundException((model.segments[index + 1] as Segment).text);
    }
    if (segment.unreachable) {
      current = madeDirectory(model.host.join(current, segment.name.replace(/ +$/, "")), fs);
      throw new DirectoryNotFoundException((model.segments[index + 1] as Segment).text);
    }
    current = madeDirectory(model.host.join(current, segment.name), fs);
  }
}

function madeDirectory(path: string, fs: HostFs): string {
  try {
    fs.mkdir(path);
  } catch (error) {
    const code = (error as HostFsError).code;
    if (code === "EEXIST") return path;
    if (code === "EACCES" || code === "EPERM") {
      throw new UnauthorizedAccessException(path);
    }
    throw error;
  }
  return path;
}

/**
 * `IOWrapper.DirectoryDelete(path, recursive)`: a missing folder is a `DirectoryNotFoundException`. A file the host will not
 * delete is an `UnauthorizedAccessException` that names the file.
 * @spec EXP-415 EXP-420 EXP-421 HOST-210
 */
export function directoryDelete(path: string | null, recursive: boolean, environment: PathEnvironment = {}): void {
  const given = checked(path, "delete") as string;
  const model = modelPath(given, environment, false);
  const fs = fsOf(environment);
  const directory = walk(model, model.segments.length, fs);
  if (directory === undefined) throw new DirectoryNotFoundException(model.text);
  try {
    fs.rm(directory, { recursive });
  } catch (error) {
    const code = (error as HostFsError).code;
    if (code === "EACCES" || code === "EPERM") {
      throw new UnauthorizedAccessException(model.host.parse((error as HostFsError).path ?? directory).base);
    }
    throw error;
  }
}

/**
 * Creates or truncates a file and writes the bytes, as `new StreamWriter(path, false)` does on the volume (EXP-423). The file
 * keeps the spelling it was first created with; a missing folder, a device folder or a name with a trailing space before
 * its file is a `DirectoryNotFoundException`, and a folder where the file should be is an `UnauthorizedAccessException`.
 * @spec EXP-419 EXP-420 EXP-421 EXP-423 HOST-210
 */
export function writeVolumeFile(path: string | null, data: Uint8Array, environment: PathEnvironment = {}): void {
  const given = checked(path, "write") as string;
  const model = modelPath(given, environment, false);
  const file = model.segments[model.segments.length - 1];
  if (!file) throw new UnauthorizedAccessException(model.text);
  const fs = fsOf(environment);
  const directory = walk(model, model.segments.length - 1, fs);
  if (directory === undefined) throw new DirectoryNotFoundException(model.text);
  const entry = lookup(directory, file.name, model.host, fs);
  if (entry?.isDirectory) throw new UnauthorizedAccessException(model.text);
  try {
    fs.writeFile(model.host.join(directory, entry?.name ?? file.name), data);
  } catch (error) {
    const code = (error as HostFsError).code;
    if (code === "EACCES" || code === "EPERM") throw new UnauthorizedAccessException(model.text);
    throw error;
  }
}

/**
 * `IOWrapper.FileWriteAllText(path, contents)`: `File.WriteAllText`, the text as UTF-8 without a byte-order mark, an existing
 * file overwritten. The path is read as a path on a Windows volume (EXP-420, EXP-421).
 * @spec LP-026
 */
export function fileWriteAllText(path: string | null, contents: string, environment: PathEnvironment = {}): void {
  writeVolumeFile(path, utf8Bytes(contents), environment);
}
