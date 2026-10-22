import { describe, expect, it } from "vitest";
import { applyExportTransform, decodeXmlFile, encodeItemFile, loadXml, readAllText } from "./index.js";
import type { LoadOptions, XmlDocument } from "./index.js";

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const LOAD: LoadOptions = { preserveWhitespace: false };

/** What the engine writes for an item file: a byte-order mark, one space per level, CRLF, `<x />` for an empty element, no final newline. */
const ITEM_FILE = Buffer.concat([
  BOM,
  Buffer.from('<AML>\r\n <Item type="List" id="A1" action="add">\r\n  <name>Colors &amp; Shades</name>\r\n  <label />\r\n </Item>\r\n</AML>', "utf8"),
]);

describe("package entry point: the XML loader and the item-file writer", () => {
  it("round-trips a file the engine wrote, byte for byte", () => {
    const doc: XmlDocument = loadXml(readAllText(ITEM_FILE), LOAD);
    expect(encodeItemFile(doc).equals(ITEM_FILE)).toBe(true);
    expect(loadXml(decodeXmlFile(ITEM_FILE), LOAD).documentElement?.nodeName).toBe("AML");
  });

  it("tells a hand-edited file apart", () => {
    const edited = Buffer.concat([BOM, Buffer.from('<AML><Item type="List" id="A1" action="add"><name>Colors &amp; Shades</name><label></label></Item></AML>', "utf8")]);
    const rewritten = encodeItemFile(loadXml(readAllText(edited), LOAD));
    expect(rewritten.equals(edited)).toBe(false);
  });

  it("loads a document the export transform accepts", () => {
    const doc = loadXml('<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><Result><Item type="List" id="A1"><name>x</name></Item></Result></SOAP-ENV:Body></SOAP-ENV:Envelope>', LOAD);
    expect(applyExportTransform(doc)).toContain('type="List"');
  });
});
