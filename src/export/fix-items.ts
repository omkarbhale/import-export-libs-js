import { ELEMENT_NODE, innerText } from "../xml/index.js";
import type { XmlDocument, XmlElement, XmlNode } from "../xml/index.js";
import { attributeOf, childElements, childText, firstChildElement, isItemOfType } from "./source.js";
import { STOCK_ROWS, deviatesFromStock } from "./system-properties.js";
import { SYSTEM_PROPERTIES, containsEntry } from "./system-names.js";

/**
 * Reading the source for the `mode="fix"` items that the root template appends after the root Item: which Properties the
 * ItemType edit carries, what the View and Form deletes name, and what the Field fixes say. These are the XPath selections of
 * `export.xsl`'s root template and fix templates; the transform writes what they select.
 *
 * @spec EXP-320 EXP-321 EXP-322 EXP-324 EXP-325 EXP-330 EXP-340
 */

/** The Items of `Relationships/Item[@type='T']`: the typed children of every `Relationships` child, in document order. */
export function relationshipItems(parent: XmlNode, type: string): XmlElement[] {
  return childElements(parent, "Relationships").flatMap((relationships) =>
    childElements(relationships, "Item").filter((item) => attributeOf(item, "type") === type),
  );
}

/** The embedded Items of a path such as `relationship_id/Item`: the `Item` children of every child of that name. */
function embeddedItems(parent: XmlNode, name: string): XmlElement[] {
  return childElements(parent, name).flatMap((element) => childElements(element, "Item"));
}

/** `concat('|', name, '|')` found in the list, with `name` the string-value of the first `name` child (EXP-301). */
function isSystemName(property: XmlElement): boolean {
  return containsEntry(SYSTEM_PROPERTIES, childText(property, "name"));
}

/**
 * The ItemTypes the root template fixes: the root ItemType, or the ItemTypes in the `relationship_id` of a RelationshipType.
 * @spec EXP-325
 */
export function fixedItemTypes(root: XmlElement): XmlElement[] {
  const type = attributeOf(root, "type");
  if (type === "ItemType") return [root];
  if (type === "RelationshipType") return embeddedItems(root, "relationship_id").filter((item) => attributeOf(item, "type") === "ItemType");
  return [];
}

/**
 * The keyed Properties K: keyed, and not named for a system property (the substring test).
 * @spec EXP-321
 */
export function keyedProperties(itemType: XmlElement): XmlElement[] {
  return relationshipItems(itemType, "Property").filter(
    (property) => childElements(property, "is_keyed").some((e) => innerText(e) === "1") && !isSystemName(property),
  );
}

/**
 * The modified system Properties M: each Property once, in document order, selected by its name and values (a) or by having
 * content in its own `Relationships` (b).
 * @spec EXP-322 EXP-323 EXP-392
 */
export function modifiedSystemProperties(itemType: XmlElement): XmlElement[] {
  const versionable = childElements(itemType, "is_versionable").some((e) => innerText(e) === "1");
  return relationshipItems(itemType, "Property").filter((property) => {
    const byValues = childElements(property, "name").some((name) => {
      const key = innerText(name);
      if (!Object.hasOwn(STOCK_ROWS, key)) return false;
      const row = STOCK_ROWS[key]!;
      return (!row.versionable || versionable) && deviatesFromStock(property, row);
    });
    if (byValues) return true;
    // `Relationships[child::node()]`: any node counts, whitespace and comments too (EXP-392)
    return isSystemName(property) && childElements(property, "Relationships").some((relationships) => relationships.firstChild !== null);
  });
}

/** The attributes the ItemType edit gives a Property item, after `type` (EXP-324). */
export interface PropertyFixAttributes {
  /** Whether the source `id` is copied. */
  id: boolean;
  action?: "add" | "edit";
  where?: string;
}

/**
 * The first case of EXP-324 that applies to a Property of the ItemType edit.
 * @spec EXP-324 EXP-390
 */
