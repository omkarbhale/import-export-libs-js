import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGES,
  type ProbeCase,
  cfg,
  envelope,
  faultResponse,
  langResponse,
  runProbeCase,
  sections,
} from "./probe-harness.js";

/**
 * The probes of the real 14.0.7 `LanguagePackPreprocessor` (`fixtures/language-pack/14.0.7/probes/*.ps1`, outputs beside them),
 * replayed through the port: each case builds the same language-pack folder, runs the preprocessor against the same `Language`
 * answer, and must print the lines the engine printed: whether the constructor succeeded or which exception it threw, the
 * requests, every file it left in the temp folder with its exact text, and what `Dispose` did. Backs LP-010 to LP-036.
 */

const IT = '<itemtype name="Foo"/>';
const FOO =
  '<export><Item type="Foo" id="A1"><property __name="name" de="Hallo" fr="Salut" en="Hello" es="Hola"/><property __name="Label" de="L" fr="LF"/></Item></export>';
const exp = (items: string): string => `<export>${items}</export>`;
const ONE = exp('<Item type="Foo" id="A1" keyed_name="K"><property __name="name" de="Hallo" fr="Salut"/></Item>');
const NBSP = " ";
const IDEOGRAPHIC = "　";
const ZERO_WIDTH = "​";
const E_ACUTE = "é";
const E_ACUTE_UP = "É";

function config(label: string, text: string, response: string = DEFAULT_LANGUAGES, files: Record<string, string> = {}): ProbeCase {
  return { label, files: { "ImportConfig.xml": text, "xml\\Foo.xml": FOO, ...files }, response };
}

function rows(label: string, text: string, files: Record<string, string>, response: string = DEFAULT_LANGUAGES): ProbeCase {
  const xml: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) xml[`xml\\${name}`] = content;
  return { label, files: { "ImportConfig.xml": text, ...xml }, response };
}

const languagesAndConfig: ProbeCase[] = [
  config("languages-list-de-fr", cfg("de,fr", [IT])),
  config("languages-none-means-all", cfg("", [IT])),
  config("languages-uppercase-and-spaces", cfg(" DE , Fr ", [IT])),
  config("languages-space-only-list", cfg(" ", [IT])),
  config("languages-unknown-only", cfg("xx", [IT])),
  config("languages-empty-items-in-list", cfg("de,,fr,", [IT])),
  config("languages-element-twice", `<ImportConfig><languages list="de"/><languages list="fr"/>${IT}</ImportConfig>`),
  config("languages-nested-not-read", `<ImportConfig><x><languages list="de"/></x>${IT}</ImportConfig>`),
  config("languages-uppercase-attr-name", `<ImportConfig><languages LIST="de"/>${IT}</ImportConfig>`),
  config("root-other-name", `<Whatever><languages list="de"/>${IT}</Whatever>`),
  config("server-code-uppercase", cfg("de", [IT]), langResponse([["en", ""], ["DE", "_de"]])),
  config("server-code-uppercase-all", cfg("", [IT]), langResponse([["en", ""], ["DE", "_de"], ["de", "_d2"]])),
  config("server-order-fr-de", cfg("", [IT]), langResponse([["en", ""], ["fr", "_fr"], ["de", "_de"]])),
  // The script passed `@(@('de','_de'))`, which PowerShell flattens, so the server answered two languages: `d` (suffix `e`) and `_` (suffix `d`).
  config("server-no-en", cfg("", [IT]), langResponse([["d", "e"], ["_", "d"]])),
  config("server-en-uppercase", cfg("", [IT]), langResponse([["EN", ""], ["de", "_de"]])),
  config("server-suffix-missing", cfg("", [IT]), langResponse([["en", ""], ["de", null]])),
  config("server-code-missing", cfg("", [IT]), langResponse([["en", ""], [null, "_x"], ["de", "_de"]])),
  config("server-code-missing-with-list", cfg("de", [IT]), langResponse([[null, "_x"], ["de", "_de"]])),
  config("server-code-duplicate", cfg("", [IT]), langResponse([["en", ""], ["de", "_de"], ["de", "_d2"]])),
  config("server-code-duplicate-not-requested", cfg("fr", [IT]), langResponse([["en", ""], ["de", "_de"], ["de", "_d2"], ["fr", "_fr"]])),
  config("server-one-language-only", cfg("", [IT]), langResponse([["de", "_de"]])),
  config("server-no-items-fault0", cfg("", [IT]), faultResponse("0", "No items of type Language found.")),
  config("server-other-fault", cfg("", [IT]), faultResponse("1", "Access denied")),
  config("server-empty-result", cfg("", [IT]), envelope("<Result></Result>")),
  config("server-garbage-response", cfg("", [IT]), "<html/>"),
  config("code-with-xml-special", cfg("", [IT]), langResponse([["en", ""], ["d-e", "_de"]])),
  config("code-with-hyphen", cfg("", [IT]), langResponse([["en", ""], ["d-e", "_de"]]), {
    "xml\\Foo.xml": '<export><Item type="Foo" id="A1"><property __name="name" d-e="Hallo" de="X"/></Item></export>',
  }),
  config("languages-list-nbsp-and-ideographic-space", cfg(`${NBSP}de${IDEOGRAPHIC},fr`, [IT])),
  config("languages-list-zero-width-space-not-trimmed", cfg(`${ZERO_WIDTH}de,fr`, [IT])),
  config(
    "languages-list-non-ascii-uppercase",
    cfg(`${E_ACUTE_UP}x`, [IT]),
    langResponse([["en", ""], [`${E_ACUTE}x`, "_ex"], ["de", "_de"]]),
    { "xml\\Foo.xml": `<export><Item type="Foo" id="A1"><property __name="name" ${E_ACUTE}x="Hallo" de="D"/></Item></export>` },
  ),
];

