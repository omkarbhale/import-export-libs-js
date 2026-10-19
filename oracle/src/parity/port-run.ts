import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpConnectorExtension } from "../../../src/client/connection.js";
import { CItemHelper } from "../../../src/client/item-helper.js";
import { Innovator } from "../../../src/client/innovator.js";
import { packageCaches } from "../../../src/client/package-lookups.js";
import type { HttpTransport } from "../../../src/client/transport.js";
import type { Engine } from "../../../src/engines.js";
import { SUExportContext, SolutionUpgradeContext } from "../../../src/export/export-context.js";
import { ExportItem } from "../../../src/export/export-item.js";
import { ImportExportManager, type SelectionInsertions, type SelectionTable } from "../../../src/export/import-export-manager.js";
import { createMessagesFactory, type SentMessage } from "../../../src/export/messages.js";
import { SUImportContext } from "../../../src/import/import-context.js";
import type { ConsoleWriter } from "../../../src/import/import-run.js";
import { languagePackImport } from "../../../src/language-pack/lp-import.js";
import { exceptionText } from "../../../src/language-pack/exception-text.js";
import type { ExportCaseOptions, ExportCasePackage } from "../export-cases.js";
import type { ImportOptions } from "../import-cases.js";
import { type CallRecord, type RunOutcome, type Termination, exceptionSummary, readTree } from "./outcome.js";
import { manifestPackageNames } from "../record.js";
import { scrub, secretForms } from "../scrub.js";
import { type CreatedItem, assertScratchImport, createdItems, preRun } from "./scratch.js";

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

/** The host's defaults (`oracle/host/engine-14.0.7.ps1`): a connection timeout of 600000 ms. */
const HOST_TIMEOUT = 600_000;

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

