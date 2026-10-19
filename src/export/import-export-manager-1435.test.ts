import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { CItemHelper } from "../client/item-helper.js";
import { childElements, innerText, parseXml, attributeOf } from "../client/mini-xml.js";
import { ArasVersion } from "../client/version.js";
import { IOException } from "../io/errors.js";
import { SUExportContext } from "./export-context.js";
import { ExportItem } from "./export-item.js";
import { ImportExportManager, type SelectionInsertions, defaultParallelism } from "./import-export-manager.js";
import { OptionNotSupportedError, type SentMessage, checkOnItemError, createMessagesFactory } from "./messages.js";
import { AggregateException, parallelForEach } from "./parallel-for-each.js";
import { ProgressStreamLogger } from "./progress-logger.js";

/**
 * 14.35's `ExportSolutions` against the scripted runs of the engine (`oracle/export-output-probe/run-export.ps1`, recorded in
 * `fixtures/export-output/run-export-14.35.txt`): a scripted connection answers the package definitions, the lookups and the main
 * fetch of each item, with a body or a failure where the scenario says so. The engine ran the items of a package in parallel. The
 * scenarios run the port one item at a time unless one says otherwise, so what a run leaves is compared the way EXP-558 says, and only
 * where the port's schedule decides nothing the recording did not fix; the last part of the file runs the port in parallel. The
 * scenario names (`S1` to `S23`) are the probe's.
 */
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** The envelope of the probe's `Stub.cs`, which declares `xmlns:i18n` as the server's does (EXP-410). */
const ENVELOPE = '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="http://www.aras.com/I18N"><SOAP-ENV:Body>';
const stubResult = (inner: string): string => `${ENVELOPE}<Result>${inner}</Result></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
const stubFault = (code: string, text: string): string =>
  `${ENVELOPE}<SOAP-ENV:Fault xmlns:af="http://www.aras.com/InnovatorFault"><faultcode>${code}</faultcode><faultstring><![CDATA[${text}]]></faultstring>` +
  `<detail><af:legacy_detail><![CDATA[${text}]]></af:legacy_detail></detail></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

/** `ScriptedConnection` of the probe's `Stub.cs`. */
class Scripted implements ServerConnection {
  solutionsXml: string | null = "";
  readonly referencedByPackage = new Map<string, string>();
  readonly failIds = new Set<string>();
  readonly throwIds = new Set<string>();
  readonly bodyById = new Map<string, string>();
  itemBody = "";
  defaultPermissionFailures = 0;
  private permissionCalls = 0;
  readonly requests: string[] = [];
  /** The names of the polymorphic ItemTypes the lookup answers; none by default (a "no items" fault). */
  polytypes: string[] = [];
  /** How long the answer to the poly-type request takes, and to the main fetch of an item. */
  polytypeDelayMs = 0;
  itemDelayMs = 0;
  /** The main fetches wait for this before they are answered, so a test releases the items of a wave together. */
  itemGate: Promise<void> | undefined;
  onItemWaiting: ((inFlight: number) => void) | undefined;
  /** The main fetches of items that are waiting for their answer now, and the most there were at once. */
  inFlight = 0;
  maxInFlight = 0;

