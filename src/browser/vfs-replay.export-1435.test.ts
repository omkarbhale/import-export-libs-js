import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { ArasVersion } from "../client/version.js";
import { SUExportContext } from "../export/export-context.js";
import { ExportItem } from "../export/export-item.js";
import { ImportExportManager, type SelectionInsertions } from "../export/import-export-manager.js";
import { type SentMessage, createMessagesFactory } from "../export/messages.js";
import {
  type Case1435,
  RecordedConnection,
  comparable1435 as exportLog1435,
  failingItems,
  failsInConstructor,
  headerValue,
  logParts,
  maskItems,
  messageParts,
  needsRemoval1435,
} from "../export/replay-support.js";
import {
  VFS_WORK,
  bytesEqual,
  readDiskFiles,
} from "./test-support.js";
import { CaseCount, logText, virtualHost } from "./vfs-replay-support.js";

/**
 * The recorded 14.35 export cases replayed on the in-memory file system, under Node (HOST-217): every case the disk replays run (`run-replay-1435.test.ts`) is run again
 * with `fs` a {@link MemoryVfs} and `host` a fake environment, so that the output folder, the log, the manifest and the package folder
 * never touch the disk. The recorded answers are served by the same connections, and what a run leaves behind is compared with the
 * same recording by the same comparisons, on the virtual tree: the output folder byte for byte (`assertTreesEqual`), the log, the
 * messages and the return code. The replays are in files of their own (`vfs-replay.*.test.ts`), as the disk replays are, so that
 * each runs in a worker of its own.
 *
 * @spec HOST-217 HOST-215 HOST-203
 */

const tally = new CaseCount();

// ------------------------------------------------------------------------------------------------------------ export, 14.35

const CASES_EXPORT_1435 = new URL("../../fixtures/14.35/export/", import.meta.url).pathname;
const BLOBS_EXPORT_1435 = join(CASES_EXPORT_1435, "_blobs");
const caseNames1435 = readdirSync(CASES_EXPORT_1435).filter((name) => existsSync(join(CASES_EXPORT_1435, name, "transcript.jsonl")));
const read1435 = (name: string, file: string): string => readFileSync(join(CASES_EXPORT_1435, name, file), "utf8");

describe("the recorded 14.35 export cases, on MemoryVfs (EXP-500 to EXP-520, EXP-550 to EXP-558)", () => {
  /** Replays a case with `parallelism` items in flight; a run that was stopped is replayed one at a time only, as on disk. */
  async function replay(name: string, parallelism: number): Promise<void> {
    const input = JSON.parse(read1435(name, "case.json")) as Case1435;
    if (needsRemoval1435(input)) {
      if (parallelism === 1) tally.add("export 14.35", "skipped");
      return;
    }
    const calls = readTranscript(join(CASES_EXPORT_1435, name, "transcript.jsonl"), BLOBS_EXPORT_1435);
    const { vfs, host } = virtualHost();
    const output = `${VFS_WORK}/output`;
    const logPath = `${VFS_WORK}/engine.log`;

    if (failsInConstructor(input)) {
      if (parallelism > 1) return;
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
      tally.add("export 14.35", "ran");
      return;
    }
    const recordedLog = read1435(name, "engine.log");
    const recordedMessages = read1435(name, "messages.jsonl")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as SentMessage);
    const failed = recordedMessages.some((message) => message.channel === "errorQuestion");
    const cancelAfter = input.options.cancelAfterStatus;
    const stoppedRun = failed || cancelAfter !== undefined || input.expectsError || recordedMessages.some((message) => message.channel === "warning");
    if (parallelism > 1 && stoppedRun) return;

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
      { fs: vfs, host, parallelism },
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
    const recordedDir = join(CASES_EXPORT_1435, name, "output");
    const recordedBytes = readDiskFiles(recordedDir);
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
    const ourLog = logParts(exportLog1435(logText(vfs, logPath), logPath, output));
    const theirLog = logParts(exportLog1435(recordedLog, logPath, output));
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
    if (parallelism === 1) tally.add("export 14.35", "ran");
  }

  it.each(caseNames1435)("%s", (name) => replay(name, 1), 60_000);
  it.each(caseNames1435)("%s, eight items in flight", (name) => replay(name, 8), 60_000);
});


describe("the 14.35 export cases run on MemoryVfs", () => {
  it("are all the cases of the disk replay, with none left out but the ones that wait for EXP-600 to EXP-699", () => {
    const cases = tally.get("export 14.35");
    expect(cases.ran + cases.skipped).toBe(caseNames1435.length);
    console.info(`MemoryVfs replay, export 14.35: ${tally}`);
  });
});
