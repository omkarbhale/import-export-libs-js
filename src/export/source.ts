import { ELEMENT_NODE, attributesOf, innerText } from "../xml/index.js";
import type { XmlElement, XmlNode } from "../xml/index.js";
import { XMLNS_NS } from "../xml/chars.js";

/**
 * Reading the source tree the way the stylesheet's XPath does. A bare name in a pattern or a path is an element in no namespace
 * (`Item`, `Relationships`), and `@name` is an attribute in no namespace, whatever prefixes the document declares.
 */

/** An element with this name and no namespace: the XPath name test `name`. */
export function isNamed(node: XmlNode | null, name: string): node is XmlElement {
  return node?.nodeType === ELEMENT_NODE && (node as XmlElement).localName === name && !(node as XmlElement).namespaceURI;
}

/** The value of the attribute `@name` (no namespace), or undefined when the element has none. */
export function attributeOf(element: XmlElement, name: string): string | undefined {
  for (const attribute of attributesOf(element)) {
    if (attribute.name === name && !attribute.namespaceURI) return attribute.value;
  }
  return undefined;
}

/** `string(@name)`: the attribute's value, or the empty string. */
export function attributeText(element: XmlElement, name: string): string {
  return attributeOf(element, name) ?? "";
}

/** The child elements named `name`, in document order: the path `name`. */
export function childElements(parent: XmlNode, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (isNamed(child, name)) found.push(child);
  }
  return found;
}

/** The first child element named `name`, in document order. */
export function firstChildElement(parent: XmlNode, name: string): XmlElement | undefined {
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (isNamed(child, name)) return child;
  }
  return undefined;
}

/** `string(name)`: the string-value of the first child element named `name`, or the empty string. */
export function childText(parent: XmlNode, name: string): string {
  const child = firstChildElement(parent, name);
  return child ? innerText(child) : "";
}

/** An `Item` element of this type: the step `Item[@type='type']`. */
export function isItemOfType(node: XmlNode | null, type: string): node is XmlElement {
  return isNamed(node, "Item") && attributeOf(node, "type") === type;
}

/** The parent when it is an element. */
export function parentElement(node: XmlNode): XmlElement | null {
  const parent = node.parentNode;
  return parent?.nodeType === ELEMENT_NODE ? (parent as XmlElement) : null;
}

/** The attributes `@*`: every attribute that is not a namespace declaration, in document order. */
export function copiedAttributes(element: XmlElement): { name: string; value: string }[] {
  return attributesOf(element)
    .filter((attribute) => attribute.namespaceURI !== XMLNS_NS)
    .map((attribute) => ({ name: attribute.name, value: attribute.value }));
}

/**
 * The namespace bindings in scope at an element, as `xsl:copy` copies them (the `xml` prefix excluded): the declarations of its
 * ancestors and its own, outermost element first and in attribute order within each. A prefix declared again further in takes
 * the position of the inner declaration, and an empty default namespace undeclares.
 */
export function namespacesCopiedWith(element: XmlElement): Map<string, string> {
  const chain: XmlElement[] = [];
  for (let node: XmlNode | null = element; node?.nodeType === ELEMENT_NODE; node = node.parentNode) chain.unshift(node as XmlElement);
  const scope = new Map<string, string>();
  for (const owner of chain) {
    for (const attribute of attributesOf(owner)) {
      if (attribute.namespaceURI !== XMLNS_NS) continue;
      const prefix = attribute.name === "xmlns" ? "" : (attribute.localName ?? "");
      scope.delete(prefix);
      if (attribute.value !== "") scope.set(prefix, attribute.value);
    }
  }
  return scope;
}

