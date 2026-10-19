import { nullReference } from "../client/dotnet.js";
import { CItemException } from "../client/fault.js";
import type { CItemHelper } from "../client/item-helper.js";
import { ENGINE_ASSEMBLY_VERSIONS, type Engine } from "../engines.js";
import { EngineNotSupportedError } from "../client/item-helper.js";
import type { SolutionUpgradeContext } from "../export/export-context.js";
import { type Message, type MessagesFactory, getMessage } from "../export/messages.js";
import { PackageDefinitionManager } from "../export/package-definition-manager.js";
import { RunLog, formatWithArgs, invariantDateTime } from "../export/run-log.js";
import { ArgumentNullException, InvalidOperationException, NullReferenceException, PathNotUsableError } from "../io/errors.js";
import type { PathEnvironment } from "../io/host-path.js";
import type { ManifestFile } from "../manifest/manifest-file.js";
import { getSolutionPath } from "../manifest/solution-path.js";
import type { XmlDocument, XmlElement } from "../xml/dom.js";
import { selectNodes, selectSingleNode } from "../xml/xpath.js";
import { DelayedResolutionManager } from "./delayed-resolution.js";
import type { SUImportContext } from "./import-context.js";
import type { ImportHelper } from "./import-helper.js";
import { getItemsFromPackageDom, isImportableType } from "./items.js";
import { loadPackageDom } from "./load-package-dom.js";
import type { LogWriter } from "./load-package-dom.js";
import { ReferenceChecker } from "./reference-checks.js";

/** The engines whose import run is built; the rest wait for their variant slices. */
export const IMPORT_RUN_ENGINES: readonly Engine[] = ["14.0.7"];

/** Where a run is, for `Cancel` (IMP-409). */
export type ProgressState = "idle" | "inProgress" | "cancelled";

/**
 * The engine host's standard output, which `ImportProc` writes to (IMP-421). `writeLine` ends the line with the host's line
 * terminator, which the sink decides, and `write` adds nothing. The CLI sends it to stderr.
 */
export interface ConsoleWriter {
  write(text: string): void;
  writeLine(text?: string): void;
}

/** The console of a host that does not show it. */
export const SILENT_CONSOLE: ConsoleWriter = { write: () => undefined, writeLine: () => undefined };

/** What the import run needs of the manager it belongs to: the manager's settings, and its progress state. */
export interface ImportRunHost {
  readonly engine: Engine;
  /** The context the manager was built with: the log, the header and `Verbose` are read from it (IMP-403, IMP-421). */
  readonly context: SolutionUpgradeContext;
  readonly messages: MessagesFactory;
  readonly itemHelper: CItemHelper;
  /** The helper's import side, which also holds the value of `os_user` (IMP-452). */
  readonly importHelper: ImportHelper;
  /** The manifest of the import (IMP-402); null for a manager that was not built for one. */
  readonly manifestFile: ManifestFile | null;
  /** The folder of the manifest, which package paths are resolved against (IMP-402). */
  readonly manifestDirectory: string | null;
  readonly environment: PathEnvironment;
  readonly console: ConsoleWriter;
  now(): Date;
  /** `GetSolutions2Xml` (IMP-405). */
  getSolutions2Xml(): Promise<XmlDocument | null>;
  getState(): ProgressState;
  setState(state: ProgressState): void;
}

/** The in-memory log of one package: a `StreamWriter` over a `MemoryStream` (IMP-406). */
class PackageLog implements LogWriter {
  private readonly parts: string[] = [];

  writeLine(text = ""): void {
    this.parts.push(text, "\r\n");
  }

  get text(): string {
    return this.parts.join("");
  }
}

/** `XmlElement.GetAttribute(name)`: the value, or the empty string for a missing attribute. */
const getAttribute = (element: XmlElement, name: string): string => element.getAttributeNode(name)?.value ?? "";

/** The item element of a package item document (`SelectSingleNode("Item")`); a document without one is a null reference. */
function itemOf(document: XmlDocument): XmlElement {
  const item = selectSingleNode("Item", document) as XmlElement | null;
  if (item === null) throw nullReference();
  return item;
}

/** `string.Equals(a, b, StringComparison.OrdinalIgnoreCase)` for the ASCII letters of a type name. */
const equalsIgnoreCase = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Sends a text on a message channel. */
async function send(message: Message, text: string): Promise<void> {
  message.text = text;
  await message.execute();
}

/**
 * `GetImportableItemsCount`: the number of item documents whose root `action` is `add` and whose type is importable.
 *
 * @spec IMP-423 IMP-431
 */
