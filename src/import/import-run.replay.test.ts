import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { CItemHelper } from "../client/item-helper.js";
import { ArasVersion } from "../client/version.js";
import { SolutionUpgradeContext } from "../export/export-context.js";
import { ImportExportManager } from "../export/import-export-manager.js";
import { type SentMessage, createMessagesFactory } from "../export/messages.js";
import { AggregateException } from "../export/parallel-for-each.js";
import { exceptionText } from "../language-pack/exception-text.js";
import { SUImportContext } from "./import-context.js";
import type { ConsoleWriter } from "./import-run.js";
import type { Engine } from "../engines.js";
import { BLOBS, BLOBS_12_0, BLOBS_14_35, CASES, CASES_12_0, CASES_14_35, LOGIN_CALLS_12_0, SequentialConnection } from "./transcript-replay.js";

/**
 * The recorded 14.0.7 import runs (ticket 25) and the 14.35 ones (ticket 75), replayed through the whole of `ImportSolutions`
 * (IMP-400 to IMP-471, and for 14.35 the rules of tickets 53 and 55: the AML batch mode and the collected errors). Each case
 * step is one run of the real engine on dev. The port gets the step's own `input/` (manifest and packages) and the recorded
 * answers, one request after the other in the recorded order, and must send exactly the recorded requests, send the recorded
 * messages, write the recorded log and console text, and return what the engine returned. The log differs from the recording
 * only where the run's own paths and clock come in, which are replaced on both sides.
 */

interface Step {
  name: string;
  dir: string;
  options: {
    merge?: boolean;
    release?: string;
    description?: string;
    verbose?: boolean;
    cancelAfterStatus?: number;
    amlBatch?: { maxSize?: number };
    collectErrors?: { maxCount?: number };
    languages?: string[];
  };
  only?: string[];
}

/**
 * The steps of a recorded case folder. `skip` names the cases that exercise what another slice builds.
 */
function stepsOf(casesDir: string, skip: (name: string) => boolean = () => false): Step[] {
  return readdirSync(casesDir)
    .filter((name) => existsSync(join(casesDir, name, "case.json")) && !skip(name))
    .flatMap((name) => {
      const definition = JSON.parse(readFileSync(join(casesDir, name, "case.json"), "utf8")) as { steps: Omit<Step, "name" | "dir">[] };
      return definition.steps.map((step, index) => ({
        name: `${name}/step-${index + 1}`,
        dir: join(casesDir, name, `step-${index + 1}`),
        options: step.options ?? {},
        ...(step.only === undefined ? {} : { only: step.only }),
      }));
    });
}

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** The header line `Label: value` of the recorded log, which holds the host's settings. */
const headerValue = (log: string, label: string): string => new RegExp(`^${label}: (.*)\\r$`, "m").exec(log)?.[1] ?? "";

const CLOCK = /\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d/g;
/** The time spans of a batch (`TimeSpan.ToString()`), which differ from run to run (IMP-514). */
const TIME_SPAN = /(\r\n   (?:AML batch|Resolve dependencies) time: )(?:\d+\.)?\d\d:\d\d:\d\d(?:\.\d+)?/g;

