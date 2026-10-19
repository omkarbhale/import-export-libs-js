import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DotNetException } from "../client/dotnet.js";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { StubConnection } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import { CExportItems, type ExportRunState } from "./cexport-items.js";
import { SUExportContext } from "./export-context.js";
import { ExportItem } from "./export-item.js";
import { ImportExportManager } from "./import-export-manager.js";
import { type ExportScript, escapeProbe, exportResponse } from "./language-probe.js";
import { type SentMessage, createMessagesFactory } from "./messages.js";
import { newRequestDictionary } from "./request-template.js";

/**
 * One item through the whole of `Export` (`E`) and whole `ExportSolutions` runs (`X`) in the language modes, against the offline probe
 * of 14.35 (`fixtures/export-language/probe-14.35.txt`, LP-140 to LP-151): the real `export.xsl`, the four language steps and the file
 * writer, with the probe's scripted answers.
 */
const PROBE = readFileSync(new URL("../../fixtures/export-language/probe-14.35.txt", import.meta.url), "utf8").split(/\r?\n/);

const ONLY = "ExportLanguageResourcesOnly";
const METADATA = "ExportMetadataWithLanguageResources";
const I18N = "http://www.aras.com/I18N";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** The lines of one probe case: from its `## id` header up to the next header or `--`. */
function section(id: string): string[] {
  const start = PROBE.findIndex((line) => line.startsWith(`## ${id} `));
  if (start < 0) throw new Error(`the probe has no case ${id}`);
  const lines: string[] = [];
  for (let at = start + 1; at < PROBE.length; at += 1) {
    const line = PROBE[at] as string;
    if (line === "--" || line.startsWith("## ") || line.startsWith("# ----")) break;
    lines.push(line);
  }
  return lines;
}

const i18nLabel = (lang: string, text: string, name = "label"): string => `<i18n:${name} xml:lang="${lang}" xmlns:i18n="${I18N}">${text}</i18n:${name}>`;

const helperOver = (connection: StubConnection, folder: string): CItemHelper => {
  const helper = new CItemHelper(connection, { engine: "14.35" });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 1, 0);
  helper.folder = folder;
  return helper;
};

/** Every file below a folder with its content as the probe prints it: `[BOM]"…"` for an item file, `"…"` for the manifest. */
function filesBelow(root: string, prefix = ""): Record<string, string> {
  const found: Record<string, string> = {};
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) Object.assign(found, filesBelow(root, `${relative}/`));
    else if (entry.name !== "engine.log") {
      const bytes = readFileSync(join(root, relative));
      const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      found[relative.replace(/\//g, "\\")] = `${bom ? "[BOM]" : ""}"${escapeProbe(bytes.subarray(bom ? 3 : 0).toString("utf8"))}"`;
    }
  }
  return found;
}

/** The files the probe printed for a case, by their path below the case's folder. */
function probeFiles(id: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const line of section(id)) {
    const file = new RegExp(`^file <WD>\\\\${id}\\\\(.*?): (\\[BOM\\]"|")(.*)$`).exec(line);
    if (file) found[file[1] as string] = `${file[2] === '"' ? '"' : '[BOM]"'}${file[3]}`;
  }
  return found;
}

// ------------------------------------------------------------------------------------------------------------------------------
// E

const listBody =
  `<label xml:lang="en">Colors</label>${i18nLabel("de", "Farben")}${i18nLabel("fr", "Couleurs")}<description is_null="1"/>` +
  `<Relationships><Item type="Value" id="V1"><value>red</value><label xml:lang="en">Red</label>${i18nLabel("de", "Rot")}</Item><Item type="Value" id="V2"><value>plain</value></Item></Relationships>`;
const listSetup: ExportScript = { rels: { List: ["Value"] }, related: { List: "" }, ml: { List: ["label"], Value: ["label"] } };
const itemTypeBody =
  `<Item type="ItemType" id="IT1" keyed_name="MyType"><id keyed_name="MyType" type="ItemType">IT1</id><name>MyType</name><is_versionable>0</is_versionable><label xml:lang="en">My Type</label>${i18nLabel("de", "Mein Typ")}<Relationships>` +
  `<Item type="Property" id="P1"><name>behavior</name><label xml:lang="en">Behavior</label>${i18nLabel("de", "Verhalten")}<data_type>list</data_type><data_source keyed_name="Behavior" type="List">L1</data_source><stored_length>64</stored_length><column_alignment>left</column_alignment><is_hidden>1</is_hidden><is_hidden2>1</is_hidden2><readonly>0</readonly><is_keyed>0</is_keyed></Item>` +
  `<Item type="Property" id="P2"><name>title</name><data_type>string</data_type><label xml:lang="en">Title</label>${i18nLabel("de", "Titel")}</Item>` +
  `<Item type="Property" id="P3"><name>plain_prop</name><data_type>string</data_type><label xml:lang="en">Plain</label></Item></Relationships></Item>`;
