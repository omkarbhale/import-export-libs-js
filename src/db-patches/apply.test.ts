import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { soapFault, soapResult } from "../client/fake-transport.js";
import { ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { CItemHelper } from "../client/item-helper.js";
import { documentOuterXml, parseXml } from "../client/mini-xml.js";
import { ArasVersion } from "../client/version.js";
import { SolutionUpgradeContext } from "../export/export-context.js";
import { ImportExportManager } from "../export/import-export-manager.js";
import { type SentMessage, createMessagesFactory } from "../export/messages.js";
import { ArgumentException, ArgumentNullException } from "../io/errors.js";
import { DBUpdateConfig, inRunOrder, UpdateNode } from "./config.js";
import { DbPatchesNotInEngineError } from "./engines.js";

/**
 * The rules of the DB patch run that the dev server's two recordings do not show (DBP-003 to DBP-094, marked *Inferred from the
 * code* in the spec), run against a server that answers from a script. The recorded runs are replayed in replay.test.ts.
 */

const SUPER_USER = "6B14D33C4A7D41C188CCF2BC15BD01A3";
const INNOVATOR_ADMIN = "DBA5D86402BF43D5976854B8B48FCDD1";
const NOOP_PATCH = "<Update><Type>C#</Type><Body><![CDATA[return this;]]></Body><Data/></Update>";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface Sent {
  action: string;
  request: string;
}

/** What the script answers: the text of the answer, or undefined to take the happy-path answer. */
type Responder = (action: string, request: string, sent: readonly Sent[]) => string | undefined;

/** The answers of a server that accepts everything: `root` is the Super User, there is no row for the release, the patch applies. */
function happy(action: string, request: string): string {
  if (action === "ValidateUser") return soapResult("<id>U1</id><user_type>admin</user_type>");
  if (action === "GetItem") {
    if (request.includes('type="USER"')) {
      return soapResult(`<Item type="User" id="U1"><Relationships><Item type="Alias"><related_id><Item type="Identity" id="${SUPER_USER}"/></related_id></Item></Relationships></Item>`);
    }
    return soapResult(`<Item type="Identity" id="${request.includes("Super User") ? SUPER_USER : INNOVATOR_ADMIN}"/>`);
  }
  if (action === "ApplyUpdate") return soapResult('<Item type="Applied Updates" id="UPDATE1"/>');
  if (request.includes('type="ItemType"')) return soapResult('<Item type="ItemType" id="IT1"/>');
  if (request.includes('type="DatabaseUpgrade"') && request.includes('action="get"')) return soapFault("0", "No items of type DatabaseUpgrade found.");
  const id = /id="([^"]*)"/.exec(request)?.[1] ?? "";
  return soapResult(`<Item type="DatabaseUpgrade" id="${id}"/>`);
}

class ScriptedConnection implements ServerConnection {
  readonly sent: Sent[] = [];

  constructor(private readonly responder: Responder) {}

  async callAction(action: string, request: string): Promise<ResponseDocument> {
    const wire = documentOuterXml(parseXml(request));
    this.sent.push({ action, request: wire });
    return ResponseDocument.parse(this.responder(action, wire, this.sent) ?? happy(action, wire));
  }
}

interface Run {
  /** The patch files by name (`<name>.xml`), and the manifest text. */
  manifest?: string;
  patches?: Record<string, string>;
  user?: string | null;
  responder?: Responder;
  config?: (config: DBUpdateConfig) => void;
  loggedIn?: boolean;
}

interface Outcome {
  thrown: unknown;
  messages: SentMessage[];
  log: string;
  sent: Sent[];
  work: string;
}

const manifestOf = (entries: string, version = "<software_version>3501</software_version>"): string =>
  `<updates_manifest>${version}<updates>${entries}</updates></updates_manifest>`;
const entry = (number: string, name: string, order: string, generation = "1"): string =>
  `<update><up_number>${number}</up_number><name>${name}</name><order>${order}</order><generation>${generation}</generation></update>`;

