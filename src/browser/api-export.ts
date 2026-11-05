import { allPackagesTable, fromManifestTable, useImportTable } from "../cli/console-modes.js";
import { type RequestedItem, type SelectionOutcome, SelectionRefused, resolveItems, resolvePackages } from "../cli/export-selection.js";
import { EXPORT_ACTION, SUExportContext } from "../export/export-context.js";
import type { ReferencesToUnknownPackages } from "../export/export-context.js";
import { hostLanguageList, hostLanguageProblem, languageResourcesAction } from "../export/language-host.js";
import { ImportExportManager } from "../export/import-export-manager.js";
import type { SelectionTable } from "../export/import-export-manager.js";
import { MemoryVfs } from "../host/memory-fs.js";
import { posix } from "../io/path.js";
import type { Engine } from "../engines.js";
import { OptionError, type OnItemErrorOption, type OperationResult, RunReporter, ensureFolder, readLog, resultOf } from "./api-run.js";
import type { RunOptions } from "./api-run.js";
import { createBrowserHost } from "./host.js";
import type { Session } from "./api-session.js";

/**
 * `exportPackages`: the browser's `export` (HOST-272). It runs the host sequence of HOST-009 — context, the selection of HOST-010 to
 * HOST-022, `ExportSolutions` — on the logged-in session, with the files in a tree in memory.
 *
 * @spec HOST-272 HOST-273 HOST-009 HOST-010 HOST-015 HOST-102 HOST-110 HOST-120 HOST-121 HOST-007 HOST-031 EXP-518 EXP-571
 */

const UNKNOWN_REFERENCES: Readonly<Record<string, ReferencesToUnknownPackages>> = {
  "remove-silently": "RemoveSilently",
  "remove-with-warning": "RemoveWithWarning",
  "do-not-remove": "DoNotRemove",
};

/** How a manifest names the items of an export (HOST-110, HOST-120). */
export type ManifestMode = "from-manifest" | "use-import";

/** What `exportPackages` takes. Exactly one of `packages`, `items`, `manifest` and `allPackages` says what to export (HOST-272). */
export interface ExportOptions extends RunOptions {
  /** Whole packages, by name (HOST-015). */
  packages?: readonly string[];
  /** Items, by type and id (HOST-010). */
  items?: readonly RequestedItem[];
  /** A manifest in the tree; `manifestMode` says how its packages become items (HOST-110, HOST-120). */
  manifest?: string;
  manifestMode?: ManifestMode;
  /** Every package of the database (HOST-121). */
  allPackages?: boolean;
  /** The folder the packages go into, in the tree; default `/export`. */
  workingDirectory?: string;
  /** The engine's export level (the `--level` of the CLI). */
  level?: string;
  /** Also exports the items the exported items refer to (the CLI's `--export-referenced`). */
  exportReferencedItems?: boolean;
  /** What to do with references to elements of packages that are not exported (EXP-600); default `do-not-remove`. */
  unknownReferences?: "remove-silently" | "remove-with-warning" | "do-not-remove";
  /** The answer to the error question of a failed item, or a function that gives it (EXP-516); refused by 14.35. */
  onItemError?: OnItemErrorOption;
  /** 14.35: the languages to export, as a list or as the CLI's text (`*` or `de,fr`). */
  languages?: string | readonly string[];
  /** 14.35: `only` exports language resources alone, `with-metadata` exports the items with their translations (LP-100). */
  languageResources?: "only" | "with-metadata";
  /** 14.35: how many items of a package are exported at once (EXP-551). */
  parallelism?: number;
}

/** What `exportPackages` resolves with: the common result and the files the export wrote. */
export interface ExportResult extends OperationResult {
  /** Every file under `workingDirectory`, by its path relative to it. */
  files: Map<string, Uint8Array>;
}

