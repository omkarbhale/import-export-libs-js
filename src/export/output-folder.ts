import { EngineNotSupportedError } from "../client/item-helper.js";
import { DEFAULT_ENGINE, type Engine } from "../engines.js";
import { directoryCreateDirectory, directoryDelete, directoryExists } from "../io/windows-fs.js";
import { pathEnvironmentFor, type PathEnvironment } from "../io/host-path.js";
import { isStandardPackage } from "../manifest/index.js";
import { xmlDocumentSaveWithSettings } from "../xml/index.js";
import type { XmlDocument } from "../xml/index.js";

/**
 * The engines whose output layout is built: 12.0 and 14.0.7 join paths with a literal `\` (12.0 hands them to the file
 * functions as built, EXP-421); 14.35 waits for its variant slice.
 */
export const OUTPUT_ENGINES: readonly Engine[] = ["12.0", "14.0.7"];

function checkEngine(engine: Engine): void {
  if (!OUTPUT_ENGINES.includes(engine)) throw new EngineNotSupportedError(engine);
}

/**
 * The folder of a package's item files, relative to the working directory (EXP-414): a standard package's name with each `.`
 * as a folder, any other package's last segment and `Import`. The last segment is the longest run of characters other than `.`
 * at the end of the name, which is empty when the name ends in `.`.
 *
 * @spec EXP-414 EXP-416
 */
export function outputFolderName(packageName: string | null): string {
  if (isStandardPackage(packageName)) return (packageName as string).replace(/\./g, "\\");
  return `${/[^.]+$/.exec(packageName as string)?.[0] ?? ""}\\Import`;
}

/**
 * `ImportExportManager.CreateOutputDir(packageName)`: `{working directory}\{relative}`, joined with no separator logic. A folder
 * of that name is deleted with everything in it, and then created empty, so a package that shares its last segment with an
 * earlier one wipes that one's files. Returns the path, as the engine's string.
 *
 * @spec EXP-414 EXP-415 EXP-416
 */
export function createOutputDir(
  workingDirectory: string | null,
  packageName: string | null,
  environment: PathEnvironment = {},
  engine: Engine = DEFAULT_ENGINE,
): string {
  checkEngine(engine);
  const paths = pathEnvironmentFor(environment, engine);
  const path = `${workingDirectory ?? ""}\\${outputFolderName(packageName)}`;
  if (directoryExists(path, paths)) directoryDelete(path, true, paths);
  directoryCreateDirectory(path, paths);
  return path;
}

/**
 * The write of step 7 of EXP-400: the file goes into `{folder}\{typeName}\`, which is created when it is missing, under the name
 * EXP-418 chose. A file of the same name is replaced, and names that differ in case only are one file (EXP-419). The type name
 * is not checked, so a folder or file the volume refuses ends the export with that .NET exception.
 *
 * @spec EXP-417 EXP-419 EXP-423
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
  const typeFolder = `${folder ?? ""}\\${typeName ?? ""}\\`;
  if (!directoryExists(typeFolder, paths)) directoryCreateDirectory(typeFolder, paths);
  const path = typeFolder + fileName;
  xmlDocumentSaveWithSettings(doc, path, paths);
  return path;
}