async function run(options: Run = {}): Promise<Outcome> {
  const work = mkdtempSync(join(tmpdir(), "libsjs-dbp-unit-"));
  roots.push(work);
  writeFileSync(join(work, "manifest.xml"), options.manifest ?? manifestOf(entry("N1", "P1", "1")));
  for (const [name, text] of Object.entries(options.patches ?? { P1: NOOP_PATCH })) writeFileSync(join(work, `${name}.xml`), text);
  const logPath = join(work, "engine.log");

  const context = new SolutionUpgradeContext();
  context.action = "ImportDPPatch";
  context.userName = options.user === undefined ? "root" : options.user;
  context.url = "http://dev/12sp9";
  context.dataBase = "12sp9";
  context.workingDirectory = work;
  context.logFilePath = logPath;
  const config = new DBUpdateConfig();
  config.dbUpdatedManifestFilePath = join(work, "manifest.xml");
  config.dbPatchesFolderPath = work;
  options.config?.(config);

  const connection = new ScriptedConnection(options.responder ?? (() => undefined));
  const helper = new CItemHelper(connection, { engine: "14.35" });
  if (options.loggedIn !== false) helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  const messages: SentMessage[] = [];
  const manager = new ImportExportManager(context, createMessagesFactory({ engine: "14.35", onMessage: (message) => void messages.push(message) }), helper, {
    cwd: work,
    now: () => new Date(2026, 9, 19, 2, 38, 8),
    osUser: "HOST\\tester",
  });
  let counter = 0;
  let thrown: unknown;
  try {
    await manager.applyDBUpdateManifest(config, { newId: () => `NEW${(counter += 1)}` });
  } catch (error) {
    thrown = error;
  }
  return { thrown, messages, log: existsSync(logPath) ? readFileSync(logPath, "utf8") : "", sent: connection.sent, work };
}

const texts = (outcome: Outcome, channel: SentMessage["channel"]): string[] => outcome.messages.filter((m) => m.channel === channel).map((m) => m.text);
const actions = (outcome: Outcome): string[] => outcome.sent.map((call) => call.action);
const lastTwo = (outcome: Outcome): string[] => outcome.messages.slice(-2).map((m) => m.text);

