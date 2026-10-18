import { responseDom } from "../client/answer.js";
import { nullReference, trimWhiteSpace } from "../client/dotnet.js";
import type { ItemLookups } from "../client/item-lookups.js";
import { DEFAULT_ENGINE, type Engine } from "../engines.js";
import { ArgumentNullException } from "../io/errors.js";
import {
  appendChild,
  attributesOf,
  createElement,
  getInnerXml,
  htmlDecode,
  innerText,
  loadXml,
  removeChild,
  selectNodes,
  selectSingleNode,
  setInnerText,
  setInnerXml,
} from "../xml/index.js";
import type { XmlAttribute, XmlDocument, XmlElement, XmlNode } from "../xml/index.js";
import { applyExportTransform } from "./transform.js";

/** The text `ApplyXsl` removes from the transform's output (EXP-401). */
const SOAP_ENV_DECLARATION = 'xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"';

const SOAP = "http://schemas.xmlsoap.org/soap/envelope/";

/** The `Result` of an answer: the envelope's `Body` child, with both in the SOAP namespace or none (EXP-403). */
const RESULT =
  `*[local-name()='Envelope' and (namespace-uri()='${SOAP}' or namespace-uri()='')]` +
  `/*[local-name()='Body' and (namespace-uri()='${SOAP}' or namespace-uri()='')]` +
  `/*[local-name()='Result' and (namespace-uri()='${SOAP}' or namespace-uri()='')]`;

const asElement = (node: XmlNode | null): XmlElement | null => node as XmlElement | null;

/** The text of a node the path found, or undefined when there is none. */
const textOf = (node: XmlNode | null): string | undefined => (node ? innerText(node) : undefined);

/**
 * `CItemHelper.ApplyXsl(doc, "export.xsl")`: the transform of the response document, the removal of every
 * `xmlns:SOAP-ENV="…"` from its text, and the load of that text. A failure of the transform or the strip is a `CItemException`
 * (`applyExportTransform`); the load is outside that handler, so text the transform wrote that XML cannot read is the
 * `XmlException` of `LoadXml` (`Root element is missing.` when the transform wrote no element), which the export maps later.
 * The engine loads the text back into `doc`; the port returns the new document, which has `PreserveWhitespace` on. `build.xsl`
 * is `applyBuildXsl` (import).
 *
 * @spec EXP-401 EXP-402
 */
export function applyXsl(doc: XmlDocument | null, engine: Engine = DEFAULT_ENGINE): XmlDocument {
  if (doc === null) throw new ArgumentNullException("xmlDoc");
  const text = applyExportTransform(doc, engine).split(SOAP_ENV_DECLARATION).join("");
  return loadXml(text, { preserveWhitespace: true });
}

/**
 * `RemovePermissionIdWhenItMatchesToDefaultPermission`: for every `Item` in no namespace, in document order, the first
 * `permission_id` child goes when the type has no data (a failed lookup), when the type is a relationship that takes its
 * source's access, or when it names the type's default permission. A type whose answer lacks the data throws
 * `NullReferenceException`. The nodes around the removed one stay.
 *
 * @spec EXP-403 EXP-404
 */
export async function removePermissionIdWhenItMatchesToDefaultPermission(doc: XmlDocument, lookups: ItemLookups): Promise<void> {
  for (const node of selectNodes("//Item", doc)) {
    const item = node as XmlElement;
    const permissionId = selectSingleNode("permission_id", item);
    if (!permissionId) continue;
    const answer = await lookups.getItemTypeWithDefaultPermission(item.getAttributeNode("type")?.value ?? "");
    if (answer === null) {
      removeChild(item, permissionId);
      continue;
    }
    const result = selectSingleNode(RESULT, responseDom(answer));
    const isRelationship = textOf(result && selectSingleNode("Item/is_relationship", result));
    const useSrcAccess = textOf(result && selectSingleNode("Item/use_src_access", result));
    if (isRelationship === undefined || useSrcAccess === undefined) throw nullReference();
    if (isRelationship === "1" && useSrcAccess === "1") {
      removeChild(item, permissionId);
      continue;
    }
    const defaultId = result
      ? textOf(selectSingleNode("Item/Relationships/Item[@type='Allowed Permission']/related_id/Item[@type='Permission']/id", result))
      : undefined;
    if (defaultId === undefined) throw nullReference();
    if (defaultId === innerText(permissionId)) removeChild(item, permissionId);
  }
}

