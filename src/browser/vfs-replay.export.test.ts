import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { packageCaches } from "../client/package-lookups.js";
import { ArasVersion } from "../client/version.js";
import type { Engine } from "../engines.js";
import { SUExportContext } from "../export/export-context.js";
import { ExportItem } from "../export/export-item.js";
import { ImportExportManager, type SelectionInsertions } from "../export/import-export-manager.js";
import { type SentMessage, createMessagesFactory } from "../export/messages.js";
import { REPLAYED_ENGINES, exportCases } from "../export/replay-cases.js";
import type { Case } from "../export/replay-cases.js";
import {
  comparable as exportLog,
  needsRemoval,
  read as readCase,
  settings,
} from "../export/replay-support.js";
import { SequentialConnection } from "../import/transcript-replay.js";
import { VFS_WORK, assertTreesEqual } from "./test-support.js";
import { CaseCount, logText, virtualHost } from "./vfs-replay-support.js";

/**
 * The recorded 14.0.7 and 12.0 export cases replayed on the in-memory file system, under Node (HOST-218): every case the disk replays run (`run-replay.test.ts`) is run again
 * with `fs` a {@link MemoryVfs} and `host` a fake environment, so that the output folder, the log, the manifest and the package folder
 * never touch the disk. The recorded answers are served by the same connections, and what a run leaves behind is compared with the
 * same recording by the same comparisons, on the virtual tree: the output folder byte for byte (`assertTreesEqual`), the log, the
 * messages and the return code. The replays are in files of their own (`vfs-replay.*.test.ts`), as the disk replays are, so that
 * each runs in a worker of its own.
 *
 * @spec HOST-218 HOST-215 HOST-203
 */

const tally = new CaseCount();

// ------------------------------------------------------------------------------------------------- export, 14.0.7 and 12.0

describe.each(REPLAYED_ENGINES)("the recorded %s export cases, on MemoryVfs (EXP-500 to EXP-520, EXP-600 to EXP-620)", (engine: Engine) => {
  const cases = exportCases(engine);

  it.each(cases.names)("%s", async (name) => {
    const input = JSON.parse(readCase(cases, name, "case.json")) as Case;
    if (needsRemoval(engine, input)) {
      tally.add(`export ${engine}`, "skipped");
      return;
    }
    // each case was recorded by a process of its own, and the dependency cache outlives a helper (EXP-619)
    packageCaches.dependsOn.clear();

    const calls = readTranscript(join(cases.dir, name, "transcript.jsonl"), cases.blobs);
    const recordedLog = readCase(cases, name, "engine.log");
    const recordedMessages = readCase(cases, name, "messages.jsonl")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as SentMessage & { answer: boolean | null });
    const abort = recordedMessages.some((message) => message.channel === "errorQuestion" && message.answer === true);

    const { vfs, host } = virtualHost();
    const output = `${VFS_WORK}/output`;
    const logPath = `${VFS_WORK}/engine.log`;
    const context = new SUExportContext();
    Object.assign(context, settings(cases, name, input, recordedLog));
    context.workingDirectory = output;
    context.logFilePath = logPath;

    const connection = new SequentialConnection(calls, cases.loginCalls);
    const helper = new CItemHelper(connection, { engine });
    helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
    const sent: SentMessage[] = [];
    const manager = new ImportExportManager(
      context,
      createMessagesFactory({ onMessage: (message) => void sent.push(message), onItemError: abort ? "abort-package" : "continue" }),
      helper,
      { fs: vfs, host, culture: "en-IN" },
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
    assertTreesEqual(vfs, output, join(cases.dir, name, "output"), name);
    const log = vfs.readFile(logPath);
    expect(log[0] === 0xef && log[1] === 0xbb && log[2] === 0xbf, `${name}: the log has no BOM`).toBe(false);
    expect(exportLog(logText(vfs, logPath), logPath, output), `${name}: the log`).toBe(exportLog(recordedLog, logPath, output));
    tally.add(`export ${engine}`, "ran");
  });
});


describe("the 14.0.7 and 12.0 cases run on MemoryVfs", () => {
  it("are all the cases of the disk replay, with none left out but the 12.0 ones that wait for EXP-600 to EXP-699", () => {
    expect(tally.get("export 14.0.7")).toEqual({ ran: exportCases("14.0.7").names.length, skipped: 0 });
    const twelve = tally.get("export 12.0");
    expect(twelve.ran + twelve.skipped).toBe(exportCases("12.0").names.length);
    console.info(`MemoryVfs replay, export: ${tally}`);
  });
});
