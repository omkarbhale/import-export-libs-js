import { expect } from "vitest";
import type { TranscriptCall } from "../../oracle/src/transcript.js";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { packageCaches } from "../client/package-lookups.js";
import { ArasVersion } from "../client/version.js";
import { SUExportContext } from "../export/export-context.js";
import { ExportItem } from "../export/export-item.js";
import { ImportExportManager, type SelectionInsertions } from "../export/import-export-manager.js";
import { type SentMessage, createMessagesFactory } from "../export/messages.js";
import type { Case } from "../export/replay-cases.js";
import {
  type Case1435,
  RecordedConnection,
  comparable,
  comparable1435,
  failingItems,
  failsInConstructor,
  headerValue,
  logParts,
  maskItems,
  messageParts,
  needsRemoval,
  needsRemoval1435,
  settingsFrom,
} from "../export/replay-compare.js";
import { LOGIN_CALLS, LOGIN_CALLS_12_0, SequentialConnection } from "../import/sequential-connection.js";
import { MemoryVfs } from "../host/memory-fs.js";
import { createBrowserHost } from "./host.js";
import { type FixtureCase, fixtureBlobPath, fixtureCasePath, transcriptBlobs } from "./fixture-set.js";
import { loadFixtureTree, readFixtureText } from "./test-support.browser.js";
import { VFS_WORK, assertFilesEqual, bytesEqual } from "./tree-compare.js";

/**
 * What the browsers' replays of the recorded export cases share (HOST-265): reading a case through the fixture commands, and running
 * it with the browser host over a {@link MemoryVfs} and comparing what the run left with the recording. The run and the comparisons
 * are those of `vfs-replay.export.test.ts` and `vfs-replay.export-1435.test.ts` (HOST-218) over the same recorded answers; the
 * comparison functions are the shared pure ones (`replay-compare.ts`, `tree-compare.ts`), and what differs is only where the
 * recording comes from (the commands of HOST-263, not `node:fs`) and the host (`createBrowserHost`, HOST-243, not a fake of one).
 *
 * @spec HOST-265 HOST-263 HOST-218
 */

/** The clock of every replayed run: a fixed instant, so the log's date-times do not depend on when a browser runs it. */
export const FIXED_NOW = new Date(Date.UTC(2024, 0, 2, 3, 4, 5));

/** The culture the 12.0 engine's log writes three of its date-times in (EXP-505); the oracle host ran with it, and so does every replay of the 14.0.7 and 12.0 cases. */
export const REPLAY_CULTURE = "en-IN";

/** A recorded blob is read once per page: the list of the package definitions is 2.7 MB and every case names it. */
const blobTexts = new Map<string, Promise<string>>();

/** `transcript.jsonl` with each `responseBlob` put back as `response`, the browser's twin of `readTranscript` in `oracle/src/transcript.ts`. */
export async function readCaseTranscript(fixture: FixtureCase, transcript: string): Promise<TranscriptCall[]> {
  const blobs = new Map<string, string>();
  for (const sha of transcriptBlobs(transcript)) {
    const path = fixtureBlobPath(fixture, sha);
    let text = blobTexts.get(path);
    if (text === undefined) {
      text = readFixtureText(path);
      blobTexts.set(path, text);
    }
    blobs.set(sha, await text);
  }
  return transcript
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const call = JSON.parse(line) as TranscriptCall;
      if (call.responseBlob === undefined) return call;
      const { responseBlob, ...rest } = call;
      return { ...rest, response: blobs.get(responseBlob) as string };
    });
}

/** A recorded export case, read: its files as the engine and the oracle left them, and the answers of its server. */
export interface LoadedExportCase {
  fixture: FixtureCase;
  /** The UTF-8 text of a file of the case folder; a byte-order mark is kept, as `readFileSync(…, "utf8")` keeps it. */
  text(file: string): string;
  calls: TranscriptCall[];
  /** The folder the engine wrote, by relative path. */
  expectedOutput: Map<string, Uint8Array>;
}

const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });

