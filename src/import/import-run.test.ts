import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { StubConnection, stubFault, stubResult } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import { SolutionUpgradeContext } from "../export/export-context.js";
import { ImportExportManager } from "../export/import-export-manager.js";
import { type SentMessage, createMessagesFactory } from "../export/messages.js";
import { PackageDefinitionManager } from "../export/package-definition-manager.js";
import type { Engine } from "../engines.js";
import { ArgumentNullException, DirectoryNotFoundException, InvalidOperationException } from "../io/errors.js";
import { SUImportContext } from "./import-context.js";
import { ImportHelper, defaultOsUser } from "./import-helper.js";
import { ImportWorkItem } from "./import-work-item.js";
import { catalogueOf } from "../export/messages.js";
import { getImportableItemsCount, importInputParameters } from "./import-run.js";
import { getItemsFromPackageDom, isImportableType } from "./items.js";
import { loadXml } from "../xml/parser.js";
import { selectNodes } from "../xml/xpath.js";
import type { XmlElement } from "../xml/dom.js";

/**
 * The import orchestration (IMP-400 to IMP-471) against a small model of the server, the way the probe of
 * `fixtures/import-run/` ran the engine: a script answers the requests, and what the run leaves behind is compared with what
 * the spec says the engine does. The recorded runs of `import-run.replay.test.ts` cover the paths of a real server; these cover
 * the failure, cancel and edge paths the recordings do not reach.
 */
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const CLOCK = "<time>";
const NOW = new Date(2026, 9, 19, 1, 2, 3);
const I18N_ENVELOPE =
  '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="http://www.aras.com/I18N"><SOAP-ENV:Body><Result>';

/** The answer of the model server to a request, unless a rule of the test answers first. */
function modelAnswer(wire: string): string {
  const type = /type="([^"]*)"/.exec(wire)?.[1] ?? "";
  const action = /action="([^"]*)"/.exec(wire)?.[1] ?? "get";
  const name = /<name>([^<]*)<\/name>/.exec(wire)?.[1] ?? "";
  if (type === "PackageDefinition" && wire.includes('select="name,generation"')) return stubFault("0", "No items of type PackageDefinition found.");
  if (type === "ItemType" && wire.includes('select="is_versionable"')) return stubResult(`<Item type="ItemType"><is_versionable>0</is_versionable></Item>`);
  if (type === "ItemType" && wire.includes('language="en"')) {
    return `${I18N_ENVELOPE}<Item type="ItemType"><i18n:label xml:lang="en">${name}</i18n:label></Item></Result></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  }
  if (type === "ItemType") return stubResult(`<Item type="ItemType" id="IT-${name}"><id>IT-${name}</id></Item>`);
  if (action === "get") return stubFault("0", `No items of type ${type} found.`);
  if (type === "PackageDefinition") return stubResult(`<Item type="PackageDefinition" id="PD-${name}"><id>PD-${name}</id></Item>`);
  if (type === "DatabaseUpgrade") return stubResult(`<Item type="DatabaseUpgrade" id="DU-${name}" />`);
  if (type === "PackageGroup") return stubResult(`<Item type="PackageGroup" id="PG-${name}" />`);
  if (type === "PackageDependsOn") return stubResult(`<Item type="PackageDependsOn" id="DEP-${name}" />`);
  return stubResult(`<Item type="${type}" />`);
}

type Rule = (wire: string) => string | undefined;

interface PackageFixture {
  /** The `dependson` markup under the package. */
  dependsOn?: string;
  /** Item files by their path under the package folder, such as `List/colors.xml`. */
  files?: Record<string, string>;
}

interface Options {
  packages: Record<string, PackageFixture>;
  rules?: Rule[];
  merge?: boolean;
  verbose?: boolean;
  release?: string;
  description?: string;
  loggedIn?: boolean;
  logDirectory?: string;
  /** The engine of the run; the default is 14.0.7. */
  engine?: Engine;
  onMessage?: (message: SentMessage, manager: ImportExportManager) => void;
}

const list = (id: string, name: string, extra = ""): string => `<AML><Item type="List" id="${id}" action="add"><name>${name}</name>${extra}</Item></AML>`;

function harness(options: Options) {
  const root = mkdtempSync(join(tmpdir(), "libsjs-run-unit-"));
  roots.push(root);
  const manifest = Object.entries(options.packages)
    .map(([name, pkg]) => `<package name="${name}" path="${name}\\Import">${pkg.dependsOn ?? ""}</package>`)
    .join("");
  writeFileSync(join(root, "imports.mf"), `<imports>${manifest}</imports>`);
  for (const [name, pkg] of Object.entries(options.packages)) {
    mkdirSync(join(root, name, "Import"), { recursive: true });
    for (const [path, aml] of Object.entries(pkg.files ?? {})) {
      mkdirSync(dirname(join(root, name, "Import", path)), { recursive: true });
      writeFileSync(join(root, name, "Import", path), aml);
    }
  }
  const logPath = join(options.logDirectory ?? root, "engine.log");
  const context = new SolutionUpgradeContext();
  context.action = "Import";
  context.url = "http://stub/";
  context.dataBase = "db";
  context.userName = "admin";
  context.manifestFile = join(root, "imports.mf");
  context.workingDirectory = root;
  context.logFilePath = logPath;
  context.verbose = options.verbose === true;

  const importContext = new SUImportContext();
  importContext.merge = options.merge === true;
  importContext.release = options.release ?? "R1";
  importContext.description = options.description ?? "D1";

  const rules = options.rules ?? [];
  const connection = new StubConnection((wire) => {
    for (const rule of rules) {
      const answer = rule(wire);
      if (answer !== undefined) return answer;
    }
    return modelAnswer(wire);
  });
  const helper = new CItemHelper(connection, { engine: options.engine ?? "14.0.7" });
  if (options.loggedIn !== false) helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);

  const sent: SentMessage[] = [];
  let console = "";
  let manager: ImportExportManager | undefined;
  const messages = createMessagesFactory({
    onMessage: (message) => {
      sent.push(message);
      options.onMessage?.(message, manager as ImportExportManager);
    },
  });
  manager = new ImportExportManager(context, messages, helper, {
    cwd: root,
    now: () => NOW,
    osUser: "TEST\\user",
    console: {
      write: (text) => void (console += text),
      writeLine: (text = "") => void (console += `${text}\r\n`),
    },
  });
  const names = Object.keys(options.packages);
  return {
    root,
    manager,
    helper,
    context,
    importContext,
    requests: connection.requests,
    sent,
    run: (packages: readonly string[] = names) => manager.importSolutions(packages, importContext),
    console: () => console,
    log: () => readFileSync(logPath, "utf8").replace(/\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d/g, CLOCK),
    texts: (channel: SentMessage["channel"]) => sent.filter((message) => message.channel === channel).map((message) => message.text),
  };
}

/** The requests of a run that are about one type, with the verb, for short assertions. */
const about = (requests: readonly string[], type: string): string[] => requests.filter((wire) => wire.includes(`type="${type}"`));

const faultOn =
  (needle: string, code = "1", text = "refused"): Rule =>
  (wire) =>
    wire.includes(needle) ? stubFault(code, text) : undefined;

describe("IMP-401: the import context", () => {
  it("has the defaults, and a bFast that discards what is set", () => {
    const context = new SUImportContext();
    expect([context.merge, context.fast, context.release, context.description, context.vault]).toEqual([false, false, null, null, false]);
    context.fast = true;
    context.merge = true;
    expect([context.fast, context.merge]).toEqual([false, true]);
  });
});

describe("IMP-400, IMP-402 and IMP-403: the start of a run", () => {
  it("refuses a manifest that does not exist before anything else (IMP-402)", () => {
    const context = new SolutionUpgradeContext();
    context.action = "Import";
    context.manifestFile = join(tmpdir(), "libsjs-no-such", "imports.mf");
    const construct = () => new ImportExportManager(context, createMessagesFactory(), new CItemHelper(new StubConnection(() => undefined)));
    expect(construct).toThrow(CItemException);
    try {
      construct();
    } catch (error) {
      const failure = error as CItemException;
      expect([failure.faultcode, failure.faultstring, failure.faultdetail]).toEqual([-1, "", `Manifest file '${context.manifestFile}' doesn't exist`]);
      expect(failure.message).toBe(failure.faultdetail);
    }
  });

  it("takes the folder of the manifest as the manifest folder (IMP-402)", () => {
    const { manager, root } = harness({ packages: {} });
    expect(manager.manifestDirectory).toBe(root);
  });

  it("throws for a null import context before the log is opened (IMP-400)", async () => {
    const { manager, requests } = harness({ packages: { A: {} } });
    await expect(manager.importSolutions(["A"], null)).rejects.toBeInstanceOf(ArgumentNullException);
    expect(requests).toEqual([]);
  });

  it("lets a log that cannot be opened escape, with no message and no request (IMP-403)", async () => {
    const test = harness({ packages: { A: {} }, logDirectory: join(tmpdir(), "libsjs-no-such-log-dir") });
    await expect(test.run()).rejects.toBeInstanceOf(DirectoryNotFoundException);
    expect(test.requests).toEqual([]);
    expect(test.sent).toEqual([]);
  });

  it("writes the header, an empty line and the start line, with the values of the contexts (IMP-403)", async () => {
    const test = harness({ packages: { A: { files: { "List/a.xml": list("L1", "Colors") } } }, release: "R9" });
    await test.run();
    const header = test.log().split("\r\n").slice(0, 16);
    expect(header).toEqual([
      "Tool version: 14.0.7.35492",
      "Action: Import",
      `Manifest file: ${test.root}/imports.mf`,
      `Log file: ${test.root}/engine.log`,
      `Working directory: ${test.root}`,
      "URL: http://stub/",
      "Database: db",
      "User: admin",
      "Innovator version: 12.0 SP9 Build 24090",
      "Language pack: ",
      "Language pack name: ",
      "Fast import mode: False",
      "Merge import mode: False",
      "Import release: R9",
      "",
      "Start of importing packages",
    ]);
  });

  it("fails without a login, because the header reads the server version (IMP-403)", async () => {
    const test = harness({ packages: { A: {} }, loggedIn: false });
    expect(await test.run()).toBe(1);
    expect(test.log()).toBe(
      "\t\t****ErrorMessage****\r\nObject reference not set to an instance of an object.\r\n\t\t********************\r\n",
    );
    expect(test.texts("error")).toEqual(["          ****ErrorMessage****\r\n       Object reference not set to an instance of an object."]);
    expect(test.requests).toEqual([]);
  });

  it("builds the header text line by line (IMP-403)", () => {
    const context = new SolutionUpgradeContext();
    context.action = "Import";
    const importContext = new SUImportContext();
    importContext.merge = true;
    const text = importInputParameters(context, importContext, "1.2", "14.0.7.35492");
    expect(text.split("\r\n").slice(11)).toEqual(["Fast import mode: False", "Merge import mode: True", "Import release: ", ""]);
  });
});