/** The log with what is the run's own replaced: the paths of the header, the item files and every date-time. */
function comparable(log: string, recordedInput: string, input: string, logPath: string): string {
  const inputRelative = (path: string): string => {
    const rest = path.startsWith(input) ? path.slice(input.length) : path.startsWith(recordedInput) ? path.slice(recordedInput.length) : path;
    return `<input>${rest.replace(/\\/g, "/")}`;
  };
  return log
    .replace(/^(Manifest file: ).*(\r)$/m, "$1<manifest>$2")
    .replace(/^(Log file: ).*(\r)$/m, "$1<log>$2")
    .replace(/^(Working directory: ).*(\r)$/m, "$1<working>$2")
    .replace(/^(File full name )'(.*)'(\r?)$/gm, (_, label: string, path: string, end: string) => `${label}'${inputRelative(path)}'${end}`)
    .replace(/^(WARNING: File )'(.*)'( doesn't have )/gm, (_, label: string, path: string, rest: string) => `${label}'${inputRelative(path)}'${rest}`)
    .replace(CLOCK, "<time>")
    // 12.0 cuts a package's log mid-line (IMP-412): a date-time that the cut leaves incomplete still depends on the day of the run
    .replace(/(of execution : )\d[\d/: -]*$/, "$1<time>")
    .replace(TIME_SPAN, "$1<span>")
    .split(logPath === "" ? "\u0000" : logPath)
    .join("<log>");
}

/** What the oracle host wrote to the console: the lines of `host.log` between the engine banner and `HOST_EXIT`. */
function recordedConsole(hostLog: string): string {
  const afterBanner = hostLog.slice(hostLog.indexOf("\r\n") + 2);
  return afterBanner.slice(0, afterBanner.lastIndexOf("HOST_EXIT"));
}

function replayRuns(engine: Engine, steps: Step[], blobs: string, minimum: number, minimumRefused = 0): void {
  const seen = {
    runs: 0,
    failed: 0,
    cancelled: 0,
    merged: 0,
    verbose: 0,
    messages: 0,
    refused: 0,
  };

  describe(`the recorded ${engine} import runs, through ImportSolutions (IMP-400 to IMP-471)`, () => {
    it("has import steps to replay", () => {
      expect(steps.length).toBeGreaterThan(minimum);
    });

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

      const work = mkdtempSync(join(tmpdir(), "libsjs-import-"));
      roots.push(work);
      const input = join(step.dir, "input");
      const logPath = join(work, "engine.log");

      const context = new SolutionUpgradeContext();
      context.action = "Import";
      context.url = run.server.url;
      context.dataBase = run.server.database;
      context.userName = run.server.user;
      context.manifestFile = join(input, "imports.mf");
      context.workingDirectory = input;
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
          manager = new ImportExportManager(context, messages, helper, { cwd: work, console: sink, osUser });
          await manager.importSolutions(manager.manifestFile?.getAllPackageNames() ?? [], new SUImportContext());
        } catch (error) {
          thrown = error;
        }
        expect(thrown, `${step.name}: the port ended with an exception`).toBeDefined();
        const [head, inner] = ((run.host.error as string).split("\r\n   at ")[0] as string).split(" ---> ") as [string, string | undefined];
        expect(exceptionText(thrown), `${step.name}: the exception`).toBe(head);
        // an AggregateException shows its inner exceptions after `--->` (IMP-612)
        if (thrown instanceof AggregateException) {
          expect(thrown.innerExceptions.map(exceptionText), `${step.name}: the inner exceptions`).toEqual([inner]);
        }
        expect(connection.consumed, `${step.name}: the requests of the run`).toBe(connection.total);
        seen.refused += 1;
        return;
      }
      manager = new ImportExportManager(context, messages, helper, {
        cwd: work,
        console: sink,
        osUser,
      });
      const packages = step.only ?? manager.manifestFile?.getAllPackageNames() ?? [];

      const code = await manager.importSolutions(packages, importContext);

      expect(connection.consumed, `${step.name}: the requests of the run\n${readFileSync(logPath, "utf8").slice(-1500)}`).toBe(
        connection.total,
      );
      expect(
        sent.map(({ channel, text }) => ({ channel, text })),
        `${step.name}: the messages`,
      ).toEqual(recordedMessages.map(({ channel, text }) => ({ channel, text })));
      expect(code, `${step.name}: the result`).toBe(Number(returned));
      const log = readFileSync(logPath);
      expect(log.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), `${step.name}: the log has no BOM`).toBe(false);
      // 12.0 writes no header either, so the recorded input folder is read from the path of a skipped file (IMP-008)
      const recordedInput = /^Working directory: (.*)\r$/m.exec(recordedLog)?.[1] ?? /^WARNING: File '(.*?)\\LIBSJS-SCRATCH-[^\\]*\\/m.exec(recordedLog)?.[1] ?? "";
      // 12.0 writes no header, so the recorded log path is known only from the sharing violation the log may hold (IMP-410)
      const recordedLogPath = headerValue(recordedLog, "Log file") || (/file '([^']*)' because it is being used/.exec(recordedLog)?.[1] ?? "");
      const actualLog = comparable(log.toString("utf8"), recordedInput, input, logPath);
      const wantedLog = comparable(recordedLog, recordedInput, input, recordedLogPath);
      if (engine === "12.0" && /^WARNING: File '/m.test(recordedLog)) {
        // 12.0 drops the tail of a package's log after the last full 1024 characters (IMP-412), and the recorded path of a skipped file is
        // longer or shorter than this run's, so the cut falls elsewhere: one log is the other's prefix, and each ends a block after the first line
        expect(actualLog.startsWith(wantedLog) || wantedLog.startsWith(actualLog), `${step.name}: the log, up to the cut`).toBe(true);
        expect(Math.min(actualLog.length, wantedLog.length), `${step.name}: most of the log is compared`).toBeGreaterThan(1024);
      } else {
        expect(actualLog, `${step.name}: the log`).toBe(wantedLog);
      }
      expect(console, `${step.name}: the console`).toBe(recordedConsole(readFileSync(join(step.dir, "host.log"), "utf8")));

      seen.runs += 1;
      seen.messages += sent.length;
      if (code !== 0) seen.failed += 1;
      if (step.options.cancelAfterStatus !== undefined) seen.cancelled += 1;
      if (step.options.merge === true) seen.merged += 1;
      if (step.options.verbose === true) seen.verbose += 1;
    });

    it("reached the failure, cancel, merge, verbose and refused paths", () => {
      expect(seen.refused).toBeGreaterThanOrEqual(minimumRefused);
      expect(seen.runs).toBeGreaterThan(minimum);
      expect(seen.failed).toBeGreaterThan(0);
      expect(seen.cancelled).toBeGreaterThan(0);
      expect(seen.merged).toBeGreaterThan(0);
      expect(seen.verbose).toBeGreaterThan(0);
    });
  });
}

replayRuns("14.0.7", stepsOf(CASES), BLOBS, 40);
replayRuns(
  "14.35",
  stepsOf(CASES_14_35),
  BLOBS_14_35,
  30,
  3,
);
replayRuns("12.0", stepsOf(CASES_12_0), BLOBS_12_0, 35);
