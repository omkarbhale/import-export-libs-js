import { DEFAULT_ENGINE, type Engine } from "../engines.js";
import { CItemException } from "../client/fault.js";
import { EngineNotSupportedError } from "../client/item-helper.js";
import { CDATA_SECTION_NODE, ELEMENT_NODE, TEXT_NODE, innerText } from "../xml/index.js";
import type { XmlDocument, XmlElement, XmlNode } from "../xml/index.js";
import { isDroppedElement, isDroppedProperty } from "./drops.js";
import {
  fieldFix,
  fieldsToFix,
  fixedItemTypes,
  keyedProperties,
  modifiedSystemProperties,
  propertyFixAttributes,
  relationshipItems,
  viewFormDeletes,
} from "./fix-items.js";
import { OutputWriter } from "./output.js";
import {
  attributeOf,
  attributeText,
  childElements,
  childText,
  copiedAttributes,
  firstChildElement,
  isItemOfType,
  isNamed,
  namespacesCopiedWith,
  parentElement,
} from "./source.js";
import { SYSTEM_IDENTITIES, SYSTEM_PROPERTIES, containsEntry } from "./system-names.js";

/**
 * The export transform: `export.xsl`, re-expressed as code. `ApplyXsl` runs the stylesheet over the response document. Each
 * function below is a template of the stylesheet (or a named template), tested in the order of the rules in
 * spec/export-transform.md: the root wrapper, the Items and the reference rewrites (part 1), then the drops (drops.ts) and the
 * `mode="fix"` items that follow the root Item (part 2). What those templates select in the source is read in fix-items.ts.
 *
 * The stylesheet's template selection is by priority (EXP-202). No two templates of this module can match one node with a
 * different result (EXP-370), so they are tested in any order.
 *
 * @spec EXP-200 EXP-201 EXP-202 EXP-203 EXP-260 EXP-300 EXP-370
 */

/** The engines whose export transform is built; the rest wait for their variant slices. */
export const TRANSFORM_ENGINES: readonly Engine[] = ["14.0.7", "14.35"];

/** Parent Item type and element name of the properties that hold a Method (EXP-236). */
const METHOD_PROPERTIES: readonly (readonly [string, string])[] = [
  ["Report", "method"],
  ["Life Cycle Transition", "pre_action"],
  ["Life Cycle Transition", "post_action"],
  ["Action", "method"],
  ["Action", "on_complete"],
  ["View", "method"],
  ["tp_XmlSchemaElement", "content_generator"],
];

/** Parent Item type and element name of the properties that hold an Identity (EXP-231). */
const IDENTITY_PROPERTIES: readonly (readonly [string, string])[] = [
  ["View", "role"],
  ["Activity Template", "escalate_to"],
  ["Activity Template Assignment", "escalate_to"],
  ["Activity Template EMail", "alternate_identity"],
  ["Life Cycle Transition", "role"],
  ["Workflow Map", "process_owner"],
];

/** The Items above a FileSelectorTemplate `reference`, nearest first, each in the `Relationships` of the next (EXP-254). */
const REFERENCE_ANCESTORS: readonly string[] = ["FileSelectorTemplate", "FeedTemplate", "DiscussionTemplate", "ItemType"];

/**
 * `XslCompiledTransform.Transform` of `export.xsl` over a response document: the text the transform writes, before the
 * SOAP-ENV declaration is removed and the text is loaded again. An invalid character in the output throws `ArgumentException`.
 *
 * @spec EXP-201 EXP-210 EXP-211
 */
export function transformExport(doc: XmlDocument, engine: Engine = DEFAULT_ENGINE): string {
  if (!TRANSFORM_ENGINES.includes(engine)) throw new EngineNotSupportedError(engine);
  const transform = new ExportTransform(engine);
  transform.documentNode(doc);
  return transform.output.finish();
}

/**
 * The transform step of `CItemHelper.ApplyXsl`: a failure is reported as a `CItemException` with faultcode -1, whose message is the
 * original one followed by ` Error of  applying export.xsl.` (two spaces after `of`).
 *
 * @spec EXP-201
 */