  async callAction(_action: string, request: string): Promise<ResponseDocument> {
    this.requests.push(request);
    const root = parseXml(request).root;
    const isPolytypes = attributeOf(root, "type") === "ItemType" && childElements(root, "implementation_type").length > 0;
    const isItemFetch = childElements(root, "id").length > 0 && attributeOf(root, "action") === "get" && !["ItemType", "PackageElement"].includes(attributeOf(root, "type") ?? "");
    if (isItemFetch) {
      this.inFlight += 1;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      this.onItemWaiting?.(this.inFlight);
      if (this.itemGate) await this.itemGate;
      if (this.itemDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.itemDelayMs));
      this.inFlight -= 1;
    } else if (isPolytypes && this.polytypeDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.polytypeDelayMs));
    }
    return ResponseDocument.parse(this.answer(request));
  }

  private answer(request: string): string {
    const root = parseXml(request).root;
    const type = attributeOf(root, "type");
    const action = attributeOf(root, "action");
    const select = attributeOf(root, "select");
    const idNode = childElements(root, "id")[0];
    const nameNode = childElements(root, "name")[0];
    if (type === "PackageDefinition" && select === "name,generation") {
      return this.solutionsXml === null ? stubFault("0", "No items of type PackageDefinition found.") : stubResult(this.solutionsXml);
    }
    if (type === "PackageDefinition" && select === "id,name,generation" && nameNode) {
      const name = innerText(nameNode);
      return stubResult(`<Item type="PackageDefinition" id="PD-${name}"><id>PD-${name}</id><name>${name}</name><generation>1</generation></Item>`);
    }
    if (type === "PackageDependsOn") {
      const inner = this.referencedByPackage.get(nameNode ? innerText(nameNode) : "");
      return inner === undefined
        ? stubFault("0", "No items of type PackageDependsOn found.")
        : stubResult(`<Item type="PackageDependsOn" id="PDO"><Relationships>${inner}</Relationships></Item>`);
    }
    if (type === "ItemType" && select === "name" && childElements(root, "implementation_type").length > 0) {
      if (this.polytypes.length === 0) return stubFault("0", "No items of type ItemType found.");
      return stubResult(this.polytypes.map((name) => `<Item type="ItemType" id="PT-${name}"><name>${name}</name></Item>`).join(""));
    }
    if (type === "ItemType" && select === "id, is_relationship, use_src_access") {
      this.permissionCalls += 1;
      if (this.permissionCalls <= this.defaultPermissionFailures) return stubFault("1", "scripted permission lookup failure");
      return stubResult(
        '<Item type="ItemType" id="IT"><is_relationship>0</is_relationship><use_src_access>0</use_src_access><Relationships><Item type="Allowed Permission" id="AP"><related_id><Item type="Permission" id="PERM1"><id>PERM1</id></Item></related_id></Item></Relationships></Item>',
      );
    }
    if (type === "ItemType" && select === "is_versionable") return stubResult('<Item type="ItemType" id="IT"><is_versionable>0</is_versionable></Item>');
    if (type === "ItemType" && childElements(root, "Relationships").length > 0 && select === "id") return stubFault("0", "No items of type ItemType found.");
    if (type === "RelationshipType" && select === "name") return stubFault("0", "No items of type RelationshipType found.");
    if (idNode && action === "get" && type !== "ItemType" && type !== "PackageElement") {
      const id = innerText(idNode);
      if (this.throwIds.has(id)) throw new IOException(`scripted failure for ${id}`);
      if (this.failIds.has(id)) return stubFault("1", `scripted failure for ${id}`);
      return stubResult(
        `<Item type="${type}" id="${id}" keyed_name="k-${id}"><id keyed_name="k-${id}" type="${type}">${id}</id><name>n-${id}</name>${this.itemBody}${this.bodyById.get(id) ?? ""}</Item>`,
      );
    }
    return stubFault("0", `No items of type ${type} found.`);
  }
}

interface Scenario {
  packages: Array<[name: string, items: Array<[id: string, type: string, keyedName?: string]>]>;
  /** How many items the port has in flight; the scenarios of the probe run one at a time. */
  parallelism?: number;
  /** The host calls `Cancel()` when the status message with this number has been sent. */
  cancelAfterStatus?: number;
  setup?: (connection: Scripted) => void;
  referenced?: boolean;
  dependencies?: Record<string, string>;
  elements?: Array<[type: string, id: string]>;
  nullSolutions?: boolean;
  workingDirectorySuffix?: string;
}

const REFERENCED_ELEMENT =
  '<Item type="PackageReferencedElement" id="R1"><element_id>RF01</element_id><element_type>List</element_type><element_description>ref one</element_description></Item>';

const CLOCK = /\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d/g;

async function run(scenario: Scenario) {
  const working = mkdtempSync(join(tmpdir(), "libsjs-s1435-"));
  roots.push(working);
  const output = join(working, "output");
  mkdirSync(output);
  const logPath = join(working, "engine.log");
  const connection = new Scripted();
  if (scenario.nullSolutions) connection.solutionsXml = null;
  else {
    const first = scenario.packages[0]?.[0];
    connection.solutionsXml = scenario.packages
      .map(([name]) => {
        let inner = "";
        if (scenario.elements && name === first) {
          const elements = scenario.elements
            .map(([type, id]) => `<Item type="PackageElement"><element_type>${type}</element_type><element_id>${id}</element_id><name>x</name></Item>`)
            .join("");
          inner += `<Item type="PackageGroup"><name>g</name><Relationships>${elements}</Relationships></Item>`;
        }
        const dependency = scenario.dependencies?.[name];
        if (dependency !== undefined) inner += `<Item type="PackageDependsOn" id="DEP-${name}"><name>${dependency}</name></Item>`;
        return `<Item type="PackageDefinition" id="PD-${name}"><name>${name}</name><generation>1</generation>${inner === "" ? "" : `<Relationships>${inner}</Relationships>`}</Item>`;
      })
      .join("");
  }
  scenario.setup?.(connection);

  const helper = new CItemHelper(connection, { engine: "14.35" });
  helper.innovatorVersion = new ArasVersion(14, 0, 0, 1, 7);
  const context = new SUExportContext();
  context.url = "http://stub/";
  context.dataBase = "db";
  context.userName = "u";
  context.workingDirectory = output + (scenario.workingDirectorySuffix ?? "");
  context.logFilePath = logPath;
  context.level = "1";
  context.refToUnknownPacks = "DoNotRemove";
  context.exportReferencedItems = scenario.referenced ?? false;
  const sent: SentMessage[] = [];
  let statuses = 0;
  const manager: ImportExportManager = new ImportExportManager(
    context,
    createMessagesFactory({
      engine: "14.35",
      onMessage: (message) => {
        sent.push(message);
        if (message.channel === "status") statuses += 1;
        if (scenario.cancelAfterStatus !== undefined && message.channel === "status" && statuses === scenario.cancelAfterStatus) manager.cancel();
      },
    }),
    helper,
    { cwd: working, parallelism: scenario.parallelism ?? 1 },
  );
  const selection: SelectionInsertions = scenario.packages.map(([name, items]) => [
    name,
    items.map(([id, type, keyedName]) => [id, new ExportItem(keyedName ?? `k-${id}`, id, type)] as const),
  ]);
  const thrown = await manager.exportSolutions(context, selection).then(
    () => undefined,
    (error: unknown) => error,
  );
  const tree = (dir: string, prefix = ""): string[] =>
    readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? [`${prefix}${entry.name}/`, ...tree(dir, `${prefix}${entry.name}/`)] : [`${prefix}${entry.name}`],
    );
  const text = (relative: string): string | undefined => {
    const path = join(output, relative);
    return existsSync(path) ? readFileSync(path).subarray(3).toString("utf8") : undefined;
  };
  const log = readFileSync(logPath, "utf8").replace(CLOCK, "<T>");
  const body = log.slice(log.indexOf("\r\n\r\n") + 4);
  return {
    thrown,
    messages: sent.map((message) => `${message.channel}|${message.text}`),
    body,
    log,
    files: existsSync(output) ? tree(output) : [],
    manifest: existsSync(join(output, "imports.mf")) ? readFileSync(join(output, "imports.mf"), "utf8") : undefined,
    text,
    requests: connection.requests,
    maxInFlight: connection.maxInFlight,
    read: (relative: string) => (existsSync(join(output, relative)) ? readFileSync(join(output, relative)) : undefined),
  };
}

