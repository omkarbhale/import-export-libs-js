import { DotNetException, isNullOrWhiteSpace, nullReference } from "../client/dotnet.js";
import { CItemException, type ResponseDocument, stackText } from "../client/fault.js";
import type { CItemHelper } from "../client/item-helper.js";
import { ArgumentNullException } from "../io/errors.js";
import {
  CDATA_SECTION_NODE,
  COMMENT_NODE,
  ELEMENT_NODE,
  PROCESSING_INSTRUCTION_NODE,
  TEXT_NODE,
  documentElementOf,
  innerText,
  setInnerText,
} from "../xml/dom.js";
import type { XmlDocument, XmlElement, XmlNode } from "../xml/dom.js";
import { XmlException } from "../xml/errors.js";
import { loadXml } from "../xml/parser.js";
import { selectNodes, selectSingleNode } from "../xml/xpath.js";
import { outerXml } from "../xml/writer-legacy.js";
import type { LogWriter } from "./load-package-dom.js";

/**
 * A reference the checks found to an item that does not exist yet: a faultcode (`10000` to `10005`, or `0`) and the document
 * node it is at (IMP-103). `DelayedResolutionManager` acts on it (IMP-2xx).
 */
export interface UnresolvedReference {
  faultcode: number;
  problemNode: XmlNode;
}

/** The part of `DelayedResolutionManager` that `DoChecking` uses: it edits the item document before the import (IMP-100). */
export interface DelayedResolution {
  processForDelayedResolution(unresolved: readonly UnresolvedReference[], log: LogWriter): void | Promise<void>;
}

/** The part of the helper the checks need: its requests, and the lookups with the one cache of the run (IMP-102). */
export type CheckHost = Pick<CItemHelper, "applyAML" | "lookups">;

const START_OF_REFERENCE_CHECKING = "********** Start of reference checking ************";
const END_OF_REFERENCE_CHECKING = "************* End of reference checking ************";
const WAS_OBTAINED_FROM_SERVER = "  was obtained from server";
const WAS_OBTAINED_FROM_CACHE = "  was obtained from cache";
const ARROW_WAS_OBTAINED_FROM_SERVER = "-> was obtained from server";
const ARROW_WAS_OBTAINED_FROM_CACHE = "-> was obtained from cache";
const RECURSE_CHECK_HAS_FAILED = " Recurse check has failed.";
const RECURSE_CHECK = "RecurseCheck";

/** `relationshipTypesForCheckingOnDelayedResolution`: the one relationship type `CheckRelationshipItems` handles. */
const RELATIONSHIP_TYPES_FOR_CHECKING_ON_DELAYED_RESOLUTION = ["DiscussionTemplate"] as const;

/** The built-in discussion template (IMP-110): its `FeedTemplate` children are edited, not merged. */
const BUILT_IN_DISCUSSION_TEMPLATE = "9D257D4D16AC480493571BBF816D13BE";

/** The path of `Result` below the envelope that every read of a type definition starts with (IMP-130). */
const RESULT_PATH =
  "*[local-name()='Envelope' and (namespace-uri()='http://schemas.xmlsoap.org/soap/envelope/' or namespace-uri()='')]" +
  "/*[local-name()='Body' and (namespace-uri()='http://schemas.xmlsoap.org/soap/envelope/' or namespace-uri()='')]" +
  "/*[local-name()='Result' and (namespace-uri()='http://schemas.xmlsoap.org/soap/envelope/' or namespace-uri()='')]";

const asElements = (nodes: XmlNode[]): XmlElement[] => nodes as XmlElement[];

/** `Attributes["name"]` of an element: the attribute's value, or null when it has none. */
const attributeValue = (element: XmlElement, name: string): string | null => element.getAttributeNode(name)?.value ?? null;

/** `Attributes.GetNamedItem(name)` read as the engine does for `type` and `keyed_name`: the value, or the empty string. */
const attributeOrEmpty = (element: XmlElement, name: string): string => attributeValue(element, name) ?? "";

