import { isNullOrWhiteSpace, nullReference } from "../client/dotnet.js";
import type { ArasVersion } from "../client/version.js";
import { cmfBody, itemTypeBody } from "./request-bodies.js";
import { element, textElement } from "../client/request-text.js";

/** How a type's main fetch is shaped: the `levels` it asks for, `related_expand`, and the body that follows the `<id>`. */
interface FetchShape {
  readonly levels?: string;
  readonly relatedExpandOff?: true;
  readonly body?: "itemType" | "cmf_ContentType" | "cmf_TabularView";
}

const levelsOf = (levels: string, types: readonly string[]): Array<[string, FetchShape]> => types.map((type) => [type, { levels }]);

/**
 * The per-type table of `CExportItems.Export`. The engine's `switch` on the type name compiles to a hash dispatch
 * confirmed by string equality, which is an ordinal, case-sensitive match, so a `Map` is exactly it.
 *
 * @spec EXP-021 EXP-026
 */
const SHAPES: ReadonlyMap<string, FetchShape> = new Map<string, FetchShape>([
  ["Item Report", { levels: "0", relatedExpandOff: true }],
  ...levelsOf("1", ["Action", "Identity", "List", "Method", "Permission", "RelationshipType", "Sequence", "UserMessage", "Workflow Promotion"]),
  ...levelsOf("2", ["Grid", "User", "Preference"]),
  ...levelsOf("2", [
    "qry_QueryDefinition",
    "rb_TreeGridViewDefinition",
    "xClassificationTree",
    "dac_DomainDefinition",
    "ac_PolicyAccessItemAttribute",
    "dr_RelationshipFamily",
  ]),
  ...levelsOf("3", ["Form", "Life Cycle Map", "Workflow Map"]),
  ["ItemType", { body: "itemType" }],
  ["cmf_ContentType", { body: "cmf_ContentType" }],
  ["cmf_TabularView", { body: "cmf_TabularView" }],
]);

const DEFAULT_SELECT = "xp-*($value, @explicit, @permission_id), *[is_not_null()]";

/**
 * The select of a type with no row of its own: sent when the server's major version is above 11, or is 11 with
 * service pack 12 or later, and left out otherwise. A helper that has not logged in has no version.
 *
 * @spec EXP-023
 */
export function defaultSelect(server: ArasVersion | undefined): string | undefined {
  if (!server) throw nullReference();
  return server.major > 11 || (server.major === 11 && server.servicePack >= 12) ? DEFAULT_SELECT : undefined;
}

/**
 * The level for a type with no row of its own: the level the caller passed, verbatim, or `1` when that is null,
 * empty or only white space.
 *
 * @spec EXP-022
 */
export function requestedLevel(level: string | null | undefined): string {
  return level === null || level === undefined || isNullOrWhiteSpace(level) ? "1" : level;
}

/**
 * The main fetch of an item (EXP-020): `<Item type action [levels] [related_expand] [select]><id>…</id>[body]</Item>`.
 * `id` is the current id for a versionable type, and the requested one otherwise.
 *
 * @spec EXP-003 EXP-020 EXP-021 EXP-022 EXP-023 EXP-024 EXP-025
 */
export function mainFetchRequest(typeName: string, id: string, level: string | null | undefined, server: ArasVersion | undefined): string {
  const attributes: Array<[string, string]> = [
    ["type", typeName],
    ["action", "get"],
  ];
  const shape = SHAPES.get(typeName);
  let body = "";
  if (!shape) {
    attributes.push(["levels", requestedLevel(level)]);
    const select = defaultSelect(server);
    if (select !== undefined) attributes.push(["select", select]);
  } else {
    if (shape.levels !== undefined) attributes.push(["levels", shape.levels]);
    if (shape.relatedExpandOff) attributes.push(["related_expand", "0"]);
    if (shape.body === "itemType") body = itemTypeBody(serverMajorOf(server));
    else if (shape.body) body = cmfBody(shape.body);
  }
  return element("Item", attributes, textElement("id", id) + body);
}

/** The major version the ItemType body is chosen by; a helper that has not logged in has none. */
export function serverMajorOf(server: ArasVersion | undefined): number {
  if (!server) throw nullReference();
  return server.major;
}
