import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { CItemHelper } from "../client/item-helper.js";
import { ArasVersion } from "../client/version.js";
import type { Engine } from "../engines.js";
import { SolutionUpgradeContext } from "../export/export-context.js";
import { ImportExportManager } from "../export/import-export-manager.js";
import { type SentMessage, createMessagesFactory } from "../export/messages.js";
import { AggregateException } from "../export/parallel-for-each.js";
import { SUImportContext } from "../import/import-context.js";
import type { ConsoleWriter } from "../import/import-run.js";
import {
  type Step,
  comparable as importLog,
  headerValue as importHeader,
  recordedConsole,
  stepsOf,
} from "../import/replay-support.js";
import {
  BLOBS,
  BLOBS_12_0,
  BLOBS_14_35,
  CASES,
  CASES_12_0,
  CASES_14_35,
  LOGIN_CALLS_12_0,
  SequentialConnection,
} from "../import/transcript-replay.js";
import { exceptionText } from "../language-pack/exception-text.js";
import { VFS_WORK, assertTreesEqual, loadTreeIntoVfs } from "./test-support.js";
import { CaseCount, logText, virtualHost } from "./vfs-replay-support.js";

/**
 * The recorded import runs of 14.0.7, 14.35 and 12.0 replayed on the in-memory file system, under Node (HOST-217): every case the disk replays run (`import-run.replay.test.ts`) is run again
 * with `fs` a {@link MemoryVfs} and `host` a fake environment, so that the output folder, the log, the manifest and the package folder
 * never touch the disk. The recorded answers are served by the same connections, and what a run leaves behind is compared with the
 * same recording by the same comparisons, on the virtual tree: the output folder byte for byte (`assertTreesEqual`), the log, the
 * messages and the return code. The replays are in files of their own (`vfs-replay.*.test.ts`), as the disk replays are, so that
 * each runs in a worker of its own.
 *
 * @spec HOST-217 HOST-215 HOST-203
 */

const tally = new CaseCount();

// ------------------------------------------------------------------------------------------------------------------- import

/** The input of a step: its folder is loaded into the virtual tree at `/input`, where the manifest and the packages are. */
const INPUT = "/input";

