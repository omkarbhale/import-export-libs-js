import { type XmlElement as DomElement, innerText as domInnerText } from "../xml/dom.js";
import { selectSingleNode } from "../xml/xpath.js";
import { childText, relationshipRows, resultItems } from "./answer.js";
import { isNullOrWhiteSpace, isXPathException, isXmlException, nullReference, tryParseInt32 } from "./dotnet.js";
import { CItemException, ResponseDocument, getProperty, loadXml, stackText } from "./fault.js";
import type { Innovator } from "./innovator.js";
import { type XmlElement, attributeOf, descendantElements } from "./mini-xml.js";
import { element, textElement } from "./request-text.js";
import type { ArasVersion } from "./version.js";

/** What the lookups need of the helper that owns them. */
export interface LookupHost {
  readonly inn: Innovator;
  readonly innovatorVersion: ArasVersion | undefined;
  /** `CItemHelper.applyAML` (WIRE-006): throws a `CItemException` for any fault, faultcode 0 included. */
  applyAML(aml: string): Promise<ResponseDocument>;
}

/** The two types a metadata lookup (`GetMetaDataInfo`) can ask about. */
export type MetadataType = "ItemType" | "RelationshipType";

/** A related item of an answer that the export asks metadata for, and the relationship that holds it (EXP-040). */
export interface IndependentRelatedItem {
  /** The `type` attribute of the `related_id` element. */
  readonly relatedItemType: string;
  /** The `type` attribute of the relationship `Item`. */
  readonly relationshipType: string;
}

/** What the two lookups of EXP-040 found out about one related item. */
export interface RelatedItemMetadata {
  readonly itemType: ResponseDocument;
  readonly isDependent: boolean;
  /** Present only when the related type is not dependent, which is when the second lookup is sent. */
  readonly relationshipType?: ResponseDocument;
  readonly behavior?: string;
}

/** What .NET prints for an `XmlAttribute`: the engine builds its "Unable to get definition" text from this by mistake (EXP-032). */
const XML_ATTRIBUTE_TYPE_NAME = "System.Xml.XmlAttribute";

/** The 14 `name` conditions of the float-property request, `created_by_id` twice as in the engine. */
const FLOAT_PROPERTY_EXCLUSIONS = [
  "config_id",
  "created_by_id",
  "source_id",
  "related_id",
  "locked_by_id",
  "modified_by_id",
  "created_by_id",
  "permission_id",
  "managed_by_id",
  "owned_by_id",
  "history_id",
  "id",
  "current_state",
  "team_id",
];

/** The `CItemException` (faultcode -1) a failed lookup turns into: the original's stack text and message, then `text`. */
function wrapped(error: unknown, text: string): CItemException {
  return new CItemException(-1, stackText(error), (error as Error).message + text, error);
}

/**
 * The export-side lookups of the engine's `CItemHelper`: the metadata lookups and their cache, the current id of a
 * versionable item, the unique-key, config id, float-property, default-permission and poly-type lookups, and the
 * dependency level of a relationship type. Every lookup is a read (`action='get'`). The texts interpolate names
 * and ids as they are, unescaped (EXP-004).
 *
 * @spec EXP-004 EXP-010 EXP-011 EXP-030 EXP-031 EXP-032 EXP-040 EXP-041 EXP-042 EXP-043 EXP-044 EXP-045 EXP-046 EXP-047
 */
export class ItemLookups {
  /** `_requestedItems`: the answers of the cached lookups, by their exact engine text, never emptied (EXP-030). */
  private readonly requestedItems = new Map<string, ResponseDocument>();
  /** The poly-type names: set before the request is sent and kept after a failure (EXP-046, EXP-047). */
  private polytypeNames: string[] | undefined;

  constructor(private readonly host: LookupHost) {}

  /**
   * `GetTypeAmlInner`: the cached answer for this text, or the answer to it. Only a successful answer is stored. A
   * "no items" fault gets a new detail, which names `System.Xml.XmlAttribute` where the type should be (EXP-032).
   *
   * @spec EXP-030 EXP-031 EXP-032
   */
  private async typeAmlInner(aml: string): Promise<ResponseDocument> {
    const cached = this.requestedItems.get(aml);
    if (cached) return cached;
    try {
      const response = await this.host.applyAML(aml);
      this.requestedItems.set(aml, response);
      return response;
    } catch (error) {
      if (error instanceof CItemException && error.faultcode === 0) {
        const name = childText(loadXml(aml).root, "name") ?? "";
        error.faultdetail = `Unable to get definition of ${XML_ATTRIBUTE_TYPE_NAME}: ${name}`;
      }
      throw error;
    }
  }

