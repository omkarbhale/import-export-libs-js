import { relationshipRows, resultItems } from "../client/answer.js";
import { parseInt32 } from "../client/dotnet.js";
import { getProperty } from "../client/fault.js";
import type { CItemHelper } from "../client/item-helper.js";
import { attributeOf, childElements } from "../client/mini-xml.js";
import { IomItem } from "./iom-item.js";
import { defaultSelect, requestedLevel, serverMajorOf } from "./main-fetch.js";
import { LANGUAGE_RESOURCES_ONLY, isLanguageMode } from "./export-context.js";
import { type LanguageRequests, PLAIN_EXPORT, documentSelects, nodeSelect, rowSelect } from "./language-requests.js";
import { type Body, cmfBodyOf, itemTypeBodyOf } from "./request-bodies.js";

/**
 * The request template of each type for one `ExportSolutions` call: the engine's `ConcurrentDictionary<string, Lazy<Item>>`. A
 * value is a promise that is made once, when the first item of the type asks for it. An exception that the factory throws is kept
 * with the value and thrown again to every later item of the type (EXP-060, EXP-062).
 */
export type RequestDictionary = Map<string, Promise<IomItem>>;

/** A new, empty dictionary: `ExportSolutions` makes one per call and hands it to every `Export` of the call (EXP-060). */
export function newRequestDictionary(): RequestDictionary {
  return new Map();
}

/** The depth of the relationship tree of each type with a row of its own (EXP-021). */
const TREE_DEPTHS: ReadonlyMap<string, number> = new Map<string, number>([
  ...["Action", "Identity", "List", "Method", "Permission", "RelationshipType", "Sequence", "UserMessage", "Workflow Promotion"].map((type): [string, number] => [type, 1]),
  ...["Grid", "User", "Preference"].map((type): [string, number] => [type, 2]),
  ...["qry_QueryDefinition", "rb_TreeGridViewDefinition", "xClassificationTree", "dac_DomainDefinition", "ac_PolicyAccessItemAttribute", "dr_RelationshipFamily"].map(
    (type): [string, number] => [type, 2],
  ),
  ...["Form", "Life Cycle Map", "Workflow Map"].map((type): [string, number] => [type, 3]),
]);

/**
 * The template of a type, from the dictionary or made now (EXP-060): `GetOrAdd(typeName, factory).Value`, with the type name compared
 * ordinally. The level of the type's first item decides, and the level of every later item is ignored.
 *
 * @spec EXP-060 EXP-062
 */
export function requestTemplate(
  dictionary: RequestDictionary,
  helper: CItemHelper,
  typeName: string,
  level: string | null | undefined,
  mode: LanguageRequests = PLAIN_EXPORT,
): Promise<IomItem> {
  let template = dictionary.get(typeName);
  if (template === undefined) {
    template = buildTemplate(helper, typeName, level, mode);
    // A rejection that nobody awaits yet is not a failure of the run: the first item awaits it, and a later item awaits it again.
    template.catch(() => undefined);
    dictionary.set(typeName, template);
  }
  return template;
}

/**
 * The factory of the dictionary: the switch of EXP-021 builds the template of the type as an IOM `Item`. A type with a tree sends
 * the tree's lookups now (EXP-061); `ItemType` and the cmf types carry their body; `Item Report` is bare with `related_expand`. In a
 * language mode the tree nodes and the body elements get the selects of LP-122 to LP-125, and the default select is added to the
 * types with no row of their own unless the mode is `ExportLanguageResourcesOnly` (LP-124).
 *
 * @spec EXP-021 EXP-022 EXP-023 EXP-024 EXP-025 EXP-026 EXP-065 LP-124 LP-125
 */
async function buildTemplate(helper: CItemHelper, typeName: string, level: string | null | undefined, mode: LanguageRequests): Promise<IomItem> {
  if (typeName === "Item Report") {
    const item = await relationshipsRequestByLevel(helper, typeName, 0, 0, mode);
    item.setAttribute("related_expand", "0");
    return item;
  }
  const depth = TREE_DEPTHS.get(typeName);
  if (depth !== undefined) return relationshipsRequestByLevel(helper, typeName, depth, 0, mode);
  if (typeName === "ItemType") return itemWithBody(helper, typeName, itemTypeBodyOf(serverMajorOf(helper.innovatorVersion)), mode);
  if (typeName === "cmf_ContentType" || typeName === "cmf_TabularView") return itemWithBody(helper, typeName, cmfBodyOf(typeName), mode);
  // a type with no row of its own: the level is an integer, and the parse is the first thing the template does (EXP-022)
  const parsed = parseInt32(requestedLevel(level));
  const item = await relationshipsRequestByLevel(helper, typeName, parsed, 0, mode);
  const select = mode.action === LANGUAGE_RESOURCES_ONLY ? undefined : defaultSelect(helper.innovatorVersion);
  if (select !== undefined) item.setAttribute("select", [item.getAttribute("select") ?? "", select].join(","));
  return item;
}

