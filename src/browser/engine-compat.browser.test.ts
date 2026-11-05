import { describe, expect, it } from "vitest";
import { createBrowserHost } from "../browser.js";
import { currentCultureDateTime, invariantDateTime, processCulture } from "../export/run-log.js";
import { MemoryVfs } from "../host/memory-fs.js";
import { LanguageCodesExtractor } from "../import/language-codes-extractor.js";
import { NTFS_UPPER_RUNS } from "../import/ntfs-upper-data.js";
import { sortByTypeName } from "../import/nls-word-sort.js";
import {
  CDATA_SECTION_NODE,
  COMMENT_NODE,
  DOCUMENT_NODE,
  DOCUMENT_TYPE_NODE,
  ELEMENT_NODE,
  PROCESSING_INSTRUCTION_NODE,
  TEXT_NODE,
  attributesOf,
  entityReferenceName,
  getDeclaration,
  isEmpty,
} from "../xml/dom.js";
import type { XmlDocument, XmlElement, XmlNode } from "../xml/dom.js";
import { XmlException } from "../xml/errors.js";
import { decodeXmlFile } from "../xml/load-file.js";
import { loadXml } from "../xml/parser.js";
import { readAllText } from "../xml/read-text.js";
import { readFixtureText } from "./test-support.browser.js";

/**
 * The places where a browser could differ from Node while the unit tests that cover them read a fixture or make a temp folder
 * (so they are not in `pure-tests.json`): the legacy text encodings of an XML declaration (`TextDecoder(name)`), the byte rules
 * of the XML core, `normalize("NFD")` in the order of language codes, the engine's own sort orders, and the date formats of the
 * run log. Each runs here with the same expectations as its Node twin, over the in-memory tree and the restricted fixture
 * commands (HOST-264).
 *
 * @spec HOST-264 HOST-203 IMP-004 IMP-007 IMP-030 IMP-615 EXP-505
 */

const bytesOfHex = (hex: string): Uint8Array => Uint8Array.from(hex.replace(/ /g, "").match(/../g) ?? [], (pair) => parseInt(pair, 16));

describe("HOST-264: the XML core's byte rules, on the recorded .NET vectors (xml/vectors.test.ts, kind read-bytes)", () => {
  interface Vector {
    id: string;
    kind: string;
    hex?: string;
    expect: { text: string; load: { dump?: string; error?: { type: string; message: string } } };
  }

  /** The same rendering of a loaded tree as `dump` in xml/vectors.test.ts, which is what the recorded vectors hold. */
  const dump = (doc: XmlDocument): string => {
    let out = "";
    const declaration = getDeclaration(doc);
    if (declaration) out += `X(${declaration.version}|${declaration.encoding}|${declaration.standalone})`;
    const visit = (node: XmlNode): void => {
      switch (node.nodeType) {
        case DOCUMENT_NODE:
          for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
          break;
        case DOCUMENT_TYPE_NODE:
          out += `D(${(node as unknown as { name: string }).name}|||)`;
          break;
        case ELEMENT_NODE: {
          const element = node as XmlElement;
          out += `E(${element.tagName}|${element.namespaceURI ?? ""}|${isEmpty(element) ? "1" : "0"}`;
          for (const attribute of attributesOf(element)) out += `|${attribute.name}=${attribute.namespaceURI ?? ""}=${attribute.value}`;
          out += "){";
          for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
          out += "}";
          break;
        }
        case TEXT_NODE:
          out += entityReferenceName(node) !== undefined ? `R(${entityReferenceName(node)})` : `T(${(node as unknown as { data: string }).data})`;
          break;
        case CDATA_SECTION_NODE:
          out += `C(${(node as unknown as { data: string }).data})`;
          break;
        case COMMENT_NODE:
          out += `M(${(node as unknown as { data: string }).data})`;
          break;
        case PROCESSING_INSTRUCTION_NODE: {
          const pi = node as unknown as { target: string; data: string };
          const declared = pi.target === "xml" ? /^version="([^"]*)"(?: encoding="([^"]*)")?(?: standalone="([^"]*)")?$/.exec(pi.data) : null;
          out += declared ? `X(${declared[1]}|${declared[2] ?? ""}|${declared[3] ?? ""})` : `P(${pi.target}|${pi.data})`;
          break;
        }
        default:
          out += `?(${node.nodeType})`;
      }
    };
    visit(doc);
    return out;
  };

  it("decodes every recorded byte sequence to the text .NET gave, and loads it or fails as .NET did", async () => {
    const { vectors } = JSON.parse(await readFixtureText("fixtures/xml-core/vectors.json")) as { vectors: Vector[] };
    // the port refuses a DOCTYPE with an internal subset (IMP-016); xml/vectors.test.ts skips this vector for the same reason
    const cases = vectors.filter((vector) => vector.kind === "read-bytes" && vector.id !== "3.doctype-internal");
    expect(cases.length).toBeGreaterThanOrEqual(60);
    for (const vector of cases) {
      const decoded = readAllText(bytesOfHex(vector.hex ?? ""));
      expect(decoded, vector.id).toBe(vector.expect.text);
      const expected = vector.expect.load;
      let failure: Error | undefined;
      let loaded: XmlDocument | undefined;
      try {
        loaded = loadXml(decoded, { preserveWhitespace: false });
      } catch (error) {
        failure = error as Error;
      }
      if (expected.error) {
        expect(failure, vector.id).toBeInstanceOf(XmlException);
        expect(failure?.message, vector.id).toBe(expected.error.message);
      } else {
        expect(failure, vector.id).toBeUndefined();
        expect(dump(loaded as XmlDocument), vector.id).toBe(expected.dump);
      }
    }
  });
});

