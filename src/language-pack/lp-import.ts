import { CItemException } from "../client/fault.js";
import type { CItemHelper } from "../client/item-helper.js";
import type { SolutionUpgradeContext } from "../export/export-context.js";
import { ImportExportManager, type ImportExportManagerOptions } from "../export/import-export-manager.js";
import type { MessagesFactory } from "../export/messages.js";
import { RunLog } from "../export/run-log.js";
import type { SUImportContext } from "../import/import-context.js";
import type { PathEnvironment } from "../io/host-path.js";
import { ManifestFile } from "../manifest/index.js";
import { exceptionText } from "./exception-text.js";
import { LanguagePackPreprocessor, type LanguagePackOptions } from "./preprocessor.js";

export interface LanguagePackImportOptions extends ImportExportManagerOptions, LanguagePackOptions {
  /**
   * Whether the host's `catch` runs (LP-003): it appends the exception to the log, and in 14.35 turns a `CItemException` into the
   * console line and a return of 1. Default true. The oracle's host runs the same steps without that `catch`, so the live parity
   * turns it off to compare the steps themselves.
   */
  hostCatch?: boolean;
}

/**
 * `lpimport` after the arguments are read and the helper has logged in: the steps 3 to 7 of the host's `Main` (LP-001). The
 * preprocessor makes the temporary package from the context's `lpPath`, `lpPackage` and `lpDebug` (LP-029); the context becomes
 * an import of its temporary manifest, nothing else of it changing; the manager is built for it (LP-004) and imports the
 * manifest's packages, which is the language package alone, with the options of `importContext`. The result is the import's
 * return code (IMP-408).
 *
 * An exception from the steps 3 to 6 is written to the log file as a line and thrown again unchanged (LP-003), so the run ends
 * with no return code; {@link leftBehindTempFolder} names the temp package a failed preprocessor left (LP-035). 14.35 splits that
 * catch: a `CItemException` is written to the log, its message goes to the console as `Error: {message}` with no line break, and the
 * run returns 1; every other exception is thrown again as in 14.0.7. In a `finally` the helper logs out (WIRE-040) and the
 * preprocessor, if one was made, is disposed, which keeps the folder for `lpDebug` (LP-034).
 *
 * @spec LP-001 LP-003 LP-004 IMP-640
 */
export async function languagePackImport(
  context: SolutionUpgradeContext,
  importContext: SUImportContext,
  messages: MessagesFactory,
  helper: CItemHelper,
  options: LanguagePackImportOptions = {},
): Promise<number> {
  const { tempPath, randomFileName, hostCatch = true, ...managerOptions } = options;
  // the whole environment of the run, as the manager gets it (HOST-203); `normalizePaths` is left out, which each engine decides itself (EXP-421)
  const { platform, cwd, fs, host } = options;
  const environment: PathEnvironment = {
    ...(platform === undefined ? {} : { platform }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(fs === undefined ? {} : { fs }),
    ...(host === undefined ? {} : { host }),
  };
  const preprocessorOptions: LanguagePackOptions = {
    ...environment,
    ...(tempPath === undefined ? {} : { tempPath }),
    ...(randomFileName === undefined ? {} : { randomFileName }),
  };
  let preprocessor: LanguagePackPreprocessor | undefined;
  try {
    try {
      const manifest = new ManifestFile(undefined, { ...environment, engine: helper.engine });
      preprocessor = await LanguagePackPreprocessor.create(helper, manifest, context.lpPath, context.lpPackage, context.lpDebug, preprocessorOptions);
      context.action = "Import";
      context.manifestFile = preprocessor.tempManifestFilePath;
      const manager = new ImportExportManager(context, messages, helper, managerOptions);
      return await manager.importSolutions(manager.manifestFile?.getAllPackageNames() ?? [], importContext);
    } catch (error) {
      if (!hostCatch) throw error;
      appendToLog(context.logFilePath, exceptionText(error), environment);
      if (helper.engine === "14.35" && error instanceof CItemException) {
        options.console?.write(`Error: ${error.message}`);
        return 1;
      }
      throw error;
    }
  } finally {
    await helper.logout();
    preprocessor?.dispose();
  }
}

/** The line the host's `catch` appends to the log file. A log that cannot be written does not hide the failure it reports. */
function appendToLog(path: string | null, text: string, environment: PathEnvironment): void {
  if (path === null || path === "") return;
  try {
    const log = RunLog.open(path, environment);
    log.writeLine(text);
    log.dispose();
  } catch {
    // the failure being reported is the one that counts
  }
}