export async function loadExportCase(fixture: FixtureCase): Promise<LoadedExportCase> {
  const files = new Map<string, Uint8Array>();
  for (const file of await loadFixtureTree(fixtureCasePath(fixture))) files.set(file.path, file.bytes);
  const text = (file: string): string => {
    const bytes = files.get(file);
    if (bytes === undefined) throw new Error(`${fixtureCasePath(fixture)}/${file} is not in the case`);
    return utf8.decode(bytes);
  };
  const expectedOutput = new Map<string, Uint8Array>();
  for (const [path, bytes] of files) if (path.startsWith("output/")) expectedOutput.set(path.slice("output/".length), bytes);
  return { fixture, text, calls: await readCaseTranscript(fixture, text("transcript.jsonl")), expectedOutput };
}

/** What a replay did with a case. */
export type ReplayOutcome =
  /** The run was made and everything matched. */
  | "ran"
  /** The case removes references to unknown packages, which the engine variants wait for EXP-600 to EXP-699 for (as the disk replays); nothing was run. */
  | "skipped"
  /** A run with items in flight is made only where the disk replay makes one (a run that was stopped is replayed one at a time). */
  | "not-applicable";

export interface ReplayOptions {
  /** Items in flight (14.35 only). Default 1. */
  parallelism?: number;
  /** What the output folder is compared with. Default: the recorded one. A test that must see a difference fail gives a changed copy. */
  expectedOutput?: ReadonlyMap<string, Uint8Array>;
}

/** The virtual file system a run gets, with the working folder in it, and the browser's host over it. */
function virtualRun(): { vfs: MemoryVfs; host: ReturnType<typeof createBrowserHost>["env"] } {
  const vfs = new MemoryVfs();
  vfs.mount({ [`${VFS_WORK}/`]: "" });
  return { vfs, host: createBrowserHost({ fs: vfs, cwd: VFS_WORK, osUser: "libsjs" }).env };
}

const logText = (vfs: MemoryVfs, path: string): string => utf8.decode(vfs.readFile(path));

/** The 14.0.7 and 12.0 log has no byte-order mark. */
function expectNoBom(vfs: MemoryVfs, path: string, name: string): void {
  const log = vfs.readFile(path);
  expect(log[0] === 0xef && log[1] === 0xbb && log[2] === 0xbf, `${name}: the log has no BOM`).toBe(false);
}

/** Replays a recorded case with the browser's host over a {@link MemoryVfs}, and compares what the run left with the recording. */
export async function replayExportCase(loaded: LoadedExportCase, options: ReplayOptions = {}): Promise<ReplayOutcome> {
  return loaded.fixture.engine === "14.35" ? replay1435(loaded, options) : replay(loaded, options);
}

// ------------------------------------------------------------------------------------------------------ 14.0.7 and 12.0

async function replay(loaded: LoadedExportCase, options: ReplayOptions): Promise<ReplayOutcome> {
  const { engine, name } = loaded.fixture;
  const input = JSON.parse(loaded.text("case.json")) as Case;
  if (needsRemoval(engine, input)) return "skipped";
  // each case was recorded by a process of its own, and the dependency cache outlives a helper (EXP-619)
  packageCaches.dependsOn.clear();

  const recordedLog = loaded.text("engine.log");
  const recordedMessages = loaded
    .text("messages.jsonl")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as SentMessage & { answer: boolean | null });
  const abort = recordedMessages.some((message) => message.channel === "errorQuestion" && message.answer === true);

  const { vfs, host } = virtualRun();
  const output = `${VFS_WORK}/output`;
  const logPath = `${VFS_WORK}/engine.log`;
  const context = new SUExportContext();
  Object.assign(context, settingsFrom(engine, input, recordedLog, engine === "12.0" ? loaded.text("run.json") : undefined));
  context.workingDirectory = output;
  context.logFilePath = logPath;

  const connection = new SequentialConnection(loaded.calls, engine === "12.0" ? LOGIN_CALLS_12_0 : LOGIN_CALLS);
  const helper = new CItemHelper(connection, { engine });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  const sent: SentMessage[] = [];
  const manager = new ImportExportManager(
    context,
    createMessagesFactory({ onMessage: (message) => void sent.push(message), onItemError: abort ? "abort-package" : "continue" }),
    helper,
    { fs: vfs, host, culture: REPLAY_CULTURE, now: () => FIXED_NOW },
  );

  const selection: SelectionInsertions = input.packages.map((entry) => [
    entry.name,
    entry.items.map((item) => [item.id, new ExportItem(item.keyedName, item.id, item.type)] as const),
  ]);
  vfs.mkdir(output);
  const outcome = manager.exportSolutions(context, selection);
  if (input.expectsError) await expect(outcome).rejects.toBeInstanceOf(CItemException);
  else await outcome;

  expect(connection.consumed, `${name}: the requests of the run`).toBe(connection.total);
  expect(sent.map(({ channel, text }) => ({ channel, text })), `${name}: the messages`).toEqual(
    recordedMessages.map(({ channel, text }) => ({ channel, text })),
  );
  assertFilesEqual(vfs, output, options.expectedOutput ?? loaded.expectedOutput, name);
  expectNoBom(vfs, logPath, name);
  expect(comparable(logText(vfs, logPath), logPath, output), `${name}: the log`).toBe(comparable(recordedLog, logPath, output));
  return "ran";
}

