import { expect } from "vitest";
import type { TranscriptCall } from "../../oracle/src/transcript.js";
import { ArasVersion, CItemHelper, ImportExportManager, SUImportContext, SolutionUpgradeContext, createMessagesFactory } from "../browser.js";
import type { Engine } from "../engines.js";
import { type SentMessage } from "../export/messages.js";
import { AggregateException } from "../export/parallel-for-each.js";
import type { ConsoleWriter } from "../import/import-run.js";
import { type Step, comparable as importLog, headerValue as importHeader, recordedConsole } from "../import/replay-compare.js";
import { LOGIN_CALLS_12_0, SequentialConnection } from "../import/sequential-connection.js";
import { exceptionText } from "../language-pack/exception-text.js";
import { type FixtureCase, fixtureBlobPath, fixtureCasePath, transcriptBlobs } from "./fixture-set.js";
import { createBrowserEnv } from "./host.js";
import { type FixtureFile, assertTreeMatchesFiles, filesBelow, loadFixtureTree, mountFixtureFiles, parseTranscript, readFixtureText, textOf } from "./test-support.browser.js";
import { MemoryVfs } from "../host/memory-fs.js";

/**
 * What the browsers' replays of the recorded import runs share (HOST-266): reading a case and its blobs through the fixture commands,
 * the virtual tree and host a run gets, and one recorded import step. They were the head of `import-replay.browser.test.ts`, moved here
 * unchanged so that the adapter tests (HOST-250 to HOST-255, `*-adapter.browser.test.ts`) run the same recorded import on a tree that
 * a zip, a directory handle or a file list produced; the one addition is `mountInput` of {@link replayImportStep}.
 *
 * @spec HOST-266 HOST-218 HOST-243 HOST-263 IMP-612
 */

/** The working folder of a run, and the folder a package is mounted at. */
export const WORK = "/work";
export const INPUT = "/input";

/** The text of a recorded blob, once, as the transcripts of every case that names it read it. */
export const blobTexts = new Map<string, Promise<string>>();
export function readBlob(fixture: Pick<FixtureCase, "engine" | "operation">, sha: string): Promise<string> {
  const path = fixtureBlobPath(fixture, sha);
  let text = blobTexts.get(path);
  if (text === undefined) {
    text = readFixtureText(path);
    blobTexts.set(path, text);
  }
  return text;
}

/** The calls of a recorded transcript with the blobs put back, read through the fixture commands. */
export async function readCalls(fixture: Pick<FixtureCase, "engine" | "operation">, transcript: string): Promise<TranscriptCall[]> {
  const blobs = new Map<string, string>();
  for (const sha of transcriptBlobs(transcript)) blobs.set(sha, await readBlob(fixture, sha));
  return parseTranscript(transcript, (sha) => blobs.get(sha) as string);
}

export const messageLines = (text: string | undefined): SentMessage[] =>
  (text ?? "")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as SentMessage);

export const channelText = (messages: readonly SentMessage[]): Array<{ channel: string; text: string }> => messages.map(({ channel, text }) => ({ channel, text }));

/** The browser's own host environment for a run: the platform `browser`, the current folder `/work`, a real clock and real randomness. */
export const browserEnv = () => createBrowserEnv({ cwd: WORK });

/** A virtual file system with the working folder of a run in it. */
export function virtualFs(): MemoryVfs {
  const vfs = new MemoryVfs();
  vfs.mount({ [`${WORK}/`]: "" });
  return vfs;
}

export const textOfLog = (vfs: MemoryVfs, path: string): string => new TextDecoder("utf-8", { ignoreBOM: true }).decode(vfs.readFile(path));

/** A recorded call after the login that holds an item request: the one a corrupted recording changes. */
export function corruptARequest(calls: TranscriptCall[], loginCalls: number): void {
  const call = calls.slice(loginCalls).find((candidate) => candidate.request.includes("<Item "));
  if (call === undefined) throw new Error("the recording has no item request to corrupt");
  call.request = call.request.replace("<Item ", '<Item corrupted="1" ');
}

// ------------------------------------------------------------------------------------------------------------------- import

/** The steps of a recorded import case, as `stepsOf` reads them from the disk: the folder of each is the repository-relative path. */
export async function stepsOfCase(fixture: FixtureCase): Promise<Step[]> {
  const folder = fixtureCasePath(fixture);
  const definition = JSON.parse(await readFixtureText(`${folder}/case.json`)) as { steps: Array<Omit<Step, "name" | "dir">> };
  return definition.steps.map((step, index) => ({
    name: `${fixture.name}/step-${index + 1}`,
    dir: `${folder}/step-${index + 1}`,
    options: step.options ?? {},
    ...(step.only === undefined ? {} : { only: step.only }),
  }));
}

/** Where the log of a step is in the tree of its case: a folder of the step's own below the working folder. */
export const stepLogFolder = (step: Step): string => `${WORK}/${step.dir.split("/").pop() as string}`;
export const stepLog = (step: Step): string => `${stepLogFolder(step)}/engine.log`;