export function getImportableItemsCount(items: readonly XmlDocument[]): number {
  let count = 0;
  for (const document of items) {
    const item = itemOf(document);
    if (getAttribute(item, "action") === "add" && isImportableType(getAttribute(item, "type"))) count += 1;
  }
  return count;
}

/**
 * `LogInputParameters` for an import: the block `ImportSolutions` writes at the top of the log (IMP-403). It is the header of
 * an export up to the language-pack lines, then the fast, merge and release lines. The settings of the manager's context
 * and the import context are both read as the engine does. The block ends with the CRLF of its last line, and `WriteLine` adds
 * one more, so the log shows an empty line after it.
 *
 * @spec IMP-403
 */
export function importInputParameters(context: SolutionUpgradeContext, importContext: SUImportContext, innovatorVersion: string, assemblyVersion: string): string {
  const lines = [
    formatWithArgs("Tool version: {0}", assemblyVersion),
    formatWithArgs("Action: {0}", context.action),
    formatWithArgs("Manifest file: {0}", context.manifestFile),
    formatWithArgs("Log file: {0}", context.logFilePath),
    formatWithArgs("Working directory: {0}", context.workingDirectory),
    formatWithArgs("URL: {0}", context.url),
    formatWithArgs("Database: {0}", context.dataBase),
    formatWithArgs("User: {0}", context.userName),
    formatWithArgs("Innovator version: {0}", innovatorVersion),
    formatWithArgs("Language pack: {0}", context.lpPath),
    formatWithArgs("Language pack name: {0}", context.lpPackage),
    formatWithArgs("Fast import mode: {0}", importContext.fast),
    formatWithArgs("Merge import mode: {0}", importContext.merge),
    formatWithArgs("Import release: {0}", importContext.release),
  ];
  return lines.map((line) => `${line}\r\n`).join("");
}

/**
 * `LogError`: the error block of a failed run, written to the log (IMP-407).
 *
 * @spec IMP-407 IMP-470
 */
export function logError(error: Error, log: RunLog): void {
  log.writeLine(getMessage("ErrorMessageMessageEnd", error.message));
}

/**
 * Errors the port raises that no .NET exception stands for: a platform limit and a programming error. The engine's
 * `catch (Exception)` has nothing to say about them, so they end the run as they are.
 */
function endsTheRunUnhandled(error: unknown): boolean {
  return (
    error instanceof PathNotUsableError ||
    error instanceof EngineNotSupportedError ||
    error instanceof TypeError ||
    error instanceof ReferenceError
  );
}

/**
 * The import half of the engine's `ImportExportManager`: `ImportSolutions` and what it calls (IMP-400 to IMP-471). A run
 * imports the packages in dependency order, one `DatabaseUpgrade` row and one buffered log per package, and stops at the first
 * package that fails.
 *
 * @spec IMP-400 IMP-403 IMP-404 IMP-405 IMP-406 IMP-407 IMP-408 IMP-409 IMP-410 IMP-411 IMP-420 IMP-421 IMP-422 IMP-423 IMP-424
 * @spec IMP-425 IMP-426 IMP-427 IMP-428 IMP-429 IMP-430 IMP-431 IMP-470 IMP-471
 */
export class ImportRun {
  constructor(private readonly host: ImportRunHost) {
    if (!IMPORT_RUN_ENGINES.includes(host.engine)) throw new EngineNotSupportedError(host.engine);
  }

  private timestamp(): string {
    return invariantDateTime(this.host.now());
  }

  /**
   * `ImportSolutions(packagesToImportList, importContext)`: returns 0 when every package ended without an exception (a
   * cancelled one included, bug IMP-409), and 1 for an empty list or the first failure. The log is opened before the guarded
   * block, so a failure to open it escapes as it is (IMP-403).
   *
   * @spec IMP-400 IMP-403 IMP-404 IMP-407 IMP-408
   */
  async importSolutions(packages: readonly (string | null)[] | null, importContext: SUImportContext | null): Promise<number> {
    if (importContext === null) throw new ArgumentNullException("importContext");
    const { host } = this;
    host.setState("inProgress");
    const status = host.messages.getStatusMessage();
    const log = RunLog.open(host.context.logFilePath, host.environment);
    try {
      try {
        const version = host.itemHelper.innovatorVersion;
        if (version === undefined) throw new NullReferenceException();
        log.writeLine(importInputParameters(host.context, importContext, version.fullString, ENGINE_ASSEMBLY_VERSIONS[host.engine]));
        log.writeLine(getMessage("StartOfImportingPackages"));
        const solutions = await host.getSolutions2Xml();
        const warnings: string[] = [];
        if (host.manifestFile === null) throw new NullReferenceException();
        const names = host.manifestFile.getPackageNamesInImportOrder(packages, solutions, warnings);
        for (const warning of warnings) log.writeLine(warning);
        if (names.length === 0) return 1;
        for (const name of names) await this.importPackage(importContext, log, name);
      } catch (error) {
        if (endsTheRunUnhandled(error)) throw error;
        const failure = error as Error;
        logError(failure, log);
        await send(host.messages.getErrorMessage(), getMessage("ErrorMessageMessage", failure.message));
        return 1;
      }
      await send(status, getMessage("Completed"));
      host.setState("idle");
      return 0;
    } finally {
      log.dispose();
    }
  }

