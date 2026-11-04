import type { HostDirent, HostFsError } from "../host/types.js";
import { envOf, fsOf, toHostPath, translateFileError } from "../io/host-path.js";
import type { PathEnvironment } from "../io/host-path.js";
import { DirectoryNotFoundException, IOException, UnauthorizedAccessException } from "../io/errors.js";
import { flavourOf } from "../io/path.js";
import { compareNtfsNames, shortNamesOf } from "./ntfs-order.js";

/**
 * The engine's `IOWrapper` as the import uses it: the immediate subdirectories of a package folder and the files of one
 * of them, in NTFS order on every OS, as the paths `Directory.GetDirectories` and `Directory.GetFiles` give. The folders are listed
 * and the files read through the environment's `HostFs` (HOST-210), and the order is the engine's, never the host's (HOST-212).
 */

/** `FileInfo.Name` and `FileInfo.FullName` of a package file. */
export interface FileInfo {
  name: string;
  fullName: string;
}

function separatorOf(environment: PathEnvironment): string {
  return envOf(environment).platform === "win32" ? "\\" : "/";
}

/** The path of an entry as .NET builds it: the folder as it was given, the host separator, the name; no doubled separator. */
function combine(folder: string, name: string, separator: string): string {
  return folder.endsWith(separator) || folder.endsWith("/") ? folder + name : folder + separator + name;
}

/** `Path.GetFullPath` of a host path as the host's file system words it: against the environment's current directory (HOST-202). */
function fullName(host: string, environment: PathEnvironment): string {
  return flavourOf(envOf(environment).platform).resolveFrom(envOf(environment).cwd, host);
}

/** Turns the failure of listing a folder into the exception .NET raises for it. */
function translateListError(error: unknown, host: string, environment: PathEnvironment): unknown {
  const code = (error as HostFsError | undefined)?.code;
  switch (code) {
    case "ENOENT":
      return new DirectoryNotFoundException(fullName(host, environment));
    case "ENOTDIR":
      return new IOException("The directory name is invalid.\r\n");
    case "EACCES":
    case "EPERM":
      return new UnauthorizedAccessException(fullName(host, environment));
    default:
      return error;
  }
}

/**
 * The folder as the engine hands it to the file system (IMP-006). On Windows `NormalizeLongPath` removes every leading `\` and
 * `?` and may add the `\\?\` prefix of a long path. Elsewhere only a leading `?` is a character that the trim removes; a path
 * that starts with a backslash names a network share, which the path layer refuses (MAN-033).
 */
function hostFolder(folder: string, environment: PathEnvironment): string {
  const onWindows = envOf(environment).platform === "win32";
  // 12.0 hands the folder to the file functions as it is, so a leading `?` stays (IMP-006)
  return toHostPath(onWindows || environment.normalizePaths === false ? folder : folder.replace(/^\?+/, ""), environment) as string;
}

/** The path the engine shows: the long-path prefix reaches neither the log nor `tempFullName` (IMP-005). */
function shownFolder(host: string): string {
  return host.startsWith("\\\\?\\") ? host.slice(4) : host;
}

/**
 * The entries of a folder as the environment's file system lists them, in whatever order it does: every caller sorts them with
 * `compareNtfsNames` (HOST-212).
 */
function listEntries(folder: string, environment: PathEnvironment): { host: string; entries: HostDirent[] } {
  const host = hostFolder(folder, environment);
  try {
    return { host, entries: fsOf(environment).readdir(host) };
  } catch (error) {
    throw translateListError(error, host, environment);
  }
}

/** Whether an entry is a directory (a link counts as what it points to). */
function isDirectory(entry: HostDirent, host: string, environment: PathEnvironment): boolean {
  if (entry.isDirectory) return true;
  if (!entry.isSymbolicLink) return false;
  try {
    return fsOf(environment).stat(combine(host, entry.name, "/")).isDirectory;
  } catch {
    return false;
  }
}

function isFile(entry: HostDirent, host: string, environment: PathEnvironment): boolean {
  if (entry.isFile) return true;
  if (!entry.isSymbolicLink) return false;
  try {
    return fsOf(environment).stat(combine(host, entry.name, "/")).isFile;
  } catch {
    return false;
  }
}

/**
 * `IOWrapper.DirectoryGetDirectories(path)`: every directory directly inside the folder, hidden and read-only ones too, in
 * NTFS order, as the folder path joined with the name. The path goes through the engine's path rules first: a leading `\`
 * or `?` is removed, which breaks a UNC path (IMP-006). A missing folder throws `DirectoryNotFoundException`, and a path that
 * is a file throws `IOException`.
 * @spec IMP-002 IMP-004 IMP-005 IMP-006 HOST-210 HOST-212
 */
