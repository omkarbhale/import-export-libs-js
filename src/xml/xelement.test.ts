import { describe, expect, it } from "vitest";
import { XmlException } from "./errors.js";
import { xelementParseToString } from "./xdocument.js";

/** `XElement.Parse(text).ToString()`, which the DB patch run formats its requests and responses with (DBP-004). */
describe("xelementParseToString", () => {
  it("indents with two spaces and CRLF, drops the white space between elements and writes no declaration", () => {
    expect(xelementParseToString('<?xml version="1.0"?>\n<Item a="1">\n  <name>x</name>\n  <Data/>\n</Item>')).toBe(
      '<Item a="1">\r\n  <name>x</name>\r\n  <Data />\r\n</Item>',
    );
  });

  it("keeps an element written <x></x> as it was, and a CDATA section", () => {
    expect(xelementParseToString("<a><b></b><c><![CDATA[return this;]]></c></a>")).toBe("<a>\r\n  <b></b>\r\n  <c><![CDATA[return this;]]></c>\r\n</a>");
  });

  it("writes the root element only: a comment or processing instruction around it is not part of an XElement", () => {
    expect(xelementParseToString("<!--before--><?pi x?><a/><!--after-->")).toBe("<a />");
  });

  it("does not indent the text of a mixed-content element", () => {
    expect(xelementParseToString("<a>text<b/>more</a>")).toBe("<a>text<b />more</a>");
  });

  it("fails on a text that is not well-formed with the XML core's exception", () => {
    expect(() => xelementParseToString("<a><b></a>")).toThrow(XmlException);
    expect(() => xelementParseToString("")).toThrow(XmlException);
  });
});
