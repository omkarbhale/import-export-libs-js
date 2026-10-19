import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { StubConnection, stubResult } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import { dotNetTypeName } from "../language-pack/exception-text.js";
import { esc } from "../language-pack/probe-harness.js";
import { loadXml } from "../xml/parser.js";
import { outerXml } from "../xml/writer-legacy.js";
import { ImportLookups } from "./import-lookups.js";

/**
 * The language-pack branch of `CImportItems.Import` (LP-040 to LP-044), against the cases of
 * `fixtures/import-languages/14.35/probes/06-null-values.out`: the real 14.35 `CItemHelper.doImport` run over a model server for a
 * generated `Property` item. Each case runs the same item against the same scripted answers and server version, and must send the same
 * requests in the same order, end the same way and leave the same document.
 */

const OUT = readFileSync(new URL("../../fixtures/import-languages/14.35/probes/06-null-values.out", import.meta.url), "utf8");

const SECTIONS = new Map<string, string[]>();
{
  let current: string[] | undefined;
  for (const line of OUT.split("\n")) {
    if (line.startsWith("## ")) SECTIONS.set(line.slice(3), (current = []));
    else if (line.startsWith("#### ")) current = undefined;
    else if (current !== undefined && line !== "") current.push(line);
  }
}

/** The probe's fault envelope: no detail, a plain faultstring. */
const stubFault = (code: string, text: string): string =>
  `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault xmlns:af="http://www.aras.com/InnovatorFault"><faultcode>${code}</faultcode><faultstring>${text}</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const I18N = 'xmlns:i18n="http://www.aras.com/I18N"';
const label = (lang: string, text: string): string => `<i18n:label ${I18N} xml:lang="${lang}">${text}</i18n:label>`;
const propItem = (children: string, attrs = ' context_action="lpimport"', type = "Property"): string =>
  `<Item isNew="1" isTemp="1" type="${type}" action="edit" doGetItem="0"${attrs} where="[${type}].id='P1'">${children}</Item>`;
const propGet = (keyed: string): string => stubResult(`<Item type="Property" id="PROP1"><id>PROP1</id><keyed_name>${keyed}</keyed_name></Item>`);
const languages = (rows: Array<[string | null, string | null]>): string =>
  stubResult(
    rows
      .map(
        ([code, suffix], i) =>
          `<Item type="Language" id="LANG${i + 1}">${code === null ? "" : `<code>${code}</code>`}<name></name>${suffix === null ? "" : `<suffix>${suffix}</suffix>`}</Item>`,
      )
      .join(""),
  );
const DEFAULT_LANGUAGES = languages([
  ["en", ""],
  ["de", "_de"],
  ["fr", "_fr"],
]);

const lbl2 = label("de", "Etikett") + label("fr", "Libelle");
const std = propItem(`<default_value>dv</default_value>${lbl2}`);

interface Run {
  label: string;
  xml: string;
  propAnswer: string;
  langAnswer?: string;
  version?: [number, number, number, number, number];
  batch?: boolean;
  merge?: boolean;
  sqlFault?: boolean;
}

/** The lines the script prints for one run. */
async function lines(run: Run): Promise<{ lines: string[]; thrown: unknown }> {
  const connection = new StubConnection((request, action) => {
    if (action === "ApplySQL" && run.sqlFault) return stubFault("5", "sql boom");
    if (/type="Language".*action="get"/.test(request)) return run.langAnswer ?? DEFAULT_LANGUAGES;
    if (/type="Property".*action="get".*select="id\[is_not_null\(\)\]/.test(request)) return run.propAnswer;
    if (/select="is_versionable"/.test(request)) return stubResult('<Item type="ItemType" id="IT"><is_versionable>0</is_versionable></Item>');
    return stubResult(`<Item type="${/type="([^"]*)"/.exec(request)?.[1] ?? ""}" id="GEN"/>`);
  });
  const helper = new CItemHelper(connection, { engine: "14.35" });
  helper.innovatorVersion = new ArasVersion(...(run.version ?? [12, 0, 9, 24090, 0]));
  const document = loadXml(run.xml, { preserveWhitespace: false });
  const out: string[] = [];
  let thrown: unknown;
  try {
    await new ImportLookups(helper).doImport(document, run.merge ?? false, run.batch ?? false);
    out.push("doImport => ok");
  } catch (error) {
    thrown = error;
    out.push(`doImport => ${dotNetTypeName(error)}: ${esc((error as Error).message)}`);
  }
  connection.requests.forEach((request, i) => out.push(`request ${i + 1} [${connection.actions[i]}] => ${esc(request)}`));
  out.push(`document after => ${esc(outerXml(document))}`);
  return { lines: out, thrown };
}

