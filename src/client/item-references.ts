import { ATTRIBUTE_NODE, CDATA_SECTION_NODE, ELEMENT_NODE, TEXT_NODE, innerText as domInnerText, removeChild, setInnerText } from "../xml/dom.js";
import type { XmlDocument, XmlElement as DomElement, XmlNode } from "../xml/dom.js";
import { selectNodes, selectSingleNode } from "../xml/xpath.js";
import { nullReference, trimWhiteSpace } from "./dotnet.js";
import { CItemException } from "./fault.js";
import type { ItemLookups } from "./item-lookups.js";
import { attributeOf, childElements, innerText } from "./mini-xml.js";

/** What the rewrites of a response need of the helper that owns them. */
export interface ReferencesHost {
  readonly lookups: ItemLookups;
}

const UNABLE_TO_FIND_ID = "Unable to find ID of the related item";

/** The id of an item as the engine reads it: 32 characters of `0-9` and upper-case `A-F`, nothing else. */
const ID_PATTERN = /^[0-9A-F]{32}$/;

/**
 * `IsValueId`: whether a (trimmed) value is an id.
 *
 * @spec EXP-116
 */
export function isValueId(value: string): boolean {
  return ID_PATTERN.test(value);
}

/** The `Attributes[name]` of a DOM element, or undefined when it has none. */
const attributeValue = (element: DomElement, name: string): string | undefined => element.getAttributeNode(name)?.value;

/** `Attributes[name].Value`: a missing attribute is the engine's `NullReferenceException`. */
function requiredAttribute(element: DomElement, name: string): string {
  const value = attributeValue(element, name);
  if (value === undefined) throw nullReference();
  return value;
}

/** `XmlNode.InnerText = value` for whatever node an XPath selected. */
function setNodeText(node: XmlNode, value: string): void {
  if (node.nodeType === ELEMENT_NODE) setInnerText(node as DomElement, value);
  else if (node.nodeType === ATTRIBUTE_NODE) (node as unknown as { value: string }).value = value;
  else if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) (node as unknown as { data: string }).data = value;
}

/**
 * The part of the engine's `CItemHelper` that reads and rewrites the references in an answer's DOM: the id of a related item,
 * the collapse of related items of independent ItemTypes, and the float item properties. The lookups they make go through
 * the helper's request cache (`ItemLookups`).
 *
 * @spec EXP-113 EXP-114 EXP-115 EXP-116
 */
export class ItemReferences {
  constructor(private readonly host: ReferencesHost) {}

  /**
   * `GetRelatedItemConfigId`: the id a `related_id` element stands for. An `Item` inside it gives its id (looked up by its unique
   * key when it has none, or when it is a `get`), replaced by the config id when its type is versionable; an element without
   * an `Item` gives its text. No id at all is a `CItemException`.
   *
   * @spec EXP-114
   */
  async getRelatedItemConfigId(relatedId: DomElement): Promise<string> {
    const lookups = this.host.lookups;
    const item = selectSingleNode("./Item", relatedId) as DomElement | null;
    let text: string | null;
    if (item) {
      if (attributeValue(item, "action") === "get") {
        text = await lookups.getCurrentIdByUniqueKey(item, false);
      } else {
        const id = attributeValue(item, "id");
        text = id !== undefined && trimWhiteSpace(id) !== "" ? id : await lookups.getCurrentIdByUniqueKey(item, true);
      }
      const type = requiredAttribute(item, "type");
      if (await lookups.isVersionable(type)) {
        const configId = selectSingleNode("./config_id", item);
        text = configId ? domInnerText(configId) : await lookups.getConfigId(text ?? "", type);
      }
    } else {
      text = domInnerText(relatedId);
    }
    if (text === null || text === "") throw new CItemException(-1, UNABLE_TO_FIND_ID, UNABLE_TO_FIND_ID);
    return text;
  }

  /**
   * `processIndependentRelatedItems`: every full related item of an independent ItemType is collapsed to its id (to its config id
   * when the relationship's behavior is a float one). The items are selected first and visited in that order, so one that sits
   * inside an item already collapsed is still visited, on the detached copy (EXP-115).
   *
   * @spec EXP-113 EXP-115
   */
  async processIndependentRelatedItems(doc: XmlDocument): Promise<void> {
    const selected = selectNodes(
      ".//Relationships/Item[@type!='ITPresentationConfiguration']/related_id[@type!='Identity' and @type!='Method' and @type!='SSVCPresentationConfiguration' and @type!='cmf_TabularViewHeaderRow']/Item[@id!='']",
      doc,
    ) as DomElement[];
    for (const related of selected) {
      const relatedId = related.parentNode as DomElement;
      const relationship = relatedId.parentNode as DomElement;
      const metadata = await this.host.lookups.relatedItemMetadata({
        relatedItemType: requiredAttribute(relatedId, "type"),
        relationshipType: requiredAttribute(relationship, "type"),
      });
      if (metadata.isDependent) continue;
      const text = (metadata.behavior ?? "").includes("float") ? await this.getRelatedItemConfigId(relatedId) : requiredAttribute(related, "id");
      removeChild(relatedId, related);
      setInnerText(relatedId, text);
    }
  }

  /**
   * `ProcessPropertiesOfTypeItem`: for an item and, below it, every `Item` that is a child of a child element, the values of its
   * float item properties that hold an id are replaced by the config id of that item.
   *
   * @spec EXP-116
   */
  async processPropertiesOfTypeItem(item: DomElement): Promise<void> {
    const lookups = this.host.lookups;
    const rows = await lookups.getCustomFloatPropertiesOfTypeItem(requiredAttribute(item, "type"));
    for (const row of rows) {
      const dataSource = childElements(row, "data_source")[0];
      if (!dataSource) continue;
      const isNull = attributeOf(dataSource, "is_null");
      if (isNull !== undefined && trimWhiteSpace(isNull) === "1") continue;
      const dataSourceName = attributeOf(dataSource, "name");
      if (dataSourceName === undefined) continue;
      if (!(await lookups.isVersionable(dataSourceName))) continue;
      const nameElement = childElements(row, "name")[0];
      if (!nameElement) throw nullReference();
      const property = selectSingleNode(innerText(nameElement), item);
      if (!property) continue;
      const value = domInnerText(property);
      if (isValueId(trimWhiteSpace(value))) setNodeText(property, (await lookups.getConfigId(value, dataSourceName)) ?? "");
    }
    for (const child of selectNodes("*/Item", item) as DomElement[]) await this.processPropertiesOfTypeItem(child);
  }
}
