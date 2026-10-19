import { EngineNotSupportedError } from "../client/item-helper.js";
import { DEFAULT_ENGINE, type Engine } from "../engines.js";
import { IOException } from "../io/errors.js";
import { directoryCreateDirectory, directoryDelete, directoryExists, ntfsFoldKey } from "../io/windows-fs.js";
import { getFullPath, pathEnvironmentFor } from "../io/host-path.js";
import type { PathEnvironment } from "../io/host-path.js";
import { isStandardPackage } from "../manifest/index.js";
import { pathCombine } from "../io/win-path.js";
import { xmlDocumentSaveWithSettings } from "../xml/index.js";
import type { XmlDocument } from "../xml/index.js";

/**
 * The engines whose output layout is built: 12.0 and 14.0.7 join paths with a literal `\` (12.0 hands them to the file
 * functions as built, EXP-421); 14.35 joins them with `Path.Combine`.
 */
export const OUTPUT_ENGINES: readonly Engine[] = ["12.0", "14.0.7", "14.35"];

function checkEngine(engine: Engine): void {
  if (!OUTPUT_ENGINES.includes(engine)) throw new EngineNotSupportedError(engine);
}

/**
 * The folder of a package's item files, relative to the working directory (EXP-414): a standard package's name with each `.`
 * as a folder, any other package's last segment and `Import`. The last segment is the longest run of characters other than `.`
 * at the end of the name, which is empty when the name ends in `.`. In 14.35 the last segment and `Import` are joined with
 * `Path.Combine`, so an empty segment gives `Import` and a rooted one replaces the working directory (EXP-460).
 *
 * @spec EXP-414 EXP-416 EXP-460
 */
export function outputFolderName(packageName: string | null, engine: Engine = DEFAULT_ENGINE): string {
  if (isStandardPackage(packageName)) return (packageName as string).replace(/\./g, "\\");
  const lastSegment = /[^.]+$/.exec(packageName as string)?.[0] ?? "";
  return engine === "14.35" ? pathCombine(lastSegment, "Import") : `${lastSegment}\\Import`;
}

/**
 * The path `CreateOutputDir` makes for a package, before it touches the file system: `{working directory}\{relative}`, and in 14.35
 * `Path.Combine(working directory, relative)`, which refuses a null working directory and an illegal character, and lets a rooted
 * relative part replace the working directory (EXP-414, EXP-460).
 *
 * @spec EXP-414 EXP-460
 */
export function outputDirPath(workingDirectory: string | null, packageName: string | null, engine: Engine = DEFAULT_ENGINE): string {
  return engine === "14.35"
    ? pathCombine(workingDirectory, outputFolderName(packageName, engine))
    : `${workingDirectory ?? ""}\\${outputFolderName(packageName)}`;
}

/**
 * `ImportExportManager.CreateOutputDir(packageName)`: `{working directory}\{relative}`, joined with no separator logic; 14.35 joins
 * them with `Path.Combine` (EXP-460). A folder of that name is deleted with everything in it, and then created empty, so a package
 * that shares its last segment with an earlier one wipes that one's files. Returns the path, as the engine's string.
 *
 * @spec EXP-414 EXP-415 EXP-416 EXP-460
 */
export function createOutputDir(
  workingDirectory: string | null,
  packageName: string | null,
  environment: PathEnvironment = {},
  engine: Engine = DEFAULT_ENGINE,
): string {
  checkEngine(engine);
  const paths = pathEnvironmentFor(environment, engine);
  const path = outputDirPath(workingDirectory, packageName, engine);
  if (directoryExists(path, paths)) directoryDelete(path, true, paths);
  directoryCreateDirectory(path, paths);
  return path;
}

/**
 * 14.35's two `Path.Combine` calls of `Export`, which come before the item's first request: the type folder is `Combine(Folder,
 * typeName)` and the file `Combine(thatFolder, fileName)` (EXP-417, EXP-460). A null folder or type name is an
 * `ArgumentNullException`, and an illegal character an `ArgumentException`. A rooted type name replaces the folder.
 *
 * @spec EXP-417 EXP-460
 */
export function itemFilePaths(folder: string | null, typeName: string | null, fileName: string): { typeFolder: string; path: string } {
  const typeFolder = pathCombine(folder, typeName);
  return { typeFolder, path: pathCombine(typeFolder, fileName) };
}

/**
 * The write of step 7 of EXP-400: the file goes into `{folder}\{typeName}\`, which is created when it is missing, under the name
 * EXP-418 chose. A file of the same name is replaced, and names that differ in case only are one file (EXP-419). The type name
 * is not checked, so a folder or file the volume refuses ends the export with that .NET exception. 14.35 joins the folder, the type
 * name and the file name with `Path.Combine`.
 *
 * @spec EXP-417 EXP-419 EXP-423 EXP-460
 */
export function writeItemFile(
  folder: string | null,
  typeName: string | null,
  fileName: string,
  doc: XmlDocument,
  environment: PathEnvironment = {},
  engine: Engine = DEFAULT_ENGINE,
): string {
  checkEngine(engine);
  const paths = pathEnvironmentFor(environment, engine);
  const { typeFolder, path } =
    engine === "14.35" ? itemFilePaths(folder, typeName, fileName) : { typeFolder: `${folder ?? ""}\\${typeName ?? ""}\\`, path: `${folder ?? ""}\\${typeName ?? ""}\\${fileName}` };
  if (!directoryExists(typeFolder, paths)) directoryCreateDirectory(typeFolder, paths);
  xmlDocumentSaveWithSettings(doc, path, paths);
  return path;
}

/** The item files that a worker holds open for writing right now, by the volume's name for them (EXP-419). */
const heldItemFiles = new Set<string>();

/** The turn the writer gives the other workers while it holds the file: the engine's open is not instant, and nor is its write. */
const yieldTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * {@link writeItemFile} for 14.35's concurrent workers (EXP-419). The engine opens the file for writing with read sharing only, so a
 * worker that opens a file while another worker still has it open fails with the `IOException` of a sharing violation, which
 * is not a `CItemException` and ends the run through the aggregate handler (EXP-556). The port holds the file, named as the volume names
 * it (EXP-420), from before the folder is made until the bytes are on disk, and lets the other workers run while it does. Two
 * writes that do not overlap give the later one's content, as in 14.0.7.
 *
 * @spec EXP-419 EXP-420
 */
export async function writeItemFileShared(
  folder: string | null,
  typeName: string | null,
  fileName: string,
  doc: XmlDocument,
  environment: PathEnvironment = {},
  engine: Engine = DEFAULT_ENGINE,
): Promise<string> {
  checkEngine(engine);
  const { path } = itemFilePaths(folder, typeName, fileName);
  let shown = path;
  let key = path;
  try {
    shown = getFullPath(path, environment.cwd ?? process.cwd());
    key = ntfsFoldKey(shown);
  } catch {
    // a path the volume refuses is refused by the write below, with its own exception
  }
  if (heldItemFiles.has(key)) throw new IOException(`The process cannot access the file '${shown}' because it is being used by another process.`);
  heldItemFiles.add(key);
  try {
    await yieldTurn();
    return writeItemFile(folder, typeName, fileName, doc, environment, engine);
  } finally {
    heldItemFiles.delete(key);
  }
}