describe("ApplyDBUpdateManifest: the order of the checks (DBP-003)", () => {
  it("refuses a null config before the log is opened (DBP-003 step 1)", async () => {
    const work = mkdtempSync(join(tmpdir(), "libsjs-dbp-unit-"));
    roots.push(work);
    const context = new SolutionUpgradeContext();
    context.logFilePath = join(work, "engine.log");
    const helper = new CItemHelper(new ScriptedConnection(() => undefined), { engine: "14.35" });
    const sent: SentMessage[] = [];
    const manager = new ImportExportManager(context, createMessagesFactory({ engine: "14.35", onMessage: (m) => void sent.push(m) }), helper, { cwd: work });
    const thrown = await manager.applyDBUpdateManifest(null).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(ArgumentNullException);
    expect((thrown as Error).message).toBe("Value cannot be null.\r\nParameter name: config");
    expect(sent).toEqual([]);
    expect(existsSync(context.logFilePath)).toBe(false);
  });

  it("a log that cannot be opened ends the run before any message (DBP-003 step 2)", async () => {
    const context = new SolutionUpgradeContext();
    const helper = new CItemHelper(new ScriptedConnection(() => undefined), { engine: "14.35" });
    const sent: SentMessage[] = [];
    const manager = new ImportExportManager(context, createMessagesFactory({ engine: "14.35", onMessage: (m) => void sent.push(m) }), helper);
    const thrown = await manager.applyDBUpdateManifest(new DBUpdateConfig()).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(ArgumentNullException);
    expect(sent).toEqual([]);
  });

  it("checks root before the paths, the paths before the server, and sends nothing for a refusal (DBP-010)", async () => {
    for (const user of ["Root", "ROOT", "admin", ""]) {
      const outcome = await run({ user, config: (config) => (config.dbUpdatedManifestFilePath = null) });
      expect((outcome.thrown as Error).message).toBe(`Login name is not root. It is '${user}'. Check your config file.`);
      expect(outcome.sent).toEqual([]);
    }
  });

  it("a null user name formats as empty (DBP-010)", async () => {
    const outcome = await run({ user: null });
    expect(outcome.thrown).toBeInstanceOf(ArgumentException);
    expect(texts(outcome, "error")).toEqual(["Login name is not root. It is ''. Check your config file."]);
  });

  it.each([
    ["the manifest path", (config: DBUpdateConfig) => (config.dbUpdatedManifestFilePath = ""), "DB updated manifest file path was not specified. Check your config file."],
    ["the folder path", (config: DBUpdateConfig) => (config.dbPatchesFolderPath = null), "DB patches folder path was not specified. Check your config file."],
  ])("refuses a missing %s before any request (DBP-003 step 5)", async (_, mutate, message) => {
    const outcome = await run({ config: mutate });
    expect(outcome.thrown).toBeInstanceOf(ArgumentException);
    expect((outcome.thrown as Error).message).toBe(message);
    expect(outcome.sent).toEqual([]);
  });

  it("the manifest path is checked before the folder (DBP-003 step 5)", async () => {
    const outcome = await run({
      config: (config) => {
        config.dbUpdatedManifestFilePath = null;
        config.dbPatchesFolderPath = null;
      },
    });
    expect((outcome.thrown as Error).message).toBe("DB updated manifest file path was not specified. Check your config file.");
  });

  it("sends the end lines, and leaves them in the log, whatever happened (DBP-003 step 7)", async () => {
    const outcome = await run({ user: "admin" });
    expect(lastTwo(outcome)).toEqual(["End of importing DB packages.", "End time: 10/19/2026 02:38:08"]);
    expect(outcome.log).toMatch(/Login name is not root\. It is 'admin'\. Check your config file\.\r\nEnd of importing DB packages\.\r\nEnd time: 10\/19\/2026 02:38:08\r\n$/);
  });

  it("a helper that never logged in makes the header a null reference, which the handler reports (DBP-005)", async () => {
    const outcome = await run({ loggedIn: false });
    expect((outcome.thrown as Error).message).toBe("Object reference not set to an instance of an object.");
    expect(outcome.messages.map((m) => m.channel)).toEqual(["error", "status", "status"]);
    expect(outcome.sent).toEqual([]);
  });

  it("writes the header with the engine's misspellings and an empty line after it (DBP-005)", async () => {
    const outcome = await run();
    expect(outcome.log.split("\r\n").slice(0, 16)).toEqual([
      "Tool version: 14.35.0.43890",
      "Action: ImportDPPatch",
      "Manifest file: ",
      `Log file: ${join(outcome.work, "engine.log")}`,
      `Working directory: ${outcome.work}`,
      "URL: http://dev/12sp9",
      "Database: 12sp9",
      "User: root",
      "Innovator version: 12.0 SP9 Build 24090",
      "Language pack: ",
      "Language pack name: ",
      `DB updated nanifest file path: ${join(outcome.work, "manifest.xml")}`,
      `DB pathes folder path: ${outcome.work}`,
      "Tool name: Libs",
      "",
      "Start of importing DB packages.",
    ]);
  });

  it("is an operation of 14.35 only (DBP-001)", async () => {
    const helper = new CItemHelper(new ScriptedConnection(() => undefined), { engine: "14.0.7" });
    const manager = new ImportExportManager(new SolutionUpgradeContext(), createMessagesFactory(), helper);
    await expect(manager.applyDBUpdateManifest(new DBUpdateConfig())).rejects.toBeInstanceOf(DbPatchesNotInEngineError);
  });
});

