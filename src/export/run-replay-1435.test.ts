import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type TranscriptCall, readTranscript } from "../../oracle/src/transcript.js";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { ArasVersion } from "../client/version.js";
import { SUExportContext, type ReferencesToUnknownPackages } from "./export-context.js";
import { ExportItem } from "./export-item.js";
import { ImportExportManager, type SelectionInsertions } from "./import-export-manager.js";
import {
  type Case1435 as Case,
  RecordedConnection,
  comparable1435 as comparable,
  failingItems,
  failsInConstructor,
  headerValue,
  logParts,
  maskItems,
  messageParts,
  needsRemoval1435 as needsRemoval,
} from "./replay-support.js";
import { type SentMessage, createMessagesFactory } from "./messages.js";

/**
 * The recorded 14.35 export cases replayed through the whole of `ExportSolutions` (EXP-500 to EXP-520, EXP-550 to EXP-558): the port
 * reads the recorded answers of a case's transcript, matched by their request text, and what it leaves behind is compared with what the
 * engine left, the way EXP-558 says two runs of 14.35 are compared. The engine ran the items of a package in parallel, so its log, its
 * messages and the files of items in flight are not in a fixed order or set. Every case is replayed with the port running one item
 * at a time. The cases that no failure, cancel or exception stopped are replayed again with eight items in flight, and agree with the
 * recording in the same parts (EXP-551, EXP-558).
 *
 * - **Fixed parts** are equal: the log header, every package header, the `currentPackage` messages, `imports.mf`, the error block, the
 *   warning, and the `completed` and cancel texts.
 * - **A set** is compared as a set: the success lines, the `Item i of n` texts, and the files.
 * - **A run that failed or was cancelled** is a prefix of the engine's: the port started fewer items, so its files, success lines
 *   and requests are among the engine's and not the other way round (EXP-555, EXP-557, EXP-570).
 *
 * The cases of the language-resource export run here as well (LP-100 to LP-187): the manager is made with `create`, which does the
 * language work of the engine's constructor, and a case whose constructor refused the languages is compared by the error and the
 * requests that came before it. The removal of references to unknown packages waits for the `EXP-600` rules.
 */
const CASES = new URL("../../fixtures/14.35/export/", import.meta.url).pathname;
const BLOBS = join(CASES, "_blobs");