export function applyExportTransform(doc: XmlDocument, engine: Engine = DEFAULT_ENGINE): string {
  try {
    return transformExport(doc, engine);
  } catch (error) {
    if (error instanceof EngineNotSupportedError) throw error;
    const message = `${error instanceof Error ? error.message : String(error)} Error of  applying export.xsl.`;
    throw new CItemException(-1, message, message, error);
  }
}

/**
 * The 14.35 template `node()[@is_null='1'][not(starts-with(name(), 'xp-'))]`, which writes nothing: an element whose own `is_null`
 * is exactly the string `1` is dropped with its attributes, text and descendants, unless its qualified name starts with `xp-`
 * (case-sensitive).
 *
 * @spec EXP-380
 */
function isNullDropped(element: XmlElement): boolean {
  return attributeOf(element, "is_null") === "1" && !element.tagName.startsWith("xp-");
}

class ExportTransform {
  readonly output = new OutputWriter();

  /** 14.35 has the `is_null` drop (EXP-380) and the `export_has_translations` alternative (EXP-381); 14.0.7 has neither. */
  private readonly is1435: boolean;

  constructor(engine: Engine) {
    this.is1435 = engine === "14.35";
  }

  /** The document being transformed: the Field fixes select Items anywhere in it (EXP-340). */
  private doc!: XmlDocument;

