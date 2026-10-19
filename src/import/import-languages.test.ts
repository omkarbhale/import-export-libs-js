import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { StubConnection, stubFault, stubResult } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import type { Engine } from "../engines.js";
import { SolutionUpgradeContext } from "../export/export-context.js";
import { ImportExportManager } from "../export/import-export-manager.js";
import { type LangScript, langResponse } from "../export/language-probe.js";
import { createMessagesFactory } from "../export/messages.js";
import { AggregateException } from "../export/parallel-for-each.js";
import { exceptionText } from "../language-pack/exception-text.js";
import { loadXml } from "../xml/parser.js";
import { XPathException } from "../xml/errors.js";
import { outerXml } from "../xml/writer-legacy.js";
import { languagesToSkip, removeSkippedLanguageNodes } from "./skipped-languages.js";

/**
 * The constructor's language work for an import (IMP-610 to IMP-623) and the deletion of the skipped nodes (IMP-630 to IMP-635),
 * against the cases of `fixtures/import-languages/14.35/probes/02-manager-ctor.out` and `03-import-skip.out`: the real 14.35 manager
 * over a stub connection that records what IOM hands it. The recorded import runs are `import-run.replay.test.ts`.
 */

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const LANGUAGE_GET = '<Item isNew="1" isTemp="1" type="Language" action="get" select="code,name" />';
const aml = (langs: string): string =>
  `<AML><Item type="Foo" id="A1" action="add">${langs
    .split(",")
    .filter((lang) => lang !== "")
    .map((lang) => `<i18n:label xmlns:i18n="http://www.aras.com/I18N" xml:lang="${lang}">v</i18n:label>`)
    .join("")}</Item></AML>`;

interface Built {
  manager?: ImportExportManager;
  context: SolutionUpgradeContext;
  stub: StubConnection;
  thrown?: unknown;
}

/** An import context over packages whose files are `{package: {file: text}}`, a manager built for it, and what the stub saw. */
async function build(
  packages: Record<string, Record<string, string>>,
  languages: string[] | null,
  script: LangScript | ((request: string) => string) = { languageCodes: ["en", "de", "fr"] },
  options: { engine?: Engine; action?: string } = {},
): Promise<Built> {
  const root = mkdtempSync(join(tmpdir(), "libsjs-langctor-"));
  roots.push(root);
  const entries = Object.entries(packages);
  writeFileSync(
    join(root, "imports.mf"),
    `<imports>${entries.map(([name]) => `<package name="${name}" path="${name}\\Import" />`).join("")}</imports>`,
  );
  for (const [name, files] of entries) {
    mkdirSync(join(root, name, "Import"), { recursive: true });
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name, "Import", file)), { recursive: true });
      writeFileSync(join(root, name, "Import", file), text);
    }
  }
  const engine = options.engine ?? "14.35";
  const context = new SolutionUpgradeContext();
  context.action = options.action ?? "Import";
  context.manifestFile = join(root, "imports.mf");
  context.workingDirectory = root;
  context.logFilePath = join(root, "engine.log");
  context.languages = languages;
  const stub = new StubConnection((request) => (typeof script === "function" ? script(request) : langResponse(script, request)));
  const helper = new CItemHelper(stub, { engine });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  const built: Built = { context, stub };
  try {
    built.manager = await ImportExportManager.create(context, createMessagesFactory({ engine }), helper, { cwd: root });
  } catch (error) {
    built.thrown = error;
  }
  return built;
}

const P1 = { "P1": { "a.xml": aml("de,fr") } };

