import { DOMImplementation } from "@xmldom/xmldom";
import type { Attr, Document, DocumentFragment, Element, Node } from "@xmldom/xmldom";
import { XML_NS } from "./chars.js";

/**
 * The DOM the port keeps its XML in: xmldom's W3C DOM, plus the pieces of .NET's `XmlDocument` that xmldom
 * does not model. They are recorded beside the nodes, never on them:
 *
 * - `IsEmpty` of an element, which decides `<x />` or `<x></x>` when the document is written (EXP-424);
 * - `PreserveWhitespace` of a document;
 * - the XML declaration of a document, which is not a child node (XPath does not see it, .NET's does not
 *   select it either).
 *
 * Code that changes a document after it was loaded uses the helpers of this file, so that `IsEmpty`
 * follows .NET's rules (EXP-427).
 */

export type XmlDocument = Document;
export type XmlElement = Element;
export type XmlNode = Node;
export type XmlAttribute = Attr;

export const ELEMENT_NODE = 1;
export const ATTRIBUTE_NODE = 2;
export const TEXT_NODE = 3;
export const CDATA_SECTION_NODE = 4;
export const PROCESSING_INSTRUCTION_NODE = 7;
export const COMMENT_NODE = 8;
export const DOCUMENT_NODE = 9;
export const DOCUMENT_TYPE_NODE = 10;
export const DOCUMENT_FRAGMENT_NODE = 11;

/** The `<?xml ... ?>` declaration of a loaded document. */
export interface XmlDeclaration {
  version: string;
  encoding: string;
  standalone: string;
}

interface DocumentState {
  preserveWhitespace: boolean;
  declaration: XmlDeclaration | null;
}

const states = new WeakMap<XmlDocument, DocumentState>();
const emptyElements = new WeakSet<XmlElement>();
const entityReferences = new WeakMap<XmlNode, string>();
const implementation = new DOMImplementation();

/** `new XmlDocument()` with the given `PreserveWhitespace`. */
export function createXmlDocument(preserveWhitespace = false): XmlDocument {
  // xmldom's typings want a qualified name, its code accepts none
  const doc = implementation.createDocument(null, null as unknown as string);
  states.set(doc, { preserveWhitespace, declaration: null });
  return doc;
}

/** True for a document made by {@link createXmlDocument}, the only ones this library's helpers know. */
export function isXmlDocument(node: XmlNode): node is XmlDocument {
  return node.nodeType === DOCUMENT_NODE && states.has(node as XmlDocument);
}

function stateOf(doc: XmlDocument): DocumentState {
  const state = states.get(doc);
  if (!state) throw new TypeError("The document was not created by the XML core (createXmlDocument or loadXml)");
  return state;
}

export function ownerDocument(node: XmlNode): XmlDocument {
  return (node.nodeType === DOCUMENT_NODE ? node : node.ownerDocument) as XmlDocument;
}

export function preservesWhitespace(doc: XmlDocument): boolean {
  return stateOf(doc).preserveWhitespace;
}

export function setPreserveWhitespace(doc: XmlDocument, value: boolean): void {
  stateOf(doc).preserveWhitespace = value;
}

export function getDeclaration(doc: XmlDocument): XmlDeclaration | null {
  return stateOf(doc).declaration;
}

export function setDeclaration(doc: XmlDocument, declaration: XmlDeclaration | null): void {
  stateOf(doc).declaration = declaration;
}

/**
 * An entity reference .NET could not resolve, which `InnerXml` accepts and writes back as `&name;` (EXP-406). xmldom's DOM has no
 * node for it, so it is an empty text node that remembers the name.
 */
export function createEntityReference(doc: XmlDocument, name: string): XmlNode {
  const node = doc.createTextNode("");
  entityReferences.set(node, name);
  return node;
}

/** The name of the entity a node stands for, if it is one made by {@link createEntityReference}. */
export function entityReferenceName(node: XmlNode): string | undefined {
  return entityReferences.get(node);
}

/** `XmlElement.IsEmpty`. */
export function isEmpty(element: XmlElement): boolean {
  return emptyElements.has(element);
}

/**
 * Sets `XmlElement.IsEmpty`. Setting it to true removes the element's children, as .NET does.
 * @spec EXP-424 EXP-427
 */
export function setIsEmpty(element: XmlElement, empty: boolean): void {
  if (empty) {
    removeChildren(element);
    emptyElements.add(element);
  } else {
    emptyElements.delete(element);
  }
}

/** Marks a freshly parsed element as `<x/>`. The parser calls it; nothing else should. */
export function markEmpty(element: XmlElement): void {
  emptyElements.add(element);
}

/** `XmlDocument.CreateElement`: the new element is empty, so it is written `<x />` until it gets a child. */
export function createElement(doc: XmlDocument, qualifiedName: string, namespaceUri: string | null = null): XmlElement {
  const element = doc.createElementNS(namespaceUri, qualifiedName);
  emptyElements.add(element);
  return element;
}

