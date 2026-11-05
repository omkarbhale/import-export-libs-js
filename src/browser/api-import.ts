import { EngineNotSupportedError } from "../client/item-helper.js";
import { DEFAULT_ENGINE, type Engine } from "../engines.js";
import { SolutionUpgradeContext } from "../export/export-context.js";
import { hostLanguageList, hostLanguageProblem } from "../export/language-host.js";
import { ImportExportManager } from "../export/import-export-manager.js";
import { DBUpdateConfig, DB_PATCH_ENGINES, DEFAULT_TOOL_NAME, DbPatchesNotInEngineError } from "../db-patches/index.js";
import { MemoryVfs } from "../host/memory-fs.js";
import { IMPORT_RUN_ENGINES, SUImportContext } from "../import/index.js";
import { planPackage } from "../import/plan.js";
import type { ImportPlan } from "../import/plan.js";
import { directoryGetParentFullName } from "../io/host-path.js";
import type { PathEnvironment } from "../io/host-path.js";
import { posix } from "../io/path.js";
import { LP_ENGINES, languagePackImport } from "../language-pack/index.js";
import { MANIFEST_ENGINES, ManifestFile } from "../manifest/index.js";
import { getSolutionPath } from "../manifest/solution-path.js";
import { escapeText, loadXml } from "../xml/index.js";
import type { XmlDocument } from "../xml/index.js";
import { OptionError, type OperationResult, RunReporter, ensureFolder, readLog, resultOf } from "./api-run.js";
import type { Operation, RunOptions, RunSummary } from "./api-run.js";
import type { Session } from "./api-session.js";
import { createBrowserHost } from "./host.js";
import { vfsFromZip } from "./zip.js";

/**
 * `importPackages`, `importLanguagePack`, `applyDbPatches` and `planImport`: the browser's `import`, `import-language-pack`,
 * `apply-db-patches` and `plan import` (HOST-272). Each runs the host sequence of its CLI command — IMP-480, LP-001, DBP-002, IMP-033
 * — on the logged-in session, with the package in a tree in memory.
 *
 * @spec HOST-272 HOST-273 IMP-480 LP-001 DBP-002 DBP-010 IMP-033 IMP-500 IMP-600 IMP-601 MAN-032
 */

/** Where a package comes from: a tree the caller mounted (a folder, a drop, a directory handle, a zip), or the bytes of a zip. */
export type PackageSource = MemoryVfs | { zip: Uint8Array; maxBytes?: number };

/** The engines whose client, manifest and import run are all built. */
const IMPORT_ENGINES: readonly Engine[] = IMPORT_RUN_ENGINES.filter((engine) => MANIFEST_ENGINES.includes(engine));

/** The tree of a source: the tree itself, or the zip mounted with its single top-level folder taken off (HOST-250). */
function treeOf(source: PackageSource): MemoryVfs {
  if (source instanceof MemoryVfs) return source;
  return vfsFromZip(source.zip, { root: "auto", ...(source.maxBytes === undefined ? {} : { maxBytes: source.maxBytes }) });
}

/** The settings an import and a language-pack import share (IMP-401, IMP-500, IMP-600). */
export interface ImportSettings {
  /** Merge mode: items that exist are merged instead of skipped (IMP-401). */
  merge?: boolean;
  /** The `target_release` of the audit row (IMP-451). */
  release?: string;
  /** The `description` of the audit row (IMP-451). */
  description?: string;
  /** 14.35: the languages to import, as a list or as the CLI's text (`*` or `de,fr`; IMP-600). */
  languages?: string | readonly string[];
  /** 14.35: the AML batch mode and its size (IMP-500). */
  batch?: boolean | { maxSize?: number };
  /** 14.35: the collected-errors mode and the number of errors that ends the run (IMP-500). */
  collectErrors?: boolean | { maxCount?: number };
}

