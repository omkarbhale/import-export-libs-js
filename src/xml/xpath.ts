import { DOMImplementation, Node as DomNode } from "@xmldom/xmldom";
import * as xpath from "xpath";
import { XMLNS_NS, XML_NS } from "./chars.js";
import { ATTRIBUTE_NODE, DOCUMENT_NODE, isXmlDocument } from "./dom.js";
import type { XmlAttribute, XmlNode } from "./dom.js";
import { XPathException } from "./errors.js";
import { checkXPathSyntax } from "./xpath-syntax.js";

/**
 * `SelectNodes`, `SelectSingleNode` and `XPathNavigator.Evaluate` over the port's DOM: XPath 1.0 by the `xpath`
 * package, with the document order it needs cached per document, the `xml` prefix always bound, and .NET's exception
 * messages for the failures that can reach a log.
 *
 * Known gaps:
 * - .NET merges a text node and the CDATA sections next to it into one XPath text node, `xpath` keeps them apart. The
 *   only engine query that looks at `text()` is the `source_id` test of CItemHelper's import lookups, and it differs
 *   only for a hand-edited package that mixes both in one element.
 * - Namespace declarations are attributes to xmldom and not to XPath 1.0. A node set that is returned drops them, but
 *   `count(@*)` and a predicate over `@*` still see them. No engine query uses `@*`.
 *
 * @spec MAN-014
 */

export type XPathValue = XmlNode[] | string | number | boolean;

// ---------------------------------------------------------------- document order

interface OrderIndex {
  document: XmlNode;
  mutations: number;
  position: Map<XmlNode, number>;
}

const orderIndexes = new WeakMap<XmlNode, OrderIndex>();
/** The index used last: a query compares nodes of one document thousands of times in a row. */
let current: OrderIndex | null = null;

function mutationCount(doc: XmlNode): number | undefined {
  const count = (doc as unknown as { _inc?: unknown })._inc;
  return typeof count === "number" ? count : undefined;
}

/** A pre-order index of every node and attribute of the document, rebuilt when xmldom's mutation counter moves. */
function orderIndex(doc: XmlNode, mutations: number): OrderIndex {
  const cached = orderIndexes.get(doc);
  if (cached && cached.mutations === mutations) return cached;
  const position = new Map<XmlNode, number>();
  let next = 0;
  const visit = (node: XmlNode): void => {
    position.set(node, next);
    next += 1;
    const attributes = (node as unknown as { attributes?: ArrayLike<XmlNode> }).attributes;
    if (attributes) {
      for (let i = 0; i < attributes.length; i += 1) {
        position.set(attributes[i] as XmlNode, next);
        next += 1;
      }
    }
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
  };
  visit(doc);
  const index = { document: doc, mutations, position };
  orderIndexes.set(doc, index);
  return index;
}

const compareOriginal = DomNode.prototype.compareDocumentPosition;
const DOCUMENT_POSITION_PRECEDING = 0x02;
const DOCUMENT_POSITION_FOLLOWING = 0x04;

// `xpath` keeps node sets in document order with compareDocumentPosition, which xmldom answers by walking the tree:
// quadratic on a large response. The replacement answers from a cached index, for the port's own documents only.
// It reads xmldom's `_inc` counter, which every child and attribute change bumps; src/xml/xpath.test.ts fails if that stops.
DomNode.prototype.compareDocumentPosition = function compareDocumentPosition(this: XmlNode, other: XmlNode): number {
  const doc = this.nodeType === DOCUMENT_NODE ? this : this.ownerDocument;
  if (!doc) return compareOriginal.call(this, other);
  let index = current;
  if (!index || index.document !== doc || mutationCount(doc) !== index.mutations) {
    const mutations = isXmlDocument(doc) ? mutationCount(doc) : undefined;
    if (mutations === undefined) return compareOriginal.call(this, other);
    index = orderIndex(doc, mutations);
    current = index;
  }
  const a = index.position.get(this);
  const b = index.position.get(other);
  if (a === undefined || b === undefined) return compareOriginal.call(this, other);
  if (a === b) return 0;
  return b < a ? DOCUMENT_POSITION_PRECEDING : DOCUMENT_POSITION_FOLLOWING;
};

// ---------------------------------------------------------------- evaluation

// `xpath` takes a DOM for an HTML one, and then matches element and attribute names without regard to case, when
// `implementation.hasFeature("HTML", "2.0")` is true, and xmldom answers true for every feature. .NET's XPath compares names
// exactly (MAN-001), so the answer is false; src/xml/xml-core.test.ts fails if a name matches in another case.
(DOMImplementation.prototype as unknown as { hasFeature(): boolean }).hasFeature = () => false;

const select = xpath.useNamespaces({ xml: XML_NS });

function evaluateRaw(expression: string, context: XmlNode): unknown {
  checkXPathSyntax(expression);
  try {
    return select(expression, context as never);
  } catch (error) {
    throw mapFailure(error);
  }
}

/** What the `xpath` package can still refuse once the expression has passed the syntax check. */
function mapFailure(error: unknown): XPathException {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = /Cannot resolve QName ([^\s]+)/.exec(message);
  if (prefix) return new XPathException(`Namespace prefix '${(prefix[1] ?? "").split(":")[0]}' is not defined.`);
  if (/function/i.test(message) && /not found|unknown|undefined/i.test(message)) {
    return new XPathException("XsltContext is needed for this query because of an unknown function.");
  }
  return new XPathException("Expression must evaluate to a node-set.");
}

/** `XPathNavigator.Evaluate(expression)`: a node set, a string, a number or a boolean. */
export function evaluate(expression: string, context: XmlNode): XPathValue {
  const value = evaluateRaw(expression, context);
  // namespace declarations are attributes to xmldom and not to XPath 1.0
  if (Array.isArray(value)) return (value as XmlNode[]).filter((node) => !(node.nodeType === ATTRIBUTE_NODE && (node as XmlAttribute).namespaceURI === XMLNS_NS));
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw new XPathException("Expression must evaluate to a node-set.");
}

/** `XmlNode.SelectNodes(expression)`, in document order. */
export function selectNodes(expression: string, context: XmlNode): XmlNode[] {
  const value = evaluate(expression, context);
  if (!Array.isArray(value)) throw new XPathException("Expression must evaluate to a node-set.");
  return value;
}

/** `XmlNode.SelectSingleNode(expression)`: the first node in document order, or null. */
export function selectSingleNode(expression: string, context: XmlNode): XmlNode | null {
  return selectNodes(expression, context)[0] ?? null;
}

