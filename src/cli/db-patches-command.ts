import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DBUpdateConfig, DB_PATCH_ENGINES, DEFAULT_TOOL_NAME } from "../db-patches/index.js";
import { SolutionUpgradeContext } from "../export/export-context.js";
import { ImportExportManager } from "../export/import-export-manager.js";
import { EXIT } from "./exit.js";
import type { CliIo } from "./io.js";
import { runOperation } from "./operation.js";
import { CONNECTION_OPTIONS, flagOf, parseOptions, resolveConnection, resolveEngine, resolveLogPath, stringOf } from "./options.js";
import { DB_PATCHES_USAGE, UsageError } from "./usage.js";

/** The only login the engine accepts for this operation (DBP-010). */
const ROOT_USER = "root";

/**
 * `apply-db-patches <manifest> [--patches-folder <dir>] [--tool-name <text>]`: the host of DBP-002 — a context with the action
 * `ImportDPPatch`, a logged-in helper, the manager and `ApplyDBUpdateManifest`. The defaults are the reference host's (Aras
 * Update): the folder is the manifest's own, and the tool name is the engine's `Libs`.
 *
 * It refuses, as a usage error and before it sends anything, every engine but 14.35 (DBP-001) and every login but `root`
 * (DBP-010: the engine would refuse that too, after the host's login). The exit status is failure (1) when any text was sent on
 * the `error` channel or an exception escaped, as in the reference host: a patch the server refuses is not an exception
 * (DBP-050, bug DBP-094).
 *
 * @spec DBP-001 DBP-002 DBP-010 DBP-050 DBP-080 DBP-081 DBP-094 WIRE-002
 */
export async function applyDbPatchesCommand(args: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    ...CONNECTION_OPTIONS,
    "patches-folder": { type: "string" },
    "tool-name": { type: "string" },
    "os-user": { type: "string" },
  });
  if (flagOf(values, "help")) {
    io.stdout.write(DB_PATCHES_USAGE);
    return EXIT.ok;
  }
  const engine = resolveEngine(values, io);
  if (!DB_PATCH_ENGINES.includes(engine)) {
    throw new UsageError(`apply-db-patches exists only in engine ${DB_PATCH_ENGINES.join(", ")} (DBP-001); use --engine ${DB_PATCH_ENGINES[0]}, not ${engine}`);
  }
  const [manifestPath, ...extra] = positionals;
  if (manifestPath === undefined) throw new UsageError("apply-db-patches needs the manifest: aras-pkg apply-db-patches <manifest> --engine 14.35");
  if (extra.length > 0) throw new UsageError(`unexpected argument '${extra[0]}'`);

  const connection = await resolveConnection(values, io);
  if (connection.user !== ROOT_USER) {
    throw new UsageError(`apply-db-patches needs the login '${ROOT_USER}', and --user is '${connection.user}' (DBP-010); nothing was sent`);
  }
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) throw new UsageError(`the manifest '${manifestPath}' does not exist`);
  const given = stringOf(values, "patches-folder");
  if (given === "") throw new UsageError("--patches-folder needs a path");
  const patchesFolder = given ?? dirname(resolve(io.cwd(), manifestPath));
  if (!existsSync(patchesFolder) || !statSync(patchesFolder).isDirectory()) throw new UsageError(`the patches folder '${patchesFolder}' does not exist`);
  const toolName = stringOf(values, "tool-name") ?? DEFAULT_TOOL_NAME;
  const osUser = stringOf(values, "os-user");
  const logPath = resolveLogPath(values, "apply-db-patches", io);

  const context = new SolutionUpgradeContext();
  context.action = "ImportDPPatch";
  context.url = connection.url;
  context.dataBase = connection.database;
  context.userName = connection.user;
  context.password = connection.password;
  context.workingDirectory = io.cwd();
  context.verbose = flagOf(values, "verbose");
  context.logFilePath = logPath;
  context.timeout = connection.timeout;
  const config = new DBUpdateConfig();
  config.dbUpdatedManifestFilePath = manifestPath;
  config.dbPatchesFolderPath = patchesFolder;
  config.toolName = toolName;

  const settings = { engine, connection, json: flagOf(values, "json"), logPath };
  return runOperation(io, settings, "apply-db-patches", { manifest: manifestPath, patchesFolder, toolName }, async (helper, reporter) => {
    try {
      const manager = new ImportExportManager(context, reporter.messages, helper, {
        console: reporter.console,
        now: io.now,
        ...(osUser === undefined ? {} : { osUser }),
      });
      try {
        await manager.applyDBUpdateManifest(config);
      } catch (error) {
        // the engine sent the exception's message on the error channel before it rethrew it (DBP-003); one it could not send is the host's
        if (reporter.counts.errors === 0) throw error;
        return EXIT.failed;
      }
      return reporter.counts.errors > 0 ? EXIT.failed : EXIT.ok;
    } finally {
      await helper.logout();
    }
  });
}