const itemTypeSetup: ExportScript = {
  polyNamesXml: '<Item type="ItemType" id="PT"><name>PolyT</name></Item>',
  ml: { ItemType: ["label", "label_plural"], Property: ["label", "help_tooltip", "default_value"] },
};

interface ExportCase {
  id: string;
  type: string;
  itemId: string;
  action: string;
  languages: string[] | null;
  script: ExportScript;
}

const exportCases: ExportCase[] = [
  { id: "E01-list-only", type: "List", itemId: "E01", action: ONLY, languages: ["de", "fr"], script: { ...listSetup, bodyById: { E01: listBody } } },
  { id: "E02-list-meta", type: "List", itemId: "E02", action: METADATA, languages: ["de", "fr"], script: { ...listSetup, bodyById: { E02: listBody } } },
  { id: "E03-list-plain", type: "List", itemId: "E03", action: "Export", languages: null, script: { ...listSetup, bodyById: { E03: listBody } } },
  {
    id: "E04-list-only-nothing-to-keep",
    type: "List",
    itemId: "E04",
    action: ONLY,
    languages: ["de"],
    script: { ...listSetup, bodyById: { E04: '<label is_null="1"/><description>plain</description><Relationships><Item type="Value" id="V1"><value>red</value></Item></Relationships>' } },
  },
  {
    id: "E05-list-only-en-only",
    type: "List",
    itemId: "E05",
    action: ONLY,
    languages: ["de"],
    script: { ...listSetup, bodyById: { E05: '<label xml:lang="en">Colors</label><description>plain</description>' } },
  },
  {
    id: "E06-list-meta-no-translations",
    type: "List",
    itemId: "E06",
    action: METADATA,
    languages: ["de"],
    script: { ...listSetup, bodyById: { E06: '<label xml:lang="en">Colors</label><description>plain</description>' } },
  },
  {
    id: "E07-list-only-no-ml-type",
    type: "List",
    itemId: "E07",
    action: ONLY,
    languages: ["de"],
    script: { rels: { List: ["Value"] }, related: { List: "" }, bodyById: { E07: '<label xml:lang="en">Colors</label>' } },
  },
  { id: "E08-itemtype-only", type: "ItemType", itemId: "IT1", action: ONLY, languages: ["de"], script: { ...itemTypeSetup, mainById: { IT1: itemTypeBody } } },
  { id: "E09-itemtype-meta", type: "ItemType", itemId: "IT1", action: METADATA, languages: ["de"], script: { ...itemTypeSetup, mainById: { IT1: itemTypeBody } } },
  { id: "E10-itemtype-plain", type: "ItemType", itemId: "IT1", action: "Export", languages: null, script: { ...itemTypeSetup, mainById: { IT1: itemTypeBody } } },
];

