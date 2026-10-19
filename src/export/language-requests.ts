import { relationshipRows } from "../client/answer.js";
import { DotNetException, nullReference } from "../client/dotnet.js";
import { getProperty } from "../client/fault.js";
import type { CItemHelper } from "../client/item-helper.js";
import { EXPORT_ACTION, LANGUAGE_RESOURCES_ONLY, LANGUAGE_RESOURCES_WITH_METADATA } from "./export-context.js";
import { IomItem } from "./iom-item.js";

/**
 * What the language modes add to the request builders: the action of the run and the language list the manager resolved (LP-110).
 * With the action `Export` the list is ignored (LP-124).
 */
export interface LanguageRequests {
  readonly action: string;
  readonly languages: readonly string[] | null;
}

/** A plain export: no language work in any request. */
export const PLAIN_EXPORT: LanguageRequests = { action: EXPORT_ACTION, languages: null };

/** The text `string.Join(",", names)` makes: a null name is an empty string. */
const join = (names: ReadonlyArray<string | null>): string => names.map((name) => name ?? "").join(",");

/** `GetAdditionalSelectString`: an `ItemType` row also selects `name` and `is_versionable` (LP-122). */
export const additionalSelect = (type: string | null): string => (type === "ItemType" ? ",name,is_versionable" : "");

/**
 * `GetMultilangualPropertyNamesForItemType(typeName, languages)`: the names of the type's ml_string properties as the server
 * answers them, then the suffixed names (LP-120, LP-121). The lookup is never cached, so every call sends it again (LP-126).
 *
 * - A type with no ml_string property gets the fault with code 0 and gives an empty list.
 * - Any other answer without a `Relationships/Item` makes IOM read `name` from an empty set of items and throw `Not a single item`
 *   (LP-182); that is not an exception `Export` wraps.
 * - A null list of languages throws `NullReferenceException` only when the type has names (LP-120).
 *
 * @spec LP-120 LP-121 LP-126 LP-127 LP-182 LP-184
 */
export async function multilingualPropertyNames(
  helper: CItemHelper,
  typeName: string | null,
  languages: readonly string[] | null,
): Promise<Array<string | null>> {
  const lookup = IomItem.newItem("ItemType", "get");
  lookup.setAttribute("select", "id");
  lookup.setProperty("name", typeName);
  const property = IomItem.newItem("Property", "get");
  property.setAttribute("select", "name");
  property.setProperty("data_type", "ml_string");
  lookup.addRelationship(property);

  const response = await helper.inn.applyItem(lookup.toXml());
  const rows = relationshipRows(response);
  const names: Array<string | null> = rows.map((row) => getProperty(row, "name"));
  if (rows.length === 0 && (!response.isError || !response.isEmpty)) {
    throw new DotNetException("System.Exception", "Not a single item");
  }

  const suffixed: Array<string | null> = [];
  for (const name of names) {
    if (languages === null) throw nullReference();
    for (const language of languages) {
      if (language !== "en") suffixed.push(`${name ?? ""}_${language}`);
    }
  }
  return [...names, ...suffixed];
}

const isOnly = (mode: LanguageRequests): boolean => mode.action === LANGUAGE_RESOURCES_ONLY;
const isMetadata = (mode: LanguageRequests): boolean => mode.action === LANGUAGE_RESOURCES_WITH_METADATA;

/**
 * The select of the root of a node of the relationship tree (LP-122 step 2, LP-123 step 1), or undefined when the action is not a
 * language mode. The lookup is sent first.
 *
 * @spec LP-122 LP-123 LP-126 LP-184
 */
export async function nodeSelect(helper: CItemHelper, type: string | null, mode: LanguageRequests): Promise<string | undefined> {
  if (isOnly(mode)) {
    const names = await multilingualPropertyNames(helper, type, mode.languages);
    return names.length > 0 ? `${join(names)},config_id,relationship_id,related_id${additionalSelect(type)}` : "id,config_id,relationship_id,related_id";
  }
  if (isMetadata(mode)) {
    const names = await multilingualPropertyNames(helper, type, mode.languages);
    return names.length > 0 ? `${join(names)},*[is_not_null()]` : "*[is_not_null()]";
  }
  return undefined;
}

/**
 * The select of a relationship row that is not expanded (LP-122 step 3, LP-123 step 2), or undefined when the row has none.
 *
 * @spec LP-122 LP-123 LP-126 LP-184
 */
export async function rowSelect(helper: CItemHelper, type: string | null, mode: LanguageRequests): Promise<string | undefined> {
  if (isOnly(mode)) {
    const names = await multilingualPropertyNames(helper, type, mode.languages);
    if (type === "Property") return names.length > 0 ? `${join(names)},*[is_not_null()]` : undefined;
    return names.length > 0 ? `${join(names)},related_id${additionalSelect(type)}` : "id,config_id,relationship_id,related_id";
  }
  if (isMetadata(mode)) {
    const names = await multilingualPropertyNames(helper, type, mode.languages);
    return names.length > 0 ? `${join(names)},*[is_not_null()]` : undefined;
  }
  return undefined;
}

/**
 * The select `GetRelationshipRequestByExistingDocument` sets on an element of a body, or undefined when the element keeps the
 * attributes it has (LP-125).
 *
 * @spec LP-125 LP-126 LP-184
 */
export async function documentSelect(helper: CItemHelper, type: string, mode: LanguageRequests): Promise<string | undefined> {
  if (isOnly(mode)) {
    const names = await multilingualPropertyNames(helper, type, mode.languages);
    if (type === "Property") return names.length > 0 ? `${join(names)},*[is_not_null()]` : undefined;
    return names.length > 0 ? `${join(names)},config_id,relationship_id,related_id${additionalSelect(type)}` : "id,config_id,relationship_id,related_id";
  }
  if (isMetadata(mode)) {
    const names = await multilingualPropertyNames(helper, type, mode.languages);
    return names.length > 0 ? `${join(names)},*[is_not_null()]` : undefined;
  }
  return undefined;
}

/**
 * The selects of every `Item` of a body, the root first, in the order the engine visits them (LP-125). Each visit sends its own
 * lookup. With the action `Export` no element is visited and nobody gets a select.
 */
export async function documentSelects(helper: CItemHelper, types: readonly string[], mode: LanguageRequests): Promise<Array<string | undefined>> {
  if (!isOnly(mode) && !isMetadata(mode)) return types.map(() => undefined);
  const selects: Array<string | undefined> = [];
  for (const type of types) selects.push(await documentSelect(helper, type, mode));
  return selects;
}
