import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { appendChild, createElement, createXmlDocument, documentElementOf, isEmpty, removeAll, removeChild, setInnerText } from "./dom.js";
import type { XmlElement, XmlNode } from "./dom.js";
import { setInnerXml } from "./dom-ops.js";
import { ArgumentException, NotSupportedException, XPathException, XmlException } from "./errors.js";
import { hasOnlyValidFileNameChars } from "./file-names.js";
import { loadXml } from "./parser.js";
import { readAllText, xmlDocumentLoad } from "./read-text.js";
import { encodeItemFile, xmlDocumentSave, xmlDocumentSaveWithSettings } from "./save.js";
import { innerXml, outerXml } from "./writer-legacy.js";
import { ITEM_FILE_SETTINGS, writeDocument } from "./writer-xmlwriter.js";
import { evaluate, selectNodes, selectSingleNode } from "./xpath.js";

const work = mkdtempSync(join(tmpdir(), "libsjs-xml-core-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const load = (text: string, preserveWhitespace = true) => loadXml(text, { preserveWhitespace });

describe("ticket 08, F1: loading does not normalise", () => {
  const doc = load('<a x="1\r\n2\r3\n4\t5" y="&#13;&#10;&#9;">t1\r\nt2\rt3\nt4<![CDATA[c1\r\nc2\rc3]]><!--m1\r\nm2--></a>');
  const root = documentElementOf(doc) as XmlElement;

  it("keeps CR, LF and tab in attribute values (R6 as corrected)", () => {
    expect(root.getAttribute("x")).toBe("1\r\n2\r3\n4\t5");
    expect(root.getAttribute("y")).toBe("\r\n\t");
  });

  it("keeps CR and CRLF in text, CDATA and comments", () => {
    const [text, cdata, comment] = Array.from(root.childNodes as unknown as { data: string }[]);
    expect(text?.data).toBe("t1\r\nt2\rt3\nt4");
    expect(cdata?.data).toBe("c1\r\nc2\rc3");
    expect(comment?.data).toBe("m1\r\nm2");
  });

  it("keeps the spaces of an attribute value", () => {
    expect((documentElementOf(load("<a x='  lead  trail  '/>")) as XmlElement).getAttribute("x")).toBe("  lead  trail  ");
  });

  it("serialises them the way .NET does (R6)", () => {
    expect(outerXml(doc)).toBe('<a x="1&#xD;&#xA;2&#xD;3&#xA;4\t5" y="&#xD;&#xA;\t">t1\r\nt2\rt3\nt4<![CDATA[c1\r\nc2\rc3]]><!--m1\r\nm2--></a>');
  });
});

describe("ticket 08, F2: references to invalid characters load, raw ones do not", () => {
  const accepted = ["<a>&#1;</a>", '<a b="&#1;"/>', "<a>&#xFFFE;</a>", "<a>&#xD800;</a>", "<!DOCTYPE a><a/>"];
  const rejected = [
    "<a>\u0001</a>",
    "<a>￿</a>",
    "<a>]]></a>",
    "<a x=1/>",
    "<a b='1'c='2'/>",
    '<a xmlns:p=""/>',
    "<a/ >",
    '<AML><?xml version="1.0"?><Item/></AML>',
    "<AML><!DOCTYPE x><Item/></AML>",
  ];
  for (const text of accepted) it(`loads ${JSON.stringify(text)}`, () => expect(() => load(text)).not.toThrow());
  for (const text of rejected) it(`rejects ${JSON.stringify(text)}`, () => expect(() => load(text)).toThrow(XmlException));

  it("fails to write a lone surrogate reference, as the item file writer does (EXP-428)", () => {
    const doc = load("<AML><a>x&#xD800;y</a></AML>");
    expect(() => writeDocument(doc, ITEM_FILE_SETTINGS)).toThrow(ArgumentException);
    expect(() => outerXml(doc)).toThrow(ArgumentException);
  });
});

describe("the DOM helpers keep .NET's IsEmpty rules (EXP-427)", () => {
  const written = (doc: ReturnType<typeof load>) => writeDocument(doc, ITEM_FILE_SETTINGS);

  it("writes <x /> for a new element and <x></x> once it has had a child", () => {
    const doc = load("<AML><Item/></AML>");
    const item = selectSingleNode("/AML/Item", doc) as XmlElement;
    const created = createElement(doc, "created");
    appendChild(item, created);
    expect(isEmpty(created)).toBe(true);
    expect(written(doc)).toBe("<AML>\r\n <Item>\r\n  <created />\r\n </Item>\r\n</AML>");
    setInnerText(created, "");
    expect(isEmpty(created)).toBe(false);
    expect(written(doc)).toBe("<AML>\r\n <Item>\r\n  <created></created>\r\n </Item>\r\n</AML>");
  });

  it("keeps the flag when the children go", () => {
    const doc = load("<AML><a>x</a><b/></AML>");
    removeAll(selectSingleNode("/AML/a", doc) as XmlElement);
    const b = selectSingleNode("/AML/b", doc) as XmlElement;
    appendChild(b, doc.createTextNode("t"));
    removeChild(b, b.firstChild as XmlNode);
    expect(written(doc)).toBe("<AML>\r\n <a></a>\r\n <b></b>\r\n</AML>");
  });

  it("reads InnerXml as .NET does: white space kept, unknown entities kept as references, an empty string changes nothing", () => {
    const doc = load("<AML><p/></AML>", false);
    const p = selectSingleNode("/AML/p", doc) as XmlElement;
    setInnerXml(p, "  <b/> a &amp; b &nbsp; ");
    expect(innerXml(p)).toBe("  <b /> a &amp; b &nbsp; ");
    setInnerXml(p, "");
    expect(innerXml(p)).toBe("");
    expect(isEmpty(p)).toBe(false);
  });
});

describe("ReadAllText", () => {
  const bom = (...bytes: number[]) => Buffer.from(bytes);

  it("matches Node for valid UTF-8, with and without a byte-order mark", () => {
    const text = "café € \u{1F600} <a/>";
    expect(readAllText(Buffer.from(text))).toBe(text);
    expect(readAllText(Buffer.concat([bom(0xef, 0xbb, 0xbf), Buffer.from(text)]))).toBe(text);
  });

  it("reads the encoding from the byte-order mark and ignores the declaration", () => {
    expect(readAllText(Buffer.concat([bom(0xff, 0xfe), Buffer.from("<a/>", "utf16le")]))).toBe("<a/>");
    expect(readAllText(Buffer.concat([bom(0xfe, 0xff), Buffer.from("<a/>", "utf16le").swap16()]))).toBe("<a/>");
    expect(readAllText(Buffer.from('<?xml version="1.0" encoding="utf-16"?><a/>'))).toBe('<?xml version="1.0" encoding="utf-16"?><a/>');
  });

  it("replaces invalid bytes with U+FFFD", () => {
    expect(readAllText(Buffer.from([0x78, 0xc3, 0x28, 0xff, 0x79]))).toBe("x�(�y");
  });
});

describe("XPath", () => {
  it("keeps the document order of a union after the document changes", () => {
    const doc = load("<r><a/><b/><c/></r>");
    const names = () => selectNodes("//c | //a | //b", doc).map((node) => node.nodeName).join("");
    expect(names()).toBe("abc");
    const root = documentElementOf(doc) as XmlElement;
    appendChild(root, createElement(doc, "d"));
    root.insertBefore(createElement(doc, "z"), root.firstChild);
    expect(selectNodes("//d | //z | //a", doc).map((node) => node.nodeName).join("")).toBe("zad");
    root.removeChild(selectSingleNode("/r/a", doc) as XmlElement);
    expect(selectNodes("//d | //z | //a | //b", doc).map((node) => node.nodeName).join("")).toBe("zbd");
    root.setAttribute("x", "1");
    expect(selectNodes("//@x | //b | /r", doc).map((node) => node.nodeName).join("")).toBe("rxb");
  });

  it("depends on xmldom bumping its mutation counter for every change that moves a node", () => {
    const doc = createXmlDocument();
    const counter = () => (doc as unknown as { _inc: number })._inc;
    const root = createElement(doc, "r");
    let before = counter();
    appendChild(doc, root);
    expect(counter()).toBeGreaterThan(before);
    before = counter();
    root.setAttribute("a", "1");
    expect(counter()).toBeGreaterThan(before);
    before = counter();
    root.removeAttribute("a");
    expect(counter()).toBeGreaterThan(before);
    const child = createElement(doc, "c");
    before = counter();
    appendChild(root, child);
    expect(counter()).toBeGreaterThan(before);
    before = counter();
    root.removeChild(child);
    expect(counter()).toBeGreaterThan(before);
  });

  it("names the failures .NET names", () => {
    const doc = load("<r/>");
    expect(() => evaluate("a[@n='O'Brien']", doc)).toThrow(new XPathException("'a[@n='O'Brien']' has an invalid token."));
    expect(() => evaluate("a[@n='x", doc)).toThrow(new XPathException("This is an unclosed string."));
    expect(() => selectNodes("count(a)", doc)).toThrow(new XPathException("Expression must evaluate to a node-set."));
  });

  it("binds the xml prefix", () => {
    const doc = load('<r><a xml:lang="de"/><a/></r>');
    expect(selectNodes("//a[@xml:lang='de']", doc)).toHaveLength(1);
  });

  it("compares the position of two nodes of a wide document in constant time", () => {
    const doc = load(`<r>${"<c/>".repeat(30000)}</r>`);
    const root = documentElementOf(doc) as XmlElement;
    const first = root.firstChild as XmlNode;
    const last = root.lastChild as XmlNode;
    expect(first.compareDocumentPosition(last) & 0x04).toBe(0x04);
    const started = Date.now();
    for (let i = 0; i < 100000; i += 1) last.compareDocumentPosition(first);
    // xmldom's own walk over 30000 siblings would take minutes
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("answers five queries over a large document in seconds, not minutes", () => {
    const items = Array.from({ length: 6000 }, (_, i) => `<Item type="Property" id="P${i}"><name>n${i}</name><data_type>string</data_type><source_id>T1</source_id></Item>`).join("");
    const doc = load(`<Envelope><Body><Result><Item type="ItemType" id="T1"><Relationships>${items}</Relationships></Item></Result></Body></Envelope>`);
    const started = Date.now();
    expect(selectNodes("//Item[@type='Property']", doc)).toHaveLength(6000);
    expect(selectNodes("//Result/Item/Relationships/Item/name", doc)).toHaveLength(6000);
    expect(selectNodes("//Item[source_id='T1']/@id", doc)).toHaveLength(6000);
    expect(selectNodes("//name | //data_type", doc)).toHaveLength(12000);
    expect(evaluate("count(//Item)", doc)).toBe(6001);
    expect(Date.now() - started).toBeLessThan(15000);
  });
});

describe("files", () => {
  it("writes an item file with a byte-order mark and reads it back", () => {
    const doc = load('<AML><Item type="a"><name>é</name></Item></AML>');
    const path = join(work, "item.xml");
    xmlDocumentSaveWithSettings(doc, path);
    const bytes = readFileSync(path);
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(bytes).toEqual(encodeItemFile(doc));
    expect(outerXml(xmlDocumentLoad(path))).toBe('<AML><Item type="a"><name>é</name></Item></AML>');
  });

  it("leaves the byte-order mark and the text before the failing node when a file cannot be written (EXP-428)", () => {
    const doc = load('<AML><Item type="a"><name>&#xD800;x</name></Item></AML>');
    const path = join(work, "partial.xml");
    expect(() => xmlDocumentSaveWithSettings(doc, path)).toThrow(ArgumentException);
    const bytes = readFileSync(path);
    expect(bytes.length).toBe(36);
    expect(bytes.subarray(3).toString("utf8")).toBe('<AML>\r\n <Item type="a">\r\n  <name>');
  });

  it("saves and re-reads a manifest byte for byte (MAN-006)", () => {
    const doc = load('<imports><package name="a" path="a\\Import"><dependson name="b"/></package></imports>', false);
    const path = join(work, "imports.mf");
    xmlDocumentSave(doc, path);
    const saved = readFileSync(path);
    const again = join(work, "again.mf");
    xmlDocumentSave(xmlDocumentLoad(path), again);
    expect(readFileSync(again)).toEqual(saved);
    expect(saved.toString("utf8")).toBe('<imports>\r\n  <package name="a" path="a\\Import">\r\n    <dependson name="b" />\r\n  </package>\r\n</imports>');
  });

  it("reads a UTF-16 file without a byte-order mark as garbage, like .NET (IMP-007)", () => {
    const path = join(work, "utf16.xml");
    writeFileSync(path, Buffer.from("<AML/>", "utf16le"));
    expect(() => xmlDocumentLoad(path)).toThrow(XmlException);
  });
});

describe("limits", () => {
  it("refuses a DOCTYPE with an internal subset or an external identifier (IMP-016)", () => {
    expect(() => load('<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>')).toThrow(NotSupportedException);
    expect(() => load('<!DOCTYPE a SYSTEM "a.dtd"><a/>')).toThrow(NotSupportedException);
    expect(() => load("<!DOCTYPE a><a/>")).not.toThrow();
  });

  it("tells valid file names from invalid ones (EXP-418)", () => {
    expect(hasOnlyValidFileNameChars("Part BOM.xml")).toBe(true);
    expect(hasOnlyValidFileNameChars(" .xml")).toBe(true);
    for (const bad of ["a/b", "a\\b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b", "a\u0000b", "a\u001fb"]) {
      expect(hasOnlyValidFileNameChars(bad)).toBe(false);
    }
  });
});
