import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DotNetException } from "../client/dotnet.js";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { attributeOf, childElements, parseXml } from "../client/mini-xml.js";
import { StubConnection, StubStop, stubResult } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import { ArgumentNullException } from "../io/errors.js";
import { CExportItems, type ExportRunState } from "./cexport-items.js";
import { SUExportContext } from "./export-context.js";
import { ExportItem } from "./export-item.js";
import { ImportExportManager } from "./import-export-manager.js";
import { type LangScript, escapeProbe, langResponse } from "./language-probe.js";
import { createMessagesFactory } from "./messages.js";
import { newRequestDictionary } from "./request-template.js";

/**
 * The constructor's language work (`C`) and the requests of `Export` (`R`) of the offline probe of 14.35 (`fixtures/export-language/
 * probe-14.35.txt`, LP-100 to LP-127): the port is run against the probe's scripts and its requests and exceptions are compared with
 * the engine's, line for line.
 */
const PROBE = readFileSync(new URL("../../fixtures/export-language/probe-14.35.txt", import.meta.url), "utf8").split(/\r?\n/);

/** The lines of one probe case: from its `## id` header up to the next header or `--`. */
function section(id: string): string[] {
  const start = PROBE.findIndex((line) => line.startsWith(`## ${id} `) || line === `## ${id}`);
  if (start < 0) throw new Error(`the probe has no case ${id}`);
  const lines = [PROBE[start] as string];
  for (let at = start + 1; at < PROBE.length; at += 1) {
    const line = PROBE[at] as string;
    if (line === "--" || line.startsWith("## ") || line.startsWith("# ----")) break;
    lines.push(line);
  }
  return lines;
}

const helperOver = (connection: StubConnection): CItemHelper => {
  const helper = new CItemHelper(connection, { engine: "14.35" });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 1, 0);
  helper.folder = "C:\\probe-out";
  return helper;
};

/** The probe's name for an exception: the full .NET type name. */
function describe_(error: unknown): string {
  const inner = error instanceof CItemException && error.cause ? error.cause : error;
  if (inner instanceof ArgumentNullException) return `System.ArgumentNullException: ${escapeProbe(inner.message)}`;
  if (inner instanceof CItemException) return `Aras.Tools.SolutionUpgrade.CItemException: ${escapeProbe(inner.message)}`;
  if (inner instanceof DotNetException) return `${inner.typeName}: ${escapeProbe(inner.message)}`;
  throw inner;
}

const showLanguages = (languages: readonly string[] | null): string =>
  languages === null ? "<null>" : `[${languages.map((language) => `"${language}"`).join(",")}] (${languages.length})`;

const ONLY = "ExportLanguageResourcesOnly";
const METADATA = "ExportMetadataWithLanguageResources";
const SERVER_DE_FR = { languageCodes: ["en", "de", "fr"] };
const SERVER_DE = { languageCodes: ["en", "de"] };
const SERVER_EN = { languageCodes: ["en"] };

interface ConstructorCase {
  id: string;
  action: string;
  languages: string[] | null;
  script: LangScript;
}

