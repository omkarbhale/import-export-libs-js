import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTranscript, type TranscriptCall } from "../../oracle/src/transcript.js";
import { CItemException, ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { CItemHelper } from "../client/item-helper.js";
import { documentOuterXml, parseXml } from "../client/mini-xml.js";
import { ArasVersion } from "../client/version.js";
import { CExportItems } from "./cexport-items.js";
import { ELEMENT_NODE, attributesOf, innerText, loadXml } from "../xml/index.js";
import type { XmlDocument, XmlElement, XmlNode } from "../xml/index.js";
import { ExportItem, exportFileName } from "./export-item.js";
import { PackageDefinitionManager } from "./package-definition-manager.js";
import { transformExport } from "./transform.js";

/**
 * Replays the recorded 14.0.7 export cases (ticket 24) against the port. The port fetches each item of a case from the case's own
 * input and runs the rewrites of `export-prexsl.md` on the recorded answers; every request it sends must be a request the engine
 * recorded, byte for byte, with the same action, and the requests of one item must come in the recorded order. What the port's
 * rewritten answer becomes after the transform must hold everything the recorded item file holds. Whatever the replay leaves
 * over belongs to the steps after the transform and to the host (`export-write.md`, `export-unknown-refs.md`, `export-run.md`).
 */
const CASES = new URL("../../fixtures/14.0.7/export/", import.meta.url).pathname;
const BLOBS = join(CASES, "_blobs");
const LOGIN_CALLS = 6;

interface Case {
  id: string;
  packages: Array<{ name: string; items: Array<{ type: string; id: string; keyedName: string }> }>;
  options: { level?: string; exportReferencedItems?: boolean };
  expectsError: boolean;
}

const caseNames = readdirSync(CASES).filter((name) => existsSync(join(CASES, name, "transcript.jsonl")));

/** The recorded answers, handed back to whichever request equals the recorded one and was not answered yet. */
class ReplayConnection implements ServerConnection {
  readonly consumed: boolean[];
  readonly misses: string[] = [];
  /** The index of the recorded call each request of the port was answered with, in the order the port sent them. */
  readonly order: number[] = [];

  constructor(private readonly calls: TranscriptCall[]) {
    this.consumed = calls.map((_, index) => index < LOGIN_CALLS);
  }

  async callAction(action: string, request: string): Promise<ResponseDocument> {
    const wire = documentOuterXml(parseXml(request));
    const index = this.calls.findIndex((call, i) => !this.consumed[i] && call.action === action && call.request === wire);
    if (index < 0) {
      this.misses.push(`${action} ${wire}`);
      throw new Error(`the port sent a request the engine did not record: ${action} ${wire.slice(0, 300)}`);
    }
    this.consumed[index] = true;
    this.order.push(index);
    return ResponseDocument.parse(this.calls[index]?.response ?? "");
  }
}

/** The cases whose recorded run ends an item with the server's fault, which the host's error question then answers (export-run.md). */
const ENGINE_FAILS = new Set(["e40-workflow-promotion-error-no", "e40-workflow-promotion-error-yes"]);

/** The request families only the rewrites of export-prexsl.md send (EXP-010, EXP-042 and EXP-045 are shared with later steps). */
const REWRITE_FAMILIES = new Set(["EXP-040", "EXP-043", "EXP-044", "EXP-048", "EXP-049", "EXP-050", "EXP-051"]);

const MAIN_FETCH = /^<Item type="[^"]*" action="get"(?: levels="[^"]*")?(?: related_expand="0")?(?: select="[^"]*")?><id>/;

