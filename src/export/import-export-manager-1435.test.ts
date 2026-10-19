import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
import { ImportExportManager, type SelectionInsertions } from "./import-export-manager.js";
import { OptionNotSupportedError, type SentMessage, checkOnItemError, createMessagesFactory } from "./messages.js";
import { AggregateException, parallelForEach } from "./parallel-for-each.js";
import { ProgressStreamLogger } from "./progress-logger.js";

/**
 * 14.35's `ExportSolutions` against the scripted runs of the engine (`oracle/export-output-probe/run-export.ps1`, recorded in
 * `fixtures/export-output/run-export-14.35.txt`): a scripted connection answers the package definitions, the lookups and the main
 * fetch of each item, with a body or a failure where the scenario says so. The engine ran the items of a package in parallel and the
 * port runs them one at a time, so what a run leaves is compared the way EXP-558 says, and only where the port's schedule decides
 * nothing the recording did not fix. The scenario names (`S1` to `S23`) are the probe's.
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

  async callAction(_action: string, request: string): Promise<ResponseDocument> {
    this.requests.push(request);
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
      return stubFault("0", "No items of type ItemType found.");
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
  packages: Array<[name: string, items: Array<[id: string, type: string]>]>;
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
  const manager = new ImportExportManager(context, createMessagesFactory({ engine: "14.35", onMessage: (message) => void sent.push(message) }), helper, { cwd: working });
  const selection: SelectionInsertions = scenario.packages.map(([name, items]) => [
    name,
    items.map(([id, type]) => [id, new ExportItem(`k-${id}`, id, type)] as const),
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
