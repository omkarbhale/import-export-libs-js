import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Engine } from "../engines.js";
import { SUExportContext } from "../export/export-context.js";
import type { ReferencesToUnknownPackages } from "../export/export-context.js";
import { ImportExportManager, RUN_ENGINES } from "../export/import-export-manager.js";
import type { SelectionTable } from "../export/import-export-manager.js";
import type { OnItemError } from "../export/messages.js";
import { USE_IMPORT_ENGINES, allPackagesTable, fromManifestTable, useImportTable } from "./console-modes.js";
import { EXIT, exitCodeOf } from "./exit.js";
import {
  type RequestedItem,
  type SelectionOutcome,
  SelectionRefused,
  parseItemLines,
  parseItems,
  resolveItems,
  resolvePackages,
} from "./export-selection.js";
import type { CliIo } from "./io.js";
import {
  CONNECTION_OPTIONS,
  type OptionValues,
  flagOf,
  listOf,
  parseOptions,
  requireEngine,
  resolveConnection,
  resolveEngine,
  resolveLogPath,
  stringOf,
} from "./options.js";
import { Reporter } from "./reporter.js";
import { describeFailure, openSession } from "./session.js";
import { type Summary, printSummary, summaryText } from "./summary.js";
import { EXPORT_USAGE, UsageError } from "./usage.js";

const UNKNOWN_REFERENCE_MODES: Readonly<Record<string, ReferencesToUnknownPackages>> = {
  "remove-silently": "RemoveSilently",
  "remove-with-warning": "RemoveWithWarning",
  "do-not-remove": "DoNotRemove",
};

/** Where the items of a run come from (HOST-001, HOST-100). */
type Source =
  | { kind: "items"; items: RequestedItem[] }
  | { kind: "stdin"; items: RequestedItem[] }
  | { kind: "packages"; names: string[] }
  | { kind: "use-import"; manifest: string }
  | { kind: "from-manifest"; manifest: string }
  | { kind: "all-packages" };

/** The sources that are the console tool's modes: they build the engine's table themselves (HOST-100). */
type ConsoleSource = Extract<Source, { kind: "use-import" | "from-manifest" | "all-packages" }>;

const isConsoleSource = (source: Source): source is ConsoleSource =>
  source.kind === "use-import" || source.kind === "from-manifest" || source.kind === "all-packages";

/**
 * The manifest of `--use-import` or `--from-manifest`, as an absolute path to a file that exists. A missing file is a usage error:
 * the console tool would fall back to every package, and the CLI asks for that with `--all-packages` (HOST-101).
 *
 * @spec HOST-101
 */
