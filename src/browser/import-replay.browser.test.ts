import { describe, expect, it } from "vitest";
import { cdp, server } from "vitest/browser";
import type { TranscriptCall } from "../../oracle/src/transcript.js";
import { ArasVersion, CItemHelper, DBUpdateConfig, ImportExportManager, SUImportContext, SolutionUpgradeContext, createMessagesFactory, languagePackImport, leftBehindTempFolder } from "../browser.js";
import { RecordedConnection, field, masked } from "../db-patches/recorded-connection.js";
import { type SentMessage } from "../export/messages.js";
import type { ConsoleWriter } from "../import/import-run.js";
import type { Step } from "../import/replay-compare.js";
import { SequentialConnection } from "../import/sequential-connection.js";
import { pathGetRandomFileName, pathGetTempPath } from "../io/temp-path.js";
import { exceptionText } from "../language-pack/exception-text.js";
import { RANDOM, comparable as lpLog, recordedConsole as lpConsole } from "../language-pack/replay-support.js";
import { FIXTURE_CASES, type FixtureCase, fixtureCasePath } from "./fixture-set.js";
import { BROWSER_REPLAY_ENGINES } from "./replay-engines.js";
import {
  type FixtureFile,
  assertTreeMatchesFiles,
  filesBelow,
  loadFixtureTree,
  mountFixtureFiles,
  textOf,
} from "./test-support.browser.js";
import { MemoryVfs } from "../host/memory-fs.js";
import { INPUT, WORK, browserEnv, channelText, corruptARequest, messageLines, readCalls, replayImportStep, stepLog, stepsOfCase, textOfLog, virtualFs } from "./import-replay-support.browser.js";

/**
 * The recorded import, language-pack and DB-patch runs of the three engines, replayed in the browser the report names (HOST-266): the
 * run is the one `vfs-replay.*.test.ts` makes under Node (HOST-218), with the browser's own host environment (`createBrowserEnv`,
 * HOST-243) and a {@link MemoryVfs} in place of the disk, and with every file of the recording read through the fixture commands of
 * HOST-263 in place of `node:fs`. The recorded answers are served by the same connections, and what a run leaves behind is compared with
 * the recording by the same comparisons: the requests, in the order the engine sent them, the messages, the return code, the log and the
 * console text, and the package folder, which an import reads and never changes, byte for byte. The cases are those of
 * `fixture-set.ts`; the same assertions run in Chromium, Firefox and WebKit, so a difference between the browsers is a failure of the one
 * that differs.
 *
 * @spec HOST-266 HOST-218 HOST-243 HOST-263 LP-030 LP-034 LP-035 IMP-612 DBP-030 DBP-043
 */

const operationOf = (operation: FixtureCase["operation"]): FixtureCase[] => FIXTURE_CASES.filter((fixture) => fixture.operation === operation);

/** What each family of replays of this file ran, for the counts at the end. */
const tally = new Map<string, number>();
const count = (family: string): void => void tally.set(family, (tally.get(family) ?? 0) + 1);


const importCases = operationOf("import");
const importSteps = new Map<FixtureCase, Step[]>();
for (const fixture of importCases) importSteps.set(fixture, await stepsOfCase(fixture));

for (const engine of BROWSER_REPLAY_ENGINES) {
  const cases = importCases.filter((fixture) => fixture.engine === engine);
  describe(`HOST-266: the recorded ${engine} import runs, in the browser (IMP-400 to IMP-471)`, () => {
    // the steps of a case run one after the other on one tree: each leaves its log in the tree, and the next must leave it alone
    it.for(cases.map((fixture) => [fixture.name, fixture] as const))("%s", async ([, fixture]) => {
      const vfs = virtualFs();
      const steps = importSteps.get(fixture) ?? [];
      const logs = new Map<string, Uint8Array>();
      for (const step of steps) {
        await replayImportStep(fixture, step, { vfs });
        // a run refused in the constructor wrote no log
        if (vfs.exists(stepLog(step))) logs.set(stepLog(step), vfs.readFile(stepLog(step)));
        count(`import ${engine}`);
      }
      for (const [path, bytes] of logs) expect(vfs.readFile(path), `${path}: a later step left the log of an earlier one as it was`).toEqual(bytes);
    });
  });
}

