import { DotNetException } from "../client/dotnet.js";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { type ProbedException, describeException } from "../client/probe-fixture.js";
import { StubConnection, StubStop, stubFault, stubResult } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import { ArgumentNullException } from "../io/errors.js";
import { ArgumentException } from "../xml/errors.js";
import { CExportItems, type ExportRunState } from "./cexport-items.js";
import { ExportItem } from "./export-item.js";
import { type PackageElementMap } from "./rewrites.js";
import { type RequestDictionary, newRequestDictionary } from "./request-template.js";

/**
 * The scripted stub of the 14.35 request probe (`oracle/request-probe/probe-14.35.ps1`), in TypeScript: the same schema, the same answers
 * and the same way of running `Export` up to the first request nobody scripted. The tests compare the port's requests and
 * exceptions with the probe's recording (`fixtures/export-requests/14.35-probe/requests.json`).
 */

/** A tiny fictional schema the stub answers the tree lookups from: `rels` maps a type to its relationship types, `related` a type to its related type. */
export interface Schema {
  readonly rels: Readonly<Record<string, readonly string[]>>;
  readonly related: Readonly<Record<string, string>>;
}

export const NO_SCHEMA: Schema = { rels: {}, related: {} };

/** TA has two relationship types, R1 points at TB (which has two of its own), R2 has no related type; R1 itself has R5. */
export const TREE_SCHEMA: Schema = {
  rels: { TA: ["R1", "R2"], TB: ["R3", "R4"], R1: ["R5"], R3: ["R6"] },
  related: { TA: "", TB: "", R1: "TB", R2: "", R3: "", R4: "", R5: "", R6: "" },
};

/** `Schema-Response` of the probe: the answers to the two tree lookups, undefined for any other request. */
export function schemaResponse(request: string, schema: Schema): string | undefined {
  const related = /^<Item [^>]*type="ItemType"[^>]*><name>([^<]*)<\/name><Relationships><Item [^>]*type="Property"[^>]*><name>related_id<\/name>/i.exec(request);
  if (related) {
    const name = related[1] ?? "";
    if (!(name in schema.related)) return stubFault("0", "No items of type ItemType found.");
    const dataSource = schema.related[name] ?? "";
    const xml = dataSource === "" ? "<data_source />" : `<data_source keyed_name="${dataSource}" type="ItemType" name="${dataSource}">DS-${dataSource}</data_source>`;
    return stubResult(`<Item type="ItemType" id="IT-${name}"><Relationships><Item type="Property" id="P-${name}">${xml}</Item></Relationships></Item>`);
  }
  const rels = /^<Item [^>]*type="RelationshipType"[^>]*><source_id><Item [^>]*type="ItemType"[^>]*><name>([^<]*)<\/name><\/Item><\/source_id><\/Item>$/i.exec(request);
  if (rels) {
    const name = rels[1] ?? "";
    const names = schema.rels[name] ?? [];
    if (names.length === 0) return stubFault("0", "No items of type RelationshipType found.");
    return stubResult(names.map((r) => `<Item type="RelationshipType" id="RT-${r}"><name>${r}</name></Item>`).join(""));
  }
  return undefined;
}

/** `New-Helper`: a 14.35 helper that has the server version `Login` would have set (or none) and a folder. */
export function newHelper(connection: StubConnection, major: number | null, servicePack: number): CItemHelper {
  const helper = new CItemHelper(connection, { engine: "14.35" });
  helper.innovatorVersion = major === null ? undefined : new ArasVersion(major, 0, servicePack, 1, 0);
  helper.folder = "C:\\probe-out";
  return helper;
}

/** A new, empty package-element map (`New-Elements`). */
export const newElements = (): PackageElementMap => new Map();

/** What the probe records of an exception, for the .NET exceptions the port models with classes of its own. */
export function describeThrown(error: unknown): ProbedException {
  if (error instanceof ArgumentNullException) return { type: "System.ArgumentNullException", message: error.message };
  if (error instanceof ArgumentException) return { type: "System.ArgumentException", message: error.message };
  if (error instanceof CItemException || error instanceof DotNetException) return describeException(error);
  throw error;
}

export interface ExportOutcome {
  requests: string[];
  actions: string[];
  stoppedByStub: boolean;
  thrown: ProbedException | null;
}

/** Runs the request part of `Export` (the fetch) for one item and reports what the stub saw. */
export async function exportOnce(
  helper: CItemHelper,
  stub: StubConnection,
  item: ExportItem,
  level: string | null | undefined,
  run: ExportRunState,
): Promise<ExportOutcome> {
  const before = stub.requests.length;
  let thrown: ProbedException | null = null;
  let stoppedByStub = false;
  try {
    await new CExportItems(helper, {}, run).fetch(item, level);
  } catch (error) {
    if (error instanceof StubStop) stoppedByStub = true;
    else thrown = describeThrown(error);
  }
  return { requests: stub.requests.slice(before), actions: stub.actions.slice(before), stoppedByStub, thrown };
}

export const runState = (requestDictionary: RequestDictionary | null = newRequestDictionary(), elements: PackageElementMap | null = newElements()): ExportRunState => ({
  requestDictionary,
  packageElementIdsByElementType: elements,
});
