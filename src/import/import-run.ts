import { nullReference } from "../client/dotnet.js";
import { CItemException } from "../client/fault.js";
import type { CItemHelper } from "../client/item-helper.js";
import { DEFAULT_ENGINE, ENGINE_ASSEMBLY_VERSIONS, type Engine } from "../engines.js";
import { EngineNotSupportedError } from "../client/item-helper.js";
import type { SolutionUpgradeContext } from "../export/export-context.js";
import { type Message, type MessageCatalogue, type MessagesFactory, importCatalogueOf } from "../export/messages.js";
import { PackageDefinitionManager } from "../export/package-definition-manager.js";
import { AggregateException } from "../export/parallel-for-each.js";
import { RunLog, formatWithArgs, invariantDateTime } from "../export/run-log.js";
import {
  ArgumentNullException,
  InvalidOperationException,
  NullReferenceException,
  OperationCanceledException,
  PathNotUsableError,
} from "../io/errors.js";
import type { PathEnvironment } from "../io/host-path.js";
import type { ManifestFile } from "../manifest/manifest-file.js";
import { getSolutionPath } from "../manifest/solution-path.js";
import type { XmlDocument, XmlElement } from "../xml/dom.js";
import { selectNodes, selectSingleNode } from "../xml/xpath.js";
import { outerXml } from "../xml/writer-legacy.js";
import type { CollectedErrors } from "./collected-errors.js";
import { DelayedResolutionManager } from "./delayed-resolution.js";
import type { SUImportContext } from "./import-context.js";
import type { ImportHelper } from "./import-helper.js";
import { ImportWorkItem } from "./import-work-item.js";
import { getItemsFromPackageDom, isImportableType } from "./items.js";
import { loadPackageDom } from "./load-package-dom.js";
import type { LogWriter } from "./load-package-dom.js";
import { ReferenceChecker } from "./reference-checks.js";

/** The engines whose import run is built; the rest wait for their variant slices. */
export const IMPORT_RUN_ENGINES: readonly Engine[] = ["12.0", "14.0.7", "14.35"];

/** Where a run is, for `Cancel` (IMP-409). */
export type ProgressState = "idle" | "inProgress" | "cancelled";

/**
 * The engine host's standard output, which `ImportProc` writes to (IMP-421). `writeLine` ends the line with the host's line
 * terminator, which the sink decides, and `write` adds nothing. The CLI sends it to stderr.
 */
export interface ConsoleWriter {
  write(text: string): void;
  writeLine(text?: string): void;
  /**
   * Turns the highlight of the lines of an item on or off (IMP-550). The engine sets the console's foreground colour to yellow for them
   * once an error has been collected and restores it afterwards; the port tells the output and leaves the colouring to it.
   */
  setHighlight?(on: boolean): void;
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
  /** The collected-errors mode's fields, which belong to the manager and outlive a run (IMP-540). */
  readonly collected: CollectedErrors;
  readonly environment: PathEnvironment;
  readonly console: ConsoleWriter;
  now(): Date;
  /** `GetSolutions2Xml` (IMP-405). */
  getSolutions2Xml(): Promise<XmlDocument | null>;
  getState(): ProgressState;
  setState(state: ProgressState): void;
}

/** The buffer of a `StreamWriter` that has no size given: 1024 characters (IMP-412). */
const STREAM_WRITER_BUFFER = 1024;

/**
 * The in-memory log of one package: a `StreamWriter` over a `MemoryStream` (IMP-406). The 12.0 engine reads the stream without
 * flushing the writer, so only the full buffers the writer has passed on are there (IMP-412).
 */
class PackageLog implements LogWriter {
  private readonly parts: string[] = [];

  constructor(private readonly flushesBeforeRead = true) {}

  writeLine(text = ""): void {
    this.parts.push(text, "\r\n");
  }