describe("ValidateRootUser (DBP-011, DBP-012)", () => {
  const ending = (outcome: Outcome) => outcome.messages.map((m) => m.channel).slice(-4);

  it("asks four questions with the requests of the engine and then reads the manifest (DBP-011)", async () => {
    const outcome = await run();
    expect(outcome.sent.slice(0, 4)).toEqual([
      { action: "ValidateUser", request: "<Empty />" },
      { action: "GetItem", request: '<Item type="USER" id="U1" select="id" config_path="Alias" levels="1" />' },
      { action: "GetItem", request: '<Item type="Identity"><name>Super User</name></Item>' },
      { action: "GetItem", request: '<Item type="Identity"><name>Innovator Admin</name></Item>' },
    ]);
  });

  it.each([
    ["a fault of ValidateUser", { ValidateUser: soapFault("1", "no session") }, "no session", 1],
    ["a user that is not an admin", { ValidateUser: soapResult("<id>U1</id><user_type>user</user_type>") }, "User type is not admin. It is user Possible IR-005481 customer support issue", 1],
    ["a missing user_type", { ValidateUser: soapResult("<id>U1</id>") }, "Object reference not set to an instance of an object.", 1],
    ["a fault of the user lookup", { GetItem: soapFault("1", "denied") }, "denied", 2],
    [
      "an Alias that is another identity",
      { GetItem: soapResult('<Item type="User" id="U1"><Relationships><Item type="Alias"><related_id><Item type="Identity" id="OTHER"/></related_id></Item></Relationships></Item>') },
      "Did not obtain expected root super user identity. Got OTHER instead. Possible IR-005481 customer support issue",
      2,
    ],
    ["a user with no Alias", { GetItem: soapResult('<Item type="User" id="U1"/>') }, "Did not obtain expected root super user identity. Got  instead. Possible IR-005481 customer support issue", 2],
  ])("%s ends the run with the engine's message (DBP-011)", async (_, answers, message, calls) => {
    const outcome = await run({ responder: (action) => (action in answers ? answers[action as keyof typeof answers] : undefined) });
    expect((outcome.thrown as Error).message).toBe(message);
    expect(outcome.sent).toHaveLength(calls);
    expect(texts(outcome, "error")).toEqual([message]);
    expect(ending(outcome)).toEqual(["status", "error", "status", "status"]);
  });

  it("checks the identity ids, a missing identity and a missing item (DBP-011)", async () => {
    const identity = (wrongFor: string, answer: string) => async (): Promise<Outcome> =>
      run({ responder: (action, request) => (action === "GetItem" && request.includes(wrongFor) ? answer : undefined) });
    const superUser = await identity("Super User", soapResult('<Item type="Identity" id="OTHER"/>'))();
    expect((superUser.thrown as Error).message).toBe("Did not get expected id result for Super User identity. Possible IR-005481 customer support issue");
    const admin = await identity("Innovator Admin", soapResult('<Item type="Identity" id="OTHER"/>'))();
    expect((admin.thrown as Error).message).toBe("Did not get expected id result for Innovator Admin identity. Possible IR-005481 customer support issue");
    const missing = await identity("Innovator Admin", soapFault("0", "No items of type Identity found."))();
    expect((missing.thrown as Error).message).toBe("No items of type Identity found.");
    const none = await identity("Super User", soapResult(""))();
    expect((none.thrown as Error).message).toBe("Object reference not set to an instance of an object.");
    expect(actions(none)).toHaveLength(3);
  });

  it("sends the request as it is loaded, so a malformed one is an XmlException before anything is sent (DBP-012)", async () => {
    const outcome = await run({ manifest: manifestOf(entry("N&lt;1", "P1", "1")) });
    expect((outcome.thrown as Error).name).toBe("XmlException");
    expect(actions(outcome)).toEqual(["ValidateUser", "GetItem", "GetItem", "GetItem", "ApplyItem", "ApplyItem", "ApplyItem"]);
  });
});

