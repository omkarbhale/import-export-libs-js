import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readTranscript, type TranscriptCall } from "../../oracle/src/transcript.js";
import { CItemException, ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { CItemHelper } from "../client/item-helper.js";
import { documentOuterXml, parseXml } from "../client/mini-xml.js";
import { packageCaches } from "../client/package-lookups.js";
import { ArasVersion } from "../client/version.js";
import { SUExportContext, type ReferencesToUnknownPackages } from "./export-context.js";
import { ExportItem } from "./export-item.js";
import { ImportExportManager, type SelectionInsertions } from "./import-export-manager.js";
import { type SentMessage, createMessagesFactory } from "./messages.js";
import { CASES, caseNames } from "./replay-cases.js";
import type { Case } from "./replay-cases.js";

/**
 * The recorded 14.0.7 export cases replayed through the whole of `ExportSolutions` (EXP-500 to EXP-520): the port reads the recorded
 * answers of a case's transcript, one request after the other and in the recorded order, and what it leaves behind is compared
 * with what the engine left: the output folder with `imports.mf`, the log, and the messages with the host's answer to the error
 * question. The folder and the messages are compared byte for byte; the log differs from the recording only where the run's own
 * paths and clock come in, which are replaced on both sides.
 */
const LOGIN_CALLS = 6;
const BLOBS = join(CASES, "_blobs");

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Answers each request with the next recorded call, which must be the same request. */
class SequentialConnection implements ServerConnection {
  private next = LOGIN_CALLS;

  constructor(private readonly calls: TranscriptCall[]) {}

  get consumed(): number {
    return this.next - LOGIN_CALLS;
  }

  get total(): number {
    return this.calls.length - LOGIN_CALLS;
  }

  async callAction(action: string, request: string): Promise<ResponseDocument> {
    const wire = documentOuterXml(parseXml(request));
    const call = this.calls[this.next];
    if (call?.action !== action || call.request !== wire) {
      throw new Error(`request ${this.next - LOGIN_CALLS + 1} differs from the recorded one:\nsent:     ${action} ${wire.slice(0, 400)}\nrecorded: ${call?.action} ${call?.request.slice(0, 400)}`);
    }
    this.next += 1;
    return ResponseDocument.parse(call.response ?? "");
  }
}

/** Every file below a folder, as a path with `/` in sorted order, and every folder that holds a file with a trailing `/`. */
function tree(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${prefix}${entry.name}`;
      if (!entry.isDirectory()) return [path];
      const below = tree(root, `${path}/`);
      return below.length > 0 ? [`${path}/`, ...below] : [];
    })
    .sort();
}

const read = (name: string, file: string): string => readFileSync(join(CASES, name, file), "utf8");

/** The header line `Label: value` of the recorded log, which holds the host's settings. */
const headerValue = (log: string, label: string): string => new RegExp(`^${label}: (.*)\\r$`, "m").exec(log)?.[1] ?? "";

const CLOCK = /\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d/g;

/** The log with what is the run's own replaced: the two paths of the header and every date-time. */
const comparable = (log: string, logPath: string, workingDirectory: string): string =>
  log
    .replace(/^(Log file: ).*(\r)$/m, `$1<log>$2`)
    .replace(/^(Working directory: ).*(\r)$/m, `$1<working>$2`)
    .replace(CLOCK, "<time>")
    .split(logPath).join("<log>")
    .split(workingDirectory).join("<working>");

describe("the recorded 14.0.7 export cases, run through ExportSolutions (EXP-500 to EXP-520, EXP-600 to EXP-620)", () => {
  let packagesCompared = 0;
  let runs = 0;

  // each case was recorded by a process of its own, and the dependency cache outlives a helper (EXP-619)
  beforeEach(() => packageCaches.dependsOn.clear());

  it.each(caseNames)("%s", async (name) => {
    const input = JSON.parse(read(name, "case.json")) as Case;

    const calls = readTranscript(join(CASES, name, "transcript.jsonl"), BLOBS);
    const recordedLog = read(name, "engine.log");
    const recordedMessages = read(name, "messages.jsonl")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as SentMessage & { answer: boolean | null });
    const abort = recordedMessages.some((message) => message.channel === "errorQuestion" && message.answer === true);

    const working = mkdtempSync(join(tmpdir(), "libsjs-run-"));
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

    const connection = new SequentialConnection(calls);
    const helper = new CItemHelper(connection);
    helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
    const sent: SentMessage[] = [];
    const manager = new ImportExportManager(
      context,
      createMessagesFactory({ onMessage: (message) => void sent.push(message), onItemError: abort ? "abort-package" : "continue" }),
      helper,
      { cwd: working },
    );

    // the host fills the table with a package on its first item, then each item under its id (the case's README)
    const selection: SelectionInsertions = input.packages.map((entry) => [
      entry.name,
      entry.items.map((item) => [item.id, new ExportItem(item.keyedName, item.id, item.type)] as const),
    ]);
    mkdirSync(output);
    const outcome = manager.exportSolutions(context, selection);
    if (input.expectsError) await expect(outcome).rejects.toBeInstanceOf(CItemException);
    else await outcome;

    expect(connection.consumed, `${name}: the requests of the run`).toBe(connection.total);
    expect(sent.map(({ channel, text }) => ({ channel, text })), `${name}: the messages`).toEqual(
      recordedMessages.map(({ channel, text }) => ({ channel, text })),
    );
    const made = tree(output);
    expect(made, `${name}: the folders and files`).toEqual(tree(join(CASES, name, "output")));
    for (const path of made.filter((entry) => !entry.endsWith("/"))) {
      expect(readFileSync(join(output, path)).equals(readFileSync(join(CASES, name, "output", path))), `${name}: ${path} byte for byte`).toBe(true);
    }
    const log = readFileSync(logPath);
    expect(log.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), `${name}: the log has no BOM`).toBe(false);
    expect(comparable(log.toString("utf8"), logPath, output), `${name}: the log`).toBe(comparable(recordedLog, logPath, output));
    packagesCompared += input.packages.length;
    runs += 1;
  });

  it("ran the cases, with every package", () => {
    expect(runs).toBeGreaterThan(70);
    expect(packagesCompared).toBeGreaterThan(75);
  });
});