  /**
   * `GetMetaDataInfo`: the definition of an ItemType or RelationshipType by name. `criteria` is extra markup
   * before the `<name>`, which only the import side passes.
   *
   * @spec EXP-031
   */
  getMetaDataInfo(type: MetadataType, name: string, select = "", criteria = ""): Promise<ResponseDocument> {
    const selectAttribute = select === "" ? "" : ` select='${select}'`;
    return this.typeAmlInner(`<Item type='${type}'${selectAttribute} action='get'>${criteria}<name>${name}</name></Item>`);
  }

  /** `GetItemType(name, select)`. @spec EXP-031 */
  getItemType(name: string, select = ""): Promise<ResponseDocument> {
    return this.getMetaDataInfo("ItemType", name, select);
  }

  /** `GetRelationshipType(name, select)`. @spec EXP-031 */
  getRelationshipType(name: string, select = ""): Promise<ResponseDocument> {
    return this.getMetaDataInfo("RelationshipType", name, select);
  }

  /**
   * `IsVersionable`: whether the ItemType of that name is versionable, which is when its `is_versionable` is `1`.
   * An answer without the element is a `CItemException`.
   *
   * @spec EXP-010
   */
  async isVersionable(typeName: string): Promise<boolean> {
    const response = await this.getItemType(typeName, "is_versionable");
    const flag = childText(resultItems(response)[0], "is_versionable");
    if (flag === undefined) {
      const message = "Can't determine whether item versionable or not";
      throw new CItemException(-1, message, message);
    }
    return flag === "1";
  }

  /**
   * `GetCurrentIdOfVersion`: the id to fetch an item of a versionable type by. The item's own id when it is the
   * current generation, otherwise the id of the current generation of its config id.
   *
   * @spec EXP-011 EXP-055
   */
  async getCurrentIdOfVersion(id: string, type: string): Promise<string> {
    const failure = (error: unknown) => wrapped(error, `Unable to find a current version of the item (ID='${id}'; Type='${type}')`);

    let answer: ResponseDocument | undefined;
    try {
      answer = await this.host.applyAML(`<Item type='${type}' select='config_id, is_current' action='get'><id>${id}</id></Item>`);
    } catch (error) {
      if (!(error instanceof CItemException)) throw failure(error);
      if (error.faultcode !== 0) throw error;
    }

    let configId = id;
    let isCurrent = false;
    if (answer) {
      const item = resultItems(answer)[0];
      isCurrent = childText(item, "is_current")?.toLowerCase() === "1";
      const found = childText(item, "config_id");
      if (found === undefined) throw nullReference();
      configId = found;
    }
    if (isCurrent) return id;

    let current: ResponseDocument;
    try {
      current = await this.host.applyAML(`<Item type='${type}' select='id' action='get'><config_id>${configId}</config_id></Item>`);
    } catch (error) {
      throw failure(error);
    }
    const currentId = childText(resultItems(current)[0], "id");
    if (currentId === undefined) throw nullReference();
    return currentId;
  }

  /**
   * The two lookups that tell the export whether a related item is dependent and how its relationship behaves
   * (EXP-040): the related ItemType's `is_dependent, is_versionable`, and, when it is not dependent, the
   * RelationshipType's `behavior`. Both go through the metadata lookup and its cache.
   *
   * @spec EXP-040
   */
  async relatedItemMetadata(item: IndependentRelatedItem): Promise<RelatedItemMetadata> {
    const itemType = await this.getItemType(item.relatedItemType, "is_dependent, is_versionable");
    const dependent = childText(resultItems(itemType)[0], "is_dependent");
    if (dependent === undefined) throw nullReference();
    if (dependent === "1") return { itemType, isDependent: true };
    const relationshipType = await this.getRelationshipType(item.relationshipType, "behavior");
    const behavior = childText(resultItems(relationshipType)[0], "behavior");
    if (behavior === undefined) throw nullReference();
    return { itemType, isDependent: false, relationshipType, behavior };
  }