describe("the manifest (DBP-020 to DBP-022)", () => {
  it("a missing manifest is found only after the four requests of ValidateRootUser (DBP-020)", async () => {
    const outcome = await run({ config: (config) => (config.dbUpdatedManifestFilePath = join(tmpdir(), "libsjs-no-such-dir", "manifest.xml")) });
    expect((outcome.thrown as Error).name).toMatch(/NotFound/);
    expect(actions(outcome)).toEqual(["ValidateUser", "GetItem", "GetItem", "GetItem"]);
  });

  it("a malformed manifest is an XmlException after the four requests (DBP-020)", async () => {
    const outcome = await run({ manifest: "<updates_manifest>" });
    expect((outcome.thrown as Error).name).toBe("XmlException");
    expect(actions(outcome)).toHaveLength(4);
  });

  it.each([
    ["3501", "35.01"],
    ["9999", "99.99"],
    ["ab", "ab."],
    ["123456", "12.3456"],
  ])("software_version %s is release %s (DBP-021)", async (version, release) => {
    const outcome = await run({ manifest: manifestOf("", `<software_version>${version}</software_version>`) });
    expect(texts(outcome, "status")).toContain(`Loaded [${join(outcome.work, "manifest.xml")}] for upgrade to release [${release}].`);
  });

  it("takes the first software_version anywhere in the document, and 00. when there is none (DBP-021)", async () => {
    const first = await run({ manifest: `<m><x><software_version>1234</software_version></x><software_version>9999</software_version><updates/></m>` });
    expect(texts(first, "status")).toContain(`Loaded [${join(first.work, "manifest.xml")}] for upgrade to release [12.34].`);
    const none = await run({ manifest: "<m><updates/></m>" });
    expect(texts(none, "status")).toContain(`Loaded [${join(none.work, "manifest.xml")}] for upgrade to release [00.].`);
  });

  it.each(["<software_version/>", "<software_version>5</software_version>"])("a short software_version (%s) crashes after the four requests and before the row (bug DBP-091)", async (version) => {
    const outcome = await run({ manifest: manifestOf("", version) });
    expect((outcome.thrown as Error).message).toBe("Index and length must refer to a location within the string.\r\nParameter name: length");
    expect(actions(outcome)).toHaveLength(4);
    expect(texts(outcome, "error")).toHaveLength(1);
  });

  it("an order that is not an integer ends the run before the count and the row (DBP-022)", async () => {
    for (const [order, message] of [
      ["x", "Input string was not in a correct format."],
      ["", "Input string was not in a correct format."],
      ["99999999999", "Value was either too large or too small for an Int32."],
    ] as const) {
      const outcome = await run({ manifest: manifestOf(entry("N1", "P1", order)) });
      expect((outcome.thrown as Error).message).toBe(message);
      expect(actions(outcome)).toHaveLength(4);
      expect(texts(outcome, "status").some((text) => text.startsWith("There are"))).toBe(false);
    }
  });

  it("accepts white space and a sign around the order, and reads -1 for a missing one (DBP-022)", () => {
    const nodes = [" +5 ", "-3", null].map((order) => {
      const node = new UpdateNode();
      node.order = order === null ? -1 : Number(order.trim());
      return node;
    });
    expect(inRunOrder(nodes).map((node) => node.order)).toEqual([-3, -1, 5]);
  });

  it("runs the entries in ascending order, and manifest order among equal ones (DBP-022)", async () => {
    const outcome = await run({
      manifest: manifestOf(entry("N3", "C", "2") + entry("N1", "A", "1") + entry("N4", "D", "2") + entry("N2", "B", "1")),
      patches: { A: NOOP_PATCH, B: NOOP_PATCH, C: NOOP_PATCH, D: NOOP_PATCH },
    });
    expect(texts(outcome, "status").filter((text) => text.startsWith("Start of importing '"))).toEqual([
      "Start of importing 'A' DB patch.",
      "Start of importing 'B' DB patch.",
      "Start of importing 'C' DB patch.",
      "Start of importing 'D' DB patch.",
    ]);
    expect(texts(outcome, "status")).toContain("There are 4 updates.");
  });

  it("reads each field from the first child of that exact name, and only entries under updates (DBP-022)", async () => {
    const manifest =
      "<m><software_version>3501</software_version><updates>" +
      "<update><x><up_number>DEEP</up_number></x><up_number>N1</up_number><up_number>N2</up_number><name>P1</name><order>1</order></update>" +
      "</updates><other><update><name>NOT</name></update></other></m>";
    const outcome = await run({ manifest });
    expect(texts(outcome, "status")).toContain("There are 1 updates.");
    const apply = outcome.sent.find((call) => call.action === "ApplyUpdate");
    expect(apply?.request.startsWith("<Item><Number>N1</Number><Name>P1</Name><Generation></Generation><Update>")).toBe(true);
  });

  it("an empty list is valid: the row is created and ends at status 1 (DBP-022)", async () => {
    const outcome = await run({ manifest: manifestOf("") });
    expect(outcome.thrown).toBeUndefined();
    expect(texts(outcome, "status")).toContain("There are 0 updates.");
    expect(actions(outcome).filter((action) => action === "ApplyUpdate")).toEqual([]);
    expect(texts(outcome, "status").some((text) => text.includes("<upgrade_status>1</upgrade_status>"))).toBe(true);
  });
});