const MANIFEST_A = '<imports>\r\n  <package name="pkg.a" path="a\\Import" />\r\n</imports>';
const list = (prefix: string, count: number): Array<[string, string]> => Array.from({ length: count }, (_, i) => [`${prefix}${String(i + 1).padStart(2, "0")}`, "List"]);

/** The keyed names the status messages named, in the order they were sent. */
const itemOrder = (messages: string[]): string[] => messages.flatMap((message) => /^status\|Item \d+ of \d+: .* - (k-.*)$/.exec(message)?.[1] ?? []);
const successLine = (keyed: string): string => `Item id :${keyed.slice(2)}  keyed_name : ${keyed}   type : List successfully exported\r\n`;
const filesOf = (keyed: string[]): string[] => keyed.map((name) => `a/Import/List/${name}.xml`).sort();

describe("S1: a plain export of one package (EXP-513 to EXP-517, EXP-554)", () => {
  it("numbers the items, logs their success lines through the progress logger, and ends the package", async () => {
    const result = await run({ packages: [["pkg.a", list("A", 4)]] });
    expect(result.thrown).toBeUndefined();
    const order = itemOrder(result.messages);
    expect([...order].sort()).toEqual(["k-A01", "k-A02", "k-A03", "k-A04"]);
    expect(result.messages).toEqual([
      "currentPackage|Exporting package pkg.a",
      ...order.map((keyed, i) => `status|Item ${i + 1} of 4: List - ${keyed}`),
      "status|completed",
      "currentPackage|",
    ]);
    expect(result.body).toBe(`         ****Export pkg.a****\r\nstart of execution : <T>\r\n${order.map(successLine).join("")}end of execution : <T>\r\n`);
    expect(result.files.filter((file) => file.endsWith(".xml"))).toEqual(filesOf(order));
    expect(result.manifest).toBe(MANIFEST_A);
    expect(result.text("a/Import/List/k-A01.xml")).toBe(
      '<AML>\r\n <Item type="List" id="A01" action="add" xmlns:i18n="http://www.aras.com/I18N">\r\n  <name>n-A01</name>\r\n </Item>\r\n</AML>',
    );
  });
});

describe("S7: no package definitions (EXP-550)", () => {
  it.each([
    ["S7", [["pkg.a", list("A", 2)]] as Scenario["packages"]],
    ["S7b, an empty selection", [] as Scenario["packages"]],
  ])("%s: the warning, the exception, the header only in the log, and no manifest", async (_, packages) => {
    const result = await run({ packages, nullSolutions: true });
    expect(result.messages).toEqual(["warning|The database contains no package definitions. Please select another database and try again"]);
    expect(result.thrown).toMatchObject({ name: "ArgumentNullException", message: "Value cannot be null.\r\nParameter name: dom" });
    expect(result.log.endsWith("Export using import structure: False\r\n\r\n")).toBe(true);
    expect(result.files).toEqual([]);
    expect(result.manifest).toBeUndefined();
  });
});

