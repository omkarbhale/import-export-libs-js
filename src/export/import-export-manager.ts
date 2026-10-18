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
import { fileExists } from "../io/host-path.js";
import type { PathEnvironment } from "../io/host-path.js";
import { DuplicateKeyError, ManifestFile, NetfxHashtable } from "../manifest/index.js";
import { innerText, selectNodes } from "../xml/index.js";
import type { XmlDocument, XmlElement } from "../xml/index.js";
import type { SUExportContext, SolutionUpgradeContext } from "./export-context.js";
import type { ExportItem } from "./export-item.js";
import { type Message, type MessagesFactory, getMessage } from "./messages.js";
import { createOutputDir } from "./output-folder.js";
import { PackageDefinitionManager } from "./package-definition-manager.js";
import {
  type RemovedReference,
  type UnknownReferenceRemovalProvider,
  packageItem,
} from "./package-item.js";
import { RunLog, invariantDateTime, logInputParameters } from "./run-log.js";

/** The engines whose export run is built; the rest wait for their variant slices. */
export const RUN_ENGINES: readonly Engine[] = ["14.0.7"];

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
  /** Supplies the removal of references to unknown packages, asked for when the context's mode is not `DoNotRemove` (EXP-514). */
  unknownReferences?: UnknownReferenceRemovalProvider;
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
 * logged-in helper, a context and a messages factory, and runs one export at a time. The import half is built by the import slices.
 *
 * @spec EXP-500 EXP-502 EXP-503 EXP-507 EXP-508 EXP-509 EXP-510 EXP-511 EXP-512 EXP-513 EXP-514 EXP-515 EXP-516 EXP-517 EXP-518
 * @spec EXP-519 EXP-520 EXP-540 EXP-541 EXP-542 EXP-543 EXP-544
 */
export class ImportExportManager {
  /** The manifest the context named, loaded by the constructor when the file exists; an export never uses it. */
  readonly manifestFile: ManifestFile | null;
  readonly itemHelper: CItemHelper;
  /** What the engine's `IOWrapper` is to the port: the host the files are written on (its current directory and platform). */
  readonly environment: PathEnvironment;

  private readonly engine: Engine;
  private readonly now: () => Date;
  private readonly unknownReferences: UnknownReferenceRemovalProvider | undefined;
  private state: ProgressState = "idle";

  /**
   * An export manager. A null `itemHelper` is checked first, then a null `context`. The constructor takes the working directory as
   * the manifest directory, applies the context's timeout to the connection (WIRE-031), and loads the manifest the context names
   * when that file exists: a file that is not well-formed XML fails the constructor. `messagesFactory` is not checked.
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
    const { now, unknownReferences, ...environment } = options;
    this.environment = environment;
    this.now = now ?? (() => new Date());
    this.unknownReferences = unknownReferences;

    itemHelper.applyTimeout(context.timeout);
    const manifestPath = context.manifestFile;
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

  private timestamp(): string {
    return invariantDateTime(this.now());
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
        warning.text = getMessage("TheDatabaseContainsNoPackageDefinitionsPleaseSelectAnotherDatabaseAndTryAgain");
        await warning.execute();
        return null;
      }
      return responseDom(response);
    } catch (thrown) {
      if (!(thrown instanceof CItemException)) throw thrown;
      const text = getMessage("ErrorMessageStringDetailCode", thrown.faultstring, thrown.faultdetail, String(thrown.faultcode));
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

    const log = RunLog.open(exportContext.logFilePath, this.environment);
    try {
      const version = this.itemHelper.innovatorVersion;
      if (version === undefined) throw new NullReferenceException();
      log.writeLine(logInputParameters(exportContext, version, this.engine));

      const packages = await this.getSolutions2Xml();
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
        const text = getMessage("ErrorMessageMessage", thrown.message);
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
    currentPackage.text = getMessage("ExportingPackagePackageName", packageName);
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
   * @spec EXP-513 EXP-514 EXP-515 EXP-516 EXP-517 EXP-518
   */
  async exportProc(
    exportContext: SUExportContext,
    directory: string,
    items: NetfxHashtable<ExportItem>,
    packageName: string,
    log: RunLog,
  ): Promise<void> {
    log.writeLine(getMessage("ExportSolutionName", packageName));
    log.writeLine(getMessage("StartOfExecutionDateTime", this.timestamp()));
    const status = this.messages.getStatusMessage();
    this.itemHelper.folder = directory;
    const excludedRefs = exportContext.refToUnknownPacks === "DoNotRemove" ? null : new NetfxHashtable<RemovedReference>("the removed references");
    const count = items.count;
    let index = 1;
    for (const [, item] of items.entries()) {
      if (this.isCancelled()) {
        status.text = getMessage("ExportWasCanceledByUser");
        await status.execute();
        log.writeLine(status.text);
        log.writeLine(getMessage("EndOfExecutionDateTime", this.timestamp()));
        return;
      }
      status.text = getMessage("ItemIndexOfCountTypeNameKeyedName", String(index), String(count), item.typeName, item.keyedName);
      await status.execute();
      try {
        await packageItem(this.itemHelper, item, packageName, exportContext.level, excludedRefs, this.unknownReferences, this.environment);
        log.writeLine(getMessage("ItemIdKeyedNameTypeSuccessfullyExported", item.idName, item.keyedName, item.typeName));
      } catch (thrown) {
        if (!(thrown instanceof CItemException)) throw thrown;
        const failed = getMessage("ErrorOfExportingItemIdKeyedNameType", item.idName, item.keyedName, item.typeName);
        status.text = failed;
        await status.execute();
        log.writeLine(failed);
        const code = String(thrown.faultcode);
        log.writeLine(getMessage("ErrorMessageStringDetailCode", thrown.faultstring, thrown.faultdetail, code));
        const question = this.messages.getErrorMessageQuestion();
        question.text = getMessage(
          "ErrorMessageStringDetailCodeAbortCurrentExportOfSolutionName",
          thrown.faultstring,
          thrown.faultdetail,
          code,
          packageName,
        );
        if ((await question.execute()) === true) {
          log.writeLine(getMessage("EndOfExecutionDateTime", this.timestamp()));
          status.text = getMessage("Completed");
          await status.execute();
          return;
        }
      }
      index += 1;
    }

    if (excludedRefs !== null && excludedRefs.count > 0) {
      for (const removed of excludedRefs.values()) {
        log.writeLine("\n --- REMOVED REFERENCE ---");
        log.writeLine(getMessage("From", removed.from));
        log.writeLine(getMessage("To", removed.to));
        log.writeLine(getMessage("Reason", removed.reason));
      }
      if (exportContext.refToUnknownPacks === "RemoveWithWarning") {
        const warning = this.messages.getWarningMessage();
        warning.text = getMessage(
          "ThereAreReferencesToUnknownPackagesThatWereRemovedDuringTheExportOfThePackageSolutionNameSeeLogFileForMoreDetailsSearchForWordsRemovedRefError",
          packageName,
          "REMOVED REFERENCE",
        );
        await warning.execute();
      }
    }
    log.writeLine(getMessage("EndOfExecutionDateTime", this.timestamp()));
    status.text = getMessage("Completed");
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
      currentPackage.text = getMessage("ExportingReferencedItemsFromPackageName", dependency);
      await currentPackage.execute();
      await this.exportProc(exportContext, directory, items, dependency, log);
      if (this.isCancelled()) break;
    }
  }
}