const prop = (list: string): string => `<itemtype name="Foo"><properties list="${list}"/></itemtype>`;
const TWO = exp('<Item type="Foo" id="A1"><property __name="name" de="N"/><property __name="Label" de="L"/><property __name="label" de="l"/></Item>');
const named = (inner: string): string => exp(`<Item type="Foo" id="A1">${inner}</Item>`);
const NAME_DE = (value: string): string => `<property __name="name" de="${value}"/>`;

const rowCases: ProbeCase[] = [
  rows("itemtype-none-with-file", cfg("de", []), { "Foo.xml": ONE }),
  rows("itemtype-none-without-files", cfg("de", []), { "readme.txt": "x" }),
  rows("itemtype-other-only", cfg("de", ['<itemtype name="Bar"/>']), { "Foo.xml": ONE, "Bar.xml": ONE.replace("Foo", "Bar") }),
  rows("itemtype-name-case", cfg("de", ['<itemtype name="foo"/>']), { "Foo.xml": ONE }),
  rows(
    "itemtype-duplicate-last-wins",
    cfg("de", ['<itemtype name="Foo"><properties list="name"/></itemtype>', '<itemtype name="Foo"><properties list="other"/></itemtype>']),
    { "Foo.xml": ONE },
  ),
  rows("itemtype-duplicate-last-all", cfg("de", ['<itemtype name="Foo"><properties list="other"/></itemtype>', '<itemtype name="Foo"/>']), { "Foo.xml": ONE }),
  rows("itemtype-no-name", cfg("de", ["<itemtype/>"]), { "Foo.xml": ONE }),
  rows("itemtype-nested-not-read", '<ImportConfig><x><itemtype name="Foo"/></x></ImportConfig>', { "Foo.xml": ONE }),
  rows("itemtype-name-with-spaces", cfg("de", ['<itemtype name="Sub Type"/>']), {
    "Sub Type.xml": exp('<Item type="Sub Type" id="A1"><property __name="name" de="Hallo"/></Item>'),
  }),

  rows("props-list-name", cfg("de", [prop("name")]), { "Foo.xml": TWO }),
  rows("props-list-uppercase-in-config", cfg("de", [prop("NAME,LABEL")]), { "Foo.xml": TWO }),
  rows("props-list-space-after-comma", cfg("de", [prop("name, label")]), { "Foo.xml": TWO }),
  rows("props-list-space-around", cfg("de", [prop(" name ")]), { "Foo.xml": TWO }),
  rows("props-list-empty", cfg("de", [prop("")]), { "Foo.xml": TWO }),
  rows("props-list-spaces-only", cfg("de", [prop("   ")]), { "Foo.xml": TWO }),
  rows("props-list-none-match", cfg("de", [prop("zzz")]), { "Foo.xml": TWO }),
  rows("props-element-twice", cfg("de", ['<itemtype name="Foo"><properties list="name"/><properties list="label"/></itemtype>']), { "Foo.xml": TWO }),
  rows("props-no-list-attr", cfg("de", ['<itemtype name="Foo"><properties/></itemtype>']), { "Foo.xml": TWO }),
  rows("props-trailing-comma-no-name-attr", cfg("de", [prop("name,")]), {
    "Foo.xml": named('<property de="X"/><property __name="name" de="N"/>'),
  }),
  rows("prop-no-name-attr-all-props", cfg("de", [IT]), { "Foo.xml": named('<property de="X"/><property __name="name" de="N"/>') }),

  rows("prop-duplicate-both-translated", cfg("de", [IT]), { "Foo.xml": named('<property __name="name" de="A"/><property __name="name" de="B"/>') }),
  rows("prop-duplicate-first-untranslated", cfg("de", [IT]), { "Foo.xml": named('<property __name="name" en="E"/><property __name="name" de="B"/>') }),
  rows("prop-duplicate-excluded-by-list", cfg("de", [prop("x")]), { "Foo.xml": named('<property __name="name" de="A"/><property __name="name" de="B"/>') }),
  rows("translation-empty-string", cfg("de,fr", [IT]), { "Foo.xml": named('<property __name="name" de="" fr="F"/>') }),
  rows("translation-all-empty-item-skipped", cfg("de,fr", [IT]), { "Foo.xml": named('<property __name="name" de="" fr=""/>') }),
  rows("translation-whitespace", cfg("de", [IT]), { "Foo.xml": named('<property __name="name" de=" "/>') }),
  rows("translation-en-only", cfg("de", [IT]), { "Foo.xml": named('<property __name="name" en="E"/>') }),
  rows("translation-language-not-on-server", cfg("de", [IT]), { "Foo.xml": named('<property __name="name" it="I"/>') }),
  rows("item-without-translations-then-with", cfg("de", [IT]), {
    "Foo.xml": exp('<Item type="Foo" id="A1"><property __name="name" en="E"/></Item><Item type="Foo" id="A2"><property __name="name" de="D2"/></Item>'),
  }),
  rows("no-item-translated-no-file", cfg("de", [IT]), { "Foo.xml": named('<property __name="name" en="E"/>') }),
  rows("item-with-no-properties", cfg("de", [IT]), { "Foo.xml": exp('<Item type="Foo" id="A1"/>') }),
  rows("two-items-order", cfg("de", [IT]), {
    "Foo.xml": exp('<Item type="Foo" id="B"><property __name="name" de="2"/></Item><Item type="Foo" id="A"><property __name="name" de="1"/></Item>'),
  }),
  rows("property-order-in-file", cfg("de", [IT]), {
    "Foo.xml": exp('<Item type="Foo" id="A"><property __name="z" de="1"/><property __name="a" de="2"/></Item>'),
  }),

  rows("root-not-export", cfg("de", [IT]), { "Foo.xml": ONE.replace("export", "AML").replace("export", "AML") }),
  rows("items-nested-not-selected", cfg("de", [IT]), {
    "Foo.xml": '<export><x><Item id="N"><property __name="name" de="D"/></Item></x><Item id="A"><Relationships><Item id="R"><property __name="name" de="D"/></Item></Relationships></Item></export>',
  }),
  rows("property-nested-not-selected", cfg("de", [IT]), { "Foo.xml": '<export><Item id="A"><x><property __name="name" de="D"/></x></Item></export>' }),
  rows("export-element-twice", cfg("de", [IT]), { "Foo.xml": '<export><Item id="A"><property __name="name" de="D"/></Item></export>' }),
  rows("item-in-namespace", cfg("de", [IT]), { "Foo.xml": '<export xmlns="urn:x"><Item id="A"><property __name="name" de="D"/></Item></export>' }),
  rows("property-element-name-case", cfg("de", [IT]), { "Foo.xml": '<export><Item id="A"><Property __name="name" de="D"/></Item></export>' }),
  rows("translation-attr-case", cfg("de", [IT]), { "Foo.xml": '<export><Item id="A"><property __name="name" DE="D"/></Item></export>' }),
  rows("name-attr-uppercase-in-file", cfg("de", [prop("name")]), { "Foo.xml": '<export><Item id="A"><property __name="NAME" de="D"/></Item></export>' }),

  rows("where-attributes-in-order", cfg("de", [IT]), {
    "Foo.xml": exp('<Item zeta="1" type="Foo" id="A1" keyed_name="K" alpha="2" Type="T" KEYED_NAME="k"><property __name="name" de="D"/></Item>'),
  }),
  rows("where-no-attributes", cfg("de", [IT]), { "Foo.xml": exp('<Item type="Foo" keyed_name="K"><property __name="name" de="D"/></Item>') }),
  rows("where-no-attributes-at-all", cfg("de", [IT]), { "Foo.xml": exp('<Item><property __name="name" de="D"/></Item>') }),
  rows("where-value-quote-and-markup", cfg("de", [IT]), {
    "Foo.xml": exp('<Item id="a\'b" other="x&amp;y &lt;z&gt; &quot;q&quot;" empty=""><property __name="name" de="D"/></Item>'),
  }),
  rows("where-prefixed-attributes", cfg("de", [IT]), {
    "Foo.xml": '<export xmlns:a="urn:a"><Item a:id="1" xml:lang="en" id="2"><property __name="name" de="D"/></Item></export>',
  }),
  rows("where-type-name-spaces", cfg("de", ['<itemtype name="Sub  Type X"/>']), {
    "Sub  Type X.xml": exp('<Item id="A1"><property __name="name" de="D"/></Item>'),
  }),

  rows("value-markup-and-controls", cfg("de", [IT]), {
    "Foo.xml": exp(`<Item id="A"><property __name="name" de="a &amp; b &lt; c &gt; d &quot;e&quot; 'f' &#9;tab &#10;lf &#13;cr &#13;&#10;crlf"/></Item>`),
  }),
  rows("value-non-ascii", cfg("de", [IT]), { "Foo.xml": exp('<Item id="A"><property __name="name" de="Gr&#xFC;&#xDF;e &#x1F600; &#x4E2D;"/></Item>') }),
  rows("value-lone-surrogate-reference", cfg("de", [IT]), { "Foo.xml": exp('<Item id="A"><property __name="name" de="a&#xD800;b"/></Item>') }),
  rows("value-looks-like-xml", cfg("de", [IT]), { "Foo.xml": exp('<Item id="A"><property __name="name" de="&lt;b&gt;x&lt;/b&gt;"/></Item>') }),

  rows("file-xmlbak-extension", cfg("de", ['<itemtype name="Foobak"/>']), { "Foo.xmlbak": ONE }),
  rows("file-xmlbak-config-foo", cfg("de", [IT]), { "Foo.xmlbak": ONE }),
  rows("file-uppercase-extension", cfg("de", ['<itemtype name="Foo.XML"/>']), { "Foo.XML": ONE }),
  rows("file-double-extension", cfg("de", [IT]), { "Foo.xml.xml": ONE }),
  rows("file-dot-inside", cfg("de", ['<itemtype name="A.B"/>']), { "A.B.xml": ONE }),
  rows("file-dot-xml-inside", cfg("de", ['<itemtype name="A.B"/>']), { "A.xml.xml.B.xml": ONE }),
  rows("file-hidden-name", cfg("de", ['<itemtype name=""/>']), { ".xml": ONE }),
  rows("file-not-xml", cfg("de", [IT]), { "Foo.txt": ONE }),
  rows("xml-folder-subfolder-ignored", cfg("de", [IT]), { "sub\\Foo.xml": ONE }),

  rows("second-file-fails-first-stays", cfg("de", ['<itemtype name="A"/>', '<itemtype name="B"/>']), {
    "A.xml": ONE,
    "B.xml": exp('<Item id="A1"><property __name="name" de="A"/><property __name="name" de="B"/></Item>'),
  }),
  rows("malformed-xml-file", cfg("de", [IT]), { "Foo.xml": "<export><Item" }),
  rows("empty-xml-file", cfg("de", [IT]), { "Foo.xml": "" }),
  rows("xml-file-with-declaration-and-bom", cfg("de", [IT]), { "Foo.xml": `﻿<?xml version="1.0" encoding="utf-8"?>${ONE}` }),
  rows("file-name-collision", cfg("de", [IT]), {
    "Foo.xml": exp('<Item id="FIRST"><property __name="name" de="1"/></Item>'),
    "Foo.xml.xml": exp('<Item id="SECOND"><property __name="name" de="2"/></Item>'),
  }),
];

