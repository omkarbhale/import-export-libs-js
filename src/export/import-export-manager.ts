import { CItemException } from "../client/fault.js";
import { isNullReference, isXPathException, isXmlException } from "../client/dotnet.js";
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
import type { PathEnvironment } from "../io/host-path.js";
import { ImportHelper, type ImportHelperOptions } from "../import/import-helper.js";
import { ImportRun, SILENT_CONSOLE, type ConsoleWriter } from "../import/import-run.js";
import type { SUImportContext } from "../import/import-context.js";
import { DuplicateKeyError, ManifestFile, NetfxHashtable } from "../manifest/index.js";
import { innerText, selectNodes } from "../xml/index.js";
import type { XmlDocument, XmlElement } from "../xml/index.js";
import type { SUExportContext, SolutionUpgradeContext } from "./export-context.js";
import type { ExportItem } from "./export-item.js";
import { type Message, type MessagesFactory, messageFor } from "./messages.js";
import { createOutputDir } from "./output-folder.js";
import { PackageDefinitionManager } from "./package-definition-manager.js";
import { packageItem } from "./package-item.js";
import type { RemovedReference } from "./removed-reference.js";
import { RunLog, currentCultureDateTime, invariantDateTime, logInputParameters } from "./run-log.js";

/** The engines whose export run is built; the rest wait for their variant slices. */
export const RUN_ENGINES: readonly Engine[] = ["12.0", "14.0.7"];

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

  private message(key: string, ...args: (string | null | undefined)[]): string {
    return messageFor(this.engine, key, ...args);
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
        warning.text = this.message("TheDatabaseContainsNoPackageDefinitionsPleaseSelectAnotherDatabaseAndTryAgain");
        await warning.execute();
        return null;
      }
      return responseDom(response);
    } catch (thrown) {
      if (!(thrown instanceof CItemException)) throw thrown;
      const text = this.message(
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
      const currentPackage = this.messages.getCurrentPackageMessage();
      const manifest = new ManifestFile(undefined, { ...this.environment, engine: this.engine });
      const refsToExport = new NetfxHashtable<NetfxHashtable<ExportItem>>("the referenced elements to export");

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
        if (!isSystemException(thrown)) throw thrown;
        const warning = this.messages.getWarningMessage();
        const text = this.message("ErrorMessageMessage", thrown.message);
        warning.text = text;
        await warning.execute();
        log.writeLine(text);
      } finally {
        this.state = "idle";
        manifest.save(`${exportContext.workingDirectory ?? ""}\\imports.mf`);
      }
    } finally {
      log.dispose();
    }
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
    currentPackage.text = this.message("ExportingPackagePackageName", packageName);
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
    log.writeLine(this.message("ExportSolutionName", packageName));
    log.writeLine(this.message("StartOfExecutionDateTime", this.localTimestamp()));
    const status = this.messages.getStatusMessage();
    this.itemHelper.folder = directory;
    const excludedRefs = exportContext.refToUnknownPacks === "DoNotRemove" ? null : new NetfxHashtable<RemovedReference>("the removed references");
    const count = items.count;
    let index = 1;
    for (const [, item] of items.entries()) {
      if (this.isCancelled()) {
        status.text = this.message("ExportWasCanceledByUser");
        await status.execute();
        log.writeLine(status.text);
        log.writeLine(this.message("EndOfExecutionDateTime", this.localTimestamp()));
        return;
      }
      status.text = this.message("ItemIndexOfCountTypeNameKeyedName", String(index), String(count), item.typeName, item.keyedName);
      await status.execute();
      try {
        await packageItem(this.itemHelper, item, packageName, exportContext.level, excludedRefs, this.environment);
        log.writeLine(this.message("ItemIdKeyedNameTypeSuccessfullyExported", item.idName, item.keyedName, item.typeName));
      } catch (thrown) {
        if (!(thrown instanceof CItemException)) throw thrown;
        const failed = this.message("ErrorOfExportingItemIdKeyedNameType", item.idName, item.keyedName, item.typeName);
        status.text = failed;
        await status.execute();
        log.writeLine(this.engine === "12.0" ? this.message("ErrorOfExportingItemIdKeyedNameTypeLog", item.idName, item.keyedName, item.typeName) : failed);
        const code = String(thrown.faultcode);
        log.writeLine(this.message("ErrorMessageStringDetailCode", thrown.faultstring, thrown.faultdetail, code));
        const question = this.messages.getErrorMessageQuestion();
        question.text = this.message(
          "ErrorMessageStringDetailCodeAbortCurrentExportOfSolutionName",
          thrown.faultstring,
          thrown.faultdetail,
          code,
          packageName,
        );
        if ((await question.execute()) === true) {
          log.writeLine(this.message("EndOfExecutionDateTime", this.localTimestamp()));
          status.text = this.message("Completed");
          await status.execute();
          return;
        }
      }
      index += 1;
    }

    if (excludedRefs !== null && excludedRefs.count > 0) {
      for (const removed of excludedRefs.values()) {
        log.writeLine("\n --- REMOVED REFERENCE ---");
        log.writeLine(this.message("From", removed.from));
        log.writeLine(this.message("To", removed.to));
        log.writeLine(this.message("Reason", removed.reason));
      }
      if (exportContext.refToUnknownPacks === "RemoveWithWarning") {
        const warning = this.messages.getWarningMessage();
        warning.text = this.message(
          "ThereAreReferencesToUnknownPackagesThatWereRemovedDuringTheExportOfThePackageSolutionNameSeeLogFileForMoreDetailsSearchForWordsRemovedRefError",
          packageName,
          "REMOVED REFERENCE",
        );
        await warning.execute();
      }
    }
    log.writeLine(this.message("EndOfExecutionDateTime", this.timestamp()));
    status.text = this.message("Completed");
    await status.execute();
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
      currentPackage.text = this.message("ExportingReferencedItemsFromPackageName", dependency);
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
