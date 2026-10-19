import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AggregateException } from "../export/parallel-for-each.js";
import { DirectoryNotFoundException, IOException } from "../io/errors.js";
import { XmlException } from "../xml/errors.js";
import { LanguageCodesExtractor } from "./language-codes-extractor.js";

/**
 * The scan of the packages (IMP-610 to IMP-615), against the cases of `fixtures/import-languages/14.35/probes/01-extractor.out`: the
 * real 14.35 `LanguageCodesExtractor` run on the same package folders. Each test builds the folders of a probe case in a temp folder
 * and checks what the probe printed for it.
 */

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** The folders of one case, written from a map of relative path to file text. */
function writeCase(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "libsjs-langscan-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

const aml = (items: string): string => `<AML>${items}</AML>`;
const item = (langs: string): string =>
  `<Item type="Foo" id="A1" action="add">${langs
    .split(",")
    .filter((lang) => lang !== "")
    .map((lang) => `<i18n:label xmlns:i18n="http://www.aras.com/I18N" xml:lang="${lang}">v</i18n:label>`)
    .join("")}</Item>`;

function scan(packages: readonly [string, string][]): LanguageCodesExtractor {
  const extractor = new LanguageCodesExtractor();
  extractor.extractLanguageCodesFromPackages(packages.map(([name, folderPath]) => ({ name, folderPath })));
  return extractor;
}

const sorted = (codes: readonly string[]): string[] => [...codes].sort();

describe("the scan of a package (IMP-611)", () => {
  it("reads every *.xml file at every depth, the folder's own files included (basic-all-depths)", () => {
    const root = writeCase({
      "P/Import/Foo/a.xml": aml(item("de,fr")),
      "P/Import/Foo/sub/deep/b.xml": aml(item("de,es")),
      "P/Import/Bar/c.xml": aml(item("en")),
      "P/Import/top.xml": aml(item("it")),
    });
    expect(sorted(scan([["P", join(root, "P/Import")]]).getUsedLanguagesByPackage("P"))).toEqual(["de", "en", "es", "fr", "it"]);
  });

  it("matches the file names as the engine's pattern does (file-name-patterns)", () => {
    const root = writeCase({
      "P/a.xml": aml(item("aa")),
      "P/b.XML": aml(item("bb")),
      "P/c.xmlbak": aml(item("cc")),
      "P/d.txt": aml(item("dd")),
      "P/e.xml.txt": aml(item("ee")),
      "P/sub/f.xml": aml(item("ff")),
      "P/g.Xml": aml(item("gg")),
    });
    expect(sorted(scan([["P", join(root, "P")]]).getUsedLanguagesByPackage("P"))).toEqual(["aa", "bb", "cc", "ff", "gg"]);
  });

  it("selects the xml:lang of a direct child of an Item and nothing else (selection-rules)", () => {
    const root = writeCase({
      "P/Import/a.xml":
        '<AML><Item type="Foo" id="A" xml:lang="itemattr"><name xml:lang="child">x</name><Relationships><Item type="Rel" id="R" xml:lang="relattr"><label xml:lang="relchild">y</label></Item></Relationships></Item></AML>',
      "P/Import/b.xml": '<root><sub><Item type="Foo"><p xml:lang="deepitem"/></Item></sub></root>',
      "P/Import/c.xml": '<AML><Item type="Foo"><p><q xml:lang="grandchild"/></p></Item></AML>',
      "P/Import/d.xml": '<AML><Item type="Foo"><p lang="plainlang"/><p xml:space="preserve"/></Item></AML>',
      "P/Import/e.xml": '<AML><item type="Foo"><p xml:lang="lowercaseitem"/></item></AML>',
      "P/Import/f.xml": '<AML><Item type="Foo"><p xml:lang=""/></Item></AML>',
      "P/Import/g.xml": '<AML xmlns="urn:x"><Item type="Foo"><p xml:lang="innamespace"/></Item></AML>',
    });
    expect(sorted(scan([["P", join(root, "P/Import")]]).getUsedLanguagesByPackage("P"))).toEqual(["", "child", "deepitem", "relchild"]);
  });

  it("reads a file with a byte order mark, a declaration and a DOCTYPE (bom-and-declaration, doctype-in-file)", () => {
    const root = writeCase({
      "P/a.xml": "﻿" + '<?xml version="1.0" encoding="utf-8"?><AML><Item><p xml:lang="de"/></Item></AML>',
      // the probe's DOCTYPE had an internal subset, which the port's parser refuses (IMP-016)
      "Q/a.xml": '<!DOCTYPE AML><AML><Item><p xml:lang="fr"/></Item></AML>',
    });
    const extractor = scan([
      ["P", join(root, "P")],
      ["Q", join(root, "Q")],
    ]);
    expect(extractor.getUsedLanguagesByPackage("P")).toEqual(["de"]);
    expect(extractor.getUsedLanguagesByPackage("Q")).toEqual(["fr"]);
  });

  it("gives a package with no xml:lang an empty list (package-without-xml)", () => {
    const root = writeCase({ "P/readme.txt": "x" });
    expect(scan([["P", join(root, "P")]]).getUsedLanguagesByPackage("P")).toEqual([]);
  });
});

describe("the used codes (IMP-614)", () => {
  it("lower-cases each value and merges the spellings (case-lowered-and-merged)", () => {
    const root = writeCase({
      "P/a.xml": aml(item("DE,De,de")),
      "P/b.xml": aml(item("ZH-CN,zh-cn")),
      "P/c.xml": aml(item("İ") + item("ΑΣ")),
    });
    expect(sorted(scan([["P", join(root, "P")]]).getUsedLanguagesByPackage("P"))).toEqual(["de", "zh-cn", "İ", "ασ"]);
  });
});

describe("the cache (IMP-613)", () => {
  it("keeps a list for each package and answers an empty one for a name it does not know (two-packages)", () => {
    const root = writeCase({
      "P1/a.xml": aml(item("de,fr")),
      "P2/a.xml": aml(item("es,de")),
      "P3/empty.txt": "x",
    });
    const extractor = scan([
      ["P1", join(root, "P1")],
      ["P2", join(root, "P2")],
      ["P3", join(root, "P3")],
    ]);
    expect(sorted(extractor.getUsedLanguagesByPackage("P1"))).toEqual(["de", "fr"]);
    expect(sorted(extractor.getUsedLanguagesByPackage("P2"))).toEqual(["de", "es"]);
    expect(extractor.getUsedLanguagesByPackage("P3")).toEqual([]);
    expect(extractor.getUsedLanguagesByPackage("Unknown")).toEqual([]);
  });

  it("keeps the first of two packages of one name and still scans the second (same-package-name-twice-first-wins)", () => {
    const root = writeCase({ "A/a.xml": aml(item("de")), "B/a.xml": aml(item("fr")) });
    const extractor = scan([
      ["P", join(root, "A")],
      ["P", join(root, "B")],
    ]);
    expect(extractor.getUsedLanguagesByPackage("P")).toEqual(["de"]);
    const bad = writeCase({ "A/a.xml": aml(item("de")), "B/a.xml": "<AML><Item>" });
    expect(() =>
      scan([
        ["P", join(bad, "A")],
        ["P", join(bad, "B")],
      ]),
    ).toThrow(AggregateException);
  });

  it("is replaced by the next scan (re-extract-clears-the-cache)", () => {
    const root = writeCase({ "A/a.xml": aml(item("de")), "B/a.xml": aml(item("fr")) });
    const extractor = new LanguageCodesExtractor();
    extractor.extractLanguageCodesFromPackages([{ name: "A", folderPath: join(root, "A") }]);
    expect(extractor.getUsedLanguagesByPackage("A")).toEqual(["de"]);
    extractor.extractLanguageCodesFromPackages([{ name: "B", folderPath: join(root, "B") }]);
    expect(extractor.getUsedLanguagesByPackage("A")).toEqual([]);
    expect(extractor.getUsedLanguagesByPackage("B")).toEqual(["fr"]);
    extractor.extractLanguageCodesFromPackages([]);
    expect(extractor.getUsedLanguagesByPackage("B")).toEqual([]);
  });

  it("takes the packages one at a time, so one that cannot be built stops the scan with the earlier ones kept", () => {
    const root = writeCase({ "A/a.xml": aml(item("de")) });
    const extractor = new LanguageCodesExtractor();
    function* packages(): Iterable<{ name: string; folderPath: string }> {
      yield { name: "A", folderPath: join(root, "A") };
      throw new Error("no path for B");
    }
    expect(() => extractor.extractLanguageCodesFromPackages(packages())).toThrow("no path for B");
    expect(extractor.getUsedLanguagesByPackage("A")).toEqual(["de"]);
  });
});

describe("GetUsedLanguagesByPackages (IMP-615)", () => {
  const root = writeCase({ "P1/a.xml": aml(item("de,fr")), "P2/a.xml": aml(item("es,de")), "P3/empty.txt": "x" });
  const extractor = scan([
    ["P1", join(root, "P1")],
    ["P2", join(root, "P2")],
    ["P3", join(root, "P3")],
  ]);

  it("is the union without duplicates, sorted", () => {
    expect(extractor.getUsedLanguagesByPackages(["P1", "P2", "P3"])).toEqual(["de", "es", "fr"]);
    expect(extractor.getUsedLanguagesByPackages(["P2", "P1", "P2"])).toEqual(["de", "es", "fr"]);
  });

  it("gives nothing for no names, and nothing for a name that is not in the cache", () => {
    expect(extractor.getUsedLanguagesByPackages([])).toEqual([]);
    expect(extractor.getUsedLanguagesByPackages(["Unknown"])).toEqual([]);
  });

  it("orders the codes as the host's culture does (sort-order, sort-order-realistic)", () => {
    const sortRoot = writeCase({
      "P/a.xml": aml(item("b,a,B,A,zh-cn,zhcn,zh-tw,zh,de-ch,de,dex,en,en-us,é,e,f,ä,a-b,ab,a_b,Z,z,10,2,1")),
      "R/a.xml": aml(item("pt-br,pt,zh-tw,zh-cn,en-us,en,de-ch,dea,de,fr-ca,fr,es,es-mx,sv,sv-fi,da,nl,nl-be")),
    });
    const sorts = scan([
      ["P", join(sortRoot, "P")],
      ["R", join(sortRoot, "R")],
    ]);
    expect(sorts.getUsedLanguagesByPackages(["P"])).toEqual([
      "1", "10", "2", "a", "ä", "a_b", "ab", "a-b", "b", "de", "de-ch", "dex", "e", "é", "en", "en-us", "f", "z", "zh", "zhcn", "zh-cn", "zh-tw",
    ]);
    expect(sorts.getUsedLanguagesByPackages(["R"])).toEqual([
      "da", "de", "dea", "de-ch", "en", "en-us", "es", "es-mx", "fr", "fr-ca", "nl", "nl-be", "pt", "pt-br", "sv", "sv-fi", "zh-cn", "zh-tw",
    ]);
  });
});

describe("failures of the scan (IMP-612)", () => {
  it("wraps a file that does not parse in an AggregateException and keeps the packages before it (malformed-file-in-second-package)", () => {
    const root = writeCase({ "P/good.xml": aml(item("de")), "Q/bad.xml": "<AML><Item>" });
    const extractor = new LanguageCodesExtractor();
    let failure: unknown;
    try {
      extractor.extractLanguageCodesFromPackages([
        { name: "P", folderPath: join(root, "P") },
        { name: "Q", folderPath: join(root, "Q") },
      ]);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateException);
    const inner = (failure as AggregateException).innerExceptions;
    expect(inner).toHaveLength(1);
    expect(inner[0]).toBeInstanceOf(XmlException);
    expect((failure as AggregateException).message).toBe("One or more errors occurred.");
    expect((inner[0] as Error).message).toBe("Unexpected end of file has occurred. The following elements are not closed: Item, AML. Line 1, position 12.");
    expect(extractor.getUsedLanguagesByPackage("P")).toEqual(["de"]);
    expect(extractor.getUsedLanguagesByPackage("Q")).toEqual([]);
  });

  it("gathers the failures of every file that fails (three-malformed-files)", () => {
    const root = writeCase({
      "P/good.xml": aml(item("de")),
      "P/bad1.xml": "<AML><Item>",
      "P/bad2.xml": "",
      "P/bad3.xml": "<a/><b/>",
    });
    let failure: unknown;
    try {
      scan([["P", join(root, "P")]]);
    } catch (error) {
      failure = error;
    }
    const messages = (failure as AggregateException).innerExceptions.map((error) => (error as Error).message).sort();
    expect(messages).toEqual([
      "Root element is missing.",
      "There are multiple root elements. Line 1, position 6.",
      "Unexpected end of file has occurred. The following elements are not closed: Item, AML. Line 1, position 12.",
    ]);
  });

  it("fails a file that is not XML wherever it is, whatever the languages option (bad-file-no-languages-option)", () => {
    const root = writeCase({ "P/sub/readme.xml": "not xml" });
    expect(() => scan([["P", join(root, "P")]])).toThrow(AggregateException);
  });

  it("does not wrap a missing folder, nor a folder that is a file (missing-folder, folder-is-a-file)", () => {
    const root = writeCase({ "P/readme.txt": "x" });
    expect(() => scan([["M", join(root, "Missing")]])).toThrow(DirectoryNotFoundException);
    expect(() => scan([["F", join(root, "P/readme.txt")]])).toThrow(IOException);
  });
});
