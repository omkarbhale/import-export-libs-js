import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readTranscript, type TranscriptCall } from "../../oracle/src/transcript.js";
import { CItemHelper } from "../client/item-helper.js";
import { ArasVersion } from "../client/version.js";
import { SolutionUpgradeContext } from "../export/export-context.js";
import { ImportExportManager } from "../export/import-export-manager.js";
import { type SentMessage, createMessagesFactory } from "../export/messages.js";
import { SUImportContext } from "./import-context.js";
import type { ConsoleWriter } from "./import-run.js";
import { BLOBS, CASES, SequentialConnection } from "./transcript-replay.js";

/**
 * The recorded 14.0.7 import runs (ticket 25), replayed through the whole of `ImportSolutions` (IMP-400 to IMP-471). Each case
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
  };
  only?: string[];
}

const steps: Step[] = readdirSync(CASES)
  .filter((name) => existsSync(join(CASES, name, "case.json")))
  .flatMap((name) => {
    const definition = JSON.parse(readFileSync(join(CASES, name, "case.json"), "utf8")) as { steps: Omit<Step, "name" | "dir">[] };
    return definition.steps.map((step, index) => ({
      name: `${name}/step-${index + 1}`,
      dir: join(CASES, name, `step-${index + 1}`),
      options: step.options ?? {},
      ...(step.only === undefined ? {} : { only: step.only }),
    }));
  });

/**
 * Steps whose run differs for a reason outside the import run. `fs-odd-files`: the engine lists `LIBSJS-SCRATCH-Fs_Backup.xmlbak`
 * after the `.xml` files, because NTFS finds a file that only its 8.3 short name (`LIBSJS~1.XML`) matches `*.xml` at the short
 * name's place in the directory index, which sorts after every `LIBSJS-…` entry. The loader (`IMP-003`, `IMP-004`) sorts it by its
 * long name, so the items reach the run in another order. Wayfinder ticket 36's rules do not cover short names yet.
 */
const KNOWN_LOADER_GAPS = new Set(["fs-odd-files/step-1"]);

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** The header line `Label: value` of the recorded log, which holds the host's settings. */
const headerValue = (log: string, label: string): string => new RegExp(`^${label}: (.*)\\r$`, "m").exec(log)?.[1] ?? "";

const CLOCK = /\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d/g;

/** The log with what is the run's own replaced: the paths of the header, the item files and every date-time. */
function comparable(log: string, recordedInput: string, input: string, logPath: string): string {
  return log
    .replace(/^(Manifest file: ).*(\r)$/m, "$1<manifest>$2")
    .replace(/^(Log file: ).*(\r)$/m, "$1<log>$2")
    .replace(/^(Working directory: ).*(\r)$/m, "$1<working>$2")
    .replace(/^File full name '(.*)'(\r?)$/gm, (_, path: string, end: string) => {
      const rest = path.startsWith(input) ? path.slice(input.length) : path.startsWith(recordedInput) ? path.slice(recordedInput.length) : path;
      return `File full name '<input>${rest.replace(/\\/g, "/")}'${end}`;
    })
    .replace(CLOCK, "<time>")
    .split(logPath)
    .join("<log>");
}

/** What the oracle host wrote to the console: the lines of `host.log` between the engine banner and `HOST_EXIT`. */
function recordedConsole(hostLog: string): string {
  const afterBanner = hostLog.slice(hostLog.indexOf("\r\n") + 2);
  return afterBanner.slice(0, afterBanner.lastIndexOf("HOST_EXIT"));
}

const seen = { runs: 0, failed: 0, cancelled: 0, merged: 0, verbose: 0, messages: 0 };

describe("the recorded 14.0.7 import runs, through ImportSolutions (IMP-400 to IMP-471)", () => {
  it("has import steps to replay", () => {
    expect(steps.length).toBeGreaterThan(40);
  });

  it.for(steps.filter((step) => !KNOWN_LOADER_GAPS.has(step.name)).map((step) => [step.name, step] as const))("%s", async ([, step]) => {
    const calls = readTranscript(join(step.dir, "transcript.jsonl"), BLOBS);
    const recordedLog = readFileSync(join(step.dir, "engine.log"), "utf8");
    const run = JSON.parse(readFileSync(join(step.dir, "run.json"), "utf8")) as { host: { result: string | null; error: string | null } };
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
    context.url = headerValue(recordedLog, "URL");
    context.dataBase = headerValue(recordedLog, "Database");
    context.userName = headerValue(recordedLog, "User");
    context.manifestFile = join(input, "imports.mf");
    context.workingDirectory = input;
    context.logFilePath = logPath;
    context.verbose = step.options.verbose === true;

    const importContext = new SUImportContext();
    importContext.merge = step.options.merge === true;
    importContext.release = step.options.release ?? null;
    importContext.description = step.options.description ?? null;

    const connection = new SequentialConnection(calls);
    const helper = new CItemHelper(connection);
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
    manager = new ImportExportManager(context, messages, helper, { cwd: work, console: sink, osUser });
    const packages = step.only ?? manager.manifestFile?.getAllPackageNames() ?? [];

    const returned = /^ImportSolutions returned (\d+)$/.exec(run.host.result ?? "")?.[1];
    expect(returned, `${step.name}: the engine returned a code`).toBeDefined();
    const code = await manager.importSolutions(packages, importContext);

    expect(connection.consumed, `${step.name}: the requests of the run\n${readFileSync(logPath, "utf8").slice(-1500)}`).toBe(connection.total);
    expect(sent.map(({ channel, text }) => ({ channel, text })), `${step.name}: the messages`).toEqual(
      recordedMessages.map(({ channel, text }) => ({ channel, text })),
    );
    expect(code, `${step.name}: the result`).toBe(Number(returned));
    const log = readFileSync(logPath);
    expect(log.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), `${step.name}: the log has no BOM`).toBe(false);
    const recordedInput = /^Working directory: (.*)\r$/m.exec(recordedLog)?.[1] ?? "";
    expect(comparable(log.toString("utf8"), recordedInput, input, logPath), `${step.name}: the log`).toBe(
      comparable(recordedLog, recordedInput, input, headerValue(recordedLog, "Log file")),
    );
    expect(console, `${step.name}: the console`).toBe(recordedConsole(readFileSync(join(step.dir, "host.log"), "utf8")));

    seen.runs += 1;
    seen.messages += sent.length;
    if (code !== 0) seen.failed += 1;
    if (step.options.cancelAfterStatus !== undefined) seen.cancelled += 1;
    if (step.options.merge === true) seen.merged += 1;
    if (step.options.verbose === true) seen.verbose += 1;
  });

  it.skip.for([...KNOWN_LOADER_GAPS])("%s differs in the order of the package's files (see KNOWN_LOADER_GAPS)", () => undefined);

  it("reached the failure, cancel, merge and verbose paths", () => {
    expect(seen.runs).toBeGreaterThan(40);
    expect(seen.failed).toBeGreaterThan(0);
    expect(seen.cancelled).toBeGreaterThan(0);
    expect(seen.merged).toBeGreaterThan(0);
    expect(seen.verbose).toBeGreaterThan(0);
  });
});
