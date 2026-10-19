import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type TranscriptCall, readTranscript } from "../../oracle/src/transcript.js";
import { CItemException, ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { CItemHelper } from "../client/item-helper.js";
import { documentOuterXml, parseXml } from "../client/mini-xml.js";
import { ArasVersion } from "../client/version.js";
import { SUExportContext, type ReferencesToUnknownPackages } from "./export-context.js";
import { ExportItem } from "./export-item.js";
import { ImportExportManager, type SelectionInsertions } from "./import-export-manager.js";
import { type SentMessage, createMessagesFactory } from "./messages.js";

/**
 * The recorded 14.35 export cases replayed through the whole of `ExportSolutions` (EXP-500 to EXP-520, EXP-550 to EXP-558): the port
 * reads the recorded answers of a case's transcript, matched by their request text, and what it leaves behind is compared with what the
 * engine left, the way EXP-558 says two runs of 14.35 are compared. The engine ran the items of a package in parallel, so its log, its
 * messages and the files of items in flight are not in a fixed order or set; the port runs them one after the other.
 *
 * - **Fixed parts** are equal: the log header, every package header, the `currentPackage` messages, `imports.mf`, the error block, the
 *   warning, and the `completed` and cancel texts.
 * - **A set** is compared as a set: the success lines, the `Item i of n` texts, and the files.
 * - **A run that failed or was cancelled** is a prefix of the engine's: the port started fewer items, so its files, success lines
 *   and requests are among the engine's and not the other way round (EXP-555, EXP-557, EXP-570).
 *
 * The cases of the language-resource export wait for ticket 61 and the removal of references to unknown packages for the
 * `EXP-600` rules.
 */
const CASES = new URL("../../fixtures/14.35/export/", import.meta.url).pathname;
const BLOBS = join(CASES, "_blobs");
const LOGIN_CALLS = 6;

interface Case {
  id: string;
  packages: Array<{ name: string; items: Array<{ type: string; id: string; keyedName: string }> }>;
  options: { level?: string; exportReferencedItems?: boolean; refToUnknownPacks?: string; languages?: string[]; engineAction?: string; cancelAfterStatus?: number };
  expectsError: boolean;
  result: { error: string | null };
}

const caseNames = readdirSync(CASES).filter((name) => existsSync(join(CASES, name, "transcript.jsonl")));

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Answers each request with a recorded call that has the same text and was not used yet. */
class RecordedConnection implements ServerConnection {
  private readonly used: boolean[];

  constructor(private readonly calls: TranscriptCall[]) {
    this.used = calls.map((_, index) => index < LOGIN_CALLS);
  }

  get leftover(): string[] {
    return this.calls.filter((_, index) => !this.used[index]).map((call) => call.request.slice(0, 200));
  }

  async callAction(action: string, request: string): Promise<ResponseDocument> {
    const wire = documentOuterXml(parseXml(request));
    const index = this.calls.findIndex((call, i) => !this.used[i] && call.action === action && call.request === wire);
    if (index < 0) throw new Error(`the port sent a request the engine did not record: ${action} ${wire.slice(0, 400)}`);
    this.used[index] = true;
    return ResponseDocument.parse(this.calls[index]?.response ?? "");
  }
}

/** Every file below a folder, as a path with `/`. */
function files(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? files(root, `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]))
    .sort();
}

const read = (name: string, file: string): string => readFileSync(join(CASES, name, file), "utf8");
const headerValue = (log: string, label: string): string => new RegExp(`^${label}: (.*)\\r$`, "m").exec(log)?.[1] ?? "";

const CLOCK = /\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d/g;

/** The log with what is the run's own replaced: the two paths of the header and every date-time. */
const comparable = (log: string, logPath: string, workingDirectory: string): string =>
  log
    .replace(/^(Log file: ).*(\r)$/m, `$1<log>$2`)
    .replace(/^(Working directory: ).*(\r)$/m, `$1<working>$2`)
    .replace(CLOCK, "<time>")
    .split(logPath)
    .join("<log>")
    .split(workingDirectory)
    .join("<working>");

const SUCCESS = /^Item id :.*successfully exported$/;
const PACKAGE_HEADER = /^ {9}\*\*\*\*Export .*\*\*\*\*$/;

interface LogParts {
  header: string;
  /** One entry per package: its header line, its success lines (sorted), and the other lines with a repeated cancel pair collapsed. */
  packages: Array<{ header: string; successes: string[]; rest: string[] }>;
}

/** The log as EXP-558 compares it: the header, and per package the success lines as a set and the other lines in order. */
function logParts(log: string): LogParts {
  const end = log.indexOf("\r\n\r\n") + 4;
  const lines = log.slice(end).split("\r\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const packages: LogParts["packages"] = [];
  for (const line of lines) {
    if (PACKAGE_HEADER.test(line)) packages.push({ header: line, successes: [], rest: [] });
    else if (SUCCESS.test(line)) packages[packages.length - 1]?.successes.push(line);
    else packages[packages.length - 1]?.rest.push(line);
  }
  for (const pkg of packages) {
    pkg.successes.sort();
    // the cancel text and `end of execution` may come more than once (EXP-557)
    const collapsed: string[] = [];
    for (let i = 0; i < pkg.rest.length; i += 1) {
      const pair = pkg.rest.slice(i, i + 2);
      const last = collapsed.slice(-2);
      if (pair[0] === "Export was canceled by user" && pair.length === 2 && last.length === 2 && last[0] === pair[0] && last[1] === pair[1]) {
        i += 1;
        continue;
      }
      collapsed.push(pkg.rest[i] as string);
    }
    pkg.rest = collapsed;
  }
  return { header: log.slice(0, end), packages };
}

const ITEM_STATUS = /^Item \d+ of \d+: (.*)$/;

/** The messages of a run by channel, the status texts of items as a set without their numbers. */
function messageParts(messages: Array<{ channel: string; text: string }>) {
  const bychannel = (channel: string) => messages.filter((message) => message.channel === channel).map((message) => message.text);
  const statuses = bychannel("status");
  return {
    currentPackage: bychannel("currentPackage"),
    warning: bychannel("warning"),
    error: bychannel("error"),
    errorQuestion: bychannel("errorQuestion"),
    items: new Set(statuses.flatMap((text) => ITEM_STATUS.exec(text)?.[1] ?? [])),
    otherStatus: statuses.filter((text) => !ITEM_STATUS.test(text)),
  };
}

/**
 * The ids and keyed names of the items of a case that the server refused (their request has a fault for an answer). Two failures
 * in one package are reported for whichever item the engine's workers reached first (EXP-572), so a text that names a failing item is
 * compared with the item replaced.
 */
function failingItems(input: Case, calls: TranscriptCall[]): Array<{ id: string; keyedName: string }> {
  const items = input.packages.flatMap((entry) => entry.items);
  return items.filter((item) =>
    calls.some((call) => call.request.includes(`<id>${item.id}</id>`) && (call.response ?? "").includes("<SOAP-ENV:Fault")),
  );
}

const maskItems = (text: string, failing: Array<{ id: string; keyedName: string }>): string =>
  failing.reduce((masked, item) => masked.split(item.id).join("<failing id>").split(item.keyedName).join("<failing name>"), text);

/** The modes that remove references to unknown packages wait for the rules `EXP-600` to `EXP-699`. */
const needsRemoval = (input: Case): boolean => input.options.refToUnknownPacks === "RemoveSilently" || input.options.refToUnknownPacks === "RemoveWithWarning";
/** The language-resource exports and the language selection wait for ticket 61. */
const needsLanguages = (input: Case): boolean => input.options.engineAction !== undefined || input.options.languages !== undefined;

describe("the recorded 14.35 export cases, run through ExportSolutions (EXP-500 to EXP-520, EXP-550 to EXP-558)", () => {
  let compared = 0;
  let failures = 0;
  let cancels = 0;

  it.each(caseNames)(
    "%s",
    async (name) => {
      const input = JSON.parse(read(name, "case.json")) as Case;
      if (needsRemoval(input) || needsLanguages(input)) return;

      const calls = readTranscript(join(CASES, name, "transcript.jsonl"), BLOBS);
      const recordedLog = read(name, "engine.log");
      const recordedMessages = read(name, "messages.jsonl")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as SentMessage);
      const failed = recordedMessages.some((message) => message.channel === "errorQuestion");
      const cancelAfter = input.options.cancelAfterStatus;

      const working = mkdtempSync(join(tmpdir(), "libsjs-run1435-"));
      roots.push(working);
      const output = join(working, "output");
      const logPath = join(working, "engine.log");
      const context = new SUExportContext();
      context.url = headerValue(recordedLog, "URL");
      context.dataBase = headerValue(recordedLog, "Database");
      context.userName = headerValue(recordedLog, "User");
      context.workingDirectory = output;
      context.logFilePath = logPath;
      context.level = headerValue(recordedLog, "Export level");
      context.exportReferencedItems = headerValue(recordedLog, "Export referenced items") === "True";
      context.useImport = headerValue(recordedLog, "Export using import structure") === "True";
      context.refToUnknownPacks = headerValue(recordedLog, "Export unknown packages action") as ReferencesToUnknownPackages;

      const connection = new RecordedConnection(calls);
      const helper = new CItemHelper(connection, { engine: "14.35" });
      helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
      const sent: SentMessage[] = [];
      let statuses = 0;
      const manager: ImportExportManager = new ImportExportManager(
        context,
        createMessagesFactory({
          engine: "14.35",
          onMessage: (message) => {
            sent.push(message);
            if (message.channel === "status") statuses += 1;
            if (cancelAfter !== undefined && message.channel === "status" && statuses === cancelAfter) manager.cancel();
          },
        }),
        helper,
        { cwd: working },
      );

      const selection: SelectionInsertions = input.packages.map((entry) => [
        entry.name,
        entry.items.map((item) => [item.id, new ExportItem(item.keyedName, item.id, item.type)] as const),
      ]);
      mkdirSync(output);
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
      const made = files(output);
      const recordedFiles = files(join(CASES, name, "output"));
      const stopped = failed || cancelAfter !== undefined;
      if (stopped) expect(recordedFiles, `${name}: the files of items the engine ran`).toEqual(expect.arrayContaining(made));
      else expect(made, `${name}: the files`).toEqual(recordedFiles);
      for (const path of made) {
        expect(readFileSync(join(output, path)).equals(readFileSync(join(CASES, name, "output", path))), `${name}: ${path} byte for byte`).toBe(true);
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
      // a text of the engine may be missing or repeated (EXP-553): the port started items of the case or of the second pass, and when
      // nothing stopped it, all of them and every one the engine named
      expect([...caseItems, ...theirs.items], `${name}: the items the port started`).toEqual(expect.arrayContaining([...ours.items]));
      if (!stopped && !input.expectsError && theirs.warning.length === 0) {
        expect([...ours.items], `${name}: the items`).toEqual(expect.arrayContaining([...caseItems, ...theirs.items]));
      }

      // the log
      const log = readFileSync(logPath, "utf8");
      const ourLog = logParts(comparable(log, logPath, output));
      const theirLog = logParts(comparable(recordedLog, logPath, output));
      expect(ourLog.header, `${name}: the log header`).toBe(theirLog.header);
      expect(ourLog.packages.map((pkg) => pkg.header), `${name}: the packages`).toEqual(theirLog.packages.map((pkg) => pkg.header));
      for (const [index, pkg] of ourLog.packages.entries()) {
        const recorded = theirLog.packages[index];
        if (theirs.warning.length > 0) {
          // the warning of the engine names every worker that failed, the port's the first (EXP-556)
          expect(recorded?.rest.join("\r\n"), `${name}: ${pkg.header}`).toContain(pkg.rest.join("\r\n"));
        } else {
          expect(pkg.rest.map(mask), `${name}: ${pkg.header}`).toEqual(recorded?.rest.map(mask));
        }
        if (stopped || theirs.warning.length > 0) {
          // an item that finished after a failure or a cancel has no success line (EXP-570), and the port's are in the engine's files
          expect(pkg.successes.length, `${name}: the success lines`).toBeLessThanOrEqual(input.packages.flatMap((entry) => entry.items).length);
        } else {
          expect(pkg.successes, `${name}: the success lines of ${pkg.header}`).toEqual(recorded?.successes);
        }
      }
      compared += 1;
      if (failed) failures += 1;
      if (cancelAfter !== undefined) cancels += 1;
    },
    60_000,
  );

  it("ran the cases that need no removal of references and no language", () => {
    expect(compared).toBeGreaterThan(80);
    expect(failures).toBe(7);
    expect(cancels).toBe(3);
  });
});