/** `languageResources` and `languages`, with the checks of the CLI (HOST-031, LP-101). */
function languageSettings(options: ExportOptions, engine: Engine): { action: string; languages: string[] | null } {
  const mode = options.languageResources;
  const given = options.languages;
  if (mode === undefined && given === undefined) return { action: EXPORT_ACTION, languages: null };
  const flag = mode !== undefined ? "languageResources" : "languages";
  if (engine !== "14.35") throw new OptionError(`${flag} needs engine 14.35; engine ${engine} has no language-resource export (HOST-031)`);
  const action = mode === undefined ? EXPORT_ACTION : languageResourcesAction(mode);
  if (action === undefined) throw new OptionError(`languageResources is only or with-metadata, not '${String(mode)}'`);
  if (given === undefined) throw new OptionError("languageResources needs languages: the list of languages to export cannot be empty (LP-101)");
  const languages = hostLanguageList(typeof given === "string" ? given : given.join(","));
  if (languages.length === 0) throw new OptionError("languages needs a list of language codes, or *");
  if (hostLanguageProblem(action, languages) !== null) {
    throw new OptionError("languages must include en, unless the list starts with * (the console host refuses it, LP-101)");
  }
  return { action, languages };
}

/** The checks that come before the first request (HOST-272). */
function checkExportOptions(options: ExportOptions, engine: Engine): void {
  const selections = [options.packages !== undefined, options.items !== undefined, options.manifest !== undefined, options.allPackages === true];
  if (selections.filter(Boolean).length !== 1) {
    throw new OptionError("export needs exactly one of packages, items, manifest and allPackages to say what to export");
  }
  if (options.packages !== undefined) {
    if (options.packages.length === 0 || options.packages.includes("")) throw new OptionError("packages needs package names");
    const repeated = options.packages.find((name, index) => options.packages?.indexOf(name) !== index);
    if (repeated !== undefined) throw new OptionError(`package '${repeated}' is given twice`);
  }
  if (options.items !== undefined && options.items.length === 0) throw new OptionError("items needs at least one item");
  if (options.manifest !== undefined && options.manifest === "") throw new OptionError("manifest needs the path of a manifest in the tree");
  if (options.manifestMode !== undefined && options.manifest === undefined) throw new OptionError("manifestMode needs a manifest");
  const unknown = options.unknownReferences;
  if (unknown !== undefined && !Object.hasOwn(UNKNOWN_REFERENCES, unknown)) {
    throw new OptionError(`unknownReferences is remove-silently, remove-with-warning or do-not-remove, not '${String(unknown)}'`);
  }
  const answer = options.onItemError;
  if (typeof answer === "string" && answer !== "continue" && answer !== "abort-package") {
    throw new OptionError(`onItemError is continue or abort-package, not '${answer}'`);
  }
  if (answer !== undefined && engine === "14.35") {
    throw new OptionError("onItemError is not supported with engine 14.35: the engine stops the whole export at the first failed item (EXP-571)");
  }
  if (options.parallelism !== undefined) {
    if (engine !== "14.35") throw new OptionError(`parallelism needs engine 14.35; engine ${engine} exports one item at a time (HOST-007)`);
    if (!Number.isInteger(options.parallelism) || options.parallelism < 1) throw new OptionError("parallelism is a whole number of 1 or more");
  }
  if (options.workingDirectory === "") throw new OptionError("workingDirectory needs a folder");
}

/**
 * Exports the selected packages or items into `workingDirectory` of a tree, and resolves with the files, the log, the messages and
 * the summary (HOST-272). An engine or lookup failure rejects with the library's own error; the tree keeps what was written.
 */