describe("IMP-404 and IMP-405: the order of the packages and the package list", () => {
  it("returns 1 for an empty list and writes nothing more (IMP-404)", async () => {
    const test = harness({ packages: { A: {} } });
    expect(await test.run([])).toBe(1);
    expect(test.log().endsWith("Start of importing packages\r\n")).toBe(true);
    expect(test.sent.map((message) => message.channel)).toEqual(["warning"]);
    expect(test.requests.length).toBe(1);
  });

  it("writes the ordering warnings to the log before the first package (IMP-404)", async () => {
    const test = harness({
      packages: { A: { dependsOn: '<dependson name="Missing" />', files: { "List/a.xml": list("L1", "Colors") } } },
      rules: [(wire) => (wire.includes('select="name,generation"') ? stubResult('<Item type="PackageDefinition"><name>Other</name></Item>') : undefined)],
    });
    expect(await test.run()).toBe(0);
    expect(test.log()).toContain(
      "Start of importing packages\r\nOne of imported packages depends on the package 'Missing' that neither imported in this session nor exists in the database\r\nstart of execution",
    );
  });

  it("fails an unknown package at its turn, after its audit row was written (IMP-404, IMP-407)", async () => {
    const test = harness({ packages: { A: {} } });
    expect(await test.run(["Nope"])).toBe(1);
    expect(test.log()).toContain("Updating 'Nope' package to failed release status");
    expect(test.log()).toContain("Node for package 'Nope' doesn't exist in the manifest file Enable to detemine path to Nope.");
    expect(about(test.requests, "DatabaseUpgrade").length).toBeGreaterThan(2);
  });

  it("sends a warning when the database has no package definitions, and goes on (IMP-405)", async () => {
    const test = harness({ packages: { A: { files: { "List/a.xml": list("L1", "Colors") } } } });
    expect(await test.run()).toBe(0);
    expect(test.texts("warning")).toEqual(["The database contains no package definitions. Please select another database and try again"]);
  });

  it("crashes on the log when the package list fails, with two error messages (bug IMP-410)", async () => {
    const test = harness({ packages: { A: {} }, rules: [faultOn('select="name,generation"', "2", "boom")] });
    expect(await test.run()).toBe(1);
    const errors = test.texts("error");
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("faultstring:");
    expect(errors[1]).toContain("The process cannot access the file");
    expect(test.log()).toContain("\t\t****ErrorMessage****\r\nThe process cannot access the file");
    expect(about(test.requests, "DatabaseUpgrade")).toEqual([]);
  });
});