function resolveManifest(option: string, path: string, io: CliIo): string {
  if (path === "") throw new UsageError(`${option} needs the path of a manifest`);
  const absolute = resolve(io.cwd(), path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new UsageError(`${option} '${path}': the manifest file does not exist`);
  return absolute;
}

/**
 * The output folder as the engine's working directory: absolute, and only checked for being a folder that can exist. It need not
 * exist and need not be empty; the engine's own handling of its package folders is reproduced (HOST-006).
 *
 * @spec HOST-006
 */
function resolveOutDir(outDir: string, io: CliIo): string {
  if (outDir === "" || outDir.includes("\0")) throw new UsageError("export needs a folder to export into");
  const absolute = resolve(io.cwd(), outDir);
  let nearest = absolute;
  while (!existsSync(nearest) && dirname(nearest) !== nearest) nearest = dirname(nearest);
  if (existsSync(nearest) && !statSync(nearest).isDirectory()) {
    throw new UsageError(`the output folder '${outDir}' cannot be made: '${nearest}' is not a folder`);
  }
  return absolute;
}

/**
 * The one source of the items: arguments, `-` for standard input, `--package`, or one of the console tool's modes (HOST-001 to
 * HOST-004, HOST-100). Standard input is read here, after the arguments have been checked and before any request.
 *
 * @spec HOST-001 HOST-003 HOST-004 HOST-100 HOST-101
 */
async function resolveSource(rest: readonly string[], values: OptionValues, io: CliIo): Promise<Source> {
  const packages = listOf(values, "package");
  const useImport = stringOf(values, "use-import");
  const fromManifest = stringOf(values, "from-manifest");
  const allPackages = flagOf(values, "all-packages");
  const modes = [
    ...(useImport === undefined ? [] : ["--use-import"]),
    ...(fromManifest === undefined ? [] : ["--from-manifest"]),
    ...(allPackages ? ["--all-packages"] : []),
  ];
  if (modes.length > 0) {
    if (modes.length > 1) throw new UsageError(`${modes.join(" and ")} cannot be combined: each chooses what to export`);
    if (rest.length > 0 || packages.length > 0) {
      throw new UsageError(`${modes[0]} cannot be combined with items, '-' or --package: it chooses what to export`);
    }
    if (useImport !== undefined) return { kind: "use-import", manifest: resolveManifest("--use-import", useImport, io) };
    if (fromManifest !== undefined) return { kind: "from-manifest", manifest: resolveManifest("--from-manifest", fromManifest, io) };
    return { kind: "all-packages" };
  }
  if (packages.length > 0) {
    if (rest.length > 0) throw new UsageError("--package cannot be combined with items or '-'");
    if (packages.includes("")) throw new UsageError("--package needs a package name");
    const repeated = packages.find((name, index) => packages.indexOf(name) !== index);
    if (repeated !== undefined) throw new UsageError(`--package '${repeated}' is given twice`);
    return { kind: "packages", names: packages };
  }
  if (rest.length === 0) {
    throw new UsageError(
      "export needs the items to export: Type:id arguments, '-' for standard input, --package <name>, --use-import <manifest>, --from-manifest <manifest> or --all-packages",
    );
  }
  if (rest.includes("-")) {
    if (rest.length > 1) throw new UsageError("'-' (standard input) cannot be combined with other items");
    if (flagOf(values, "password-stdin")) throw new UsageError("'-' and --password-stdin both read standard input");
    const items = parseItemLines(await io.readStdin());
    if (items.length === 0) throw new UsageError("standard input holds no items");
    return { kind: "stdin", items };
  }
  return { kind: "items", items: parseItems(rest) };
}

/** @spec HOST-007 HOST-008 */
function exportOptions(values: OptionValues, engine: Engine): { context: SUExportContext; onItemError: OnItemError | undefined } {
  const context = new SUExportContext();
  context.level = stringOf(values, "level") ?? null;
  context.exportReferencedItems = flagOf(values, "export-referenced");
  const mode = stringOf(values, "unknown-references");
  if (mode !== undefined && !Object.hasOwn(UNKNOWN_REFERENCE_MODES, mode)) {
    throw new UsageError(`--unknown-references is remove-silently, remove-with-warning or do-not-remove, not '${mode}'`);
  }
  context.refToUnknownPacks = mode === undefined ? "DoNotRemove" : (UNKNOWN_REFERENCE_MODES[mode] as ReferencesToUnknownPackages);
  const answer = stringOf(values, "on-item-error");
  if (answer !== undefined && answer !== "continue" && answer !== "abort-package") {
    throw new UsageError(`--on-item-error is continue or abort-package, not '${answer}'`);
  }
  if (answer !== undefined && engine === "14.35") {
    throw new UsageError("--on-item-error is not supported with engine 14.35: the engine stops the whole export at the first failed item");
  }
  return { context, onItemError: answer };
}

/**
 * The table of a console mode, chosen by the source (HOST-110, HOST-120, HOST-121).
 *
 * @spec HOST-110 HOST-120 HOST-121
 */
async function consoleSelection(source: ConsoleSource, manager: ImportExportManager, logFilePath: string | null, engine: Engine): Promise<SelectionTable> {
  if (source.kind === "use-import") return useImportTable(source.manifest, { engine, logFilePath });
  if (source.kind === "from-manifest") return fromManifestTable(manager, source.manifest, false);
  return allPackagesTable(manager);
}

/** The packages of a console mode's table in the order the engine enumerates them, empty ones included (HOST-130). */
function describeTable(table: SelectionTable | undefined): Array<{ name: string; items: number }> {
  return table === undefined ? [] : [...table.entries()].map(([name, inner]) => ({ name, items: inner.count }));
}

function exportText(summary: Summary, packages: ReadonlyArray<{ name: string; items: number }>): string {
  const flat: Summary = { ...summary, packages: packages.length, items: packages.reduce((total, entry) => total + entry.items, 0) };
  const lines = summaryText(flat);
  const list = packages.map(({ name, items }) => `  ${name}: ${items} item(s)\n`).join("");
  // the package list follows the count it belongs to
  return lines.replace(/^(packages: \d+\n)/m, `$1${list}`);
}

/**
 * `export <outDir> [Type:id…] | - | --package <name>…`: the local checks of HOST-005, then the host sequence of HOST-009 — context,
 * login, the selection of HOST-010 to HOST-022, `ExportSolutions`, logout. The console modes build the manager first and ask it
 * for the table (HOST-102).
 *
 * @spec HOST-001 HOST-005 HOST-009 HOST-030 HOST-102 HOST-130
 */
export async function exportCommand(args: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    ...CONNECTION_OPTIONS,
    package: { type: "string", multiple: true },
    "use-import": { type: "string" },
    "from-manifest": { type: "string" },
    "all-packages": { type: "boolean" },
    level: { type: "string" },
    "export-referenced": { type: "boolean" },
    "unknown-references": { type: "string" },
    "on-item-error": { type: "string" },
  });
  if (flagOf(values, "help")) {
    io.stdout.write(EXPORT_USAGE);
    return EXIT.ok;
  }
  const engine = resolveEngine(values, io);
  const [folder, ...rest] = positionals;
  if (folder === undefined) throw new UsageError("export needs the output folder: aras-pkg export <outDir> [Type:id…]");
  const outDir = resolveOutDir(folder, io);
  const source = await resolveSource(rest, values, io);
  const { context, onItemError } = exportOptions(values, engine);
  requireEngine(engine, RUN_ENGINES);
  if (source.kind === "use-import") requireEngine(engine, USE_IMPORT_ENGINES);
  const connection = await resolveConnection(values, io);
  const logPath = resolveLogPath(values, "export", io);

  context.action = "Export";
  context.url = connection.url;
  context.dataBase = connection.database;
  context.userName = connection.user;
  context.password = connection.password;
  context.workingDirectory = outDir;
  context.verbose = flagOf(values, "verbose");
  context.logFilePath = logPath;
  context.timeout = connection.timeout;
  // the console tool names its manifest in the context, which the engine's constructor reads (HOST-102)
  if (isConsoleSource(source) && source.kind !== "all-packages") context.manifestFile = source.manifest;
  context.useImport = source.kind === "use-import";

  const reporter = new Reporter(io, { engine, ...(onItemError === undefined ? {} : { onItemError }) });
  let returnCode: number = EXIT.failed;
  let failure: string | undefined;
  let refusal: SelectionRefused | undefined;
  let server: string | undefined;
  let selection: SelectionOutcome | undefined;
  let consoleTable: SelectionTable | undefined;
  try {
    const helper = await openSession(engine, connection, io, reporter);
    server = helper.innovatorVersion?.fullString;
    try {
      const managerOptions = { console: reporter.console, now: io.now };
      if (isConsoleSource(source)) {
        // ConsoleUpgrade builds the manager first, and its modes ask it for the table (HOST-102)
        const manager = new ImportExportManager(context, reporter.messages, helper, managerOptions);
        consoleTable = await consoleSelection(source, manager, context.logFilePath, engine);
        await manager.exportSolutions(context, consoleTable);
      } else {
        selection = source.kind === "packages" ? await resolvePackages(helper, source.names) : await resolveItems(helper, source.items);
        for (const warning of selection.warnings) reporter.warn(warning);
        const manager = new ImportExportManager(context, reporter.messages, helper, managerOptions);
        await manager.exportSolutions(context, selection.insertions);
      }
      returnCode = EXIT.ok;
    } finally {
      await helper.logout();
    }
  } catch (error) {
    if (error instanceof SelectionRefused) {
      refusal = error;
      for (const warning of error.warnings) reporter.warn(warning);
      for (const line of error.lines) reporter.error(line);
    } else {
      failure = describeFailure(error);
      reporter.error(failure);
    }
  }

  const exitCode = refusal !== undefined || failure !== undefined ? EXIT.failed : exitCodeOf(returnCode, reporter.counts.errors);
  const packages = refusal === undefined ? (selection?.packages ?? describeTable(consoleTable)) : [];
  const { info, warnings, errors, packages: packageMessages } = reporter.counts;
  const summary: Summary = {
    command: "export",
    engine,
    result:
      refusal !== undefined ? "refused" : exitCode === EXIT.ok ? "success" : exitCode === EXIT.engineErrors ? "completed with engine errors" : "failed",
    exitCode,
    url: connection.url,
    database: connection.database,
    user: connection.user,
    server,
    outDir,
    source: source.kind,
    packages: packages.map((entry) => ({ ...entry })),
    items: packages.reduce((total, entry) => total + entry.items, 0),
    noPackage: refusal !== undefined && refusal.noPackage.length > 0 ? [...refusal.noPackage] : undefined,
    notFound: refusal !== undefined && refusal.notFound.length > 0 ? [...refusal.notFound] : undefined,
    log: logPath,
    messages: { info, warnings, errors, packages: packageMessages },
    error: failure,
  };
  printSummary(io, flagOf(values, "json"), summary, exportText({ ...summary, packages: undefined, items: undefined }, packages));
  return exitCode;
}