describe("S3, S4: the first failed item stops the whole export, whatever the host answers (EXP-555, EXP-571)", () => {
  it("sends the error, the question and completed, logs the fault block, and exports nothing after it", async () => {
    const result = await run({ packages: [["pkg.a", list("A", 12)]], setup: (c) => c.failIds.add("A05") });
    expect(result.thrown).toBeUndefined();
    // the items start in table order; A05 is the one that fails, and no item after it starts
    const order = itemOrder(result.messages);
    const failing = order.indexOf("k-A05");
    expect(failing).toBe(order.length - 1);
    const exported = order.slice(0, failing);
    const statuses = result.messages.slice(1, 1 + order.length);
    expect(statuses).toEqual(order.map((keyed, i) => `status|Item ${i + 1} of 12: List - ${keyed}`));
    const rest = result.messages.slice(1 + order.length);
    expect(rest[0]).toBe("status|Error of exporting Item id :A05  keyed_name : k-A05    type : List");
    expect(rest[1]).toMatch(/^errorQuestion\|          \*\*\*\*ErrorMessage\*\*\*\*\r\nfaultstring: Server error\r\n\r\nRequest \(formatted\):\r\n<Item isNew="1" isTemp="1" type="List" action="get">\r\n  <id>A05<\/id>\r\n<\/Item>/);
    expect(rest[1]).toMatch(/\r\n\r\n {2}Abort current export of pkg\.a \?$/);
    expect(rest.slice(2)).toEqual(["status|completed", "currentPackage|"]);
    expect(result.body).toContain(
      `${exported.map(successLine).join("")}Error of exporting Item id :A05  keyed_name : k-A05    type : List\r\n      ******Error message******\r\nfaultstring: Server error\r\n\r\nRequest (formatted):\r\n`,
    );
    expect(result.body).toContain("faultdetail: scripted failure for A05\r\nfaultcode:   1\r\n     **********************\r\nend of execution : <T>\r\n");
    expect(result.files.filter((file) => file.endsWith(".xml"))).toEqual(filesOf(exported));
  });

  it("skips the packages after it, enters the referenced pass without exporting, and saves the manifest of what it visited (S5)", async () => {
    const result = await run({
      packages: [
        ["pkg.a", list("A", 3)],
        ["pkg.b", list("B", 3)],
        ["pkg.c", list("C", 6)],
      ],
      setup: (c) => {
        c.failIds.add("C02");
        c.referencedByPackage.set("dep.x", REFERENCED_ELEMENT);
      },
      referenced: true,
      dependencies: { "pkg.a": "dep.x", "pkg.b": "dep.x", "pkg.c": "dep.x" },
    });
    // pkg.c is first in table order, so the other two are never visited
    expect(result.messages[0]).toBe("currentPackage|Exporting package pkg.c");
    expect(result.messages.filter((message) => message.startsWith("currentPackage|Exporting package "))).toEqual(["currentPackage|Exporting package pkg.c"]);
    expect(result.messages.slice(-3)).toEqual(["currentPackage|Exporting referenced items from 'dep.x'", "status|Export was canceled by user", "currentPackage|"]);
    expect(result.body).toContain("         ****Export dep.x****\r\nstart of execution : <T>\r\nExport was canceled by user\r\nend of execution : <T>\r\n");
    expect(result.files).toContain("x/Import/");
    expect(result.files.some((file) => file.startsWith("x/Import/") && file.endsWith(".xml"))).toBe(false);
    expect(result.manifest).toBe(
      '<imports>\r\n  <package name="pkg.c" path="c\\Import">\r\n    <dependson name="dep.x">\r\n      <referenced_element id="RF01" type="List" descr="ref one" />\r\n    </dependson>\r\n  </package>\r\n</imports>',
    );
  });

  it("enters the referenced pass after a healthy package, and a failure there stops it (S13)", async () => {
    const result = await run({
      packages: [["pkg.a", list("A", 2)]],
      setup: (c) => {
        c.failIds.add("RF01");
        c.referencedByPackage.set("dep.x", REFERENCED_ELEMENT);
      },
      referenced: true,
      dependencies: { "pkg.a": "dep.x" },
    });
    expect(result.messages.filter((message) => !message.startsWith("errorQuestion|"))).toEqual([
      "currentPackage|Exporting package pkg.a",
      "status|Item 1 of 2: List - k-A01",
      "status|Item 2 of 2: List - k-A02",
      "status|completed",
      "currentPackage|Exporting referenced items from 'dep.x'",
      "status|Item 1 of 1: List - ref one",
      "status|Error of exporting Item id :RF01  keyed_name : ref one    type : List",
      "status|completed",
      "currentPackage|",
    ]);
    expect(result.manifest).toBe(
      '<imports>\r\n  <package name="pkg.a" path="a\\Import">\r\n    <dependson name="dep.x">\r\n      <referenced_element id="RF01" type="List" descr="ref one" />\r\n    </dependson>\r\n  </package>\r\n</imports>',
    );
  });
});