describe("IMP-406 to IMP-409: packages, failures and cancel", () => {
  const one = (name: string): PackageFixture => ({ files: { "List/a.xml": list(`L-${name}`, `Colors-${name}`) } });

  it("writes each package as one contiguous block between two audit-row writes (IMP-406)", async () => {
    const test = harness({ packages: { A: one("A"), B: one("B") } });
    expect(await test.run()).toBe(0);
    const log = test.log();
    expect(log.indexOf("Updating 'A' package to success release status")).toBeLessThan(log.indexOf("Updating 'B' package to 'inprogress' release status"));
    expect(log).toContain(`end of execution : ${CLOCK}\r\nstart of execution : ${CLOCK}\r\nUpdating 'B'`);
    expect(test.texts("status").slice(-2)).toEqual(["completed", "completed"]);
  });

  it("stops at the first failing package, wraps its message and reports it (IMP-407)", async () => {
    const test = harness({
      packages: { A: one("A"), B: one("B"), C: one("C") },
      rules: [(wire) => (wire.includes("Colors-B") && wire.includes('action="add"') ? stubFault("5", "boom") : undefined)],
    });
    expect(await test.run()).toBe(1);
    const log = test.log();
    expect(log).toContain("Updating 'B' package to failed release status");
    expect(log).not.toContain("'C'");
    const rows = test.requests.filter((wire) => wire.includes("upgrade_status"));
    expect(rows.map((wire) => /<upgrade_status>(\d)/.exec(wire)?.[1])).toEqual(["0", "1", "0", "2"]);
    const message = /\t\t\*\*\*\*ErrorMessage\*\*\*\*\r\n([\s\S]*?)\r\n\t\t\*{20}\r\n$/.exec(log)?.[1] ?? "";
    expect(message.startsWith("\r\nImport package 'B' failed with message:\n\n")).toBe(true);
    expect(message.endsWith("\nUpdating B to failed release status\r\n")).toBe(true);
    expect(test.texts("error")).toEqual([`          ****ErrorMessage****\r\n       ${message}`]);
    expect(test.texts("status").filter((text) => text === "completed")).toHaveLength(1);
  });

  it("lets the failure of the status-2 write replace the original error (bug IMP-411)", async () => {
    const test = harness({
      packages: { A: one("A") },
      rules: [
        (wire) => (wire.includes("Colors-A") && wire.includes('action="add"') ? stubFault("5", "item failed") : undefined),
        (wire) => (wire.includes("<upgrade_status>2</upgrade_status>") ? stubFault("6", "status refused") : undefined),
      ],
    });
    expect(await test.run()).toBe(1);
    const log = test.log();
    expect(log).toContain("Updating 'A' package to failed release status");
    expect(log).toContain("status refused");
    expect(log).not.toContain("item failed");
    expect(log).not.toContain("Import package 'A' failed");
  });

  it("records a cancel as a success and starts the next package, which stops at its first item (bug IMP-409)", async () => {
    let statuses = 0;
    const test = harness({
      packages: { A: { files: { "List/a.xml": list("LA1", "A1"), "List/b.xml": list("LA2", "A2") } }, B: one("B") },
      onMessage: (message, manager) => {
        if (message.channel === "status" && ++statuses === 3) manager.cancel();
      },
    });
    expect(await test.run()).toBe(0);
    expect(test.texts("status").filter((text) => text === "Import was canceled by user")).toHaveLength(2);
    const rows = test.requests.filter((wire) => wire.includes("<upgrade_status>")).map((wire) => /<upgrade_status>(\d)/.exec(wire)?.[1]);
    expect(rows).toEqual(["0", "1", "0", "1"]);
    expect(test.log()).toContain("Updating 'A' package to success release status");
    expect(test.log()).toContain("Updating 'B' package to success release status");
    expect(test.texts("status").at(-1)).toBe("completed");
    expect(about(test.requests, "PackageDefinition").filter((wire) => wire.includes('action="add"'))).toHaveLength(2);
  });

  it("loses a cancel made before the call (IMP-409)", async () => {
    const test = harness({ packages: { A: one("A") } });
    test.manager.cancel();
    expect(await test.run()).toBe(0);
    expect(test.texts("status")).toContain("Item 1 of 1: List - a");
  });
});

describe("14.35: packages, failures and cancel (IMP-406, IMP-407, IMP-409, IMP-470)", () => {
  const one = (name: string): PackageFixture => ({ files: { "List/a.xml": list(`L-${name}`, `Colors-${name}`) } });
  const two = (name: string): PackageFixture => ({
    files: { "List/a.xml": list(`L-${name}1`, `Colors-${name}1`), "List/b.xml": list(`L-${name}2`, `Colors-${name}2`) },
  });
  const rows = (requests: readonly string[]): (string | undefined)[] =>
    requests.filter((wire) => wire.includes("<upgrade_status>")).map((wire) => /<upgrade_status>(\d)/.exec(wire)?.[1]);

  it("runs the packages of a manifest and sends the corrected text of the package definition status (IMP-470)", async () => {
    const test = harness({ engine: "14.35", packages: { A: one("A") } });
    expect(await test.run()).toBe(0);
    expect(test.texts("status")).toContain("Adding PackageDefinition for A");
    expect(test.texts("status")).not.toContain("Adding PackageDefinintion for A");
    expect(test.log()).toContain("Tool version: 14.35.0.43890");
    expect(test.texts("status").at(-1)).toBe("completed");
  });

  it("writes the error block with the CRLF first, and sends the error text without leading spaces (IMP-407, IMP-470)", async () => {
    const test = harness({
      engine: "14.35",
      packages: { A: one("A") },
      rules: [(wire) => (wire.includes("Colors-A") && wire.includes('action="add"') ? stubFault("5", "boom") : undefined)],
    });
    expect(await test.run()).toBe(1);
    const log = test.log();
    const failure = /\r\n\t\t\*\*\*\*ErrorMessage\*\*\*\*\r\n([\s\S]*?)\r\n\t\t\*{20}\r\n$/.exec(log)?.[1] ?? "";
    expect(failure.startsWith("\r\nImport package 'A' failed with message:\n\n")).toBe(true);
    expect(log).toContain("end of execution : <time>\r\n\r\n\t\t****ErrorMessage****\r\n");
    expect(test.texts("error")).toEqual([`\t\t****ErrorMessage****\r\n${failure}`]);
    expect(rows(test.requests)).toEqual(["0", "2"]);
  });

  it("records a cancel as a failure: the package gets status 2, the run returns 1 and the next package is not started (IMP-409)", async () => {
    let statuses = 0;
    const test = harness({
      engine: "14.35",
      packages: { A: two("A"), B: one("B") },
      onMessage: (message, manager) => {
        if (message.channel === "status" && ++statuses === 3) manager.cancel();
      },
    });
    expect(await test.run()).toBe(1);
    expect(rows(test.requests)).toEqual(["0", "2"]);
    expect(test.texts("status")).toContain("Import was canceled by user");
    expect(test.texts("status")).not.toContain("completed");
    expect(test.log()).toContain("Updating 'A' package to failed release status");
    expect(test.log()).not.toContain("'B'");
    expect(about(test.requests, "PackageDefinition").filter((wire) => wire.includes('action="add"'))).toHaveLength(1);
    const error = test.texts("error")[0] ?? "";
    expect(error).toContain("Import package 'A' failed with message:\n\nImport was canceled by user\nUpdating A to failed release status");
  });

  it("fails a package whose last item was sent while the cancel arrived (IMP-409, probe s09b)", async () => {
    let sent = 0;
    const test = harness({
      engine: "14.35",
      packages: { A: one("A"), B: one("B") },
      onMessage: (message, manager) => {
        // the last status message of the package is its `completed`; a cancel made then arrives after ImportProc returned
        if (message.channel === "status" && message.text === "completed" && ++sent === 1) manager.cancel();
      },
    });
    expect(await test.run()).toBe(1);
    expect(rows(test.requests)).toEqual(["0", "2"]);
    expect(test.log()).not.toContain("'B'");
  });

  it("still loses a cancel made before the call", async () => {
    const test = harness({ engine: "14.35", packages: { A: one("A") } });
    test.manager.cancel();
    expect(await test.run()).toBe(0);
    expect(test.texts("status")).toContain("Item 1 of 1: List - a");
  });

  it("keeps 14.0.7's text and its success for a cancel", async () => {
    let statuses = 0;
    const test = harness({
      packages: { A: two("A") },
      onMessage: (message, manager) => {
        if (message.channel === "status" && ++statuses === 3) manager.cancel();
      },
    });
    expect(await test.run()).toBe(0);
    expect(test.texts("status")).toContain("Adding PackageDefinintion for A");
  });
});