describe("the scan runs for every import, whatever Languages is (IMP-610)", () => {
  it("leaves a null selection alone and sends nothing (languages-null)", async () => {
    const built = await build(P1, null);
    expect(built.thrown).toBeUndefined();
    expect(built.context.languages).toBeNull();
    expect(built.stub.requests).toEqual([]);
    expect([...(built.manager?.languageCodes.getUsedLanguagesByPackage("P1") ?? [])].sort()).toEqual(["de", "fr"]);
  });

  it("leaves an empty selection alone and sends nothing (languages-empty-array)", async () => {
    const built = await build(P1, []);
    expect(built.thrown).toBeUndefined();
    expect(built.context.languages).toEqual([]);
    expect(built.stub.requests).toEqual([]);
  });

  it("scans every package of the manifest, the ones the host will not import too (bad-file-in-unrelated-package)", async () => {
    const built = await build({ P1: { "a.xml": aml("de") }, P2: { "bad.xml": "<AML><Item>" } }, ["de"]);
    expect(built.thrown).toBeInstanceOf(AggregateException);
    expect(built.stub.requests).toEqual([]);
    expect(built.context.languages).toEqual(["de"]);
  });

  it("fails on a file that is not XML even with no selection (bad-file-no-languages-option)", async () => {
    const built = await build({ P1: { "readme.xml": "not xml" } }, null);
    // the first line of Exception.ToString() continues with the inner exception's (the oracle's host shows it so)
    expect(exceptionText(built.thrown)).toBe(
      "System.AggregateException: One or more errors occurred. ---> System.Xml.XmlException: Data at the root level is invalid. Line 1, position 1.",
    );
    expect(exceptionText((built.thrown as AggregateException).innerExceptions[0])).toBe(
      "System.Xml.XmlException: Data at the root level is invalid. Line 1, position 1.",
    );
  });

  it("reads files of any shape that parse (non-item-xml-files-are-fine)", async () => {
    const built = await build({ P1: { "a.xml": aml("de"), "other.xml": "<config><x/></config>" } }, null);
    expect(built.thrown).toBeUndefined();
  });

  it("fails with the listing's own exception for a missing package folder (missing-package-folder)", async () => {
    const built = await build({ P1: {} }, null);
    expect(built.thrown).toBeUndefined();
    const root = dirname(built.context.manifestFile as string);
    writeFileSync(join(root, "imports2.mf"), '<imports><package name="M" path="Missing\\Import" /></imports>');
    built.context.manifestFile = join(root, "imports2.mf");
    const helper = new CItemHelper(built.stub, { engine: "14.35" });
    expect(() => new ImportExportManager(built.context, createMessagesFactory({ engine: "14.35" }), helper, { cwd: root })).toThrow(
      "Could not find a part of the path",
    );
  });

  it("does not scan on 14.0.7: a bad file is found by the import, if at all, and Languages is not read", async () => {
    const built = await build({ P1: { "readme.xml": "not xml" } }, ["xx"], { languageCodes: ["en"] }, { engine: "14.0.7" });
    expect(built.thrown).toBeUndefined();
    expect(built.stub.requests).toEqual([]);
    expect(built.context.languages).toEqual(["xx"]);
  });

  it("does not scan for an export, which has no manifest to read", async () => {
    const built = await build({ P1: { "readme.xml": "not xml" } }, null, undefined, { action: "Export" });
    expect(built.thrown).toBeUndefined();
  });
});

describe("a selection of * is replaced by the languages the packages use (IMP-620)", () => {
  it("expands to the sorted union of the manifest's packages and writes it to the context (languages-star)", async () => {
    const built = await build({ P1: { "a.xml": aml("fr,de") }, P2: { "a.xml": aml("de,en") } }, ["*"]);
    expect(built.thrown).toBeUndefined();
    expect(built.context.languages).toEqual(["de", "en", "fr"]);
    expect(built.stub.requests).toEqual([LANGUAGE_GET]);
  });

  it("expands to nothing for packages with no languages, and then sends no request (languages-star-package-without-languages)", async () => {
    const built = await build({ P1: { "a.xml": "<AML><Item type='Foo'/></AML>" } }, ["*"]);
    expect(built.context.languages).toEqual([]);
    expect(built.stub.requests).toEqual([]);
  });

  it("uses the lower-cased codes of the files (languages-star-uppercase-in-files)", async () => {
    const built = await build({ P1: { "a.xml": aml("DE,Fr") } }, ["*"]);
    expect(built.context.languages).toEqual(["de", "fr"]);
  });

  it("does not expand a list that has other entries; the check names * (languages-star-and-more, languages-de-and-star, languages-star-twice)", async () => {
    for (const list of [["*", "de"], ["de", "*"], ["*", "*"]]) {
      const built = await build(P1, list);
      expect(built.context.languages).toEqual(list);
      expect((built.thrown as CItemException).message).toContain("installed for current Aras Innovator: *.");
    }
  });

  it("is refused when a package uses a language the server lacks, leaving the expanded list in the context (languages-star-not-installed)", async () => {
    const built = await build({ P1: { "a.xml": aml("de,es") } }, ["*"]);
    expect(built.context.languages).toEqual(["de", "es"]);
    expect((built.thrown as CItemException).message).toBe(
      "Some of the selected languages are not installed for current Aras Innovator: es.\r\nPlease, install missing languages or remove them from import package before proceeding.",
    );
  });

  it("leaves * as it is for an action that is not an import (export-action-star-not-expanded)", async () => {
    const built = await build(P1, ["*"], undefined, { action: "Export" });
    expect(built.context.languages).toEqual(["*"]);
    expect((built.thrown as CItemException).message).toContain("installed for current Aras Innovator: *.");
  });
});