// ------------------------------------------------------------------------------------------------------------------ 14.35

async function replay1435(loaded: LoadedExportCase, options: ReplayOptions): Promise<ReplayOutcome> {
  const { name } = loaded.fixture;
  const parallelism = options.parallelism ?? 1;
  const input = JSON.parse(loaded.text("case.json")) as Case1435;
  if (needsRemoval1435(input)) return parallelism === 1 ? "skipped" : "not-applicable";
  const calls = loaded.calls;
  const { vfs, host } = virtualRun();
  const output = `${VFS_WORK}/output`;
  const logPath = `${VFS_WORK}/engine.log`;

  if (failsInConstructor(input)) {
    if (parallelism > 1) return "not-applicable";
    const context = new SUExportContext();
    context.workingDirectory = output;
    context.logFilePath = logPath;
    context.action = input.options.engineAction ?? "Export";
    context.languages = input.options.languages ?? null;
    const connection = new RecordedConnection(calls);
    const helper = new CItemHelper(connection, { engine: "14.35" });
    helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
    let manager: ImportExportManager | undefined;
    let error: unknown;
    try {
      manager = await ImportExportManager.create(context, createMessagesFactory({ engine: "14.35", onMessage: () => undefined }), helper, { fs: vfs, host });
    } catch (thrown) {
      error = thrown;
    }
    expect(manager, `${name}: the constructor must refuse`).toBeUndefined();
    expect(input.result.error, `${name}: the engine's exception`).toContain((error as Error).message);
    expect(connection.leftover, `${name}: requests the port did not send`).toEqual([]);
    return "ran";
  }
  const recordedLog = loaded.text("engine.log");
  const recordedMessages = loaded
    .text("messages.jsonl")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as SentMessage);
  const failed = recordedMessages.some((message) => message.channel === "errorQuestion");
  const cancelAfter = input.options.cancelAfterStatus;
  const stoppedRun = failed || cancelAfter !== undefined || input.expectsError || recordedMessages.some((message) => message.channel === "warning");
  if (parallelism > 1 && stoppedRun) return "not-applicable";

  const context = new SUExportContext();
  context.url = headerValue(recordedLog, "URL");
  context.dataBase = headerValue(recordedLog, "Database");
  context.userName = headerValue(recordedLog, "User");
  context.workingDirectory = output;
  context.logFilePath = logPath;
  context.level = headerValue(recordedLog, "Export level");
  context.exportReferencedItems = headerValue(recordedLog, "Export referenced items") === "True";
  context.useImport = headerValue(recordedLog, "Export using import structure") === "True";
  context.refToUnknownPacks = headerValue(recordedLog, "Export unknown packages action") as SUExportContext["refToUnknownPacks"];
  context.action = input.options.engineAction ?? "Export";
  context.languages = input.options.languages ?? null;

  const connection = new RecordedConnection(calls);
  const helper = new CItemHelper(connection, { engine: "14.35" });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  const sent: SentMessage[] = [];
  let statuses = 0;
  let manager: ImportExportManager | undefined;
  manager = await ImportExportManager.create(
    context,
    createMessagesFactory({
      engine: "14.35",
      onMessage: (message) => {
        sent.push(message);
        if (message.channel === "status") statuses += 1;
        if (cancelAfter !== undefined && message.channel === "status" && statuses === cancelAfter) manager?.cancel();
      },
    }),
    helper,
    { fs: vfs, host, parallelism, now: () => FIXED_NOW },
  );

  const selection: SelectionInsertions = input.packages.map((entry) => [
    entry.name,
    entry.items.map((item) => [item.id, new ExportItem(item.keyedName, item.id, item.type)] as const),
  ]);
  vfs.mkdir(output);
  const outcome = manager.exportSolutions(context, selection);
  if (input.expectsError) {
    const thrown = await outcome.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown, `${name}: the exception`).toBeInstanceOf(CItemException);
    expect(input.result.error, `${name}: the engine's exception`).toContain((thrown as CItemException).message);
  } else {
    await outcome;
  }

  // the output folder: the manifest is fixed, the item files are a set (a prefix of the engine's when the run was stopped)
  const recordedBytes = options.expectedOutput ?? loaded.expectedOutput;
  const madeBytes = vfs.snapshot(output);
  const made = [...madeBytes.keys()].sort();
  const recordedFiles = [...recordedBytes.keys()].sort();
  const stopped = failed || cancelAfter !== undefined;
  if (stopped) expect(recordedFiles, `${name}: the files of items the engine ran`).toEqual(expect.arrayContaining(made));
  else expect(made, `${name}: the files`).toEqual(recordedFiles);
  for (const path of made) {
    expect(bytesEqual(madeBytes.get(path) as Uint8Array, recordedBytes.get(path) as Uint8Array), `${name}: ${path} byte for byte`).toBe(true);
  }
  expect(made.includes("imports.mf") ? "manifest" : "none", name).toBe(recordedFiles.includes("imports.mf") ? "manifest" : "none");

  // the requests: every one of the port's was recorded, and a run that was not stopped sent all of them
  if (!stopped && !input.expectsError) expect(connection.leftover, `${name}: requests the port did not send`).toEqual([]);

  // the messages
  const failing = failed ? failingItems(input, calls) : [];
  const mask = (text: string) => maskItems(text, failing);
  const caseItems = new Set(input.packages.flatMap((entry) => entry.items.map((item) => `${item.type} - ${item.keyedName}`)));
  const ours = messageParts(sent);
  const theirs = messageParts(recordedMessages);
  expect(ours.currentPackage, `${name}: currentPackage`).toEqual(theirs.currentPackage);
  expect(ours.warning, `${name}: warning`).toEqual(theirs.warning.length === 0 ? [] : [expect.stringMatching(/^\t\t\*\*\*\*ErrorMessage\*\*\*\*\r\n/)]);
  if (theirs.warning.length > 0) {
    // the engine's workers may all have failed; the port's first failure is among them
    const first = (ours.warning[0] ?? "").split("\r\n").slice(1).join("\r\n");
    expect(theirs.warning[0]).toContain(first);
  }
  expect(ours.error, `${name}: error`).toEqual(theirs.error);
  expect(ours.errorQuestion.map(mask), `${name}: errorQuestion`).toEqual(theirs.errorQuestion.map(mask));
  expect(ours.otherStatus.map(mask), `${name}: the other status texts`).toEqual(
    (cancelAfter === undefined ? theirs.otherStatus : [...new Set(theirs.otherStatus)]).map(mask),
  );
  expect([...caseItems, ...theirs.items], `${name}: the items the port started`).toEqual(expect.arrayContaining([...ours.items]));
  if (!stopped && !input.expectsError && theirs.warning.length === 0) {
    expect([...ours.items], `${name}: the items`).toEqual(expect.arrayContaining([...caseItems, ...theirs.items]));
  }

  // the log
  const ourLog = logParts(comparable1435(logText(vfs, logPath), logPath, output));
  const theirLog = logParts(comparable1435(recordedLog, logPath, output));
  expect(ourLog.header, `${name}: the log header`).toBe(theirLog.header);
  expect(ourLog.packages.map((pkg) => pkg.header), `${name}: the packages`).toEqual(theirLog.packages.map((pkg) => pkg.header));
  for (const [index, pkg] of ourLog.packages.entries()) {
    const recorded = theirLog.packages[index];
    if (theirs.warning.length > 0) {
      expect(recorded?.rest.join("\r\n"), `${name}: ${pkg.header}`).toContain(pkg.rest.join("\r\n"));
    } else {
      expect(pkg.rest.map(mask), `${name}: ${pkg.header}`).toEqual(recorded?.rest.map(mask));
    }
    if (stopped || theirs.warning.length > 0) {
      expect(pkg.successes.length, `${name}: the success lines`).toBeLessThanOrEqual(input.packages.flatMap((entry) => entry.items).length);
    } else {
      expect(pkg.successes, `${name}: the success lines of ${pkg.header}`).toEqual(recorded?.successes);
    }
  }
  return "ran";
}