const constructorCases: ConstructorCase[] = [
  { id: "C01-only-de", action: ONLY, languages: ["en", "de"], script: SERVER_DE_FR },
  { id: "C02-meta-de", action: METADATA, languages: ["en", "de"], script: SERVER_DE_FR },
  { id: "C03-star-only", action: ONLY, languages: ["*"], script: SERVER_DE_FR },
  { id: "C04-star-meta", action: METADATA, languages: ["*"], script: SERVER_DE_FR },
  { id: "C05-star-en-only", action: ONLY, languages: ["*"], script: SERVER_EN },
  {
    id: "C06-star-server-case",
    action: ONLY,
    languages: ["*"],
    script: {
      languageXml:
        '<Item type="Language" id="1"><code>DE</code><name>German</name></Item><Item type="Language" id="2"><code>EN</code><name>English</name></Item><Item type="Language" id="3"><code>Fr</code><name>French</name></Item>',
    },
  },
  { id: "C07-star-server-error", action: ONLY, languages: ["*"], script: { languageFaultCode: "1" } },
  { id: "C08-star-no-languages", action: ONLY, languages: ["*"], script: {} },
  { id: "C09-null-only", action: ONLY, languages: null, script: SERVER_DE_FR },
  { id: "C10-null-export", action: "Export", languages: null, script: SERVER_DE_FR },
  { id: "C11-empty-only", action: ONLY, languages: [], script: SERVER_DE_FR },
  { id: "C12-upper-case-code", action: ONLY, languages: ["en", "DE"], script: SERVER_DE_FR },
  { id: "C13-upper-case-en", action: ONLY, languages: ["EN", "de"], script: SERVER_DE_FR },
  { id: "C14-not-installed", action: ONLY, languages: ["en", "xx", "de", "yy", "xx"], script: SERVER_DE_FR },
  { id: "C15-not-installed-one", action: METADATA, languages: ["zz"], script: SERVER_DE_FR },
  { id: "C16-star-and-code", action: ONLY, languages: ["*", "de"], script: SERVER_DE_FR },
  { id: "C17-star-twice", action: ONLY, languages: ["*", "*"], script: SERVER_DE_FR },
  { id: "C18-only-en", action: ONLY, languages: ["en"], script: SERVER_DE_FR },
  { id: "C19-export-plain-de", action: "Export", languages: ["en", "de"], script: SERVER_DE_FR },
  { id: "C20-export-plain-not-installed", action: "Export", languages: ["fr"], script: SERVER_DE },
  { id: "C21-export-plain-star", action: "Export", languages: ["*"], script: SERVER_DE_FR },
  { id: "C22-lpimport-not-installed", action: "LPImport", languages: ["fr"], script: SERVER_DE },
  { id: "C23-server-null-code", action: ONLY, languages: ["de"], script: { languageXml: '<Item type="Language" id="1"><name>No code</name></Item>' } },
  {
    id: "C24-star-null-code",
    action: ONLY,
    languages: ["*"],
    script: { languageXml: '<Item type="Language" id="1"><code>de</code></Item><Item type="Language" id="2"><name>No code</name></Item>' },
  },
  { id: "C25-check-server-fault", action: ONLY, languages: ["de"], script: { languageFaultCode: "1" } },
  { id: "C26-check-no-languages", action: ONLY, languages: ["de"], script: {} },
  { id: "C27-empty-element-order", action: ONLY, languages: ["b", "a", "b", "c"], script: SERVER_EN },
  { id: "C28-space-code", action: ONLY, languages: ["en", " de"], script: SERVER_DE_FR },
  { id: "C29-empty-string-code", action: ONLY, languages: ["en", ""], script: SERVER_DE_FR },
];