describe("the DatabaseUpgrade row (DBP-030, DBP-031)", () => {
  const rowRequests = (outcome: Outcome): string[] => outcome.sent.filter((call) => call.action === "ApplyItem").map((call) => call.request);

  it("adds the row with the engine's properties, its own id and the tool name (DBP-030)", async () => {
    const outcome = await run({ config: (config) => (config.toolName = "My Tool") });
    expect(rowRequests(outcome)[2]).toBe(
      '<Item isNew="1" isTemp="1" type="DatabaseUpgrade" action="add" id="NEW1" select="id"><name>Applied Updates</name><target_release>35.01</target_release><type>0</type>' +
        "<description>My Tool</description><is_latest>1</is_latest><os_user>HOST\\tester</os_user><upgrade_status>0</upgrade_status><applied_on>__now()</applied_on></Item>",
    );
  });

  it("escapes a property value the way IOM does (DBP-030)", async () => {
    const outcome = await run({ config: (config) => (config.toolName = "a<b&c") });
    expect(rowRequests(outcome)[2]).toContain("<description>a&lt;b&amp;c</description>");
  });

  it("edits a row that exists and keeps its description, with no unlock when it is not locked (DBP-030)", async () => {
    const outcome = await run({
      responder: (action, request) =>
        action === "ApplyItem" && request.includes('type="DatabaseUpgrade"') && request.includes('action="get"')
          ? soapResult('<Item type="DatabaseUpgrade" id="ROW1"><id>ROW1</id></Item>')
          : undefined,
    });
    expect(rowRequests(outcome)[2]).toBe(
      '<Item isNew="1" isTemp="1" type="DatabaseUpgrade" action="edit" select="id" id="ROW1"><os_user>HOST\\tester</os_user><upgrade_status>0</upgrade_status><applied_on>__now()</applied_on></Item>',
    );
    expect(rowRequests(outcome).some((request) => request.includes('action="unlock"'))).toBe(false);
  });

  it("unlocks a locked row first and ignores the answer (DBP-030)", async () => {
    const outcome = await run({
      responder: (action, request) => {
        if (action !== "ApplyItem" || !request.includes('type="DatabaseUpgrade"')) return undefined;
        if (request.includes('action="get"')) return soapResult('<Item type="DatabaseUpgrade" id="ROW1"><locked_by_id>U9</locked_by_id></Item>');
        if (request.includes('action="unlock"')) return soapFault("1", "cannot unlock");
        return undefined;
      },
    });
    const requests = rowRequests(outcome);
    expect(requests[2]).toContain('action="unlock"');
    expect(requests[3]).toContain('action="edit" select="id" id="ROW1"');
    expect(outcome.thrown).toBeUndefined();
    expect(texts(outcome, "error")).toEqual([]);
  });

  it("several rows are a 'Not a single item' that ends the run (DBP-030, DBP-050)", async () => {
    const outcome = await run({
      responder: (action, request) =>
        action === "ApplyItem" && request.includes('type="DatabaseUpgrade"') && request.includes('action="get"')
          ? soapResult('<Item type="DatabaseUpgrade" id="A"/><Item type="DatabaseUpgrade" id="B"/>')
          : undefined,
    });
    expect((outcome.thrown as Error).message).toBe("Not a single item");
  });

  it("a fault on the final request returns no id: the patches are applied and not recorded (DBP-030, DBP-031)", async () => {
    const outcome = await run({
      responder: (action, request) => (action === "ApplyItem" && request.includes('action="add"') && request.includes('type="DatabaseUpgrade"') ? soapFault("1", "no add") : undefined),
    });
    expect(outcome.thrown).toBeUndefined();
    expect(texts(outcome, "warning")).toHaveLength(2);
    expect(actions(outcome).filter((action) => action === "ApplyUpdate")).toHaveLength(1);
    expect(outcome.sent.some((call) => call.request.includes("DatabaseUpgradePatch"))).toBe(false);
    expect(texts(outcome, "status").some((text) => text.includes("upgrade_status>1"))).toBe(false);
    expect(texts(outcome, "status")).toContain("DB patch imported successfully.");
  });

  it("no ItemType DatabaseUpgrade returns no id after one request, as a warning (DBP-030)", async () => {
    const outcome = await run({ responder: (action, request) => (request.includes('type="ItemType"') && action === "ApplyItem" ? soapFault("0", "none") : undefined) });
    expect(texts(outcome, "warning")).toHaveLength(1);
    expect(rowRequests(outcome)).toHaveLength(1);
    expect(outcome.thrown).toBeUndefined();
  });
});