const FILTER_OPEN = "<filter_xml>";
const FILTER_OPEN_WRAPPED = "<filter_xml><![CDATA[";
const FILTER_CLOSE = "</filter_xml>";
const FILTER_CLOSE_WRAPPED = "]]]]><![CDATA[></filter_xml>";

/**
 * `CdataFilterXml(doc, name)`: the `name` child of every `Item` gets its `filter_xml` elements wrapped in CDATA, then its text
 * decoded as HTML. Each assignment of `InnerXml` parses the string again, so the child is rebuilt even when nothing was replaced.
 *
 * @spec EXP-405 EXP-406
 */
export function cdataFilterXml(doc: XmlDocument, name: string): void {
  for (const node of selectNodes("//Item", doc)) {
    const child = asElement(selectSingleNode(name, node));
    if (!child) continue;
    const source = getInnerXml(child);
    if (!source.includes(FILTER_OPEN_WRAPPED)) setInnerXml(child, source.split(FILTER_OPEN).join(FILTER_OPEN_WRAPPED));
    if (!getInnerXml(child).includes(FILTER_CLOSE_WRAPPED)) {
      setInnerXml(child, getInnerXml(child).split(FILTER_CLOSE).join(FILTER_CLOSE_WRAPPED));
    }
    setInnerXml(child, htmlDecode(getInnerXml(child)));
  }
}

/**
 * `CItemHelper.createAttr(doc, name, value)`: a new attribute with its value, not yet on any element.
 *
 * @spec EXP-407
 */
export function createAttr(doc: XmlDocument, name: string, value: string): XmlAttribute {
  const attribute = doc.createAttribute(name);
  attribute.value = value;
  return attribute;
}

/**
 * `ReplaceReferencesToPolyLists`: a Property that is a list and whose data source is named like a polymorphic ItemType gets a
 * `data_source` that looks the List up by name. The names are fetched first, for every item, whether or not it has a list
 * property (EXP-408). A property without a `data_source`, or a data source without `keyed_name`, throws `NullReferenceException`.
 *
 * @spec EXP-407 EXP-408 EXP-409
 */
export async function replaceReferencesToPolyLists(doc: XmlDocument, lookups: ItemLookups): Promise<void> {
  const polytypeNames = await lookups.getPolytypeNames();
  for (const node of selectNodes("//Item/Relationships/Item[@type='Property' and data_type='list']", doc)) {
    const property = node as XmlElement;
    const dataSource = asElement(selectSingleNode("data_source", property));
    const keyedName = dataSource?.getAttributeNode("keyed_name")?.value;
    if (!dataSource || keyedName === undefined) throw nullReference();
    if (trimWhiteSpace(keyedName).length === 0 || !polytypeNames.includes(keyedName)) continue;
    const replacement = createElement(doc, "data_source");
    replacement.setAttributeNode(createAttr(doc, "keyed_name", keyedName));
    const lookup = createElement(doc, "Item");
    for (const [name, value] of [["type", "List"], ["action", "get"], ["select", "id"], ["page", "1"], ["pagesize", "1"]] as const) {
      lookup.setAttributeNode(createAttr(doc, name, value));
    }
    const listName = createElement(doc, "name");
    setInnerText(listName, keyedName);
    appendChild(lookup, listName);
    appendChild(replacement, lookup);
    property.replaceChild(replacement, dataSource);
  }
}

/**
 * `RemoveNamespaceNodes`: every attribute of an `Item` in no namespace whose prefix is not empty goes: the declarations
 * `xmlns:i18n` and `xmlns:SOAP-ENV`, `xml:lang`, and attributes of any other namespace. The test for a null prefix never
 * holds, because .NET gives an unprefixed attribute the prefix `""`.
 *
 * @spec EXP-410 EXP-411
 */
export function removeNamespaceNodes(doc: XmlDocument): void {
  for (const node of selectNodes("//Item", doc)) {
    const item = node as XmlElement;
    const prefixed = attributesOf(item).filter((attribute) => trimWhiteSpace(attribute.prefix ?? "").length > 0);
    for (const attribute of prefixed) item.removeAttributeNode(attribute);
  }
}

/**
 * `RemoveEmptyRelationships`: every `Relationships` element in no namespace that has no child element, whatever else it holds,
 * is removed from its parent. The set is taken first, so a parent that becomes empty stays.
 *
 * @spec EXP-412
 */
export function removeEmptyRelationships(doc: XmlDocument | null): void {
  if (doc === null) throw new ArgumentNullException("doc");
  for (const node of selectNodes("//Relationships[not(*)]", doc)) {
    if (node.parentNode) removeChild(node.parentNode, node);
  }
}
