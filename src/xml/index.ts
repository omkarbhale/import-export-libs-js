/**
 * The XML core: .NET Framework's `System.Xml` behaviour that the engine's output and input depend on, byte for byte.
 *
 * - load-file.ts: `XmlDocument.Load(path)`, which the 12.0 engine reads files with;
 * - dom.ts: the DOM (xmldom's) and what is recorded beside it: `IsEmpty`, `PreserveWhitespace`, the XML declaration;
 * - parser.ts: `LoadXml` and `InnerXml`, with .NET's errors and positions; read-text.ts: `File.ReadAllText`;
 * - writer-xmlwriter.ts: the `XmlWriter` of the item files, the DAC conditions and `XDocument.ToString` (xdocument.ts), and the
 *   escaping and character checks that every `XmlWriter` shares (the export transform's output writer uses them);
 * - writer-legacy.ts: `XmlTextWriter`, behind `Save(path)` (the manifest), `OuterXml` and `InnerXml`; save.ts: the files;
 * - xpath.ts and xpath-syntax.ts: `SelectNodes`, `SelectSingleNode`, `Evaluate`; html.ts: `WebUtility`; file-names.ts.
 *
 * `@xmldom/xmldom` and `xpath` are pinned to exact versions in package.json. The recorded vectors in
 * `fixtures/xml-core/vectors.json` (src/xml/vectors.test.ts) decide whether a newer version may replace them, and the
 * document order cache in xpath.ts relies on an internal counter of xmldom that xml-core.test.ts checks.
 */
export * from "./dom.js";
export { setInnerXml, getInnerXml } from "./dom-ops.js";
export * from "./errors.js";
export { hasOnlyValidFileNameChars, INVALID_FILE_NAME_CHARS } from "./file-names.js";
export { htmlDecode, htmlEncode } from "./html.js";
export { loadXml, parseFragment } from "./parser.js";
export type { LoadOptions } from "./parser.js";
export { decodeXmlFile, xmlDocumentLoadFile } from "./load-file.js";
export { readAllText, xmlDocumentLoad } from "./read-text.js";
export { encodeItemFile, xmlDocumentSave, xmlDocumentSaveWithSettings } from "./save.js";
export { xdocumentToString } from "./xdocument.js";
export { evaluate, selectNodes, selectSingleNode } from "./xpath.js";
export type { XPathValue } from "./xpath.js";
export { innerXml, outerXml, saveBytes } from "./writer-legacy.js";
export { ITEM_FILE_SETTINGS, escapeAttributeValue, escapeText, invalidCharacterMessage, normalizeLineBreaks, writeDocument, writeNodes } from "./writer-xmlwriter.js";
export type { XmlWriterSettings } from "./writer-xmlwriter.js";