describe("HOST-266: a corrupted expected request fails the replay", () => {
  it("refuses an import whose recorded request was changed by one attribute, which the same recording passes unchanged", async () => {
    const fixture = importCases.find((candidate) => candidate.engine === "14.0.7" && candidate.name === "s0-mini-defaults") as FixtureCase;
    const [step] = importSteps.get(fixture) as Step[];
    await expect(replayImportStep(fixture, step as Step, { corrupt: corruptARequest })).rejects.toThrow();
    await expect(replayImportStep(fixture, step as Step)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------- language pack

interface LpRecorded {
  files: FixtureFile[];
  calls: TranscriptCall[];
}

/**
 * One recorded `lpimport` run: the language pack of the case is mounted at `/lp`, the temporary package is made under the browser
 * host's temp folder, `/tmp` (`pathGetTempPath`, LP-030), with a file name from the host's own random bytes, and the engine's
 * result is compared with the recording after the generated name is put back to the recorded one.
 */
async function replayLanguagePack(fixture: FixtureCase): Promise<void> {
  const folder = fixtureCasePath(fixture);
  const name = `${fixture.engine}/${fixture.name}`;
  const files = await loadFixtureTree(folder);
  const definition = JSON.parse(textOf(files, "case.json") ?? "{}") as { lpPackage: string; lpDebug: boolean; languages?: string[] };
  const run = JSON.parse(textOf(files, "run.json") ?? "{}") as {
    server: { url: string; database: string; user: string };
    host: { result: string | null; error: string | null };
  };
  const calls = await readCalls(fixture, textOf(files, "transcript.jsonl") ?? "");
  // a run that ended in the constructor wrote no log (IMP-612)
  const recordedLog = textOf(files, "engine.log") ?? "";
  const recordedMessages = messageLines(textOf(files, "messages.jsonl"));
  const osUser = /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";

  const vfs = virtualFs();
  const env = browserEnv();
  const tempRoot = pathGetTempPath({ fs: vfs, host: env }).replace(/\/$/, "");
  expect(tempRoot, `${name}: the browser host's temp folder`).toBe("/tmp");
  vfs.mkdir(tempRoot);
  const pack = filesBelow(files, "lp");
  mountFixtureFiles(pack, vfs, "/lp");
  const logPath = `${WORK}/engine.log`;

  const context = new SolutionUpgradeContext();
  context.action = "LPImport";
  context.url = run.server.url;
  context.dataBase = run.server.database;
  context.userName = run.server.user;
  context.workingDirectory = WORK;
  context.logFilePath = logPath;
  context.lpPath = "/lp/ImportConfig.xml";
  context.lpPackage = definition.lpPackage;
  context.lpDebug = definition.lpDebug;
  context.languages = definition.languages ?? null;
  const importContext = new SUImportContext();
  importContext.release = null;
  importContext.description = null;

  const connection = new SequentialConnection(calls);
  const helper = new CItemHelper(connection, { engine: fixture.engine });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  const sent: SentMessage[] = [];
  let console = "";
  const sink: ConsoleWriter = {
    write: (text) => void (console += text),
    writeLine: (text = "") => void (console += `${text}\r\n`),
  };
  const messages = createMessagesFactory({ onMessage: (message) => void sent.push(message) });
  // the temp folder and the random name are the host's: nothing but the file system is passed in
  const options = { fs: vfs, host: env, console: sink, osUser };

  /** The text of the run with the name the host drew put back to the recorded one. */
  const generated = (): string | undefined => /LanguagePack_([a-z0-5]{8}\.[a-z0-5]{3})/.exec(context.manifestFile ?? "")?.[1];
  const recorded = (text: string): string => {
    const drawn = generated();
    return drawn === undefined ? text : text.split(drawn).join(RANDOM);
  };

  const returned = /^ImportSolutions returned (\d+)$/.exec(run.host.result ?? "")?.[1];
  if (returned === undefined) {
    // the engine ended with an exception that the host rethrew (LP-003): the port throws the same one and the requests are the recorded ones
    expect(run.host.error, `${name}: the engine ended with an exception`).not.toBeNull();
    const failure = await languagePackImport(context, importContext, messages, helper, options).catch((error: unknown) => error);
    expect(exceptionText(failure).split(":")[0], `${name}: the exception`).toBe((run.host.error as string).split(":")[0]);
    expect(connection.consumed, `${name}: the requests of the run`).toBe(connection.total);
    // whatever the failed preprocessor left behind is named by the error, and is below the host's temp folder (LP-035)
    const left = leftBehindTempFolder(failure);
    if (left !== undefined) expect(left.startsWith(`${tempRoot}/`), `${name}: the left-behind folder ${left}`).toBe(true);
    expect(vfs.readdir(tempRoot).map((entry) => `${tempRoot}/${entry.name}`), `${name}: what the run left in the temp folder`).toEqual(left === undefined ? [] : [left]);
    assertTreeMatchesFiles(vfs, "/lp", pack, `${name}: the language pack`);
    return;
  }
  const code = await languagePackImport(context, importContext, messages, helper, options);
  const drawn = generated();
  expect(drawn, `${name}: the temp package has a name of the host's random bytes (LP-030)`).toBeDefined();

  expect(connection.consumed, `${name}: the requests of the run\n${textOfLog(vfs, logPath).slice(-1500)}\n${console}`).toBe(connection.total);
  expect(channelText(sent.map((message) => ({ ...message, text: recorded(message.text) }))), `${name}: the messages`).toEqual(channelText(recordedMessages));
  expect(code, `${name}: the result`).toBe(Number(returned));
  expect(context.action, `${name}: the context became an import`).toBe("Import");
  expect(context.manifestFile, `${name}: the manifest is the temp one`).toBe(`${tempRoot}/LanguagePack_${drawn}\\imports.mf`);
  expect(lpLog(recorded(textOfLog(vfs, logPath))), `${name}: the log`).toBe(lpLog(recordedLog));
  expect(recorded(console), `${name}: the console`).toBe(lpConsole(textOf(files, "host.log") ?? ""));

  const left = vfs.readdir(tempRoot).map((entry) => entry.name);
  if (definition.lpDebug) {
    expect(left, `${name}: lpdebug keeps the temp package`).toEqual([`LanguagePack_${drawn}`]);
    // the 14.35 recording did not copy the kept package; its pack is the 14.0.7 one, and the engine writes the same fixes for a Forum
    const kept = filesBelow(files, "temp-package");
    const keptFiles = kept.length > 0 ? kept : filesBelow(await loadFixtureTree(`fixtures/14.0.7/language-pack/${fixture.name}`), "temp-package");
    assertTreeMatchesFiles(vfs, `${tempRoot}/${left[0] as string}`, keptFiles, `${name}: the kept package`);
  } else {
    expect(left, `${name}: the temp package is removed`).toEqual([]);
  }
  assertTreeMatchesFiles(vfs, "/lp", pack, `${name}: the language pack`);
}

const lpCases = operationOf("language-pack");

for (const engine of ["14.0.7", "14.35"] as const) {
  describe(`HOST-266: the recorded ${engine} lpimport runs, in the browser (LP-001 to LP-036)`, () => {
    it.for(lpCases.filter((fixture) => fixture.engine === engine).map((fixture) => [fixture.name, fixture] as const))("%s", async ([, fixture]) => {
      await replayLanguagePack(fixture);
      count(`language pack ${engine}`);
    });
  });
}

describe("HOST-266: the temp folder and the random name of a language pack are the browser host's (LP-030)", () => {
  it("is /tmp/ with a trailing slash, and a name of eleven characters of a-z0-5 with a dot after the eighth", () => {
    const env = browserEnv();
    expect(pathGetTempPath({ host: env })).toBe("/tmp/");
    for (let i = 0; i < 20; i += 1) expect(pathGetRandomFileName({ host: env })).toMatch(/^[a-z0-5]{8}\.[a-z0-5]{3}$/);
  });
});

// ----------------------------------------------------------------------------------------------------------------- DB patch

interface DbPatchOutcome {
  recorded: { messages: SentMessage[]; log: string };
  ours: { messages: SentMessage[]; log: string; thrown: unknown; connection: RecordedConnection; generated: string[]; recordedIds: string[] };
}

/** The answers of a DB patch run, with the ids the browser host drew put back to the recorded ones in what the engine sends. */
class IdSwappingConnection extends RecordedConnection {
  constructor(
    calls: TranscriptCall[],
    private readonly swap: (text: string) => string,
  ) {
    super(calls);
  }

  override callAction(action: string, request: string): ReturnType<RecordedConnection["callAction"]> {
    return super.callAction(action, this.swap(request));
  }
}

/**
 * Runs one recorded DB patch step: `ApplyDBUpdateManifest` over the step's input files, with the recorded user. With `recordedIds` the
 * ids of the items it adds are the recorded ones (`DbPatchHost.newId`); without, they are the browser host's `randomUuid`, and what
 * the engine sends and writes is compared after each id is put back to the recorded one.
 */
async function replayDbPatch(caseName: string, step: string, recordedIds: boolean): Promise<DbPatchOutcome> {
  const fixture: FixtureCase = { engine: "14.35", operation: "dbpatch", name: caseName, covers: "" };
  const dir = `${fixtureCasePath(fixture)}/${step}`;
  const files = await loadFixtureTree(dir);
  const calls = await readCalls(fixture, textOf(files, "transcript.jsonl") ?? "");
  const recordedLog = textOf(files, "engine.log") ?? "";
  const recordedMessages = messageLines(textOf(files, "messages.jsonl"));

  const vfs = virtualFs();
  const input = filesBelow(files, "input");
  mountFixtureFiles(input, vfs, INPUT);
  const logPath = `${WORK}/engine.log`;

  const context = new SolutionUpgradeContext();
  context.action = field(recordedLog, "Action");
  context.url = field(recordedLog, "URL");
  context.dataBase = field(recordedLog, "Database");
  context.userName = field(recordedLog, "User");
  context.workingDirectory = WORK;
  context.logFilePath = logPath;
  const config = new DBUpdateConfig();
  config.dbUpdatedManifestFilePath = `${INPUT}/manifest.xml`;
  config.dbPatchesFolderPath = INPUT;
  config.toolName = field(recordedLog, "Tool name");

  // the ids the engine gave the items it added, in order, and the os_user it wrote
  const addedIds = calls.flatMap((call) => /^<Item [^>]*action="add" id="([0-9A-F]{32})"/.exec(call.request)?.[1] ?? []);
  const osUser = calls.flatMap((call) => /<os_user>([^<]*)<\/os_user>/.exec(call.request)?.[1] ?? [])[0];

  // the browser host, whose `randomUuid` writes down what it drew
  const generated: string[] = [];
  const env = { ...browserEnv(), randomUuid: () => {
    const uuid = browserEnv().randomUuid();
    expect(uuid, "a UUID of the browser host").toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    generated.push(uuid.replace(/-/g, "").toUpperCase());
    return uuid;
  } };
  const swap = (text: string): string => generated.reduce((out, id, index) => out.split(id).join(addedIds[index] ?? id), text);

  const connection = new IdSwappingConnection(calls, recordedIds ? (text) => text : swap);
  const helper = new CItemHelper(connection, { engine: "14.35" });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  const sent: SentMessage[] = [];
  const manager = new ImportExportManager(context, createMessagesFactory({ engine: "14.35", onMessage: (message) => void sent.push(message) }), helper, {
    fs: vfs,
    host: env,
    now: () => new Date(2026, 9, 19, 2, 38, 8),
    ...(osUser === undefined ? {} : { osUser }),
  });
  const ids = [...addedIds];
  let thrown: unknown;
  try {
    await manager.applyDBUpdateManifest(config, recordedIds ? { newId: () => ids.shift() as string } : {});
  } catch (error) {
    thrown = error;
  }
  assertTreeMatchesFiles(vfs, INPUT, input, `${caseName}/${step}: the input folder`);
  const text = (value: string): string => (recordedIds ? value : swap(value));
  return {
    recorded: { messages: recordedMessages, log: recordedLog },
    ours: {
      messages: sent.map((message) => ({ ...message, text: text(message.text) })),
      log: text(textOfLog(vfs, logPath)),
      thrown,
      connection,
      generated,
      recordedIds: addedIds,
    },
  };
}

const dbPatchSteps = new Map<string, string[]>();
for (const fixture of operationOf("dbpatch")) {
  const files = await loadFixtureTree(fixtureCasePath(fixture));
  dbPatchSteps.set(fixture.name, [...new Set(files.filter((file) => /^step-\d+\/transcript\.jsonl$/.test(file.path)).map((file) => file.path.split("/")[0] as string))].sort());
}

describe("HOST-266: the recorded DB patch runs, in the browser (DBP-001 to DBP-044)", () => {
  it("non-root: the admin login is refused with the engine's message, and the log is the engine's", async () => {
    const { recorded, ours } = await replayDbPatch("non-root", "step-1", true);
    expect(ours.thrown).toBeInstanceOf(Error);
    expect((ours.thrown as Error).message).toBe("Login name is not root. It is 'admin'. Check your config file.");
    expect(ours.connection.mismatches).toEqual([]);
    expect(ours.connection.consumed).toBe(0);
    expect(channelText(ours.messages.map((message) => ({ ...message, text: masked(message.text) })))).toEqual(
      channelText(recorded.messages.map((message) => ({ ...message, text: masked(message.text) }))),
    );
    expect(masked(ours.log)).toBe(masked(recorded.log));
    count("db patch 14.35");
  });

  it.for((dbPatchSteps.get("apply") ?? []).map((step) => [step] as const))("apply, %s: the requests, the messages and the log are the recorded ones, and nothing is thrown", async ([step]) => {
    const { recorded, ours } = await replayDbPatch("apply", step, true);
    expect(ours.connection.mismatches).toEqual([]);
    expect(ours.connection.consumed).toBe(ours.connection.total);
    expect(channelText(ours.messages.map((message) => ({ ...message, text: masked(message.text) })))).toEqual(
      channelText(recorded.messages.map((message) => ({ ...message, text: masked(message.text) }))),
    );
    expect(masked(ours.log)).toBe(masked(recorded.log));
    expect(ours.thrown).toBeUndefined();
    count("db patch 14.35");
  });

  it("apply, with the browser host's UUIDs: the ids are of the shape the engine's are, and every step is the recorded one otherwise", async () => {
    let drawn = 0;
    for (const step of dbPatchSteps.get("apply") ?? []) {
      const { recorded, ours } = await replayDbPatch("apply", step, false);
      // the engine asked for as many ids as it added items (a step that edits the row adds none), and each is 32 upper-case hexadecimal characters that the browser drew
      expect(ours.generated.length, `${step}: the ids the engine drew`).toBe(ours.recordedIds.length);
      for (const id of ours.generated) expect(id).toMatch(/^[0-9A-F]{32}$/);
      expect(new Set(ours.generated).size, `${step}: the ids are distinct`).toBe(ours.generated.length);
      expect(ours.generated, `${step}: the ids are the browser's and not the recorded ones`).not.toEqual(ours.recordedIds.length === 0 ? [""] : ours.recordedIds);
      drawn += ours.generated.length;
      // with each id put back, what the engine sent, said and logged is the recording
      expect(ours.connection.mismatches, `${step}: the requests`).toEqual([]);
      expect(ours.connection.consumed, `${step}: the requests of the run`).toBe(ours.connection.total);
      expect(channelText(ours.messages.map((message) => ({ ...message, text: masked(message.text) }))), `${step}: the messages`).toEqual(
        channelText(recorded.messages.map((message) => ({ ...message, text: masked(message.text) }))),
      );
      expect(masked(ours.log), `${step}: the log`).toBe(masked(recorded.log));
      expect(ours.thrown, `${step}: nothing is thrown`).toBeUndefined();
    }
    expect(drawn, "the run drew ids").toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------------------------------------------------------- counts

/** The steps a family of the curated cases has: every step of an import case, every case of a language pack, every step of a DB patch case. */
describe("HOST-266: the curated cases", () => {
  it("are all run, in this browser, with none left out", () => {
    for (const engine of ["12.0", "14.0.7", "14.35"] as const) {
      const wanted = importCases.filter((fixture) => fixture.engine === engine).reduce((sum, fixture) => sum + (importSteps.get(fixture)?.length ?? 0), 0);
      expect(tally.get(`import ${engine}`) ?? 0, `import ${engine}`).toBe(wanted);
    }
    for (const engine of ["14.0.7", "14.35"] as const) {
      expect(tally.get(`language pack ${engine}`) ?? 0, `language pack ${engine}`).toBe(lpCases.filter((fixture) => fixture.engine === engine).length);
    }
    const dbPatchRuns = [...dbPatchSteps.entries()].reduce((sum, [name, steps]) => sum + (name === "non-root" ? 1 : steps.length), 0);
    expect(tally.get("db patch 14.35") ?? 0, "db patch 14.35").toBe(dbPatchRuns);
    console.info(`${server.browser}: curated cases run: ${JSON.stringify(Object.fromEntries([...tally].sort(([a], [b]) => a.localeCompare(b))))}`);
  });
});

// -------------------------------------------------------------------------------------------------------------- size smoke

/** The page's heap in bytes and where the number came from, or null where the browser offers none. */
async function heapNow(): Promise<{ source: string; bytes: number; backingStorageBytes?: number } | null> {
  const measured = performance as unknown as {
    measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
    memory?: { usedJSHeapSize: number };
  };
  if (typeof measured.measureUserAgentSpecificMemory === "function" && globalThis.crossOriginIsolated === true) {
    try {
      return { source: "measureUserAgentSpecificMemory", bytes: (await measured.measureUserAgentSpecificMemory()).bytes };
    } catch {
      // not allowed in this context: fall through to the next source
    }
  }
  if (server.browser === "chromium") {
    // the DevTools protocol collects first and gives the exact JavaScript heap and array-buffer backing store, where `performance.memory` is rounded and updated in steps
    try {
      await cdp().send("HeapProfiler.collectGarbage");
      const usage = (await cdp().send("Runtime.getHeapUsage")) as { usedSize: number; backingStorageSize: number };
      return { source: "cdp Runtime.getHeapUsage, usedSize + backingStorageSize", bytes: usage.usedSize + usage.backingStorageSize, backingStorageBytes: usage.backingStorageSize };
    } catch {
      // no protocol session: fall through to the next source
    }
  }
  if (typeof measured.memory?.usedJSHeapSize === "number") return { source: "performance.memory, without array buffers", bytes: measured.memory.usedJSHeapSize };
  return null;
}

describe("HOST-266: the largest recorded import, once, in Chromium (the size smoke that ticket 31 reads)", () => {
  it.skipIf(server.browser !== "chromium")(
    "holds the whole 14.0.7 import folder (inputs, transcripts and blobs, 38 MB on the disk, 41 MB by du) in the tree and runs every step of its largest case on that tree",
    async () => {
      const heapBefore = await heapNow();
      const readStart = performance.now();
      let everything = await loadFixtureTree("fixtures/14.0.7/import");
      const readMs = performance.now() - readStart;

      const vfs = virtualFs();
      const mountStart = performance.now();
      mountFixtureFiles(everything, vfs, "/packages");
      const mountMs = performance.now() - mountStart;
      const bytes = everything.reduce((sum, file) => sum + file.bytes.length, 0);
      expect(bytes, "the folder is the one of about 41 MB").toBeGreaterThan(35_000_000);
      const files = everything.length;
      expect(vfs.toTree("/packages").filter((path) => !path.endsWith("/")).length, "every file is in the tree").toBe(files);
      everything = [];

      // the largest case of the folder, by its input, its transcript and the blobs it names: run on top of the held tree
      const fixture: FixtureCase = { engine: "14.0.7", operation: "import", name: "s1-instances-versionable", covers: "the largest recorded import" };
      const steps = await stepsOfCase(fixture);
      expect(steps.length, "the case records four steps").toBe(4);
      const heapMounted = await heapNow();
      const runStart = performance.now();
      for (const step of steps) await replayImportStep(fixture, step, { vfs });
      const runMs = performance.now() - runStart;
      const heapAfter = await heapNow();
      assertTreeMatchesFiles(vfs, "/packages", await loadFixtureTree("fixtures/14.0.7/import"), "the held folder after the run");

      console.info(
        `IMPORT-SIZE-SMOKE ${JSON.stringify({
          browser: server.browser,
          files,
          bytes,
          readMs: Math.round(readMs),
          mountMs: Math.round(mountMs),
          runMs: Math.round(runMs),
          heap: {
            source: heapAfter?.source ?? null,
            beforeBytes: heapBefore?.bytes ?? null,
            mountedBytes: heapMounted?.bytes ?? null,
            afterBytes: heapAfter?.bytes ?? null,
            backingStorageBytes: { before: heapBefore?.backingStorageBytes ?? null, mounted: heapMounted?.backingStorageBytes ?? null, after: heapAfter?.backingStorageBytes ?? null },
          },
        })}`,
      );
    },
  );
});
