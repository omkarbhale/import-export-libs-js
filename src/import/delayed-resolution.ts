import { DEFAULT_ENGINE, type Engine } from "../engines.js";
import { DotNetException, nullReference } from "../client/dotnet.js";
import { EngineNotSupportedError } from "../client/item-helper.js";
import {
  CDATA_SECTION_NODE,
  COMMENT_NODE,
  DOCUMENT_NODE,
  ELEMENT_NODE,
  PROCESSING_INSTRUCTION_NODE,
  TEXT_NODE,
  innerText,
  setInnerText,
} from "../xml/dom.js";
import type { XmlElement, XmlNode } from "../xml/dom.js";
import { loadXml } from "../xml/parser.js";
import { selectSingleNode } from "../xml/xpath.js";
import { outerXml } from "../xml/writer-legacy.js";
import type { LogWriter } from "./load-package-dom.js";
import type { DelayedResolution, UnresolvedReference } from "./reference-checks.js";

/** The engines whose delayed resolution is built; the rest wait for their variant slices. */
export const DELAYED_RESOLUTION_ENGINES: readonly Engine[] = ["12.0", "14.0.7", "14.35"];

/** `FakedDataSource`: the id a data source or foreign property gets in the imported document (IMP-222). */
export const FAKED_DATA_SOURCE = "00000000000000000000000000000000";

/** `FindLatestGenAttr`: the attribute the checks put on the `related_id` of a floating relationship (IMP-150). */
export const FIND_LATEST_GENERATION_ATTRIBUTE = "__find_latest_generation_";

/** The test of `IMP-240` step 1: `IndexOf(…, OrdinalIgnoreCase)`. A regular expression without the `u` flag folds ASCII letters only (IMP-240). */
const FIND_LATEST_GENERATION_MARKER = new RegExp(FIND_LATEST_GENERATION_ATTRIBUTE, "i");

/** The catalogue text `WARNINGTheFollowingPortionOfTheAMLContainsUnresolvedReferenceThatWillBeTriedToResolveAtTheEndOfThePackageImport`. */
const UNRESOLVED_REFERENCE_WARNING =
  "WARNING: The following portion of the AML \n{0}\ncontains unresolved reference that will be tried to resolve at the end of the package import";

/** The catalogue text `WrongFormatOfTheAMLThatContainsTag`. */
const WRONG_FORMAT_OF_THE_AML = "Wrong format of the AML that contains tag {0}";

/** The catalogue text `DELAYEDRESOLUTIONAapplyingAML`. */
const APPLYING_AML = "DELAYED RESOLUTION: applying AML {0}";

/** The part of the helper the queue run needs: `applyAML` (IMP-240), and the current id of a version (IMP-241). */
export interface DelayedResolutionHelper {
  applyAML(aml: string): Promise<unknown>;
  lookups: { getCurrentIdOfVersion(id: string, type: string): Promise<string> };
}

/** `string.Format` with one argument: `{0}` is replaced by the value as it is, with no escaping (IMP-204). */
const format = (template: string, value: string): string => template.replace("{0}", () => value);

/** The plain `System.Exception` that wraps a failure of a routine, with the original as its inner exception (IMP-203). */
export class WrongFormatOfTheAmlException extends DotNetException {
  constructor(
    message: string,
    readonly innerException: unknown,
  ) {
    super("System.Exception", message);
  }
}

