import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { StubConnection, stubFault, stubResult } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import { directoryExists } from "../io/windows-fs.js";
import { PathNotUsableError } from "../io/errors.js";
import { ManifestFile } from "../manifest/index.js";
import { loadXml, outerXml, selectSingleNode } from "../xml/index.js";
import type { XmlDocument, XmlElement } from "../xml/index.js";
import { CExportItems } from "./cexport-items.js";
import { SUExportContext } from "./export-context.js";
import { ImportExportManager } from "./import-export-manager.js";
import { mainFetchRequest } from "./main-fetch.js";
import { MESSAGE_TEMPLATES, MESSAGE_TEMPLATES_12_0, createMessagesFactory, messageFor, type SentMessage } from "./messages.js";
import { createOutputDir, writeItemFile } from "./output-folder.js";
import { CDATA_SECTION_ELEMENTS, CDATA_SECTION_ELEMENTS_12_0 } from "./output.js";
import { currentCultureDateTime } from "./run-log.js";
import { transformExport } from "./transform.js";

/**
 * The `[12.0]` variants of the export rules, one by one, on small inputs: what the recorded cases do not reach (they are replayed
 * in transcripts.test.ts, export-folders.test.ts and run-replay.test.ts) and the edges of what they do.
 */
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const temp = (): string => {
  const root = mkdtempSync(join(tmpdir(), "libsjs-12-"));
  roots.push(root);
  return root;
};

const SERVER = new ArasVersion(12, 0, 9, 24090, 0);

/** A 12.0 helper over a stub that answers each request with `respond(request)`, and the exporter around it. */
function over(respond: (request: string) => string | undefined = () => undefined) {
  const stub = new StubConnection(respond);
  const helper = new CItemHelper(stub, { engine: "12.0" });
  helper.innovatorVersion = SERVER;
  return { stub, helper, exporter: new CExportItems(helper), rewrites: new CExportItems(helper).rewrites };
}

const answer = (items: string): XmlDocument => loadXml(stubResult(items), { preserveWhitespace: true });
const result = (doc: XmlDocument): string => outerXml(selectSingleNode("//Result", doc) as XmlElement);
const noItems = stubFault("0", "No items found.");

describe("EXP-021, EXP-023: ac_PolicyAccessItemAttribute takes the default row", () => {
  const select = 'select="xp-*($value, @explicit, @permission_id), *[is_not_null()]"';

  it("sends the requested level and the default select in 12.0, and levels 2 with no select in 14.0.7", () => {
    expect(mainFetchRequest("ac_PolicyAccessItemAttribute", "ID", "3", SERVER, "12.0")).toBe(
      `<Item type="ac_PolicyAccessItemAttribute" action="get" levels="3" ${select}><id>ID</id></Item>`,
    );
    expect(mainFetchRequest("ac_PolicyAccessItemAttribute", "ID", "3", SERVER, "14.0.7")).toBe(
      '<Item type="ac_PolicyAccessItemAttribute" action="get" levels="2"><id>ID</id></Item>',
    );
  });

  it("keeps levels 2 for the other fixed types, and leaves the select out for a server below 11 SP12", () => {
    expect(mainFetchRequest("dr_RelationshipFamily", "ID", "3", SERVER, "12.0")).toBe('<Item type="dr_RelationshipFamily" action="get" levels="2"><id>ID</id></Item>');
    expect(mainFetchRequest("Part", "ID", "", new ArasVersion(10, 0, 0, 1, 0), "12.0")).toBe('<Item type="Part" action="get" levels="1"><id>ID</id></Item>');
    expect(mainFetchRequest("Part", "ID", "", new ArasVersion(11, 0, 11, 1, 0), "12.0")).toBe('<Item type="Part" action="get" levels="1"><id>ID</id></Item>');
    expect(mainFetchRequest("Part", "ID", "", new ArasVersion(11, 0, 12, 1, 0), "12.0")).toContain("select=");
  });
});