const caseNames = readdirSync(CASES).filter((name) => existsSync(join(CASES, name, "transcript.jsonl")));

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Every file below a folder, as a path with `/`. */
function files(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? files(root, `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]))
    .sort();
}

const read = (name: string, file: string): string => readFileSync(join(CASES, name, file), "utf8");

/** The manager of a case, made as the engine's constructor makes it: with the action and the language list of the case. */
async function languageManager(input: Case, calls: TranscriptCall[], working: string) {
  const context = new SUExportContext();
  context.workingDirectory = join(working, "output");
  context.logFilePath = join(working, "engine.log");
  context.action = input.options.engineAction ?? "Export";
  context.languages = input.options.languages ?? null;
  const connection = new RecordedConnection(calls);
  const helper = new CItemHelper(connection, { engine: "14.35" });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  let manager: ImportExportManager | undefined;
  let error: unknown;
  try {
    manager = await ImportExportManager.create(context, createMessagesFactory({ engine: "14.35", onMessage: () => undefined }), helper, { cwd: working });
  } catch (thrown) {
    error = thrown;
  }
  return { context, connection, manager, error };
}

describe("the recorded 14.35 export cases, run through ExportSolutions (EXP-500 to EXP-520, EXP-550 to EXP-558)", () => {
  let compared = 0;
  let failures = 0;
  let cancels = 0;
  let refused = 0;

  /** Replays a case with `parallelism` items in flight. A run that was stopped is replayed one at a time only: the port's items in flight differ from the engine's. */
  async function replay(name: string, parallelism: number): Promise<void> {
    const input = JSON.parse(read(name, "case.json")) as Case;
    if (needsRemoval(input)) return;

    const calls = readTranscript(join(CASES, name, "transcript.jsonl"), BLOBS);
    if (failsInConstructor(input)) {
      if (parallelism > 1) return;
      const working = mkdtempSync(join(tmpdir(), "libsjs-run1435-"));
      roots.push(working);
      const made = await languageManager(input, calls, working);
      expect(made.manager, `${name}: the constructor must refuse`).toBeUndefined();
      expect(input.result.error, `${name}: the engine's exception`).toContain((made.error as Error).message);
      expect(made.connection.leftover, `${name}: requests the port did not send`).toEqual([]);
      // the language list is left as it stood when the constructor threw (LP-110)
      refused += 1;
      return;
    }
    const recordedLog = read(name, "engine.log");
    const recordedMessages = read(name, "messages.jsonl")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as SentMessage);
    const failed = recordedMessages.some((message) => message.channel === "errorQuestion");
    const cancelAfter = input.options.cancelAfterStatus;
    const stoppedRun = failed || cancelAfter !== undefined || input.expectsError || recordedMessages.some((message) => message.channel === "warning");
    if (parallelism > 1 && stoppedRun) return;

    const working = mkdtempSync(join(tmpdir(), "libsjs-run1435-"));
    roots.push(working);
    const output = join(working, "output");
    const logPath = join(working, "engine.log");
    const context = new SUExportContext();
    context.url = headerValue(recordedLog, "URL");
    context.dataBase = headerValue(recordedLog, "Database");
    context.userName = headerValue(recordedLog, "User");
    context.workingDirectory = output;
    context.logFilePath = logPath;
    context.level = headerValue(recordedLog, "Export level");
    context.exportReferencedItems = headerValue(recordedLog, "Export referenced items") === "True";
    context.useImport = headerValue(recordedLog, "Export using import structure") === "True";
    context.refToUnknownPacks = headerValue(recordedLog, "Export unknown packages action") as ReferencesToUnknownPackages;

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
      { cwd: working, parallelism },
    );

    const selection: SelectionInsertions = input.packages.map((entry) => [
      entry.name,
      entry.items.map((item) => [item.id, new ExportItem(item.keyedName, item.id, item.type)] as const),
    ]);
    mkdirSync(output);
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
    const made = files(output);
    const recordedFiles = files(join(CASES, name, "output"));
    const stopped = failed || cancelAfter !== undefined;
    if (stopped) expect(recordedFiles, `${name}: the files of items the engine ran`).toEqual(expect.arrayContaining(made));
    else expect(made, `${name}: the files`).toEqual(recordedFiles);
    for (const path of made) {
      expect(readFileSync(join(output, path)).equals(readFileSync(join(CASES, name, "output", path))), `${name}: ${path} byte for byte`).toBe(true);
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
    // a text of the engine may be missing or repeated (EXP-553): the port started items of the case or of the second pass, and when
    // nothing stopped it, all of them and every one the engine named
    expect([...caseItems, ...theirs.items], `${name}: the items the port started`).toEqual(expect.arrayContaining([...ours.items]));
    if (!stopped && !input.expectsError && theirs.warning.length === 0) {
      expect([...ours.items], `${name}: the items`).toEqual(expect.arrayContaining([...caseItems, ...theirs.items]));
    }

    // the log
    const log = readFileSync(logPath, "utf8");
    const ourLog = logParts(comparable(log, logPath, output));
    const theirLog = logParts(comparable(recordedLog, logPath, output));
    expect(ourLog.header, `${name}: the log header`).toBe(theirLog.header);
    expect(ourLog.packages.map((pkg) => pkg.header), `${name}: the packages`).toEqual(theirLog.packages.map((pkg) => pkg.header));
    for (const [index, pkg] of ourLog.packages.entries()) {
      const recorded = theirLog.packages[index];
      if (theirs.warning.length > 0) {
        // the warning of the engine names every worker that failed, the port's the first (EXP-556)
        expect(recorded?.rest.join("\r\n"), `${name}: ${pkg.header}`).toContain(pkg.rest.join("\r\n"));
      } else {
        expect(pkg.rest.map(mask), `${name}: ${pkg.header}`).toEqual(recorded?.rest.map(mask));
      }
      if (stopped || theirs.warning.length > 0) {
        // an item that finished after a failure or a cancel has no success line (EXP-570), and the port's are in the engine's files
        expect(pkg.successes.length, `${name}: the success lines`).toBeLessThanOrEqual(input.packages.flatMap((entry) => entry.items).length);
      } else {
        expect(pkg.successes, `${name}: the success lines of ${pkg.header}`).toEqual(recorded?.successes);
      }
    }
    if (parallelism === 1) {
      compared += 1;
      if (failed) failures += 1;
      if (cancelAfter !== undefined) cancels += 1;
    }
  }

  it.each(caseNames)("%s", (name) => replay(name, 1), 60_000);
  it.each(caseNames)("%s, eight items in flight", (name) => replay(name, 8), 60_000);

  it("ran the cases that need no removal of references", () => {
    expect(compared).toBeGreaterThan(90);
    expect(failures).toBe(7);
    expect(cancels).toBe(3);
    expect(refused).toBe(6);
  });
});