describe("HOST-264: the encodings an XML declaration names, through the browser's TextDecoder (xml/load-file.ts, decodeNamed)", () => {
  /** [label in the declaration, the bytes of the content as hex, the text .NET and Node's ICU give]; the decoders are the WHATWG ones. */
  const NAMED: [string, string, string][] = [
    ["Shift_JIS", "82a0 93fa967b", "あ日本"],
    ["windows-1252", "80 93 94 e9 9f", "€“”éŸ"],
    ["iso-8859-2", "a1 e8 b3", "Ąčł"],
    ["iso-8859-15", "a4 a6 bd", "€Šœ"],
    ["gbk", "d6d0 cec4", "中文"],
    ["GB2312", "d6d0 cec4", "中文"],
    ["EUC-KR", "c7d1 b1db", "한글"],
    ["euc-jp", "c6fc cbdc", "日本"],
    ["big5", "a4a4 a4e5", "中文"],
    ["koi8-r", "f0d2c9d7c5d4", "Привет"],
    ["windows-1251", "cff0e8e2e5f2", "Привет"],
    ["windows-1250", "8a 9d e8", "Šťč"],
    ["iso-8859-5", "bfe0d8d2d5e2", "Привет"],
    ["iso-8859-7", "c1 e2 e3", "Αβγ"],
    ["macintosh", "8e 80", "éÄ"],
    ["windows-1253", "c1 e2 80", "Αβ€"],
    ["iso-8859-9", "d0 fd", "Ğı"],
    ["windows-874", "a1 e0", "กเ"],
    ["ISO-2022-JP", "1b2442246c1b2842", "れ"],
  ];

  const file = (name: string, hex: string): Uint8Array => {
    const head = new TextEncoder().encode(`<?xml version="1.0" encoding="${name}"?><a>`);
    const body = bytesOfHex(hex);
    const tail = new TextEncoder().encode("</a>");
    return Uint8Array.from([...head, ...body, ...tail]);
  };

  it.each(NAMED)("decodes content under encoding=%s", (name, hex, expected) => {
    const text = decodeXmlFile(file(name, hex));
    expect(text.slice(text.indexOf("<a>") + 3, text.indexOf("</a>"))).toBe(expected);
  });

  it("raises the engine's own failure for an encoding it does not know", () => {
    let failure: Error | undefined;
    try {
      decodeXmlFile(file("x-no-such-encoding", "41"));
    } catch (error) {
      failure = error as Error;
    }
    expect(failure).toBeInstanceOf(XmlException);
    expect(failure?.message).toContain("System does not support 'x-no-such-encoding' encoding.");
  });
});