export function propertyFixAttributes(property: XmlElement): PropertyFixAttributes {
  const name = childText(property, "name");
  const changeControlled = childElements(property, "source_id").some(
    (e) => attributeOf(e, "keyed_name") === "Change Controlled Relationship",
  );
  if (containsEntry("|related_id|sort_order|source_id|", name) && changeControlled) return { id: true, action: "add" };
  if (containsEntry(SYSTEM_PROPERTIES, name)) {
    return { id: false, action: "edit", where: `source_id='${childText(property, "source_id")}' and name='${name}'` };
  }
  if (childElements(property, "is_keyed").some((e) => innerText(e) === "1")) return { id: true, action: "add" };
  return { id: false };
}

/** What the View and Form delete items name (EXP-330). */
export interface ViewFormDelete {
  id: string;
  name: string;
}

/**
 * The delete pairs of the root Item, in order: T1, for an ItemType with no View of its own, then T2, for an Item embedded in a
 * `relationship_id` whose own relationships have no View. The two tests are independent.
 *
 * @spec EXP-330 EXP-390
 */
export function viewFormDeletes(root: XmlElement): ViewFormDelete[] {
  const deletes: ViewFormDelete[] = [];
  if (attributeOf(root, "type") === "ItemType" && relationshipItems(root, "View").length === 0) {
    deletes.push({ id: attributeOf(root, "id") ?? "", name: childText(root, "name") });
  }
  const embedded = embeddedItems(root, "relationship_id");
  if (embedded.length > 0 && !embedded.some((item) => relationshipItems(item, "View").length > 0)) {
    // `{relationship_id/Item/@id}` and `{relationship_id/Item/name}` read the first node of their node-set
    const id = embedded.map((item) => attributeOf(item, "id")).find((value) => value !== undefined);
    const name = embedded.map((item) => firstChildElement(item, "name")).find((element) => element !== undefined);
    deletes.push({ id: id ?? "", name: name ? innerText(name) : "" });
  }
  return deletes;
}

/** Every element of the document, in document order. */
function* descendants(node: XmlNode): Generator<XmlElement> {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== ELEMENT_NODE) continue;
    yield child as XmlElement;
    yield* descendants(child);
  }
}

/**
 * The Fields to fix: `//Item[@type='Field']` anywhere in the document, whose `propertytype_id` `keyed_name` (the first attribute of
 * that name among the children) is a system property name.
 *
 * @spec EXP-340
 */
export function fieldsToFix(doc: XmlDocument): XmlElement[] {
  const fields: XmlElement[] = [];
  for (const element of descendants(doc)) {
    if (!isItemOfType(element, "Field")) continue;
    const keyedName = childElements(element, "propertytype_id")
      .map((e) => attributeOf(e, "keyed_name"))
      .find((value) => value !== undefined);
    if (containsEntry(SYSTEM_PROPERTIES, keyedName ?? "")) fields.push(element);
  }
  return fields;
}

/** What a Field fix says about the property: the first value found in the embedded Items (EXP-340). */
export interface FieldFix {
  name: string;
  source: string;
  type: string;
  keyedName: string;
}

/**
 * `propertytype_id/Item/name`, `…/source_id` and `…/source_id/@type` and `@keyed_name`, each the first node in document order.
 * @spec EXP-340
 */
export function fieldFix(field: XmlElement): FieldFix {
  const items = embeddedItems(field, "propertytype_id");
  const sources = items.flatMap((item) => childElements(item, "source_id"));
  const name = items.map((item) => firstChildElement(item, "name")).find((e) => e !== undefined);
  return {
    name: name ? innerText(name) : "",
    source: sources[0] ? innerText(sources[0]) : "",
    type: sources.map((e) => attributeOf(e, "type")).find((v) => v !== undefined) ?? "",
    keyedName: sources.map((e) => attributeOf(e, "keyed_name")).find((v) => v !== undefined) ?? "",
  };
}