describe("EXP-116: the float item properties are followed through Relationships/Item only", () => {
  it("visits the relationship children, depth first, and not the items that properties hold", async () => {
    const asked: string[] = [];
    const { helper } = over((request) => {
      asked.push(/<name>([^<]*)<\/name><Relationships>/.exec(request)?.[1] ?? "");
      return stubResult('<Item type="ItemType" id="X"><Relationships/></Item>');
    });
    const doc = answer(
      '<Item type="Cmd"><Relationships><Item type="Rel"><holder><Item type="Held"/></holder><Relationships><Item type="Deep"/></Relationships></Item></Relationships><ref><Item type="Held2"/></ref></Item>',
    );
    await helper.references.processPropertiesOfTypeItem(selectSingleNode("//Item", doc) as XmlElement);
    expect(asked).toEqual(["Cmd", "Rel", "Deep"]);
  });

  it("stops for an item, and so for its whole subtree, when the lookup of its type is a faultcode 0", async () => {
    const asked: string[] = [];
    const { helper } = over((request) => {
      const type = /<name>([^<]*)<\/name><Relationships>/.exec(request)?.[1] ?? "";
      asked.push(type);
      return type === "Rel" ? noItems : stubResult('<Item type="ItemType" id="X"><Relationships/></Item>');
    });
    const doc = answer('<Item type="Cmd"><Relationships><Item type="Rel"><Relationships><Item type="Deep"/></Relationships></Item><Item type="Next"/></Relationships></Item>');
    await helper.references.processPropertiesOfTypeItem(selectSingleNode("//Item", doc) as XmlElement);
    expect(asked).toEqual(["Cmd", "Rel", "Next"]);
  });

  it("goes on after a faultcode 0 in 14.0.7", async () => {
    const asked: string[] = [];
    const stub = new StubConnection((request) => {
      const type = /<name>([^<]*)<\/name><Relationships>/.exec(request)?.[1] ?? "";
      asked.push(type);
      return type === "Rel" ? noItems : stubResult('<Item type="ItemType" id="X"><Relationships/></Item>');
    });
    const helper = new CItemHelper(stub);
    const doc = answer('<Item type="Cmd"><Relationships><Item type="Rel"><Relationships><Item type="Deep"/></Relationships></Item></Relationships></Item>');
    await helper.references.processPropertiesOfTypeItem(selectSingleNode("//Item", doc) as XmlElement);
    expect(asked).toEqual(["Cmd", "Rel", "Deep"]);
  });

  it("words a failed lookup without the closing quote (EXP-044)", async () => {
    const { helper } = over(() => stubFault("999", "boom"));
    const error = (await helper.lookups.getCustomFloatPropertiesOfTypeItem("Cmd").catch((e: unknown) => e)) as CItemException;
    expect(error.faultcode).toBe(-1);
    expect(error.message.endsWith("Failed to process properties of type 'Item' for ItemType 'Cmd")).toBe(true);
  });

  it("gives the text of a failed dependency-level lookup (EXP-043), which 14.0.7 loses", async () => {
    const bad = (engine: "12.0" | "14.0.7") => {
      const helper = new CItemHelper(new StubConnection(() => "<<not xml"), { engine });
      return helper.lookups.getDepencyLevel("T", 0).then(
        () => new Error("expected a failure"),
        (e: unknown) => e as CItemException,
      );
    };
    expect((await bad("12.0")).message).toMatch(/ Unable to get depency level for RelationshipType\.$/);
    expect((await bad("14.0.7")).message).not.toContain("Unable to get depency level");
  });
});