/**
 * A request item made from a body document (EXP-024, EXP-025): the `Relationships` of the body, and in a language mode the `select`
 * of every element of the document, the root first, each with its own lookup (LP-125).
 *
 * @spec LP-125
 */
async function itemWithBody(helper: CItemHelper, typeName: string, body: Body, mode: LanguageRequests): Promise<IomItem> {
  const item = IomItem.newItem(typeName, "get");
  if (!isLanguageMode(mode.action)) {
    item.appendRaw(body.text());
    return item;
  }
  const [rootSelect, ...bodySelects] = await documentSelects(helper, [typeName, ...body.types], mode);
  if (rootSelect !== undefined) item.setAttribute("select", rootSelect);
  item.appendRaw(body.text(bodySelects));
  return item;
}

/**
 * `GetRelationshipsRequestByLevel(typeName, depth, current, …)`: the tree of `typeName`, down to `depth` (EXP-061). `current` is
 * counted up first; past `depth` the node is returned bare. Otherwise two lookups are sent with `Item.apply()`, which never
 * throws for a fault: the related type of the item gets its own tree as `related_id`, and each relationship type is added to the node
 * as a tree, or bare at the last depth. A fault leaves the node without that part and the export goes on. In a language mode the node
 * gets the select of LP-122 or LP-123 between the two lookups, and each row gets its own before it is added or expanded.
 *
 * @spec EXP-061 LP-122 LP-123 LP-126
 */
export async function relationshipsRequestByLevel(helper: CItemHelper, typeName: string | null, depth: number, current: number, mode: LanguageRequests): Promise<IomItem> {
  const node = IomItem.newItem(typeName, "get");
  const level = current + 1;
  if (level > depth) return node;

  const related = await relatedTypeName(helper, typeName);
  if (related !== null) node.setPropertyItem("related_id", await relationshipsRequestByLevel(helper, related, depth, current, mode));

  const select = await nodeSelect(helper, typeName, mode);
  if (select !== undefined) node.setAttribute("select", select);

  for (const relationship of await relationshipTypeNames(helper, typeName)) {
    const row = IomItem.newItem(relationship, "get");
    const rowSelectText = await rowSelect(helper, relationship, mode);
    if (rowSelectText !== undefined) row.setAttribute("select", rowSelectText);
    node.addRelationship(level < depth ? await relationshipsRequestByLevel(helper, relationship, depth, level, mode) : row);
  }
  return node;
}

/**
 * The related-type lookup: the `data_source` of the item type's `related_id` property, by its `name` attribute. Only an answer that
 * holds exactly one Property counts; a fault, an empty answer, two Properties or a data source with no name give null.
 */
async function relatedTypeName(helper: CItemHelper, typeName: string | null): Promise<string | null> {
  const property = IomItem.newItem("Property", "get");
  property.setAttribute("select", "id");
  property.setAttribute("select", "data_source");
  property.setProperty("name", "related_id");
  const lookup = IomItem.newItem("ItemType", "get");
  lookup.setAttribute("select", "id");
  lookup.setProperty("name", typeName);
  lookup.addRelationship(property);

  const response = await helper.inn.applyItem(lookup.toXml());
  if (response.isError) return null;
  const rows = relationshipRows(response).filter((row) => attributeOf(row, "type") === "Property");
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) return null;
  const dataSource = childElements(row, "data_source")[0];
  const name = dataSource ? attributeOf(dataSource, "name") : undefined;
  return name === undefined || name === "" ? null : name;
}

/** The relationship lookup: the names of the relationship types whose source is `typeName`, in answer order. A row with no name is null. */
async function relationshipTypeNames(helper: CItemHelper, typeName: string | null): Promise<Array<string | null>> {
  const source = IomItem.newItem("ItemType", "get");
  source.setProperty("name", typeName);
  const lookup = IomItem.newItem("RelationshipType", "get");
  lookup.setAttribute("select", "name");
  lookup.setPropertyItem("source_id", source);

  const response = await helper.inn.applyItem(lookup.toXml());
  if (response.isError) return [];
  return resultItems(response).map((row) => getProperty(row, "name"));
}