/** The shape of a recorded request, by the rule that writes it. Requests of other areas have no family. */
const FAMILIES: ReadonlyArray<readonly [family: string, test: RegExp]> = [
  ["EXP-052", /^<Item type="PackageDefinition" select="id,name,generation" action="get"><name>[\s\S]*<\/name><is_current>1<\/is_current><\/Item>$/],
  ["EXP-053", /^<Item type="PackageDependsOn" levels="1" configPath="\.\|PackageReferencedElement" select="id\|element_id,element_type,element_description" action="get">/],
  ["EXP-010", /^<Item type="ItemType" select="is_versionable" action="get"><name>[\s\S]*<\/name><\/Item>$/],
  ["EXP-011", /^<Item type="[^"]*" select="config_id, is_current" action="get"><id>/],
  ["EXP-011", /^<Item type="[^"]*" select="id" action="get"><config_id>/],
  ["EXP-020", MAIN_FETCH],
  ["EXP-040", /^<Item type="ItemType" select="is_dependent, is_versionable" action="get"><name>/],
  ["EXP-040", /^<Item type="RelationshipType" select="behavior" action="get"><name>/],
  ["EXP-042", /^<Item type="[^"]*" select="config_id" action="get"><id>/],
  ["EXP-043", /^<Item type="RelationshipType" select="source_id,relationship_id" page="1" pagesize="1" action="get">/],
  ["EXP-044", /^<Item type="ItemType" action="get" levels="1" select="id"><name>[\s\S]*<\/name><Relationships><Item type="Property" select="name, data_type, data_source" action="get">/],
  ["EXP-045", /^<Item type="ItemType" action="get" select="id, is_relationship, use_src_access"><name>/],
  ["EXP-046", /^<Item type="ItemType" action="get" select="name"><implementation_type>polymorphic<\/implementation_type><\/Item>$/],
  ["EXP-048", /^<AML>\t<Item type="cmf_ContentType" action="get" select="id">/],
  ["EXP-049", /^<Item type="ItemType" action="get" id="/],
  ["EXP-050", /^<Item type="Property" action="get" id="[^"]*" select="name,source_id" page="1" pagesize="1" \/>$/],
  ["EXP-051", /^<Item type="dr_Relationship" action="get" id="[^"]*" \/>$/],
];

const familyOf = (request: string): string | undefined => FAMILIES.find(([, test]) => test.test(request))?.[0];

/** What belongs to the host's package listing and to the unknown-package removal (`export-run.md`, `export-unknown-refs.md`). */
const OTHER_AREAS: readonly RegExp[] = [
  /^<Item type="PackageDefinition" select="name,generation" action="get">/,
  /^<Item type="PackageDefinition" action="get" select="(?:id|name)"[ >/]/,
  /^<Item type="PackageDependsOn" action="get" select="name"><source_id>/,
  /^<Item type="[^"]*" action="get" select="(?:id|config_id)"><name>/,
  /^<Item type="[^"]*" action="get" select="id"><name>[\s\S]*<Relationships>/,
];

const decode = (text: string): string => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Runs the lookups of the steps after the transform, which are other tickets', from the recorded request itself. */
async function replayByShape(helper: CItemHelper, request: string): Promise<void> {
  const lookups = helper.lookups;
  const name = (pattern: RegExp) => decode(pattern.exec(request)?.[1] ?? "");
  switch (familyOf(request)) {
    case "EXP-010":
      await lookups.isVersionable(name(/<name>([\s\S]*)<\/name>/));
      break;
    case "EXP-042": {
      const [, type = "", id = ""] = /^<Item type="([^"]*)" select="config_id" action="get"><id>([\s\S]*)<\/id><\/Item>$/.exec(request) ?? [];
      await lookups.getConfigId(decode(id), type);
      break;
    }
    case "EXP-045":
      await lookups.getItemTypeWithDefaultPermission(name(/<name>([\s\S]*?)<\/name><Relationships>/));
      break;
    case "EXP-046":
      await lookups.getPolytypeNames();
      break;
  }
}

interface Replay {
  /** The family of each recorded request the port sent, `other` for one it has no family for. */
  sent: string[];
  /** The recorded requests the port did not send. */
  leftover: string[];
  /** The items the port fetched, each with its answer after the rewrites. */
  rewritten: Array<{ item: ExportItem; doc: XmlDocument }>;
}