/** `XmlElement.GetAttribute(name)`: the value, or the empty string for a missing attribute. */
const getAttribute = attributeOrEmpty;

/** The .NET type name `InvalidCastException` quotes for a node that is not an element (IMP-130, IMP-104). */
function dotNetNodeType(node: XmlNode): string {
  switch (node.nodeType) {
    case TEXT_NODE:
      return /^[\t\n\r ]*$/.test((node as unknown as { data: string }).data) ? "System.Xml.XmlSignificantWhitespace" : "System.Xml.XmlText";
    case CDATA_SECTION_NODE:
      return "System.Xml.XmlCDataSection";
    case COMMENT_NODE:
      return "System.Xml.XmlComment";
    case PROCESSING_INSTRUCTION_NODE:
      return "System.Xml.XmlProcessingInstruction";
    default:
      return "System.Xml.XmlEntityReference";
  }
}

/** The `InvalidCastException` of a `foreach (XmlElement …)` that meets a node of another kind. */
function invalidCast(node: XmlNode): DotNetException {
  return new DotNetException(
    "System.InvalidCastException",
    `Unable to cast object of type '${dotNetNodeType(node)}' to type 'System.Xml.XmlElement'.`,
  );
}

/** The `Name` of a node as `XmlNode.Name` gives it. */
const nodeName = (node: XmlNode): string => node.nodeName;

/**
 * The reference checks of the engine's `CItemHelper` (`DoChecking`, `RecurseCheck` and the checks it runs), and the
 * request cache they share with the lookups (IMP-102). They run on the document of one package item and make a request
 * for every item it refers to. A reference to an item that does not exist yet is added to a list for delayed resolution
 * (IMP-103); everything else that goes wrong ends the run as a `CItemException` with faultcode -1 (IMP-104). Names and ids
 * read from the document go into the requests and the XPath texts unescaped, as the engine does (AGENTS.md rule 7).
 *
 * The engine compares the data type of a property and the behavior of a relationship with culture-sensitive `EndsWith` and
 * `IndexOf`, which differ from an ordinal comparison only for characters the collation ignores. The port compares
 * ordinally (IMP-140, IMP-150).
 *
 * @spec IMP-100 IMP-101 IMP-102 IMP-103 IMP-104 IMP-110 IMP-111 IMP-120 IMP-130 IMP-131 IMP-132 IMP-140 IMP-150 IMP-160 IMP-161 IMP-180
 */
export class ReferenceChecker {
  /** The documents of the answers whose XPath the checks run, made once per answer. */
  private readonly answerDocuments = new WeakMap<ResponseDocument, XmlDocument>();

  constructor(private readonly host: CheckHost) {}

  /** `_requestedItems`, the one dictionary of the helper (IMP-102). */
  private get requestedItems(): Map<string, ResponseDocument> {
    return this.host.lookups.requestedItems;
  }

  /** The answer as a DOM document, to run the engine's XPath on it. */
  private answerDocument(answer: ResponseDocument): XmlDocument {
    let document = this.answerDocuments.get(answer);
    if (!document) {
      document = loadXml(answer.outerXml, { preserveWhitespace: false });
      this.answerDocuments.set(answer, document);
    }
    return document;
  }

  /**
   * The answer for `aml` from the cache, or from the server, which is then cached; `onServer` is what the check logs
   * after a request that was answered, `onCache` what it logs for a hit. A fault is not cached (IMP-102).
   */
  private async cachedRequest(aml: string, log: LogWriter, onServer: string, onCache: string): Promise<void> {
    if (this.requestedItems.has(aml)) {
      log.writeLine(onCache);
      return;
    }
    this.requestedItems.set(aml, await this.host.applyAML(aml));
    log.writeLine(onServer);
  }

