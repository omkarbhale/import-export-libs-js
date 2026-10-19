import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { CItemHelper } from "../client/item-helper.js";
import { ArasVersion } from "../client/version.js";
import { SolutionUpgradeContext } from "../export/export-context.js";
import { type SentMessage, createMessagesFactory } from "../export/messages.js";
import { SUImportContext } from "../import/import-context.js";
import type { ConsoleWriter } from "../import/import-run.js";
import { SequentialConnection } from "../import/transcript-replay.js";
import { languagePackImport } from "./lp-import.js";

/**
 * The five recorded `lpimport` runs of the 14.0.7 engine against dev (`fixtures/14.0.7/language-pack/lp01` to `lp05`, ticket 45),
 * replayed through `languagePackImport` (LP-001): the preprocessor reads the recorded language pack, the recorded answers come back
 * one request after the other in the recorded order, and the port must send exactly the recorded requests (the `Language` get, the
 * import's lookups and the generated `edit` items, with the exact `where` and i18n elements), send the recorded messages, write the
 * recorded log and console text and return what the engine returned. The log differs from the recording only where the run's own
 * paths and clock come in, which are replaced on both sides.
 */
const CASES = new URL("../../fixtures/14.0.7/language-pack/", import.meta.url).pathname;
const RANDOM = "abcdefgh.xyz";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const headerValue = (log: string, label: string): string => new RegExp(`^${label}: (.*)\\r$`, "m").exec(log)?.[1] ?? "";

const CLOCK = /\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d/g;

/** The log with what is the run's own replaced: the header's paths, the fixes file, and every date-time. */
function comparable(log: string): string {
  return log
    .replace(/^(Manifest file: ).*(\r)$/m, "$1<manifest>$2")
    .replace(/^(Log file: ).*(\r)$/m, "$1<log>$2")
    .replace(/^(Working directory: ).*(\r)$/m, "$1<working>$2")
    .replace(/^(Language pack: ).*(\r)$/m, "$1<pack>$2")
    .replace(/^File full name '.*[\\/]([^\\/']+)'(\r?)$/gm, "File full name '<fixes>/$1'$2")
    .replace(CLOCK, "<time>");
}

/** What the oracle host wrote to the console: the lines of `host.log` between the engine banner and `HOST_EXIT`. */
function recordedConsole(hostLog: string): string {
  const afterBanner = hostLog.slice(hostLog.indexOf("\r\n") + 2);
  return afterBanner.slice(0, afterBanner.lastIndexOf("HOST_EXIT"));
}

/** Every file below a folder, by relative path with `/`, with its bytes. */
function tree(folder: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.set(relative(folder, full).split(sep).join("/"), readFileSync(full).toString("latin1"));
    }
  };
  walk(folder);
  return files;
}

const cases = readdirSync(CASES).filter((name) => existsSync(join(CASES, name, "case.json")));

describe("the recorded 14.0.7 lpimport runs, through languagePackImport (LP-001 to LP-036)", () => {
  it("has the five cases of ticket 45", () => {
    expect(cases).toEqual(["lp01", "lp02", "lp03", "lp04", "lp05"]);
  });

  it.for(cases.map((name) => [name] as const))("%s", async ([name]) => {
    const dir = join(CASES, name);
    const definition = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as { lpPackage: string; lpDebug: boolean };
    const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as { host: { result: string | null; error: string | null } };
    const calls = readTranscript(join(dir, "transcript.jsonl"), join(CASES, "_blobs"));
    const recordedLog = readFileSync(join(dir, "engine.log"), "utf8");
    const recordedMessages = readFileSync(join(dir, "messages.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as SentMessage);
    const osUser = /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";

    const work = mkdtempSync(join(tmpdir(), "libsjs-lp-"));
    roots.push(work);
    const tempRoot = join(work, "tmp");
    mkdirSync(tempRoot);
    const logPath = join(work, "engine.log");

    const context = new SolutionUpgradeContext();
    context.action = "LPImport";
    context.url = headerValue(recordedLog, "URL");
    context.dataBase = headerValue(recordedLog, "Database");
    context.userName = headerValue(recordedLog, "User");
    context.workingDirectory = work;
    context.logFilePath = logPath;
    context.lpPath = join(dir, "lp", "ImportConfig.xml");
    context.lpPackage = definition.lpPackage;
    context.lpDebug = definition.lpDebug;
    const importContext = new SUImportContext();
    importContext.release = null;
    importContext.description = null;

    const connection = new SequentialConnection(calls);
    const helper = new CItemHelper(connection);
    helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
    const sent: SentMessage[] = [];
    let console = "";
    const sink: ConsoleWriter = {
      write: (text) => void (console += text),
      writeLine: (text = "") => void (console += `${text}\r\n`),
    };
    const messages = createMessagesFactory({ onMessage: (message) => void sent.push(message) });

    const returned = /^ImportSolutions returned (\d+)$/.exec(run.host.result ?? "")?.[1];
    expect(returned, `${name}: the engine returned a code`).toBeDefined();
    const code = await languagePackImport(context, importContext, messages, helper, {
      cwd: work,
      console: sink,
      osUser,
      tempPath: `${tempRoot}/`,
      randomFileName: () => RANDOM,
    });

    expect(connection.consumed, `${name}: the requests of the run\n${readFileSync(logPath, "utf8").slice(-1500)}\n${console}`).toBe(connection.total);
    expect(sent.map(({ channel, text }) => ({ channel, text })), `${name}: the messages`).toEqual(
      recordedMessages.map(({ channel, text }) => ({ channel, text })),
    );
    expect(code, `${name}: the result`).toBe(Number(returned));
    expect(context.action, `${name}: the context became an import`).toBe("Import");
    expect(context.manifestFile, `${name}: the manifest is the temp one`).toBe(`${tempRoot}/LanguagePack_${RANDOM}\\imports.mf`);
    expect(comparable(readFileSync(logPath, "utf8")), `${name}: the log`).toBe(comparable(recordedLog));
    expect(console, `${name}: the console`).toBe(recordedConsole(readFileSync(join(dir, "host.log"), "utf8")));

    const left = readdirSync(tempRoot);
    if (definition.lpDebug) {
      expect(left, `${name}: lpdebug keeps the temp package`).toEqual([`LanguagePack_${RANDOM}`]);
      expect(tree(join(tempRoot, left[0] as string)), `${name}: the kept package`).toEqual(tree(join(dir, "temp-package")));
    } else {
      expect(left, `${name}: the temp package is removed`).toEqual([]);
    }
  });
});