describe("every selected language must be installed (IMP-621)", () => {
  it("asks once when the selection passes (languages-de-en)", async () => {
    const built = await build(P1, ["de", "en"]);
    expect(built.thrown).toBeUndefined();
    expect(built.stub.requests).toEqual([LANGUAGE_GET]);
    expect(built.context.languages).toEqual(["de", "en"]);
  });

  it("names the missing codes once each, in order, and asks twice (languages-not-installed-duplicates)", async () => {
    const built = await build(P1, ["xx", "yy", "xx", "de", "yy"]);
    const failure = built.thrown as CItemException;
    expect(failure).toBeInstanceOf(CItemException);
    expect(failure.faultcode).toBe(0);
    expect(failure.faultstring).toBe("");
    expect(failure.faultdetail).toBe(failure.message);
    expect(failure.message).toBe(
      "Some of the selected languages are not installed for current Aras Innovator: xx,yy.\r\nPlease, install missing languages or remove them from import package before proceeding.",
    );
    expect(built.stub.requests).toEqual([LANGUAGE_GET, LANGUAGE_GET]);
  });

  it("compares the selection as written with the lower-cased installed codes (languages-uppercase-selected, languages-uppercase-installed)", async () => {
    const upper = await build(P1, ["DE", "en"]);
    expect((upper.thrown as CItemException).message).toContain("Aras Innovator: DE.");
    const installedUpper = await build(P1, ["de"], { languageXml: '<Item type="Language" id="1"><code>DE</code></Item>' });
    expect(installedUpper.thrown).toBeUndefined();
  });

  it("does not trim, and prints an empty code as it is (languages-with-spaces, languages-empty-string)", async () => {
    expect(((await build(P1, [" de", "fr "])).thrown as CItemException).message).toContain("Aras Innovator:  de,fr .");
    expect(((await build(P1, [""])).thrown as CItemException).message).toContain("Aras Innovator: .");
  });

  it("checks the selection for an export action too (export-action-checks-languages)", async () => {
    const built = await build(P1, ["xx"], undefined, { action: "Export" });
    expect((built.thrown as CItemException).message).toContain("Aras Innovator: xx.");
  });
});

describe("a failed Language get makes every selected language not installed (IMP-622, IMP-623)", () => {
  it.each([
    ["a fault with code 0", () => stubFault("0", "No items of type Language found.")],
    ["a fault with another code", () => stubFault("1", "boom")],
    ["an empty result", () => stubResult("")],
    ["a response that is not a SOAP envelope", () => "<html/>"],
  ])("%s", async (_, answer) => {
    const built = await build(P1, ["de"], answer);
    expect((built.thrown as CItemException).message).toContain("Aras Innovator: de.");
    expect(built.stub.requests).toEqual([LANGUAGE_GET, LANGUAGE_GET]);
  });

  it("throws the NullReferenceException of an item with no code, after one request (language-get-item-without-code)", async () => {
    const built = await build(P1, ["de"], { languageXml: '<Item type="Language" id="1"><name>x</name></Item><Item type="Language" id="2"><code>de</code></Item>' });
    expect(built.thrown).toMatchObject({ typeName: "System.NullReferenceException" });
    expect(built.stub.requests).toEqual([LANGUAGE_GET]);
  });

  it("reads two items with one code and an item with no name without trouble (language-get-duplicate-code, -item-without-name)", async () => {
    const built = await build(P1, ["de"], {
      languageXml: '<Item type="Language" id="1"><code>de</code></Item><Item type="Language" id="2"><code>de</code><name>German</name></Item>',
    });
    expect(built.thrown).toBeUndefined();
  });
});