/**
 * One recorded import step: the package folder of the step is mounted at `/input`, `ImportExportManager.importSolutions` runs it
 * against the recorded answers, and everything it did is compared with the recording. `corrupt` changes the expected requests
 * before the run, which the comparison must then refuse. `vfs` is the tree of a case whose earlier steps have run: the step's package
 * folder replaces `/input`, and its log is a file of its own below `/work`, so that what the steps before it left stays as it was.
 */
export async function replayImportStep(
  fixture: FixtureCase,
  step: Step,
  {
    corrupt,
    vfs = virtualFs(),
    mountInput,
  }: {
    corrupt?: (calls: TranscriptCall[], loginCalls: number) => void;
    vfs?: MemoryVfs;
    /**
     * Puts the package folder into the tree at `INPUT` in place of the recorded files, which the run is still compared with: the
     * adapter tests (HOST-250 to HOST-255) pass the tree a zip, a directory handle or a file list made. It is called with the tree
     * and the folder, after `INPUT` was removed, and returns nothing.
     */
    mountInput?: (vfs: MemoryVfs, at: string, recorded: readonly FixtureFile[]) => void | Promise<void>;
  } = {},
): Promise<void> {
  const engine: Engine = fixture.engine;
  const files = await loadFixtureTree(step.dir);
  const calls = await readCalls(fixture, textOf(files, "transcript.jsonl") ?? "");
  // a run refused in the constructor (IMP-612, IMP-621) wrote no log
  const recordedLog = textOf(files, "engine.log") ?? "";
  const run = JSON.parse(textOf(files, "run.json") ?? "{}") as {
    server: { url: string; database: string; user: string };
    host: { result: string | null; error: string | null };
  };
  const recordedMessages = messageLines(textOf(files, "messages.jsonl"));
  const osUser = /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";
  const loginCalls = engine === "12.0" ? LOGIN_CALLS_12_0 : 6;
  corrupt?.(calls, loginCalls);

  const input = filesBelow(files, "input");
  if (vfs.exists(INPUT)) vfs.rm(INPUT, { recursive: true });
  if (mountInput === undefined) mountFixtureFiles(input, vfs, INPUT);
  else await mountInput(vfs, INPUT, input);
  vfs.mount({ [`${stepLogFolder(step)}/`]: "" });
  const logPath = stepLog(step);

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
  const options = { fs: vfs, host: browserEnv(), console: sink, osUser };
  const returned = /^ImportSolutions returned (\d+)$/.exec(run.host.result ?? "")?.[1];

  // a refused run ends in the constructor, with the exception (IMP-612, IMP-621): the host got no return code
  if (returned === undefined) {
    expect(run.host.error, `${step.name}: the engine ended with an exception`).not.toBeNull();
    let thrown: unknown;
    try {
      manager = new ImportExportManager(context, messages, helper, options);
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
    return;
  }
  manager = new ImportExportManager(context, messages, helper, options);
  const packages = step.only ?? manager.manifestFile?.getAllPackageNames() ?? [];

  const code = await manager.importSolutions(packages, importContext);

  expect(connection.consumed, `${step.name}: the requests of the run\n${textOfLog(vfs, logPath).slice(-1500)}`).toBe(connection.total);
  expect(channelText(sent), `${step.name}: the messages`).toEqual(channelText(recordedMessages));
  expect(code, `${step.name}: the result`).toBe(Number(returned));
  const log = vfs.readFile(logPath);
  expect(log[0] === 0xef && log[1] === 0xbb && log[2] === 0xbf, `${step.name}: the log has no BOM`).toBe(false);
  // 12.0 writes no header either, so the recorded input folder is read from the path of a skipped file (IMP-008)
  const recordedInput = /^Working directory: (.*)\r$/m.exec(recordedLog)?.[1] ?? /^WARNING: File '(.*?)\\LIBSJS-SCRATCH-[^\\]*\\/m.exec(recordedLog)?.[1] ?? "";
  // 12.0 writes no header, so the recorded log path is known only from the sharing violation the log may hold (IMP-410)
  const recordedLogPath = importHeader(recordedLog, "Log file") || (/file '([^']*)' because it is being used/.exec(recordedLog)?.[1] ?? "");
  const actualLog = importLog(new TextDecoder("utf-8", { ignoreBOM: true }).decode(log), recordedInput, INPUT, logPath);
  const wantedLog = importLog(recordedLog, recordedInput, INPUT, recordedLogPath);
  if (engine === "12.0" && /^WARNING: File '/m.test(recordedLog)) {
    // 12.0 drops the tail of a package's log after the last full 1024 characters (IMP-412): one log is the other's prefix
    expect(actualLog.startsWith(wantedLog) || wantedLog.startsWith(actualLog), `${step.name}: the log, up to the cut`).toBe(true);
    expect(Math.min(actualLog.length, wantedLog.length), `${step.name}: most of the log is compared`).toBeGreaterThan(1024);
  } else {
    expect(actualLog, `${step.name}: the log`).toBe(wantedLog);
  }
  expect(console, `${step.name}: the console`).toBe(recordedConsole(textOf(files, "host.log") ?? ""));
  // an import reads the package folder and never changes it
  assertTreeMatchesFiles(vfs, INPUT, input, `${step.name}: the input folder`);
}