  /** The template for `/`: only the Envelope children are visited (EXP-210). */
  documentNode(doc: XmlDocument): void {
    this.doc = doc;
    for (let child = doc.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === ELEMENT_NODE && (child as XmlElement).localName === "Envelope") this.envelope(child as XmlElement);
    }
  }

  /**
   * Any element called `Envelope`, in any namespace, at any depth, and then `Body`, are templates of their own: the one visits its
   * `Body` children and the other its `Result` children (EXP-210).
   * @spec EXP-210
   */
  private envelope(element: XmlElement): void {
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === ELEMENT_NODE && (child as XmlElement).localName === "Body") this.body(child as XmlElement);
    }
  }

  private body(element: XmlElement): void {
    for (const result of childElements(element, "Result")) this.result(result);
  }

  /** `Result` anywhere: each of its `Item` children is a root Item, and nothing else is visited (EXP-210, EXP-213). */
  private result(element: XmlElement): void {
    for (const item of childElements(element, "Item")) this.rootItem(item);
  }

  /**
   * The root Item, in its own `<AML>` wrapper, with attributes rebuilt and then its children (EXP-211, EXP-212).
   * @spec EXP-211 EXP-212 EXP-213 EXP-214
   */
  private rootItem(item: XmlElement): void {
    const out = this.output;
    out.startElement("AML");
    out.startElement(item.tagName, item.namespaceURI, namespacesCopiedWith(item));
    for (const name of ["type", "id"]) {
      const value = attributeOf(item, name);
      if (value !== undefined) out.attribute(name, value);
    }
    out.attribute("action", "add");
    const dependencyLevel = attributeOf(item, "dependencyLevel");
    if (dependencyLevel !== undefined) out.attribute("dependencyLevel", dependencyLevel);
    this.applyTemplates(item);
    out.endElement();
    this.followUpItems(item);
    out.endElement();
  }

  /** `xsl:apply-templates` without a select: every child node, in default mode (EXP-203). */
  private applyTemplates(parent: XmlNode): void {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      switch (child.nodeType) {
        case ELEMENT_NODE:
          this.element(child as XmlElement);
          break;
        case TEXT_NODE:
        case CDATA_SECTION_NODE:
          this.output.text((child as unknown as { data: string }).data);
          break;
        default:
          break;
      }
    }
  }

  /**
   * The template chosen for an element in default mode (EXP-202). A property template needs the Item above the element to be of its type.
   * @spec EXP-202 EXP-260 EXP-311 EXP-312 EXP-313 EXP-314 EXP-315 EXP-316 EXP-380
   */
  private element(element: XmlElement): void {
    // the last template of the stylesheet but one: it ties with every 0.5 template that matches such an element, and wins (EXP-260)
    if (this.is1435 && isNullDropped(element)) return;
    if (element.localName === "Envelope") return this.envelope(element);
    if (element.localName === "Body") return this.body(element);
    if (isNamed(element, "Result")) return this.result(element);
    if (isNamed(element, "Item")) return this.item(element);
    if (isDroppedElement(element)) return;

    const parent = parentElement(element);
    const owner = parent && isNamed(parent, "Item") ? parent : null;
    const ownerType = owner ? attributeOf(owner, "type") : undefined;
    if (owner && ownerType !== undefined) {
      if (METHOD_PROPERTIES.some(([type, name]) => type === ownerType && isNamed(element, name))) return this.methodProperty(element);
      if (IDENTITY_PROPERTIES.some(([type, name]) => type === ownerType && isNamed(element, name))) return this.identityProperty(element);
      if (ownerType === "Field" && isNamed(element, "propertytype_id")) return this.fieldPropertyType(element);
      if (ownerType === "Property" && isNamed(element, "data_source") && this.isForeign(owner)) return this.foreignDataSource(owner);
      if (ownerType === "Property" && isNamed(element, "foreign_property") && this.isForeign(owner)) return this.foreignProperty(owner);
    }
    if (isNamed(element, "reference") && this.isFileSelectorReference(element)) return this.fileSelectorReference(element);
    if (isNamed(element, "source_id") && parent && this.isGridEventOfProperty(parent)) return this.gridEventSource(element, parent);
    this.copyElement(element);
  }

  /**
   * The catch-all template: the element with all its attributes, and its children.
   * @spec EXP-221
   */
  private copyElement(element: XmlElement): void {
    this.startCopy(element);
    this.copyAttributes(element);
    this.applyTemplates(element);
    this.output.endElement();
  }

  private startCopy(element: XmlElement): void {
    this.output.startElement(element.tagName, element.namespaceURI, namespacesCopiedWith(element));
  }

  private copyAttributes(element: XmlElement): void {
    for (const { name, value } of copiedAttributes(element)) this.output.attribute(name, value);
  }

  // ---------------------------------------------------------------- Items

  /**
   * An `Item` in default mode: the specific templates, else the plain Item template. A dropped Item leaves its container in place (EXP-244).
   * @spec EXP-230 EXP-235 EXP-240 EXP-241 EXP-242 EXP-243 EXP-244 EXP-310
   */
  private item(item: XmlElement): void {
    const type = attributeOf(item, "type");
    const parent = parentElement(item);
    const parentName = parent?.tagName ?? "";
    if (type === "Identity" && parentName !== "" && parentName !== "Result") {
      return this.identity(attributeText(item, "id"), childText(item, "keyed_name"));
    }
    if (type === "Method" && parentName !== "" && parentName !== "Result") return this.methodItem(item);
    if (type === "Member" || type === "Morphae") return;
    if (type === "Item Action" && childElements(item, "related_id").some((e) => attributeOf(e, "keyed_name") === "SolutionConfig Export")) return;
    if (type === "RelationshipType" && parent && isNamed(parent, "Relationships")) {
      const owner = parentElement(parent);
      if (owner && isItemOfType(owner, "ItemType")) return;
    }
    if (type === "ItemType" && parent && isNamed(parent, "related_id")) {
      this.output.text(attributeText(item, "id"));
      return;
    }
    if (type === "Property" && isDroppedProperty(item)) return;
    this.plainItem(item);
  }

  /**
   * The plain Item template: `type`, `id` and `action="add"` are its attributes.
   * @spec EXP-220
   */
  private plainItem(item: XmlElement): void {
    const out = this.output;
    this.startCopy(item);
    for (const name of ["type", "id"]) {
      const value = attributeOf(item, name);
      if (value !== undefined) out.attribute(name, value);
    }
    out.attribute("action", "add");
    this.applyTemplates(item);
    out.endElement();
  }

  /**
   * The named template `Identity`: a system Identity is written as a `get`, anything else as its id (EXP-230).
   * @spec EXP-230 EXP-271
   */
  private identity(id: string, keyedName: string): void {
    const out = this.output;
    if (!containsEntry(SYSTEM_IDENTITIES, keyedName)) {
      out.text(id);
      return;
    }
    out.startElement("Item");
    out.attribute("type", "Identity");
    out.attribute("action", "get");
    out.attribute("select", "id");
    out.startElement("name");
    out.text(keyedName);
    out.endElement();
    out.endElement();
  }

  /**
   * A nested Method Item is replaced by a `get` by name.
   * @spec EXP-235
   */
  private methodItem(item: XmlElement): void {
    this.methodGet(childText(item, "name"));
  }

  private methodGet(name: string): void {
    const out = this.output;
    out.startElement("Item");
    out.attribute("type", "Method");
    out.attribute("action", "get");
    out.attribute("select", "id");
    out.startElement("name");
    out.text(name);
    out.endElement();
    out.endElement();
  }

  // ---------------------------------------------------------------- property templates

  /**
   * A property that holds a Method: the element, then a `get` of the Method named by its `keyed_name`.
   * @spec EXP-236 EXP-272
   */
  private methodProperty(element: XmlElement): void {
    this.startCopy(element);
    this.copyAttributes(element);
    this.methodGet(attributeText(element, "keyed_name"));
    this.output.endElement();
  }

  /**
   * A property that holds an Identity: the element, then the Identity template's result.
   * @spec EXP-231
   */
  private identityProperty(element: XmlElement): void {
    this.startCopy(element);
    this.copyAttributes(element);
    this.identity(innerText(element), attributeText(element, "keyed_name"));
    this.output.endElement();
  }

  /**
   * The `propertytype_id` of a Field: dropped for a system property, else the id of the Property (EXP-252).
   * @spec EXP-252 EXP-271
   */
  private fieldPropertyType(element: XmlElement): void {
    const properties = childElements(element, "Item").filter((e) => attributeOf(e, "type") === "Property");
    const name = properties.map((property) => firstChildElement(property, "name")).find((e) => e !== undefined);
    if (containsEntry(SYSTEM_PROPERTIES, name ? innerText(name) : "")) return;
    this.startCopy(element);
    this.copyAttributes(element);
    const items = childElements(element, "Item");
    if (items.length === 0) {
      this.output.text(innerText(element));
    } else {
      this.output.text(items.map((e) => attributeOf(e, "id")).find((id) => id !== undefined) ?? "");
    }
    this.output.endElement();
  }

  /** A Property with a `data_type` child equal to `foreign` (EXP-250). */
  private isForeign(property: XmlElement): boolean {
    return childElements(property, "data_type").some((e) => innerText(e) === "foreign");
  }

  /**
   * The sibling Properties whose `id` child equals a `data_source` of the foreign Property (`../../Item[@type='Property'][id=$data_source]`).
   */
  private dataSourceSiblings(property: XmlElement): XmlElement[] {
    const sources = childElements(property, "data_source").map((e) => innerText(e));
    const container = property.parentNode;
    if (!container) return [];
    return childElements(container, "Item").filter(
      (sibling) =>
        attributeOf(sibling, "type") === "Property" && childElements(sibling, "id").some((id) => sources.includes(innerText(id))),
    );
  }

  /**
   * The `data_source` of a foreign Property: a `get` of the Property it reads through (EXP-250).
   * @spec EXP-250
   */
  private foreignDataSource(property: XmlElement): void {
    const out = this.output;
    const name = this.dataSourceSiblings(property)
      .map((sibling) => firstChildElement(sibling, "name"))
      .find((e) => e !== undefined);
    out.startElement("data_source");
    out.startElement("Item");
    out.attribute("type", "Property");
    out.attribute("action", "get");
    out.attribute("select", "id");
    out.startElement("name");
    out.text(name ? innerText(name) : "");
    out.endElement();
    out.startElement("source_id");
    out.text(childText(property, "source_id"));
    out.endElement();
    out.endElement();
    out.endElement();
  }

  /**
   * The `foreign_property` of a foreign Property: a `get` that names it and the ItemType it is read from (EXP-251).
   * @spec EXP-251
   */
  private foreignProperty(property: XmlElement): void {
    const out = this.output;
    const keyedName = childElements(property, "foreign_property")
      .map((e) => attributeOf(e, "keyed_name"))
      .find((v) => v !== undefined);
    const itemType = this.dataSourceSiblings(property)
      .flatMap((sibling) => childElements(sibling, "data_source"))
      .map((e) => attributeOf(e, "name"))
      .find((v) => v !== undefined);
    out.startElement("foreign_property");
    out.startElement("Item");
    out.attribute("type", "Property");
    out.attribute("action", "get");
    out.attribute("select", "id");
    out.startElement("keyed_name");
    out.text(keyedName ?? "");
    out.endElement();
    out.startElement("source_id");
    out.startElement("Item");
    out.attribute("type", "ItemType");
    out.attribute("action", "get");
    out.attribute("select", "id");
    out.startElement("name");
    out.text(itemType ?? "");
    out.endElement();
    out.endElement();
    out.endElement();
    out.endElement();
    out.endElement();
  }

  /** A Grid Event, in the `Relationships` of an `Item` of type `Property` (EXP-253). */
  private isGridEventOfProperty(gridEvent: XmlElement): boolean {
    if (!isItemOfType(gridEvent, "Grid Event")) return false;
    const relationships = parentElement(gridEvent);
    const property = relationships ? parentElement(relationships) : null;
    return relationships !== null && isNamed(relationships, "Relationships") && property !== null && isItemOfType(property, "Property");
  }

  /**
   * The `source_id` of a Grid Event on a system property is a `get` of that Property (EXP-253).
   * @spec EXP-253 EXP-271
   */
  private gridEventSource(element: XmlElement, gridEvent: XmlElement): void {
    const out = this.output;
    const property = parentElement(parentElement(gridEvent) as XmlElement) as XmlElement;
    const name = childText(property, "name");
    if (!containsEntry(SYSTEM_PROPERTIES, name)) {
      this.copyElement(element);
      return;
    }
    out.startElement("source_id");
    out.startElement("Item");
    out.attribute("type", "Property");
    out.attribute("action", "get");
    out.attribute("select", "id");
    out.startElement("name");
    out.text(name);
    out.endElement();
    out.startElement("source_id");
    out.text(childText(property, "source_id"));
    out.endElement();
    out.endElement();
    out.endElement();
  }

  // ---------------------------------------------------------------- FileSelectorTemplate

  /** The `reference` of a FileSelectorTemplate below the ItemType, DiscussionTemplate and FeedTemplate chain (EXP-254). */
  private isFileSelectorReference(reference: XmlElement): boolean {
    let item = parentElement(reference);
    for (const [index, type] of REFERENCE_ANCESTORS.entries()) {
      if (!item || !isItemOfType(item, type)) return false;
      if (index === REFERENCE_ANCESTORS.length - 1) return true;
      const relationships = parentElement(item);
      if (!relationships || !isNamed(relationships, "Relationships")) return false;
      item = parentElement(relationships);
    }
    return false;
  }

  /**
   * The `reference` is written as a CDATA section whose text is not escaped (EXP-254).
   * @spec EXP-254 EXP-270
   */
  private fileSelectorReference(reference: XmlElement): void {
    const out = this.output;
    this.startCopy(reference);
    out.rawText("<![CDATA[");
    out.rawText(innerText(reference));
    out.rawText("]]>");
    out.endElement();
  }

  // ---------------------------------------------------------------- the items after the root Item

  /**
   * What the root template writes after the root Item copy, in the order of EXP-352: the ItemType edits, the View and Form
   * deletes, the Field fixes, then the Members and the Morphae of the root's own relationships.
   * @spec EXP-214 EXP-352 EXP-394
   */
  private followUpItems(root: XmlElement): void {
    for (const itemType of fixedItemTypes(root)) this.itemTypeEdit(itemType);
    for (const { id, name } of viewFormDeletes(root)) this.viewFormDelete(id, name);
    for (const field of fieldsToFix(this.doc)) this.fieldFix(field);
    for (const member of relationshipItems(root, "Member")) this.memberFix(member);
    for (const morphae of relationshipItems(root, "Morphae")) this.morphaeFix(root, morphae);
  }

  /**
   * A copy of an Item with the attributes `type`, `id` if it has one, and `action` (the fix templates' `xsl:copy`). It carries the
   * namespace declarations of its source, which its literal wrappers do not (EXP-362).
   * @spec EXP-362
   */
  private startFixCopy(item: XmlElement, action: string): void {
    this.startCopy(item);
    for (const name of ["type", "id"]) {
      const value = attributeOf(item, name);
      if (value !== undefined) this.output.attribute(name, value);
    }
    this.output.attribute("action", action);
  }

  /**
   * The second ItemType, which carries the keyed Properties and the modified system Properties the main pass dropped.
   * @spec EXP-320 EXP-321 EXP-322 EXP-381
   */
  private itemTypeEdit(itemType: XmlElement): void {
    const properties = [...keyedProperties(itemType), ...modifiedSystemProperties(itemType, this.is1435)];
    if (properties.length === 0) return;
    this.startFixCopy(itemType, "edit");
    this.output.startElement("Relationships");
    for (const property of properties) this.propertyFix(property);
    this.output.endElement();
    this.output.endElement();
  }

  /**
   * A Property of the ItemType edit: added with its id, or edited by its source and name (EXP-324). Its children are handled in
   * default mode, so the drops and the reference rewrites apply inside it.
   * @spec EXP-324 EXP-390
   */
  private propertyFix(property: XmlElement): void {
    const out = this.output;
    const attributes = propertyFixAttributes(property);
    this.startCopy(property);
    const type = attributeOf(property, "type");
    if (type !== undefined) out.attribute("type", type);
    const id = attributeOf(property, "id");
    if (attributes.id && id !== undefined) out.attribute("id", id);
    if (attributes.action) out.attribute("action", attributes.action);
    if (attributes.where !== undefined) out.attribute("where", attributes.where);
    this.applyTemplates(property);
    out.endElement();
  }

  /**
   * The pair of delete items for the View and Form the server generates. The id and the name are put into the clause as they are.
   * @spec EXP-330 EXP-390
   */
  private viewFormDelete(id: string, name: string): void {
    const out = this.output;
    out.startElement("Item");
    out.attribute("type", "View");
    out.attribute("action", "delete");
    out.attribute("where", `source_id='${id}'`);
    out.endElement();
    out.startElement("Item");
    out.attribute("type", "Form");
    out.attribute("action", "delete");
    out.attribute("where", `name='${name}'`);
    out.endElement();
  }

  /**
   * A Field whose data source is a system property: an edit that names the property again, behind a comment. The elements are
   * built from `value-of`, so an empty value is written as `<x></x>` (EXP-363).
   * @spec EXP-340 EXP-361 EXP-363
   */
  private fieldFix(field: XmlElement): void {
    const out = this.output;
    const fix = fieldFix(field);
    this.startFixCopy(field, "edit");
    out.comment(` Please note: this AML depends on the "${fix.keyedName}" ItemType. Please make sure it exists before running this. `);
    out.startElement("propertytype_id");
    out.startElement("Item");
    out.attribute("type", "Property");
    out.attribute("action", "get");
    out.attribute("select", "id");
    out.startElement("name");
    out.text(fix.name);
    out.endElement();
    out.startElement("source_id");
    out.attribute("type", fix.type);
    out.attribute("keyed_name", fix.keyedName);
    out.text(fix.source);
    out.endElement();
    out.endElement();
    out.endElement();
    out.endElement();
  }

  /**
   * A Member of the root, written again at the end so the Identities exist first.
   * @spec EXP-350
   */
  private memberFix(member: XmlElement): void {
    this.startFixCopy(member, "add");
    this.applyTemplates(member);
    this.output.endElement();
  }

  /**
   * A Morphae of the root, in an edit of the root's id whose type is always ItemType.
   * @spec EXP-351
   */
  private morphaeFix(root: XmlElement, morphae: XmlElement): void {
    const out = this.output;
    out.startElement("Item");
    out.attribute("type", "ItemType");
    out.attribute("id", attributeText(root, "id"));
    out.attribute("action", "edit");
    out.startElement("Relationships");
    this.startFixCopy(morphae, "add");
    this.applyTemplates(morphae);
    out.endElement();
    out.endElement();
    out.endElement();
  }
}