/** The checks of the settings and the engine's contexts built from them, before any request (IMP-401, IMP-500, IMP-600). */
function importContextOf(settings: ImportSettings, engine: Engine, checkEn: boolean): { importContext: SUImportContext; languages: string[] | null } {
  let languages: string[] | null = null;
  if (settings.languages !== undefined) {
    if (engine !== "14.35") throw new OptionError(`languages needs engine 14.35; engine ${engine} has no language selection on import (IMP-600)`);
    languages = hostLanguageList(typeof settings.languages === "string" ? settings.languages : settings.languages.join(","));
    if (typeof settings.languages === "string" && settings.languages === "") throw new OptionError("languages needs a list of language codes, or *");
    if (checkEn && hostLanguageProblem("Import", languages) !== null) {
      throw new OptionError("languages must include en, unless the list starts with * (the console host refuses it, IMP-601)");
    }
  }
  const batch = settings.batch === true || typeof settings.batch === "object";
  const collect = settings.collectErrors === true || typeof settings.collectErrors === "object";
  if (engine !== "14.35" && (batch || collect)) {
    throw new OptionError(`${batch ? "batch" : "collectErrors"} is valid only with engine 14.35: engine ${engine} has no AML batch mode and no collected errors (IMP-500)`);
  }
  const size = typeof settings.batch === "object" ? (settings.batch.maxSize ?? 0) : 0;
  const limit = typeof settings.collectErrors === "object" ? (settings.collectErrors.maxCount ?? 0) : 0;
  for (const [name, value] of [["batch.maxSize", size], ["collectErrors.maxCount", limit]] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 2_147_483_647) throw new OptionError(`${name} is a whole number from 0 to 2147483647`);
  }
  const importContext = new SUImportContext();
  importContext.merge = settings.merge === true;
  importContext.release = settings.release ?? null;
  importContext.description = settings.description ?? null;
  importContext.amlBatchMode = batch;
  importContext.amlBatchMaxSize = size;
  importContext.collectImportErrors = collect;
  importContext.collectImportErrorsMaxCount = limit;
  return { importContext, languages };
}

/** A file of the tree that exists and is a file. */
function isFile(fs: MemoryVfs, path: string): boolean {
  return fs.exists(path) && fs.stat(path).isFile;
}

/** The manifest of an import, read before anything is sent: a missing file and an unknown package are refused here (HOST-272). */
function readManifest(path: string, engine: Engine, requested: readonly string[], environment: PathEnvironment, fs: MemoryVfs): string[] {
  if (!isFile(fs, path)) throw new OptionError(`the manifest '${path}' does not exist`);
  const manifest = new ManifestFile(path, { ...environment, engine });
  const known = manifest.getAllPackageNames();
  const unknown = requested.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new OptionError(`the manifest has no package ${unknown.map((name) => `'${name}'`).join(", ")}; it has ${known.length === 0 ? "none" : known.join(", ")}`);
  }
  const repeated = requested.find((name, index) => requested.indexOf(name) !== index);
  if (repeated !== undefined) throw new OptionError(`package '${repeated}' is given twice`);
  return requested.length > 0 ? [...requested] : known;
}

function finish(
  operation: Operation,
  session: Session,
  vfs: MemoryVfs,
  logPath: string,
  reporter: RunReporter,
  returnCode: number,
  aborted: boolean,
  packages: string[],
): OperationResult {
  const summary: RunSummary = {
    operation,
    engine: session.engine,
    server: session.serverVersionText,
    result: resultOf(returnCode, reporter.counts.errors, aborted),
    returnCode,
    aborted,
    messages: reporter.counts,
    packages: packages.map((name) => ({ name })),
  };
  return { vfs, log: readLog(vfs, logPath), messages: reporter.messages, summary };
}