  /**
   * `GetUniqueProperties`: the keyed, required properties of a type other than `generation`. It is sent directly, so
   * an error answer is a `CItemException` with the answer's faultcode, and only a success is cached.
   *
   * @spec EXP-030 EXP-041
   */
  async getUniqueProperties(type: string): Promise<ResponseDocument> {
    const aml =
      `<Item type='ItemType' action='get' select='id'><name>${type}</name><Relationships>` +
      "<Item type='Property' action='get' select='name'><is_keyed>1</is_keyed><is_required>1</is_required>" +
      "<name condition='ne'>generation</name></Item></Relationships></Item>";
    const cached = this.requestedItems.get(aml);
    if (cached) return cached;
    const response = await this.host.inn.applyItem(aml);
    if (response.isError) {
      const text = `Failed to get unique properties for the ItemType '${type}. Error: ${response.errorString}'`;
      throw new CItemException(tryParseInt32(response.errorCode) ?? -1, text, text);
    }
    this.requestedItems.set(aml, response);
    return response;
  }

  /**
   * `GetCurrentIdByUniqueKey`: the id of the item that has the same values for the type's keyed properties as `item`,
   * or null when the type has none or no item matches. A keyed property `item` lacks is an error when
   * `exceptionIfPropMissing` is true and is left out of the request otherwise.
   *
   * @spec EXP-041
   */
  async getCurrentIdByUniqueKey(item: DomElement, exceptionIfPropMissing: boolean): Promise<string | null> {
    const typeAttribute = item.getAttributeNode("type");
    if (!typeAttribute) throw nullReference();
    const type = typeAttribute.value;
    if (isNullOrWhiteSpace(type)) {
      const message = "Item node doesn't have type attribute";
      throw new CItemException(-1, message, message);
    }

    let properties: ResponseDocument;
    try {
      properties = await this.getUniqueProperties(type);
    } catch (error) {
      if (error instanceof CItemException && error.faultcode === 0) return null;
      throw error;
    }
    const rows = relationshipRows(properties);
    if (rows.length === 0) return null;

    let aml = `<Item type='${type}' action='get' select='id'>`;
    for (const row of rows) {
      const name = childText(row, "name");
      if (name === undefined) {
        const message = `Error when trying to build unique key for type ${type}: required Property doesn't have a name`;
        throw new CItemException(-1, message, message);
      }
      const property = selectSingleNode(name, item);
      if (!property) {
        if (!exceptionIfPropMissing) continue;
        const message = `Property ${name} that is part of the unique key for type ${type} is not part of the response`;
        throw new CItemException(-1, message, message);
      }
      aml += `<${name}>${domInnerText(property)}</${name}>`;
    }
    aml += "</Item>";

    const answer = await this.host.inn.applyItem(aml);
    if (answer.isError) return null;
    const found = answer.items[0];
    const id = found ? attributeOf(found, "id") : undefined;
    if (id === undefined) throw nullReference();
    return id;
  }

  /**
   * `GetConfigId`: the `config_id` of an item, null when the answer has none and `""` when it is empty. It is sent
   * directly and not cached; any error answer is a `CItemException` with faultcode -99.
   *
   * @spec EXP-042
   */
  async getConfigId(id: string, type: string): Promise<string | null> {
    const response = await this.host.inn.applyItem(`<Item type='${type}' select='config_id' action='get'><id>${id}</id></Item>`);
    if (response.isError) {
      const message = `Failed to get config_id for item (type=${type}; id=${id})`;
      throw new CItemException(-99, message, message);
    }
    const item = response.items[0];
    return item ? getProperty(item, "config_id") : null;
  }

  /**
   * `getDepencyLevel`: how many `source_id` steps lie above a relationship type, asked one step at a time and
   * stopping at the first fault or the first answer without a `source_id`. There is no cycle guard.
   *
   * @spec EXP-003 EXP-043
   */
  async getDepencyLevel(typeId: string, level: number): Promise<number> {
    for (;;) {
      const request = element(
        "Item",
        [
          ["type", "RelationshipType"],
          ["select", "source_id,relationship_id"],
          ["page", "1"],
          ["pagesize", "1"],
          ["action", "get"],
        ],
        textElement("relationship_id", typeId),
      );
      let response: ResponseDocument;
      try {
        response = await this.host.applyAML(request);
      } catch (error) {
        if (error instanceof CItemException) return level;
        if (isXmlException(error) || isXPathException(error)) {
          // The engine appends a text it looks up under a key with a leading space, so it is always empty.
          throw new CItemException(-1, stackText(error), error.message);
        }
        throw error;
      }
      const parent = resultItems(response)
        .map((item) => childText(item, "source_id"))
        .find((text) => text !== undefined);
      if (parent === undefined) return level;
      typeId = parent;
      level += 1;
    }
  }