describe("14.35: the catalogue, the work item and os_user (IMP-422, IMP-452, IMP-470)", () => {
  it("lays 14.35's three changed templates over 14.0.7's catalogue", () => {
    const next = catalogueOf("14.35");
    const previous = catalogueOf("14.0.7");
    expect(next("AddingPackageDefinintionForPackageName", "A")).toBe("Adding PackageDefinition for A");
    expect(next("ErrorMessageMessage", "m")).toBe("\t\t****ErrorMessage****\r\nm");
    expect(next("ErrorMessageMessageEnd", "m")).toBe("\r\n\t\t****ErrorMessage****\r\nm\r\n\t\t********************");
    expect(previous("ErrorMessageMessage", "m")).toBe("          ****ErrorMessage****\r\n       m");
    for (const key of ["ImportPackageName", "Completed", "WarningTryToResolve", "NoSuchKey"]) expect(next(key, "x")).toBe(previous(key, "x"));
  });

  it("reads an item the way ImportProc did inline: doGetItem, the five attributes in order, and the removals", () => {
    const document = loadXml(
      "<Item type='List' tempFullName='C:\\p\\a.xml' action='add' id='L1' tempKeyName='Colors'><name>n</name></Item>",
      { preserveWhitespace: false },
    );
    const item = new ImportWorkItem(document, new SUImportContext(), "14.35");
    expect([item.action, item.id, item.workItemType, item.originalKeyedName, item.originalFullFileName]).toEqual([
      "add",
      "L1",
      "List",
      "Colors",
      "C:\\p\\a.xml",
    ]);
    expect(item.keyIdType).toBe("  id : L1    keyed_name : Colors    type : List  ");
    expect(item.thoroughCheck).toBe(true);
    expect(item.originalOuterXml).toBe('<Item type="List" action="add" id="L1" doGetItem="0"><name>n</name></Item>');
    expect(item.itemNode.hasAttribute("tempKeyName")).toBe(false);
    expect(new ImportWorkItem(loadXml("<Item type='List'/>", { preserveWhitespace: false }), new SUImportContext()).originalOuterXml).toBe("");
  });

  it("uses a single space for an empty part of the descriptor, and does not check a delete in full", () => {
    const document = loadXml("<Item action='delete' type='List'/>", { preserveWhitespace: false });
    const item = new ImportWorkItem(document, new SUImportContext());
    expect(item.keyIdType).toBe("    type : List  ");
    expect(item.thoroughCheck).toBe(false);
  });

  it("refuses a document without an Item with a null reference", () => {
    expect(() => new ImportWorkItem(loadXml("<AML/>", { preserveWhitespace: false }), new SUImportContext())).toThrow("Object reference");
  });

  it("writes Environment.UserName for 14.35 and the identity name for 14.0.7", () => {
    expect(defaultOsUser("linux", "14.35")).not.toContain("\\");
    expect(defaultOsUser("linux", "14.0.7")).toMatch(/^.+\\.+$/);
    expect(defaultOsUser("win32", "14.35")).toBe(defaultOsUser("linux", "14.35"));
  });
});