const propertyNames: ProbeCase[] = ["a b", "1a", "a:b", "a.b", "a-b", E_ACUTE, "a<b", "xml:lang", "a/b", "a:b:c", ":b"].map((name, index) => {
  const label = `property-name-${index + 1} ${name.replace(E_ACUTE, "_u00E9").replace(/[\\:</]/g, "_")}`;
  return rows(label, cfg("de", [IT]), { "Foo.xml": exp(`<Item id="A"><property __name="${name.replace("<", "&lt;")}" de="D"/></Item>`) });
});

async function expectSection(file: string, probe: ProbeCase, recorded: Map<string, string[]>): Promise<void> {
  const expected = recorded.get(probe.label);
  expect(expected, `${file} has a section "${probe.label}"`).toBeDefined();
  const actual = await runProbeCase(probe);
  expect(actual.join("\n")).toBe((expected as string[]).join("\n"));
}

describe("probe 01: the configuration, the Language get and the filter (LP-010 to LP-015)", () => {
  const recorded = sections("01-config-and-languages.out");
  it("replays every recorded case", () => {
    expect(languagesAndConfig.map((c) => c.label).sort()).toEqual([...recorded.keys()].sort());
  });
  it.each(languagesAndConfig.map((c) => [c.label, c] as const))("%s", async (_, probe) => {
    await expectSection("01-config-and-languages.out", probe, recorded);
  });
});

