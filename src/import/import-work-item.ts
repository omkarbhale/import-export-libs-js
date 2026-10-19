import { nullReference } from "../client/dotnet.js";
import type { XmlDocument, XmlElement } from "../xml/dom.js";
import { selectSingleNode } from "../xml/xpath.js";
import { outerXml } from "../xml/writer-legacy.js";
import { DEFAULT_ENGINE, type Engine } from "../engines.js";
import type { SUImportContext } from "./import-context.js";

/** `XmlElement.GetAttribute(name)`: the value, or the empty string for a missing attribute. */
const getAttribute = (element: XmlElement, name: string): string => element.getAttributeNode(name)?.value ?? "";

/** `string.IsNullOrEmpty(value) ? " " : prefix + value + suffix`: one part of the descriptor of an item (IMP-422). */
const part = (value: string, prefix: string, suffix: string): string => (value !== "" ? `${prefix}${value}${suffix}` : " ");

/**
 * `ImportWorkItem`: one item document of a package as the import loop holds it (IMP-422). The constructor reads the root `Item`
 * the way the loop of 14.0.7 did inline: it sets `doGetItem` to `0`, reads `action`, `id`, `type`, `tempKeyName` and
 * `tempFullName` in that order, removes the last two (IMP-009) and builds the descriptor from the id, the keyed name and the
 * type. A document without a root `Item` is a null reference.
 *
 * The properties are the ones the loop reads: `id` is read again after the item is sent (IMP-428), and the registration in the
 * package definition may replace it with the config id (IMP-429). `thoroughCheck` is the `flag2` of IMP-427: the checks run in
 * full unless the action is `delete` (`bFast` always reads false, IMP-401). `originalOuterXml` is the item as it stands after the
 * removal, which only the AML batch mode restores (IMP-510); 14.0.7 keeps none.
 *
 * @spec IMP-422 IMP-510
 */
export class ImportWorkItem {
  /** The item document (`Item`). */
  readonly item: XmlDocument;
  /** The root `Item` element (`ItemNode`). */
  readonly itemNode: XmlElement;
  action: string;
  id: string;
  readonly workItemType: string;
  readonly originalKeyedName: string;
  readonly originalFullFileName: string;
  /** The descriptor `  id : {id}    keyed_name : {key}    type : {type}  `, with a single space for a part that is empty (`KeyIdType`). */
  readonly keyIdType: string;
  readonly thoroughCheck: boolean;
  originalOuterXml: string;

  constructor(item: XmlDocument, importContext: SUImportContext, engine: Engine = DEFAULT_ENGINE) {
    this.item = item;
    const node = selectSingleNode("Item", item) as XmlElement | null;
    if (node === null) throw nullReference();
    this.itemNode = node;
    node.setAttribute("doGetItem", "0");
    this.action = getAttribute(node, "action");
    this.id = getAttribute(node, "id");
    this.workItemType = getAttribute(node, "type");
    this.originalKeyedName = getAttribute(node, "tempKeyName");
    node.removeAttribute("tempKeyName");
    this.originalFullFileName = getAttribute(node, "tempFullName");
    node.removeAttribute("tempFullName");
    this.keyIdType =
      part(this.id, "  id : ", "  ") + part(this.originalKeyedName, "  keyed_name : ", "  ") + part(this.workItemType, "  type : ", "  ");
    this.thoroughCheck = !importContext.fast && this.action !== "delete";
    // 14.0.7 has no work item and no restore (IMP-510): it never writes the item out before the checks
    this.originalOuterXml = engine === "14.35" ? outerXml(item) : "";
  }
}
