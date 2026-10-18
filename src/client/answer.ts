import type { XmlDocument as Dom } from "../xml/dom.js";
import { loadXml as loadDom } from "../xml/parser.js";
import type { ResponseDocument } from "./fault.js";
import { type XmlElement, childElements, descendantElements, innerText, localName, namespaceUri } from "./mini-xml.js";

const SOAP_ENVELOPE = "http://schemas.xmlsoap.org/soap/envelope/";

/** `Envelope/Body/Result` of an answer: the envelope and body are matched by local name in the SOAP namespace or in none. */
export function resultElement(response: ResponseDocument): XmlElement | undefined {
  const envelope = response.document.root;
  const inSoap = (element: XmlElement, name: string): boolean => {
    const namespace = namespaceUri(element);
    return localName(element.name) === name && (namespace === SOAP_ENVELOPE || namespace === "");
  };
  if (!inSoap(envelope, "Envelope")) return undefined;
  const body = childElements(envelope).find((child) => inSoap(child, "Body"));
  return body ? childElements(body, "Result")[0] : undefined;
}

/** `Result/Item` of an answer: the items it holds, in document order. */
export function resultItems(response: ResponseDocument): XmlElement[] {
  const result = resultElement(response);
  return result ? childElements(result, "Item") : [];
}

/** The text of the first child element called `name`, or undefined when the element has none. */
export function childText(parent: XmlElement | undefined, name: string): string | undefined {
  const child = parent ? childElements(parent, name)[0] : undefined;
  return child ? innerText(child) : undefined;
}

/** `//Result/Item/Relationships/Item`: the relationship rows of the answer's items. */
export function relationshipRows(response: ResponseDocument): XmlElement[] {
  return resultItems(response).flatMap((item) =>
    childElements(item, "Relationships").flatMap((relationships) => childElements(relationships, "Item")),
  );
}

/** Every element called `name` under `root`, in document order (`//name`). */
export function descendantsNamed(root: XmlElement, name: string): XmlElement[] {
  return [root, ...descendantElements(root)].filter((element) => element.name === name);
}

/**
 * The answer as the XML core's document, which the export's rewrites edit in place: IOM loads the answer into an `XmlDocument`
 * with `PreserveWhitespace` on, so the whitespace the server sent stays (EXP-100). It is read from the text of the answer when
 * there is one, and from the answer's outer XML otherwise.
 */
export function responseDom(response: ResponseDocument): Dom {
  return loadDom(response.sourceText ?? response.outerXml, { preserveWhitespace: true });
}