function newConnection(server: PortServer, calls: CallRecord[]): HttpConnectorExtension {
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
function collectors(): { messages: SentMessage[]; console: () => string; sink: ConsoleWriter } {
  const messages: SentMessage[] = [];
  let text = "";
  return {
    messages,
    console: () => text,
    sink: { write: (chunk) => void (text += chunk), writeLine: (line = "") => void (text += `${line}\r\n`) },
  };
}

/**
 * The port's run with the oracle's scrubbing applied (`oracle/src/scrub.ts`), which the oracle's recorder puts on every file it
 * collects: an item whose code holds `collection["password"]` is stored by the oracle as `…=SCRUBBED"password"]`. Comparing the
 * two without it would call that a difference in every such item, and a run folder kept as evidence must not hold a secret either.
 */
export function scrubbedOutcome(outcome: RunOutcome, password: string): RunOutcome {
  const secrets = [...secretForms(password)];
  const plain = (text: string): string => scrub(text, secrets).text;
  const literal = (text: string): string => scrub(text, [password, ...secrets], { literalSecrets: true }).text;
  const files =
    outcome.files === null
      ? null
      : new Map([...outcome.files].map(([path, bytes]) => [path, bytes.length === 0 ? bytes : Buffer.from(plain(bytes.toString("latin1")), "latin1")] as const));
  return {
    ...outcome,
    calls: outcome.calls.map((call) => ({ action: call.action, request: plain(call.request), response: plain(call.response) })),
    files,
    log: plain(outcome.log),
    messages: outcome.messages.map((message) => ({ channel: message.channel, text: plain(message.text) })),
    console: outcome.console === null ? null : literal(outcome.console),
  };
}

function termination(error: unknown): Termination {
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

function readLog(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/**
 * The `SolutionUpgradeContext` the oracle host builds: the connection settings as the oracle logs them, the host's timeout, and no
 * password (the host sets `Password = ""`, and the engine never reads it).
 */
function baseContext<T extends SolutionUpgradeContext>(context: T, server: PortServer, workingDirectory: string, logFilePath: string, verbose: boolean): T {
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

export interface PortExport {
  /** The items to export in `Hashtable` insertion order, or the table a console mode builds. */
  selection: SelectionInsertions | ((helper: CItemHelper, context: SUExportContext, manager: ImportExportManager) => Promise<SelectionTable>);
  options: ExportCaseOptions;
  /** For a console mode that names a manifest: the engine reads it in its constructor. */
  manifestFile?: string;
  /** How many items of a package 14.35 has in flight (EXP-551); the processor count by default, and 14.35 only. */
  parallelism?: number;
}

/**
 * One export of the port against dev, as the oracle's `export` command does it: login, `ExportSolutions` on a fresh output folder,
 * logout. The outcome holds the transcript, the output tree, the log, the messages and how the run ended.
 */
export async function runPortExport(server: PortServer, run: PortExport, work = mkdtempSync(join(tmpdir(), "libsjs-parity-export-"))): Promise<RunOutcome> {
  const output = join(work, "output");
  const logPath = join(work, "engine.log");
  mkdirSync(output, { recursive: true });
  const { context, onItemError } = exportContextFor(server, run.options, output, logPath);
  if (run.manifestFile !== undefined) context.manifestFile = run.manifestFile;
  const collected = collectors();
  // the host's CancelTrigger: Cancel() once the Nth status message has been delivered
  const cancelAfter = run.options.cancelAfterStatus ?? 0;
  let statuses = 0;
  let manager: ImportExportManager | undefined;
  const messages = createMessagesFactory({
    onMessage: (message) => {
      collected.messages.push(message);
      if (message.channel === "status" && cancelAfter > 0 && ++statuses === cancelAfter) manager?.cancel();
    },
    ...(onItemError === undefined ? {} : { onItemError }),
    engine: server.engine,
  });
  let session: Session | undefined;
  let ended: Termination = { kind: "exported" };
  const calls: CallRecord[] = [];
  try {
    session = await openSession(server);
    // 14.35's constructor resolves the language list against the server, so a refused list ends the run here
    manager = await ImportExportManager.create(context, messages, session.helper, {
      cwd: work,
      console: collected.sink,
      ...(run.parallelism === undefined ? {} : { parallelism: run.parallelism }),
    });
    const selection = typeof run.selection === "function" ? await run.selection(session.helper, context, manager) : run.selection;
    await manager.exportSolutions(context, selection);
  } catch (error) {
    ended = termination(error);
  } finally {
    if (session !== undefined) {
      try {
        await session.helper.logout();
      } catch (error) {
        if (ended.kind === "exported") ended = { kind: "exception", summary: `logout: ${exceptionText(error)}` };
      }
      calls.push(...session.calls);
    }
  }
  return scrubbedOutcome({
    side: "port",
    calls,
    files: readTree(output),
    log: readLog(logPath),
    messages: collected.messages.map(({ channel, text }) => ({ channel, text })),
    console: collected.console(),
    termination: ended,
    exitCode: ended.kind === "exception" ? 2 : 0,
  }, server.password);
}

export interface PortImportStep {
  /** The folder with `imports.mf` and the package folders: the engine's working directory. */
  inputDir: string;
  manifestName?: string;
  /** Hand the engine only these packages, in this order (default: every package in the manifest). */
  only?: readonly string[];
  options: ImportOptions;
}

export interface PortImportResult {
  outcome: RunOutcome;
  /** What this run created on dev, from its own transcript, for the cleanup. */
  created: CreatedItem[];
}

/** The items a transcript created, in order. */
export function createdBy(calls: readonly CallRecord[]): CreatedItem[] {
  return calls.flatMap((call) => createdItems(call.request, call.response));
}

/**
 * One import of the port against dev, as the oracle's `import` command does it. The package folder is checked to be scratch first,
 * and the pre-run steps (locked upgrade rows, new generations) go through a connection of their own.
 */
export async function runPortImport(
  server: PortServer,
  step: PortImportStep,
  osUser: string,
  work = mkdtempSync(join(tmpdir(), "libsjs-parity-import-")),
): Promise<PortImportResult & { preRunCreated: CreatedItem[] }> {
  const options = step.options;
  if (options.languages !== undefined || options.amlBatch !== undefined || options.collectErrors !== undefined) {
    throw new Error(`the options ${JSON.stringify(options)} are 14.35's; parity runs them with the 14.35 slice`);
  }
  const manifestPath = join(step.inputDir, step.manifestName ?? "imports.mf");
  mkdirSync(work, { recursive: true });
  const logPath = join(work, "engine.log");
  // the packages as the oracle's guard names them, read from the manifest text and not by the code under test
  const names = step.only ?? manifestPackageNames(readFileSync(manifestPath, "utf8"));
  assertScratchImport(names, step.inputDir);

  let preRunCreated: CreatedItem[] = [];
  if (options.lockUpgradeRows === true || (options.versionBefore?.length ?? 0) > 0) {
    const side = await openSideConnection(server);
    try {
      preRunCreated = await preRun(side.inn, {
        ...(options.lockUpgradeRows === true ? { lockRowsOf: names } : {}),
        ...(options.versionBefore === undefined ? {} : { versionBefore: options.versionBefore }),
      });
    } finally {
      await side.close();
    }
  }

  const context = baseContext(new SolutionUpgradeContext(), server, step.inputDir, logPath, options.verbose === true);
  context.action = "Import";
  context.manifestFile = manifestPath;
  const importContext = new SUImportContext();
  importContext.merge = options.merge === true;
  importContext.release = options.release ?? null;
  importContext.description = options.description ?? null;
  importContext.vault = options.vault === true;
  importContext.fast = options.fast === true;

  const collected = collectors();
  let statusMessages = 0;
  let manager: ImportExportManager | undefined;
  const messages = createMessagesFactory({
    onMessage: (message) => {
      collected.messages.push(message);
      if (message.channel === "status") {
        statusMessages += 1;
        if (statusMessages === options.cancelAfterStatus) manager?.cancel();
      }
    },
    engine: server.engine,
  });
  let session: Session | undefined;
  let ended: Termination = { kind: "returned", value: -1 };
  const calls: CallRecord[] = [];
  try {
    session = await openSession(server);
    manager = new ImportExportManager(context, messages, session.helper, { cwd: work, console: collected.sink, osUser });
    const packages = step.only !== undefined ? [...step.only] : (manager.manifestFile?.getAllPackageNames() ?? []);
    assertScratchImport(packages, step.inputDir);
    ended = { kind: "returned", value: await manager.importSolutions(packages, importContext) };
  } catch (error) {
    ended = termination(error);
  } finally {
    if (session !== undefined) {
      try {
        await session.helper.logout();
      } catch (error) {
        if (ended.kind === "returned") ended = { kind: "exception", summary: `logout: ${exceptionText(error)}` };
      }
      calls.push(...session.calls);
    }
  }
  return {
    outcome: scrubbedOutcome({
      side: "port",
      calls,
      files: null,
      log: readLog(logPath),
      messages: collected.messages.map(({ channel, text }) => ({ channel, text })),
      console: collected.console(),
      termination: ended,
      exitCode: ended.kind === "exception" ? 2 : 0,
    }, server.password),
    created: createdBy(calls),
    preRunCreated,
  };
}

export interface PortLanguagePack {
  /** The language pack folder, with `ImportConfig.xml` and `xml/`. */
  lpDir: string;
  lpPackage: string;
  lpDebug: boolean;
  languages?: readonly string[];
}

/** One `lpimport` of the port against dev, as ConsoleUpgrade's sequence and the oracle's `lpimport` command run it. */
export async function runPortLanguagePack(
  server: PortServer,
  run: PortLanguagePack,
  osUser: string,
  work = mkdtempSync(join(tmpdir(), "libsjs-parity-lp-")),
): Promise<PortImportResult> {
  if (run.languages !== undefined) throw new Error("the Languages selection is 14.35's; parity runs it with the 14.35 slice");
  mkdirSync(work, { recursive: true });
  assertScratchImport([run.lpPackage], work, run.lpDir);
  const logPath = join(work, "engine.log");
  // the oracle's preprocessor makes its package in the Windows temp folder, outside the run's working directory
  const tempRoot = mkdtempSync(join(tmpdir(), "libsjs-parity-lptemp-"));
  const context = baseContext(new SolutionUpgradeContext(), server, work, logPath, false);
  context.action = "LPImport";
  context.lpPath = join(run.lpDir, "ImportConfig.xml");
  context.lpPackage = run.lpPackage;
  context.lpDebug = run.lpDebug;
  const importContext = new SUImportContext();
  const collected = collectors();
  const messages = createMessagesFactory({ onMessage: (message) => void collected.messages.push(message), engine: server.engine });
  let session: Session | undefined;
  let ended: Termination = { kind: "returned", value: -1 };
  const calls: CallRecord[] = [];
  try {
    session = await openSession(server);
    ended = {
      kind: "returned",
      value: await languagePackImport(context, importContext, messages, session.helper, {
        cwd: work,
        console: collected.sink,
        osUser,
        tempPath: `${tempRoot}/`,
      }),
    };
  } catch (error) {
    ended = termination(error);
  } finally {
    // languagePackImport logs the helper out itself (LP-001 step 7), including when it throws
    if (session !== undefined) calls.push(...session.calls);
  }
  const kept = run.lpDebug ? readdirSync(tempRoot) : [];
  const files = kept.length === 1 ? readTree(join(tempRoot, kept[0] as string)) : null;
  rmSync(tempRoot, { recursive: true, force: true });
  return {
    outcome: scrubbedOutcome({
      side: "port",
      calls,
      files,
      log: readLog(logPath),
      messages: collected.messages.map(({ channel, text }) => ({ channel, text })),
      console: collected.console(),
      termination: ended,
      exitCode: ended.kind === "exception" ? 2 : 0,
    }, server.password),
    created: createdBy(calls),
  };
}
