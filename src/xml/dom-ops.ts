import { appendChild, removeChildren } from "./dom.js";
import type { XmlElement } from "./dom.js";
import { parseFragment } from "./parser.js";
import { innerXml } from "./writer-legacy.js";

/**
 * `XmlElement.InnerXml = xml`: the old children go and the text is parsed as the new content, in the namespace scope of
 * the element and with its document's white space setting. An element whose new content is empty keeps its `IsEmpty`
 * flag, and any node added clears it (EXP-427).
 * @spec EXP-427 EXP-405
 */
export function setInnerXml(element: XmlElement, xml: string): void {
  const nodes = parseFragment(xml, element);
  removeChildren(element);
  for (const node of nodes) appendChild(element, node);
}

/** `XmlElement.InnerXml`: the children as XML text, without indentation. */
export function getInnerXml(element: XmlElement): string {
  return innerXml(element);
}
