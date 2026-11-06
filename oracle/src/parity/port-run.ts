import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CItemHelper } from "../../../src/client/item-helper.js";
import { DBUpdateConfig } from "../../../src/db-patches/index.js";
import { SUExportContext, SolutionUpgradeContext } from "../../../src/export/export-context.js";
import { ImportExportManager, type SelectionInsertions, type SelectionTable } from "../../../src/export/import-export-manager.js";
import { createMessagesFactory, type SentMessage } from "../../../src/export/messages.js";
import { SUImportContext } from "../../../src/import/import-context.js";
import type { ConsoleWriter } from "../../../src/import/import-run.js";
import { languagePackImport } from "../../../src/language-pack/lp-import.js";
import { exceptionText } from "../../../src/language-pack/exception-text.js";
import type { ExportCaseOptions, ExportCasePackage } from "../export-cases.js";
import type { ImportOptions } from "../import-cases.js";
import { type CallRecord, type RunOutcome, type Termination, readTree } from "./outcome.js";
import {
  ORACLE_HOST_CULTURE,
  type PortServer,
  type Session,
  baseContext,
  collectors,
  exportContextFor,
  openSession,
  openSideConnection,
  osUserOf,
  selectionOf,
  termination,
} from "./port-core.js";

import { DBPATCH_DIR, MANIFEST_FILE, PATCH_FILE, PATCH_NUMBER, PATCH_RELEASE, TOOL_NAME, assertTestPatch } from "../dbpatch.js";
import { manifestPackageNames } from "../record.js";
import { scrub, secretForms } from "../scrub.js";
import { type CreatedItem, assertScratchImport, createdItems, preRun } from "./scratch.js";

// what the Worker's runner shares with this one lives in port-core.ts (HOST-279); the names stay importable from here
export { ORACLE_HOST_CULTURE, exportContextFor, openSession, openSideConnection, osUserOf, selectionOf };
export type { PortServer, Session };

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