  /**
   * `DoChecking`: writes the start line, runs the full check or only the data-source check, hands a non-empty list to
   * the delayed resolution, and writes the end line. When a check throws, the end line is not written (IMP-100).
   *
   * @spec IMP-100
   */
  async doChecking(manager: DelayedResolution, itemInXml: XmlDocument, log: LogWriter, doFullCheck: boolean): Promise<void> {
    log.writeLine(START_OF_REFERENCE_CHECKING);
    const unresolved: UnresolvedReference[] = [];
    if (doFullCheck) await this.recurseCheck(itemInXml, log, unresolved);
    else await this.checkDataSourceReferences(itemInXml, log, unresolved);
    if (unresolved.length > 0) await manager.processForDelayedResolution(unresolved, log);
    log.writeLine(END_OF_REFERENCE_CHECKING);
  }

  /**
   * `RecurseCheck`: the seven checks in their order. Whatever one of them throws becomes a `CItemException` with faultcode
   * -1 whose message ends in ` Recurse check has failed.` (IMP-104).
   *
   * @spec IMP-101 IMP-104 IMP-160 IMP-161
   */
  async recurseCheck(itemInXml: XmlDocument, log: LogWriter, unresolved: UnresolvedReference[]): Promise<void> {
    if (itemInXml === null) throw new ArgumentNullException("itemInXml");
    if (log === null) throw new ArgumentNullException("logWriter");
    if (unresolved === null) throw new ArgumentNullException("unresolvedRefs");
    try {
      await this.checkRelationshipItems(itemInXml, log, unresolved);
      await this.checkGetItems(itemInXml, log, unresolved);
      await this.checkPropertiesAndRelationshipTypes(itemInXml, log);
      await this.checkDataSourceReferences(itemInXml, log, unresolved);
      await this.checkRelatedItems(itemInXml, log, unresolved);
      await this.checkRelationshipTypeEnds(itemInXml, log);
      await this.checkRelationshipViewGrids(itemInXml, log);
    } catch (error) {
      const original = error as Error;
      throw new CItemException(-1, stackText(error), original.message + RECURSE_CHECK_HAS_FAILED, error);
    }
  }

  /**
   * `CheckRelationshipItems`: a `DiscussionTemplate` relationship that exists is turned into an edit and queued when it
   * has nested items; one that does not exist is queued as it is (10005). An id that was checked before is left alone,
   * because the first answer stays in the cache (IMP-111).
   *
   * @spec IMP-110 IMP-111
   */
  async checkRelationshipItems(itemInXml: XmlDocument, log: LogWriter, unresolved: UnresolvedReference[]): Promise<void> {
    for (const relationshipType of RELATIONSHIP_TYPES_FOR_CHECKING_ON_DELAYED_RESOLUTION) {
      const relationships = asElements(selectNodes(`.//Item/Relationships/Item[@type='${relationshipType}']`, itemInXml));
      for (const relationship of relationships) {
        try {
          const type = attributeOrEmpty(relationship, "type");
          const id = attributeOrEmpty(relationship, "id");
          if (type === "" || id === "") continue;
          const request = `<Item type='${type}' id='${id}' action ='get' select='id' levels='0'></Item>`;
          log.writeLine(`checking item with get action:${request}`);
          if (this.requestedItems.has(request)) {
            log.writeLine(ARROW_WAS_OBTAINED_FROM_CACHE);
            continue;
          }
          this.requestedItems.set(request, await this.host.applyAML(request));
          log.writeLine(ARROW_WAS_OBTAINED_FROM_SERVER);
          const nested = asElements(selectNodes(".//Item", relationship));
          if (nested.length === 0) continue;
          const action = relationship.getAttributeNode("action");
          if (!action) throw nullReference();
          action.value = "edit";
          for (const item of nested) {
            if (getAttribute(item, "action") !== "add") continue;
            let replacement = "merge";
            if (relationshipType === "DiscussionTemplate" && id === BUILT_IN_DISCUSSION_TEMPLATE) {
              if (attributeValue(item, "type") === "FeedTemplate") replacement = "edit";
            }
            item.setAttribute("action", replacement);
          }
          // the engine throws a faultcode 0 exception here, which its own handler turns into this entry
          unresolved.push({ faultcode: 10005, problemNode: relationship });
        } catch (error) {
          if (!(error instanceof CItemException) || error.faultcode !== 0) throw error;
          unresolved.push({ faultcode: 10005, problemNode: relationship });
        }
      }
    }
  }