  /**
   * What the stream holds when it is read: everything, or in 12.0 the first `1024 × ⌊(N − 1) / 1024⌋` UTF-16 code units of the `N`
   * written. A high surrogate that ends the last block stays in the encoder and is lost with the tail.
   *
   * @spec IMP-406 IMP-412
   */
  get text(): string {
    const all = this.parts.join("");
    if (this.flushesBeforeRead) return all;
    const cut = all.length <= STREAM_WRITER_BUFFER ? 0 : STREAM_WRITER_BUFFER * Math.floor((all.length - 1) / STREAM_WRITER_BUFFER);
    const kept = all.slice(0, cut);
    const last = kept.charCodeAt(kept.length - 1);
    return last >= 0xd800 && last <= 0xdbff ? kept.slice(0, -1) : kept;
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
 * `LogError`: the error block of a failed run, written to the log (IMP-407). In 14.35 it first turns `AutoFlush` on for the log
 * writer, so what follows reaches the file at once; the port writes the log when it is disposed, which is the same text. The 12.0
 * engine makes three writes: a line that starts with an LF, the message with no line end, and the closing line, so the stars follow
 * the message directly. Only the run's log is written that way: 12.0 collects no errors.
 *
 * @spec IMP-407 IMP-470
 */
export function logError(error: Error, log: LogWriter, engine: Engine = DEFAULT_ENGINE): void {
  if (engine === "12.0") {
    log.writeLine("\n\t\t****ErrorMessage****");
    (log as RunLog).write(error.message);
    log.writeLine("\t\t********************");
    return;
  }
  log.writeLine(importCatalogueOf(engine)("ErrorMessageMessageEnd", error.message));
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

/** `TimeSpan.ToString()` of a span of 100-nanosecond ticks: `[d.]hh:mm:ss[.fffffff]`, the fraction left out when it is exactly zero (IMP-514). */
export function formatTimeSpan(ticks: bigint): string {
  const perSecond = 10_000_000n;
  const seconds = ticks / perSecond;
  const fraction = ticks % perSecond;
  const days = seconds / 86_400n;
  const two = (value: bigint): string => value.toString().padStart(2, "0");
  const clock = `${two((seconds / 3_600n) % 24n)}:${two((seconds / 60n) % 60n)}:${two(seconds % 60n)}`;
  return `${days > 0n ? `${days}.` : ""}${clock}${fraction > 0n ? `.${fraction.toString().padStart(7, "0")}` : ""}`;
}

/** A stopwatch in 100-nanosecond ticks (`Stopwatch.StartNew`): `elapsed` reads it, `restart` starts it again. */
function startStopwatch(): { elapsed(): bigint; restart(): void } {
  let started = process.hrtime.bigint();
  return {
    elapsed: () => (process.hrtime.bigint() - started) / 100n,
    restart: () => {
      started = process.hrtime.bigint();
    },
  };
}

/** What one `ImportProc` holds while it runs: the manager's per-package fields and the locals that its helper steps share (IMP-420). */
interface PackageRun {
  readonly packageName: string;
  readonly log: PackageLog;
  readonly importContext: SUImportContext;
  readonly status: Message;
  readonly packageDom: XmlDocument;
  readonly definition: PackageDefinitionManager;
  readonly checker: ReferenceChecker;
  /** The package's delayed-resolution queue (IMP-200). */
  readonly delayedResolution: DelayedResolutionManager;
  /** `_AmlBachDelayedResolutionManager`, the batch queue, which every flush replaces (IMP-520). */
  batchQueue: DelayedResolutionManager;
  /** `_importWorkItemsList`, the work items waiting for a batch (IMP-511). */
  readonly queue: ImportWorkItem[];
  readonly importableItemsCount: number;
  /** `_currentNumber` (IMP-423). */
  currentNumber: number;
  /** `_sqlItemsRemoved` (IMP-425). */
  sqlItemsDeleted: boolean;
  /** The AML batch mode of the context, which only 14.35 has (IMP-500). */
  readonly batchMode: boolean;
  /** The collected-errors mode of the context, which only 14.35 has (IMP-500). */
  readonly collect: boolean;
}

/**
 * The import half of the engine's `ImportExportManager`: `ImportSolutions` and what it calls (IMP-400 to IMP-471, and for 14.35
 * the AML batch mode and the collected-errors mode, IMP-500 to IMP-551). A run imports the packages in dependency order, one
 * `DatabaseUpgrade` row and one buffered log per package, and stops at the first package that fails, unless errors are collected.
 *
 * @spec IMP-400 IMP-403 IMP-404 IMP-405 IMP-406 IMP-407 IMP-408 IMP-409 IMP-410 IMP-411 IMP-420 IMP-421 IMP-422 IMP-423 IMP-424
 * @spec IMP-425 IMP-426 IMP-427 IMP-428 IMP-429 IMP-430 IMP-431 IMP-470 IMP-471
 * @spec IMP-500 IMP-511 IMP-513 IMP-514 IMP-515 IMP-516 IMP-517 IMP-518 IMP-519 IMP-520 IMP-521 IMP-522 IMP-523 IMP-524 IMP-526 IMP-527
 * @spec IMP-540 IMP-541 IMP-542 IMP-543 IMP-544 IMP-545 IMP-546 IMP-547 IMP-548 IMP-549 IMP-550 IMP-551
 */
export class ImportRun {
  /** `ResourceManager.GetMessage` of the engine's catalogue (IMP-470). */
  private readonly message: MessageCatalogue;

  constructor(private readonly host: ImportRunHost) {
    if (!IMPORT_RUN_ENGINES.includes(host.engine)) throw new EngineNotSupportedError(host.engine);
    this.message = importCatalogueOf(host.engine);
  }

  private timestamp(): string {
    return invariantDateTime(this.host.now());
  }

  /** True when the collected-errors mode is on: the setting exists in 14.35 only (IMP-500). */
  private collecting(importContext: SUImportContext): boolean {
    return this.host.engine === "14.35" && importContext.collectImportErrors;
  }

  /**
   * `ImportSolutions(packagesToImportList, importContext)`: returns 0 when every package ended without an exception (a
   * cancelled one included, bug IMP-409), and 1 for an empty list or the first failure. The log is opened before the guarded
   * block, so a failure to open it escapes as it is (IMP-403). With collected errors on, a run that collected errors returns their
   * count (IMP-546).
   *
   * @spec IMP-400 IMP-403 IMP-404 IMP-407 IMP-408 IMP-546 IMP-547
   */
  async importSolutions(packages: readonly (string | null)[] | null, importContext: SUImportContext | null): Promise<number> {
    if (importContext === null) throw new ArgumentNullException("importContext");
    const { host } = this;
    host.setState("inProgress");
    const status = host.messages.getStatusMessage();
    const log = RunLog.open(host.context.logFilePath, host.environment);
    const collect = this.collecting(importContext);
    try {
      try {
        // IMP-403: 12.0 writes no header and never reads the server version
        if (host.engine !== "12.0") {
          const version = host.itemHelper.innovatorVersion;
          if (version === undefined) throw new NullReferenceException();
          log.writeLine(importInputParameters(host.context, importContext, version.fullString, ENGINE_ASSEMBLY_VERSIONS[host.engine]));
        }
        log.writeLine(this.message("StartOfImportingPackages"));
        const solutions = await host.getSolutions2Xml();
        const warnings: string[] = [];
        if (host.manifestFile === null) throw new NullReferenceException();
        const names = host.manifestFile.getPackageNamesInImportOrder(packages, solutions, warnings);
        for (const warning of warnings) log.writeLine(warning);
        if (names.length === 0) return 1;
        for (const name of names) await this.importPackage(importContext, log, name);
        if (collect && host.collected.exceptions.length > 0) throw new AggregateException([...host.collected.exceptions]);
      } catch (error) {
        if (endsTheRunUnhandled(error)) throw error;
        if (collect && error instanceof AggregateException) return await this.reportCollectedErrors(error, log);
        const failure = error as Error;
        logError(failure, log, host.engine);
        await send(host.messages.getErrorMessage(), this.message("ErrorMessageMessage", failure.message));
        return 1;
      }
      await send(status, this.message("Completed"));
      host.setState("idle");
      return 0;
    } finally {
      log.dispose();
    }
  }

  /**
   * The handler of `ImportSolutions` for the aggregate of the collected errors: the aggregate and then each leaf error are logged,
   * one `error` message holds the report, and the run returns the count `CollectException` made (IMP-546). The `completed` status
   * is not sent and the progress state is not reset.
   *
   * @spec IMP-546 IMP-550
   */
  private async reportCollectedErrors(aggregate: AggregateException, log: RunLog): Promise<number> {
    const { host } = this;
    logError(aggregate, log, host.engine);
    let text = "\r\n";
    for (const failed of aggregate.innerExceptions as Error[]) {
      text += `${failed.message}\r\n`;
      // `innerException as AggregateException` is dereferenced: the elements `ImportPackage` collects all have one (IMP-546)
      const leaves = (failed as InvalidOperationException).innerException;
      if (!(leaves instanceof AggregateException)) throw new NullReferenceException();
      for (const leaf of leaves.innerExceptions as Error[]) {
        text += "\r\n\r\n";
        logError(leaf, log, host.engine);
        text += `${leaf.message}\r\n`;
      }
    }
    await send(host.messages.getErrorMessage(), this.message("ErrorMessageMessage", text));
    return host.collected.count;
  }

  /**
   * `ImportPackage`: one package between two audit-row writes, with a log of its own that reaches the run's log in one write
   * when the package ends, whether it succeeded or failed (IMP-406). A failure writes the failed status, which may fail in
   * turn and then replaces the original error (bug IMP-411), and is wrapped (IMP-407).
   *
   * In 14.35 the package log is written through to the file and not held until the package ends; the file has the same text
   * once the package has ended. A cancel is a failure there: when `ImportProc` returns with the state *cancelled* the package
   * throws an `OperationCanceledException`, and the failure path takes it (IMP-409). With collected errors on, the package that
   * collected errors, or was cancelled, fails as an aggregate, is recorded as failed and lets the run go on with the next package
   * unless the limit is reached or the run was cancelled (IMP-545).
   *
   * @spec IMP-406 IMP-407 IMP-409 IMP-411 IMP-545 IMP-547 IMP-548
   */
  private async importPackage(importContext: SUImportContext, commonLog: RunLog, packageName: string): Promise<void> {
    const { host } = this;
    const { importHelper, collected } = host;
    const collect = this.collecting(importContext);
    const log = new PackageLog(host.engine !== "12.0");
    try {
      log.writeLine(this.message("StartOfExecutionDateTime", this.timestamp()));
      try {
        log.writeLine(this.message("UpdatingPackageNamePackageToInprogressReleaseStatus", packageName));
        await importHelper.writeReleaseData(packageName, 0, importContext.release, importContext.description);
        await this.importProc(packageName, log, importContext);
        if (host.engine === "14.35" && host.getState() === "cancelled") {
          const cancelled = new OperationCanceledException(this.message("ImportWasCanceledByUser"));
          if (!collect) throw cancelled;
          this.packageExceptions().push(cancelled);
        }
        if (collect && (collected.packageExceptions?.length ?? 0) > 0) throw new AggregateException([...this.packageExceptions()]);
        log.writeLine(this.message("UpdatingPackageNamePackageToSuccessReleaseStatus", packageName));
        await importHelper.writeReleaseData(packageName, 1, importContext.release, importContext.description);
      } catch (error) {
        // a CItemException that left the steps is collected, and made the aggregate of the package (IMP-545)
        if (collect && error instanceof CItemException) {
          this.packageExceptions().push(error);
          throw new AggregateException([...this.packageExceptions()]);
        }
        throw error;
      }
    } catch (error) {
      if (endsTheRunUnhandled(error)) throw error;
      log.writeLine(this.message("UpdatingPackageNamePackageToFailedReleaseStatus", packageName));
      if (collect && error instanceof AggregateException) {
        // a failed write of the status joins the package's errors, and an aggregate of them replaces the one that was caught (IMP-545)
        let aggregate = error;
        try {
          await importHelper.writeReleaseData(packageName, 2, importContext.release, importContext.description);
        } catch (writeError) {
          if (!(writeError instanceof CItemException)) throw writeError;
          this.packageExceptions().push(writeError);
          aggregate = new AggregateException([...this.packageExceptions()]);
        }
        const failure = new InvalidOperationException(this.failedText(packageName, aggregate), aggregate);
        collected.exceptions.push(failure);
        if (host.getState() === "cancelled" || this.thresholdExceeded(importContext)) throw new AggregateException([...collected.exceptions]);
      } else {
        await importHelper.writeReleaseData(packageName, 2, importContext.release, importContext.description);
        throw new InvalidOperationException(this.failedText(packageName, error as Error), error);
      }
    } finally {
      log.writeLine(this.message("EndOfExecutionDateTime", this.timestamp()));
      commonLog.write(log.text);
    }
  }

  /**
   * The text of `ImportPackagePackageNameFailedWithMessageUpdatingPackageNameToFailedReleaseStatus` for a failed package, which is the
   * message of its exception (IMP-407): 14.0.7 and 14.35 put CRLF around the template, 12.0's template carries its own LF.
   */
  private failedText(packageName: string, error: Error): string {
    const text = this.message("ImportPackagePackageNameFailedWithMessageUpdatingPackageNameToFailedReleaseStatus", packageName, error.message, packageName);
    return this.host.engine === "12.0" ? text : `\r\n${text}\r\n`;
  }

  /**
   * `_collectedPackageExceptions`, which an `Add` dereferences: it is null until the first `ImportProc`, so a failure of the very
   * first audit-row write of the manager's life is a null reference (bug IMP-548).
   *
   * @spec IMP-548
   */
  private packageExceptions(): Error[] {
    const { packageExceptions } = this.host.collected;
    if (packageExceptions === null) throw new NullReferenceException();
    return packageExceptions;
  }

  /**
   * `IsCollectImportErrorsThresholdExceeded`: the count of the manager is compared with `>=` the limit, so a limit of 0 or less trips on
   * the first error and a limit of `n` lets `n - 1` errors by (IMP-541).
   *
   * @spec IMP-541 IMP-545
   */
  private thresholdExceeded(importContext: SUImportContext): boolean {
    return this.host.collected.count >= importContext.collectImportErrorsMaxCount;
  }

  /**
   * `CollectException`: counts the error, reports it on the `error` channel and in the package log, and ends the run's package with an
   * aggregate of what the package collected once the limit is reached (IMP-541).
   *
   * @spec IMP-541 IMP-550
   */
  private async collectException(run: PackageRun, error: unknown): Promise<void> {
    const { host } = this;
    const failure = error as Error;
    this.packageExceptions().push(failure);
    host.collected.count += 1;
    await send(host.messages.getErrorMessage(), this.message("ErrorMessageMessage", failure.message));
    logError(failure, run.log, host.engine);
    if (this.thresholdExceeded(run.importContext)) throw new AggregateException([...this.packageExceptions()]);
  }

  /**
   * `ImportProc`: the items of one package, in order (IMP-420). Each item is read and described in the log (IMP-422), counted
   * (IMP-423), skipped when it exists in non-merge mode (IMP-424), checked and imported with one retry of a failed delete
   * (IMP-427), and an added item is registered in the package definition (IMP-429). A cancel ends the package with a normal
   * return (bug IMP-409).
   *
   * In 14.35 the AML batch mode queues the items without Relationships and sends them in one `<AML>` (IMP-511), and the
   * collected-errors mode gathers the failure of each step and goes on (IMP-542).
   *
   * @spec IMP-420 IMP-421 IMP-422 IMP-423 IMP-424 IMP-425 IMP-426 IMP-427 IMP-428 IMP-429 IMP-430 IMP-431 IMP-441
   * @spec IMP-511 IMP-518 IMP-519 IMP-520 IMP-522 IMP-524 IMP-527 IMP-542 IMP-543 IMP-544 IMP-551
   */
  private async importProc(packageName: string, log: PackageLog, importContext: SUImportContext): Promise<void> {
    const { host } = this;
    const { console, itemHelper, importHelper } = host;
    const verbose = host.context.verbose;
    // `_importWorkItemsList.Clear()` and the package's own list of collected errors (IMP-540)
    host.collected.packageExceptions = [];
    const is12 = host.engine === "12.0";
    // IMP-421: 12.0's console writes start with an LF and end no line; the others end the line
    const consoleWrite = (text: string): void => (is12 ? console.write(`\n${text}`) : console.writeLine(text));
    const banner = this.message(importContext.merge ? "ImportWithMergeOptionPackageName" : "ImportPackageName", packageName);
    // the console banner of 12.0 has seven spaces also when the package log's has six
    consoleWrite(is12 && !importContext.merge ? ` ${banner}` : banner);
    log.writeLine(banner);
    if (verbose) consoleWrite(this.message("BuildingSolution"));
    const status = host.messages.getStatusMessage();
    await send(status, this.message("BuildingSolution"));
    if (host.manifestFile === null) throw new NullReferenceException();
    const solutionPath = getSolutionPath(packageName, host.manifestDirectory, host.manifestFile, host.engine);
    const packageDom = loadPackageDom(solutionPath, log, { engine: host.engine, environment: host.environment });
    const items = getItemsFromPackageDom(packageDom);
    await send(status, this.message("AddingPackageDefinintionForPackageName", packageName));
    const definition = await PackageDefinitionManager.open(itemHelper, packageName, true);
    const warnings: string[] = [];
    await definition.addDependencyInfo(host.manifestFile.getDependsOnInfo(packageName), warnings);
    for (const warning of warnings) log.writeLine(this.message("WARNINGImportingPackageNamePackageWarn", packageName, warning));

    if (!verbose) console.writeLine();
    const run: PackageRun = {
      packageName,
      log,
      importContext,
      status,
      packageDom,
      definition,
      checker: new ReferenceChecker(itemHelper),
      delayedResolution: new DelayedResolutionManager(host.engine),
      batchQueue: new DelayedResolutionManager(host.engine),
      queue: [],
      importableItemsCount: getImportableItemsCount(items),
      currentNumber: 0,
      sqlItemsDeleted: false,
      batchMode: host.engine === "14.35" && importContext.amlBatchMode,
      collect: this.collecting(importContext),
    };

    for (const document of items) {
      if (host.getState() === "cancelled") {
        const text = this.message("ImportWasCanceledByUser");
        await send(status, text);
        log.writeLine(text);
        return;
      }
      const workItem = new ImportWorkItem(document, importContext, host.engine);
      await this.logWorkItem(run, workItem);

      if (await importHelper.lookups.skipsExistingAdd(workItem.itemNode, importContext.merge)) {
        log.writeLine(this.message("ItemSuccessfullySkippedKeyIdType", workItem.keyIdType));
      } else {
        // the queue the item's checks run against is the one that is current now; a flush replaces it (IMP-527)
        const checkQueue = run.batchMode ? run.batchQueue : run.delayedResolution;
        try {
          await this.checkWorkItem(run, checkQueue, workItem);
        } catch (error) {
          if (endsTheRunUnhandled(error)) throw error;
          try {
            if (!run.batchMode) throw error;
            await this.resolveBatchCheck(run, checkQueue, workItem, error as Error);
          } catch (inner) {
            if (!run.collect || endsTheRunUnhandled(inner)) throw inner;
            await this.collectException(run, inner);
          }
        }
        try {
          if (run.batchMode) {
            if (!workItem.isSuitableForBatching()) {
              if (run.queue.length > 0) await this.tryToFlushAmlBatch(run, true);
              await this.importSingleWorkItem(run, workItem);
              await this.postWorkItem(run, workItem);
            } else {
              run.queue.push(workItem);
              await this.tryToFlushAmlBatch(run, false);
            }
          } else {
            await this.importSingleWorkItem(run, workItem);
          }
        } catch (error) {
          if (!run.collect || endsTheRunUnhandled(error)) throw error;
          await this.collectException(run, error);
        }
      }

      if (!run.batchMode) {
        try {
          await this.postWorkItem(run, workItem);
        } catch (error) {
          if (!run.collect || endsTheRunUnhandled(error)) throw error;
          await this.collectException(run, error);
        }
      }
    }

    if (run.batchMode) {
      try {
        await this.tryToFlushAmlBatch(run, true);
      } catch (error) {
        if (!run.collect || endsTheRunUnhandled(error)) throw error;
        await this.collectException(run, error);
      }
    }
    await send(status, this.message("DelayedResolutionOfUnresolvedReferences"));
    // IMP-421: 12.0 ends the first of these two with a line end and the second with none
    if (is12) console.writeLine(`\n${this.message("DelayedResolutionOfUnresolvedReferences")}`);
    else console.writeLine(this.message("DelayedResolutionOfUnresolvedReferences"));
    try {
      await run.delayedResolution.executeDelayedResolution(itemHelper, log);
      if (is12) console.write(`\n${this.message("Completed")}`);
      else console.writeLine(this.message("Completed"));
      log.writeLine(this.message("Completed"));
      await send(status, this.message("Completed"));
    } catch (error) {
      if (!run.collect || endsTheRunUnhandled(error)) throw error;
      await this.collectException(run, error);
    }
  }

  /**
   * `LogWorkItem`: the item's two log lines, then the count, the progress on the console and the `status` message (IMP-421 to
   * IMP-423). Once an error has been collected the console highlights these lines (IMP-550).
   *
   * @spec IMP-421 IMP-422 IMP-423 IMP-550
   */
  private async logWorkItem(run: PackageRun, workItem: ImportWorkItem): Promise<void> {
    const { host } = this;
    const { console } = host;
    const verbose = host.context.verbose;
    const highlight = host.collected.count > 0;
    const is12 = host.engine === "12.0";
    const consoleWrite = (text: string): void => (is12 ? console.write(`\n${text}`) : console.writeLine(text));
    try {
      if (highlight) console.setHighlight?.(true);
      const { action, workItemType: type, originalKeyedName: keyedName } = workItem;
      run.log.writeLine(this.message("ProcessingActionKeyIdType", action, workItem.keyIdType));
      // IMP-422: 12.0 stamps no path on the item, so it has no line for it
      if (!is12) run.log.writeLine(this.message("FileFullNameFullName", workItem.originalFullFileName));
      if (action === "add" && isImportableType(type)) {
        run.currentNumber += 1;
        const count = String(run.currentNumber);
        const total = String(run.importableItemsCount);
        await send(run.status, this.message("ItemIndexOfCountTypeNameKeyedName", count, total, type, keyedName));
        if (verbose) {
          consoleWrite(this.message("ImportingKeyedNameTypeNumberOfCount", keyedName, type, count, total));
        } else {
          console.write(".");
          if (run.currentNumber % 60 === 0) console.write("\n");
        }
      } else {
        if (verbose) consoleWrite(this.message("PostActions"));
        await send(run.status, this.message("PostActions"));
      }
    } finally {
      if (highlight) console.setHighlight?.(false);
    }
  }

  /**
   * `CheckWorkItem`: the one-time deletion of the package's SQL items (IMP-425), then the reference checks of the item against a
   * delayed-resolution queue (IMP-100). In the batch mode the queue is the batch queue (IMP-520).
   *
   * @spec IMP-425 IMP-426 IMP-427
   */
  private async checkWorkItem(run: PackageRun, queue: DelayedResolutionManager, workItem: ImportWorkItem): Promise<void> {
    const { importHelper } = this.host;
    if (equalsIgnoreCase(workItem.workItemType, "sql") && !run.sqlItemsDeleted) {
      run.log.writeLine(this.message("DeleteSQLItemsOfThePackagePackageNameFromTheDatabase", run.packageName));
      await importHelper.deleteSqlItems(selectNodes("AML/Item", run.packageDom) as XmlElement[]);
      run.sqlItemsDeleted = true;
      run.log.writeLine(this.message("DoneDeletingSQLItemsOfThePackagePackageNameFromTheDatabase", run.packageName));
    }
    await run.checker.doChecking(queue, workItem.item, run.log, workItem.thoroughCheck);
  }

  /**
   * The recovery of a failed check in the batch mode: the warning, a forced flush of what waits so that what the check may depend on
   * exists, and the same check again after the item's original text is restored (IMP-518).
   *
   * @spec IMP-518 IMP-527
   */
  private async resolveBatchCheck(run: PackageRun, queue: DelayedResolutionManager, workItem: ImportWorkItem, failure: Error): Promise<void> {
    run.log.writeLine(this.message("AMLBatchCheckDependenciesWarning", failure.message));
    await send(this.host.messages.getWarningMessage(), this.message("WarningTryToResolve", failure.message));
    run.log.writeLine(this.message("TryToResolveAMLBatchCheckDependencies", failure.message));
    await this.tryToFlushAmlBatch(run, true);
    workItem.restoreOriginalXml();
    await this.checkWorkItem(run, queue, workItem);
  }

  /**
   * `ImportSingleWorkItem`: sends the item with `doImport(item, bMerge)`. A failed delete is retried once: the first refusal sends
   * the warning, the full check runs and the delete is sent again (IMP-427). The id is then read again from the element the work
   * item was made with, and the success is logged (IMP-428).
   *
   * @spec IMP-427 IMP-428 IMP-516 IMP-519 IMP-525 IMP-526
   */
  private async importSingleWorkItem(run: PackageRun, workItem: ImportWorkItem): Promise<void> {
    const { host } = this;
    const { importHelper } = host;
    try {
      await importHelper.lookups.doImport(workItem.item, run.importContext.merge);
    } catch (error) {
      if (host.engine === "12.0") {
        // IMP-427: 12.0 sends an error for every failed doImport and has no warning for the retry
        if (!(error instanceof CItemException)) throw error;
        await send(host.messages.getErrorMessage(), this.message("ErrorMessageItem", error.message));
        if (workItem.thoroughCheck) throw error;
        try {
          await run.checker.doChecking(run.delayedResolution, workItem.item, run.log, true);
        } catch (recheck) {
          if (recheck instanceof CItemException) await send(host.messages.getErrorMessage(), this.message("ErrorMessageItem", recheck.message));
          throw recheck;
        }
      } else {
        if (!(error instanceof CItemException) || workItem.thoroughCheck) throw error;
        await send(host.messages.getWarningMessage(), this.message("WarningTryToResolve", error.message));
        await run.checker.doChecking(run.delayedResolution, workItem.item, run.log, true);
      }
      await importHelper.lookups.doImport(workItem.item, run.importContext.merge);
    }
    workItem.id = getAttribute(workItem.itemNode, "id");
    run.log.writeLine(this.message("ItemSuccessfullyAppliedActionKeyIdType", workItem.action, workItem.keyIdType));
  }

  /**
   * `PostWorkItem`: an added item of an importable type is registered in the package definition, under its config id when its type is
   * versionable (IMP-429). An add made by `where` has an empty id (IMP-430).
   *
   * @spec IMP-429 IMP-430 IMP-431 IMP-513 IMP-522 IMP-544
   */
  private async postWorkItem(run: PackageRun, workItem: ImportWorkItem): Promise<void> {
    const { itemHelper, importHelper } = this.host;
    const type = workItem.workItemType;
    if (workItem.action !== "add" || !isImportableType(type)) return;
    run.log.writeLine(this.message("AddingItemIntoPackageDefinitionWthIdAndType", workItem.id, type));
    if (await itemHelper.lookups.isVersionable(type)) {
      run.log.writeLine(this.message("GettingConfigIdOfVersionableItemIdType", workItem.id, type));
      workItem.id = (await itemHelper.lookups.getConfigId(workItem.id, type)) ?? "";
    }
    const label = await importHelper.getLabelOfItemType(type);
    const added = await run.definition.addElement2Group(workItem.originalKeyedName, type, label, workItem.id);
    run.log.writeLine(
      this.message(added ? "ItemSuccessfullyAddedInPackdefinitionIdType" : "ItemAlreadyExistInPackdefinitionIdType", workItem.id, type),
    );
  }

  /**
   * `TryToFlushAmlBatch`: sends the queued items in one `ApplyAML` and registers them (IMP-513). A non-forced flush does nothing while
   * the queue holds fewer items than the maximum (IMP-511). Any failure restores every item and imports it alone, and the items after
   * the first that fails there are dropped (IMP-516, IMP-517). Whatever happens the queue is emptied and the batch queue replaced.
   *
   * @spec IMP-511 IMP-512 IMP-513 IMP-514 IMP-515 IMP-516 IMP-517 IMP-520 IMP-521 IMP-523 IMP-525 IMP-551
   */
  private async tryToFlushAmlBatch(run: PackageRun, force: boolean): Promise<void> {
    const { host } = this;
    const { importHelper, itemHelper } = host;
    if (!force && run.queue.length < run.importContext.amlBatchMaxSize) return;
    try {
      run.log.writeLine(this.message("TryToBatchAML"));
      const stopwatch = startStopwatch();
      let aml = "<AML>";
      for (const workItem of run.queue) {
        await importHelper.lookups.doImportInContext(workItem.item, run.importContext);
        aml += outerXml(workItem.item);
      }
      aml += "</AML>";
      const answer = await itemHelper.inn.applyAML(aml);
      if (answer.isError) throw CItemException.fromResponse(answer, host.engine);
      const batchTime = formatTimeSpan(stopwatch.elapsed());
      stopwatch.restart();
      for (const workItem of run.queue) {
        workItem.id = getAttribute(workItem.itemNode, "id");
        await this.postWorkItem(run, workItem);
      }
      run.delayedResolution.addDelayedAmls(run.batchQueue.getDelayedAmls());
      run.log.writeLine(this.message("TryToBatchAMLSuccess", batchTime, formatTimeSpan(stopwatch.elapsed())));
    } catch (error) {
      if (endsTheRunUnhandled(error)) throw error;
      const failure = error as Error;
      run.log.writeLine(this.message("TryToBatchAMLFailed", failure.message));
      await send(host.messages.getWarningMessage(), this.message("WarningTryToResolve", failure.message));
      run.log.writeLine(this.message("TryToExecuteAMLOneByOne"));
      for (const workItem of run.queue) {
        workItem.restoreOriginalXml();
        await this.checkWorkItem(run, run.delayedResolution, workItem);
        await this.importSingleWorkItem(run, workItem);
        await this.postWorkItem(run, workItem);
      }
    } finally {
      run.queue.length = 0;
      run.batchQueue = new DelayedResolutionManager(host.engine);
    }
  }
}
