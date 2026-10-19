import { singleItem } from "../client/answer.js";
import { DotNetException, isNullReference, isXPathException, isXmlException, nullReference } from "../client/dotnet.js";
import { CItemException, type ResponseDocument, getProperty, stackText } from "../client/fault.js";
import { DEFAULT_ENGINE, type Engine } from "../engines.js";
import { attributeOf } from "../client/mini-xml.js";
import { ELEMENT_NODE, type XmlDocument, type XmlElement, documentElementOf, innerText, removeChild } from "../xml/dom.js";
import { loadXml } from "../xml/parser.js";
import { selectNodes, selectSingleNode } from "../xml/xpath.js";
import { outerXml } from "../xml/writer-legacy.js";
import { KeyNotFoundException } from "../io/errors.js";
import { RESULT_PATH } from "./answer-path.js";

/**
 * The part of the engine's `ICItemHelper` that `CImportItems` calls: its requests, and the lookups of the merge. The run's
 * `ImportLookups` is the one implementation; a script can stand in for it.
 */
export interface MergeHelper {
  /** `CItemHelper.applyAML` (WIRE-006): throws a `CItemException` for any fault, faultcode 0 included. */
  applyAML(aml: string): Promise<ResponseDocument>;
  isVersionable(typeName: string): Promise<boolean>;
  setItemIdToLastGeneration(item: XmlElement): Promise<void>;
  unlock(id: string, type: string): Promise<void>;
  existRelItemInCurVer(type: string, sourceId: string, relatedId: string): Promise<boolean>;
}

/**
 * What 14.35's `CImportItems` asks of the helper for a generated `Property` item (LP-042, LP-043): the lookup of the property, the
 * languages with their suffixes, and the SQL update. `ImportLookups` is the one implementation.
 */
export interface LanguagePackHelper {
  /** `GetPropertyItemWithRequiredProps(where)`: the `Property` get; a fault with faultcode 0 is swallowed and the error item returned. */
  getPropertyItemWithRequiredProps(where: string): Promise<ResponseDocument>;
  /** `GetLanguagesWithSuffixes()`: the `Language` get as a dictionary from code to suffix, which is null when the answer has none. */
  getLanguagesWithSuffixes(): Promise<Map<string, string | null>>;
  /** `CItemHelper.applySQL(sql)`: throws for a fault. */
  applySql(sql: string): Promise<void>;
}

/** The faultcode and the texts of the errors `Import` raises itself (IMP-301, IMP-302). */
const ITEMS_MUST_HAVE_TYPE = ["Items must have 'type' set", "Error - empty 'type'"] as const;
const ITEMS_MUST_HAVE_ID_OR_WHERE = ["Items must have 'id' or 'where' set", "Error - empty 'id' or 'where'"] as const;

/** The type of the relationship `ProcessVersionableItem` matches by its `ref_id` (IMP-331). */
const MP_MAC_CONDITION = "mp_MacCondition";

/** The keyed name of the system properties of a change controlled relationship (IMP-315). */
const CHANGE_CONTROLLED_RELATIONSHIP = "Change Controlled Relationship";
const CHANGE_CONTROLLED_SYSTEM_PROPERTIES = ["related_id", "sort_order", "source_id"];

/** The .NET type names of the nodes a `foreach (XmlElement …)` over the children of an item can stop at (LP-043). */
const NODE_TYPE_NAMES: Readonly<Record<number, string>> = { 3: "XmlText", 4: "XmlCDataSection", 7: "XmlProcessingInstruction", 8: "XmlComment" };

/** `XmlElement.GetAttribute(name)`: the value, or the empty string for a missing attribute. */
const getAttribute = (element: XmlElement, name: string): string => element.getAttributeNode(name)?.value ?? "";

const asElements = (nodes: ReturnType<typeof selectNodes>): XmlElement[] => nodes as XmlElement[];