  /**
   * `ImportPackage`: one package between two audit-row writes, with a log of its own that reaches the run's log in one write
   * when the package ends, whether it succeeded or failed (IMP-406). A failure writes the failed status, which may fail in
   * turn and then replaces the original error (bug IMP-411), and is wrapped (IMP-407).
   *
   * @spec IMP-406 IMP-407 IMP-409 IMP-411
   */
  private async importPackage(importContext: SUImportContext, commonLog: RunLog, packageName: string): Promise<void> {
    const { importHelper } = this.host;
    const log = new PackageLog();
    try {
      log.writeLine(getMessage("StartOfExecutionDateTime", this.timestamp()));
      log.writeLine(getMessage("UpdatingPackageNamePackageToInprogressReleaseStatus", packageName));
      await importHelper.writeReleaseData(packageName, 0, importContext.release, importContext.description);
      await this.importProc(packageName, log, importContext);
      log.writeLine(getMessage("UpdatingPackageNamePackageToSuccessReleaseStatus", packageName));
      await importHelper.writeReleaseData(packageName, 1, importContext.release, importContext.description);
    } catch (error) {
      if (endsTheRunUnhandled(error)) throw error;
      log.writeLine(getMessage("UpdatingPackageNamePackageToFailedReleaseStatus", packageName));
      await importHelper.writeReleaseData(packageName, 2, importContext.release, importContext.description);
      const text = getMessage(
        "ImportPackagePackageNameFailedWithMessageUpdatingPackageNameToFailedReleaseStatus",
        packageName,
        (error as Error).message,
        packageName,
      );
      throw new InvalidOperationException(`\r\n${text}\r\n`, error);
    } finally {
      log.writeLine(getMessage("EndOfExecutionDateTime", this.timestamp()));
      commonLog.write(log.text);
    }
  }

