import { CItemException } from "../client/fault.js";
import { DotNetException, isNullReference, isXPathException, isXmlException } from "../client/dotnet.js";
import { responseDom } from "../client/answer.js";
import { EngineNotSupportedError, type CItemHelper } from "../client/item-helper.js";
import { TransportError } from "../client/transport.js";
import type { Engine } from "../engines.js";
import {
  ArgumentException,
  ArgumentNullException,
  IOException,
  NullReferenceException,
  UnauthorizedAccessException,
} from "../io/errors.js";
import { NotSupportedException } from "../xml/errors.js";
import { directoryGetParentFullName, fileExists, pathEnvironmentFor } from "../io/host-path.js";
import { pathCombine } from "../io/win-path.js";
import type { PathEnvironment } from "../io/host-path.js";
import { ImportHelper, type ImportHelperOptions } from "../import/import-helper.js";
import { ImportRun, SILENT_CONSOLE, type ConsoleWriter } from "../import/import-run.js";
import type { SUImportContext } from "../import/import-context.js";
import { DuplicateKeyError, ManifestFile, NetfxHashtable } from "../manifest/index.js";
import { innerText, selectNodes } from "../xml/index.js";
import type { XmlDocument, XmlElement } from "../xml/index.js";
import type { ExportRunState } from "./cexport-items.js";
import type { SUExportContext, SolutionUpgradeContext } from "./export-context.js";
import type { ExportItem } from "./export-item.js";
import { type Message, type MessagesFactory, getMessageFor } from "./messages.js";
import { createOutputDir } from "./output-folder.js";
import { PackageDefinitionManager } from "./package-definition-manager.js";
import { packageElementIdsByElementType } from "./package-elements.js";
import { packageItem } from "./package-item.js";
import type { RemovedReference } from "./removed-reference.js";
import { AggregateException, parallelForEach } from "./parallel-for-each.js";
import { ProgressStreamLogger } from "./progress-logger.js";
import { newRequestDictionary } from "./request-template.js";
import { RunLog, currentCultureDateTime, invariantDateTime, logInputParameters } from "./run-log.js";

/** The engines whose export run is built; the rest wait for their variant slices. */
export const RUN_ENGINES: readonly Engine[] = ["12.0", "14.0.7", "14.35"];

/**
 * How many items of a package 14.35's run starts at once. The engine's `Parallel.ForEach` has no bound (EXP-551); the port runs the
 * items one after the other until the parallel export is built, which bounds this by `--parallelism`.
 */
const ITEMS_AT_ONCE = 1;

/** Where a run is, for `Cancel` (EXP-518). */
type ProgressState = "idle" | "inProgress" | "cancelled";

/** What the host selected: package name to the items under it, each under a key. See {@link selectionTable}. */
export type SelectionInsertions = ReadonlyArray<readonly [packageName: string, items: ReadonlyArray<readonly [key: string, item: ExportItem]>]>;

/** The engine's `Hashtable` of package name to `Hashtable` of key to `ExportItem`. */
export type SelectionTable = NetfxHashtable<NetfxHashtable<ExportItem>>;

/**
 * Builds the table the host hands `ExportSolutions` from its insertions, in the order it made them: a package is added on its
 * first entry, and each item is stored under its key with the indexer, so a repeated key keeps its place and takes the new item.
 * The enumeration order of both levels, which decides the order of the whole export, comes out of that sequence (EXP-500, EXP-508,
 * EXP-514).
 *
 * @spec EXP-500
 */
export function selectionTable(insertions: SelectionInsertions): SelectionTable {
  const table: SelectionTable = new NetfxHashtable("the selected packages");
  for (const [packageName, items] of insertions) {
    let inner = table.get(packageName);
    if (inner === undefined) {
      inner = new NetfxHashtable<ExportItem>(`the selected items of package ${JSON.stringify(packageName)}`);
      table.add(packageName, inner);
    }
    for (const [key, item] of items) inner.set(key, item);
  }
  return table;
}