  /**
   * `CheckGetItems`: sends every `get` item of the document as it is. One that finds nothing is an unresolved reference;
   * its code depends on the element it sits in (IMP-120).
   *
   * @spec IMP-120
   */
  async checkGetItems(itemInXml: XmlDocument, log: LogWriter, unresolved: UnresolvedReference[]): Promise<void> {
    for (const item of asElements(selectNodes(".//Item[@action='get']", itemInXml))) {
      try {
        const request = outerXml(item);
        log.writeLine(`checking item with get action:${request}`);
        await this.cachedRequest(request, log, ARROW_WAS_OBTAINED_FROM_SERVER, ARROW_WAS_OBTAINED_FROM_CACHE);
      } catch (error) {
        if (!(error instanceof CItemException) || error.faultcode !== 0) throw error;
        const parent = item.parentNode;
        if (parent === null) continue;
        let faultcode = 0;
        if (nodeName(parent) === "related_id") {
          const grandparent = parent.parentNode;
          if (grandparent !== null) {
            faultcode = this.typeOf(grandparent) === "RelationshipType" ? 10003 : 10001;
          }
        } else if (nodeName(parent) === "source_id") {
          const grandparent = parent.parentNode;
          if (grandparent !== null && this.typeOf(grandparent) === "RelationshipType") faultcode = 10002;
        } else if (nodeName(parent) === "data_source") {
          faultcode = 10000;
        } else if (nodeName(parent) === "foreign_property") {
          faultcode = 10004;
        }
        unresolved.push({ faultcode, problemNode: parent });
      }
    }
  }

  /** The `type` attribute of a node, null when it has none. A document has no attributes at all: reading them is a null reference. */
  private typeOf(node: XmlNode): string | null {
    if (node.nodeType !== ELEMENT_NODE) throw nullReference();
    return attributeValue(node as XmlElement, "type");
  }

  /**
   * `CheckPropertiesAndRelationshipTypes`: reads the definition of the item's type and checks that every relationship
   * item below it names a RelationshipType of that type, recursively. The check of the properties compares an element
   * name with itself and so never fails (IMP-131).
   *
   * @spec IMP-130 IMP-131
   */
  async checkPropertiesAndRelationshipTypes(itemInXml: XmlDocument, log: LogWriter): Promise<void> {
    const documentElement = documentElementOf(itemInXml);
    if (documentElement === null) throw nullReference();
    const type = getAttribute(documentElement, "type");
    if (type === "") throw new XmlException("type attribute is missing");
    const aml =
      `<Item type='ItemType' action='get' select='id'><name>${type}</name><Relationships>` +
      "<Item type='Property' action='get' select='name'/><Item type='RelationshipType' action='get' select='name'/></Relationships></Item>";
    let definition = this.answerDocument(await this.host.lookups.getTypeAmlInner(aml, log));
    for (let child = documentElement.firstChild; child; child = child.nextSibling) {
      const name = nodeName(child);
      if (name === "Relationships") {
        for (let row = child.firstChild; row; row = row.nextSibling) {
          if (row.nodeType !== ELEMENT_NODE) throw invalidCast(row);
          const relationship = row as XmlElement;
          if (nodeName(relationship) !== "Item") {
            throw new XmlException(`Relationships tag can contain only Item tags, but found ${nodeName(relationship)}`);
          }
          const relationshipType = getAttribute(relationship, "type");
          const path = `${RESULT_PATH}/Item/Relationships/Item[@type='RelationshipType' and name='${relationshipType}']`;
          if (selectSingleNode(path, definition) === null) {
            definition = this.answerDocument(await this.host.lookups.getTypeAmlInner(aml, log, true));
            if (selectSingleNode(path, definition) === null) {
              throw new CItemException(-1, RECURSE_CHECK, `Bad Relation type ${relationshipType} for ${type}`, null);
            }
          }
          const nested = loadXml(outerXml(relationship), { preserveWhitespace: false });
          await this.checkPropertiesAndRelationshipTypes(nested, log);
        }
      } else if (name === "Property") {
        const path = `${RESULT_PATH}/Item/Relationships/Item[@type='Property' and name='${name}']`;
        if (selectSingleNode(path, definition) === null) {
          definition = this.answerDocument(await this.host.lookups.getTypeAmlInner(aml, log, true));
          if (selectSingleNode(path, definition) === null) {
            throw new CItemException(-1, RECURSE_CHECK, `Bad property name ${name} for type ${type}`, null);
          }
        }
      }
    }
  }