/**
 * `CImportItems`: what the engine does to the document of one package item before it sends it. It checks the document
 * (IMP-301 to IMP-304), in merge mode turns the `add` of every item that exists into an `edit` (IMP-310 to IMP-317), rewrites
 * the relationships of a versionable item so that they address the current generation (IMP-330 to IMP-334), and sends the
 * document (IMP-340). The document is edited in place, so a call that fails after an edit leaves it in the document.
 * Values read from the document go into the requests and the XPath texts unescaped, as the engine does (AGENTS.md rule 7).
 *
 * 14.35 differs in how a versionable item's relationship with an `Item` under `related_id` is read (IMP-332, IMP-333, IMP-353),
 * and in the AML batch mode `Import` prepares the document and returns without sending it (IMP-512). On a server that needs the
 * null-value handling (LP-040) it also sends the translations of a generated `Property` item for a system property by SQL (LP-042,
 * LP-043); `languagePack` is then the helper that does it, and absent otherwise.
 *
 * @spec IMP-300 IMP-301 IMP-302 IMP-303 IMP-304 IMP-310 IMP-311 IMP-312 IMP-313 IMP-314 IMP-315 IMP-316 IMP-317 IMP-330 IMP-331 IMP-332 IMP-333 IMP-340
 * @spec IMP-353 LP-042 LP-043 LP-044
 */
export class ImportItems {
  constructor(
    private readonly helper: MergeHelper,
    private readonly engine: Engine = DEFAULT_ENGINE,
    private readonly languagePack?: LanguagePackHelper,
  ) {}

  /**
   * `Import(itemInXml, mergeMode, amlBatchMode)`. A null reference, an `XmlException` and an `XPathException` leave as a
   * `CItemException` with faultcode -1 that names the item (IMP-304); every other exception leaves as it is. With `amlBatchMode`
   * the call does everything but the last step: the document holds what would have been sent (IMP-512).
   *
   * @spec IMP-300 IMP-301 IMP-302 IMP-303 IMP-304 IMP-310 IMP-311 IMP-312 IMP-313 IMP-314 IMP-317 IMP-340 IMP-512 LP-042
   */
  async import(itemInXml: XmlDocument, mergeMode: boolean, amlBatchMode = false): Promise<void> {
    const documentElement = documentElementOf(itemInXml);
    let text = "";
    let type = "";
    try {
      if (selectNodes("//Item[not(@type)]", itemInXml).length > 0) {
        throw new CItemException(-1, ITEMS_MUST_HAVE_TYPE[0], ITEMS_MUST_HAVE_TYPE[1], null);
      }
      if (documentElement === null) throw nullReference();
      type = getAttribute(documentElement, "type");
      const versionable = await this.helper.isVersionable(type);
      const id = getAttribute(documentElement, "id");
      text = id === "" ? getAttribute(documentElement, "where") : id;
      // `action='edit'` is a test on a child element named action, not on the attribute (IMP-303)
      const unaddressed = versionable
        ? `//Item[(@action='add' or action='edit') and not(@id) and not(@where) and not(source_id/text()='${id}')]`
        : "//Item[(@action='add' or action='edit') and not(@id) and not(@where)]";
      if (selectNodes(unaddressed, itemInXml).length > 0) {
        throw new CItemException(-1, ITEMS_MUST_HAVE_ID_OR_WHERE[0], ITEMS_MUST_HAVE_ID_OR_WHERE[1], null);
      }
      if (mergeMode) await this.merge(itemInXml);
      if (versionable) await this.processVersionableItem(documentElement);
      if (this.languagePack !== undefined && type === "Property" && getAttribute(documentElement, "context_action") === "lpimport") {
        if (await this.setPropertyLabelsBySql(itemInXml, documentElement, text)) return;
      }
      if (!amlBatchMode) await this.helper.applyAML(outerXml(itemInXml));
    } catch (error) {
      if (isNullReference(error) || isXmlException(error) || isXPathException(error)) {
        throw new CItemException(-1, stackText(error), `${error.message} Can't merge item ${text} ${type}`, error);
      }
      throw error;
    }
  }

  /**
   * The branch of a generated `Property` item (LP-042): the `context_action` mark is removed, and the property is looked up by the item's
   * `id`, or its `where`. When it is a system property of a relationship type (`keyed_name` exactly `source_id` or `related_id`) the
   * translations are written by SQL (LP-043) and the item is not sent; the answer is then true. Any other property carries on to the
   * send, without the mark.
   *
   * @spec LP-042
   */
  private async setPropertyLabelsBySql(itemInXml: XmlDocument, root: XmlElement, where: string): Promise<boolean> {
    const helper = this.languagePack as LanguagePackHelper;
    root.removeAttribute("context_action");
    const found = singleItem(await helper.getPropertyItemWithRequiredProps(where));
    const keyedName = getProperty(found, "keyed_name");
    if (keyedName !== "source_id" && keyedName !== "related_id") return false;
    await this.setLocalizedValueViaApplySqlRequest(itemInXml, attributeOf(found, "id") ?? "");
    return true;
  }