describe("probe 02: the row files, the edit items and the where clause (LP-020 to LP-027)", () => {
  const recorded = sections("02-rows-and-aml.out");
  const all = [...rowCases, ...propertyNames];
  it("replays every recorded case", () => {
    expect(all.map((c) => c.label).sort()).toEqual([...recorded.keys()].sort());
  });
  it.each(all.map((c) => [c.label, c] as const))("%s", async (_, probe) => {
    await expectSection("02-rows-and-aml.out", probe, recorded);
  });
});

const CFG_FOO = cfg("de", [IT]);
const SIMPLE = exp('<Item type="Foo" id="A1"><property __name="name" de="Hallo"/></Item>');
const standard = (label: string, extra: Partial<ProbeCase> = {}): ProbeCase => ({
  label,
  files: { "ImportConfig.xml": CFG_FOO, "xml\\Foo.xml": SIMPLE },
  ...extra,
});

const failureCases: ProbeCase[] = [
  { label: "config-missing", files: {}, configPath: (folder) => `${folder}/no-such/ImportConfig.xml` },
  { label: "config-is-directory", files: { "ImportConfig.xml\\x.txt": "x" } },
  { label: "config-malformed", files: { "ImportConfig.xml": "<ImportConfig><languages", "xml\\Foo.xml": SIMPLE } },
  { label: "config-empty", files: { "ImportConfig.xml": "", "xml\\Foo.xml": SIMPLE } },
  { label: "config-only-no-xml-folder", files: { "ImportConfig.xml": CFG_FOO } },
  { label: "config-other-file-name", files: { "MyPack.cfg": CFG_FOO, "xml\\Foo.xml": SIMPLE }, configName: "MyPack.cfg" },
  { label: "config-xml-sibling-is-file", files: { "ImportConfig.xml": CFG_FOO, xml: "a file" } },
  standard("path-forward-slashes", { configPath: (folder) => `${folder}/ImportConfig.xml`.replace(/\\/g, "/") }),
  standard("path-with-dotdot", { configPath: (folder) => `${folder}/x/../ImportConfig.xml` }),
  standard("path-empty-string", { configPath: () => "" }),
  standard("path-null", { configPath: () => null }),
];