export async function exportPackages(session: Session, options: ExportOptions): Promise<ExportResult> {
  const engine = session.engine;
  checkExportOptions(options, engine);
  const { action, languages } = languageSettings(options, engine);
  options.signal?.throwIfAborted();
  return session.run(async () => {
    const vfs = options.vfs ?? new MemoryVfs();
    const host = createBrowserHost({ fs: vfs, osUser: options.osUser ?? session.userName });
    const workingDirectory = options.workingDirectory ?? "/export";
    const logPath = options.logPath ?? "/aras-pkg-logs/export.log";
    ensureFolder(vfs, posix.dirname(logPath));

    const context = new SUExportContext();
    context.action = action;
    context.languages = languages;
    context.level = options.level ?? null;
    context.exportReferencedItems = options.exportReferencedItems === true;
    context.refToUnknownPacks = UNKNOWN_REFERENCES[options.unknownReferences ?? "do-not-remove"] as ReferencesToUnknownPackages;
    context.url = session.url;
    context.dataBase = session.database;
    context.userName = session.userName;
    context.workingDirectory = workingDirectory;
    context.verbose = options.verbose === true;
    context.logFilePath = logPath;
    context.timeout = session.timeoutMs;
    const consoleMode = options.manifest !== undefined || options.allPackages === true;
    if (options.manifest !== undefined) context.manifestFile = options.manifest;
    context.useImport = options.manifestMode === "use-import";

    const reporter = new RunReporter("export", {
      ...(options.onMessage === undefined ? {} : { onMessage: options.onMessage }),
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
      ...(options.onItemError === undefined ? {} : { onItemError: options.onItemError }),
    });
    if (session.versionGate?.skipped === true) {
      reporter.note("warning", `Aras server ${session.serverVersionText} is outside the window of engine ${engine}; the run goes on because skipVersionCheck is set.`);
    }
    const helper = session.helper;
    const managerOptions = {
      console: reporter.console,
      fs: vfs,
      host: host.env,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.parallelism === undefined ? {} : { parallelism: options.parallelism }),
    };
    const abort = (): void => manager?.cancel();
    let manager: ImportExportManager | undefined;
    options.signal?.addEventListener("abort", abort);
    let selection: SelectionOutcome | undefined;
    let table: SelectionTable | undefined;
    try {
      try {
        if (consoleMode) {
          // the console tool builds the manager first, and its modes ask it for the table (HOST-102)
          manager = new ImportExportManager(context, reporter.factory, helper, managerOptions);
          if (options.allPackages === true) table = await allPackagesTable(manager);
          else if (options.manifestMode === "use-import") {
            table = useImportTable(options.manifest as string, { engine, logFilePath: logPath, fs: vfs, host: host.env });
          } else table = await fromManifestTable(manager, options.manifest as string, false);
          options.signal?.throwIfAborted();
          await manager.exportSolutions(context, table);
        } else {
          selection =
            options.packages !== undefined ? await resolvePackages(helper, options.packages) : await resolveItems(helper, options.items as readonly RequestedItem[]);
          for (const warning of selection.warnings) reporter.note("warning", warning);
          // a signal raised during the lookups ends the call before the export starts, which a cancel could not (EXP-518)
          options.signal?.throwIfAborted();
          manager = new ImportExportManager(context, reporter.factory, helper, managerOptions);
          await manager.exportSolutions(context, selection.insertions);
        }
      } finally {
        reporter.flush();
      }
    } catch (error) {
      if (error instanceof SelectionRefused) {
        for (const warning of error.warnings) reporter.note("warning", warning);
        for (const line of error.lines) reporter.note("error", line);
      }
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }

    const aborted = options.signal?.aborted === true;
    const entries = selection?.packages ?? (table === undefined ? [] : [...table.entries()].map(([name, inner]) => ({ name, items: inner.count })));
    return {
      vfs,
      files: vfs.exists(workingDirectory) ? vfs.snapshot(workingDirectory) : new Map(),
      log: readLog(vfs, logPath),
      messages: reporter.messages,
      summary: {
        operation: "export",
        engine,
        server: session.serverVersionText,
        result: resultOf(0, reporter.counts.errors, aborted),
        returnCode: 0,
        aborted,
        messages: reporter.counts,
        packages: entries.map((entry) => ({ ...entry })),
      },
    };
  });
}
