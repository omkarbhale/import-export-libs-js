import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTranscript, type TranscriptCall } from "../../oracle/src/transcript.js";
import { childText, descendantsNamed, resultItems } from "../client/answer.js";
import { CItemException, ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { CItemHelper } from "../client/item-helper.js";
import { independentRelatedItems } from "../client/item-lookups.js";
import { attributeOf, documentOuterXml, innerText, parseXml } from "../client/mini-xml.js";
import { ArasVersion } from "../client/version.js";
import { CExportItems } from "./cexport-items.js";
import { ExportItem } from "./export-item.js";
import { PackageDefinitionManager } from "./package-definition-manager.js";

/**
 * Replays the recorded 14.0.7 export cases (ticket 24) against the port. The requests of this area (the fetches of
 * `export-requests.md`) are sent by the port from the case's own input and from the recorded answers, and each must
 * be a request the engine recorded, byte for byte, with the same action. The ones that follow from the answers by
 * the rewrites of `export-prexsl.md` are replayed by their shape. Whatever the replay leaves over belongs to other
 * areas.
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
    return ResponseDocument.parse(this.calls[index]?.response ?? "");
  }
}

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

/** The types EXP-040 selects out of the answers the port has seen. */
interface RelatedTypes {
  relatedItemTypes: Set<string>;
  relationshipTypes: Set<string>;
}

/** Runs the lookups whose parameters the port's rewrites would read from answers, from the recorded request itself. */
async function replayByShape(helper: CItemHelper, request: string, related: RelatedTypes): Promise<void> {
  const lookups = helper.lookups;
  const name = (pattern: RegExp) => decode(pattern.exec(request)?.[1] ?? "");
  switch (familyOf(request)) {
    case "EXP-010":
      await lookups.isVersionable(name(/<name>([\s\S]*)<\/name>/));
      break;
    case "EXP-040": {
      // the engine drops relationships that are package elements of their own before this step, so the answers
      // hold at least the types it asked about, never fewer
      const asked = name(/<name>([\s\S]*)<\/name>/);
      if (request.startsWith('<Item type="ItemType"')) {
        expect(related.relatedItemTypes, `the related item type ${asked} is in an answer`).toContain(asked);
        await lookups.getItemType(asked, "is_dependent, is_versionable");
      } else {
        expect(related.relationshipTypes, `the relationship type ${asked} holds a related item in an answer`).toContain(asked);
        await lookups.getRelationshipType(asked, "behavior");
      }
      break;
    }
    case "EXP-042": {
      const [, type = "", id = ""] = /^<Item type="([^"]*)" select="config_id" action="get"><id>([\s\S]*)<\/id><\/Item>$/.exec(request) ?? [];
      await lookups.getConfigId(decode(id), type);
      break;
    }
    case "EXP-044":
      await lookups.getCustomFloatPropertiesOfTypeItem(name(/<name>([\s\S]*?)<\/name><Relationships>/));
      break;
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
}

async function replayCase(name: string): Promise<Replay> {
  const input = JSON.parse(readFileSync(join(CASES, name, "case.json"), "utf8")) as Case;
  const calls = readTranscript(join(CASES, name, "transcript.jsonl"), BLOBS);
  const connection = new ReplayConnection(calls);
  const helper = new CItemHelper(connection);
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  const exporter = new CExportItems(helper);

  const related: RelatedTypes = { relatedItemTypes: new Set(), relationshipTypes: new Set() };
  const noteRelated = (response: ResponseDocument) => {
    for (const item of independentRelatedItems(response)) {
      related.relatedItemTypes.add(item.relatedItemType);
      related.relationshipTypes.add(item.relationshipType);
    }
  };

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

  // the items of the case, from its own input, and what follows from their answers
  // and, with exportReferencedItems, the referenced elements of the second pass (EXP-519)
  const passes = aborted ? [] : [...input.packages.map((pkg) => pkg.items), input.options.exportReferencedItems ? referenced.map((element) => ({ keyedName: element.keyedName ?? "", id: element.idName ?? "", type: element.typeName ?? "" })) : []];
  for (const items of passes) {
    for (const item of items) {
      let fetched;
      try {
        fetched = await exporter.fetch(new ExportItem(item.keyedName, item.id, item.type), input.options.level);
      } catch (error) {
        if (!(error instanceof CItemException)) throw error;
        continue;
      }
      const root = resultItems(fetched.response)[0];
      if (!root) continue;
      if (item.type === "ItemType") {
        await exporter.queryAutoGeneratedRelationships(attributeOf(root, "id") ?? "");
      }
      if (item.type === "RelationshipType") {
        const relationshipId = childText(root, "relationship_id");
        if (relationshipId !== undefined) noteRelated(await exporter.fetchRelationshipItemType(relationshipId));
        const sourceId = childText(root, "source_id");
        if (sourceId !== undefined) await helper.lookups.getDepencyLevel(sourceId, 0);
      }
      if (item.type === "Form") {
        for (const field of descendantsNamed(root, "Item").filter((e) => attributeOf(e, "type") === "Field")) {
          const propertyTypeId = childText(field, "propertytype_id");
          if (propertyTypeId !== undefined) await exporter.fetchFieldProperty(propertyTypeId);
        }
      }
      if (item.type === "dr_RelationshipFamily" || item.type === "ac_PolicyAccessItemAttribute") {
        for (const element of descendantsNamed(root, "dr_relationship_id")) {
          await exporter.fetchDrRelationship(innerText(element));
        }
      }
      noteRelated(fetched.response);
    }
  }

  // the lookups the rewrites of export-prexsl.md make from the answers
  for (const [index, call] of calls.entries()) {
    if (index < LOGIN_CALLS || connection.consumed[index]) continue;
    try {
      await replayByShape(helper, call.request, related);
    } catch (error) {
      if (!(error instanceof CItemException)) throw error;
    }
  }
  expect(connection.misses).toEqual([]);

  const replayed = calls.filter((_, index) => index >= LOGIN_CALLS);
  return {
    sent: replayed.filter((_, index) => connection.consumed[index + LOGIN_CALLS]).map((call) => familyOf(call.request) ?? "other"),
    leftover: replayed.filter((_, index) => !connection.consumed[index + LOGIN_CALLS]).map((call) => call.request),
  };
}

describe("the recorded 14.0.7 export cases, replayed through the port's fetch requests (EXP-001 to EXP-053)", () => {
  const families = new Map<string, number>();

  it("has the recorded cases", () => {
    expect(caseNames.length).toBeGreaterThan(70);
  });

  it.each(caseNames)("%s", async (name) => {
    const input = JSON.parse(readFileSync(join(CASES, name, "case.json"), "utf8")) as Case;
    const replay = await replayCase(name);
    for (const family of replay.sent) families.set(family, (families.get(family) ?? 0) + 1);
    expect(replay.leftover.filter((request) => !OTHER_AREAS.some((pattern) => pattern.test(request)))).toEqual([]);
    if (!input.expectsError) expect(replay.sent.length).toBeGreaterThan(0);
  });

  it("covered every request family at least once", () => {
    expect([...families.keys()].filter((family) => family !== "other").sort()).toEqual(
      ["EXP-010", "EXP-011", "EXP-020", "EXP-040", "EXP-042", "EXP-043", "EXP-044", "EXP-045", "EXP-046", "EXP-048", "EXP-049", "EXP-050", "EXP-051", "EXP-052", "EXP-053"],
    );
  });
});