describe("EXP-117, EXP-118: the dr_Relationship routine of the 12.0 engine", () => {
  const family = (type: string) =>
    answer(`<Item type="${type}" id="FAM"><Relationships><Item type="dr_FamilyElement" id="E1"><dr_relationship_id keyed_name="k" type="dr_Relationship">DR1</dr_relationship_id></Item></Relationships></Item>`);
  const dr = (query: string) => stubResult(`<Item type="dr_Relationship" id="DR1"><name>n</name><implementation_query>${query}</implementation_query></Item>`);

  it("leaves implementation_query as the server sent it, even when it is not XML", async () => {
    for (const query of ["not xml", "", "&lt;a&gt;&lt;b/&gt;&lt;/a&gt;"]) {
      const { rewrites } = over(() => dr(query));
      const doc = family("dr_RelationshipFamily");
      await rewrites.includeDrRelationshipAsValue(doc);
      expect(result(doc)).toContain(`<implementation_query>${query}</implementation_query>`);
    }
  });

  it("runs no routine for an ac_PolicyAccessItemAttribute", async () => {
    const { stub, rewrites } = over(() => dr("x"));
    await rewrites.rewrite(family("ac_PolicyAccessItemAttribute"), "ac_PolicyAccessItemAttribute", false);
    expect(stub.requests.filter((request) => request.includes('type="dr_Relationship"'))).toEqual([]);
  });
});

describe("EXP-315, EXP-324, EXP-360, EXP-393: the three differences of 12.0's export.xsl", () => {
  const NS = 'xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"';
  const transform = (items: string, engine: "12.0" | "14.0.7"): string =>
    transformExport(
      loadXml(`<SOAP-ENV:Envelope ${NS}><SOAP-ENV:Body><Result>${items}</Result></SOAP-ENV:Body></SOAP-ENV:Envelope>`, { preserveWhitespace: true }),
      engine,
    ).replaceAll(` ${NS}`, "");

  it("keeps the pwd_is_set_on of a User (EXP-315)", () => {
    const user = '<Item type="User" id="U1"><login_name>a</login_name><pwd_is_set_on>2026-01-01</pwd_is_set_on></Item>';
    expect(transform(user, "12.0")).toContain("<pwd_is_set_on>2026-01-01</pwd_is_set_on>");
    expect(transform(user, "14.0.7")).not.toContain("pwd_is_set_on");
  });

  it("lists ten cdata-section-elements, without implementation_query and event_data (EXP-360)", () => {
    expect(CDATA_SECTION_ELEMENTS_12_0).toEqual([
      "html_code", "method_code", "sqlserver_body", "stylesheet", "query", "class_structure", "report_query", "xsl_stylesheet", "filter_xml", "condition_xml",
    ]);
    expect(CDATA_SECTION_ELEMENTS).toHaveLength(12);
    const item = '<Item type="dr_Relationship" id="D1"><implementation_query>a &lt; b</implementation_query><query>a &lt; b</query></Item>';
    expect(transform(item, "12.0")).toContain("<implementation_query>a &lt; b</implementation_query><query><![CDATA[a < b]]></query>");
    expect(transform(item, "14.0.7")).toContain("<implementation_query><![CDATA[a < b]]></implementation_query>");
  });

  const ccr = (name: string) =>
    '<Item type="ItemType" id="IT1"><name>Change Controlled Relationship</name><Relationships>' +
    `<Item type="Property" id="P1"><name>${name}</name><source_id keyed_name="Change Controlled Relationship" type="ItemType">SRC</source_id><label>x</label></Item></Relationships></Item>`;

  it("edits the system Properties of the Change Controlled Relationship by where, where 14.0.7 adds them (EXP-324)", () => {
    const edit = transform(ccr("related_id"), "12.0");
    expect(edit).toContain(`<Item type="Property" action="edit" where="source_id='SRC' and name='related_id'">`);
    expect(edit).not.toContain('<Item type="Property" id="P1"');
    expect(transform(ccr("related_id"), "14.0.7")).toContain('<Item type="Property" id="P1" action="add">');
  });

  it("edits a Property named like a run of system names the same way, with no id (EXP-393)", () => {
    const withContent = ccr("related_id|sort_order").replace("<label>x</label>", "<label>x</label><Relationships><Item type=\"Other\" id=\"O1\"/></Relationships>");
    expect(transform(withContent, "12.0")).toContain(`<Item type="Property" action="edit" where="source_id='SRC' and name='related_id|sort_order'">`);
    expect(transform(withContent, "14.0.7")).toContain(`<Item type="Property" id="P1" action="add"><name>related_id|sort_order</name>`);
  });
});