describe("S8, S15: an exception that is not a CItemException ends the run through the aggregate handler (EXP-556)", () => {
  it("S8: warns with the message, logs it, sends no completed and no empty currentPackage, and saves the manifest", async () => {
    const result = await run({ packages: [["pkg.a", list("A", 12)]], setup: (c) => c.throwIds.add("A04") });
    expect(result.thrown).toBeUndefined();
    expect(result.messages.slice(-1)).toEqual(["warning|\t\t****ErrorMessage****\r\nscripted failure for A04"]);
    expect(result.messages).not.toContain("status|completed");
    expect(result.body.endsWith("\t\t****ErrorMessage****\r\nscripted failure for A04\r\n")).toBe(true);
    expect(result.body).not.toContain("end of execution");
    expect(result.manifest).toBe(MANIFEST_A);
    // the items before it were exported, and their success lines were written when the logger was completed
    const order = itemOrder(result.messages);
    expect(order[order.length - 1]).toBe("k-A04");
    expect(result.body).toContain(`${order.slice(0, -1).map(successLine).join("")}\t\t****ErrorMessage****\r\nscripted failure for A04\r\n`);
  });

  it("S15: a type name Path.Combine refuses fails before any request (EXP-002, EXP-417)", async () => {
    const result = await run({
      packages: [
        [
          "pkg.a",
          [
            ["A01", "Li|st"],
            ["A02", "List"],
          ],
        ],
      ],
    });
    expect(result.messages.slice(-1)).toEqual(["warning|\t\t****ErrorMessage****\r\nIllegal characters in path."]);
    expect(result.requests.filter((request) => request.includes('type="Li|st"') || request.includes("Li|st"))).toEqual([]);
    expect(result.manifest).toBe(MANIFEST_A);
  });
});

describe("S17, S18: relationships that are package elements are not written (EXP-170)", () => {
  const body =
    '<Relationships><Item type="Value" id="V1"><label>one</label></Item><Item type="Value" id="V2"><label>two</label></Item><Item type="Other" id="V1"><label>other</label></Item></Relationships>';

  it("S17 leaves out Value V1, which a package lists", async () => {
    const result = await run({ packages: [["pkg.a", list("A", 1)]], setup: (c) => c.bodyById.set("A01", body), elements: [["Value", "V1"]] });
    expect(result.text("a/Import/List/k-A01.xml")).toBe(
      '<AML>\r\n <Item type="List" id="A01" action="add" xmlns:i18n="http://www.aras.com/I18N">\r\n  <name>n-A01</name>\r\n  <Relationships>\r\n   <Item type="Value" id="V2" action="add">\r\n    <label>two</label>\r\n   </Item>\r\n   <Item type="Other" id="V1" action="add">\r\n    <label>other</label>\r\n   </Item>\r\n  </Relationships>\r\n </Item>\r\n</AML>',
    );
  });

  it("S18 keeps the three relationships without the package element", async () => {
    const result = await run({ packages: [["pkg.a", list("A", 1)]], setup: (c) => c.bodyById.set("A01", body) });
    expect(result.text("a/Import/List/k-A01.xml")).toContain('<Item type="Value" id="V1" action="add">');
    expect(result.text("a/Import/List/k-A01.xml")).toContain('<Item type="Other" id="V1" action="add">');
  });
});

describe("S19: a working directory that ends in a backslash gives one separator (EXP-414, EXP-460)", () => {
  it("writes the same tree", async () => {
    const result = await run({ packages: [["pkg.a", list("A", 1)]], workingDirectorySuffix: "\\" });
    expect(result.files).toEqual(["a/", "a/Import/", "a/Import/List/", "a/Import/List/k-A01.xml", "imports.mf"]);
    expect(result.manifest).toBe(MANIFEST_A);
  });
});

describe("S23: a default-permission lookup that fails once is remembered for the run (EXP-045, EXP-064, EXP-403)", () => {
  it("drops the permission of every item of the type, not only of the first", async () => {
    const permission = '<permission_id keyed_name="p" type="Permission">PERMX</permission_id>';
    const result = await run({
      packages: [["pkg.a", list("A", 6)]],
      setup: (c) => {
        c.defaultPermissionFailures = 1;
        c.itemBody = permission;
      },
    });
    for (const id of ["A01", "A02", "A03", "A04", "A05", "A06"]) {
      expect(result.text(`a/Import/List/k-${id}.xml`), id).toBe(
        `<AML>\r\n <Item type="List" id="${id}" action="add" xmlns:i18n="http://www.aras.com/I18N">\r\n  <name>n-${id}</name>\r\n </Item>\r\n</AML>`,
      );
    }
    expect(result.requests.filter((request) => request.includes("use_src_access"))).toHaveLength(1);
  });
});

