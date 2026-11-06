import { HttpConnectorExtension } from "../../../src/client/connection.js";
import { Innovator } from "../../../src/client/innovator.js";
import { CItemHelper } from "../../../src/client/item-helper.js";
import { packageCaches } from "../../../src/client/package-lookups.js";
import type { HttpTransport } from "../../../src/client/transport.js";
import type { Engine } from "../../../src/engines.js";
import { SUExportContext, SolutionUpgradeContext } from "../../../src/export/export-context.js";
import { ExportItem } from "../../../src/export/export-item.js";
import type { SelectionInsertions } from "../../../src/export/import-export-manager.js";
import type { ConsoleWriter } from "../../../src/import/import-run.js";
import { exceptionText } from "../../../src/language-pack/exception-text.js";
import type { SentMessage } from "../../../src/export/messages.js";
import type { ExportCaseOptions, ExportCasePackage } from "../export-cases.js";
import type { CallRecord, Termination } from "./outcome.js";

/**
 * What the port's runner (`port-run.ts`, on Node) and the browser's runner (`browser-page/run.ts`, in a Worker) share (HOST-277): the
 * server a run connects to, the connection that records its calls, the contexts the oracle host builds, the termination of a run. It
 * imports nothing from Node, so that the Worker's bundle can take it; the file system, the clock and the scrubbing stay with each side.
 *
 * @spec HOST-277
 */

/** Where and as whom the port connects. `url` is the address this machine reaches dev at; the engine logs `logUrl`, what the oracle host logged. */
export interface PortServer {
  engine: Engine;
  url: string;
  /** The URL the log header shows (the oracle host connects as `http://localhost/12sp9`, WSL reaches the same server as 172.19.0.1). */
  logUrl: string;
  database: string;
  userName: string;
  password: string;
  /** Replaces Node's HTTP layer; tests use a fake server. */
  transport?: HttpTransport;
}

/** The host's defaults (`oracle/host/engine-<engine>.ps1`): a connection timeout of 600000 ms. */
export const HOST_TIMEOUT = 600_000;

/**
 * The culture the oracle host runs in, which 12.0's log follows for three of its date-times (EXP-505): the Windows machine's own,
 * `en-IN` (`dd-MM-yyyy HH:mm:ss`). The port runs on another OS, so it is told rather than left to its process culture.
 */
export const ORACLE_HOST_CULTURE = "en-IN";

/** A connection to dev that records every call it makes, as the oracle's `RecordingHttpServerConnection` does. */
export interface Session {
  connection: HttpConnectorExtension;
  helper: CItemHelper;
  calls: CallRecord[];
}

/**
 * The oracle host connects with its own subclass of IOM's `HttpServerConnection` (`RecordingHttpServerConnection`), which is not
 * the exact type `HttpConnectorExtension` that `CItemHelper.Logout` logs off (WIRE-040). So the oracle sends no `Logoff`, and the
 * port's session must not either: the connection of a run is a subclass here too.
 */
class RecordingConnection extends HttpConnectorExtension {}

export function newConnection(server: PortServer, calls: CallRecord[]): HttpConnectorExtension {
  return new RecordingConnection({
    engine: server.engine,
    url: server.url,
    database: server.database,
    userName: server.userName,
    password: server.password,
    onCall: (call) => void calls.push(call),
    ...(server.transport === undefined ? {} : { transport: server.transport }),
  });
}

/** `new CItemHelper(connection)` and `Login()`, as the oracle host does first. */
export async function openSession(server: PortServer): Promise<Session> {
  // each oracle run is a process of its own, and the dependency cache outlives a helper within one (EXP-619)
  packageCaches.dependsOn.clear();
  const calls: CallRecord[] = [];
  const connection = newConnection(server, calls);
  const helper = new CItemHelper(connection, { engine: server.engine });
  if (server.engine === "12.0") {
    // 12.0's CItemHelper.Login() logs in only the exact type HttpConnectorExtension (WIRE-017), so the oracle host logs in first
    const user = await connection.login();
    if (user.isError) throw new Error(`host login failed: ${user.errorString}`);
  }
  await helper.login();
  return { connection, helper, calls };
}

