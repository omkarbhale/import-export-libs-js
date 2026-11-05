import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { posix } from "../io/path.js";
import { expect } from "vitest";
import { readTranscript, type TranscriptCall } from "../../oracle/src/transcript.js";
import { CItemException, ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { CItemHelper } from "../client/item-helper.js";
import { DEFAULT_ENGINE, type Engine } from "../engines.js";
import { documentOuterXml, parseXml } from "../client/mini-xml.js";
import { ArasVersion } from "../client/version.js";
import type { XmlDocument } from "../xml/index.js";
import { CExportItems } from "./cexport-items.js";
import { ExportItem } from "./export-item.js";
import { PackageDefinitionManager } from "./package-definition-manager.js";

/**
 * Replays the recorded export cases (tickets 24, 67 and, for 12.0, 48) against the port, for the tests of the export. The port fetches
 * each item of a case from the case's own input; every request it sends must be a request the engine recorded, byte for byte,
 * with the same action, and the requests of one item must come in the recorded order. By default the items go through the
 * fetch and the rewrites of `export-prexsl.md`; a test can run them through the whole of `Export` instead and write the files.
 * Whatever the replay leaves over belongs to the host (`export-unknown-refs.md`, `export-run.md`).
 */

/** The recorded cases of an engine: where they are, their names, and how many calls of a transcript are the login and the probe. */
export interface ExportCases {
  readonly engine: Engine;
  readonly dir: string;
  readonly blobs: string;
  readonly names: string[];
  /** ValidateUser, the user record and the probe: 6 calls on 14.0.7; 12.0 adds GetCurrentUserID and probes with two requests, so 5. */
  readonly loginCalls: number;
}

export function exportCases(engine: Engine): ExportCases {
  const dir = fileURLToPath(new URL(`../../fixtures/${engine}/export/`, import.meta.url));
  return {
    engine,
    dir,
    blobs: posix.join(dir, "_blobs"),
    names: readdirSync(dir).filter((name) => existsSync(posix.join(dir, name, "transcript.jsonl"))),
    loginCalls: engine === "12.0" ? 5 : 6,
  };
}

/** The engines whose recorded export cases the tests replay. */
export const REPLAYED_ENGINES: readonly Engine[] = ["14.0.7", "12.0"];

const DEFAULT_CASES = exportCases(DEFAULT_ENGINE);
export const CASES = DEFAULT_CASES.dir;

export interface Case {
  id: string;
  packages: Array<{ name: string; items: Array<{ type: string; id: string; keyedName: string }> }>;
  options: { level?: string; exportReferencedItems?: boolean; refToUnknownPacks?: string };
  expectsError: boolean;
}

export const caseNames = DEFAULT_CASES.names;

/** The recorded answers, handed back to whichever request equals the recorded one and was not answered yet. */
class ReplayConnection implements ServerConnection {
  readonly consumed: boolean[];
  readonly misses: string[] = [];
  /** The index of the recorded call each request of the port was answered with, in the order the port sent them. */
  readonly order: number[] = [];

  constructor(
    private readonly calls: TranscriptCall[],
    loginCalls: number,
  ) {
    this.consumed = calls.map((_, index) => index < loginCalls);
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
export const ENGINE_FAILS = new Set(["e40-workflow-promotion-error-no", "e40-workflow-promotion-error-yes"]);

/** The request families only the rewrites of export-prexsl.md send (EXP-010, EXP-042 and EXP-045 are shared with later steps). */
export const REWRITE_FAMILIES = new Set(["EXP-040", "EXP-043", "EXP-044", "EXP-048", "EXP-049", "EXP-050", "EXP-051"]);

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

export const familyOf = (request: string): string | undefined => FAMILIES.find(([, test]) => test.test(request))?.[0];

/** What belongs to the host's package listing and to the unknown-package removal (`export-run.md`, `export-unknown-refs.md`). */
export const OTHER_AREAS: readonly RegExp[] = [
  /^<Item type="PackageDefinition" select="name,generation" action="get">/,
  /^<Item type="PackageDefinition" action="get" select="(?:id|name)"[ >/]/,
  /^<Item type="PackageDependsOn" action="get" select="name"><source_id>/,
  /^<Item type="[^"]*" action="get" select="(?:id|config_id)"><name>/,
  /^<Item type="[^"]*" action="get" select="id"><name>[\s\S]*<Relationships>/,
];

export const decode = (text: string): string => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

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

export interface Replay {
  /** The family of each recorded request the port sent, `other` for one it has no family for. */
  sent: string[];
  /** The recorded requests the port did not send. */
  leftover: string[];
  /** The items the port fetched, each with its answer after the rewrites. */
  rewritten: Array<{ item: ExportItem; doc: XmlDocument }>;
}

/** What a test changes in the replay of a case. */
export interface ReplayHooks {
  /** The host the export writes on: its current directory and platform. */
  environment?: ConstructorParameters<typeof CExportItems>[1];
  /** Called as `ExportProc` starts a package, before its items: the main packages in order, then each referenced package (EXP-513, EXP-519). */
  beginPackage?: (packageName: string, helper: CItemHelper) => void;
  /** Exports one item. The default fetches it and runs the rewrites, and returns the rewritten answer. */
  exportItem?: (exporter: CExportItems, item: ExportItem, level: string | undefined) => Promise<XmlDocument | undefined>;
}

type CaseItem = { keyedName: string; id: string; type: string };

/** The entries as packages, in the order of their first entry. */
function groupByPackage(entries: Array<{ item: CaseItem; name: string }>): Array<{ packageName: string; items: CaseItem[] }> {
  const groups: Array<{ packageName: string; items: CaseItem[] }> = [];
  for (const { item, name } of entries) {
    const group = groups.find((candidate) => candidate.packageName === name);
    if (group) group.items.push(item);
    else groups.push({ packageName: name, items: [item] });
  }
  return groups;
}

export async function replayCase(name: string, hooks: ReplayHooks = {}, engine: Engine = DEFAULT_ENGINE): Promise<Replay> {
  const { dir, blobs, loginCalls: LOGIN_CALLS } = exportCases(engine);
  const input = JSON.parse(readFileSync(posix.join(dir, name, "case.json"), "utf8")) as Case;
  const calls = readTranscript(posix.join(dir, name, "transcript.jsonl"), blobs);
  const connection = new ReplayConnection(calls, LOGIN_CALLS);
  const helper = new CItemHelper(connection, { engine });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  const exporter = new CExportItems(helper, hooks.environment);

  // the package definitions and their dependencies' referenced elements, in the order the host asks (export-run.md)
  let aborted = false;
  const managers = new Map<string, PackageDefinitionManager>();
  const referenced: Array<{ element: ExportItem; dependency: string }> = [];
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
      const found = (await manager?.findReferencedElements(decode(dependency))) ?? [];
      referenced.push(...found.map((element) => ({ element, dependency: decode(dependency) })));
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
    .flatMap((pkg) => pkg.items.map((item, position) => ({ item, position, name: pkg.name, pkg: packageIndex(pkg.name) })))
    .sort((a, b) => a.pkg - b.pkg || fetchIndex(a.item.id) - fetchIndex(b.item.id) || a.position - b.position);
  // with exportReferencedItems, the referenced elements of the second pass follow (EXP-519)
  const second = input.options.exportReferencedItems
    ? referenced
        .map(({ element, dependency }) => ({
          item: { keyedName: element.keyedName ?? "", id: element.idName ?? "", type: element.typeName ?? "" },
          name: dependency,
        }))
        .sort((a, b) => lastFetchIndex(a.item.id) - lastFetchIndex(b.item.id))
    : [];
  // ExportProc runs the main packages in order, then each referenced package
  const units = aborted ? [] : [...groupByPackage(items), ...groupByPackage(second)];

  // the items of the case, from its own input: the fetches and the rewrites of export-prexsl.md, in the order the engine sends them
  const sequences: number[][] = [];
  const rewritten: Replay["rewritten"] = [];
  const exportItem =
    hooks.exportItem ??
    (async (exporting: CExportItems, item: ExportItem, level: string | undefined) => exporting.rewrite(item, await exporting.fetch(item, level)));
  for (const unit of units) {
    hooks.beginPackage?.(unit.packageName, helper);
    for (const item of unit.items) {
      const exported = new ExportItem(item.keyedName, item.id, item.type);
      const before = connection.order.length;
      try {
        const doc = await exportItem(exporter, exported, input.options.level);
        if (doc) rewritten.push({ item: exported, doc });
      } catch (error) {
        // an item the engine failed on fails in the port at the same request, and no other does
        if (!(error instanceof CItemException) || !(input.expectsError || ENGINE_FAILS.has(name))) throw error;
      } finally {
        sequences.push(connection.order.slice(before));
      }
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

