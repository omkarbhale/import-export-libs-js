import {
  ELEMENT_NODE,
  attributesOf,
  childrenOf,
  documentElementOf,
  importNode,
  innerText,
  insertBefore,
  loadXml,
  outerXml,
  preservesWhitespace,
  removeChild,
  selectNodes,
  writeDocument,
} from "../xml/index.js";
import type { XmlDocument, XmlElement, XmlNode } from "../xml/index.js";
import { XMLNS_NS, XML_NS } from "../xml/chars.js";
import { LANGUAGE_RESOURCES_ONLY, isLanguageMode } from "./export-context.js";
import { createAttr } from "./post-xsl.js";

/** The namespace `xmlns:i18n` declares on the top-level Items (LP-144). */
const I18N_NAMESPACE = "http://www.aras.com/I18N";

const isElement = (node: XmlNode): node is XmlElement => node.nodeType === ELEMENT_NODE;
const elementChildren = (node: XmlNode): XmlElement[] => childrenOf(node).filter(isElement);

/** Every element below a document, in document order. */
function elementsOf(node: XmlNode): XmlElement[] {
  return elementChildren(node).flatMap((child) => [child, ...elementsOf(child)]);
}

/** The `xml:lang` attribute of an element, or undefined when it has none. */
const langOf = (element: XmlElement): string | undefined => element.getAttributeNodeNS(XML_NS, "lang")?.value;

/**
 * `MarkPropertiesWithTranslationsIfNeeded(doc, action)` (LP-141): in `ExportLanguageResourcesOnly` every `Item[@type='Property']`
 * (compared exactly, at any depth) that has a direct child with an `xml:lang` other than `en` (upper-cased, so `EN` and `En` do not count)
 * and a non-empty `InnerText` gets `export_has_translations="1"`, appended after its attributes and replacing an attribute of that
 * name. The action `Export` and `ExportMetadataWithLanguageResources` leave the document alone.
 *
 * @spec LP-141
 */
export function markPropertiesWithTranslationsIfNeeded(doc: XmlDocument, action: string): void {
  if (action !== LANGUAGE_RESOURCES_ONLY) return;
  for (const node of selectNodes("//Item[@type='Property']", doc)) {
    const property = node as XmlElement;
    const translated = elementChildren(property).some((child) => {
      const lang = langOf(child);
      return lang !== undefined && lang.toUpperCase() !== "EN" && innerText(child) !== "";
    });
    if (!translated) continue;
    const existing = property.getAttributeNode("export_has_translations");
    if (existing) property.removeAttributeNode(existing);
    property.setAttributeNode(createAttr(doc, "export_has_translations", "1"));
  }
}

/** `p.Name.ToString()` of a LINQ to XML element: `{uri}local`, or the local name when the element is in no namespace. */
const qualifiedName = (element: XmlElement): string => ((element.namespaceURI ?? "") === "" ? (element.localName ?? element.nodeName) : `{${element.namespaceURI}}${element.localName}`);

/**
 * `RemoveNotLocalizedProperties(doc)` (LP-142, LP-186): the transform's output reduced to the language elements and what locates them.
 * An `Item` in no namespace with at least one direct child element that has a non-empty `xml:lang` keeps itself, its ancestors, and
 * its direct children that have a non-empty `xml:lang` or are named `source_id`; every other element goes, with whatever it holds.
 * The engine does this on a LINQ to XML copy (white space between elements dropped) and loads the result back into the document. The
 * port returns that new document; null, when nothing is left, leaves the input as it was.
 *
 * @spec LP-142 LP-186
 */
export function removeNotLocalizedProperties(doc: XmlDocument): XmlDocument | null {
  const copy = loadXml(outerXml(doc), { preserveWhitespace: false, xmlReader: true });
  const elements = elementsOf(copy);

  const kept = new Set<XmlElement>();
  const hasLanguage = (element: XmlElement): boolean => (langOf(element) ?? "") !== "";
  for (const element of elements) {
    if ((element.namespaceURI ?? "") !== "" || element.localName !== "Item") continue;
    const children = elementChildren(element);
    if (!children.some(hasLanguage)) continue;
    for (let node: XmlNode | null = element; node && isElement(node); node = node.parentNode) kept.add(node);
    for (const child of children) {
      if (hasLanguage(child) || qualifiedName(child) === "source_id") kept.add(child);
    }
  }
  for (const element of elements) {
    if (!kept.has(element) && element.parentNode) removeChild(element.parentNode, element);
  }

  const text = documentElementOf(copy) === null ? "" : writeDocument(copy, { indentChars: null, conformance: "document" });
  if (text === "") return null;
  return loadXml(text, { preserveWhitespace: preservesWhitespace(doc) });
}

/**
 * `OrderPropertiesWithTranslations(doc, action)` (LP-143, LP-183): in a language mode, every node with an `xml:lang` that has a
 * namespace prefix is moved directly behind the first node of the list with the same local name, the same parent and no prefix.
 * The list is taken once, in document order, so several prefixed siblings end up in reverse order.
 *
 * @spec LP-143 LP-183
 */
export function orderPropertiesWithTranslations(doc: XmlDocument, action: string): void {
  if (!isLanguageMode(action)) return;
  const list = elementsOf(doc).filter((element) => langOf(element) !== undefined);
  const prefixed = (element: XmlElement): boolean => (element.prefix ?? "") !== "";
  for (const moving of list) {
    if (!prefixed(moving)) continue;
    for (const anchor of list) {
      if (anchor.localName !== moving.localName || anchor.parentNode !== moving.parentNode || prefixed(anchor)) continue;
      const parent = anchor.parentNode as XmlNode;
      insertBefore(parent, importNode(doc, moving), anchor.nextSibling);
      removeChild(parent, moving);
      break;
    }
  }
}

/**
 * `AddI18NNamespaceToAllRootItems(doc, action)` (LP-144): in a language mode every `Item` that is a child of an `AML` element gets
 * `xmlns:i18n="http://www.aras.com/I18N"` as its last attribute. An existing `xmlns:i18n`, whatever its value, is replaced and so
 * moves to the end.
 *
 * @spec LP-144
 */
export function addI18nNamespaceToAllRootItems(doc: XmlDocument, action: string): void {
  if (!isLanguageMode(action)) return;
  for (const node of selectNodes("//AML/Item", doc)) {
    const item = node as XmlElement;
    const existing = attributesOf(item).find((attribute) => attribute.name === "xmlns:i18n");
    if (existing) item.removeAttributeNode(existing);
    const attribute = doc.createAttributeNS(XMLNS_NS, "xmlns:i18n");
    attribute.value = I18N_NAMESPACE;
    item.setAttributeNode(attribute);
  }
}

