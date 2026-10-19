import { ELEMENT_NODE, childrenOf, removeChild } from "./dom.js";
import { loadXml } from "./parser.js";
import { writeDocument } from "./writer-xmlwriter.js";

/**
 * `XDocument.Parse(text).ToString()` and its `SaveOptions.DisableFormatting` form, which the engine uses to re-indent an
 * `implementation_query` (EXP-121). The text is read as an `XmlReader` reads: all insignificant white space is dropped,
 * line ends and attribute white space are normalised, and a reference to a character XML does not allow is an error. The
 * result is written with two spaces per level, an XML declaration is never written, and an element written
 * `<x></x>` in the text stays that way.
 *
 * @spec EXP-121
 */
export function xdocumentToString(text: string, options: { disableFormatting?: boolean } = {}): string {
  const doc = loadXml(text, { preserveWhitespace: false, xmlReader: true });
  return writeDocument(doc, { indentChars: options.disableFormatting ? null : "  ", conformance: "document" });
}

/**
 * `XElement.Parse(text).ToString()`, which the DB patch run uses to format the requests and responses it sends to the host
 * (DBP-004). It reads and writes as {@link xdocumentToString} does: all insignificant white space is dropped, two spaces per level,
 * no XML declaration, `<x />` for an element written `<x/>` and `<x></x>` for one written that way. `XElement` takes the root
 * element alone, so a comment, a processing instruction or a DOCTYPE around it is not written.
 *
 * @spec DBP-004
 */
export function xelementParseToString(text: string): string {
  const doc = loadXml(text, { preserveWhitespace: false, xmlReader: true });
  for (const node of childrenOf(doc)) {
    if (node.nodeType !== ELEMENT_NODE) removeChild(doc, node);
  }
  return writeDocument(doc, { indentChars: "  ", conformance: "document" });
}