describe("--on-item-error has nothing to act on in 14.35 (EXP-571)", () => {
  it("is refused for 14.35 and accepted for 14.0.7", () => {
    expect(() => checkOnItemError("14.35", "continue")).toThrow(OptionNotSupportedError);
    expect(() => createMessagesFactory({ engine: "14.35", onItemError: "abort-package" })).toThrow("--on-item-error is not supported with engine 14.35");
    expect(() => checkOnItemError("14.35", undefined)).not.toThrow();
    expect(() => checkOnItemError("14.0.7", "abort-package")).not.toThrow();
  });
});

describe("the progress logger (EXP-554, EXP-570)", () => {
  const sink = () => {
    const lines: string[] = [];
    return { lines, writeLine: (text: string) => void lines.push(text) };
  };

  it("writes queued lines in order when it runs, and the rest when it is completed", async () => {
    const out = sink();
    const logger = new ProgressStreamLogger(out);
    logger.start();
    logger.writeLine("a");
    logger.writeLine("b");
    await Promise.resolve();
    expect(out.lines).toEqual(["a", "b"]);
    logger.writeLine("c");
    logger.complete();
    expect(out.lines).toEqual(["a", "b", "c"]);
  });

  it("loses a line queued after it was completed", async () => {
    const out = sink();
    const logger = new ProgressStreamLogger(out);
    logger.start();
    logger.complete();
    logger.writeLine("late");
    logger.complete();
    logger.dispose();
    await Promise.resolve();
    expect(out.lines).toEqual([]);
  });

  it("does nothing when completed without a task; a task that is started later takes the queue", async () => {
    const out = sink();
    const logger = new ProgressStreamLogger(out);
    logger.writeLine("early");
    logger.complete();
    expect(out.lines).toEqual([]);
    logger.start();
    await Promise.resolve();
    expect(out.lines).toEqual(["early"]);
  });
});