describe("HOST-264: the order of language codes, which normalizes to NFD (import/language-codes-extractor.ts, IMP-615)", () => {
  const aml = (languages: string): string =>
    `<AML><Item type="Foo" id="A1" action="add">${languages
      .split(",")
      .map((lang) => `<i18n:label xmlns:i18n="http://www.aras.com/I18N" xml:lang="${lang}">v</i18n:label>`)
      .join("")}</Item></AML>`;

  it("orders the codes of the probes as the engine's culture does, over the in-memory tree", () => {
    const fs = new MemoryVfs();
    fs.mkdir("/pkg");
    fs.mkdir("/pkg/P");
    fs.mkdir("/pkg/R");
    fs.writeFile("/pkg/P/a.xml", new TextEncoder().encode(aml("b,a,B,A,zh-cn,zhcn,zh-tw,zh,de-ch,de,dex,en,en-us,é,e,f,ä,a-b,ab,a_b,Z,z,10,2,1")));
    fs.writeFile("/pkg/R/a.xml", new TextEncoder().encode(aml("pt-br,pt,zh-tw,zh-cn,en-us,en,de-ch,dea,de,fr-ca,fr,es,es-mx,sv,sv-fi,da,nl,nl-be")));
    const environment = { fs, host: createBrowserHost({ fs }).env };
    const extractor = new LanguageCodesExtractor(environment);
    extractor.extractLanguageCodesFromPackages([
      { name: "P", folderPath: "/pkg/P" },
      { name: "R", folderPath: "/pkg/R" },
    ]);
    expect(extractor.getUsedLanguagesByPackages(["P"])).toEqual([
      "1", "10", "2", "a", "ä", "a_b", "ab", "a-b", "b", "de", "de-ch", "dex", "e", "é", "en", "en-us", "f", "z", "zh", "zhcn", "zh-cn", "zh-tw",
    ]);
    expect(extractor.getUsedLanguagesByPackages(["R"])).toEqual([
      "da", "de", "dea", "de-ch", "en", "en-us", "es", "es-mx", "fr", "fr-ca", "nl", "nl-be", "pt", "pt-br", "sv", "sv-fi", "zh-cn", "zh-tw",
    ]);
  });
});

describe("HOST-264: the engine's own sort orders and tables (import/ordering.test.ts, IMP-004, IMP-030)", () => {
  it("orders the recorded type names as .NET's NLS word sort did", async () => {
    const { vectors } = JSON.parse(await readFixtureText("fixtures/import-load/nls-word-sort.json")) as { vectors: { types: string[]; order: number[] }[] };
    expect(vectors.length).toBeGreaterThan(0);
    vectors.forEach((vector, index) => {
      const indexed = vector.types.map((type, at) => ({ type, at }));
      expect(sortByTypeName(indexed, (entry) => entry.type).map((entry) => entry.at), `vector ${index + 1}`).toEqual(vector.order);
    });
  });

  it("expands the embedded upper-case runs to the recorded ToUpperInvariant table, unit for unit", async () => {
    const { pairs } = JSON.parse(await readFixtureText("fixtures/import-load/invariant-upper.json")) as { pairs: [string, string][] };
    const recorded = new Map(pairs.map(([from, to]) => [parseInt(from, 16), parseInt(to, 16)]));
    const embedded = new Map<number, number>();
    for (const [first, last, stride, delta] of NTFS_UPPER_RUNS) {
      for (let at = first; at <= last; at += stride) embedded.set(at, at + delta);
    }
    expect([...embedded].sort((a, b) => a[0] - b[0])).toEqual([...recorded].sort((a, b) => a[0] - b[0]));
  });
});

describe("HOST-264: the run log's date formats, which are the library's own and do not follow the browser's Intl", () => {
  const date = new Date(2024, 0, 5, 15, 4, 9);

  it("writes the invariant format and the probed general patterns from the local fields of the date", () => {
    expect(invariantDateTime(date)).toBe("01/05/2024 15:04:09");
    expect(currentCultureDateTime(date, "en-US")).toBe("1/5/2024 3:04:09 PM");
    expect(currentCultureDateTime(date, "en-GB")).toBe("05/01/2024 15:04:09");
    expect(currentCultureDateTime(date, "fr-FR")).toBe("05/01/2024 15:04:09");
    expect(currentCultureDateTime(date, "en-IN")).toBe("05-01-2024 15:04:09");
    expect(currentCultureDateTime(date, "de_de")).toBe("05.01.2024 15:04:09");
    expect(currentCultureDateTime(date, "ja-JP")).toBe("01/05/2024 15:04:09");
  });

  it("takes the process culture from the browser's Intl locale, a well-formed language tag whatever the browser's setting", () => {
    const culture = processCulture(createBrowserHost({ fs: new MemoryVfs() }).env);
    expect(culture).toMatch(/^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/);
    expect(currentCultureDateTime(date, culture)).toMatch(/^\d{1,2}[/.-]\d{1,2}[/.-]2024 \d{1,2}:04:09( [AP]M)?$/);
  });
});