const packageCases: ProbeCase[] = [
  ["pkg-plain", "LIBSJS-SCRATCH-LP"],
  ["pkg-with-dots", "My.Pkg"],
  ["pkg-standard-core", "com.aras.innovator.core"],
  ["pkg-standard-default", "com.aras.defaults.Lang"],
  ["pkg-trailing-dot", "a.b."],
  ["pkg-with-space", "a b"],
  ["pkg-empty", ""],
  ["pkg-slash", "a/b"],
  ["pkg-backslash", "a\\b"],
  ["pkg-illegal-char-pipe", "a|b"],
  ["pkg-quote", "a'b"],
  ["pkg-unicode", "P\u00fcck"],
].map(([label, pkg]) => standard(label as string, { pkg: pkg as string, debug: true, full: true }));

const pkgDotdot = standard("pkg-dotdot", { pkg: "..", debug: true, full: true });

const debugCases: ProbeCase[] = [standard("debug-false", { debug: false }), standard("debug-true", { debug: true })];

describe("probe 03: failures, config path spellings, package names and debug retention (LP-010, LP-029 to LP-036)", () => {
  const recorded = sections("03-failures-package-cleanup.out");
  // pkg-colon and pkg-rooted-path name Windows drive paths, which another platform cannot use (MAN-033); pkg-dotdot is checked below
  // with the folder the `..` leaves it in; path-bare-file-name needs the process's current directory.
  const cases = [...failureCases, ...packageCases, ...debugCases];
  it.each(cases.map((c) => [c.label, c] as const))("%s", async (_, probe) => {
    const expected = recorded.get(probe.label);
    expect(expected, `a section "${probe.label}"`).toBeDefined();
    const actual = await runProbeCase(probe);
    const profile = "%USERPROFILE%\\\\AppData\\\\Local\\\\";
    const normalised = (expected as string[]).map((line) =>
      line
        .split(`${profile}Temp\\\\`)
        .join("%TEMP%\\\\")
        .split(`${profile}libsjs23-probe\\\\cases\\\\${probe.label}`)
        .join("%CASE%")
        .split(`${profile}libsjs23-probe\\\\cases\\\\no-such`)
        .join("%CASE%\\\\no-such"),
    );
    expect(actual.join("\n")).toBe(normalised.join("\n"));
  });
});