export interface ImportExportManagerOptions extends PathEnvironment {
  /** The clock of the log's date-times; the default is the host's. Tests inject a fixed one. */
  now?: () => Date;
  /** The host's standard output, which an import writes its banner, progress and completion to (IMP-421). Nothing by default. */
  console?: ConsoleWriter;
  /** The value of `os_user` in the audit row of an import, or a function that gives it (IMP-452). */
  osUser?: ImportHelperOptions["osUser"];
  /**
   * The culture whose general date and time pattern the 12.0 engine's log uses for three of its date-times (EXP-505), as
   * .NET names it (`en-US`, `en-IN`). The default is the culture of this process. The other engines write the invariant one.
   */
  culture?: string;
}

/**
 * The exceptions of .NET's `SystemException` family that a run can raise, which the engine's handler turns into a warning and a
 * log entry (EXP-520). A `CItemException` is not one of them, and neither is anything the port raises that .NET has no counterpart
 * for (a platform limit, a programming error): those end the run as they are.
 */
function isSystemException(error: unknown): error is Error {
  return (
    isFormatOrOverflow(error) ||
    error instanceof ArgumentException ||
    error instanceof ArgumentNullException ||
    error instanceof NullReferenceException ||
    error instanceof IOException ||
    error instanceof UnauthorizedAccessException ||
    error instanceof NotSupportedException ||
    error instanceof DuplicateKeyError ||
    error instanceof TransportError ||
    isXmlException(error) ||
    isXPathException(error) ||
    isNullReference(error)
  );
}

/** `FormatException` and `OverflowException`, which 14.35's level parse raises (EXP-022) and `Export` does not wrap. */
function isFormatOrOverflow(error: unknown): error is Error {
  return error instanceof DotNetException && (error.typeName === "System.FormatException" || error.typeName === "System.OverflowException");
}

/**
 * The engine's `ImportExportManager`, export half: `ExportSolutions` and what it calls (EXP-500 to EXP-520). It is built around a
 * logged-in helper, a context and a messages factory, and runs one export at a time. The import half is `importSolutions`, which runs `ImportRun`.
 *
 * @spec EXP-500 EXP-502 EXP-503 EXP-507 EXP-508 EXP-509 EXP-510 EXP-511 EXP-512 EXP-513 EXP-514 EXP-515 EXP-516 EXP-517 EXP-518
 * @spec EXP-519 EXP-520 EXP-540 EXP-541 EXP-542 EXP-543 EXP-544 IMP-402 IMP-405 IMP-409 IMP-410
 */
export class ImportExportManager {
  /** The manifest the context named, loaded by the constructor when the file exists; an export never uses it. */
  readonly manifestFile: ManifestFile | null;
  readonly itemHelper: CItemHelper;
  /** The folder of the manifest, which an import resolves package paths against; the working directory for an export (EXP-502, IMP-402). */
  readonly manifestDirectory: string | null;
  /** What the engine's `IOWrapper` is to the port: the host the files are written on (its current directory and platform). */
  readonly environment: PathEnvironment;

  private readonly engine: Engine;
  private readonly now: () => Date;
  private readonly console: ConsoleWriter;
  private readonly importHelper: ImportHelper;
  private readonly culture: string | undefined;
  private state: ProgressState = "idle";
  /** 14.35's per-call inputs of `Export` (EXP-002): the template dictionary and the package-element map. Empty for 14.0.7. */
  private run: ExportRunState = { requestDictionary: null, packageElementIdsByElementType: null };

  /**
   * An export manager. A null `itemHelper` is checked first, then a null `context`. The constructor takes the working directory as
   * the manifest directory, applies the context's timeout to the connection (WIRE-031), and loads the manifest the context names
   * when that file exists: a file that is not well-formed XML fails the constructor. `messagesFactory` is not checked.
   *
   * For an import (`Action` is `Import`) the manifest must exist, or the constructor throws a `CItemException` before anything
   * else is done, and the manifest directory is the manifest's parent folder (IMP-402).
   */
  constructor(
    private readonly context: SolutionUpgradeContext | null,
    private readonly messages: MessagesFactory,
    itemHelper: CItemHelper | null,
    options: ImportExportManagerOptions = {},
  ) {
    if (itemHelper === null) throw new ArgumentNullException("itemHelper");
    if (context === null) throw new ArgumentNullException("context");
    this.engine = itemHelper.engine;
    if (!RUN_ENGINES.includes(this.engine)) throw new EngineNotSupportedError(this.engine);
    this.itemHelper = itemHelper;
    const { now, console, osUser, culture, ...environment } = options;
    this.environment = pathEnvironmentFor(environment, this.engine);
    this.now = now ?? (() => new Date());
    this.culture = culture;

    this.console = console ?? SILENT_CONSOLE;
    this.importHelper = new ImportHelper(itemHelper, osUser === undefined ? {} : { osUser });

    const manifestPath = context.manifestFile;
    const isImport = context.action === "Import";
    if (isImport && !fileExists(manifestPath, this.environment)) {
      throw new CItemException(-1, "", `Manifest file '${manifestPath ?? ""}' doesn't exist`);
    }
    this.manifestDirectory = isImport && manifestPath !== null ? directoryGetParentFullName(manifestPath, this.environment) : context.workingDirectory;
    itemHelper.applyTimeout(context.timeout);
    this.manifestFile =
      manifestPath !== null && manifestPath !== "" && fileExists(manifestPath, this.environment)
        ? new ManifestFile(manifestPath, { ...this.environment, engine: this.engine })
        : null;
  }