  /**
   * `CheckDataSourceReferences`: checks that the list, sequence or ItemType a property points at exists. One that does
   * not is unresolved (10000). Also the whole check of an item that is deleted (IMP-100).
   *
   * @spec IMP-140
   */
  async checkDataSourceReferences(itemInXml: XmlDocument, log: LogWriter, unresolved: UnresolvedReference[]): Promise<void> {
    const properties = asElements(
      selectNodes(
        ".//Item[@type='Property' and data_source and data_source!='' and data_source!='00000000000000000000000000000000' and not(data_source/Item)]",
        itemInXml,
      ),
    );
    for (const property of properties) {
      const dataTypeNode = selectSingleNode("data_type", property);
      let dataType = dataTypeNode ? innerText(dataTypeNode) : "";
      const dataSource = selectSingleNode("data_source", property) as XmlElement;
      if (dataType === "foreign") continue;
      let request: string;
      if (dataType === "item") {
        log.writeLine("checking <data_source> reference to the ItemType");
        const keyedName = dataSource.getAttributeNode("keyed_name");
        if (keyedName === null) continue;
        request = `<Item type='ItemType' action='get' select='id'><name>${keyedName.value}</name></Item>`;
      } else {
        if (dataType === "color list" || dataType === "filter list" || dataType.endsWith("mv_list")) dataType = "List";
        log.writeLine("checking <data_source> reference to list/sequence");
        request = `<Item action='get' type='${dataType}' select='id'><id>${innerText(dataSource)}</id></Item>`;
      }
      try {
        log.writeLine(request);
        await this.cachedRequest(request, log, WAS_OBTAINED_FROM_SERVER, WAS_OBTAINED_FROM_CACHE);
      } catch (error) {
        if (!(error instanceof CItemException) || error.faultcode !== 0) throw error;
        unresolved.push({ faultcode: 10000, problemNode: dataSource });
      }
    }
  }

  /**
   * `CheckRelatedItems`: checks the item every plain `related_id` points at. For a versionable type whose relationship
   * floats, the reference is moved to the current generation, or marked to find it later (IMP-150). One that does not
   * exist is unresolved (10001).
   *
   * @spec IMP-150
   */
  async checkRelatedItems(itemInXml: XmlDocument, log: LogWriter, unresolved: UnresolvedReference[]): Promise<void> {
    const lookups = this.host.lookups;
    for (const related of asElements(selectNodes(".//Item[@type!='RelationshipType']/related_id[not(Item)]", itemInXml))) {
      const type = attributeOrEmpty(related, "type");
      const keyedName = attributeOrEmpty(related, "keyed_name");
      const id = innerText(related);
      if (type === "" || keyedName === "") continue;
      const request = `<Item type='${type}' action='get' levels='0'><id>${id}</id></Item>`;
      try {
        log.writeLine("checking for related items");
        log.writeLine(request);
        await this.cachedRequest(request, log, WAS_OBTAINED_FROM_SERVER, WAS_OBTAINED_FROM_CACHE);
        if (await lookups.isVersionable(type)) {
          if (await this.floats(related)) setInnerText(related, await lookups.getCurrentIdOfVersion(id, type));
        }
      } catch (error) {
        if (!(error instanceof CItemException) || error.faultcode !== 0) throw error;
        if (await lookups.isVersionable(type)) {
          if (await this.floats(related)) related.setAttribute("__find_latest_generation_", "yes");
        }
        unresolved.push({ faultcode: 10001, problemNode: related });
      }
    }
  }