function replayImports(engine: Engine, steps: Step[], blobs: string): void {
  describe(`the recorded ${engine} import runs, on MemoryVfs (IMP-400 to IMP-471)`, () => {
    it.for(steps.map((step) => [step.name, step] as const))("%s", async ([, step]) => {
      const calls = readTranscript(join(step.dir, "transcript.jsonl"), blobs);
      // a run refused in the constructor (IMP-612, IMP-621) wrote no log
      const logFile = join(step.dir, "engine.log");
      const recordedLog = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
      const run = JSON.parse(readFileSync(join(step.dir, "run.json"), "utf8")) as {
        server: { url: string; database: string; user: string };
        host: { result: string | null; error: string | null };
      };
      const recordedMessages = readFileSync(join(step.dir, "messages.jsonl"), "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as SentMessage);
      const osUser = /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";

      const { vfs, host } = virtualHost();
      loadTreeIntoVfs(join(step.dir, "input"), vfs, INPUT);
      const logPath = `${VFS_WORK}/engine.log`;

      const context = new SolutionUpgradeContext();
      context.action = "Import";
      context.url = run.server.url;
      context.dataBase = run.server.database;
      context.userName = run.server.user;
      context.manifestFile = `${INPUT}/imports.mf`;
      context.workingDirectory = INPUT;
      context.logFilePath = logPath;
      context.verbose = step.options.verbose === true;
      context.languages = step.options.languages ?? null;

      const importContext = new SUImportContext();
      importContext.merge = step.options.merge === true;
      importContext.release = step.options.release ?? null;
      importContext.description = step.options.description ?? null;
      if (step.options.amlBatch !== undefined) {
        importContext.amlBatchMode = true;
        importContext.amlBatchMaxSize = step.options.amlBatch.maxSize ?? 0;
      }
      if (step.options.collectErrors !== undefined) {
        importContext.collectImportErrors = true;
        importContext.collectImportErrorsMaxCount = step.options.collectErrors.maxCount ?? 0;
      }

      const connection = engine === "12.0" ? new SequentialConnection(calls, LOGIN_CALLS_12_0) : new SequentialConnection(calls);
      const helper = new CItemHelper(connection, { engine });
      helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
      const sent: SentMessage[] = [];
      let console = "";
      const sink: ConsoleWriter = {
        write: (text) => void (console += text),
        writeLine: (text = "") => void (console += `${text}\r\n`),
      };
      let statusMessages = 0;
      let manager: ImportExportManager | undefined;
      const messages = createMessagesFactory({
        onMessage: (message) => {
          sent.push(message);
          if (message.channel === "status") {
            statusMessages += 1;
            if (statusMessages === step.options.cancelAfterStatus) manager?.cancel();
          }
        },
      });
      const returned = /^ImportSolutions returned (\d+)$/.exec(run.host.result ?? "")?.[1];
      // a refused run ends in the constructor, with the exception (IMP-612, IMP-621): the host got no return code
      if (returned === undefined) {
        expect(run.host.error, `${step.name}: the engine ended with an exception`).not.toBeNull();
        let thrown: unknown;
        try {
          manager = new ImportExportManager(context, messages, helper, { fs: vfs, host, console: sink, osUser });
          await manager.importSolutions(manager.manifestFile?.getAllPackageNames() ?? [], new SUImportContext());
        } catch (error) {
          thrown = error;
        }
        expect(thrown, `${step.name}: the port ended with an exception`).toBeDefined();
        const [head, inner] = ((run.host.error as string).split("\r\n   at ")[0] as string).split(" ---> ") as [string, string | undefined];
        expect(exceptionText(thrown), `${step.name}: the exception`).toBe(inner === undefined ? head : `${head} ---> ${inner}`);
        if (thrown instanceof AggregateException) {
          expect(thrown.innerExceptions.map(exceptionText), `${step.name}: the inner exceptions`).toEqual([inner]);
        }
        expect(connection.consumed, `${step.name}: the requests of the run`).toBe(connection.total);
        tally.add(`import ${engine}`, "ran");
        return;
      }
      manager = new ImportExportManager(context, messages, helper, { fs: vfs, host, console: sink, osUser });
      const packages = step.only ?? manager.manifestFile?.getAllPackageNames() ?? [];

      const code = await manager.importSolutions(packages, importContext);

      expect(connection.consumed, `${step.name}: the requests of the run\n${logText(vfs, logPath).slice(-1500)}`).toBe(connection.total);
      expect(
        sent.map(({ channel, text }) => ({ channel, text })),
        `${step.name}: the messages`,
      ).toEqual(recordedMessages.map(({ channel, text }) => ({ channel, text })));
      expect(code, `${step.name}: the result`).toBe(Number(returned));
      const log = vfs.readFile(logPath);
      expect(log[0] === 0xef && log[1] === 0xbb && log[2] === 0xbf, `${step.name}: the log has no BOM`).toBe(false);
      // 12.0 writes no header either, so the recorded input folder is read from the path of a skipped file (IMP-008)
      const recordedInput = /^Working directory: (.*)\r$/m.exec(recordedLog)?.[1] ?? /^WARNING: File '(.*?)\\LIBSJS-SCRATCH-[^\\]*\\/m.exec(recordedLog)?.[1] ?? "";
      // 12.0 writes no header, so the recorded log path is known only from the sharing violation the log may hold (IMP-410)
      const recordedLogPath = importHeader(recordedLog, "Log file") || (/file '([^']*)' because it is being used/.exec(recordedLog)?.[1] ?? "");
      const actualLog = importLog(Buffer.from(log).toString("utf8"), recordedInput, INPUT, logPath);
      const wantedLog = importLog(recordedLog, recordedInput, INPUT, recordedLogPath);
      if (engine === "12.0" && /^WARNING: File '/m.test(recordedLog)) {
        // 12.0 drops the tail of a package's log after the last full 1024 characters (IMP-412): one log is the other's prefix
        expect(actualLog.startsWith(wantedLog) || wantedLog.startsWith(actualLog), `${step.name}: the log, up to the cut`).toBe(true);
        expect(Math.min(actualLog.length, wantedLog.length), `${step.name}: most of the log is compared`).toBeGreaterThan(1024);
      } else {
        expect(actualLog, `${step.name}: the log`).toBe(wantedLog);
      }
      expect(console, `${step.name}: the console`).toBe(recordedConsole(readFileSync(join(step.dir, "host.log"), "utf8")));
      // an import reads the package folder and never changes it
      assertTreesEqual(vfs, INPUT, join(step.dir, "input"), `${step.name}: the input folder`);
      tally.add(`import ${engine}`, "ran");
    });
  });
}

replayImports("14.0.7", stepsOf(CASES), BLOBS);
replayImports("14.35", stepsOf(CASES_14_35), BLOBS_14_35);
replayImports("12.0", stepsOf(CASES_12_0), BLOBS_12_0);


describe("the import runs on MemoryVfs", () => {
  it("are all the steps of the disk replay", () => {
    expect(tally.get("import 14.0.7")).toEqual({ ran: stepsOf(CASES).length, skipped: 0 });
    expect(tally.get("import 14.35")).toEqual({ ran: stepsOf(CASES_14_35).length, skipped: 0 });
    expect(tally.get("import 12.0")).toEqual({ ran: stepsOf(CASES_12_0).length, skipped: 0 });
    console.info(`MemoryVfs replay, import: ${tally}`);
  });
});