  /** `Cancel()`: the run is cancelled at the next place that looks (EXP-518). A cancel before a run starts is overwritten by it. */
  cancel(): void {
    this.state = "cancelled";
  }

  private isCancelled(): boolean {
    return this.state === "cancelled";
  }

  /** A date-time as the engine concatenates it into the log: invariant, except in three places of the 12.0 engine's. */
  private timestamp(): string {
    return invariantDateTime(this.now());
  }

  /** `DateTime.Now.ToString()` of the current culture, which the 12.0 engine writes at the head of a package and after a cancel or an abort. */
  private localTimestamp(): string {
    return this.engine === "12.0" ? currentCultureDateTime(this.now(), this.culture) : this.timestamp();
  }

  /** `ResourceManager.GetMessage` of the engine's catalogue (EXP-504). */
  private text(key: string, ...args: (string | null | undefined)[]): string {
    return getMessageFor(this.engine, key, ...args);
  }

  /**
   * `GetSolutions2Xml`: the package definitions of the database as a document, or null with the reason sent to the host. No
   * definitions (faultcode 0) is a warning. Any other fault is sent as an error and written to the log through a second writer
   * on `LogFilePath`, which opens the file again: that works on its own, and fails when an export holds the log (bug EXP-541).
   * Anything that is not a `CItemException` is not caught.
   *
   * @spec EXP-507 EXP-541
   */
  async getSolutions2Xml(): Promise<XmlDocument | null> {
    const warning = this.messages.getWarningMessage();
    const error = this.messages.getErrorMessage();
    try {
      const response = await this.itemHelper.getSolutions();
      if (response === null) {
        warning.text = this.text("TheDatabaseContainsNoPackageDefinitionsPleaseSelectAnotherDatabaseAndTryAgain");
        await warning.execute();
        return null;
      }
      return responseDom(response);
    } catch (thrown) {
      if (!(thrown instanceof CItemException)) throw thrown;
      const text = this.text(
        this.engine === "12.0" ? "ErrorMessageGetSolutions" : "ErrorMessageStringDetailCode",
        thrown.faultstring,
        thrown.faultdetail,
        String(thrown.faultcode),
      );
      error.text = text;
      await error.execute();
      const writer = RunLog.open(this.context?.logFilePath ?? null, this.environment);
      try {
        writer.writeLine(text);
      } finally {
        writer.dispose();
      }
      return null;
    }
  }

