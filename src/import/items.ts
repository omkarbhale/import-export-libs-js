import { ArgumentNullException } from "../io/errors.js";
import { ELEMENT_NODE, documentElementOf } from "../xml/dom.js";
import type { XmlDocument } from "../xml/dom.js";
import { loadXml } from "../xml/parser.js";
import { outerXml } from "../xml/writer-legacy.js";
import { isPlainElement } from "./build-order.js";

/**
 * `ImportExportManager.GetItemsFromPackageDom`: one new document per `Item` that is a direct child of the root `AML`, in
 * document order, each loaded from the item's `OuterXml` (white space dropped). Nothing is removed, merged or skipped, so an
 * item that `build.xsl` wrote more than once (IMP-026) appears once per copy. A null document throws
 * `ArgumentNullException` for `packageDom`.
 * @spec IMP-015
 */
export function getItemsFromPackageDom(packageDom: XmlDocument | null): XmlDocument[] {
  if (packageDom === null) throw new ArgumentNullException("packageDom");
  const root = documentElementOf(packageDom);
  const items: XmlDocument[] = [];
  if (!root || !isPlainElement(root, "AML")) return items;
  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === ELEMENT_NODE && isPlainElement(child, "Item")) {
      items.push(loadXml(outerXml(child), { preserveWhitespace: false }));
    }
  }
  return items;
}