  /**
   * `GetCustomFloatPropertiesOfTypeItem`: the rows (`//Result/Item/Relationships/Item`) of the float item
   * properties of a type. "No items" is no rows and is not cached, so the next call asks again; any other failure
   * is a `CItemException` carrying the original message.
   *
   * @spec EXP-030 EXP-044 EXP-055
   */
  async getCustomFloatPropertiesOfTypeItem(type: string): Promise<XmlElement[]> {
    const names = FLOAT_PROPERTY_EXCLUSIONS.map((name) => `<name condition='not like'>${name}</name>`).join("");
    const aml =
      `<Item type='ItemType' action='get' levels='1' select='id'><name>${type}</name><Relationships>` +
      "<Item type='Property' select='name, data_type, data_source' action='get'><data_type>item</data_type>" +
      `<item_behavior>float</item_behavior>${names}</Item></Relationships></Item>`;
    try {
      const cached = this.requestedItems.get(aml);
      if (cached) return relationshipRows(cached);
      const response = await this.host.applyAML(aml);
      this.requestedItems.set(aml, response);
      return relationshipRows(response);
    } catch (error) {
      if (error instanceof CItemException && error.faultcode === 0) return [];
      throw wrapped(error, `Failed to process properties of type 'Item' for ItemType '${type}'`);
    }
  }

  /**
   * `GetItemType(name)`: the ItemType's `id, is_relationship, use_src_access` and its default permission. A
   * `CItemException` of any faultcode is null and is not cached.
   *
   * @spec EXP-030 EXP-045
   */
  async getItemTypeWithDefaultPermission(name: string): Promise<ResponseDocument | null> {
    const aml =
      `<Item type='ItemType' action='get' select='id, is_relationship, use_src_access'><name>${name}</name><Relationships>` +
      "<Item type='Allowed Permission' action='get' select='related_id(id)'><is_default>1</is_default></Item></Relationships></Item>";
    const cached = this.requestedItems.get(aml);
    if (cached) return cached;
    try {
      const response = await this.host.applyAML(aml);
      this.requestedItems.set(aml, response);
      return response;
    } catch (error) {
      if (error instanceof CItemException) return null;
      throw error;
    }
  }

  /**
   * `GetPolytypeNames`: the names of the polymorphic ItemTypes, asked once per helper. The list exists before the
   * request is sent, so a failure other than "no items" reaches the first caller and leaves an empty list for every
   * later one (EXP-047).
   *
   * @spec EXP-046 EXP-047
   */
  async getPolytypeNames(): Promise<string[]> {
    if (this.polytypeNames) return this.polytypeNames;
    const names: string[] = [];
    this.polytypeNames = names;
    try {
      const response = await this.host.applyAML(
        "<Item type='ItemType' action='get' select='name'><implementation_type>polymorphic</implementation_type></Item>",
      );
      for (const item of resultItems(response)) {
        const name = childText(item, "name");
        if (name !== undefined) names.push(name);
      }
    } catch (error) {
      if (!(error instanceof CItemException && error.faultcode === 0)) throw error;
    }
    return names;
  }
}

/**
 * The related items of an answer that the export asks metadata for (EXP-040): every `Item` with an `id` attribute
 * directly under a `related_id` of a relationship `Item` (`.//Relationships/Item/related_id/Item`), unless the
 * relationship is `ITPresentationConfiguration` or the `related_id` is typed `Identity`, `Method`,
 * `SSVCPresentationConfiguration` or `cmf_TabularViewHeaderRow`. In document order.
 *
 * @spec EXP-040
 */
export function independentRelatedItems(response: ResponseDocument): IndependentRelatedItem[] {
  const skippedRelated = new Set(["Identity", "Method", "SSVCPresentationConfiguration", "cmf_TabularViewHeaderRow"]);
  const found: IndependentRelatedItem[] = [];
  for (const root of resultItems(response)) {
    for (const related of descendantElements(root)) {
      const relatedId = related.parent;
      const relationship = relatedId?.parent;
      const relationships = relationship?.parent;
      if (related.name !== "Item" || relatedId?.name !== "related_id" || relationship?.name !== "Item" || relationships?.name !== "Relationships") continue;
      if ((attributeOf(related, "id") ?? "") === "") continue;
      const relatedItemType = attributeOf(relatedId, "type") ?? "";
      const relationshipType = attributeOf(relationship, "type") ?? "";
      if (relationshipType === "ITPresentationConfiguration" || skippedRelated.has(relatedItemType)) continue;
      found.push({ relatedItemType, relationshipType });
    }
  }
  return found;
}