  /**
   * `ExportSolutions(exportContext, selItemsTable)`: the whole export (EXP-500). The log is opened first and the header written;
   * the package definitions are read; then each non-empty package is exported in table order (EXP-508), the referenced elements
   * after them (EXP-519), and `imports.mf` is saved whatever happened (EXP-520). A `SystemException` inside ends the run with a
   * warning and a log entry and the call returns normally; a `CItemException` from the package-definition lookups escapes
   * (EXP-542), after the manifest is saved.
   *
   * @spec EXP-500 EXP-505 EXP-506 EXP-508 EXP-520
   */
  async exportSolutions(exportContext: SUExportContext | null, selectedItems: SelectionInsertions | SelectionTable | null): Promise<void> {
    if (exportContext === null) throw new ArgumentNullException("exportContext");
    if (selectedItems === null) throw new ArgumentNullException("selItemsTable");
    const selection = selectedItems instanceof NetfxHashtable ? selectedItems : selectionTable(selectedItems);

    // 14.0.7 opens the log first, writes its header and then asks for the package definitions; 12.0 asks first and opens the log
    // after, with no header (EXP-505 to EXP-508). So `GetSolutions2Xml`'s own writer finds the file free in 12.0 (EXP-541).
    const early = this.engine === "12.0" ? await this.getSolutions2Xml() : undefined;
    const log = RunLog.open(exportContext.logFilePath, this.environment);
    try {
      let packages: XmlDocument | null;
      if (this.engine === "12.0") {
        packages = early ?? null;
      } else {
        const version = this.itemHelper.innovatorVersion;
        if (version === undefined) throw new NullReferenceException();
        log.writeLine(logInputParameters(exportContext, version, this.engine));
        packages = await this.getSolutions2Xml();
      }
      // 14.35 builds the map of every package element of the database first (EXP-550); a missing package list ends the run here, with
      // no manifest saved. The dictionary of request templates belongs to this call (EXP-060).
      this.run =
        this.engine === "14.35"
          ? { requestDictionary: newRequestDictionary(), packageElementIdsByElementType: packageElementIdsByElementType(packages) }
          : { requestDictionary: null, packageElementIdsByElementType: null };
      const currentPackage = this.messages.getCurrentPackageMessage();
      const manifest = new ManifestFile(undefined, { ...this.environment, engine: this.engine });
      const refsToExport = new NetfxHashtable<NetfxHashtable<ExportItem>>("the referenced elements to export");
      // 14.35 joins the path of the manifest with `Combine` before the `try` block, so a null working directory fails here (EXP-511)
      const manifestPath = this.engine === "14.35" ? pathCombine(exportContext.workingDirectory, "imports.mf") : `${exportContext.workingDirectory ?? ""}\\imports.mf`;

      try {
        this.state = "inProgress";
        for (const [packageName, items] of selection.entries()) {
          if (items.count === 0) continue;
          await this.exportPackage(exportContext, packageName, items, packages, manifest, refsToExport, currentPackage, log);
          if (this.isCancelled()) break;
        }
        if (refsToExport.count > 0) await this.exportReferencedElements(exportContext, refsToExport, log);
        currentPackage.text = "";
        await currentPackage.execute();
      } catch (thrown) {
        const reported = this.reportedException(thrown);
        const warning = this.messages.getWarningMessage();
        const text = this.text("ErrorMessageMessage", reported);
        warning.text = text;
        await warning.execute();
        log.writeLine(text);
      } finally {
        this.state = "idle";
        manifest.save(manifestPath);
      }
    } finally {
      log.dispose();
    }
  }

  /**
   * What the handler of `ExportSolutions` reports for an exception that left the `try` block: the message of a `SystemException`
   * (EXP-520), and in 14.35 also of an `AggregateException` from the item loop, whose inner messages are joined with a line end
   * (EXP-556). Anything else is not the engine's to catch and goes on.
   */
  private reportedException(thrown: unknown): string {
    if (this.engine === "14.35" && thrown instanceof AggregateException) {
      const inner = thrown.innerExceptions;
      const unexpected = inner.find((error) => !isSystemException(error));
      if (unexpected !== undefined) throw unexpected;
      return inner.map((error) => (error as Error).message).join("\r\n");
    }
    if (!isSystemException(thrown)) throw thrown;
    return thrown.message;
  }

  /** One package of the loop (EXP-508 step 2): the manifest entry, the definition, the dependencies, the folder, the items. */
  private async exportPackage(
    exportContext: SUExportContext,
    packageName: string,
    items: NetfxHashtable<ExportItem>,
    packages: XmlDocument | null,
    manifest: ManifestFile,
    refsToExport: NetfxHashtable<NetfxHashtable<ExportItem>>,
    currentPackage: Message,
    log: RunLog,
  ): Promise<void> {
    const packageNode = manifest.addPackage(packageName);
    const definition = await PackageDefinitionManager.open(this.itemHelper, packageName);
    if (packages === null) throw new NullReferenceException();
    const dependencies = selectNodes(
      `.//Item[@type='PackageDefinition' and name='${packageName}']/Relationships/Item[@type='PackageDependsOn']/name`,
      packages,
    ) as XmlElement[];
    for (const node of dependencies) {
      const dependency = innerText(node);
      if (dependency === "") continue;
      const dependsOn = manifest.addDependsOn(packageNode, dependency);
      for (const element of await definition.findReferencedElements(dependency)) {
        manifest.addReferencedElement(dependsOn, element);
        if (exportContext.exportReferencedItems) this.addToRefsForExport(refsToExport, dependency, element);
      }
    }

    const directory = createOutputDir(exportContext.workingDirectory, packageName, this.environment, this.engine);
    currentPackage.text = this.text("ExportingPackagePackageName", packageName);
    await currentPackage.execute();
    await this.exportProc(exportContext, directory, items, packageName, log);
  }

