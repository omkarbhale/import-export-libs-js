import { describe, expect, it } from "vitest";
import { documentOuterXml, parseXml } from "../client/mini-xml.js";
import { patchStringsAsMicrosoftAjax } from "../browser/page-patches.js";
import { loadXml } from "./parser.js";
import { startsWithAt } from "./starts-with-at.js";
import { outerXml } from "./writer-legacy.js";

/** A document with every construct the readers find by a prefix at a position: end tags, comments, CDATA and instructions. */
const DOCUMENT =
  '<?xml version="1.0" encoding="utf-8"?>\r\n<!-- head -->\r\n<?pi before?>\r\n<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">\r\n' +
  "\t<SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>999</faultcode><faultstring><![CDATA[a </b> c]]></faultstring>" +
  "<!-- in --><?pi inside?><detail><x/></detail></SOAP-ENV:Fault></SOAP-ENV:Body>\r\n</SOAP-ENV:Envelope>";

describe("HOST-283: startsWithAt answers as String.prototype.startsWith with a position", () => {
  const cases: Array<[string, string, number]> = [
    ["a</b", "</", 1],
    ["a</b", "</", 0],
    ["a</b", "</", 3],
    ["a</b", "", 4],
    ["a</b", "", 5],
    ["a</b", "a<", -2],
    ["a</b", "</", 1.5],
    ["<!--", "<!--", 0],
    ["<!-", "<!--", 0],
    ["x<![CDATA[", "<![CDATA[", 1],
    ["", "", 0],
    ["?>", "?>", 0],
  ];
  it.each(cases)("%j at %j, %j", (text, prefix, index) => {
    expect(startsWithAt(text, prefix, index)).toBe(text.startsWith(prefix, index));
  });
});

describe("HOST-283: the XML readers read the same in a page that replaced startsWith as the Aras 12 client does", () => {
  it("the patch is the page's: a position is ignored", () => {
    const restore = patchStringsAsMicrosoftAjax();
    try {
      expect("a</b".startsWith("</", 1)).toBe(false);
      expect("a</b".startsWith("a<")).toBe(true);
    } finally {
      restore();
    }
    expect("a</b".startsWith("</", 1)).toBe(true);
  });

  it("the client's reader (mini-xml) loads a SOAP fault and writes it back as without the patch", () => {
    const expected = documentOuterXml(parseXml(DOCUMENT));
    const restore = patchStringsAsMicrosoftAjax();
    let patched: string;
    try {
      patched = documentOuterXml(parseXml(DOCUMENT));
    } finally {
      restore();
    }
    expect(patched).toBe(expected);
  });

  it("the engine's reader (XmlDocument.LoadXml) loads the same document and writes it back as without the patch", () => {
    const expected = outerXml(loadXml(DOCUMENT, { preserveWhitespace: true }));
    const restore = patchStringsAsMicrosoftAjax();
    let patched: string;
    try {
      patched = outerXml(loadXml(DOCUMENT, { preserveWhitespace: true }));
    } finally {
      restore();
    }
    expect(patched).toBe(expected);
  });
});
