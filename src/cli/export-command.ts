import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Engine } from "../engines.js";
import { SUExportContext } from "../export/export-context.js";
import type { ReferencesToUnknownPackages } from "../export/export-context.js";
import { ImportExportManager, RUN_ENGINES } from "../export/import-export-manager.js";
import type { OnItemError } from "../export/messages.js";
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

/** Where the items of a run come from (HOST-001). */
type Source = { kind: "items"; items: RequestedItem[] } | { kind: "stdin"; items: RequestedItem[] } | { kind: "packages"; names: string[] };

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
 * The one source of the items: arguments, `-` for standard input, or `--package` (HOST-001 to HOST-004). Standard input is read
 * here, after the arguments have been checked and before any request.
 *
 * @spec HOST-001 HOST-003 HOST-004
 */
async function resolveSource(rest: readonly string[], values: OptionValues, io: CliIo): Promise<Source> {
  const packages = listOf(values, "package");
  if (packages.length > 0) {
    if (rest.length > 0) throw new UsageError("--package cannot be combined with items or '-'");
    if (packages.includes("")) throw new UsageError("--package needs a package name");
    const repeated = packages.find((name, index) => packages.indexOf(name) !== index);
    if (repeated !== undefined) throw new UsageError(`--package '${repeated}' is given twice`);
    return { kind: "packages", names: packages };
  }
  if (rest.length === 0) {
    throw new UsageError("export needs the items to export: Type:id arguments, '-' for standard input, or --package <name>");
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

function exportText(summary: Summary, packages: ReadonlyArray<{ name: string; items: number }>): string {
  const flat: Summary = { ...summary, packages: packages.length, items: packages.reduce((total, entry) => total + entry.items, 0) };
  const lines = summaryText(flat);
  const list = packages.map(({ name, items }) => `  ${name}: ${items} item(s)\n`).join("");
  // the package list follows the count it belongs to
  return lines.replace(/^(packages: \d+\n)/m, `$1${list}`);
}

/**
 * `export <outDir> [Type:id…] | - | --package <name>…`: the local checks of HOST-005, then the host sequence of HOST-009 — context,
 * login, the selection of HOST-010 to HOST-022, `ExportSolutions`, logout.
 *
 * @spec HOST-001 HOST-005 HOST-009 HOST-030
 */
export async function exportCommand(args: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    ...CONNECTION_OPTIONS,
    package: { type: "string", multiple: true },
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

  const reporter = new Reporter(io, { engine, ...(onItemError === undefined ? {} : { onItemError }) });
  let returnCode: number = EXIT.failed;
  let failure: string | undefined;
  let refusal: SelectionRefused | undefined;
  let server: string | undefined;
  let selection: SelectionOutcome | undefined;
  try {
    const helper = await openSession(engine, connection, io, reporter);
    server = helper.innovatorVersion?.fullString;
    try {
      selection = source.kind === "packages" ? await resolvePackages(helper, source.names) : await resolveItems(helper, source.items);
      for (const warning of selection.warnings) reporter.warn(warning);
      const manager = new ImportExportManager(context, reporter.messages, helper, { console: reporter.console, now: io.now });
      await manager.exportSolutions(context, selection.insertions);
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
  const packages = refusal === undefined ? (selection?.packages ?? []) : [];
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