  /**
   * `AddToRefsForExport(refs, dependency, item)`: the first element with an id wins. The outer table gets one `Add` per distinct
   * dependency and the inner one `Add` per distinct id, in order of first occurrence, which fixes their enumeration order (EXP-512).
   *
   * @spec EXP-512
   */
  addToRefsForExport(refs: NetfxHashtable<NetfxHashtable<ExportItem>>, dependency: string, item: ExportItem): void {
    let inner = refs.get(dependency);
    if (inner === undefined) {
      inner = new NetfxHashtable<ExportItem>(`the referenced elements of package ${JSON.stringify(dependency)}`);
      refs.add(dependency, inner);
    }
    const id = item.idName ?? "";
    if (!inner.has(id)) inner.add(id, item);
  }

  /**
   * `ExportProc`: the items of one package into `directory`, one at a time in table order (EXP-513 to EXP-518). The log gets the
   * package header first. A cancel is looked at before each item. A `CItemException` from an item is that item's failure: the
   * host is asked whether to abort the package, and the answer `true` ends it (EXP-516). Other exceptions leave.
   *
   * @spec EXP-513 EXP-514 EXP-515 EXP-516 EXP-517 EXP-518 EXP-612 EXP-613 EXP-614
   */
  async exportProc(
    exportContext: SUExportContext,
    directory: string,
    items: NetfxHashtable<ExportItem>,
    packageName: string,
    log: RunLog,
  ): Promise<void> {
    if (this.engine === "14.35") return this.exportProcOfItems(exportContext, directory, items, packageName, log);
    log.writeLine(this.text("ExportSolutionName", packageName));
    log.writeLine(this.text("StartOfExecutionDateTime", this.localTimestamp()));
    const status = this.messages.getStatusMessage();
    this.itemHelper.folder = directory;
    const excludedRefs = exportContext.refToUnknownPacks === "DoNotRemove" ? null : new NetfxHashtable<RemovedReference>("the removed references");
    const count = items.count;
    let index = 1;
    for (const [, item] of items.entries()) {
      if (this.isCancelled()) {
        status.text = this.text("ExportWasCanceledByUser");
        await status.execute();
        log.writeLine(status.text);
        log.writeLine(this.text("EndOfExecutionDateTime", this.localTimestamp()));
        return;
      }
      status.text = this.text("ItemIndexOfCountTypeNameKeyedName", String(index), String(count), item.typeName, item.keyedName);
      await status.execute();
      try {
        await packageItem(this.itemHelper, item, packageName, exportContext.level, excludedRefs, this.environment);
        log.writeLine(this.text("ItemIdKeyedNameTypeSuccessfullyExported", item.idName, item.keyedName, item.typeName));
      } catch (thrown) {
        if (!(thrown instanceof CItemException)) throw thrown;
        const failed = this.text("ErrorOfExportingItemIdKeyedNameType", item.idName, item.keyedName, item.typeName);
        status.text = failed;
        await status.execute();
        log.writeLine(this.engine === "12.0" ? this.text("ErrorOfExportingItemIdKeyedNameTypeLog", item.idName, item.keyedName, item.typeName) : failed);
        const code = String(thrown.faultcode);
        log.writeLine(this.text("ErrorMessageStringDetailCode", thrown.faultstring, thrown.faultdetail, code));
        const question = this.messages.getErrorMessageQuestion();
        question.text = this.text(
          "ErrorMessageStringDetailCodeAbortCurrentExportOfSolutionName",
          thrown.faultstring,
          thrown.faultdetail,
          code,
          packageName,
        );
        if ((await question.execute()) === true) {
          log.writeLine(this.text("EndOfExecutionDateTime", this.localTimestamp()));
          status.text = this.text("Completed");
          await status.execute();
          return;
        }
      }
      index += 1;
    }

    await this.endPackage(exportContext, packageName, excludedRefs, status, log);
  }