describe("Parallel.ForEach (EXP-551, EXP-556)", () => {
  it("runs the items in order, one at a time with a bound of 1", async () => {
    const seen: number[] = [];
    await parallelForEach([1, 2, 3], 1, async (item) => {
      seen.push(item);
      await Promise.resolve();
    });
    expect(seen).toEqual([1, 2, 3]);
  });

  it("starts no item after stop, and none after an exception, and reports the exceptions as one aggregate", async () => {
    const seen: number[] = [];
    await parallelForEach([1, 2, 3], 1, async (item, loop) => {
      seen.push(item);
      loop.stop();
    });
    expect(seen).toEqual([1]);

    const failure = await parallelForEach([1, 2, 3], 1, async (item) => {
      seen.push(item + 10);
      throw new Error(`boom ${item}`);
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(seen).toEqual([1, 11]);
    expect(failure).toBeInstanceOf(AggregateException);
    expect((failure as AggregateException).innerExceptions.map((error) => (error as Error).message)).toEqual(["boom 1"]);
  });
});

describe("the parallel export (EXP-551 to EXP-558)", () => {
  /** A gate that opens when `waiting` item fetches are waiting on it: the whole first wave of the loop is in flight by then. */
  const wave = (waiting: number) => (connection: Scripted) => {
    let open: () => void = () => undefined;
    connection.itemGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    connection.onItemWaiting = (inFlight) => {
      if (inFlight >= waiting) open();
    };
  };
  /** The ids of the first `count` items of `list("A", total)` in the engine's table order, which is the order a worker takes them in. */
  const tableOrder = async (total: number, count: number): Promise<string[]> => {
    const result = await run({ packages: [["pkg.a", list("A", total)]], parallelism: 1 });
    return itemOrder(result.messages)
      .slice(0, count)
      .map((keyed) => keyed.slice(2));
  };
  const absent = (requests: string[], ids: string[]): boolean => ids.every((id) => !requests.some((request) => request.includes(`<id>${id}</id>`)));
  const bodyLines = (body: string): string[] => body.split("\r\n").filter((line) => line !== "");
  const successes = (body: string): string[] => bodyLines(body).filter((line) => line.endsWith("successfully exported")).sort();
  const noNumber = (message: string): string => message.replace(/^status\|Item \d+ of/, "status|Item _ of");

  it("has at most `parallelism` items in flight, and writes the files, the manifest and the success lines a one-at-a-time run writes", async () => {
    const setup = (connection: Scripted): void => void (connection.itemDelayMs = 20);
    const sequential = await run({ packages: [["pkg.a", list("A", 10)]], parallelism: 1, setup });
    const parallel = await run({ packages: [["pkg.a", list("A", 10)]], parallelism: 4, setup });
    expect(sequential.maxInFlight).toBe(1);
    expect(parallel.maxInFlight).toBe(4);
    expect(parallel.thrown).toBeUndefined();
    // the files: the same names, the same bytes
    expect(parallel.files).toEqual(sequential.files);
    for (const file of sequential.files.filter((name) => name.endsWith(".xml"))) {
      expect(parallel.read(file)?.equals(sequential.read(file) as Buffer), file).toBe(true);
    }
    expect(parallel.manifest).toBe(sequential.manifest);
    // the log and the messages agree as sets: the success lines, the status texts without their numbers, and the rest in order
    expect(successes(parallel.body)).toEqual(successes(sequential.body));
    expect(successes(parallel.body)).toHaveLength(10);
    expect(bodyLines(parallel.body).filter((line) => !line.endsWith("successfully exported"))).toEqual(
      bodyLines(sequential.body).filter((line) => !line.endsWith("successfully exported")),
    );
    const statusOf = (messages: string[]): string[] => messages.filter((message) => message.startsWith("status|Item")).map(noNumber).sort();
    expect(statusOf(parallel.messages)).toEqual(statusOf(sequential.messages));
    expect(parallel.messages.filter((message) => !message.startsWith("status|Item"))).toEqual(
      sequential.messages.filter((message) => !message.startsWith("status|Item")),
    );
  });

  it("starts the items in table order and gives items that start together one number (EXP-552)", async () => {
    const order = await tableOrder(8, 8);
    const result = await run({ packages: [["pkg.a", list("A", 8)]], parallelism: 4, setup: wave(4) });
    const statuses = result.messages.filter((message) => message.startsWith("status|Item"));
    expect(statuses).toHaveLength(8);
    expect(statuses.slice(0, 4)).toEqual(order.slice(0, 4).map((id) => `status|Item 1 of 8: List - k-${id}`));
    // the later items start as the first ones end: their numbers are 1 + the items done by then, never more than the items before them
    statuses.forEach((status, at) => expect(Number(/Item (\d+) of/.exec(status)?.[1]), status).toBeLessThanOrEqual(at + 1));
    expect(itemOrder(result.messages)).toEqual(order.map((id) => `k-${id}`));
    expect(result.files.filter((file) => file.endsWith(".xml"))).toHaveLength(8);
  });

  it("is bound by the processor count when no bound is given, and refuses a bound that is not an integer of 1 or more", () => {
    const helper = (engine: "14.0.7" | "14.35") => new CItemHelper(new Scripted(), { engine });
    const messages = (engine: "14.0.7" | "14.35") => createMessagesFactory({ engine });
    expect(defaultParallelism()).toBe(availableParallelism());
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new ImportExportManager(new SUExportContext(), messages("14.35"), helper("14.35"), { parallelism: bad }), String(bad)).toThrow(RangeError);
    }
    expect(() => new ImportExportManager(new SUExportContext(), messages("14.35"), helper("14.35"), { parallelism: 3 })).not.toThrow();
    expect(() => new ImportExportManager(new SUExportContext(), messages("14.0.7"), helper("14.0.7"), { parallelism: 3 })).toThrow(OptionNotSupportedError);
    expect(() => new ImportExportManager(new SUExportContext(), messages("14.0.7"), helper("14.0.7"))).not.toThrow();
  });

  it("reports one failure when items fail together, starts no item after it, and lets the running items write their files (EXP-555, EXP-570, EXP-572)", async () => {
    const wave4 = await tableOrder(12, 4);
    const [ok1, bad1, bad2, ok2] = wave4 as [string, string, string, string];
    const result = await run({
      packages: [["pkg.a", list("A", 12)]],
      parallelism: 4,
      setup: (c) => (wave(4)(c), c.failIds.add(bad1), c.failIds.add(bad2)),
    });
    expect(result.thrown).toBeUndefined();
    expect(result.messages.filter((message) => message.startsWith("errorQuestion|"))).toHaveLength(1);
    const reported = result.messages.filter((message) => message.startsWith("status|Error of exporting"));
    expect(reported).toHaveLength(1);
    expect([bad1, bad2].map((id) => `status|Error of exporting Item id :${id}  keyed_name : k-${id}    type : List`)).toContain(reported[0]);
    expect(result.messages.filter((message) => message === "status|completed")).toHaveLength(1);
    expect(result.messages.slice(-2)).toEqual(["status|completed", "currentPackage|"]);
    expect(bodyLines(result.body).filter((line) => line.startsWith("Error of exporting Item id"))).toEqual([reported[0]?.slice("status|".length)]);
    expect(result.body.match(/end of execution/g)).toHaveLength(1);
    // the items that had not started never did; the two that were running wrote their files; the failed ones wrote none
    expect(absent(result.requests, (await tableOrder(12, 12)).slice(4))).toBe(true);
    expect(result.files.filter((file) => file.endsWith(".xml"))).toEqual(filesOf([ok1, ok2].map((id) => `k-${id}`)));
    // their success lines were queued after the logger was completed and are lost
    expect(successes(result.body)).toEqual([]);
    expect(result.manifest).toBe(MANIFEST_A);
  });

  it("reports every exception that escaped the workers, and skips the rest (EXP-556)", async () => {
    const [ok1, bad1, bad2, ok2] = (await tableOrder(12, 4)) as [string, string, string, string];
    const result = await run({
      packages: [["pkg.a", list("A", 12)]],
      parallelism: 4,
      setup: (c) => (wave(4)(c), c.throwIds.add(bad1), c.throwIds.add(bad2)),
    });
    expect(result.thrown).toBeUndefined();
    const warning = result.messages.slice(-1)[0] ?? "";
    // the order is the order in which the exceptions were recorded, which depends on when the workers reached their requests
    expect(warning.split("\r\n").slice(1).sort()).toEqual([`scripted failure for ${bad1}`, `scripted failure for ${bad2}`].sort());
    expect(warning.startsWith("warning|\t\t****ErrorMessage****\r\n")).toBe(true);
    expect(result.messages).not.toContain("status|completed");
    expect(result.body).not.toContain("end of execution");
    expect(absent(result.requests, (await tableOrder(12, 12)).slice(4))).toBe(true);
    // the running items that did not fail wrote their files
    expect(result.files.filter((file) => file.endsWith(".xml"))).toEqual(filesOf([ok1, ok2].map((id) => `k-${id}`)));
    expect(result.manifest).toBe(MANIFEST_A);
  });

  it("writes the cancel pair once and starts no item after the flag is seen (EXP-557)", async () => {
    const order = await tableOrder(12, 12);
    const result = await run({ packages: [["pkg.a", list("A", 12)]], parallelism: 4, setup: wave(4), cancelAfterStatus: 4 });
    expect(result.thrown).toBeUndefined();
    expect(result.messages.filter((message) => message === "status|Export was canceled by user")).toHaveLength(1);
    expect(result.messages).not.toContain("status|completed");
    expect(result.body.match(/Export was canceled by user\r\nend of execution/g)).toHaveLength(1);
    expect(absent(result.requests, order.slice(4))).toBe(true);
    // the four that were running went on to write their files
    expect(result.files.filter((file) => file.endsWith(".xml"))).toEqual(filesOf(order.slice(0, 4).map((id) => `k-${id}`)));
    expect(result.messages.slice(-1)).toEqual(["currentPackage|"]);
  });

  describe("two workers that write one file (EXP-419)", () => {
    const duplicates: Scenario["packages"] = [
      [
        "pkg.a",
        [
          ["A01", "List", "dup"],
          ["A02", "List", "dup"],
        ],
      ],
    ];

    it("fail one of them with a sharing violation when their writes overlap, which ends the run through the aggregate handler", async () => {
      const result = await run({ packages: duplicates, parallelism: 2, setup: wave(2) });
      expect(result.thrown).toBeUndefined();
      expect(result.messages.slice(-1)).toEqual([expect.stringMatching(/^warning\|\t\t\*\*\*\*ErrorMessage\*\*\*\*\r\nThe process cannot access the file '.*dup\.xml' because it is being used by another process\.$/)]);
      expect(result.messages).not.toContain("status|completed");
      expect(result.files.filter((file) => file.endsWith(".xml"))).toEqual(["a/Import/List/dup.xml"]);
      expect(result.manifest).toBe(MANIFEST_A);
    });

    it("keep the later one's content when their writes do not overlap", async () => {
      const result = await run({ packages: duplicates, parallelism: 1 });
      expect(result.thrown).toBeUndefined();
      expect(result.messages).toContain("status|completed");
      expect(result.files.filter((file) => file.endsWith(".xml"))).toEqual(["a/Import/List/dup.xml"]);
      expect(result.text("a/Import/List/dup.xml")).toContain("n-A02");
    });
  });

  describe("the poly-type names race (EXP-408, EXP-461)", () => {
    const property = '<Relationships><Item type="Property" id="P1"><data_type>list</data_type><data_source keyed_name="PolyT" type="List">L1</data_source></Item></Relationships>';
    const setup = (connection: Scripted): void => {
      connection.polytypes = ["PolyT"];
      connection.polytypeDelayMs = 150;
      connection.itemBody = property;
    };
    const converted = (result: Awaited<ReturnType<typeof run>>): string[] =>
      result.files.filter((file) => file.endsWith(".xml") && (result.text(file) ?? "").includes('<data_source keyed_name="PolyT">'));

    it("exports the items that reach the step while the names are fetched with the reference as it is", async () => {
      const result = await run({ packages: [["pkg.a", list("A", 8)]], parallelism: 4, setup });
      expect(result.thrown).toBeUndefined();
      expect(result.files.filter((file) => file.endsWith(".xml"))).toHaveLength(8);
      // the worker that made the request waits for the names and converts; the others go on with the empty list
      expect(converted(result)).toHaveLength(1);
      const plain = result.files.filter((file) => file.endsWith(".xml") && (result.text(file) ?? "").includes('<data_source keyed_name="PolyT" type="List">L1</data_source>'));
      expect(plain).toHaveLength(7);
    });

    it("converts every item when one worker runs them one after the other", async () => {
      const result = await run({ packages: [["pkg.a", list("A", 8)]], parallelism: 1, setup });
      expect(converted(result)).toHaveLength(8);
    });
  });
});
