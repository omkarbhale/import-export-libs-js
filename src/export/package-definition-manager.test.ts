import { describe, expect, it } from "vitest";
import { CItemHelper } from "../client/item-helper.js";
import { type ProbedException, describeException, loadProbe } from "../client/probe-fixture.js";
import { StubConnection, StubStop, stubFault, stubResult } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import { PackageDefinitionManager } from "./package-definition-manager.js";

const probe = loadProbe("14.0.7")["P.packageDefinitionManager"] as Record<
  string,
  { package: string; dependency: string; thrown: ProbedException | null; found: Array<{ keyedName: string; idName: string; typeName: string }> | null; requests: string[] }
>;

const definition = stubResult('<Item type="PackageDefinition" id="PD1"><id keyed_name="pkg" type="PackageDefinition">PD1</id><name>pkg</name></Item>');
const noItems = stubFault("0", "No items of type PackageDefinition found.");
const boom = stubFault("999", "boom");
const references = stubResult(
  '<Item type="PackageDependsOn" id="D1"><Relationships><Item type="PackageReferencedElement" id="E1"><element_id>EID1</element_id><element_type>Method</element_type><element_description>  desc one </element_description></Item><Item type="PackageReferencedElement" id="E2"><element_id>EID2</element_id><element_type>ItemType</element_type><element_description>   </element_description></Item></Relationships></Item>',
);
const withoutId = stubResult('<Item type="PackageDependsOn" id="D1"><Relationships><Item type="PackageReferencedElement" id="E1"><element_id> </element_id><element_type>Method</element_type></Item></Relationships></Item>');
const withoutType = stubResult('<Item type="PackageDependsOn" id="D1"><Relationships><Item type="PackageReferencedElement" id="E1"><element_id>EID1</element_id></Item></Relationships></Item>');

/** `Run-Pdm` of the probe: the answers in order, and a stop when they run out. */
async function run(name: string, answers: string[], dependency: string) {
  let next = 0;
  const stub = new StubConnection(() => answers[next++]);
  const helper = new CItemHelper(stub);
  helper.innovatorVersion = new ArasVersion(14, 0, 9, 1, 0);
  let thrown: ProbedException | null = null;
  let found: Array<{ keyedName: string; idName: string; typeName: string }> | null = null;
  try {
    const manager = await PackageDefinitionManager.open(helper, name);
    if (dependency) {
      found = (await manager.findReferencedElements(dependency)).map(({ keyedName, idName, typeName }) => ({ keyedName, idName, typeName }));
    }
  } catch (error) {
    if (!(error instanceof StubStop)) thrown = describeException(error);
  }
  return { thrown, found, requests: stub.requests };
}

describe("PackageDefinitionManager, replayed from the 14.0.7 probe (EXP-052, EXP-053)", () => {
  const scripts: Record<string, [string[], string]> = {
    initOk: [[definition], ""],
    initNotFound: [[noItems], ""],
    initServerError: [[boom], ""],
    initNoId: [[stubResult('<Item type="PackageDefinition" id="PD1"><name>pkg</name></Item>')], ""],
    refsOk: [[definition, references], "dep.one"],
    refsNone: [[definition, noItems], "dep.one"],
    refsServerError: [[definition, boom], "dep.one"],
    refsNoElementId: [[definition, withoutId], "dep.one"],
    refsNoElementType: [[definition, withoutType], "dep.one"],
    refsBadName: [[definition], "dep&one"],
  };

  it("has a script for every scenario of the probe", () => {
    expect(Object.keys(scripts).sort()).toEqual(Object.keys(probe).sort());
  });

  it.each(Object.keys(scripts))("%s", async (name) => {
    const [answers, dependency] = scripts[name]!;
    const expected = probe[name]!;
    const result = await run("pkg", answers, dependency);
    expect(result.requests).toEqual(expected.requests);
    expect(result.thrown).toEqual(expected.thrown);
    expect(result.found).toEqual(expected.found);
  });

  it("reads the package id from the first PackageDefinition item that has an id element", async () => {
    const stub = new StubConnection(() => stubResult('<Item type="Other"><id>X</id></Item><Item type="PackageDefinition" id="P"><id>P</id></Item>'));
    const helper = new CItemHelper(stub);
    expect((await PackageDefinitionManager.open(helper, "pkg")).id).toBe("P");
  });

  it("keeps the original message and adds the text to the detail only, for a CItemException", async () => {
    const result = await run("pkg", [definition, boom], "dep.one");
    expect(result.thrown?.faultdetail).toBe("boom Failed to find referenced elements for package 'pkg'");
    expect(result.thrown?.message).toMatch(/^Server error\r\n\r\nRequest: /);
  });
});
