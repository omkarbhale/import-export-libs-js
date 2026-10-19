import { describe, expect, it } from "vitest";
import { ArgumentException, loadXml } from "../xml/index.js";
import type { XmlElement } from "../xml/index.js";
import { OutputWriter } from "./output.js";
import { namespacesCopiedWith } from "./source.js";
import { transformExport } from "./transform.js";

function write(build: (w: OutputWriter) => void): string {
  const w = new OutputWriter();
  build(w);
  return w.finish();
}

describe("OutputWriter", () => {
  it("writes an element that received no text as <x /> and one that received empty text as <x></x> (EXP-204)", () => {
    expect(
      write((w) => {
        w.startElement("r");
        w.startElement("a");
        w.endElement();
        w.startElement("b");
        w.text("");
        w.endElement();
        w.endElement();
      }),
    ).toBe("<r><a /><b></b></r>");
  });

  it("joins adjacent text and writes the elements of cdata-section-elements as CDATA (EXP-360)", () => {
    expect(
      write((w) => {
        w.startElement("method_code");
        w.text("a]]>b");
        w.text(" <c>");
        w.endElement();
        w.startElement("html_code", "urn:d");
        w.text("plain <");
        w.endElement();
      }),
    ).toBe("<method_code><![CDATA[a]]]]><![CDATA[>b <c>]]></method_code><html_code>plain &lt;</html_code>");
  });

  it("declares the namespaces of a copy after its attributes, once, and undeclares a default namespace (EXP-205)", () => {
    const scope = new Map([
      ["p", "urn:p"],
      ["", "urn:d"],
    ]);
    expect(
      write((w) => {
        w.startElement("x", "urn:d", scope);
        w.attribute("a", "1");
        w.startElement("y", "urn:d", scope);
        w.endElement();
        w.startElement("lit");
        w.endElement();
        w.endElement();
      }),
    ).toBe('<x a="1" xmlns:p="urn:p" xmlns="urn:d"><y /><lit xmlns="" /></x>');
  });

  it("escapes text and attribute values and writes line breaks as the engine's writer does (EXP-361)", () => {
    expect(
      write((w) => {
        w.startElement("t");
        w.attribute("v", 'a&<>"\t\r\n\'');
        w.text("x & y < z > w\r\nq\rr\ns \"'");
        w.endElement();
      }),
    ).toBe('<t v="a&amp;&lt;&gt;&quot;&#x9;&#xD;&#xA;\'">x &amp; y &lt; z &gt; w\r\nq\r\nr\r\ns "\'</t>');
  });

  it("fails on a character XML cannot hold, in text, attributes and raw text (EXP-361)", () => {
    const inElement = (use: (w: OutputWriter) => void) => () =>
      write((w) => {
        w.startElement("t");
        use(w);
        w.endElement();
      });
    const text = (value: string) => inElement((w) => w.text(value));
    const raw = (value: string) => inElement((w) => w.rawText(value));
    const attribute = (value: string) => inElement((w) => w.attribute("a", value));
    expect(text("a\u0001b")).toThrow(new ArgumentException("'\u0001', hexadecimal value 0x01, is an invalid character."));
    expect(attribute("\u000b")).toThrow(ArgumentException);
    expect(raw("\ufffe")).toThrow(/0xFFFE/);
    expect(text("\ud800x")).toThrow(/\(0xD800, 0x78\)/);
  });
});

describe("namespacesCopiedWith", () => {
  it("lists the bindings outermost element first, and moves a prefix that is declared again", () => {
    const doc = loadXml('<e xmlns:q="urn:q" xmlns:r="urn:r" xmlns="urn:d"><i xmlns:q="urn:q2" xmlns=""><n xmlns:z="urn:z"/></i></e>', { preserveWhitespace: true });
    const n = doc.documentElement!.firstChild!.firstChild as XmlElement;
    expect([...namespacesCopiedWith(n)]).toEqual([
      ["r", "urn:r"],
      ["q", "urn:q2"],
      ["z", "urn:z"],
    ]);
  });
});

describe("transformExport", () => {
  const envelope = (result: string) =>
    loadXml(`<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body>${result}</SOAP-ENV:Body></SOAP-ENV:Envelope>`, { preserveWhitespace: true });

  it("writes nothing for a response that has no Result (EXP-210)", () => {
    expect(transformExport(envelope("<Fault/>"))).toBe("");
  });

  it("is built for 12.0 and 14.0.7 only until the 14.35 variant lands", () => {
    const doc = envelope("<Result><Item type='A' id='1'/></Result>");
    expect(transformExport(doc, "12.0")).toBe(transformExport(doc, "14.0.7"));
    expect(() => transformExport(doc, "14.35")).toThrow("engine 14.35 is not yet supported");
    expect(transformExport(doc, "14.0.7")).toBe('<AML><Item type="A" id="1" action="add" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" /></AML>');
  });
});

describe("OutputWriter comments", () => {
  it("writes line breaks as \\r\\n and a hyphen after a hyphen with a space between (EXP-361)", () => {
    expect(
      write((w) => {
        w.startElement("r");
        w.comment("a--b---c----d\ne&<\"");
        w.endElement();
      }),
    ).toBe('<r><!--a- -b- - -c- - - -d\r\ne&<"--></r>');
  });

  it("fails on a character XML cannot hold, and names a NUL as a full stop (EXP-361)", () => {
    expect(() => write((w) => { w.startElement("r"); w.comment("a\u0001"); w.endElement(); })).toThrow(ArgumentException);
    expect(() => write((w) => { w.startElement("r"); w.text("\u0000"); w.endElement(); })).toThrow("'.', hexadecimal value 0x00, is an invalid character.");
  });
});
