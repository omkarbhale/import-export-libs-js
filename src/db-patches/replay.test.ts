import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { CItemHelper } from "../client/item-helper.js";
import { ArasVersion } from "../client/version.js";
import { SolutionUpgradeContext } from "../export/export-context.js";
import { ImportExportManager } from "../export/import-export-manager.js";
import { type SentMessage, createMessagesFactory } from "../export/messages.js";
import { DBUpdateConfig } from "./config.js";
import { CASES, RecordedConnection, field, masked, steps } from "./replay-support.js";

/**
 * The recorded DB patch runs (`fixtures/14.35/dbpatch/`, ticket 72) replayed through `ApplyDBUpdateManifest` (DBP-001 to DBP-044):
 * the port reads the recorded answers in order, every request it sends must be the recorded one, and the messages and the log it
 * leaves are the recorded ones. What the recording machine and the clock decide is masked: the paths, the date-times, and the ids
 * the engine gave the items it added (the port is handed the recorded ones).
 */
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface Replayed {
  messages: SentMessage[];
  log: string;
  thrown: unknown;
  connection: RecordedConnection;
}

/** Runs one recorded step: `ApplyDBUpdateManifest` over the step's input files, with the recorded user and the recorded ids. */
async function replay(caseName: string, step: string): Promise<{ recorded: { messages: SentMessage[]; log: string }; ours: Replayed }> {
  const dir = join(CASES, caseName, step);
  const calls = readTranscript(join(dir, "transcript.jsonl"), join(dir, "_blobs"));
  const recordedLog = readFileSync(join(dir, "engine.log"), "utf8");
  const recordedMessages = readFileSync(join(dir, "messages.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as SentMessage);

  const work = mkdtempSync(join(tmpdir(), "libsjs-dbp-"));
  roots.push(work);
  for (const file of readdirSync(join(dir, "input"))) copyFileSync(join(dir, "input", file), join(work, file));
  const logPath = join(work, "engine.log");

  const context = new SolutionUpgradeContext();
  context.action = field(recordedLog, "Action");
  context.url = field(recordedLog, "URL");
  context.dataBase = field(recordedLog, "Database");
  context.userName = field(recordedLog, "User");
  context.workingDirectory = work;
  context.logFilePath = logPath;
  const config = new DBUpdateConfig();
  config.dbUpdatedManifestFilePath = join(work, "manifest.xml");
  config.dbPatchesFolderPath = work;
  config.toolName = field(recordedLog, "Tool name");

  const connection = new RecordedConnection(calls);
  const helper = new CItemHelper(connection, { engine: "14.35" });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  const sent: SentMessage[] = [];
  // the ids the engine gave the items it added, in order, and the os_user it wrote
  const addedIds = calls.flatMap((call) => /^<Item [^>]*action="add" id="([0-9A-F]{32})"/.exec(call.request)?.[1] ?? []);
  const osUser = calls.flatMap((call) => /<os_user>([^<]*)<\/os_user>/.exec(call.request)?.[1] ?? [])[0];
  const manager = new ImportExportManager(context, createMessagesFactory({ engine: "14.35", onMessage: (message) => void sent.push(message) }), helper, {
    cwd: work,
    now: () => new Date(2026, 9, 19, 2, 38, 8),
    ...(osUser === undefined ? {} : { osUser }),
  });
  let thrown: unknown;
  try {
    await manager.applyDBUpdateManifest(config, { newId: () => addedIds.shift() as string });
  } catch (error) {
    thrown = error;
  }
  return { recorded: { messages: recordedMessages, log: recordedLog }, ours: { messages: sent, log: readFileSync(logPath, "utf8"), thrown, connection } };
}

describe("the recorded DB patch runs, replayed through ApplyDBUpdateManifest (DBP-001 to DBP-044)", () => {
  describe("non-root: the admin login (DBP-003, DBP-010)", () => {
    it("is refused with the engine's message, after the start lines and before any request", async () => {
      const { recorded, ours } = await replay("non-root", "step-1");
      expect(ours.thrown).toBeInstanceOf(Error);
      expect((ours.thrown as Error).message).toBe("Login name is not root. It is 'admin'. Check your config file.");
      expect(ours.connection.mismatches).toEqual([]);
      expect(ours.connection.consumed).toBe(0);
      expect(ours.messages.map(({ channel, text }) => ({ channel, text: masked(text) }))).toEqual(
        recorded.messages.map(({ channel, text }) => ({ channel, text: masked(text) })),
      );
      expect(ours.messages.map((message) => message.channel)).toEqual(["status", "status", "error", "status", "status"]);
    });

    it("leaves the log of the engine: the header, the start lines, the refusal and the end lines", async () => {
      const { recorded, ours } = await replay("non-root", "step-1");
      expect(masked(ours.log)).toBe(masked(recorded.log));
    });
  });

  describe.each(steps("apply"))("apply, %s: the no-op patch (DBP-020 to DBP-044)", (step) => {
    // `steps` is evaluated for a case that is in the fixture; its two steps are the first run and the same patch again
    it("sends the recorded requests, in order, and nothing else", async () => {
      const { ours } = await replay("apply", step);
      expect(ours.connection.mismatches).toEqual([]);
      expect(ours.connection.consumed).toBe(ours.connection.total);
    });

    it("sends the recorded messages on the recorded channels", async () => {
      const { recorded, ours } = await replay("apply", step);
      expect(ours.messages.map(({ channel, text }) => ({ channel, text: masked(text) }))).toEqual(
        recorded.messages.map(({ channel, text }) => ({ channel, text: masked(text) })),
      );
    });

    it("leaves the log of the engine", async () => {
      const { recorded, ours } = await replay("apply", step);
      expect(masked(ours.log)).toBe(masked(recorded.log));
    });

    it("does not throw: a patch the server refused is an error message (DBP-042, DBP-050)", async () => {
      const { ours } = await replay("apply", step);
      expect(ours.thrown).toBeUndefined();
    });
  });

  it("the second run of the patch is the already-applied fault: one error message, and the row ends at status 2 (DBP-042, DBP-044)", async () => {
    const { ours } = await replay("apply", "step-2");
    expect(ours.messages.filter((message) => message.channel === "error")).toHaveLength(1);
    expect(ours.messages.find((message) => message.channel === "error")?.text).toContain("has already been applied to this database");
    expect(ours.messages.at(-3)?.text).toContain("<upgrade_status>2</upgrade_status>");
  });

  it("the first run sends the 22 messages and the 10 requests the engine did", async () => {
    const { ours } = await replay("apply", "step-1");
    expect(ours.messages).toHaveLength(22);
    expect(ours.connection.consumed).toBe(10);
  });

  it("the first run ends the row at status 1 and has no error and no warning but the empty lookup (DBP-030, DBP-044)", async () => {
    const { ours } = await replay("apply", "step-1");
    expect(ours.messages.filter((message) => message.channel === "error")).toEqual([]);
    expect(ours.messages.filter((message) => message.channel === "warning")).toHaveLength(1);
    expect(ours.messages.find((message) => message.text.includes("<upgrade_status>1</upgrade_status>"))?.channel).toBe("status");
  });
});