describe("EXP-400, EXP-421 to EXP-423: no path normalisation in 12.0", () => {
  it("makes a folder and writes an item file under a path of 300 characters or more", () => {
    const work = temp();
    const deep = `${work}\\${"d".repeat(120)}\\${"e".repeat(120)}\\${"f".repeat(60)}`;
    const folder = createOutputDir(deep, "com.example.pkg", { cwd: work }, "12.0");
    const doc = loadXml("<AML><Item/></AML>", { preserveWhitespace: true });
    const path = writeItemFile(folder, "List", "a.xml", doc, { cwd: work }, "12.0");
    expect(path.length).toBeGreaterThan(260);
    expect(readFileSync(join(work, ...path.slice(work.length + 1).split("\\"))).subarray(3).toString("utf8")).toContain("<Item />");
  });

  it("does not trim leading backslashes: a UNC folder is a share, which this host does not have", () => {
    expect(() => directoryExists("\\\\server\\share\\dir", { cwd: "/", platform: "linux", normalizePaths: false })).toThrow(PathNotUsableError);
    // 14.0.7 trims them and takes the path as relative to the current directory (EXP-422)
    expect(directoryExists("\\\\server\\share\\dir", { cwd: temp(), platform: "linux" })).toBe(false);
  });
});

describe("EXP-504 to EXP-520: the messages and the log of the 12.0 run", () => {
  it("has the literals of the 12.0 engine where the catalogue differs", () => {
    expect(messageFor("12.0", "ErrorMessageMessage", "boom")).toBe("          ****ErrorMessage****\r\n       boom\r\n          *******************");
    expect(messageFor("14.0.7", "ErrorMessageMessage", "boom")).toBe("          ****ErrorMessage****\r\n       boom");
    expect(messageFor("12.0", "ErrorMessageGetSolutions", "a", "b", "3")).toBe(
      "          ****ErrorMessage****\r\nfaultstring: a\r\nfaultdetail :b\r\nfaultcode: 3\r\n          *******************",
    );
    expect(messageFor("12.0", "ErrorOfExportingItemIdKeyedNameTypeLog", "I", "K", "T")).toBe("Error of exporting Item id :I  keyed_name : K type : T");
    expect(messageFor("12.0", "ErrorOfExportingItemIdKeyedNameType", "I", "K", "T")).toBe("Error of exporting Item id :I  keyed_name : K    type : T");
    const same = Object.keys(MESSAGE_TEMPLATES).filter((key) => MESSAGE_TEMPLATES[key] === MESSAGE_TEMPLATES_12_0[key]);
    expect(same.length).toBeGreaterThan(20);
  });

  it.each([
    ["en-IN", "19-10-2026 03:19:59"],
    ["en-US", "10/19/2026 3:19:59 AM"],
    ["en-GB", "19/10/2026 03:19:59"],
    ["fr_FR", "19/10/2026 03:19:59"],
    ["de-DE", "19.10.2026 03:19:59"],
    ["ja-JP", "10/19/2026 03:19:59"],
    ["", "10/19/2026 03:19:59"],
  ])("writes the general pattern of %s", (culture, text) => {
    expect(currentCultureDateTime(new Date(2026, 9, 19, 3, 19, 59), culture)).toBe(text);
  });

  it("formats the afternoon and midnight hours in the en-US pattern", () => {
    expect(currentCultureDateTime(new Date(2026, 0, 5, 15, 4, 9), "en-US")).toBe("1/5/2026 3:04:09 PM");
    expect(currentCultureDateTime(new Date(2026, 0, 5, 0, 4, 9), "en-US")).toBe("1/5/2026 12:04:09 AM");
  });

  /** An export of nothing, with the stub answering the definitions list; the helper never logged in (no server version). */
  async function exportWith(list: string, options: { cwd: string; logExists?: boolean } = { cwd: temp() }) {
    const working = options.cwd;
    const output = join(working, "out");
    mkdirSync(output, { recursive: true });
    const logPath = join(working, "engine.log");
    if (options.logExists) writeFileSync(logPath, "before\r\n");
    const context = new SUExportContext();
    Object.assign(context, { workingDirectory: output, logFilePath: logPath });
    const stub = new StubConnection((request) => (request.startsWith('<Item type="PackageDefinition" select="name,generation"') ? list : undefined));
    const helper = new CItemHelper(stub, { engine: "12.0" });
    const sent: SentMessage[] = [];
    const manager = new ImportExportManager(context, createMessagesFactory({ onMessage: (message) => void sent.push(message) }), helper, { cwd: working });
    await manager.exportSolutions(context, []);
    return { sent, log: readFileSync(logPath, "utf8"), manifest: readFileSync(join(output, "imports.mf"), "utf8") };
  }

  it("does not read the server version, writes no header, and saves the manifest", async () => {
    const run = await exportWith(stubResult(""));
    expect(run.log).toBe("");
    expect(run.manifest).toBe("<imports />");
    expect(run.sent.map((m) => m.channel)).toEqual(["currentPackage"]);
  });

  it("logs a failed list of package definitions before the log is opened, so the second writer succeeds (EXP-507, EXP-541)", async () => {
    const run = await exportWith(stubFault("5", "no way"));
    expect(run.sent.filter((m) => m.channel === "error").map((m) => m.text)).toEqual([
      expect.stringMatching(
        /^ {10}\*{4}ErrorMessage\*{4}\r\nfaultstring: <SOAP-ENV:Envelope[\s\S]*<\/SOAP-ENV:Envelope>\r\nfaultdetail :[\s\S]*Unable to get packages meta\.\r\nfaultcode: 5\r\n {10}\*{19}$/,
      ),
    ]);
    expect(run.log.endsWith("*******************\r\n")).toBe(true);
  });

  it("keeps the bytes of a log that exists and appends to it", async () => {
    const run = await exportWith(stubFault("5", "no way"), { cwd: temp(), logExists: true });
    expect(run.log.startsWith("before\r\n          ****ErrorMessage****")).toBe(true);
  });
});