describe("IMP-420 to IMP-431: the items of a package", () => {
  it("shows the dots, a line end after every 60th, and the totals on the console (IMP-421)", async () => {
    const files: Record<string, string> = {};
    for (let n = 1; n <= 61; n += 1) files[`List/i${String(n).padStart(2, "0")}.xml`] = list(`L${n}`, `Name${n}`);
    const test = harness({ packages: { A: { files } } });
    expect(await test.run()).toBe(0);
    expect(test.console()).toBe(`       ****Import   A****\r\n\r\n${".".repeat(60)}\n.Delayed resolution of unresolved references ...\r\ncompleted\r\n`);
  });

  it("shows a line per item and the post actions when verbose (IMP-421, IMP-423)", async () => {
    const test = harness({
      packages: {
        A: {
          files: {
            "List/a.xml": list("L1", "Colors"),
            "Method/m.xml": '<AML><Item type="Method" id="M1" action="edit"><name>m</name></Item></AML>',
          },
        },
      },
      verbose: true,
    });
    await test.run();
    expect(test.console()).toBe(
      "       ****Import   A****\r\nBuilding  solution\r\nImporting a  type List   1  of  1\r\nPost actions\r\nDelayed resolution of unresolved references ...\r\ncompleted\r\n",
    );
    expect(test.texts("status")).toContain("Post actions");
    expect(test.log()).toContain("Processing (edit)   id : M1    keyed_name : m    type : Method  ");
  });

  it("describes an item with no id and no key by single spaces (IMP-422)", async () => {
    const test = harness({ packages: { A: { files: { "List/a.xml": '<AML><Item type="List" action="edit" where="name=\'x\'"><name>x</name></Item></AML>' } } } });
    await test.run();
    expect(test.log()).toContain("Processing (edit)    keyed_name : a    type : List  \r\n");
  });

  it("writes the merge banner to the console and the package log (IMP-421)", async () => {
    const test = harness({ packages: { A: { files: { "List/a.xml": list("L1", "Colors") } } }, merge: true });
    await test.run();
    expect(test.console().startsWith("       ****Import with merge option A****\r\n")).toBe(true);
    expect(test.log()).toContain("       ****Import with merge option A****\r\n");
  });

  it("skips an add that exists and still registers it (IMP-424, IMP-428)", async () => {
    const test = harness({
      packages: { A: { files: { "List/a.xml": list("L1", "Colors") } } },
      rules: [(wire) => (wire === '<Item type="List" action="get" select="id"><id>L1</id></Item>' ? stubResult('<Item type="List" id="L1" />') : undefined)],
    });
    expect(await test.run()).toBe(0);
    const log = test.log();
    expect(log).toContain("Item successfully skipped   id : L1    keyed_name : a    type : List  ");
    expect(log).not.toContain("Item successfully applied");
    expect(log).toContain("Item successfully added in packdefinition  id  L1 type List");
    expect(about(test.requests, "List").filter((wire) => wire.includes('action="add"'))).toEqual([]);
  });

  it("fails an add that names its target by where, in non-merge mode (IMP-424)", async () => {
    const test = harness({ packages: { A: { files: { "Method/m.xml": '<AML><Item type="Method" action="add" where="name=\'x\'"><name>x</name></Item></AML>' } } } });
    expect(await test.run()).toBe(1);
    expect(test.log()).toContain("Error - empty 'id' or 'type'");
    expect(test.log()).toContain("Updating 'A' package to failed release status");
  });

  it("deletes every SQL item of the package once, at the first SQL item that is not skipped (IMP-425)", async () => {
    const sql = (id: string) => `<AML><Item type="SQL" id="${id}" action="add"><name>${id}</name></Item></AML>`;
    const test = harness({ packages: { A: { files: { "SQL/a.xml": sql("Q1"), "SQL/b.xml": sql("Q2") } } } });
    expect(await test.run()).toBe(0);
    const log = test.log();
    expect(log.match(/##### Delete SQL Items of the package 'A' from the database #####/g)).toHaveLength(1);
    expect(log).toContain("##### Done deleting SQL Items of the package 'A' from the database #####");
    expect(test.requests.filter((wire) => wire.includes('action="delete"'))).toEqual([
      '<Item type="SQL" id="Q1" action="delete" />',
      '<Item type="SQL" id="Q2" action="delete" />',
    ]);
  });

  it("deletes a skipped SQL item and never adds it back (bug IMP-426)", async () => {
    const sql = (id: string) => `<AML><Item type="SQL" id="${id}" action="add"><name>${id}</name></Item></AML>`;
    const test = harness({
      packages: { A: { files: { "SQL/a.xml": sql("Q1"), "SQL/b.xml": sql("Q2") } } },
      rules: [(wire) => (wire === '<Item type="SQL" action="get" select="id"><id>Q1</id></Item>' ? stubResult('<Item type="SQL" id="Q1" />') : undefined)],
    });
    expect(await test.run()).toBe(0);
    expect(test.requests.filter((wire) => wire.includes('action="delete"'))).toHaveLength(2);
    expect(about(test.requests, "SQL").filter((wire) => wire.includes('action="add"'))).toHaveLength(1);
  });

  it("registers an item under the config id when its type is versionable (IMP-429)", async () => {
    const test = harness({
      packages: { A: { files: { "List/a.xml": list("L1", "Colors") } } },
      rules: [
        (wire) => (wire.includes('select="is_versionable"') ? stubResult('<Item type="ItemType"><is_versionable>1</is_versionable></Item>') : undefined),
        (wire) => (wire.includes('select="config_id"') ? stubResult('<Item type="List" id="L1"><config_id>CFG1</config_id></Item>') : undefined),
      ],
    });
    await test.run();
    expect(test.log()).toContain("Getting config_id  of versionable item  id  L1 type List");
    expect(test.log()).toContain("Item successfully added in packdefinition  id  CFG1 type List");
    expect(about(test.requests, "PackageElement").some((wire) => wire.includes("<element_id>CFG1</element_id>"))).toBe(true);
  });

  it("does not count or register Members and Server Events (IMP-431)", async () => {
    expect([isImportableType("Member"), isImportableType("Server Event"), isImportableType("member"), isImportableType("List")]).toEqual([false, false, true, true]);
    const test = harness({ packages: { A: { files: { "Member/m.xml": '<AML><Item type="Member" id="M1" action="add"><x>1</x></Item></AML>' } } } });
    expect(await test.run()).toBe(0);
    expect(test.texts("status")).toContain("Post actions");
    expect(test.log()).not.toContain("Adding item into PackageDefinition");
  });

  it("counts the importable adds (IMP-423)", () => {
    const items = getItemsFromPackageDom(
      loadXml(
        '<AML><Item type="List" action="add"/><Item type="List" action="edit"/><Item type="Member" action="add"/><Item type="Method" action="add"/><Item type="X" action="ADD"/></AML>',
        { preserveWhitespace: false },
      ),
    );
    expect(getImportableItemsCount(items)).toBe(2);
  });
});

describe("IMP-427: the retry of a delete", () => {
  const view = '<AML><Item type="View" id="V1" action="delete"><name>v</name></Item></AML>';
  const retryWarnings = (test: { texts: (channel: SentMessage["channel"]) => string[] }): string[] =>
    test.texts("warning").filter((text) => text.includes("Trying to resolve the error"));

  it("warns, checks fully and applies again, once (IMP-427)", async () => {
    let attempts = 0;
    const test = harness({
      packages: { A: { files: { "View/v.xml": view } } },
      rules: [
        (wire) => {
          if (!wire.includes('type="View"') || !wire.includes('action="delete"')) return undefined;
          attempts += 1;
          return attempts === 1 ? stubFault("1", "first") : undefined;
        },
      ],
    });
    expect(await test.run()).toBe(0);
    expect(attempts).toBe(2);
    const warning = retryWarnings(test)[0];
    expect(warning?.startsWith("          ****Warning! Import of an item failed. Trying to resolve the error... ****\r\n       ")).toBe(true);
    expect(warning).toContain("first");
  });

  it("fails the package when the second attempt fails (IMP-427)", async () => {
    const test = harness({ packages: { A: { files: { "View/v.xml": view } } }, rules: [faultOn('action="delete"', "1", "again")] });
    expect(await test.run()).toBe(1);
    expect(retryWarnings(test)).toHaveLength(1);
    expect(test.log()).toContain("again");
  });

  it("never retries an add (IMP-427)", async () => {
    const test = harness({
      packages: { A: { files: { "List/a.xml": list("L1", "Colors") } } },
      rules: [(wire) => (wire.includes('action="add" doGetItem="0"><name>Colors') ? stubFault("1", "no") : undefined)],
    });
    expect(await test.run()).toBe(1);
    expect(retryWarnings(test)).toEqual([]);
  });
});

describe("IMP-440 to IMP-445: the package definition", () => {
  const fixtureHelper = (rules: Rule[] = []) => {
    const connection = new StubConnection((wire) => {
      for (const rule of rules) {
        const answer = rule(wire);
        if (answer !== undefined) return answer;
      }
      return modelAnswer(wire);
    });
    return { helper: new CItemHelper(connection), requests: connection.requests };
  };

  it("finds the definition, or adds it when the lookup says there are none (IMP-440)", async () => {
    const { helper, requests } = fixtureHelper();
    const definition = await PackageDefinitionManager.open(helper, "P", true);
    expect(definition.id).toBe("PD-P");
    expect(requests).toEqual([
      '<Item type="PackageDefinition" select="id,name,generation" action="get"><name>P</name><is_current>1</is_current></Item>',
      '<Item type="PackageDefinition" action="add"><name>P</name></Item>',
    ]);
  });

  it("does not add on export, where the definition must exist (EXP-052)", async () => {
    const { helper } = fixtureHelper();
    await expect(PackageDefinitionManager.open(helper, "P")).rejects.toMatchObject({ faultcode: 0, faultdetail: expect.stringContaining(" Fails to init solution to PackageDefinition: P") });
  });

  it("adds the suffix to a fault of the add, and wraps another exception (IMP-440)", async () => {
    const { helper } = fixtureHelper([faultOn('action="add"', "7", "add refused")]);
    await expect(PackageDefinitionManager.open(helper, "P", true)).rejects.toMatchObject({
      faultcode: 7,
      faultdetail: expect.stringContaining("Fails to init solution to PackageDefinition: P"),
    });
    const malformed = fixtureHelper();
    await expect(PackageDefinitionManager.open(malformed.helper, "A&B", true)).rejects.toMatchObject({ faultcode: -1 });
  });

  it("records dependencies in table order, finds or adds them, and swallows a failed lookup (IMP-441, IMP-442)", async () => {
    const { helper, requests } = fixtureHelper([faultOn("<name>Broken</name>", "3", "lookup failed")]);
    const definition = await PackageDefinitionManager.open(helper, "P", true);
    const { NetfxHashtable } = await import("../manifest/netfx-hashtable.js");
    const { ExportItem } = await import("../export/export-item.js");
    const table = new NetfxHashtable<InstanceType<typeof ExportItem>[]>("test");
    table.add("Broken", [new ExportItem("k", "E1", "List")]);
    const warnings: string[] = [];
    await definition.addDependencyInfo(table, warnings);
    expect(requests.slice(2)).toEqual([
      '<Item type="PackageDependsOn" select="id" action="get"><name>Broken</name><source_id>PD-P</source_id></Item>',
      '<Item type="List" action="get" select="id"><id>E1</id></Item>',
    ]);
    expect(warnings).toEqual(["Item of type 'List' with id 'E1' is not added as a referenced element for package 'P' because the item was not found in the target database"]);
  });

  it("adds a referenced element when it is not found, looked up by the item's own id (IMP-443, IMP-444)", async () => {
    const { helper, requests } = fixtureHelper([
      (wire) => (wire === '<Item type="List" action="get" select="id"><id>E1</id></Item>' ? stubResult('<Item type="List" id="E1" />') : undefined),
      (wire) => (wire.includes('type="PackageDependsOn"') && wire.includes('action="add"') ? stubResult('<Item type="PackageDependsOn" id="DEP1" />') : undefined),
    ]);
    const definition = await PackageDefinitionManager.open(helper, "P", true);
    const { NetfxHashtable } = await import("../manifest/netfx-hashtable.js");
    const { ExportItem } = await import("../export/export-item.js");
    const table = new NetfxHashtable<InstanceType<typeof ExportItem>[]>("test");
    table.add("Dep", [new ExportItem("k", "E1", "List")]);
    await definition.addDependencyInfo(table, []);
    expect(requests.slice(2)).toEqual([
      '<Item type="PackageDependsOn" select="id" action="get"><name>Dep</name><source_id>PD-P</source_id></Item>',
      '<Item type="PackageDependsOn" action="add" doGetItem="0"><name>Dep</name><source_id>PD-P</source_id></Item>',
      '<Item type="List" action="get" select="id"><id>E1</id></Item>',
      '<Item type="PackageReferencedElement" action="get" select="id"><id>E1</id></Item>',
      '<Item type="PackageReferencedElement" action="add" doGetItem="0"><element_id>E1</element_id><element_type>List</element_type><element_description>k</element_description><source_id>DEP1</source_id></Item>',
    ]);
  });

  it("registers an element, escapes its values in the add, and reports an element already in the group (IMP-445)", async () => {
    const { helper, requests } = fixtureHelper();
    const definition = await PackageDefinitionManager.open(helper, "P", true);
    expect(await definition.addElement2Group('A&B<C "q" \'r\'', "List", "List", "E1")).toBe(true);
    expect(requests.at(-1)).toBe(
      '<Item type="PackageElement" action="add" doGetItem="0"><source_id>PG-List</source_id><element_id>E1</element_id><element_type>List</element_type><name>A&amp;B&lt;C "q" \'r\'</name></Item>',
    );
    const found = fixtureHelper([
      (wire) =>
        wire.includes('type="PackageElement"') && wire.includes('action="get"')
          ? stubResult('<Item type="PackageElement"><source_id>PG-List</source_id><element_type>List</element_type></Item>')
          : undefined,
    ]);
    const second = await PackageDefinitionManager.open(found.helper, "P", true);
    expect(await second.addElement2Group("k", "List", "List", "E1")).toBe(false);
  });

  it("fails with Duplicate package element when the element is in another group or of another type (IMP-445)", async () => {
    const { helper } = fixtureHelper([
      (wire) =>
        wire.includes('type="PackageElement"') && wire.includes('action="get"')
          ? stubResult('<Item type="PackageElement"><source_id>OTHER</source_id><element_type>Method</element_type></Item>')
          : undefined,
    ]);
    const definition = await PackageDefinitionManager.open(helper, "P", true);
    await expect(definition.addElement2Group("k", "List", "List", "E1")).rejects.toMatchObject({
      faultcode: -2,
      faultstring: "Duplicate package element",
      faultdetail:
        "The package 'P' already contains the PackageElement with name='k' and id='E1' but of different type: DB - type='Method', group_id='OTHER';   being imported - type='List', group_id='PG-List'",
    });
  });

  it("registers an add made by where with an empty id (bug IMP-430)", async () => {
    const { helper, requests } = fixtureHelper();
    const definition = await PackageDefinitionManager.open(helper, "P", true);
    await definition.addElement2Group("k", "Method", "Method", "");
    expect(requests.slice(-2)).toEqual([
      '<Item type="PackageElement" select="id, source_id, element_type" action="get"><element_id></element_id></Item>',
      '<Item type="PackageElement" action="add" doGetItem="0"><source_id>PG-Method</source_id><element_id></element_id><element_type>Method</element_type><name>k</name></Item>',
    ]);
  });
});

describe("IMP-446 to IMP-448: the lookups of the import helper", () => {
  const helperWith = (rules: Rule[] = []) => {
    const connection = new StubConnection((wire) => {
      for (const rule of rules) {
        const answer = rule(wire);
        if (answer !== undefined) return answer;
      }
      return modelAnswer(wire);
    });
    return { importer: new ImportHelper(new CItemHelper(connection), { osUser: "T\\u" }), requests: connection.requests };
  };

  it("looks a group up once per helper, whatever the answer was (IMP-446)", async () => {
    const { importer, requests } = helperWith();
    expect(await importer.getPackageGroupIdOrCreateIfNotExists("PD1", "List")).toBe("PG-List");
    expect(await importer.getPackageGroupIdOrCreateIfNotExists("PD1", "List")).toBe("PG-List");
    expect(requests).toEqual([
      '<Item type="PackageGroup" select="id" action="get"><name>List</name><source_id>PD1</source_id></Item>',
      '<Item type="PackageGroup" action="add" doGetItem="0"><name>List</name><source_id>PD1</source_id></Item>',
    ]);
  });

  it("treats null arguments as empty and an answer with no item as a wrapped failure (IMP-446)", async () => {
    const { importer, requests } = helperWith([(wire) => (wire.includes("PackageGroup") ? stubResult("") : undefined)]);
    await expect(importer.getPackageGroupIdOrCreateIfNotExists(null, null)).rejects.toMatchObject({
      faultcode: -1,
      faultdetail: "Object reference not set to an instance of an object. Can init group in PackageDefinition.",
    });
    expect(requests[0]).toBe('<Item type="PackageGroup" select="id" action="get"><name></name><source_id></source_id></Item>');
    const fault = helperWith([faultOn("PackageGroup", "4", "no")]);
    await expect(fault.importer.getPackageGroupIdOrCreateIfNotExists("P", "G")).rejects.toMatchObject({
      faultcode: 4,
      faultdetail: expect.stringMatching(/ Can init group in PackageDefinition\.$/),
    });
  });

  const labelAnswer = (inner: string): Rule => (wire) =>
    wire.includes('select="label"') ? `${I18N_ENVELOPE}<Item type="ItemType">${inner}</Item></Result></SOAP-ENV:Body></SOAP-ENV:Envelope>` : undefined;

  it("names the group after the English label, or the type when the label is not in the i18n shape (IMP-447)", async () => {
    expect(await helperWith([labelAnswer('<i18n:label xml:lang="en">Listen</i18n:label>')]).importer.getLabelOfItemType("List")).toBe("Listen");
    expect(await helperWith([labelAnswer('<label xml:lang="en">Listen</label>')]).importer.getLabelOfItemType("List")).toBe("List");
    expect(await helperWith([labelAnswer('<i18n:label xml:lang="de">Liste</i18n:label>')]).importer.getLabelOfItemType("List")).toBe("List");
    expect(await helperWith([labelAnswer('<i18n:label xml:lang="en" is_null="1" />')]).importer.getLabelOfItemType("List")).toBe("List");
  });

  it("caches the label by its request, and adds the suffix to every fault (IMP-447)", async () => {
    const { importer, requests } = helperWith();
    await importer.getLabelOfItemType("List");
    await importer.getLabelOfItemType("List");
    expect(requests).toEqual(["<Item action=\"get\" select=\"label\" type=\"ItemType\" language=\"en\"><name>List</name></Item>"]);
    const none = helperWith([faultOn("language", "0", "none")]);
    await expect(none.importer.getLabelOfItemType("List")).rejects.toMatchObject({
      faultcode: 0,
      faultdetail: expect.stringMatching(/ Unable to get label of List ItemType\.$/),
    });
    const empty = helperWith([(wire) => (wire.includes("language") ? stubResult("") : undefined)]);
    await expect(empty.importer.getLabelOfItemType("List")).rejects.toMatchObject({
      faultcode: -1,
      faultdetail: "Object reference not set to an instance of an object. Unable to get label of List ItemType.",
    });
  });

  it("reads a lock from locked_by_id, and lets a fault through as it is (IMP-448)", async () => {
    const locked = helperWith([(wire) => (wire.includes("locked_by_id") ? stubResult('<Item type="X"><locked_by_id>U1</locked_by_id></Item>') : undefined)]);
    expect(await locked.importer.islocked("I1", "X")).toBe(true);
    const free = helperWith([(wire) => (wire.includes("locked_by_id") ? stubResult('<Item type="X"><locked_by_id is_null="1" /></Item>') : undefined)]);
    expect(await free.importer.islocked("I1", "X")).toBe(false);
    const fault = helperWith([faultOn("locked_by_id", "0", "none")]);
    await expect(fault.importer.islocked("I1", "X")).rejects.toMatchObject({ faultcode: 0, faultdetail: "none" });
  });
});

describe("IMP-450 to IMP-453: the audit row", () => {
  const importerWith = (rules: Rule[] = [], osUser?: string | (() => string)) => {
    const connection = new StubConnection((wire) => {
      for (const rule of rules) {
        const answer = rule(wire);
        if (answer !== undefined) return answer;
      }
      return modelAnswer(wire);
    });
    return { importer: new ImportHelper(new CItemHelper(connection), osUser === undefined ? {} : { osUser }), requests: connection.requests };
  };
  const foundRow: Rule = (wire) =>
    wire.startsWith('<Item action="get" type="DatabaseUpgrade">') ? stubResult('<Item type="DatabaseUpgrade" id="DU1" />') : undefined;
  const unlockedRow: Rule = (wire) =>
    wire.includes("locked_by_id") ? stubResult('<Item type="DatabaseUpgrade"><locked_by_id is_null="1" /></Item>') : undefined;

  it("adds the row when it is absent, with is_latest by status (IMP-450, IMP-451)", async () => {
    const { importer, requests } = importerWith([], "T\\u");
    expect(await importer.writeReleaseData("P", 0, "R1", "D1")).toBe("DU-P");
    expect(requests).toEqual([
      '<Item action="get" type="DatabaseUpgrade"><target_release>R1</target_release><name>P</name><type>1</type></Item>',
      '<Item type="DatabaseUpgrade" action="add" doGetItem="0"><upgrade_status>0</upgrade_status><is_latest>0</is_latest><name>P</name><os_user>T\\u</os_user><description>D1</description><applied_on>__now()</applied_on><target_release>R1</target_release><type>1</type></Item>',
    ]);
    const negative = importerWith([], "T\\u");
    await negative.importer.writeReleaseData("P", -1, null, null);
    expect(negative.requests[1]).toBe(
      '<Item type="DatabaseUpgrade" action="add" doGetItem="0"><upgrade_status>-1</upgrade_status><name>P</name><os_user>T\\u</os_user><description></description><applied_on>__now()</applied_on><target_release></target_release><type>1</type></Item>',
    );
  });

  it("edits a row that exists, with os_user after applied_on, and clears the others above status 0 (IMP-450, IMP-451)", async () => {
    const { importer, requests } = importerWith([foundRow, unlockedRow], "T\\u");
    expect(await importer.writeReleaseData("P", 1, "R1", "D1")).toBe("DU1");
    expect(requests.slice(1)).toEqual([
      '<Item type="DatabaseUpgrade" action="get" levels="0" select="locked_by_id"><id>DU1</id></Item>',
      '<Item type="DatabaseUpgrade" id="DU1" action="edit" doGetItem="0"><upgrade_status>1</upgrade_status><is_latest>1</is_latest><name>P</name><description>D1</description><applied_on>__now()</applied_on><os_user>T\\u</os_user><target_release>R1</target_release><type>1</type></Item>',
      "<Item type=\"DatabaseUpgrade\" action=\"edit\" doGetItem=\"0\" where=\"type='1' and name='P' and not id='DU1'\">\t<is_latest>0</is_latest></Item>",
    ]);
    const start = importerWith([foundRow, unlockedRow], "T\\u");
    await start.importer.writeReleaseData("P", 0, "R1", "D1");
    expect(start.requests).toHaveLength(3);
  });

  it("unlocks a locked row first (IMP-451)", async () => {
    const { importer, requests } = importerWith([
      foundRow,
      (wire) => (wire.includes("locked_by_id") ? stubResult('<Item type="DatabaseUpgrade"><locked_by_id>U1</locked_by_id></Item>') : undefined),
    ]);
    await importer.writeReleaseData("P", 1, "R1", "D1");
    expect(requests[2]).toBe('<Item type="DatabaseUpgrade" id="DU1" action="unlock" doGetItem="0" />');
  });

  it("lets a fault through as it is, and a refused add keep its detail (IMP-451, bug IMP-453)", async () => {
    const refused = importerWith([faultOn('action="add"', "9", "add refused")]);
    await expect(refused.importer.writeReleaseData("P", 0, "R1", "D1")).rejects.toMatchObject({ faultcode: 9, faultdetail: "add refused" });
    const lookup = importerWith([faultOn('action="get" type="DatabaseUpgrade"', "9", "get refused")]);
    await expect(lookup.importer.writeReleaseData("P", 0, "R1", "D1")).rejects.toMatchObject({ faultcode: 9, faultdetail: "get refused" });
    const malformed = importerWith();
    await expect(malformed.importer.writeReleaseData("A&B", 0, "R1", "D1")).rejects.toThrow();
  });

  it("fails with a null reference when the answer names no row (IMP-450)", async () => {
    const { importer } = importerWith([(wire) => (wire.startsWith('<Item action="get" type="DatabaseUpgrade">') ? stubResult("") : undefined)]);
    await expect(importer.writeReleaseData("P", 0, "R1", "D1")).rejects.toThrow("Object reference not set to an instance of an object.");
  });

  it("reads os_user at each write, from the override or from the process (IMP-452)", async () => {
    let name = "first";
    const { importer, requests } = importerWith([], () => name);
    await importer.writeReleaseData("P", 0, "R", "D");
    name = "second";
    await importer.writeReleaseData("P", 0, "R", "D");
    expect(requests.filter((wire) => wire.includes("<os_user>")).map((wire) => /<os_user>([^<]*)</.exec(wire)?.[1])).toEqual(["first", "second"]);
    expect(defaultOsUser("linux")).toMatch(/^.+\\.+$/);
  });
});

describe("IMP-460 and IMP-461: DeleteSqlItems", () => {
  const nodes = (xml: string): XmlElement[] => selectNodes("/AML/Item", loadXml(`<AML>${xml}</AML>`, { preserveWhitespace: false })) as XmlElement[];
  const importerWith = (rules: Rule[] = []) => {
    const connection = new StubConnection((wire) => {
      for (const rule of rules) {
        const answer = rule(wire);
        if (answer !== undefined) return answer;
      }
      return modelAnswer(wire);
    });
    return { importer: new ImportHelper(new CItemHelper(connection)), requests: connection.requests };
  };

  it("deletes the SQL items by their attribute id, keeping the case of the type (IMP-460)", async () => {
    const { importer, requests } = importerWith();
    await importer.deleteSqlItems(nodes('<Item type="List" id="L"/><Item type="Sql" id="Q1"/><Item type="sql" id="Q2"/>'));
    expect(requests).toEqual(['<Item type="Sql" id="Q1" action="delete" />', '<Item type="sql" id="Q2" action="delete" />']);
  });

  it("deletes an item whose id is a child element as the empty id (bug IMP-461)", async () => {
    const { importer, requests } = importerWith();
    await importer.deleteSqlItems(nodes("<Item type=\"SQL\"><id>Q1</id></Item>"));
    expect(requests).toEqual(['<Item type="SQL" id="" action="delete" />']);
  });

  it("refuses an item with no type or no id, after the deletes before it (IMP-460)", async () => {
    const { importer, requests } = importerWith();
    await expect(importer.deleteSqlItems(nodes('<Item type="SQL" id="Q1"/><Item type="SQL"/>'))).rejects.toMatchObject({
      faultcode: -1,
      faultstring: "Item has no ID",
      faultdetail: 'The following item has no id and can\'t be deleted - <Item type="SQL" />',
    });
    expect(requests).toHaveLength(1);
    await expect(importer.deleteSqlItems(nodes('<Item id="Q1"/>'))).rejects.toMatchObject({
      faultstring: "Item has no type",
      faultdetail: 'The following item has no type - <Item id="Q1" />',
    });
    await expect(importer.deleteSqlItems(null)).rejects.toBeInstanceOf(ArgumentNullException);
  });

  it("stops at a fault of the delete, faultcode 0 included (IMP-460)", async () => {
    const { importer, requests } = importerWith([faultOn('action="delete"', "0", "none")]);
    await expect(importer.deleteSqlItems(nodes('<Item type="SQL" id="Q1"/><Item type="SQL" id="Q2"/>'))).rejects.toMatchObject({ faultcode: 0 });
    expect(requests).toHaveLength(1);
  });
});

describe("InvalidOperationException", () => {
  it("keeps the original as its inner exception (IMP-407)", () => {
    const inner = new Error("original");
    const wrapped = new InvalidOperationException("outer", inner);
    expect([wrapped.message, wrapped.innerException]).toEqual(["outer", inner]);
  });
});
