import type { CItemHelper } from "../client/item-helper.js";
import { VersionRefusal } from "../client/version.js";
import type { Engine } from "../engines.js";
import { AggregateException } from "../export/parallel-for-each.js";
import { leftBehindTempFolder } from "../language-pack/index.js";
import { EXIT, exitCodeOf } from "./exit.js";
import type { CliIo } from "./io.js";
import type { ConnectionOptions } from "./options.js";
import { Reporter } from "./reporter.js";
import { openSession } from "./session.js";
import { type Summary, printSummary } from "./summary.js";

/** What every command that talks to a server settles before it runs: the engine, the connection, the output form and the log. */
export interface OperationSettings {
  engine: Engine;
  connection: ConnectionOptions;
  json: boolean;
  logPath: string;
}

/**
 * The text a failure shows: the message, and for a refused server the engines that would take it. An `AggregateException` has only
 * the message `One or more errors occurred.`, so the messages of its inner exceptions follow (the 14.35 scan of a package, IMP-612).
 */
export function describe(error: unknown): string {
  if (error instanceof VersionRefusal) return `${error.message}\n${error.hint}`;
  if (error instanceof AggregateException) return [error.message, ...error.innerExceptions.map(describe)].join("\n");
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs one operation on a logged-in helper and reports it: the engine's messages to standard error as they come, the summary to
 * standard output at the end, and the exit code (0, 1 or 2). A login that fails or an exception that ends the run is reported as a
 * failure with the engine and the command in the summary.
 */
export async function runOperation(
  io: CliIo,
  settings: OperationSettings,
  command: string,
  facts: Summary,
  operation: (helper: CItemHelper, reporter: Reporter) => Promise<number>,
): Promise<number> {
  const reporter = new Reporter(io);
  let returnCode: number = EXIT.failed;
  let failure: string | undefined;
  let server: string | undefined;
  try {
    const helper = await openSession(settings.engine, settings.connection, io, reporter);
    server = helper.innovatorVersion?.fullString;
    returnCode = await operation(helper, reporter);
  } catch (error) {
    failure = describe(error);
    reporter.error(failure);
    const left = leftBehindTempFolder(error);
    if (left !== undefined) reporter.warn(`The temporary package was left at ${left}`);
  }
  const exitCode = failure === undefined ? exitCodeOf(returnCode, reporter.counts.errors) : EXIT.failed;
  const { info, warnings, errors, packages } = reporter.counts;
  printSummary(io, settings.json, {
    command,
    engine: settings.engine,
    result: exitCode === EXIT.ok ? "success" : exitCode === EXIT.engineErrors ? "completed with engine errors" : "failed",
    exitCode,
    url: settings.connection.url,
    database: settings.connection.database,
    user: settings.connection.user,
    server,
    ...facts,
    log: settings.logPath,
    messages: { info, warnings, errors, packages },
    error: failure,
  });
  return exitCode;
}
