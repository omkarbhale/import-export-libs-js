import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { XmlException } from "./errors.js";
import { decodeXmlFile, xmlDocumentLoadFile } from "./load-file.js";
import { outerXml } from "./writer-legacy.js";

/**
 * The reader of `XmlDocument.Load(path)` (MAN-003, IMP-007 `[12.0]`) against the cases of `fixtures/import-load/`, recorded on
 * the real 12.0 engine: each case is one package file, and the outcome the engine gave it (`x-…` cases).
 */
interface Case {
  name: string;
  files: Array<{ b64: string }>;
}

const FIXTURES = new URL("../../fixtures/import-load/", import.meta.url);
const cases = new Map(
  (JSON.parse(readFileSync(new URL("load-package-dom.12.0-extra.cases.json", FIXTURES), "utf8")) as Case[]).map((entry) => [
    entry.name,
    Buffer.from(entry.files[0]?.b64 ?? "", "base64"),
  ]),
);
const recorded = new Map(
  readFileSync(new URL("load-package-dom.12.0-extra.out.txt", FIXTURES), "utf8")
    .split("=== ")
    .slice(1)
    .map((section) => [section.slice(0, section.indexOf("\n")), section] as const),
);

/** What loading the case's bytes gives: the message of the exception, or the document text. */
function load(bytes: Buffer): { error?: string; xml?: string } {
  const folder = mkdtempSync(join(tmpdir(), "libsjs-load-"));
  roots.push(folder);
  const path = join(folder, "a.xml");
  writeFileSync(path, bytes);
  try {
    return { xml: outerXml(xmlDocumentLoadFile(path).documentElement as never) };
  } catch (thrown) {
    if (thrown instanceof XmlException) return { error: thrown.message };
    throw thrown;
  }
}

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("XmlDocument.Load(path), as the 12.0 engine reads a package file", () => {
  it.each([
    "x-latin1-nodecl",
    "x-utf16-decl-over-utf8",
    "x-unknown-enc-decl",
    "x-utf8-decl-latin1-bytes",
    "x-bom-only",
    "x-raw-control-char",
  ])("%s throws what the engine threw", (name) => {
    const section = recorded.get(name) ?? "";
    const expected = /^EXC: System\.Xml\.XmlException :: (.*)$/m.exec(section)?.[1];
    expect(expected, `${name} has a recorded XmlException`).toBeDefined();
    expect(load(cases.get(name) as Buffer).error).toBe(expected);
  });

  it.each(["x-utf8-valid-nodecl", "x-utf16le-bom", "x-utf16be-bom", "x-utf32le-bom", "x-utf32be-bom", "x-utf16le-nobom", "x-utf16be-nobom"])(
    "%s loads, with the id the engine read",
    (name) => {
      const id = /id="([^"]*)"/.exec(recorded.get(name) ?? "")?.[1];
      expect(id).toBeDefined();
      const loaded = load(cases.get(name) as Buffer);
      expect(loaded.error).toBeUndefined();
      expect(loaded.xml).toContain(`id="${id}"`);
    },
  );

  it("honours a windows-1252 declaration over Latin-1 bytes", () => {
    const bytes = cases.get("x-cp1252-decl") as Buffer;
    expect(decodeXmlFile(bytes)).toContain("<name>café</name>");
    expect(load(bytes).xml).toContain("café");
  });

  it("decodes Latin-1 text under an iso-8859-1 declaration and replaces non-ASCII bytes under us-ascii", () => {
    const latin1 = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><a>'), Buffer.from([0xe9, 0x80]), Buffer.from("</a>")]);
    expect(decodeXmlFile(latin1)).toBe('<?xml version="1.0" encoding="ISO-8859-1"?><a>é\u0080</a>');
    const ascii = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="us-ascii"?><a>'), Buffer.from([0xe9]), Buffer.from("</a>")]);
    expect(decodeXmlFile(ascii)).toBe('<?xml version="1.0" encoding="us-ascii"?><a>?</a>');
  });

  it("counts lines and columns of the first invalid byte", () => {
    const bytes = Buffer.concat([Buffer.from("<a>\r\n<b>x"), Buffer.from([0xff]), Buffer.from("</b></a>")]);
    expect(() => decodeXmlFile(bytes)).toThrowError(new XmlException("Invalid character in the given encoding.", 2, 5));
    // a lead byte that the end of the file cuts off is invalid too
    expect(() => decodeXmlFile(Buffer.from([0x3c, 0x61, 0x3e, 0xc3]))).toThrow("Invalid character in the given encoding. Line 1, position 4.");
  });

  it("refuses a lone surrogate in UTF-16 text", () => {
    const bytes = Buffer.from([0xff, 0xfe, 0x3c, 0x00, 0x00, 0xd8, 0x3e, 0x00]);
    expect(() => decodeXmlFile(bytes)).toThrow("Invalid character in the given encoding. Line 1, position 2.");
  });

  it("reads an empty file as no text, which the parser then refuses", () => {
    expect(decodeXmlFile(Buffer.alloc(0))).toBe("");
    expect(load(Buffer.alloc(0)).error).toBe("Root element is missing.");
  });

  it("takes utf-16 and utf-32 declarations only over Unicode bytes", () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<?xml version="1.0" encoding="utf-16"?><a/>', "utf16le")]);
    expect(decodeXmlFile(utf16)).toBe('<?xml version="1.0" encoding="utf-16"?><a/>');
    expect(() => decodeXmlFile(Buffer.from('<?xml version="1.0" encoding="UTF-32"?><a/>'))).toThrow("There is no Unicode byte order mark.");
  });
});