describe("one item through Export in the language modes (LP-140 to LP-145), against the probe's E cases", () => {
  it.each(exportCases)("$id", async ({ id, type, itemId, action, languages, script }) => {
    const wd = mkdtempSync(join(tmpdir(), "libsjs-lang-"));
    roots.push(wd);
    const stub = new StubConnection((request) => exportResponse(script, request));
    const run: ExportRunState = { requestDictionary: newRequestDictionary(), packageElementIdsByElementType: new Map(), action, languages };
    const written = await new CExportItems(helperOver(stub, wd), { cwd: wd }, run).export(new ExportItem(`k-${itemId}`, itemId, type), "1");

    expect(section(id)[0]).toBe("thrown: <none>");
    expect(filesBelow(wd)).toEqual(probeFiles(id));
    // the step that finds nothing to keep ends the export before the write (LP-140 step 4, LP-151)
    expect(written === null).toBe(section(id)[1] === "files: <none>");
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
// X

interface RunCase {
  id: string;
  action: string;
  languages: string[];
  packages: Array<[string, Array<[string, string]>]>;
  script: ExportScript;
}

const xBody = `<label xml:lang="en">Colors</label>${i18nLabel("de", "Farben")}`;
const xSetup: ExportScript = { rels: { List: ["Value"] }, related: { List: "" }, ml: { List: ["label"] }, bodyById: { A01: xBody, A03: xBody }, languageCodes: ["en", "de", "fr"] };
const xPackage: RunCase["packages"] = [["pkg.a", [["A01", "List"], ["A02", "List"], ["A03", "List"]]]];

const runCases: RunCase[] = [
  { id: "X01-only", action: ONLY, languages: ["en", "de"], packages: xPackage, script: xSetup },
  { id: "X02-meta", action: METADATA, languages: ["en", "de"], packages: xPackage, script: xSetup },
  { id: "X03-only-star", action: ONLY, languages: ["*"], packages: xPackage, script: xSetup },
  { id: "X05-only-en-only", action: ONLY, languages: ["en"], packages: xPackage, script: xSetup },
  {
    id: "X06-only-ml-lookup-fails",
    action: ONLY,
    languages: ["en", "de"],
    packages: xPackage,
    script: { rels: { List: ["Value"] }, related: { List: "" }, mlFaultCode: "1", languageCodes: ["en", "de", "fr"] },
  },
  {
    id: "X07-only-two-packages",
    action: ONLY,
    languages: ["en", "de"],
    packages: [
      ["pkg.a", [["A01", "List"]]],
      ["pkg.b", [["A03", "List"], ["B01", "List"]]],
    ],
    script: xSetup,
  },
];

const CLOCK = /\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d/g;

describe("whole ExportSolutions runs in the language modes (LP-100, LP-150, LP-151), against the probe's X cases", () => {
  it.each(runCases)("$id", async ({ id, action, languages, packages, script }) => {
    const wd = mkdtempSync(join(tmpdir(), "libsjs-lang-"));
    roots.push(wd);
    const solutionsXml = packages.map(([name]) => `<Item type="PackageDefinition" id="PD-${name}"><name>${name}</name><generation>1</generation></Item>`).join("");
    const stub = new StubConnection((request) => exportResponse({ ...script, solutionsXml }, request));
    const context = new SUExportContext();
    context.action = action;
    context.languages = [...languages];
    context.url = "http://stub/";
    context.dataBase = "db";
    context.userName = "u";
    context.workingDirectory = wd;
    context.logFilePath = join(wd, "engine.log");
    context.level = "1";
    context.refToUnknownPacks = "DoNotRemove";
    const sent: SentMessage[] = [];
    const manager = await ImportExportManager.create(context, createMessagesFactory({ engine: "14.35", onMessage: (message) => {
          sent.push(message);
        },
      }), helperOver(stub, wd), { cwd: wd });
    expect(`constructed; languages = ${context.languages.length}`).toBe(`constructed; languages = ${/\((\d+)\)$/.exec(section(id)[0] as string)?.[1]}`);

    const selection = packages.map(([name, items]) => [name, items.map(([itemId, type]) => [itemId, new ExportItem(`k-${itemId}`, itemId, type)] as const)] as const);
    await manager.exportSolutions(context, selection);

    const normalise = (text: string): string => text.replace(CLOCK, "<T>").split(wd).join(`<WD>\\${id}`).replace(/\\/g, "/");
    const lines = section(id);
    const expectedMessages = lines.slice(lines.indexOf("messages (without status lines, once each, sorted):") + 1, lines.indexOf("log (once each, sorted):")).map((line) => line.slice(2));
    const expectedLog = lines.slice(lines.indexOf("log (once each, sorted):") + 1).filter((line) => line.startsWith("  | ")).map((line) => normalise(line.slice(4)));

    const messages = sent
      .filter((message) => message.channel !== "status" || message.text === "completed")
      .map((message) => `${message.channel}|${escapeProbe(message.text).replace(/(Not a single item(\\r\\n)?)+/, "Not a single item")}`);
    expect(new Set(messages.map((line) => line.replace(/\\/g, "/")))).toEqual(new Set(expectedMessages.map((line) => line.replace(/\\/g, "/"))));

    const log = readFileSync(join(wd, "engine.log"), "utf8")
      .split(/\r?\n/)
      .filter((line) => line !== "")
      .map((line) => normalise(escapeProbe(line)));
    expect(new Set(log)).toEqual(new Set(expectedLog.filter((line) => line !== "")));

    const files = filesBelow(wd);
    const expectedFiles = probeFiles(id);
    expect(Object.keys(files).sort()).toEqual(Object.keys(expectedFiles).sort());
    for (const [path, content] of Object.entries(expectedFiles)) expect(files[path], path).toBe(content);
    const manifest = lines.find((line) => line.startsWith("imports.mf: ")) as string;
    expect(escapeProbe(readFileSync(join(wd, "imports.mf"), "utf8"))).toBe(manifest.slice("imports.mf: ".length));
  });
});

describe("errors that leave Export unwrapped (LP-182)", () => {
  it("lets the ml lookup's 'Not a single item' through as a System.Exception", async () => {
    const wd = mkdtempSync(join(tmpdir(), "libsjs-lang-"));
    roots.push(wd);
    mkdirSync(wd, { recursive: true });
    const stub = new StubConnection((request) => exportResponse({ rels: { List: ["Value"] }, related: { List: "" }, mlFaultCode: "1" }, request));
    const run: ExportRunState = { requestDictionary: newRequestDictionary(), packageElementIdsByElementType: new Map(), action: ONLY, languages: ["de"] };
    const failure = await new CExportItems(helperOver(stub, wd), { cwd: wd }, run).export(new ExportItem("k", "A01", "List"), "1").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DotNetException);
    expect(failure).not.toBeInstanceOf(CItemException);
    expect(existsSync(join(wd, "List"))).toBe(false);
  });
});