describe("the manager's language work (LP-110 to LP-115, LP-180, LP-181, LP-187), against the probe's C cases", () => {
  it("replays all the C cases of the probe", () => {
    expect(PROBE.filter((line) => /^## C\d\d-/.test(line))).toHaveLength(constructorCases.length);
  });

  it.each(constructorCases)("$id", async ({ id, action, languages, script }) => {
    const stub = new StubConnection((request) => langResponse(script, request));
    const context = new SUExportContext();
    context.action = action;
    context.workingDirectory = "C:\\probe-out";
    context.languages = languages === null ? null : [...languages];
    let result: string;
    try {
      await ImportExportManager.create(context, createMessagesFactory({ engine: "14.35" }), helperOver(stub), { cwd: "C:\\probe-out" });
      result = `result: constructed; context.Languages = ${showLanguages(context.languages)}`;
    } catch (error) {
      result = `result: ${describe_(error)}`;
    }
    const lines = section(id);
    const expected = lines.slice(1);
    const actual = [result];
    if (!result.startsWith("result: constructed")) actual.push(`  context.Languages afterwards = ${showLanguages(context.languages)}`);
    const language = stub.requests.filter((request) => request.includes('type="Language"')).length;
    actual.push(`language requests: ${language} of ${stub.requests.length}`);
    stub.requests.forEach((request, index) => actual.push(`  ${index + 1} ${escapeProbe(request)}`));
    expect(actual).toEqual(expected);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
// R: the requests of Export

const RL = ["de", "fr"];
const DEFAULT_SCHEMA: LangScript = {
  rels: { TA: ["R1", "R2"], TB: ["R3"] },
  related: { TA: "", TB: "", R1: "TB", R2: "", R3: "" },
  ml: {
    TA: ["label", "description"],
    R1: ["title"],
    TB: ["label"],
    Property: ["label", "help_tooltip", "default_value"],
    ItemType: ["label", "label_plural"],
    List: ["label"],
    Value: ["label"],
  },
};
const listSchema: LangScript = { rels: { List: ["Value"] }, related: { List: "" }, ml: { List: ["label"], Value: ["label"] } };
const tc = (extra: LangScript = {}): LangScript => ({ rels: { TC: ["R2"] }, related: { TC: "" }, ...extra });
const propertySchema = (ml: Record<string, string[]>, rels: string[]): LangScript => ({ rels: { TA: rels }, related: { TA: "" }, ml });

interface RequestCase {
  id: string;
  type: string;
  level: string;
  action: string;
  languages: string[] | null;
  script?: LangScript;
  brief?: boolean;
}

const requestCases: RequestCase[] = [
  { id: "R01-TA-level1-only", type: "TA", level: "1", action: ONLY, languages: RL },
  { id: "R02-TA-level2-only", type: "TA", level: "2", action: ONLY, languages: RL },
  { id: "R03-TA-level1-meta", type: "TA", level: "1", action: METADATA, languages: RL },
  { id: "R04-TA-level2-meta", type: "TA", level: "2", action: METADATA, languages: RL },
  { id: "R05-TA-level0-only", type: "TA", level: "0", action: ONLY, languages: RL },
  { id: "R06-TA-level0-meta", type: "TA", level: "0", action: METADATA, languages: RL },
  { id: "R07-TA-level1-export", type: "TA", level: "1", action: "Export", languages: RL },
  { id: "R08-TA-level1-only-no-languages", type: "TA", level: "1", action: ONLY, languages: [] },
  { id: "R09-TA-level1-only-en-in-list", type: "TA", level: "1", action: ONLY, languages: ["en", "de", "EN"] },
  { id: "R10-TA-level1-only-null-languages", type: "TA", level: "1", action: ONLY, languages: null },
  { id: "R11-TA-level1-meta-null-languages", type: "TA", level: "1", action: METADATA, languages: null },
  { id: "R12-TC-no-ml-only", type: "TC", level: "1", action: ONLY, languages: RL, script: tc() },
  { id: "R13-TC-no-ml-meta", type: "TC", level: "1", action: METADATA, languages: RL, script: tc() },
  { id: "R14-TC-ml-answers-item-only", type: "TC", level: "1", action: ONLY, languages: RL, script: tc({ mlNoRows: "item" }) },
  { id: "R15-TC-ml-answers-fault1-only", type: "TC", level: "1", action: ONLY, languages: RL, script: tc({ mlNoRows: "fault1" }) },
  { id: "R16-TC-ml-answers-item-meta", type: "TC", level: "1", action: METADATA, languages: RL, script: tc({ mlNoRows: "item" }) },
  { id: "R17-TA-ml-fault-only", type: "TA", level: "1", action: ONLY, languages: RL, script: { mlFaultCode: "1", rels: { TA: ["R2"] }, related: { TA: "" } } },
  {
    id: "R18-Property-rel-only",
    type: "TA",
    level: "1",
    action: ONLY,
    languages: RL,
    script: propertySchema({ TA: ["label"], Property: ["label", "help_tooltip"], ItemType: ["label"] }, ["Property", "ItemType"]),
  },
  {
    id: "R19-Property-rel-meta",
    type: "TA",
    level: "1",
    action: METADATA,
    languages: RL,
    script: propertySchema({ TA: ["label"], Property: ["label", "help_tooltip"], ItemType: ["label"] }, ["Property", "ItemType"]),
  },
  { id: "R20-Property-rel-no-ml-only", type: "TA", level: "1", action: ONLY, languages: RL, script: propertySchema({ TA: ["label"] }, ["Property"]) },
  { id: "R21-Item-Report-only", type: "Item Report", level: "1", action: ONLY, languages: RL, script: { ml: { "Item Report": ["label"] } } },
  { id: "R22-Item-Report-meta", type: "Item Report", level: "1", action: METADATA, languages: RL, script: { ml: { "Item Report": ["label"] } } },
  { id: "R23-List-only", type: "List", level: "1", action: ONLY, languages: RL, script: listSchema },
  { id: "R24-List-meta", type: "List", level: "1", action: METADATA, languages: RL, script: listSchema },
  { id: "R25-ItemType-body-only", type: "ItemType", level: "1", action: ONLY, languages: RL, brief: true },
  { id: "R26-ItemType-body-meta", type: "ItemType", level: "1", action: METADATA, languages: RL, brief: true },
  { id: "R27-ItemType-body-export", type: "ItemType", level: "1", action: "Export", languages: RL, brief: true },
  { id: "R28-cmf_ContentType-only", type: "cmf_ContentType", level: "1", action: ONLY, languages: RL, brief: true },
  {
    id: "R29-RelationshipType-only",
    type: "RelationshipType",
    level: "1",
    action: ONLY,
    languages: RL,
    script: { rels: { RelationshipType: ["R2"] }, related: { RelationshipType: "" }, ml: { RelationshipType: ["label"] } },
  },
  { id: "R30-TA-level-blank-only", type: "TA", level: "", action: ONLY, languages: RL },
  { id: "R31-TA-level3-only-brief", type: "TA", level: "3", action: ONLY, languages: RL, brief: true },
  { id: "R32-TA-ml-lookup-text-only-meta", type: "TA", level: "1", action: METADATA, languages: ["de"] },
  { id: "R34-TC-no-ml-null-languages-only", type: "TC", level: "1", action: ONLY, languages: null, script: tc() },
  { id: "R35-TA-rel-ml-null-languages-only", type: "TC", level: "1", action: ONLY, languages: null, script: { rels: { TC: ["R1"] }, related: { TC: "" }, ml: { R1: ["title"] } } },
];

const ITEM_ID = "A1B2C3D4E5F60718293A4B5C6D7E8F90";

/** The stub of the `R` and `E` runs: the language scripts, the `is_versionable` lookup, and an answer for the main fetch. */
const requestStub = (script: LangScript): StubConnection =>
  new StubConnection((request) => langResponse(script, request) ?? (request.includes("<id>") ? stubResult('<Item type="x" id="y"/>') : undefined));

/** The probe's `Show-Requests -Brief` line for a request: the type, the name and the select. */
function briefLine(request: string, index: number): string[] {
  const root = parseXml(request).root;
  const select = attributeOf(root, "select");
  const line = `  ${index} ${attributeOf(root, "type") ?? ""} select=${select === undefined ? "<none>" : `"${select}"`}`;
  return childElements(root, "id").length > 0 ? [line, `    ${escapeProbe(request)}`] : [line];
}

describe("the requests of Export in the language modes (LP-120 to LP-127), against the probe's R cases", () => {
  it.each(requestCases)("$id", async ({ id, type, level, action, languages, script = DEFAULT_SCHEMA, brief }) => {
    const stub = requestStub(script);
    const run: ExportRunState = { requestDictionary: newRequestDictionary(), packageElementIdsByElementType: new Map(), action, languages };
    let thrown = "<none>";
    try {
      await new CExportItems(helperOver(stub), {}, run).fetch(new ExportItem("k", ITEM_ID, type), level);
    } catch (error) {
      if (!(error instanceof StubStop)) thrown = describe_(error);
    }

    // the probe's Export goes on after the main fetch; the port's fetch ends with it
    const lines = section(id);
    const requestLines = lines.slice(2);
    const main = requestLines.findIndex((line) => (brief ? line.startsWith("    <") : line.includes(`<id>${ITEM_ID}</id>`)));
    const expectedRequests = main < 0 ? requestLines : requestLines.slice(0, main + 1);
    const actualRequests = brief
      ? stub.requests.flatMap((request, index) => briefLine(request, index + 1))
      : stub.requests.map((request, index) => `  ${index + 1} ${escapeProbe(request)}`);

    expect(actualRequests).toEqual(expectedRequests);
    if (!brief) expect(`thrown: ${thrown}`).toBe(main < 0 ? (lines[1] as string) : "thrown: <none>");
    else expect(thrown).toBe("<none>");
  });

  it("remembers a failed ml lookup for the rest of the run (LP-182, R33)", async () => {
    const stub = requestStub({ mlFaultCode: "1", rels: { TA: ["R2"] }, related: { TA: "" } });
    const run: ExportRunState = { requestDictionary: newRequestDictionary(), packageElementIdsByElementType: new Map(), action: ONLY, languages: ["de"] };
    const exporter = new CExportItems(helperOver(stub), {}, run);
    const seen: string[] = [];
    for (const number of [1, 2]) {
      const before = stub.requests.length;
      try {
        await exporter.fetch(new ExportItem(`k${number}`, `ID${number}`, "TA"), "1");
        seen.push(`item ${number}: no exception`);
      } catch (error) {
        seen.push(`item ${number}: ${describe_(error)}`, `  requests sent for item ${number}: ${stub.requests.length - before}`);
      }
    }
    expect(seen).toEqual(section("R33-ml-fault-remembered").slice(1));
  });
});
