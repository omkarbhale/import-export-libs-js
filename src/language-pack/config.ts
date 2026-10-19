import { trimWhiteSpace } from "../client/dotnet.js";
import { selectNodes, selectSingleNode } from "../xml/index.js";
import type { XmlElement } from "../xml/index.js";
import { toLowerInvariant } from "./invariant-lower.js";

/** `XmlElement.GetAttribute(name)`: the value of the attribute with that qualified name, the empty string when there is none. */
export function getAttribute(element: XmlElement, name: string): string {
  return element.getAttributeNode(name)?.value ?? "";
}

/**
 * `GetRequestedLanguages(config)`: the codes the configuration asks for. They come from the `list` of the first child element of
 * the root named `languages`: lower-cased as a whole, and when that is not empty split on `,` with each part trimmed. An empty
 * part is a code like any other. The result is only asked "is this code in it?" and "is it empty?", so it is a set (LP-015).
 * @spec LP-011 LP-013 LP-015
 */
export function getRequestedLanguages(config: XmlElement): Set<string> {
  const requested = new Set<string>();
  const languages = selectSingleNode("languages", config) as XmlElement | null;
  if (languages === null) return requested;
  const list = toLowerInvariant(getAttribute(languages, "list"));
  if (list === "") return requested;
  for (const part of list.split(",")) requested.add(trimWhiteSpace(part));
  return requested;
}

/**
 * `GetItemTypes(config)`: the `itemtype` children of the root, in document order, each giving its `name` (the empty string when
 * it has none) and its list of property names. The list is empty, which means every property, unless the first `properties`
 * child has a `list` that is not empty once trimmed and lower-cased; then it is that text split on `,` with no trimming of the
 * parts. A later entry of the same name replaces the earlier one.
 * @spec LP-012 LP-013 LP-015
 */
export function getItemTypes(config: XmlElement): Map<string, string[]> {
  const itemTypes = new Map<string, string[]>();
  for (const node of selectNodes("itemtype", config)) {
    const itemType = node as XmlElement;
    const properties = selectSingleNode("properties", itemType) as XmlElement | null;
    let names: string[] = [];
    if (properties !== null) {
      const list = toLowerInvariant(trimWhiteSpace(getAttribute(properties, "list")));
      if (list !== "") names = list.split(",");
    }
    itemTypes.set(getAttribute(itemType, "name"), names);
  }
  return itemTypes;
}
