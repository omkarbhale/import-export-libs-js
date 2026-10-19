import { loadXml } from "../xml/parser.js";
import { writeDocument } from "../xml/writer-xmlwriter.js";

/**
 * 14.35's `CItemException.GetPrettyXml`: null is the empty string. Otherwise the text is loaded into a document that does
 * not preserve whitespace (so whitespace-only text nodes are dropped) and written with `Indent = true`, two spaces per level,
 * `\r\n` line ends and no XML declaration. A text that is not well-formed is the XML core's `XmlException`.
 *
 * @spec WIRE-051
 */
export function prettyXml(text: string | null): string {
  if (text === null) return "";
  return writeDocument(loadXml(text, { preserveWhitespace: false }), { indentChars: "  ", conformance: "document" });
}
