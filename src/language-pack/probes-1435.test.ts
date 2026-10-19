import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { CItemHelper } from "../client/item-helper.js";
import { ArasVersion } from "../client/version.js";
import { ManifestFile } from "../manifest/index.js";
import { dotNetTypeName } from "./exception-text.js";
import { LanguagePackPreprocessor } from "./preprocessor.js";
import { cfg, envelope, esc, faultResponse, langResponse } from "./probe-harness.js";

/**
 * The probes of the real 14.35 `LanguagePackPreprocessor` (`fixtures/import-languages/14.35/probes/04-lp-preprocessor.ps1`, output
 * beside it), replayed through the port: each case writes the same language-pack folder, runs the preprocessor against the same scripted
 * server and server version, and must print the lines the engine printed: whether the constructor succeeded or which exception it threw,
 * the requests it sent besides the usual `Language` get, and every file it left in the temp folder with its exact text. Backs LP-020 to
 * LP-029, LP-036, LP-040 and LP-041.
 */

const PROBE = new URL("../../fixtures/import-languages/14.35/probes/04-lp-preprocessor.out", import.meta.url).pathname;

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** The sections of a probe output: the lines after each `## label`, up to the next `##` or `####` line. */
function sectionsOf(file: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      current = [];
      result.set(line.slice(3), current);
    } else if (line.startsWith("#### ")) {
      current = undefined;
    } else if (current !== undefined && line !== "") {
      current.push(line);
    }
  }
  return result;
}

const PROBE_SECTIONS = sectionsOf(PROBE);

type Respond = (request: string) => string | null;

/** One `Case`/`RunLP` call of the script. */
interface Case {
  label: string;
  config: string;
  files: Record<string, string>;
  respond: Respond;
  /** The server version as the `ArasVersion` constructor takes it; the default is 12.0 SP9. */
  version?: [number, number, number, number, number] | "none";
  /** Replaces the path the preprocessor is given. */
  lpPath?: string;
}

const STANDARD_LANGUAGE_GET = '<Item isNew="1" isTemp="1" type="Language" action="get" select="code,suffix" />';

class ScriptedConnection implements ServerConnection {
  readonly requests: string[] = [];

  constructor(private readonly respond: Respond) {}

  async callAction(_action: string, request: string): Promise<ResponseDocument> {
    this.requests.push(request);
    const answer = this.respond(request);
    if (answer === null) throw new Error(`the script has no answer for ${request}`);
    return ResponseDocument.parse(answer);
  }
}

const LANGUAGES = langResponse([
  ["en", ""],
  ["de", "_de"],
  ["fr", "_fr"],
]);
const result = (inner: string): string => envelope(`<Result>${inner}</Result>`);

/** The script's `Answer`: the Language get, and a Property get answered from a table of id to items (or one fault for all). */
function answer(propertyValues: Record<string, string> = {}, propertyFault: string | null = null): Respond {
  return (request) => {
    if (/type="Language"/.test(request)) return LANGUAGES;
    if (/type="Property".*action="get"/.test(request)) {
      if (propertyFault !== null) return propertyFault;
      const id = /<id>([^<]*)<\/id>/.exec(request)?.[1] ?? "";
      const found = propertyValues[id];
      return found !== undefined ? result(found) : faultResponse("0", "No items of type Property found.");
    }
    return null;
  };
}

