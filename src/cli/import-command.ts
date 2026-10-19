import { existsSync, statSync } from "node:fs";
import type { Engine } from "../engines.js";
import { SolutionUpgradeContext } from "../export/export-context.js";
import { ImportExportManager } from "../export/import-export-manager.js";
import { IMPORT_RUN_ENGINES, SUImportContext } from "../import/index.js";
import { LP_ENGINES, languagePackImport } from "../language-pack/index.js";
import { MANIFEST_ENGINES, ManifestFile } from "../manifest/index.js";
import { EXIT } from "./exit.js";
import type { CliIo } from "./io.js";
import {
  CONNECTION_OPTIONS,
  type ConnectionOptions,
  IMPORT_OPTIONS,
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
import { runOperation } from "./operation.js";
import { IMPORT_USAGE, LANGUAGE_PACK_USAGE, UsageError } from "./usage.js";

/** The engines `import` runs: those whose client, manifest and import run are all built. */
const IMPORT_ENGINES: readonly Engine[] = IMPORT_RUN_ENGINES.filter((engine) => MANIFEST_ENGINES.includes(engine));

/** What `import` and `import-language-pack` share: the context of the import, and its summary. */
interface ImportSettings {
  engine: Engine;
  connection: ConnectionOptions;
  context: SolutionUpgradeContext;
  importContext: SUImportContext;
  osUser: string | undefined;
  json: boolean;
  logPath: string;
}

/**
 * The settings of an import run from the command line (IMP-480 steps 1 and 4): the shared context with the connection, the log
 * and `Verbose`, and the import context with the merge flag, the release and the description (IMP-401).
 *
 * @spec IMP-401 IMP-480
 */
async function importSettings(command: string, action: string, values: OptionValues, io: CliIo, engine: Engine): Promise<ImportSettings> {
  if (flagOf(values, "merge") && flagOf(values, "no-merge")) throw new UsageError("--merge and --no-merge cannot be used together");
  const connection = await resolveConnection(values, io);
  const logPath = resolveLogPath(values, command, io);

  const context = new SolutionUpgradeContext();
  context.action = action;
  context.url = connection.url;
  context.dataBase = connection.database;
  context.userName = connection.user;
  context.password = connection.password;
  context.workingDirectory = io.cwd();
  context.verbose = flagOf(values, "verbose");
  context.logFilePath = logPath;
  context.timeout = connection.timeout;

  const importContext = new SUImportContext();
  importContext.merge = flagOf(values, "merge");
  importContext.release = stringOf(values, "release") ?? null;
  importContext.description = stringOf(values, "description") ?? null;

  return { engine, connection, context, importContext, osUser: stringOf(values, "os-user"), json: flagOf(values, "json"), logPath };
}

/** The manifest of an import, read before anything is sent: a missing file and an unknown package are refused here. */
function readManifest(path: string, engine: Engine, requested: readonly string[]): { manifest: ManifestFile; names: string[] } {
  if (!existsSync(path) || !statSync(path).isFile()) throw new UsageError(`the manifest '${path}' does not exist`);
  const manifest = new ManifestFile(path, { engine });
  const known = manifest.getAllPackageNames();
  const unknown = requested.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new UsageError(
      `the manifest has no package ${unknown.map((name) => `'${name}'`).join(", ")}; it has ${known.length === 0 ? "none" : known.join(", ")}`,
    );
  }
  const repeated = requested.find((name, index) => requested.indexOf(name) !== index);
  if (repeated !== undefined) throw new UsageError(`--package '${repeated}' is given twice`);
  return { manifest, names: requested.length > 0 ? [...requested] : known };
}

/**
 * `import <manifest> [--package …]`: the host sequence of IMP-480 — context, login, manager, `ImportSolutions`, logout — over
 * the packages of the manifest, or the ones named.
 *
 * @spec IMP-480 WIRE-002 WIRE-040
 */
export async function importCommand(args: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseOptions(args, { ...CONNECTION_OPTIONS, ...IMPORT_OPTIONS, package: { type: "string", multiple: true } });
  if (flagOf(values, "help")) {
    io.stdout.write(IMPORT_USAGE);
    return EXIT.ok;
  }
  const engine = resolveEngine(values, io);
  const [manifestPath, ...extra] = positionals;
  if (manifestPath === undefined) throw new UsageError("import needs the manifest: aras-pkg import <manifest>");
  if (extra.length > 0) throw new UsageError(`unexpected argument '${extra[0]}'`);
  requireEngine(engine, IMPORT_ENGINES);
  const { names } = readManifest(manifestPath, engine, listOf(values, "package"));
  const settings = await importSettings("import", "Import", values, io, engine);
  settings.context.manifestFile = manifestPath;

  return runOperation(io, settings, "import", { manifest: manifestPath, packages: names, merge: settings.importContext.merge }, async (helper, reporter) => {
    try {
      const manager = new ImportExportManager(settings.context, reporter.messages, helper, {
        console: reporter.console,
        now: io.now,
        ...(settings.osUser === undefined ? {} : { osUser: settings.osUser }),
      });
      return await manager.importSolutions(names, settings.importContext);
    } finally {
      await helper.logout();
    }
  });
}

/**
 * `import-language-pack <lppath> --lp-package <name>`: the host sequence of LP-001. 12.0 has no language-pack import, so on that
 * engine the command is refused as a usage error.
 *
 * @spec LP-001 LP-002 WIRE-002
 */
export async function languagePackCommand(args: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    ...CONNECTION_OPTIONS,
    ...IMPORT_OPTIONS,
    "lp-package": { type: "string" },
    "lp-debug": { type: "boolean" },
  });
  if (flagOf(values, "help")) {
    io.stdout.write(LANGUAGE_PACK_USAGE);
    return EXIT.ok;
  }
  const engine = resolveEngine(values, io);
  if (engine === "12.0") {
    throw new UsageError("engine 12.0 has no language-pack import (LP-001); use --engine 14.0.7 or 14.35");
  }
  const [lpPath, ...extra] = positionals;
  if (lpPath === undefined) throw new UsageError("import-language-pack needs the language pack: aras-pkg import-language-pack <lppath> --lp-package <name>");
  if (extra.length > 0) throw new UsageError(`unexpected argument '${extra[0]}'`);
  const lpPackage = stringOf(values, "lp-package");
  if (lpPackage === undefined || lpPackage === "") throw new UsageError("import-language-pack needs --lp-package <name>");
  requireEngine(engine, IMPORT_ENGINES.filter((supported) => LP_ENGINES.includes(supported)));
  const settings = await importSettings("import-language-pack", "LPImport", values, io, engine);
  settings.context.lpPath = lpPath;
  settings.context.lpPackage = lpPackage;
  settings.context.lpDebug = flagOf(values, "lp-debug");

  return runOperation(io, settings, "import-language-pack", { languagePack: lpPath, package: lpPackage }, (helper, reporter) =>
    // `languagePackImport` logs the helper out itself (LP-001 step 7).
    languagePackImport(settings.context, settings.importContext, reporter.messages, helper, {
      console: reporter.console,
      now: io.now,
      ...(settings.osUser === undefined ? {} : { osUser: settings.osUser }),
    }),
  );
}