export function directoryGetDirectories(path: string, environment: PathEnvironment = {}): string[] {
  const { host, entries } = listEntries(path, environment);
  const separator = separatorOf(environment);
  return entries
    .filter((entry) => isDirectory(entry, host, environment))
    .map((entry) => entry.name)
    .sort(compareNtfsNames)
    .map((name) => combine(shownFolder(host), name, separator));
}

/**
 * Whether `Directory.GetFiles(folder, "*.xml")` of .NET Framework lists a file: the extension, after the last dot, starts
 * with `xml` in any case. The pattern also matches the short (8.3) name of the file, which cuts the extension to three
 * characters, so `.xmlbak`, `.xmlx` and `.xml~` match. A name with no dot, or a last extension that is not `xml…`, does not.
 */
function matchesXmlPattern(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && name.slice(dot + 1, dot + 4).toLowerCase() === "xml";
}

/** Whether the long name itself matches `*.xml`: the extension after the last dot is exactly `xml`, in any case. */
function matchesByLongName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && name.slice(dot + 1).toLowerCase() === "xml";
}

/**
 * `IOWrapper.DirectoryGetFiles(path, "*.xml")`: the files directly inside the folder that the pattern matches (IMP-003), in
 * NTFS order, as the folder path joined with the name. Hidden and read-only files are listed; a directory is not.
 *
 * A file whose long name matches is listed at its long name's place. A file that only its short name matches (`a.xmlbak`,
 * short name `A~1.XML`) is listed at the short name's place (IMP-004), so it follows every name that sorts below `~`.
 * @spec IMP-003 IMP-004 IMP-005 IMP-006 HOST-210 HOST-212
 */
export function directoryGetXmlFiles(path: string, environment: PathEnvironment = {}): string[] {
  const { host, entries } = listEntries(path, environment);
  const separator = separatorOf(environment);
  const matched = entries.filter((entry) => matchesXmlPattern(entry.name) && isFile(entry, host, environment)).map((entry) => entry.name);
  const shortNames = matched.every(matchesByLongName) ? new Map<string, string>() : shortNamesOf(entries.map((entry) => entry.name));
  const placeOf = (name: string): string => (matchesByLongName(name) ? name : (shortNames.get(name) ?? name));
  return matched
    .sort((a, b) => compareNtfsNames(placeOf(a), placeOf(b)) || compareNtfsNames(a, b))
    .map((name) => combine(shownFolder(host), name, separator));
}

/**
 * `IOWrapper.DirectoryGetFiles(path, "*.xml", SearchOption.AllDirectories)` (IMP-611): the files the pattern matches (IMP-003) in the
 * folder and in every folder below it, at any depth. The order is not defined by .NET; the port lists each folder in NTFS order,
 * the folder's own files first and then its subfolders'. A missing folder throws `DirectoryNotFoundException` and a path that is a
 * file throws `IOException`, both from the listing and before any file is read.
 * @spec IMP-611 IMP-612 HOST-210 HOST-212
 */
export function directoryGetXmlFilesRecursive(path: string, environment: PathEnvironment = {}): string[] {
  const separator = separatorOf(environment);
  const files: string[] = [];
  const visit = (folder: string): void => {
    const { host, entries } = listEntries(folder, environment);
    const shown = shownFolder(host);
    const names = (keep: (entry: HostDirent) => boolean): string[] => entries.filter(keep).map((entry) => entry.name).sort(compareNtfsNames);
    for (const name of names((entry) => matchesXmlPattern(entry.name) && isFile(entry, host, environment))) files.push(combine(shown, name, separator));
    for (const name of names((entry) => isDirectory(entry, host, environment))) visit(combine(shown, name, separator));
  };
  visit(path);
  return files;
}

/**
 * `new FileInfo(path)` as the import reads it: `Name` is the last segment of the path, `FullName` the absolute path.
 * @spec IMP-005 IMP-009
 */
export function newFileInfo(path: string, environment: PathEnvironment = {}): FileInfo {
  const separator = separatorOf(environment);
  const cut = Math.max(path.lastIndexOf(separator), path.lastIndexOf("/"));
  return { name: path.slice(cut + 1), fullName: fullName(path, environment) };
}

/**
 * `File.ReadAllBytes` of a listed path, with the exceptions of .NET: a file held open by another process is an `IOException`. The
 * bytes come from the environment's `HostFs` (HOST-210) and are a `Buffer` whatever host gave them.
 * @spec HOST-210
 */
export function readListedFile(path: string, environment: PathEnvironment = {}): Buffer {
  try {
    const bytes = fsOf(environment).readFile(path);
    // The cast is for the `buffer` package's typings of the browser project, which take an `ArrayBuffer` only (HOST-262).
    return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
  } catch (error) {
    if ((error as HostFsError | undefined)?.code === "EBUSY") {
      throw new IOException(`The process cannot access the file '${fullName(path, environment)}' because it is being used by another process.`);
    }
    throw translateFileError(error, path, false, environment);
  }
}