function readLog(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
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
      culture: ORACLE_HOST_CULTURE,
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
  if (server.engine !== "14.35" && (options.languages !== undefined || options.amlBatch !== undefined || options.collectErrors !== undefined)) {
    throw new Error(`the options ${JSON.stringify(options)} are 14.35's`);
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
  // 14.35's settings, as the host sets them: Context.Languages stays null unless the case lists some, and the AML batch and
  // collected-errors modes carry their sizes
  if (options.languages !== undefined) context.languages = [...options.languages];
  if (options.amlBatch !== undefined) {
    importContext.amlBatchMode = true;
    importContext.amlBatchMaxSize = options.amlBatch.maxSize;
  }
  if (options.collectErrors !== undefined) {
    importContext.collectImportErrors = true;
    importContext.collectImportErrorsMaxCount = options.collectErrors.maxCount;
  }

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
    // 14.35's constructor scans the packages for their languages and checks the selection against the server (IMP-610, IMP-620)
    manager = await ImportExportManager.create(context, messages, session.helper, { cwd: work, console: collected.sink, osUser, culture: ORACLE_HOST_CULTURE });
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
  if (run.languages !== undefined && server.engine !== "14.35") throw new Error("the Languages selection is 14.35's");
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
  if (run.languages !== undefined) context.languages = [...run.languages];
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
        // the oracle's host runs ConsoleUpgrade's steps without its catch: no log line, and an exception is not a return of 1
        hostCatch: false,
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

// ---- DB patch (14.35) --------------------------------------------------------------------------------------------------------

export interface PortDbPatch {
  /** Check, before the run, that the release and the number are absent (the oracle host does it before its first run only). */
  preconditions: boolean;
  /** The ids the engine gives the items it adds; a recorded run served by a fake server names them, a live server takes the engine's own. */
  newId?: () => string;
}

/** The items a DB patch run created, in the order it made them: the `add`s the transcript shows, and the "Applied Updates" item `ApplyUpdate` answered with. */
export function dbPatchCreated(calls: readonly CallRecord[]): CreatedItem[] {
  const created: CreatedItem[] = [];
  for (const call of calls) {
    created.push(...createdItems(call.request, call.response));
    if (call.action !== "ApplyUpdate") continue;
    const found = /<Item[^>]*\btype="Applied Updates"[^>]*\bid="([0-9A-Fa-f]{32})"|<Item[^>]*\bid="([0-9A-Fa-f]{32})"[^>]*\btype="Applied Updates"/.exec(call.response);
    const id = found?.[1] ?? found?.[2];
    if (id !== undefined && !created.some((c) => c.type === "Applied Updates" && c.id === id)) created.push({ type: "Applied Updates", id, unconfirmed: false });
  }
  return created;
}

/** The oracle host's read-only check before a DB patch run: neither the release row nor the numbered update may exist (DBP-071). */
export async function assertPatchAbsent(server: PortServer): Promise<void> {
  const side = await openSideConnection(server);
  try {
    const row = await side.inn.applyItem(`<Item type="DatabaseUpgrade" action="get" select="id"><name>Applied Updates</name><target_release>${PATCH_RELEASE}</target_release><type>0</type></Item>`);
    if (!row.isError) throw new Error(`a DatabaseUpgrade 'Applied Updates' for release ${PATCH_RELEASE} already exists; stopping`);
    const applied = await side.inn.applyItem(`<Item type="Applied Updates" action="get" select="id"><up_number>${PATCH_NUMBER}</up_number></Item>`);
    if (!applied.isError) throw new Error(`an 'Applied Updates' item ${PATCH_NUMBER} already exists; stopping`);
  } finally {
    await side.close();
  }
}

/**
 * One `ApplyDBUpdateManifest` of the port against dev, as the oracle's `dbpatch` command does it: only the committed no-op patch
 * (DBP-071), the context of DBP-002, the manager's own method. A refused patch is an `error` message and host exit 1; an exception
 * (the non-root refusal) is host exit 2.
 */
export async function runPortDbPatch(
  server: PortServer,
  run: PortDbPatch,
  osUser: string,
  work = mkdtempSync(join(tmpdir(), "libsjs-parity-dbpatch-")),
): Promise<PortImportResult> {
  const committed = assertTestPatch(join(DBPATCH_DIR, MANIFEST_FILE), DBPATCH_DIR, TOOL_NAME);
  // the oracle stages the manifest and the patch file in the run's `input` folder, which is the engine's working directory too
  const input = join(work, "input");
  mkdirSync(input, { recursive: true });
  copyFileSync(committed.manifest, join(input, MANIFEST_FILE));
  copyFileSync(join(committed.folder, PATCH_FILE), join(input, PATCH_FILE));
  if (run.preconditions) await assertPatchAbsent(server);
  const logPath = join(work, "engine.log");
  const context = baseContext(new SolutionUpgradeContext(), server, input, logPath, false);
  context.action = "ImportDPPatch";
  const config = new DBUpdateConfig();
  config.dbUpdatedManifestFilePath = join(input, MANIFEST_FILE);
  config.dbPatchesFolderPath = input;
  config.toolName = TOOL_NAME;

  const collected = collectors();
  const messages = createMessagesFactory({ onMessage: (message) => void collected.messages.push(message), engine: server.engine });
  let session: Session | undefined;
  let ended: Termination = { kind: "applied" };
  const calls: CallRecord[] = [];
  try {
    session = await openSession(server);
    const manager = new ImportExportManager(context, messages, session.helper, { cwd: work, console: collected.sink, ...(osUser === "" ? {} : { osUser }) });
    await manager.applyDBUpdateManifest(config, run.newId === undefined ? {} : { newId: run.newId });
  } catch (error) {
    ended = termination(error);
  } finally {
    if (session !== undefined) {
      try {
        await session.helper.logout();
      } catch (error) {
        if (ended.kind === "applied") ended = { kind: "exception", summary: `logout: ${exceptionText(error)}` };
      }
      calls.push(...session.calls);
    }
  }
  const errors = collected.messages.filter((m) => m.channel === "error").length;
  return {
    outcome: scrubbedOutcome({
      side: "port",
      calls,
      files: null,
      log: readLog(logPath),
      messages: collected.messages.map(({ channel, text }) => ({ channel, text })),
      console: collected.console(),
      termination: ended,
      exitCode: ended.kind === "exception" ? 2 : errors > 0 ? 1 : 0,
    }, server.password),
    created: dbPatchCreated(calls),
  };
}