/** A logged-in connection for work that must not reach a transcript: the pre-run steps and the cleanup. */
export async function openSideConnection(server: PortServer): Promise<{ inn: Innovator; close(): Promise<void> }> {
  const connection = newConnection(server, []);
  const user = await connection.login();
  if (user.isError) throw new Error(`login failed: ${user.errorString}`);
  return { inn: new Innovator(connection), close: () => connection.logout() };
}

/** What a run keeps of the messages and the console while it goes. */
export function collectors(): { messages: SentMessage[]; console: () => string; sink: ConsoleWriter } {
  const messages: SentMessage[] = [];
  let text = "";
  return {
    messages,
    console: () => text,
    sink: { write: (chunk) => void (text += chunk), writeLine: (line = "") => void (text += `${line}\r\n`) },
  };
}

/** The first line of an exception's text, where .NET's `ToString` starts the stack trace after it. */
export function exceptionSummary(text: string): string {
  const stack = text.search(/\r?\n\s+at /);
  return (stack < 0 ? text : text.slice(0, stack)).trim();
}

export function termination(error: unknown): Termination {
  return { kind: "exception", summary: exceptionSummary(exceptionText(error)) };
}

/** The value of `os_user` the oracle's import wrote into the audit row, which the port must write the same. */
export function osUserOf(calls: readonly Pick<CallRecord, "request">[]): string {
  for (const call of calls) {
    const found = /<os_user>([^<]*)<\/os_user>/.exec(call.request);
    if (found) return found[1] ?? "";
  }
  return "";
}

/**
 * The `SolutionUpgradeContext` the oracle host builds: the connection settings as the oracle logs them, the host's timeout, and no
 * password (the host sets `Password = ""`, and the engine never reads it).
 */
export function baseContext<T extends SolutionUpgradeContext>(context: T, server: PortServer, workingDirectory: string, logFilePath: string, verbose: boolean): T {
  context.url = server.logUrl;
  context.dataBase = server.database;
  context.userName = server.userName;
  context.password = "";
  context.timeout = HOST_TIMEOUT;
  context.logFilePath = logFilePath;
  context.workingDirectory = workingDirectory;
  context.verbose = verbose;
  return context;
}

/** The host's mapping of an export case's options to the engine's contexts (`oracle/host/common.ps1`, `OracleHost.cs`). */
export function exportContextFor(
  server: PortServer,
  options: ExportCaseOptions,
  workingDirectory: string,
  logFilePath: string,
): { context: SUExportContext; onItemError: "continue" | "abort-package" | undefined } {
  if (server.engine !== "14.35" && (options.engineAction !== undefined || options.languages !== undefined || options.cancelAfterStatus !== undefined)) {
    throw new Error(`the options ${JSON.stringify(options)} are 14.35's`);
  }
  const context = baseContext(new SUExportContext(), server, workingDirectory, logFilePath, options.verbose === true);
  // the host sets Action = Export unless the case names one, and leaves Languages null unless it lists some
  context.action = options.engineAction ?? "Export";
  context.languages = options.languages ?? null;
  // the host sets sLevel = "1" and DoNotRemove before it applies the case's options
  context.level = options.level ?? "1";
  context.refToUnknownPacks = options.refToUnknownPacks ?? "DoNotRemove";
  context.exportReferencedItems = options.exportReferencedItems === true;
  context.useImport = options.useImport === true;
  if (options.timeout !== undefined) context.timeout = options.timeout;
  const answer = options.errorQuestionAnswer ?? "no";
  // 14.35 never reads the answer (EXP-555, EXP-571), and the library refuses an answer for it
  if (server.engine === "14.35") return { context, onItemError: undefined };
  if (answer === "none") throw new Error("errorQuestionAnswer 'none' answers the error question with null, which the port's host has no way to say");
  return { context, onItemError: answer === "yes" ? "abort-package" : "continue" };
}

/** The host's `Selection`: a package on its first item, each item under its id, in the case's order. */
export function selectionOf(packages: readonly ExportCasePackage[]): SelectionInsertions {
  return packages.map((pkg) => [pkg.name, pkg.items.map((item) => [item.id, new ExportItem(item.keyedName, item.id, item.type)] as const)] as const);
}