  /**
   * `SetLocalizedValueViaApplySqlRequest(localizableElements, targetPropertyId)`: for each child of the document's first node with a non-empty
   * `xml:lang`, the column `[{local name}{suffix}] = N'{inner text}'`; one `UPDATE innovator.PROPERTY` for them all, or nothing when there is
   * none (LP-043). Values, names, suffixes and the id go into the statement as they are (LP-044). The loop casts each child to an element, so a
   * text or a comment child is an `InvalidCastException` when it is reached.
   *
   * @spec LP-043 LP-044 LP-046
   */
  private async setLocalizedValueViaApplySqlRequest(itemInXml: XmlDocument, targetPropertyId: string): Promise<void> {
    const helper = this.languagePack as LanguagePackHelper;
    const columns: string[] = [];
    const suffixes = await helper.getLanguagesWithSuffixes();
    const first = itemInXml.firstChild;
    if (first === null) throw nullReference();
    for (let child = first.firstChild; child !== null; child = child.nextSibling) {
      if (child.nodeType !== ELEMENT_NODE) {
        throw new DotNetException(
          "System.InvalidCastException",
          `Unable to cast object of type 'System.Xml.${NODE_TYPE_NAMES[child.nodeType] ?? "XmlLinkedNode"}' to type 'System.Xml.XmlElement'.`,
        );
      }
      const element = child as XmlElement;
      const language = getAttribute(element, "xml:lang");
      if (language === "") continue;
      if (!suffixes.has(language)) throw new KeyNotFoundException();
      columns.push(`[${element.localName}${suffixes.get(language) ?? ""}] = N'${innerText(element)}'`);
    }
    if (columns.length > 0) {
      await helper.applySql(`\r\n\t\t\t\tUPDATE innovator.PROPERTY\r\n\t\t\t\tSET ${columns.join(",")}\r\n\t\t\t\tWHERE id='${targetPropertyId}'`);
    }
  }

  /**
   * Merge mode: the add items of the document are found once, a versionable one is moved to its latest generation, one
   * `idlist` get per type asks which of them exist, and each that does is unlocked and turned into an `edit`.
   *
   * @spec IMP-310 IMP-311 IMP-312 IMP-313 IMP-314 IMP-317
   */
  private async merge(itemInXml: XmlDocument): Promise<void> {
    const adds = asElements(selectNodes(".//Item[@action='add']", itemInXml));
    const idsByType = new Map<string, string[]>();
    for (const add of adds) {
      const type = getAttribute(add, "type");
      if (await this.helper.isVersionable(type)) await this.helper.setItemIdToLastGeneration(add);
      const id = getAttribute(add, "id");
      if (id === "") continue;
      const ids = idsByType.get(type);
      if (ids) ids.push(id);
      else idsByType.set(type, [id]);
    }

    for (const [type, ids] of idsByType) {
      const answer = await this.getItems(type, ids);
      if (answer === null) continue;
      const result = loadXml(answer.outerXml, { preserveWhitespace: false });
      for (const id of ids) {
        const found = selectSingleNode(`${RESULT_PATH}/Item[@id='${id}']`, result);
        if (found === null) continue;
        const locked = selectSingleNode("locked_by_id", found);
        if (locked !== null && innerText(locked) !== "") await this.helper.unlock(id, type);
        for (const add of adds) {
          if (getAttribute(add, "id") !== id) continue;
          // IMP-315: 12.0 has no RemoveSystemPropertyForPolyType, so every add with the found id becomes an edit
          if (this.engine === "12.0" || !ImportItems.removeSystemPropertyForPolyType(add)) add.setAttribute("action", "edit");
        }
      }
    }
  }