/** The .NET type name `InvalidCastException` quotes for a node that is not an element (IMP-203). */
function dotNetTypeName(node: XmlNode): string {
  switch (node.nodeType) {
    case DOCUMENT_NODE:
      return "System.Xml.XmlDocument";
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

/** The cast `(XmlElement)node`: null stays null, a node of another kind is an `InvalidCastException`. */
function asElement(node: XmlNode | null): XmlElement | null {
  if (node === null || node.nodeType === ELEMENT_NODE) return node as XmlElement | null;
  throw new DotNetException(
    "System.InvalidCastException",
    `Unable to cast object of type '${dotNetTypeName(node)}' to type 'System.Xml.XmlElement'.`,
  );
}

/** The node a routine dereferences: a null one is the `NullReferenceException` of the use. */
function required<T extends XmlNode>(node: T | null): T {
  if (node === null) throw nullReference();
  return node;
}

/** `XmlNode.ParentNode`, dereferenced: a node that is null is a `NullReferenceException`. */
function parentOf(node: XmlNode | null): XmlNode | null {
  if (node === null) throw nullReference();
  return node.parentNode;
}

/** `Attributes["name"].Value`: a missing attribute is a `NullReferenceException`. */
function attributeValue(element: XmlElement, name: string): string {
  const attribute = element.getAttributeNode(name);
  if (attribute === null) throw nullReference();
  return attribute.value;
}

/** `XmlElement.GetAttribute(name)`: the value, or the empty string for a missing attribute. */
const getAttribute = (element: XmlElement, name: string): string => element.getAttributeNode(name)?.value ?? "";

/**
 * `DelayedResolutionManager`: the references the checks found to items that do not exist yet. For each one it edits the
 * item document, so that the item can be imported without the reference, and queues AML that puts the reference back at
 * the end of the package (IMP-200). The queue is a list of strings built by concatenation, with no escaping (IMP-204).
 *
 * Reproduced bugs: a relationship owner addressed by `where` is queued as `where='System.Xml.XmlAttribute'` (IMP-211), the
 * `where` branch for a relationship item is dead code (IMP-213), and the floating-reference replacement never matches
 * (IMP-242).
 *
 * 14.35 queues each entry once (IMP-251) and addresses a Property that has no `id` by its `where` (IMP-220).
 *
 * @spec IMP-200 IMP-201 IMP-202 IMP-203 IMP-204 IMP-210 IMP-211 IMP-212 IMP-213 IMP-220 IMP-221 IMP-222 IMP-230 IMP-240 IMP-241 IMP-242 IMP-250
 * @spec IMP-251 IMP-520
 */
export class DelayedResolutionManager implements DelayedResolution {
  /** `_mDelayedAmLs`: the queue, the manager's only state (IMP-200). */
  private readonly delayedAml: string[] = [];

  constructor(readonly engine: Engine = DEFAULT_ENGINE) {
    if (!DELAYED_RESOLUTION_ENGINES.includes(engine)) throw new EngineNotSupportedError(engine);
  }

  /** The queued entries, in queue order. */
  get queue(): readonly string[] {
    return this.delayedAml;
  }

  /**
   * `GetDelayedAmls`: the queue itself, which the AML batch mode hands over to the package's queue after a flush (IMP-520).
   *
   * @spec IMP-520
   */
  getDelayedAmls(): readonly string[] {
    return this.delayedAml;
  }

  /**
   * `AddDelayedAmls`: adds each entry of a list through `AddDelayedAmlItem`, so that an entry equal to one this queue already holds is
   * dropped (IMP-520, IMP-251).
   *
   * @spec IMP-520 IMP-251
   */
  addDelayedAmls(entries: readonly string[]): void {
    for (const entry of entries) this.addDelayedAmlItem(entry);
  }

  /**
   * `AddDelayedAmlItem`: appends an entry to the queue. 14.0.7 appends every entry, so two equal ones both run; 14.35 drops an entry
   * equal (ordinal) to one it already holds (IMP-251). What the caller does around the call happens either way.
   *
   * @spec IMP-200 IMP-250 IMP-251
   */
  private addDelayedAmlItem(aml: string): void {
    if (this.engine === "14.35" && this.delayedAml.includes(aml)) return;
    this.delayedAml.push(aml);
  }

  /**
   * `ProcessForDelayedResolution`: for each reference, in list order, the warning line, then the edit its code asks for
   * (IMP-201). The first reference that fails ends the call (IMP-203).
   */
  processForDelayedResolution(unresolved: readonly UnresolvedReference[], log: LogWriter): void {
    for (const reference of unresolved) {
      const node = reference.problemNode;
      if (node === null) throw nullReference();
      log.writeLine(format(UNRESOLVED_REFERENCE_WARNING, outerXml(node)));
      if (reference.faultcode === 10001) this.processRelatedItem(node);
      else if (reference.faultcode === 10000 || reference.faultcode === 10004) this.processUnresolvedNode(required(asElement(node)));
      else if (reference.faultcode === 10005) this.processRelatedRelationshipItem(node);
    }
  }

  /**
   * `ExecuteDelayedResolution`: applies the queue in order and stops at the first failure (IMP-240). An entry that holds
   * the floating-reference marker goes through `ReplaceRelatedIdOnLatestId` first.
   */
  async executeDelayedResolution(helper: DelayedResolutionHelper, log: LogWriter): Promise<void> {
    for (const entry of this.delayedAml) {
      let aml = entry;
      if (FIND_LATEST_GENERATION_MARKER.test(entry)) {
        aml = (await this.replaceRelatedIdOnLatestId(helper, entry)) ?? entry;
      }
      log.writeLine(format(APPLYING_AML, aml));
      await helper.applyAML(aml);
    }
  }

  /**
   * `ReplaceRelatedIdOnLatestId`: parses the entry and looks for a floating `related_id` at
   * `/AML/Item/Relationships/Item/related_id`. Every queued entry is rooted at `Item`, so nothing is found and the result
   * is null (IMP-242); the replacement below is reached only by a call on an AML that is rooted at `AML`.
   */
  async replaceRelatedIdOnLatestId(helper: DelayedResolutionHelper, aml: string): Promise<string | null> {
    const document = loadXml(aml, { preserveWhitespace: false });
    const related = selectSingleNode("/AML/Item/Relationships/Item/related_id", document) as XmlElement | null;
    if (related === null || related.getAttributeNode(FIND_LATEST_GENERATION_ATTRIBUTE) === null) return null;
    related.removeAttribute(FIND_LATEST_GENERATION_ATTRIBUTE);
    const id = innerText(related);
    const type = attributeValue(related, "type");
    setInnerText(related, await helper.lookups.getCurrentIdOfVersion(id, type));
    return outerXml(document);
  }

  /** Runs a routine, and wraps whatever it throws in the plain exception of IMP-203. */
  private guarded(node: XmlNode, routine: () => void): void {
    try {
      routine();
    } catch (error) {
      throw new WrongFormatOfTheAmlException(format(WRONG_FORMAT_OF_THE_AML, outerXml(node)), error);
    }
  }

  /**
   * `ProcessRelatedItem` (10001): the relationship that holds the missing `related_id` becomes an `add` under an `edit` of
   * its owner, and is removed from the document (IMP-210). An owner addressed only by `where` is queued with the text
   * `System.Xml.XmlAttribute` (IMP-211).
   */
  private processRelatedItem(node: XmlNode): void {
    this.guarded(node, () => {
      const relationship = required(asElement(node.parentNode));
      const owner = required(asElement(parentOf(parentOf(relationship))));
      let entry = `<Item type='${attributeValue(owner, "type")}'`;
      if (owner.getAttributeNode("id") !== null || owner.getAttributeNode("where") === null) {
        entry += ` id='${attributeValue(owner, "id")}'`;
      } else {
        entry += " where='System.Xml.XmlAttribute'";
      }
      entry += " action='edit' doGetItem='0' version='0'><Relationships>";
      relationship.setAttribute("action", "add");
      entry += outerXml(relationship);
      entry += "</Relationships></Item>";
      this.addDelayedAmlItem(entry);
      (relationship.parentNode as XmlNode).removeChild(relationship);
    });
  }

  /**
   * `ProcessRelatedRelationshipItem` (10005): the relationship item becomes an `edit` of its owner and is removed from its
   * container (IMP-212). The owner is always addressed by `id`, since the test for the `where` form is always true
   * (IMP-213).
   */
  private processRelatedRelationshipItem(node: XmlNode): void {
    this.guarded(node, () => {
      const container = required(asElement(node.parentNode));
      const owner = required(asElement(container.parentNode));
      let entry = `<Item type='${getAttribute(owner, "type")}'`;
      entry += ` id='${getAttribute(owner, "id")}'`;
      entry += " action='edit' doGetItem='0' version='0'><Relationships>";
      entry += outerXml(node);
      entry += "</Relationships></Item>";
      this.addDelayedAmlItem(entry);
      container.removeChild(node);
    });
  }

  /**
   * How the queued edit addresses its Property (IMP-220): by `id`, as `id=''` when it has none in 14.0.7, and in 14.35 by its own
   * `where` (double quotes, unescaped) when the `id` is missing or empty.
   */
  private propertyAddress(property: XmlElement): string {
    const id = getAttribute(property, "id");
    if (this.engine === "14.35" && id === "") return `where="${getAttribute(property, "where")}"`;
    return `id='${id}'`;
  }

  /**
   * `ProcessUnresolvedNode` (10000, 10004): the data source or foreign property is queued as an edit of its Property, and
   * set to the zero id in the document (IMP-220). A bare data source is rewritten as a get (IMP-221).
   */
  private processUnresolvedNode(fp: XmlElement): void {
    this.guarded(fp, () => {
      const property = required(asElement(fp.parentNode));
      const owner = required(asElement(parentOf(property.parentNode)));
      let text = outerXml(fp);
      const dataType = innerText(required(selectSingleNode("data_type", property)));
      if (fp.localName === "data_source") {
        switch (dataType) {
          case "list":
          case "filter list":
          case "color list":
          case "sequence":
          case "item":
            if (selectSingleNode("Item", fp) === null) {
              const keyedName = getAttribute(fp, "keyed_name");
              const type = dataType.includes("list") ? "List" : dataType === "sequence" ? "Sequence" : "ItemType";
              text = `<data_source type='${type}'><Item type='${type}' keyed_name='${keyedName}' action='get'><id>${innerText(fp)}</id></Item></data_source>`;
            }
            break;
        }
      }
      this.addDelayedAmlItem(
        `<Item type='${getAttribute(owner, "type")}' id='${getAttribute(owner, "id")}' action='edit' doGetItem='0'>` +
          `<Relationships><Item type='Property' ${this.propertyAddress(property)} action='edit'>${text}</Item></Relationships></Item>`,
      );
      setInnerText(fp, FAKED_DATA_SOURCE);
    });
  }
}