function reporterOf(operation: Operation, options: RunOptions, session: Session): RunReporter {
  const reporter = new RunReporter(operation, {
    ...(options.onMessage === undefined ? {} : { onMessage: options.onMessage }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  });
  if (session.versionGate?.skipped === true) {
    reporter.note("warning", `Aras server ${session.serverVersionText} is outside the window of engine ${session.engine}; the run goes on because skipVersionCheck is set.`);
  }
  return reporter;
}

// ------------------------------------------------------------------------------------------------------------------- import

/** What `importPackages` takes. */
export interface ImportOptions extends Omit<RunOptions, "vfs">, ImportSettings {
  /** The package: a tree, or a zip (HOST-272). */
  source: PackageSource;
  /** The manifest in the source; default `/imports.mf`. */
  manifestPath?: string;
  /** The packages of the manifest to import; default all of them, in the manifest's own order. */
  packages?: readonly string[];
}

/** What `importPackages` resolves with. */
export type ImportResult = OperationResult;

/**
 * Imports the packages of a manifest (IMP-480): the host sequence of context, manager and `ImportSolutions` on the session. A
 * failure rejects with the library's own error object (HOST-272).
 */
export async function importPackages(session: Session, options: ImportOptions): Promise<ImportResult> {
  const engine = session.engine;
  if (!IMPORT_ENGINES.includes(engine)) throw new EngineNotSupportedError(engine);
  const { importContext, languages } = importContextOf(options, engine, true);
  const tree = treeOf(options.source);
  const manifestPath = options.manifestPath ?? "/imports.mf";
  const host = createBrowserHost({ fs: tree, osUser: options.osUser ?? session.userName });
  const environment: PathEnvironment = { fs: tree, host: host.env };
  const names = readManifest(manifestPath, engine, options.packages ?? [], environment, tree);
  options.signal?.throwIfAborted();
  return session.run(async () => {
    const logPath = options.logPath ?? "/aras-pkg-logs/import.log";
    ensureFolder(tree, posix.dirname(logPath));
    const context = new SolutionUpgradeContext();
    context.action = "Import";
    context.url = session.url;
    context.dataBase = session.database;
    context.userName = session.userName;
    context.workingDirectory = posix.dirname(manifestPath);
    context.verbose = options.verbose === true;
    context.logFilePath = logPath;
    context.timeout = session.timeoutMs;
    context.languages = languages;
    context.manifestFile = manifestPath;

    const reporter = reporterOf("import", options, session);
    const manager = new ImportExportManager(context, reporter.factory, session.helper, {
      console: reporter.console,
      osUser: options.osUser ?? session.userName,
      ...environment,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    const abort = (): void => manager.cancel();
    options.signal?.addEventListener("abort", abort);
    try {
      const code = await manager.importSolutions(names, importContext);
      return finish("import", session, tree, logPath, reporter, code, options.signal?.aborted === true, names);
    } finally {
      options.signal?.removeEventListener("abort", abort);
      reporter.flush();
    }
  });
}

// -------------------------------------------------------------------------------------------------------- language pack

/** What `importLanguagePack` takes. */
export interface ImportLanguagePackOptions extends Omit<RunOptions, "vfs">, ImportSettings {
  /** The language pack: a tree, or a zip of its folder (HOST-272). */
  source: PackageSource;
  /** The path of the language pack's configuration file in the source; default `/ImportConfig.xml`. */
  lpPath?: string;
  /** The name of the package the language pack becomes. */
  lpPackage: string;
  /** Keeps the temporary package the preprocessor makes (LP-034). */
  lpDebug?: boolean;
}

/**
 * Imports a language pack as a package (LP-001). The engine's flow logs the session off when it ends, so the session is closed
 * afterwards (HOST-270); engine 12.0 has no language-pack import.
 */
export async function importLanguagePack(session: Session, options: ImportLanguagePackOptions): Promise<OperationResult> {
  const engine = session.engine;
  if (engine === "12.0") throw new OptionError("engine 12.0 has no language-pack import (LP-001); use engine 14.0.7 or 14.35");
  if (!LP_ENGINES.includes(engine) || !IMPORT_ENGINES.includes(engine)) throw new EngineNotSupportedError(engine);
  if (options.lpPackage === "") throw new OptionError("importLanguagePack needs lpPackage, the name of the package");
  const { importContext, languages } = importContextOf(options, engine, false);
  options.signal?.throwIfAborted();
  return session.run(
    async () => {
      const tree = treeOf(options.source);
      const host = createBrowserHost({ fs: tree, osUser: options.osUser ?? session.userName });
      const logPath = options.logPath ?? "/aras-pkg-logs/language-pack.log";
      ensureFolder(tree, posix.dirname(logPath));
      ensureFolder(tree, host.env.tmpdir());
      const context = new SolutionUpgradeContext();
      context.action = "LPImport";
      context.url = session.url;
      context.dataBase = session.database;
      context.userName = session.userName;
      context.workingDirectory = "/";
      context.verbose = options.verbose === true;
      context.logFilePath = logPath;
      context.timeout = session.timeoutMs;
      context.languages = languages;
      context.lpPath = options.lpPath ?? "/ImportConfig.xml";
      context.lpPackage = options.lpPackage;
      context.lpDebug = options.lpDebug === true;

      const reporter = reporterOf("language-pack", options, session);
      try {
        const code = await languagePackImport(context, importContext, reporter.factory, session.helper, {
          console: reporter.console,
          osUser: options.osUser ?? session.userName,
          fs: tree,
          host: host.env,
          ...(options.now === undefined ? {} : { now: options.now }),
        });
        return finish("language-pack", session, tree, logPath, reporter, code, false, [options.lpPackage]);
      } finally {
        reporter.flush();
      }
    },
    { logsOff: true },
  );
}

// ---------------------------------------------------------------------------------------------------------------- patches

/** What `applyDbPatches` takes. */
export interface DbPatchesOptions extends Omit<RunOptions, "vfs"> {
  /** The patches: a tree, or a zip (HOST-272). */
  source: PackageSource;
  /** The manifest that lists the patches, in the source. */
  manifestPath: string;
  /** The folder with one `<name>.xml` per patch; default the manifest's own folder (DBP-040). */
  patchesFolder?: string;
  /** The `description` of the "Applied Updates" row (DBP-030); default the engine's `Libs`. */
  toolName?: string;
  /** The ids of the rows the application creates; a hook for tests. */
  newId?: () => string;
}

/** The only login the engine accepts for this operation (DBP-010). */
const ROOT_USER = "root";

/**
 * Applies the DB patches of a manifest (DBP-002): engine 14.35 only (`DbPatchesNotInEngineError` otherwise), and the login `root`
 * (DBP-010). The result is `failed` when any text was sent on the `error` channel, as in the reference host (DBP-050, DBP-094).
 */
export async function applyDbPatches(session: Session, options: DbPatchesOptions): Promise<OperationResult> {
  const engine = session.engine;
  if (!DB_PATCH_ENGINES.includes(engine)) throw new DbPatchesNotInEngineError(engine);
  if (session.userName !== ROOT_USER) {
    throw new OptionError(`applyDbPatches needs the login '${ROOT_USER}', and the session's user is '${session.userName}' (DBP-010); nothing was sent`);
  }
  const tree = treeOf(options.source);
  if (!isFile(tree, options.manifestPath)) throw new OptionError(`the manifest '${options.manifestPath}' does not exist`);
  const patchesFolder = options.patchesFolder ?? posix.dirname(options.manifestPath);
  if (!tree.exists(patchesFolder) || !tree.stat(patchesFolder).isDirectory) throw new OptionError(`the patches folder '${patchesFolder}' does not exist`);
  options.signal?.throwIfAborted();
  return session.run(async () => {
    const host = createBrowserHost({ fs: tree, osUser: options.osUser ?? session.userName });
    const logPath = options.logPath ?? "/aras-pkg-logs/db-patches.log";
    ensureFolder(tree, posix.dirname(logPath));
    const context = new SolutionUpgradeContext();
    context.action = "ImportDPPatch";
    context.url = session.url;
    context.dataBase = session.database;
    context.userName = session.userName;
    context.workingDirectory = "/";
    context.verbose = options.verbose === true;
    context.logFilePath = logPath;
    context.timeout = session.timeoutMs;
    const config = new DBUpdateConfig();
    config.dbUpdatedManifestFilePath = options.manifestPath;
    config.dbPatchesFolderPath = patchesFolder;
    config.toolName = options.toolName ?? DEFAULT_TOOL_NAME;

    const reporter = reporterOf("db-patches", options, session);
    const manager = new ImportExportManager(context, reporter.factory, session.helper, {
      console: reporter.console,
      osUser: options.osUser ?? session.userName,
      fs: tree,
      host: host.env,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    let code = 0;
    try {
      try {
        await manager.applyDBUpdateManifest(config, options.newId === undefined ? {} : { newId: options.newId });
      } catch (error) {
        // the engine sent the exception's message on the error channel before it rethrew it (DBP-003); one it could not send is the host's
        if (reporter.counts.errors === 0) throw error;
      }
      code = reporter.counts.errors > 0 ? 1 : 0;
    } finally {
      reporter.flush();
    }
    return finish("db-patches", session, tree, logPath, reporter, code, false, []);
  });
}

// ------------------------------------------------------------------------------------------------------------------- plan

/** What `planImport` takes. */
export interface PlanImportOptions {
  source: PackageSource;
  manifestPath?: string;
  packages?: readonly string[];
  /** The engine whose rules apply; default 14.0.7. */
  engine?: Engine;
}

/** One package of the plan: where its folder is, and what the import would do with it. */
export interface PlannedPackage {
  name: string;
  folder: string;
  plan: ImportPlan;
}

/** What `planImport` resolves with. */
export interface ImportPlanResult {
  engine: Engine;
  manifestPath: string;
  /** The packages in the order the import follows. */
  order: string[];
  /** The warnings of that order (MAN-022, MAN-023). */
  warnings: string[];
  packages: PlannedPackage[];
}

/** The database document the ordering consults for a dependency that is not among the packages: offline, every one exists there. */
function assumedDatabase(manifest: ManifestFile, names: readonly string[]): XmlDocument {
  const dependencies = new Set(names.flatMap((name) => manifest.getAllDependsOnNames(manifest.getPackageNode(name))));
  const items = [...dependencies].map((name) => `<Item type="PackageDefinition"><name>${escapeText(name)}</name></Item>`);
  return loadXml(`<AML>${items.join("")}</AML>`, { preserveWhitespace: false });
}

/**
 * The order an import follows and, per package, the sequence `build.xsl` leaves, the repeats and the dropped items, with no server
 * (IMP-033). It stops at the first package whose folder cannot be loaded, by throwing, as the import does.
 */
export function planImport(options: PlanImportOptions): ImportPlanResult {
  const engine = options.engine ?? DEFAULT_ENGINE;
  if (!IMPORT_ENGINES.includes(engine)) throw new EngineNotSupportedError(engine);
  const tree = treeOf(options.source);
  const manifestPath = options.manifestPath ?? "/imports.mf";
  const environment: PathEnvironment = { fs: tree, host: createBrowserHost({ fs: tree }).env };
  const names = readManifest(manifestPath, engine, options.packages ?? [], environment, tree);
  const manifest = new ManifestFile(manifestPath, { ...environment, engine });
  const warnings: string[] = [];
  const order = manifest.getPackageNamesInImportOrder(names, assumedDatabase(manifest, names), warnings);
  const manifestFolder = directoryGetParentFullName(manifestPath, environment);
  const packages: PlannedPackage[] = [];
  for (const name of order) {
    const folder = getSolutionPath(name, manifestFolder, manifest, engine);
    packages.push({ name, folder, plan: planPackage(folder, { engine, environment }) });
  }
  return { engine, manifestPath, order, warnings, packages };
}