  /**
   * The end of a package that ran to the end (EXP-517): one block per removed reference, the warning when the mode asks for one,
   * `end of execution` in the log, and `completed`.
   *
   * @spec EXP-517
   */
  private async endPackage(
    exportContext: SUExportContext,
    packageName: string,
    excludedRefs: NetfxHashtable<RemovedReference> | null,
    status: Message,
    log: RunLog,
  ): Promise<void> {
    if (excludedRefs !== null && excludedRefs.count > 0) {
      for (const removed of excludedRefs.values()) {
        log.writeLine("\n --- REMOVED REFERENCE ---");
        log.writeLine(this.text("From", removed.from));
        log.writeLine(this.text("To", removed.to));
        log.writeLine(this.text("Reason", removed.reason));
      }
      if (exportContext.refToUnknownPacks === "RemoveWithWarning") {
        const warning = this.messages.getWarningMessage();
        warning.text = this.text(
          "ThereAreReferencesToUnknownPackagesThatWereRemovedDuringTheExportOfThePackageSolutionNameSeeLogFileForMoreDetailsSearchForWordsRemovedRefError",
          packageName,
          "REMOVED REFERENCE",
        );
        await warning.execute();
      }
    }
    log.writeLine(this.text("EndOfExecutionDateTime", this.timestamp()));
    status.text = this.text("Completed");
    await status.execute();
  }

  /**
   * 14.35's `ExportProc` (EXP-513 to EXP-518, EXP-550 to EXP-557): the same package header, then `Parallel.ForEach` over the items of
   * the table, in table order, each iteration one whole `PackageItem` call. The port starts {@link ITEMS_AT_ONCE} of them at a time.
   *
   * - A progress logger writes the success lines (EXP-554); the lines of items that finish after it was completed are lost (EXP-570).
   * - The first failed item stops the whole export: the question is sent and its answer is never read (EXP-555, EXP-571). The state
   *   becomes *cancelled*, which ends the package loop of `ExportSolutions`, and no later package is exported.
   * - A cancel is looked at at the start of each iteration (EXP-557).
   * - An exception that is not a `CItemException` stops the loop and leaves as an `AggregateException` (EXP-556).
   *
   * @spec EXP-513 EXP-514 EXP-515 EXP-517 EXP-518 EXP-551 EXP-552 EXP-553 EXP-554 EXP-555 EXP-556 EXP-557 EXP-570 EXP-571 EXP-572 EXP-573
   */
  private async exportProcOfItems(
    exportContext: SUExportContext,
    directory: string,
    items: NetfxHashtable<ExportItem>,
    packageName: string,
    log: RunLog,
  ): Promise<void> {
    log.writeLine(this.text("ExportSolutionName", packageName));
    log.writeLine(this.text("StartOfExecutionDateTime", this.timestamp()));
    const status = this.messages.getStatusMessage();
    this.itemHelper.folder = directory;
    const excludedRefs = exportContext.refToUnknownPacks === "DoNotRemove" ? null : new NetfxHashtable<RemovedReference>("the removed references");
    const count = items.count;
    // `i` is one counter for the package: an item reads it when it starts and adds one when it has succeeded (EXP-552)
    let index = 1;
    const progress = new ProgressStreamLogger(log);
    progress.start();
    try {
      await parallelForEach(items.values(), ITEMS_AT_ONCE, async (item, loop) => {
        if (this.isCancelled()) {
          progress.complete();
          loop.stop();
          status.text = this.text("ExportWasCanceledByUser");
          await status.execute();
          log.writeLine(status.text);
          log.writeLine(this.text("EndOfExecutionDateTime", this.timestamp()));
          return;
        }
        status.text = this.text("ItemIndexOfCountTypeNameKeyedName", String(index), String(count), item.typeName, item.keyedName);
        await status.execute();
        try {
          await packageItem(this.itemHelper, item, packageName, exportContext.level, excludedRefs, this.environment, this.run);
          progress.writeLine(this.text("ItemIdKeyedNameTypeSuccessfullyExported", item.idName, item.keyedName, item.typeName));
          index += 1;
        } catch (thrown) {
          if (!(thrown instanceof CItemException)) throw thrown;
          await this.stopExportAfter(thrown, item, packageName, status, progress, log, loop);
        }
      });
    } finally {
      progress.complete();
      progress.dispose();
    }
    if (this.isCancelled()) return;

    await this.endPackage(exportContext, packageName, excludedRefs, status, log);
  }

