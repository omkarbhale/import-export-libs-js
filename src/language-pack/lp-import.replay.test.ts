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
import type { Engine } from "../engines.js";
import { exceptionText } from "./exception-text.js";
import { languagePackImport } from "./lp-import.js";
import { RANDOM, comparable, recordedConsole } from "./replay-support.js";

/**
 * The recorded `lpimport` runs against dev: the five of the 14.0.7 engine (`fixtures/14.0.7/language-pack/lp01` to `lp05`, ticket 45)
 * and the eight of 14.35 (`fixtures/14.35/language-pack/lp01` to `lp08`, ticket 75), replayed through `languagePackImport` (LP-001): the preprocessor reads the recorded language pack, the recorded answers come back
 * one request after the other in the recorded order, and the port must send exactly the recorded requests (the `Language` get, the
 * import's lookups and the generated `edit` items, with the exact `where` and i18n elements), send the recorded messages, write the
 * recorded log and console text and return what the engine returned. The log differs from the recording only where the run's own
 * paths and clock come in, which are replaced on both sides.
 */
const CASES_14_0_7 = new URL("../../fixtures/14.0.7/language-pack/", import.meta.url).pathname;
const CASES_14_35 = new URL("../../fixtures/14.35/language-pack/", import.meta.url).pathname;
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

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

function replay(engine: Engine, root: string, expected: readonly string[]): void {
  const cases = readdirSync(root).filter((name) => existsSync(join(root, name, "case.json")));

  describe(`the recorded ${engine} lpimport runs, through languagePackImport (LP-001 to LP-036)`, () => {
    it("has the cases of the ticket", () => {
      expect(cases).toEqual(expected);
    });

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

      const work = mkdtempSync(join(tmpdir(), "libsjs-lp-"));
      roots.push(work);
      const tempRoot = join(work, "tmp");
      mkdirSync(tempRoot);
      const logPath = join(work, "engine.log");

      const context = new SolutionUpgradeContext();
      context.action = "LPImport";
      context.url = run.server.url;
      context.dataBase = run.server.database;
      context.userName = run.server.user;
      context.workingDirectory = work;
      context.logFilePath = logPath;
      context.lpPath = join(dir, "lp", "ImportConfig.xml");
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

      const returned = /^ImportSolutions returned (\d+)$/.exec(run.host.result ?? "")?.[1];
      if (returned === undefined) {
        // the engine ended with an exception that the host rethrew (LP-003): the port throws the same one and the requests are the recorded ones
        expect(run.host.error, `${name}: the engine ended with an exception`).not.toBeNull();
        const failure = await languagePackImport(context, importContext, messages, helper, {
          cwd: work,
          console: sink,
          osUser,
          tempPath: `${tempRoot}/`,
          randomFileName: () => RANDOM,
        }).catch((error: unknown) => error);
        expect(exceptionText(failure).split(":")[0], `${name}: the exception`).toBe((run.host.error as string).split(":")[0]);
        expect(connection.consumed, `${name}: the requests of the run`).toBe(connection.total);
        expect(readdirSync(tempRoot), `${name}: the temp package is removed`).toEqual([]);
        return;
      }
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
        // the 14.35 recording did not copy the kept package; its pack is the 14.0.7 one, and the engine writes the same fixes for a Forum
        const kept = existsSync(join(dir, "temp-package")) ? join(dir, "temp-package") : join(CASES_14_0_7, name, "temp-package");
        expect(tree(join(tempRoot, left[0] as string)), `${name}: the kept package`).toEqual(tree(kept));
      } else {
        expect(left, `${name}: the temp package is removed`).toEqual([]);
      }
    });
  });
}

replay("14.0.7", CASES_14_0_7, ["lp01", "lp02", "lp03", "lp04", "lp05"]);
replay("14.35", CASES_14_35, ["lp01", "lp02", "lp03", "lp04", "lp05", "lp06", "lp07", "lp08"]);
