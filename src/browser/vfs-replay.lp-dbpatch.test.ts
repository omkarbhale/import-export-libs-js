import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTranscript, type TranscriptCall } from "../../oracle/src/transcript.js";
import { CItemHelper } from "../client/item-helper.js";
import { ArasVersion } from "../client/version.js";
import { DBUpdateConfig } from "../db-patches/config.js";
import {
  CASES as DBPATCH_CASES,
  RecordedConnection as DbPatchConnection,
  field,
  masked,
  steps as dbPatchSteps,
} from "../db-patches/replay-support.js";
import type { Engine } from "../engines.js";
import { SolutionUpgradeContext } from "../export/export-context.js";
import { ImportExportManager } from "../export/import-export-manager.js";
import { type SentMessage, createMessagesFactory } from "../export/messages.js";
import { SUImportContext } from "../import/import-context.js";
import type { ConsoleWriter } from "../import/import-run.js";
import { SequentialConnection } from "../import/transcript-replay.js";
import { exceptionText } from "../language-pack/exception-text.js";
import { languagePackImport } from "../language-pack/lp-import.js";
import { RANDOM, comparable as lpLog, recordedConsole as lpConsole } from "../language-pack/replay-support.js";
import { VFS_WORK, assertTreesEqual, loadTreeIntoVfs } from "./test-support.js";
import { CaseCount, logText, virtualHost } from "./vfs-replay-support.js";

/**
 * The recorded language-pack and DB-patch runs replayed on the in-memory file system, under Node (HOST-217): every case the disk replays run (`lp-import.replay.test.ts` and `db-patches/replay.test.ts`) is run again
 * with `fs` a {@link MemoryVfs} and `host` a fake environment, so that the output folder, the log, the manifest and the package folder
 * never touch the disk. The recorded answers are served by the same connections, and what a run leaves behind is compared with the
 * same recording by the same comparisons, on the virtual tree: the output folder byte for byte (`assertTreesEqual`), the log, the
 * messages and the return code. The replays are in files of their own (`vfs-replay.*.test.ts`), as the disk replays are, so that
 * each runs in a worker of its own.
 *
 * @spec HOST-217 HOST-215 HOST-203
 */

const tally = new CaseCount();

// ---------------------------------------------------------------------------------------------------------- language pack

const CASES_LP_14_0_7 = new URL("../../fixtures/14.0.7/language-pack/", import.meta.url).pathname;
const CASES_LP_14_35 = new URL("../../fixtures/14.35/language-pack/", import.meta.url).pathname;