  /**
   * The handler of a failed item in 14.35 (EXP-555). It runs when the state is not *cancelled* yet; a failure after an earlier failure
   * or a cancel is dropped without a message or a log line (EXP-572). In this order: the progress logger is completed, the error
   * is sent and logged with its fault block, the abort question is sent and its answer is not read (EXP-571), the state becomes
   * *cancelled*, the log gets `end of execution`, `completed` is sent, and the loop is stopped.
   *
   * @spec EXP-555 EXP-571 EXP-572
   */
  private async stopExportAfter(
    thrown: CItemException,
    item: ExportItem,
    packageName: string,
    status: Message,
    progress: ProgressStreamLogger,
    log: RunLog,
    loop: { stop(): void },
  ): Promise<void> {
    if (this.isCancelled()) return;
    progress.complete();
    const failed = this.text("ErrorOfExportingItemIdKeyedNameType", item.idName, item.keyedName, item.typeName);
    status.text = failed;
    await status.execute();
    log.writeLine(failed);
    const code = String(thrown.faultcode);
    log.writeLine(this.text("ErrorMessageStringDetailCode", thrown.faultstring, thrown.faultdetail, code));
    const question = this.messages.getErrorMessageQuestion();
    question.text = this.text(
      "ErrorMessageStringDetailCodeAbortCurrentExportOfSolutionName",
      thrown.faultstring,
      thrown.faultdetail,
      code,
      packageName,
    );
    await question.execute();
    this.state = "cancelled";
    log.writeLine(this.text("EndOfExecutionDateTime", this.timestamp()));
    status.text = this.text("Completed");
    await status.execute();
    loop.stop();
  }

  /**
   * `ExportReferencedElements`: the second pass over the dependencies' referenced elements, each dependency into its own folder,
   * wiped first. It never adds the dependency to the manifest (bug EXP-540), and it runs after a cancel too (bug EXP-543).
   *
   * @spec EXP-519 EXP-540 EXP-543
   */
  async exportReferencedElements(
    exportContext: SUExportContext,
    refsToExport: NetfxHashtable<NetfxHashtable<ExportItem>>,
    log: RunLog,
  ): Promise<void> {
    for (const [dependency, items] of refsToExport.entries()) {
      const directory = createOutputDir(exportContext.workingDirectory, dependency, this.environment, this.engine);
      const currentPackage = this.messages.getCurrentPackageMessage();
      currentPackage.text = this.text("ExportingReferencedItemsFromPackageName", dependency);
      await currentPackage.execute();
      await this.exportProc(exportContext, directory, items, dependency, log);
      if (this.isCancelled()) break;
    }
  }

  /**
   * `ImportSolutions(packagesToImportList, importContext)`: the whole import of one or more packages of the manifest, in
   * dependency order. Returns 0 when every package ended (a cancelled one included, bug IMP-409) and 1 for an empty list or the
   * first failure. A null context throws `ArgumentNullException` before anything else happens (IMP-400).
   *
   * @spec IMP-400
   */
  async importSolutions(packages: readonly (string | null)[] | null, importContext: SUImportContext | null): Promise<number> {
    if (importContext === null) throw new ArgumentNullException("importContext");
    const run = new ImportRun({
      engine: this.engine,
      context: this.context as SolutionUpgradeContext,
      messages: this.messages,
      itemHelper: this.itemHelper,
      importHelper: this.importHelper,
      manifestFile: this.manifestFile,
      manifestDirectory: this.manifestDirectory,
      environment: this.environment,
      console: this.console,
      now: this.now,
      getSolutions2Xml: () => this.getSolutions2Xml(),
      getState: () => this.state,
      setState: (state) => {
        this.state = state;
      },
    });
    return run.importSolutions(packages, importContext);
  }
}