describe("the patches (DBP-040 to DBP-044)", () => {
  const manifest = manifestOf(entry("N1", "A", "1") + entry("N2", "B", "2"));
  const rowStatus = (outcome: Outcome): string | undefined => outcome.sent.filter((call) => call.request.includes("<upgrade_status>")).at(-1)?.request.match(/<upgrade_status>(\d)</)?.[1];

  it("a missing patch file is an error, marks the run failed and goes on with the next (DBP-040, bug DBP-094)", async () => {
    const outcome = await run({ manifest, patches: { B: NOOP_PATCH } });
    expect(outcome.thrown).toBeUndefined();
    expect(texts(outcome, "error")).toEqual([`File not found : ${outcome.work}\\A.xml.`]);
    expect(texts(outcome, "status")).toContain("Start of importing 'B' DB patch.");
    expect(texts(outcome, "status")).toContain("DB patch imported successfully.");
    expect(rowStatus(outcome)).toBe("2");
    const lines = texts(outcome, "status");
    expect(lines[lines.indexOf("Start of importing 'A' DB patch.") + 2]).toBe("Start of importing 'B' DB patch.");
  });

  it("an unreadable patch file is an error with the exception's message and the same status (DBP-040)", async () => {
    const outcome = await run({ manifest, patches: { A: "<Update>", B: NOOP_PATCH } });
    expect(texts(outcome, "error")).toHaveLength(1);
    expect(texts(outcome, "error")[0]).toMatch(/^Unexpected end of file/);
    expect(rowStatus(outcome)).toBe("2");
  });

  it("an entry with no name looks for .xml (DBP-040)", async () => {
    const outcome = await run({ manifest: manifestOf("<update><up_number>N1</up_number><order>1</order></update>") });
    expect(texts(outcome, "error")[0]).toMatch(/\\\.xml\.$/);
  });

  it("a name that is not a legal path ends the run (DBP-040, DBP-050)", async () => {
    const outcome = await run({ manifest: manifestOf(entry("N1", "a|b", "1")) });
    expect(outcome.thrown).toBeInstanceOf(ArgumentException);
    expect((outcome.thrown as Error).message).toBe("Illegal characters in path.");
  });

  it("puts the number, name, generation and the whole patch file in the request, unescaped (DBP-041, DBP-093)", async () => {
    const outcome = await run({
      manifest: manifestOf(entry("N&amp;1", "P1", "1", "2")),
      patches: { P1: "<Update><Type>C#</Type><Body>a</Body><Data><x/></Data></Update>" },
    });
    expect((outcome.thrown as Error).name).toBe("XmlException");
    expect(outcome.sent.some((call) => call.action === "ApplyUpdate")).toBe(false);
    const clean = await run({ manifest: manifestOf(entry("N1", "P1", "1", "2")), patches: { P1: "<Update><Type>C#</Type><Body>a</Body><Data><x/></Data></Update>" } });
    expect(clean.sent.find((call) => call.action === "ApplyUpdate")?.request).toBe(
      "<Item><Number>N1</Number><Name>P1</Name><Generation>2</Generation><Update><Type>C#</Type><Body>a</Body><Data><x /></Data></Update></Item>",
    );
  });

  it("a patch file with an XML declaration breaks the request and leaves the row at status 0 (bug DBP-092)", async () => {
    const outcome = await run({ patches: { P1: `<?xml version="1.0"?>${NOOP_PATCH}` } });
    expect((outcome.thrown as Error).name).toBe("XmlException");
    expect((outcome.thrown as Error).message).toMatch(/^Unexpected XML declaration\. The XML declaration must be the first node in the document/);
    expect(outcome.sent.some((call) => call.action === "ApplyUpdate")).toBe(false);
    expect(rowStatus(outcome)).toBe("0");
    expect(lastTwo(outcome)[0]).toBe("End of importing DB packages.");
  });

  it("a fault from ApplyUpdate is an error with End time, and no link is written (DBP-042)", async () => {
    const outcome = await run({ responder: (action) => (action === "ApplyUpdate" ? soapFault("SOAP-ENV:Server", "compile error") : undefined) });
    expect(outcome.thrown).toBeUndefined();
    expect(texts(outcome, "error")).toHaveLength(1);
    expect(texts(outcome, "error")[0]).toMatch(/^Error of import DB patch\r\n<SOAP-ENV:Envelope/);
    expect(outcome.sent.some((call) => call.request.includes("DatabaseUpgradePatch"))).toBe(false);
    const channels = outcome.messages.map((m) => `${m.channel}:${m.text.split("\r\n")[0]}`);
    const failure = channels.findIndex((line) => line.startsWith("error:Error of import DB patch"));
    expect(channels[failure + 1]).toMatch(/^status:End time: /);
    expect(rowStatus(outcome)).toBe("2");
  });

  it("an answer without one item is 'Not a single item', which ends the run (DBP-042, DBP-050)", async () => {
    for (const answer of [soapResult(""), soapResult('<Item type="A" id="1"/><Item type="A" id="2"/>')]) {
      const outcome = await run({ responder: (action) => (action === "ApplyUpdate" ? answer : undefined) });
      expect((outcome.thrown as Error).message).toBe("Not a single item");
      expect(rowStatus(outcome)).toBe("0");
    }
  });

  it("links the applied update to the row (DBP-043)", async () => {
    const outcome = await run();
    const link = outcome.sent.find((call) => call.request.includes("DatabaseUpgradePatch"));
    expect(link?.request).toBe(
      '<Item isNew="1" isTemp="1" type="DatabaseUpgradePatch" action="add" id="NEW2"><source_id>NEW1</source_id><related_id>UPDATE1</related_id></Item>',
    );
    expect(rowStatus(outcome)).toBe("1");
  });

  it("a fault on the link is an error with End time, and the patch is not reported as imported (DBP-043)", async () => {
    const outcome = await run({ responder: (action, request) => (request.includes("DatabaseUpgradePatch") && action === "ApplyItem" ? soapFault("1", "link refused") : undefined) });
    expect(texts(outcome, "error")).toHaveLength(1);
    expect(texts(outcome, "error")[0]).toMatch(/^Error of import 'DatabaseUpgradePatch' item\r\n/);
    expect(texts(outcome, "status")).not.toContain("DB patch imported successfully.");
    expect(rowStatus(outcome)).toBe("2");
  });

  it("a fault on the final edit is an error and does not throw (DBP-044)", async () => {
    const outcome = await run({ responder: (action, request) => (request.includes("<upgrade_status>1<") && action === "ApplyItem" ? soapFault("1", "no edit") : undefined) });
    expect(outcome.thrown).toBeUndefined();
    expect(texts(outcome, "error")).toHaveLength(1);
    expect(texts(outcome, "error")[0]).toMatch(/^Error of import 'DatabaseUpgrade' item\r\n/);
  });

  it("writes every message to the log as a line, and the pretty form of the requests (DBP-004)", async () => {
    const outcome = await run();
    for (const message of outcome.messages) expect(outcome.log).toContain(`${message.text}\r\n`);
    expect(outcome.log).toContain("Request (formatted):\r\n<Item>\r\n  <Number>N1</Number>");
  });

  it("when a text does not parse, the log gets the exception and the message carries the text as it is (DBP-004)", async () => {
    const outcome = await run({ manifest: manifestOf(entry("N&lt;1", "P1", "1")) });
    expect((outcome.thrown as Error).name).toBe("XmlException");
    const request = "<Item><Number>N<1</Number><Name>P1</Name><Generation>1</Generation><Update><Type>C#</Type><Body><![CDATA[return this;]]></Body><Data /></Update></Item>";
    expect(texts(outcome, "status")).toContain(`Request (formatted):\r\n${request}`);
    expect(outcome.log).toMatch(/^System\.Xml\.XmlException: /m);
  });
});