/** `XmlNode.RemoveAllChildren`: the element keeps its `IsEmpty` flag. */
export function removeChildren(node: XmlNode): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** `XmlNode.AppendChild`: an element that gets a child is no longer empty, whatever happens to the child later. */
export function appendChild<T extends XmlNode>(parent: XmlNode, child: T): T {
  parent.appendChild(child);
  if (parent.nodeType === ELEMENT_NODE) emptyElements.delete(parent as XmlElement);
  return child;
}

/** `XmlNode.InsertBefore`. */
export function insertBefore<T extends XmlNode>(parent: XmlNode, child: T, reference: XmlNode | null): T {
  parent.insertBefore(child, reference);
  if (parent.nodeType === ELEMENT_NODE) emptyElements.delete(parent as XmlElement);
  return child;
}

/**
 * `XmlDocument.ImportNode(node, true)`: a deep copy owned by `doc`. Elements keep their `IsEmpty` flag, and an unresolved
 * entity reference stays one.
 */
export function importNode<T extends XmlNode>(doc: XmlDocument, node: T): T {
  const copy = doc.importNode(node, true) as T;
  copyMarks(node, copy);
  return copy;
}

/** Carries what is recorded beside the nodes (`IsEmpty`, entity references) from a node to its copy, child by child. */
function copyMarks(from: XmlNode, to: XmlNode): void {
  if (from.nodeType === ELEMENT_NODE && emptyElements.has(from as XmlElement)) emptyElements.add(to as XmlElement);
  const entity = entityReferences.get(from);
  if (entity !== undefined) entityReferences.set(to, entity);
  for (let a = from.firstChild, b = to.firstChild; a && b; a = a.nextSibling, b = b.nextSibling) copyMarks(a, b);
}

/** `XmlNode.RemoveChild`. The parent keeps its `IsEmpty` flag, so a parent that had content becomes `<x></x>`. */
export function removeChild<T extends XmlNode>(parent: XmlNode, child: T): T {
  parent.removeChild(child);
  return child;
}

/**
 * `XmlElement.RemoveAll`: removes the attributes and the children, and keeps `IsEmpty` as it was.
 * @spec EXP-427
 */
export function removeAll(element: XmlElement): void {
  removeChildren(element);
  const attributes = element.attributes;
  while (attributes.length > 0) {
    const attribute = attributes[0];
    if (!attribute) break;
    element.removeAttributeNode(attribute);
  }
}

/** The attributes of an element in DOM order, namespace declarations included. */
export function attributesOf(element: XmlElement): XmlAttribute[] {
  const list: XmlAttribute[] = [];
  const attributes = element.attributes;
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index];
    if (attribute) list.push(attribute);
  }
  return list;
}

/** The children of a node as an array. */
export function childrenOf(node: XmlNode): XmlNode[] {
  const list: XmlNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) list.push(child);
  return list;
}

export function documentElementOf(doc: XmlDocument): XmlElement | null {
  for (let child = doc.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === ELEMENT_NODE) return child as XmlElement;
  }
  return null;
}

/** `XmlNode.InnerText`: the text of all text, whitespace and CDATA descendants, in document order. */
export function innerText(node: XmlNode): string {
  switch (node.nodeType) {
    case TEXT_NODE:
    case CDATA_SECTION_NODE:
      return (node as unknown as { data: string }).data;
    case ELEMENT_NODE:
    case DOCUMENT_FRAGMENT_NODE:
    case DOCUMENT_NODE: {
      let text = "";
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === COMMENT_NODE || child.nodeType === PROCESSING_INSTRUCTION_NODE) continue;
        text += innerText(child);
      }
      return text;
    }
    default:
      return (node as unknown as { nodeValue: string | null }).nodeValue ?? "";
  }
}

/**
 * `XmlElement.InnerText = value`: a single text child holds the value, even when the value is empty, so the
 * element is written `<x></x>` and never `<x />` (EXP-427).
 * @spec EXP-427
 */
export function setInnerText(element: XmlElement, value: string): void {
  const only = element.firstChild;
  if (only && !only.nextSibling && only.nodeType === TEXT_NODE) {
    (only as unknown as { data: string }).data = value;
    return;
  }
  removeChildren(element);
  appendChild(element, ownerDocument(element).createTextNode(value));
}

/** The namespace declarations in scope at an element, from its own attributes up to the root. */
export function namespacesInScope(element: XmlElement): Map<string, string> {
  const scope = new Map<string, string>();
  for (let node: XmlNode | null = element; node && node.nodeType === ELEMENT_NODE; node = node.parentNode) {
    for (const attribute of attributesOf(node as XmlElement)) {
      const localName = attribute.localName ?? "";
      if (attribute.name === "xmlns" && !scope.has("")) scope.set("", attribute.value);
      else if (attribute.prefix === "xmlns" && !scope.has(localName)) scope.set(localName, attribute.value);
    }
  }
  if (!scope.has("xml")) scope.set("xml", XML_NS);
  return scope;
}

export type { DocumentFragment };