/** The engine prints the fault block and the inner exception after an exception; the type and message are compared, and the rest asserted. */
const headOf = (line: string): string => line.replace(/ \[faultcode=.*$/, "");

async function runProbe(run: Run): Promise<unknown> {
  const expected = SECTIONS.get(run.label);
  if (expected === undefined) throw new Error(`the probe has no case ${run.label}`);
  const { lines: actual, thrown } = await lines(run);
  expect(actual.map(headOf), run.label).toEqual(expected.filter((line) => !line.startsWith("    inner ")).map(headOf));
  return thrown;
}

async function expectProbe(run: Run): Promise<void> {
  await runProbe(run);
}

describe("a generated Property item for a system property goes by SQL (LP-042, LP-043)", () => {
  it.each([
    { label: "source-id-goes-by-sql", xml: std, propAnswer: propGet("source_id") },
    { label: "related-id-goes-by-sql", xml: std, propAnswer: propGet("related_id") },
    { label: "other-property-goes-by-aml", xml: std, propAnswer: propGet("label") },
    { label: "keyed-name-compared-ordinal", xml: std, propAnswer: propGet("Source_Id") },
    { label: "property-get-no-keyed-name", xml: std, propAnswer: stubResult('<Item type="Property" id="PROP1"><id>PROP1</id></Item>') },
    { label: "merge-mode-edit-item", xml: std, propAnswer: propGet("source_id"), merge: true },
    { label: "batch-mode-sql-still-sent", xml: std, propAnswer: propGet("source_id"), batch: true },
    { label: "batch-mode-other-property-not-sent", xml: std, propAnswer: propGet("label"), batch: true },
  ] satisfies Run[])("$label", expectProbe);

  it.each([
    { label: "value-with-quote-amp-lt", xml: propItem(label("de", "O'Brien &amp; &lt;b&gt; N'x")), propAnswer: propGet("source_id") },
    { label: "value-non-ascii", xml: propItem(label("de", "étiquette")), propAnswer: propGet("source_id") },
    { label: "value-empty", xml: propItem(label("de", "") + label("fr", "x")), propAnswer: propGet("source_id") },
    { label: "child-without-prefix", xml: propItem('<label xml:lang="de">plain</label>'), propAnswer: propGet("source_id") },
    { label: "child-with-other-prefix", xml: propItem('<x:label xmlns:x="urn:x" xml:lang="de">other</x:label>'), propAnswer: propGet("source_id") },
    { label: "only-plain-children-nothing-is-sent", xml: propItem("<default_value>dv</default_value><data_type>string</data_type>"), propAnswer: propGet("source_id") },
    { label: "empty-lang-attribute-skipped", xml: propItem(`<label xml:lang="">x</label>${label("de", "y")}`), propAnswer: propGet("source_id") },
    { label: "element-with-nested-markup", xml: propItem(`<i18n:label ${I18N} xml:lang="de">a<b>b</b>c</i18n:label>`), propAnswer: propGet("source_id") },
  ] satisfies Run[])("writes the column of each child element: $label (LP-043, LP-044)", expectProbe);

  it("stops at a child that is not an element (text-child-in-the-item, comment-child-in-the-item)", async () => {
    await expectProbe({ label: "text-child-in-the-item", xml: propItem(`text<default_value>dv</default_value>${lbl2}`), propAnswer: propGet("source_id") });
    await expectProbe({ label: "comment-child-in-the-item", xml: propItem(`<!--c-->${lbl2}`), propAnswer: propGet("source_id") });
  });
});

describe("the lookups and their failures (LP-041, LP-043)", () => {
  it.each([
    { label: "property-get-no-items", xml: std, propAnswer: stubFault("0", "No items of type Property found.") },
    {
      label: "property-get-two-items",
      xml: std,
      propAnswer: stubResult('<Item type="Property" id="A"><keyed_name>source_id</keyed_name></Item><Item type="Property" id="B"><keyed_name>source_id</keyed_name></Item>'),
    },
    { label: "language-not-in-the-answer", xml: propItem(label("es", "Etiqueta")), propAnswer: propGet("source_id") },
    { label: "language-get-no-items", xml: std, propAnswer: propGet("source_id"), langAnswer: stubFault("0", "No items of type Language found.") },
    {
      label: "language-get-duplicate-code",
      xml: std,
      propAnswer: propGet("source_id"),
      langAnswer: languages([
        ["de", "_de"],
        ["de", "_x"],
        ["fr", "_fr"],
      ]),
    },
    {
      label: "language-get-item-without-code",
      xml: std,
      propAnswer: propGet("source_id"),
      langAnswer: languages([
        [null, "_x"],
        ["de", "_de"],
        ["fr", "_fr"],
      ]),
    },
    {
      label: "language-get-item-without-suffix",
      xml: std,
      propAnswer: propGet("source_id"),
      langAnswer: languages([
        ["de", null],
        ["fr", "_fr"],
      ]),
    },
    { label: "language-get-uppercase-code", xml: propItem(label("de", "x")), propAnswer: propGet("source_id"), langAnswer: languages([["DE", "_de"]]) },
  ] satisfies Run[])("$label", expectProbe);

  it("throws the server's fault of the Property get and of the Language get when it is not faultcode 0", async () => {
    const property = await runProbe({ label: "property-get-other-fault", xml: std, propAnswer: stubFault("5", "boom") });
    expect(property).toBeInstanceOf(CItemException);
    expect((property as CItemException).faultcode).toBe(5);
    const language = await runProbe({ label: "language-get-other-fault", xml: std, propAnswer: propGet("source_id"), langAnswer: stubFault("5", "boom") });
    expect((language as CItemException).faultcode).toBe(5);
  });

  it("wraps the failure of the SQL update, whose text the engine loads as XML to indent it (sql-fault)", async () => {
    const thrown = await runProbe({ label: "sql-fault", xml: std, propAnswer: propGet("source_id"), sqlFault: true });
    expect(thrown).toBeInstanceOf(CItemException);
    expect((thrown as CItemException).faultcode).toBe(-1);
    expect((thrown as CItemException).message).toBe("Data at the root level is invalid. Line 2, position 5. Can't merge item [Property].id='P1' Property");
  });
});

describe("what the version and the item type decide (LP-040, LP-042)", () => {
  it.each([
    { label: "version-14-35-keeps-context-action", xml: std, propAnswer: propGet("source_id"), version: [14, 35, 0, 0, 0] },
    { label: "version-14-0-sp22-keeps-context-action", xml: std, propAnswer: propGet("source_id"), version: [14, 0, 22, 0, 0] },
    { label: "version-14-0-sp21-handles", xml: std, propAnswer: propGet("source_id"), version: [14, 0, 21, 0, 0] },
    { label: "version-14-0-service-update-22-handles", xml: std, propAnswer: propGet("source_id"), version: [14, 0, 0, 0, 22] },
    { label: "other-type-keeps-context-action", xml: propItem(lbl2, ' context_action="lpimport"', "Foo"), propAnswer: propGet("source_id") },
    { label: "property-without-context-action", xml: propItem(lbl2, ""), propAnswer: propGet("source_id") },
    { label: "context-action-other-value", xml: propItem(lbl2, ' context_action="x"'), propAnswer: propGet("source_id") },
    { label: "context-action-case", xml: propItem(lbl2, ' context_action="LPIMPORT"'), propAnswer: propGet("source_id") },
    { label: "lowercase-type-property", xml: propItem(lbl2, ' context_action="lpimport"', "property"), propAnswer: propGet("source_id") },
  ] satisfies Run[])("$label", expectProbe);
});