  /**
   * `GetItem`: the `idlist` get of one type. A "no items" fault is the answer that none of them exists, which is null.
   *
   * @spec IMP-312
   */
  private async getItems(type: string, ids: readonly string[]): Promise<ResponseDocument | null> {
    try {
      return await this.helper.applyAML(`<Item type='${type}' action='get' idlist='${ids.join(",")}' select='id, locked_by_id' />`);
    } catch (error) {
      if (error instanceof CItemException && error.faultcode === 0) return null;
      throw error;
    }
  }

  /**
   * `ProcessVersionableItem`: each relationship item directly under the root's `Relationships` is matched by its source and
   * its related (or `ref_id`) id, and becomes an `add`, or an `edit` addressed by a `where` (IMP-330 to IMP-333).
   *
   * @spec IMP-330 IMP-331 IMP-332 IMP-333 IMP-353
   */
  private async processVersionableItem(root: XmlElement): Promise<void> {
    for (const relationship of asElements(selectNodes("Relationships/Item", root))) {
      const sourceNode = selectSingleNode("source_id", relationship);
      if (sourceNode === null) continue;
      const relatedNode = selectSingleNode("related_id", relationship);
      const type = getAttribute(relationship, "type");
      const sourceId = innerText(sourceNode);
      if (type === MP_MAC_CONDITION) {
        const refNode = selectSingleNode("ref_id", relationship);
        if (refNode === null) throw nullReference();
        const refId = innerText(refNode);
        let found = true;
        try {
          await this.helper.applyAML(`<Item type='${type}' action='get' select='id'><source_id>${sourceId}</source_id><ref_id>${refId}</ref_id></Item>`);
        } catch (error) {
          if (!(error instanceof CItemException) || error.faultcode !== 0) throw error;
          found = false;
        }
        if (!found) {
          relationship.setAttribute("action", "add");
          continue;
        }
        relationship.setAttribute("where", `source_id='${sourceId}' and ref_id='${refId}'`);
        relationship.setAttribute("action", "edit");
      } else if (relatedNode !== null) {
        let relatedId: string;
        const relatedItem = selectSingleNode("./Item", relatedNode) as XmlElement | null;
        if (relatedItem !== null) {
          // the id is read from the first attribute among all the Items under related_id (IMP-332)
          const idNode = selectSingleNode("related_id/Item/@id", relationship);
          if (this.engine === "14.35") {
            // an Item with no id is no fault: a get leaves the relationship alone, any other action is matched on an empty id (IMP-333, IMP-353)
            relatedId = idNode === null ? "" : innerText(idNode);
            if (relatedId === "" && relatedItem.getAttributeNode("action")?.value === "get") continue;
          } else {
            // an Item with none is a null reference (IMP-333)
            if (idNode === null) throw nullReference();
            relatedId = innerText(idNode);
          }
        } else {
          relatedId = innerText(relatedNode);
        }
        relationship.removeAttribute("id");
        if (!(await this.helper.existRelItemInCurVer(type, sourceId, relatedId))) {
          relationship.setAttribute("action", "add");
          continue;
        }
        relationship.setAttribute("where", `source_id='${sourceId}' and related_id='${relatedId}'`);
        relationship.setAttribute("action", "edit");
      }
    }
  }

  /**
   * `RemoveSystemPropertyForPolyType`: a property of Change Controlled Relationship named `related_id`, `sort_order` or
   * `source_id` exists in every database already, so it is removed from its parent instead of being edited. Returns whether
   * it removed the item. An item that was removed before has no parent: removing it again is a null reference (IMP-316).
   *
   * @spec IMP-315 IMP-316
   */
  private static removeSystemPropertyForPolyType(property: XmlElement): boolean {
    const nameNode = selectSingleNode("name", property);
    const name = nameNode === null ? null : innerText(nameNode);
    const keyedNode = selectSingleNode("source_id/@keyed_name", property);
    const keyedName = keyedNode === null ? null : innerText(keyedNode);
    if (keyedName !== CHANGE_CONTROLLED_RELATIONSHIP) return false;
    if (name === null || !CHANGE_CONTROLLED_SYSTEM_PROPERTIES.includes(name)) return false;
    const parent = property.parentNode;
    if (parent === null) throw nullReference();
    removeChild(parent, property);
    return true;
  }
}