describe("MAN-003, MAN-004, MAN-006: the manifest of the 12.0 engine", () => {
  it("reads the file with XmlDocument.Load: the declared encoding is honoured, invalid bytes throw", () => {
    const work = temp();
    const path = join(work, "m.mf");
    writeFileSync(path, Buffer.concat([Buffer.from('<?xml version="1.0" encoding="windows-1252"?><imports><package name="caf'), Buffer.from([0xe9]), Buffer.from('" path=".\\" /></imports>')]));
    expect(new ManifestFile(path, { engine: "12.0", cwd: work }).getAllPackageNames()).toEqual(["café"]);
    writeFileSync(path, Buffer.concat([Buffer.from('<imports><package name="caf'), Buffer.from([0xe9]), Buffer.from('" /></imports>')]));
    expect(() => new ManifestFile(path, { engine: "12.0", cwd: work })).toThrow("Invalid character in the given encoding. Line 1, position 28.");
    // 14.0.7 reads text and turns the byte into U+FFFD
    expect(new ManifestFile(path, { cwd: work }).getAllPackageNames()).toEqual(["caf�"]);
  });

  it("saves to the raw path", () => {
    const work = temp();
    const manifest = new ManifestFile(undefined, { engine: "12.0", cwd: work });
    manifest.addPackage("com.example.p");
    manifest.save(join(work, "x.mf"));
    expect(readFileSync(join(work, "x.mf"), "utf8")).toContain('<package name="com.example.p" path="p\\Import" />');
  });
});