async function replayCase(name: string): Promise<Replay> {
  const input = JSON.parse(readFileSync(join(CASES, name, "case.json"), "utf8")) as Case;
  const calls = readTranscript(join(CASES, name, "transcript.jsonl"), BLOBS);
  const connection = new ReplayConnection(calls);
  const helper = new CItemHelper(connection);
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  const exporter = new CExportItems(helper);

  // the package definitions and their dependencies' referenced elements, in the order the host asks (export-run.md)
  let aborted = false;
  const managers = new Map<string, PackageDefinitionManager>();
  const referenced: ExportItem[] = [];
  for (const [index, call] of calls.entries()) {
    if (index < LOGIN_CALLS || connection.consumed[index]) continue;
    const family = familyOf(call.request);
    if (family === "EXP-052") {
      const packageName = decode(/<name>([\s\S]*)<\/name>/.exec(call.request)?.[1] ?? "");
      try {
        const manager = await PackageDefinitionManager.open(helper, packageName);
        managers.set(manager.id, manager);
      } catch (error) {
        if (!(error instanceof CItemException)) throw error;
        aborted = true;
      }
    } else if (family === "EXP-053") {
      const [, dependency = "", sourceId = ""] = /<name>([\s\S]*)<\/name><source_id>([\s\S]*)<\/source_id>/.exec(call.request) ?? [];
      const manager = managers.get(sourceId);
      expect(manager, `the package definition whose id the dependency request carries (${sourceId})`).toBeDefined();
      referenced.push(...((await manager?.findReferencedElements(decode(dependency))) ?? []));
    }
  }

  // the engine exports the packages in the order of its own listing, which is the order of their definition requests, and the items
  // of a package in the order of its own enumeration, which is the order of their main fetches (export-run.md)
  const packageIndex = (packageName: string) =>
    calls.findIndex((call) => familyOf(call.request) === "EXP-052" && decode(/<name>([\s\S]*)<\/name>/.exec(call.request)?.[1] ?? "") === packageName);
  const fetchIndex = (id: string) => {
    const found = calls.findIndex((call) => familyOf(call.request) === "EXP-020" && call.request.includes(`<id>${id}</id>`));
    return found < 0 ? Number.MAX_SAFE_INTEGER : found;
  };
  // an element of the second pass may be one of the packages' own, fetched again: its last fetch is the second pass's
  const lastFetchIndex = (id: string) =>
    calls.reduce((last, call, index) => (familyOf(call.request) === "EXP-020" && call.request.includes(`<id>${id}</id>`) ? index : last), -1);
  const items = input.packages
    .flatMap((pkg) => pkg.items.map((item, position) => ({ item, position, pkg: packageIndex(pkg.name) })))
    .sort((a, b) => a.pkg - b.pkg || fetchIndex(a.item.id) - fetchIndex(b.item.id) || a.position - b.position)
    .map(({ item }) => item);
  // with exportReferencedItems, the referenced elements of the second pass follow (EXP-519)
  const second = input.options.exportReferencedItems
    ? referenced
        .map((element) => ({ keyedName: element.keyedName ?? "", id: element.idName ?? "", type: element.typeName ?? "" }))
        .sort((a, b) => lastFetchIndex(a.id) - lastFetchIndex(b.id))
    : [];

  // the items of the case, from its own input: the fetches and the rewrites of export-prexsl.md, in the order the engine sends them
  const sequences: number[][] = [];
  const rewritten: Replay["rewritten"] = [];
  for (const item of aborted ? [] : [...items, ...second]) {
    const exportItem = new ExportItem(item.keyedName, item.id, item.type);
    const before = connection.order.length;
    try {
      const fetched = await exporter.fetch(exportItem, input.options.level);
      rewritten.push({ item: exportItem, doc: await exporter.rewrite(exportItem, fetched) });
    } catch (error) {
      // an item the engine failed on fails in the port at the same request, and no other does
      if (!(error instanceof CItemException) || !(input.expectsError || ENGINE_FAILS.has(name))) throw error;
    } finally {
      sequences.push(connection.order.slice(before));
    }
  }
  // each item's requests are recorded in the order the port sent them
  for (const sequence of sequences) expect(sequence, "the requests of one item come in the recorded order").toEqual([...sequence].sort((a, b) => a - b));

  // everything the rewrites ask for was sent by the rewrites: what is left belongs to the steps after the transform
  const leftoverFamilies = calls.flatMap((call, index) => (index < LOGIN_CALLS || connection.consumed[index] ? [] : [familyOf(call.request) ?? "other"]));
  expect(leftoverFamilies.filter((family) => REWRITE_FAMILIES.has(family))).toEqual([]);

  // the lookups of the steps after the transform (export-run.md, export-unknown-refs.md), from the recorded request itself
  for (const [index, call] of calls.entries()) {
    if (index < LOGIN_CALLS || connection.consumed[index]) continue;
    try {
      await replayByShape(helper, call.request);
    } catch (error) {
      if (!(error instanceof CItemException)) throw error;
    }
  }
  expect(connection.misses).toEqual([]);

  const replayed = calls.filter((_, index) => index >= LOGIN_CALLS);
  return {
    sent: replayed.filter((_, index) => connection.consumed[index + LOGIN_CALLS]).map((call) => familyOf(call.request) ?? "other"),
    leftover: replayed.filter((_, index) => !connection.consumed[index + LOGIN_CALLS]).map((call) => call.request),
    rewritten,
  };
}


const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));