  /** Whether the relationship the `related_id` sits in has a behavior that contains `float`; a definition without a behavior is a null reference. */
  private async floats(related: XmlElement): Promise<boolean> {
    const parent = related.parentNode;
    const relationshipTypeName = parent !== null && parent.nodeType === ELEMENT_NODE ? attributeValue(parent as XmlElement, "type") : null;
    if (relationshipTypeName === null) throw nullReference();
    const definition = this.answerDocument(await this.host.lookups.getRelationshipType(relationshipTypeName, "behavior"));
    const behavior = selectSingleNode(".//*[local-name(.)='Result']/Item/behavior", definition);
    if (behavior === null) throw nullReference();
    return innerText(behavior).includes("float");
  }

  /**
   * The check of a RelationshipType's `source_id` and `related_id` (the first loop of `RecurseCheck`): the ItemType they
   * name must exist. A missing one is an error here, not an unresolved reference.
   *
   * @spec IMP-160
   */
  private async checkRelationshipTypeEnds(itemInXml: XmlDocument, log: LogWriter): Promise<void> {
    const ends = asElements(
      selectNodes(
        ".//Item[@type='RelationshipType']/source_id[not(Item)]|.//Item[@type='RelationshipType']/related_id[not(Item)]",
        itemInXml,
      ),
    );
    const nameNode = selectSingleNode(".//Item[@type='RelationshipType']/name", itemInXml);
    for (const end of ends) {
      const type = attributeOrEmpty(end, "type");
      const keyedName = attributeOrEmpty(end, "keyed_name");
      const id = innerText(end);
      if (keyedName === "" || type === "") continue;
      try {
        log.writeLine("checking RelationshipType's source_id,related_id");
        const request = `<Item levels='0' action='get' type='ItemType'><id>${id}</id></Item>`;
        log.writeLine(request);
        await this.cachedRequest(request, log, WAS_OBTAINED_FROM_SERVER, WAS_OBTAINED_FROM_CACHE);
      } catch (error) {
        if (error instanceof CItemException && error.faultcode === 0) {
          if (nameNode === null) throw nullReference();
          error.faultdetail = `Bad ${nodeName(end)} ${keyedName} for ${innerText(nameNode)}`;
        }
        throw error;
      }
    }
  }

  /**
   * The check of a Relationship View's `grid` (the second loop of `RecurseCheck`): the Grid it names must exist.
   *
   * @spec IMP-161
   */
  private async checkRelationshipViewGrids(itemInXml: XmlDocument, log: LogWriter): Promise<void> {
    const grids = asElements(selectNodes(".//Item[@type='RelationshipType']/Relationships/Item[@type='Relationship View' ]/grid", itemInXml));
    const nameNode = selectSingleNode(".//Item[@type='RelationshipType']/name", itemInXml);
    for (const grid of grids) {
      const type = attributeOrEmpty(grid, "type");
      const keyedName = attributeOrEmpty(grid, "keyed_name");
      const id = innerText(grid);
      if (keyedName === "" || type === "") continue;
      try {
        log.writeLine("checking Grids types");
        const request = `<Item levels='0' action='get' type='Grid'><id>${id}</id></Item>`;
        log.writeLine(request);
        await this.cachedRequest(request, log, WAS_OBTAINED_FROM_SERVER, WAS_OBTAINED_FROM_CACHE);
      } catch (error) {
        if (error instanceof CItemException && error.faultcode === 0) {
          if (nameNode === null) throw nullReference();
          error.faultdetail = `Bad Grid ${keyedName} for ${innerText(nameNode)}`;
        }
        throw error;
      }
    }
  }
}