function listing(base: string): string[] {
  const files: string[] = [];
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder).sort()) {
      const full = join(folder, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(base);
  return files.filter((file) => relative(base, file) !== "imports.mf").sort();
}

/** What the script printed for one case. */
async function lines(probe: Case): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), "libsjs-lp14-"));
  roots.push(root);
  const caseFolder = join(root, "cases", probe.label);
  const tempRoot = join(root, "tmp");
  mkdirSync(tempRoot, { recursive: true });
  const files: Record<string, string> = { "ImportConfig.xml": probe.config, ...probe.files };
  for (const [name, text] of Object.entries(files)) {
    const path = join(caseFolder, ...name.split("\\"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
  }
  const connection = new ScriptedConnection(probe.respond);
  const helper = new CItemHelper(connection, { engine: "14.35" });
  if (probe.version !== "none") helper.innovatorVersion = new ArasVersion(...(probe.version ?? [12, 0, 9, 24090, 0]));
  const scrub = (text: string): string =>
    text
      .split(`${tempRoot}/`)
      .join("%TEMP%\\\\")
      .replace(/LanguagePack_[a-z0-9]{8}\.[a-z0-9]{3}/g, "LanguagePack_<random>");
  const out: string[] = [];
  let preprocessor: LanguagePackPreprocessor | undefined;
  try {
    preprocessor = await LanguagePackPreprocessor.create(
      helper,
      new ManifestFile(undefined, { engine: "14.35" }),
      probe.lpPath ?? join(caseFolder, "ImportConfig.xml"),
      "PKG",
      false,
      { tempPath: `${tempRoot}/`, randomFileName: () => "abcdefgh.xyz" },
    );
    out.push("ctor => ok");
  } catch (error) {
    const failure = error as Error;
    out.push(`ctor => ${dotNetTypeName(failure)}: ${esc(failure.message)}`);
  }
  for (const request of connection.requests) if (request !== STANDARD_LANGUAGE_GET) out.push(`request => ${scrub(esc(request))}`);
  for (const folder of readdirSync(tempRoot)) {
    const base = join(tempRoot, folder);
    for (const file of listing(base)) {
      out.push(`  file ${esc(relative(base, file).split(sep).join("\\"))} => ${scrub(esc(readFileSync(file, "utf8")))}`);
    }
  }
  preprocessor?.dispose();
  return out;
}

/** The engine prints the fault block after an exception; only the type and message are compared, and the code is asserted on its own. */
const headOf = (line: string): string => line.replace(/ \[faultcode=.*$/, "");

async function expectProbe(probe: Case): Promise<void> {
  const expected = PROBE_SECTIONS.get(probe.label);
  if (expected === undefined) throw new Error(`the probe has no case ${probe.label}`);
  const actual = await lines(probe);
  // the probe prints the inner exception of an exception on a line of its own, indented
  expect(actual.map(headOf), probe.label).toEqual(expected.filter((line) => !line.startsWith("    inner ")).map(headOf));
}

const row = (type: string, id: string): string =>
  `<export><Item type="${type}" id="${id}"><property __name="name" de="Hallo" fr="Salut" en="Hello"/><property __name="label" de="Etikett"/></Item></export>`;
const any: Respond = (request) => (/type="Language"/.test(request) ? LANGUAGES : null);
const it1 = '<itemtype name="Foo"/>';

function named(label: string, itemtype: string, file: string, type: string): Case {
  return { label, config: cfg("", [itemtype]), files: { [`xml\\${file}`]: row(type, "A1") }, respond: any };
}

describe("14.35: the item type is the file name without its last extension (LP-020, LP-021, LP-025, LP-026, LP-027)", () => {
  it.each([
    named("name-plain", '<itemtype name="Foo"/>', "Foo.xml", "Foo"),
    named("name-two-dots", '<itemtype name="A.B"/>', "A.B.xml", "A.B"),
    named("name-xmlbak", '<itemtype name="Foo"/>', "Foo.xmlbak", "Foo"),
    named("name-upper-extension", '<itemtype name="Foo"/>', "Foo.XML", "Foo"),
    named("name-xml-twice", '<itemtype name="Foo.xml"/>', "Foo.xml.xml", "Foo"),
    named("name-xml-in-the-middle", '<itemtype name="A.xml.xml.B"/>', "A.xml.xml.B.xml", "A"),
    named("name-with-spaces", '<itemtype name="Sub Type"/>', "Sub Type.xml", "Sub Type"),
    named("name-hidden-file", '<itemtype name=""/>', ".xml", "Foo"),
    named("name-config-key-14-0-7-style", '<itemtype name="Foo"/>', "Foo.xml.xml", "Foo"),
    named("itemtype-other-only", '<itemtype name="Bar"/>', "Foo.xml", "Foo"),
  ])("$label", expectProbe);

  it("collides two files only when their names are equal (name-collision-two-files)", () =>
    expectProbe({
      label: "name-collision-two-files",
      config: cfg("", ['<itemtype name="Foo"/>', '<itemtype name="Foo.xml"/>']),
      files: { "xml\\Foo.xml": row("Foo", "A1"), "xml\\Foo.xml.xml": row("Foo", "A2") },
      respond: any,
    }));

  it("fails the first row file when the configuration has no itemtype (itemtype-none-with-file, -without-files)", async () => {
    await expectProbe({ label: "itemtype-none-with-file", config: cfg("", []), files: { "xml\\Foo.xml": row("Foo", "A1") }, respond: any });
    await expectProbe({ label: "itemtype-none-without-files", config: cfg("", []), files: { "xml\\readme.txt": "x" }, respond: any });
  });
});

const PROP = (id: string): string =>
  `<export><Item type="Property" id="${id}" action="x" keyed_name="k"><property __name="label" de="Etikett" fr="Libelle"/></Item></export>`;
const PTYPE = '<itemtype name="Property"/>';
const VALUES: Record<string, string> = {
  P1: '<Item type="Property" id="P1"><default_value>dv</default_value><data_source>ds</data_source><data_type>string</data_type></Item>',
  P2: '<Item type="Property" id="P2"><data_type>item</data_type></Item>',
  P3: '<Item type="Property" id="P3"><default_value></default_value></Item>',
  P4: '<Item type="Property" id="P4"><default_value>a</default_value></Item><Item type="Property" id="P5"><default_value>b</default_value></Item>',
};

function property(label: string, respond: Respond, file = PROP("P1"), version?: Case["version"]): Case {
  return { label, config: cfg("", [PTYPE]), files: { "xml\\Property.xml": file }, respond, ...(version === undefined ? {} : { version }) };
}

describe("14.35: a Property row first asks the server for the property's values (LP-040, LP-041)", () => {
  it.each([
    property("property-values-P1", answer(VALUES), PROP("P1")),
    property("property-values-P2", answer(VALUES), PROP("P2")),
    property("property-values-P3", answer(VALUES), PROP("P3")),
    property("property-values-P4", answer(VALUES), PROP("P4")),
    property("property-values-PX", answer(VALUES), PROP("PX")),
    property("property-get-empty-result", answer({}, result("")), PROP("P1")),
    property("property-get-garbage", answer({}, "<html/>"), PROP("P1")),
    property(
      "property-no-translation-still-asks",
      answer(VALUES),
      '<export><Item type="Property" id="P1"><property __name="label" en="Only English"/></Item></export>',
    ),
    property(
      "property-two-items-attributes-as-properties",
      answer(VALUES),
      '<export><Item type="Property" id="P1" keyed_name="k" foo="bar"><property __name="label" de="A"/></Item><Item type="Property" id="P2"><property __name="label" de="B"/></Item></export>',
    ),
    property(
      "property-item-without-attributes",
      answer(VALUES),
      '<export><Item type="Property" keyed_name="k"><property __name="label" de="A"/></Item></export>',
    ),
    property(
      "property-prefixed-attribute",
      answer(VALUES),
      '<export><Item type="Property" id="P1" a:b="c" xmlns:a="urn:a"><property __name="label" de="A"/></Item></export>',
    ),
  ])("$label", expectProbe);

  it("throws the server's fault when it is not faultcode 0 (property-get-fault-other)", async () => {
    await expectProbe(property("property-get-fault-other", answer({}, faultResponse("5", "boom")), PROP("P1")));
  });

  it("asks only for a type that is exactly Property (property-lowercase-file-name-not-property, property-with-spaces-name, foo-type-never-asks)", async () => {
    await expectProbe({ label: "property-lowercase-file-name-not-property", config: cfg("", ['<itemtype name="property"/>']), files: { "xml\\property.xml": PROP("P1") }, respond: answer(VALUES) });
    await expectProbe({ label: "property-with-spaces-name", config: cfg("", ['<itemtype name="Property "/>']), files: { "xml\\Property .xml": PROP("P1") }, respond: answer(VALUES) });
    await expectProbe({ label: "foo-type-never-asks", config: cfg("", [it1]), files: { "xml\\Foo.xml": row("Foo", "A1") }, respond: answer(VALUES) });
  });
});

describe("14.35: the server version decides whether it asks (LP-040)", () => {
  const versions: Array<[number, number, number, number, number]> = [
    [11, 0, 0, 0, 0],
    [12, 0, 0, 0, 0],
    [13, 0, 0, 0, 0],
    [14, 0, 0, 0, 0],
    [14, 0, 21, 0, 0],
    [14, 0, 22, 0, 0],
    [14, 0, 0, 0, 22],
    [14, 0, 7, 0, 7],
    [14, 1, 0, 0, 0],
    [14, 35, 0, 0, 0],
    [15, 0, 0, 0, 0],
  ];
  it.each(versions)("version %s.%s.%s.%s.%s", (...version) => expectProbe(property(`version-${version.join(".")}`, answer(VALUES), PROP("P1"), version)));
});

describe("14.35: the version is read when the preprocessor is built (LP-029, LP-036)", () => {
  const base = { config: cfg("", [it1]), files: { "xml\\Foo.xml": row("Foo", "A1") }, respond: any };
  it("fails without a version, even for an empty path", async () => {
    await expectProbe({ ...base, label: "no-version-with-a-pack", version: "none" });
    await expectProbe({ ...base, label: "no-version-with-an-empty-lp-path", version: "none", lpPath: "" });
  });
  it("does nothing for an empty path when there is a version", () => expectProbe({ ...base, label: "version-with-an-empty-lp-path", lpPath: "" }));
});