function replayLanguagePacks(engine: Engine, root: string): void {
  const cases = readdirSync(root).filter((name) => existsSync(join(root, name, "case.json")));

  describe(`the recorded ${engine} lpimport runs, on MemoryVfs (LP-001 to LP-036)`, () => {
    it.for(cases.map((name) => [name] as const))("%s", async ([name]) => {
      const dir = join(root, name);
      const definition = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as { lpPackage: string; lpDebug: boolean; languages?: string[] };
      const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as {
        server: { url: string; database: string; user: string };
        host: { result: string | null; error: string | null };
      };
      const calls = readTranscript(join(dir, "transcript.jsonl"), join(root, "_blobs"));
      // a run that ended in the constructor wrote no log (IMP-612)
      const logFile = join(dir, "engine.log");
      const recordedLog = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
      const recordedMessages = readFileSync(join(dir, "messages.jsonl"), "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as SentMessage);
      const osUser = /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";

      const { vfs, host } = virtualHost();
      const tempRoot = `${VFS_WORK}/tmp`;
      vfs.mkdir(tempRoot);
      loadTreeIntoVfs(join(dir, "lp"), vfs, "/lp");
      const logPath = `${VFS_WORK}/engine.log`;

      const context = new SolutionUpgradeContext();
      context.action = "LPImport";
      context.url = run.server.url;
      context.dataBase = run.server.database;
      context.userName = run.server.user;
      context.workingDirectory = VFS_WORK;
      context.logFilePath = logPath;
      context.lpPath = "/lp/ImportConfig.xml";
      context.lpPackage = definition.lpPackage;
      context.lpDebug = definition.lpDebug;
      context.languages = definition.languages ?? null;
      const importContext = new SUImportContext();
      importContext.release = null;
      importContext.description = null;

      const connection = new SequentialConnection(calls);
      const helper = new CItemHelper(connection, { engine });
      helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
      const sent: SentMessage[] = [];
      let console = "";
      const sink: ConsoleWriter = {
        write: (text) => void (console += text),
        writeLine: (text = "") => void (console += `${text}\r\n`),
      };
      const messages = createMessagesFactory({ onMessage: (message) => void sent.push(message) });
      const options = { fs: vfs, host, console: sink, osUser, tempPath: `${tempRoot}/`, randomFileName: () => RANDOM };

      const returned = /^ImportSolutions returned (\d+)$/.exec(run.host.result ?? "")?.[1];
      if (returned === undefined) {
        // the engine ended with an exception that the host rethrew (LP-003): the port throws the same one and the requests are the recorded ones
        expect(run.host.error, `${name}: the engine ended with an exception`).not.toBeNull();
        const failure = await languagePackImport(context, importContext, messages, helper, options).catch((error: unknown) => error);
        expect(exceptionText(failure).split(":")[0], `${name}: the exception`).toBe((run.host.error as string).split(":")[0]);
        expect(connection.consumed, `${name}: the requests of the run`).toBe(connection.total);
        expect(vfs.readdir(tempRoot), `${name}: the temp package is removed`).toEqual([]);
        tally.add(`language pack ${engine}`, "ran");
        return;
      }
      const code = await languagePackImport(context, importContext, messages, helper, options);

      expect(connection.consumed, `${name}: the requests of the run\n${logText(vfs, logPath).slice(-1500)}\n${console}`).toBe(connection.total);
      expect(sent.map(({ channel, text }) => ({ channel, text })), `${name}: the messages`).toEqual(
        recordedMessages.map(({ channel, text }) => ({ channel, text })),
      );
      expect(code, `${name}: the result`).toBe(Number(returned));
      expect(context.action, `${name}: the context became an import`).toBe("Import");
      expect(context.manifestFile, `${name}: the manifest is the temp one`).toBe(`${tempRoot}/LanguagePack_${RANDOM}\\imports.mf`);
      expect(lpLog(logText(vfs, logPath)), `${name}: the log`).toBe(lpLog(recordedLog));
      expect(console, `${name}: the console`).toBe(lpConsole(readFileSync(join(dir, "host.log"), "utf8")));

      const left = vfs.readdir(tempRoot).map((entry) => entry.name);
      if (definition.lpDebug) {
        expect(left, `${name}: lpdebug keeps the temp package`).toEqual([`LanguagePack_${RANDOM}`]);
        // the 14.35 recording did not copy the kept package; its pack is the 14.0.7 one, and the engine writes the same fixes for a Forum
        const kept = existsSync(join(dir, "temp-package")) ? join(dir, "temp-package") : join(CASES_LP_14_0_7, name, "temp-package");
        assertTreesEqual(vfs, `${tempRoot}/${left[0] as string}`, kept, `${name}: the kept package`);
      } else {
        expect(left, `${name}: the temp package is removed`).toEqual([]);
      }
      tally.add(`language pack ${engine}`, "ran");
    });
  });
}

replayLanguagePacks("14.0.7", CASES_LP_14_0_7);
replayLanguagePacks("14.35", CASES_LP_14_35);

// ----------------------------------------------------------------------------------------------------------------- DB patch

interface DbPatchRun {
  recorded: { messages: SentMessage[]; log: string };
  ours: { messages: SentMessage[]; log: string; thrown: unknown; connection: DbPatchConnection };
}

/** Runs one recorded DB patch step on the virtual tree: `ApplyDBUpdateManifest` over the step's input files, with the recorded user and ids. */
async function replayDbPatch(caseName: string, step: string): Promise<DbPatchRun> {
  const dir = join(DBPATCH_CASES, caseName, step);
  const calls: TranscriptCall[] = readTranscript(join(dir, "transcript.jsonl"), join(dir, "_blobs"));
  const recordedLog = readFileSync(join(dir, "engine.log"), "utf8");
  const recordedMessages = readFileSync(join(dir, "messages.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as SentMessage);

  const { vfs, host } = virtualHost();
  loadTreeIntoVfs(join(dir, "input"), vfs, VFS_WORK);
  const logPath = `${VFS_WORK}/engine.log`;

  const context = new SolutionUpgradeContext();
  context.action = field(recordedLog, "Action");
  context.url = field(recordedLog, "URL");
  context.dataBase = field(recordedLog, "Database");
  context.userName = field(recordedLog, "User");
  context.workingDirectory = VFS_WORK;
  context.logFilePath = logPath;
  const config = new DBUpdateConfig();
  config.dbUpdatedManifestFilePath = `${VFS_WORK}/manifest.xml`;
  config.dbPatchesFolderPath = VFS_WORK;
  config.toolName = field(recordedLog, "Tool name");

  const connection = new DbPatchConnection(calls);
  const helper = new CItemHelper(connection, { engine: "14.35" });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  const sent: SentMessage[] = [];
  // the ids the engine gave the items it added, in order, and the os_user it wrote
  const addedIds = calls.flatMap((call) => /^<Item [^>]*action="add" id="([0-9A-F]{32})"/.exec(call.request)?.[1] ?? []);
  const osUser = calls.flatMap((call) => /<os_user>([^<]*)<\/os_user>/.exec(call.request)?.[1] ?? [])[0];
  const manager = new ImportExportManager(context, createMessagesFactory({ engine: "14.35", onMessage: (message) => void sent.push(message) }), helper, {
    fs: vfs,
    host,
    now: () => new Date(2026, 9, 19, 2, 38, 8),
    ...(osUser === undefined ? {} : { osUser }),
  });
  let thrown: unknown;
  try {
    await manager.applyDBUpdateManifest(config, { newId: () => addedIds.shift() as string });
  } catch (error) {
    thrown = error;
  }
  return { recorded: { messages: recordedMessages, log: recordedLog }, ours: { messages: sent, log: logText(vfs, logPath), thrown, connection } };
}

describe("the recorded DB patch runs, on MemoryVfs (DBP-001 to DBP-044)", () => {
  it("non-root: the admin login is refused with the engine's message, and the log is the engine's", async () => {
    const { recorded, ours } = await replayDbPatch("non-root", "step-1");
    expect(ours.thrown).toBeInstanceOf(Error);
    expect((ours.thrown as Error).message).toBe("Login name is not root. It is 'admin'. Check your config file.");
    expect(ours.connection.mismatches).toEqual([]);
    expect(ours.connection.consumed).toBe(0);
    expect(ours.messages.map(({ channel, text }) => ({ channel, text: masked(text) }))).toEqual(
      recorded.messages.map(({ channel, text }) => ({ channel, text: masked(text) })),
    );
    expect(masked(ours.log)).toBe(masked(recorded.log));
    tally.add("db patch 14.35", "ran");
  });

  it.each(dbPatchSteps("apply"))("apply, %s: the requests, the messages and the log are the recorded ones, and nothing is thrown", async (step) => {
    const { recorded, ours } = await replayDbPatch("apply", step);
    expect(ours.connection.mismatches).toEqual([]);
    expect(ours.connection.consumed).toBe(ours.connection.total);
    expect(ours.messages.map(({ channel, text }) => ({ channel, text: masked(text) }))).toEqual(
      recorded.messages.map(({ channel, text }) => ({ channel, text: masked(text) })),
    );
    expect(masked(ours.log)).toBe(masked(recorded.log));
    expect(ours.thrown).toBeUndefined();
    tally.add("db patch 14.35", "ran");
  });
});


describe("the language-pack and DB-patch runs on MemoryVfs", () => {
  it("are all the cases of the disk replays", () => {
    expect(tally.get("language pack 14.0.7")).toEqual({ ran: 5, skipped: 0 });
    expect(tally.get("language pack 14.35")).toEqual({ ran: 8, skipped: 0 });
    expect(tally.get("db patch 14.35")).toEqual({ ran: 3, skipped: 0 });
    console.info(`MemoryVfs replay, language pack and DB patch: ${tally}`);
  });

  it("leave the disk alone: the virtual folders are not real ones", () => {
    expect(existsSync(VFS_WORK)).toBe(false);
    expect(existsSync("/lp")).toBe(false);
  });
});