const childElementsOf = (element: XmlElement): XmlElement[] => {
  const found: XmlElement[] = [];
  for (let child: XmlNode | null = element.firstChild; child; child = child.nextSibling) if (child.nodeType === ELEMENT_NODE) found.push(child as XmlElement);
  return found;
};

/**
 * What an item file says, as one string per element: its path of element names, its attributes (sorted) and, for an element with
 * no child element, its text. Only the first `Item` of the `AML` is read: the items after it are the transform's follow-up items.
 */
function signatures(aml: XmlElement): Set<string> {
  const found = new Set<string>();
  const visit = (element: XmlElement, path: string): void => {
    const attributes = attributesOf(element)
      .filter((attribute) => !attribute.name.startsWith("xmlns"))
      .map((attribute) => `${attribute.name}=${attribute.value}`)
      .sort()
      .join(",");
    const children = childElementsOf(element);
    const here = `${path}/${element.tagName}`;
    // the text of a filter is re-wrapped in CDATA by the step after the transform (EXP-405), so only its presence is compared
    const text = children.length === 0 && !FILTER_ELEMENTS.has(element.tagName) ? `=${innerText(element)}` : "";
    found.add(`${here}[${attributes}]${text}`);
    for (const child of children) visit(child, here);
  };
  const first = childElementsOf(aml)[0];
  if (first) visit(first, "");
  return found;
}

/** The elements whose text `CdataFilterXml` rewrites after the transform (EXP-405). */
const FILTER_ELEMENTS = new Set(["condition_xml", "implementation_query"]);

/** The fix items of the transform (`action="edit"` and `"delete"` with a `where`), which the transform's second half writes. */
const FIX_ITEM = /\[(?:[^\]]*,)?action=(?:edit|delete)[,\]]|where=/;

/**
 * Everything the recorded file of an item holds, except the fix items, is in what the transform makes of the rewritten answer.
 * The steps after the transform only take things out of the file or change references in it; the rewrites of `export-prexsl.md` are
 * what put the config ids, the dependency levels, the embedded items and the `set` attributes in it. Returns false when the
 * case wrote no file for the item.
 */
function expectRecordedFile(name: string, item: ExportItem, doc: XmlDocument): boolean {
  const files = walk(join(CASES, name, "output")).filter((path) => path.endsWith(`/${item.typeName}/${exportFileName(item)}`));
  if (files.length !== 1) return false;
  const text = transformExport(doc).replace(' xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"', "");
  const mine = signatures(loadXml(text, { preserveWhitespace: false }).documentElement as XmlElement);
  const recorded = loadXml(readFileSync(files[0] as string, "utf8").replace(/^\uFEFF/, ""), { preserveWhitespace: false });
  const missing = [...signatures(recorded.documentElement as XmlElement)].filter((signature) => !mine.has(signature) && !FIX_ITEM.test(signature));
  expect(missing, `${name}: what the recorded file holds and the rewritten answer lacks`).toEqual([]);
  return true;
}

describe("the recorded 14.0.7 export cases, replayed through the port's fetch requests (EXP-001 to EXP-053)", () => {
  const families = new Map<string, number>();
  let comparedFiles = 0;
  it("has the recorded cases", () => {
    expect(caseNames.length).toBeGreaterThan(70);
  });

  it.each(caseNames)("%s", async (name) => {
    const input = JSON.parse(readFileSync(join(CASES, name, "case.json"), "utf8")) as Case;
    const replay = await replayCase(name);
    for (const family of replay.sent) families.set(family, (families.get(family) ?? 0) + 1);
    expect(replay.leftover.filter((request) => !OTHER_AREAS.some((pattern) => pattern.test(request)))).toEqual([]);
    if (!input.expectsError) expect(replay.sent.length).toBeGreaterThan(0);
    for (const { item, doc } of replay.rewritten) if (expectRecordedFile(name, item, doc)) comparedFiles += 1;
  });

  it("compared the rewritten answer of every item that has a recorded file", () => {
    expect(comparedFiles).toBeGreaterThan(65);
  });

  it("covered every request family at least once", () => {
    expect([...families.keys()].filter((family) => family !== "other").sort()).toEqual(
      ["EXP-010", "EXP-011", "EXP-020", "EXP-040", "EXP-042", "EXP-043", "EXP-044", "EXP-045", "EXP-046", "EXP-048", "EXP-049", "EXP-050", "EXP-051", "EXP-052", "EXP-053"],
    );
  });
});
