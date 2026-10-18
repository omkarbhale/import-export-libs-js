import { describe, expect, it } from "vitest";
import { XmlParseError, documentOuterXml, innerText, namespaceUri, outerXml, parseXml } from "./mini-xml.js";

const roundTrip = (xml: string) => documentOuterXml(parseXml(xml));

describe("mini-xml serialisation follows .NET's OuterXml", () => {
  it("writes attributes double-quoted and an empty element with a space", () => {
    expect(roundTrip("<a x='1' y=\"2\"><b/><c></c></a>")).toBe('<a x="1" y="2"><b /><c></c></a>');
  });

  it("escapes & < > in text and & < > \" in attributes, and keeps ' raw", () => {
    expect(roundTrip("<a q=\"&quot;'\">&lt;&gt;&amp; \" '</a>")).toBe('<a q="&quot;\'">&lt;&gt;&amp; " \'</a>');
  });

  it("loads nothing normalised: CR, LF and tab stay, and attribute LF and CR are written as references", () => {
    const xml = '<a x="1\r\n2\t3&#13;">t1\r\nt2\rt3\nt4<![CDATA[c1\r\nc2]]><!--m1\r\nm2--></a>';
    expect(roundTrip(xml)).toBe('<a x="1&#xD;&#xA;2\t3&#xD;">t1\r\nt2\rt3\nt4<![CDATA[c1\r\nc2]]><!--m1\r\nm2--></a>');
    expect(innerText(parseXml(xml).root)).toBe("t1\r\nt2\rt3\nt4c1\r\nc2");
  });

  it("loads references to any character", () => {
    expect(innerText(parseXml("<a>&#1;&#x10FFFF;&apos;</a>").root)).toBe("\u0001\u{10ffff}'");
  });

  it("keeps whitespace before the root of a document but not of an element", () => {
    const doc = parseXml("\r\n\t<AML>\r\n\t<Item/>\r\n</AML>");
    expect(documentOuterXml(doc)).toBe("\r\n\t<AML>\r\n\t<Item />\r\n</AML>");
    expect(outerXml(doc.root)).toBe("<AML>\r\n\t<Item />\r\n</AML>");
  });

  it("keeps the declaration, comments and processing instructions", () => {
    expect(roundTrip("<?xml version='1.0'?><!--c--><?pi data?><a/>")).toBe("<?xml version='1.0'?><!--c--><?pi data?><a />");
  });

  it("resolves namespaces through the ancestors", () => {
    const a = parseXml('<e:Envelope xmlns:e="urn:soap"><Body xmlns="urn:b"><x:i xmlns:x="urn:x"/></Body></e:Envelope>').root;
    expect(namespaceUri(a)).toBe("urn:soap");
    const body = a.children[0];
    expect(body?.kind === "element" && namespaceUri(body)).toBe("urn:b");
    expect(parseXml("<a/>").root).toMatchObject({ name: "a" });
    expect(namespaceUri(parseXml("<a/>").root)).toBe("");
  });
});

/** Messages recorded from .NET Framework 4.8's `XmlDocument.LoadXml` on the captain's Windows. */
describe("mini-xml reports what .NET's XmlException reports", () => {
  it.each([
    ["", "Root element is missing."],
    ["Internal Server Error", "Data at the root level is invalid. Line 1, position 1."],
    ["<a><b>", "Unexpected end of file has occurred. The following elements are not closed: b, a. Line 1, position 7."],
    ["<a>\n<b></a>", "The 'b' start tag on line 2 position 2 does not match the end tag of 'a'. Line 2, position 6."],
    ["<a>&x;</a>", "Reference to undeclared entity 'x'. Line 1, position 5."],
    ['<a b="1" b="2"/>', "'b' is a duplicate attribute name. Line 1, position 10."],
    ["<a/><b/>", "There are multiple root elements. Line 1, position 6."],
    ["<a b=1/>", `'1' is an unexpected token. The expected token is '"' or '''. Line 1, position 6.`],
    ['<a b="1', "There is an unclosed literal string. Line 1, position 8."],
    ["<a><!-- x", "Unexpected end of file while parsing Comment has occurred. Line 1, position 8."],
    ["<a>&amp</a>", "An error occurred while parsing EntityName. Line 1, position 5."],
    ["<a>x</a>trailing", "Data at the root level is invalid. Line 1, position 9."],
    ['<a b="<"/>', "'<', hexadecimal value 0x3C, is an invalid attribute character. Line 1, position 7."],
    ["<1a/>", "Name cannot begin with the '1' character, hexadecimal value 0x31. Line 1, position 2."],
  ])("%j", (xml, message) => {
    expect(() => parseXml(xml)).toThrow(XmlParseError);
    expect(() => parseXml(xml)).toThrow(message);
  });
});