  /**
   * `ImportProc`: the items of one package, in order (IMP-420). Each item is read and described in the log (IMP-422), counted
   * (IMP-423), skipped when it exists in non-merge mode (IMP-424), checked and imported with one retry of a failed delete
   * (IMP-427), and an added item is registered in the package definition (IMP-429). A cancel ends the package with a normal
   * return (bug IMP-409).
   *
   * @spec IMP-420 IMP-421 IMP-422 IMP-423 IMP-424 IMP-425 IMP-426 IMP-427 IMP-428 IMP-429 IMP-430 IMP-431 IMP-441
   */
  private async importProc(packageName: string, log: PackageLog, importContext: SUImportContext): Promise<void> {
    const { host } = this;
    const { console, itemHelper, importHelper } = host;
    const verbose = host.context.verbose;
    const banner = getMessage(importContext.merge ? "ImportWithMergeOptionPackageName" : "ImportPackageName", packageName);
    console.writeLine(banner);
    log.writeLine(banner);
    if (verbose) console.writeLine(getMessage("BuildingSolution"));
    const status = host.messages.getStatusMessage();
    await send(status, getMessage("BuildingSolution"));
    if (host.manifestFile === null) throw new NullReferenceException();
    const solutionPath = getSolutionPath(packageName, host.manifestDirectory, host.manifestFile);
    const packageDom = loadPackageDom(solutionPath, log, { engine: host.engine, environment: host.environment });
    const items = getItemsFromPackageDom(packageDom);
    await send(status, getMessage("AddingPackageDefinintionForPackageName", packageName));
    const definition = await PackageDefinitionManager.open(itemHelper, packageName, true);
    const warnings: string[] = [];
    await definition.addDependencyInfo(host.manifestFile.getDependsOnInfo(packageName), warnings);
    for (const warning of warnings) log.writeLine(getMessage("WARNINGImportingPackageNamePackageWarn", packageName, warning));

    const importableItemsCount = getImportableItemsCount(items);
    let count = 0;
    let sqlItemsDeleted = false;
    if (!verbose) console.writeLine();
    const delayedResolution = new DelayedResolutionManager(host.engine);
    const checker = new ReferenceChecker(itemHelper);

    for (const document of items) {
      if (host.getState() === "cancelled") {
        const text = getMessage("ImportWasCanceledByUser");
        await send(status, text);
        log.writeLine(text);
        return;
      }
      const item = itemOf(document);
      item.setAttribute("doGetItem", "0");
      const action = getAttribute(item, "action");
      let id = getAttribute(item, "id");
      const type = getAttribute(item, "type");
      const keyedName = getAttribute(item, "tempKeyName");
      item.removeAttribute("tempKeyName");
      const fullName = getAttribute(item, "tempFullName");
      item.removeAttribute("tempFullName");
      const keyedPart = keyedName !== "" ? `  keyed_name : ${keyedName}  ` : " ";
      const idPart = id !== "" ? `  id : ${id}  ` : " ";
      const typePart = type !== "" ? `  type : ${type}  ` : " ";
      const descriptor = idPart + keyedPart + typePart;
      log.writeLine(getMessage("ProcessingActionKeyIdType", action, descriptor));
      log.writeLine(getMessage("FileFullNameFullName", fullName));

      if (action === "add" && isImportableType(type)) {
        count += 1;
        await send(status, getMessage("ItemIndexOfCountTypeNameKeyedName", String(count), String(importableItemsCount), type, keyedName));
        if (verbose) {
          console.writeLine(getMessage("ImportingKeyedNameTypeNumberOfCount", keyedName, type, String(count), String(importableItemsCount)));
        } else {
          console.write(".");
          if (count % 60 === 0) console.write("\n");
        }
      } else {
        if (verbose) console.writeLine(getMessage("PostActions"));
        await send(status, getMessage("PostActions"));
      }

      const doFullCheck = action !== "delete";
      if (await importHelper.lookups.skipsExistingAdd(item, importContext.merge)) {
        log.writeLine(getMessage("ItemSuccessfullySkippedKeyIdType", descriptor));
      } else {
        if (equalsIgnoreCase(type, "sql") && !sqlItemsDeleted) {
          log.writeLine(getMessage("DeleteSQLItemsOfThePackagePackageNameFromTheDatabase", packageName));
          await importHelper.deleteSqlItems(selectNodes("AML/Item", packageDom) as XmlElement[]);
          sqlItemsDeleted = true;
          log.writeLine(getMessage("DoneDeletingSQLItemsOfThePackagePackageNameFromTheDatabase", packageName));
        }
        await checker.doChecking(delayedResolution, document, log, doFullCheck);
        try {
          await importHelper.lookups.doImport(document, importContext.merge);
        } catch (error) {
          if (!(error instanceof CItemException) || doFullCheck) throw error;
          await send(host.messages.getWarningMessage(), getMessage("WarningTryToResolve", error.message));
          await checker.doChecking(delayedResolution, document, log, true);
          await importHelper.lookups.doImport(document, importContext.merge);
        }
        id = getAttribute(item, "id");
        log.writeLine(getMessage("ItemSuccessfullyAppliedActionKeyIdType", action, descriptor));
      }

      if (action === "add" && isImportableType(type)) {
        log.writeLine(getMessage("AddingItemIntoPackageDefinitionWthIdAndType", id, type));
        if (await itemHelper.lookups.isVersionable(type)) {
          log.writeLine(getMessage("GettingConfigIdOfVersionableItemIdType", id, type));
          id = (await itemHelper.lookups.getConfigId(id, type)) ?? "";
        }
        const label = await importHelper.getLabelOfItemType(type);
        const added = await definition.addElement2Group(keyedName, type, label, id);
        log.writeLine(getMessage(added ? "ItemSuccessfullyAddedInPackdefinitionIdType" : "ItemAlreadyExistInPackdefinitionIdType", id, type));
      }
    }

    await send(status, getMessage("DelayedResolutionOfUnresolvedReferences"));
    console.writeLine(getMessage("DelayedResolutionOfUnresolvedReferences"));
    await delayedResolution.executeDelayedResolution(itemHelper, log);
    console.writeLine(getMessage("Completed"));
    log.writeLine(getMessage("Completed"));
    await send(status, getMessage("Completed"));
  }
}