describe("a package's skip set (IMP-630)", () => {
  it("is the languages it uses minus the selection, each once, in the used order", () => {
    expect(languagesToSkip(["de", "fr", "en"], ["de"])).toEqual(["fr", "en"]);
    expect(languagesToSkip(["de", "fr", "en"], ["de", "en"])).toEqual(["fr"]);
    expect(languagesToSkip(["de", "de", "fr"], ["en"])).toEqual(["de", "fr"]);
  });

  it("compares exactly, so a selection entry DE does not keep a used de", () => {
    expect(languagesToSkip(["de"], ["DE"])).toEqual(["de"]);
  });

  it("is empty for a null or empty selection, or one that holds every used language (IMP-635)", () => {
    expect(languagesToSkip(["de", "fr"], null)).toEqual([]);
    expect(languagesToSkip(["de", "fr"], [])).toEqual([]);
    expect(languagesToSkip(["de", "fr"], ["fr", "de", "xx"])).toEqual([]);
  });
});

describe("the deletion of the skipped nodes (IMP-631)", () => {
  const cut = (xml: string, skipped: string[]): string => {
    const document = loadXml(xml, { preserveWhitespace: false });
    removeSkippedLanguageNodes(document, skipped);
    return outerXml(document);
  };

  it("removes every element of the code at any depth, with what is below it (any-element-and-nested)", () => {
    const xml =
      '<Item type="Foo"><p xml:lang="fr"><q xml:lang="fr">deep</q></p><r xml:lang="de">keep</r><s>plain</s><Relationships><Item type="R"><t xml:lang="fr"/></Item></Relationships></Item>';
    expect(cut(xml, ["fr"])).toBe('<Item type="Foo"><r xml:lang="de">keep</r><s>plain</s><Relationships><Item type="R"></Item></Relationships></Item>');
  });

  it("cuts for each code of the set, whatever the order (languages-de-en-removes-fr)", () => {
    const xml = '<Item><a xml:lang="de"/><a xml:lang="en"/><a xml:lang="fr"/><a xml:lang="es"/></Item>';
    expect(cut(xml, ["fr", "es"])).toBe('<Item><a xml:lang="de" /><a xml:lang="en" /></Item>');
    expect(cut(xml, ["es", "fr"])).toBe('<Item><a xml:lang="de" /><a xml:lang="en" /></Item>');
  });

  it("removes elements whose xml:lang is empty when the empty code is skipped (item-with-empty-lang)", () => {
    expect(cut('<Item><a xml:lang=""/><b xml:lang="de"/></Item>', [""])).toBe('<Item><b xml:lang="de" /></Item>');
  });

  it("matches the text as written, so a DE node is not removed for the code de (uppercase-in-file-is-lowered-in-the-selector, IMP-614)", () => {
    expect(cut('<Item><a xml:lang="DE"/><b xml:lang="de"/></Item>', ["de"])).toBe('<Item><a xml:lang="DE" /></Item>');
  });

  it("removes the Item itself when it carries a skipped code, leaving no document element (xml-lang-on-the-item-itself-and-used, IMP-634)", () => {
    const document = loadXml('<Item type="Foo" xml:lang="fr"><a xml:lang="fr"/></Item>', { preserveWhitespace: false });
    removeSkippedLanguageNodes(document, ["fr"]);
    expect(document.documentElement).toBeNull();
  });

  it("puts the code into the XPath unescaped, so an apostrophe makes the expression invalid (apostrophe-in-a-used-code, IMP-633)", () => {
    const document = loadXml("<Item><a xml:lang=\"d'e\"/></Item>", { preserveWhitespace: false });
    let failure: unknown;
    try {
      removeSkippedLanguageNodes(document, ["d'e"]);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(XPathException);
    expect((failure as Error).message).toBe("'//node()[@xml:lang='d'e']' has an invalid token.");
  });

  it("does nothing for an empty set (IMP-635)", () => {
    const xml = '<Item><a xml:lang="de"/></Item>';
    expect(cut(xml, [])).toBe('<Item><a xml:lang="de" /></Item>');
  });
});
