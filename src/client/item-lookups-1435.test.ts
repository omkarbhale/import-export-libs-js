import { describe, expect, it } from "vitest";
import { replaceReferencesToPolyLists } from "../export/post-xsl.js";
import { documentElementOf } from "../xml/dom.js";
import { loadXml } from "../xml/parser.js";
import { CItemHelper } from "./item-helper.js";
import { type ProbedException, describeException, loadProbe } from "./probe-fixture.js";
import { StubConnection, stubFault, stubResult } from "./stub-connection.js";
import { ArasVersion } from "./version.js";

/**
 * The lookups of 14.35 and the cache they share (EXP-030, EXP-031, EXP-041, EXP-044, EXP-045, EXP-046, EXP-064), replayed from the 14.35
 * request probe (`H.*`, `F.getCurrentIdOfVersion`, `Q.*`): `_requestedItems` holds `Lazy` values, a refused metadata lookup is sent
 * again, and the other lookups keep a failure as EXP-064 says.
 */
const probe = loadProbe("14.35");

const helperOver = (respond: (request: string) => string | undefined) => {
  const stub = new StubConnection(respond);
  const helper = new CItemHelper(stub, { engine: "14.35" });
  helper.innovatorVersion = new ArasVersion(14, 0, 9, 1, 0);
  return { stub, helper, lookups: helper.lookups };
};

const outcome = async <T>(work: () => Promise<T>): Promise<{ result?: T; thrown: ProbedException | null }> => {
  try {
    return { result: await work(), thrown: null };
  } catch (error) {
    return { thrown: describeException(error) };
  }
};

const item = (xml: string) => documentElementOf(loadXml(xml, { preserveWhitespace: false }))!;

describe("the metadata lookup keeps a success and drops a refusal (EXP-030, EXP-031, EXP-032)", () => {
  it("caches an answer by its text (H.isVersionableCache)", async () => {
    const { stub, lookups } = helperOver(() => stubResult('<Item type="ItemType" id="X"><is_versionable>1</is_versionable></Item>'));
    expect([await lookups.isVersionable("Part"), await lookups.isVersionable("Part"), await lookups.isVersionable("Document")]).toEqual(
      probe["H.isVersionableCache"].results,
    );
    expect(stub.requests).toEqual(probe["H.isVersionableCache"].requests);
  });

  it.each([
    ["H.isVersionableFault0", "0", "No items of type ItemType found."],
    ["H.isVersionableFault999", "999", "No items of type ItemType found."],
  ])("sends a refused lookup again, with the wrong type in the detail of 'no items' (%s)", async (name, code, text) => {
    const { stub, lookups } = helperOver(() => stubFault(code, text));
    const errors = [];
    for (let i = 0; i < 2; i += 1) errors.push((await outcome(() => lookups.isVersionable("Nope"))).thrown);
    expect(errors).toEqual(probe[name].errors);
    expect(stub.requests).toEqual(probe[name].requests);
  });

  it("keeps an exception that is not a CItemException, so a text that does not parse is not parsed again", async () => {
    const { stub, lookups } = helperOver(() => stubResult("<Item />"));
    const first = (await outcome(() => lookups.isVersionable("Part & Co"))).thrown;
    const second = (await outcome(() => lookups.isVersionable("Part & Co"))).thrown;
    expect(first).toMatchObject({ type: "System.Xml.XmlException" });
    expect(second).toEqual(first);
    expect(stub.requests).toEqual([]);
  });

  it("reads is_versionable as exactly 1 (E.isVersionableValues)", async () => {
    const values = probe["E.isVersionableValues"];
    for (const text of ["1", "0", "", "true", " 1"]) {
      const { lookups } = helperOver(() => stubResult(`<Item type="ItemType" id="X"><is_versionable>${text}</is_versionable></Item>`));
      expect(await lookups.isVersionable("Part")).toBe(values[`[${text}]`]);
    }
  });
});

describe("the default permission lookup keeps its null (EXP-045, H.getItemTypeCache)", () => {
  it("asks once per type, whatever the answer", async () => {
    const { stub, lookups } = helperOver((request) => {
      if (request.includes(">Nope<")) return stubFault("0", "No items");
      if (request.includes(">Boom<")) return stubFault("999", "boom");
      return stubResult('<Item type="ItemType" id="X"><id>X</id><is_relationship>0</is_relationship></Item>');
    });
    const results = [];
    for (const name of ["Part", "Part", "Nope", "Nope", "Boom", "Boom"]) {
      results.push((await lookups.getItemTypeWithDefaultPermission(name)) === null ? "null" : "doc");
    }
    expect(results).toEqual(probe["H.getItemTypeCache"].results);
    expect(stub.requests).toEqual(probe["H.getItemTypeCache"].requests);
  });
});

describe("the float properties lookup keeps its failure (EXP-044, H.floatProperties*)", () => {
  const list = '<Item type="List" id="L"><Relationships><Item type="Value" id="V1" /><Item type="Value" id="V2" /><Item type="Value" id="V3" /></Relationships></Item>';

  it("keeps 'no items' as no rows (H.floatPropertiesFault0Cached)", async () => {
    const { stub, helper } = helperOver(() => stubFault("0", "No items of type ItemType found."));
    await helper.references.processPropertiesOfTypeItem(item(list));
    expect(stub.requests).toHaveLength(probe["H.floatPropertiesFault0Cached"].requestCount);
    expect(stub.requests.map((request) => /<name>([^<]*)<\/name>/.exec(request)?.[1])).toEqual(probe["H.floatPropertiesFault0Cached"].typeNames);
  });

  it("keeps another failure as the wrapped exception (H.floatPropertiesServerErrorCached)", async () => {
    const { stub, helper } = helperOver(() => stubFault("999", "boom"));
    const expected = probe["H.floatPropertiesServerErrorCached"];
    expect((await outcome(() => helper.references.processPropertiesOfTypeItem(item('<Item type="List" id="L" />')))).thrown).toEqual(expected.first);
    expect((await outcome(() => helper.references.processPropertiesOfTypeItem(item('<Item type="List" id="L" />')))).thrown).toEqual(expected.second);
    expect(stub.requests).toHaveLength(expected.requestCount);
  });

  it("caches a success (H.floatPropertiesSuccessCached)", async () => {
    const { stub, helper } = helperOver(() => stubResult('<Item type="ItemType" id="IT"><Relationships /></Item>'));
    await helper.references.processPropertiesOfTypeItem(item(list));
    expect(stub.requests).toHaveLength(probe["H.floatPropertiesSuccessCached"].requestCount);
  });
});

describe("the unique-key lookup keeps a fault of the keyed-properties request (EXP-041, H.uniquePropertiesCached)", () => {
  const part = '<Item type="Part" id="X"><item_number>P1</item_number></Item>';

  it.each(["propertiesError", "propertiesFault0", "ok"])("%s", async (mode) => {
    const { stub, lookups } = helperOver((request) => {
      if (request.includes("is_keyed")) {
        if (mode === "propertiesError") return stubFault("999", "boom");
        if (mode === "propertiesFault0") return stubFault("0", "No items of type ItemType found.");
        return stubResult('<Item type="ItemType" id="IT"><Relationships><Item type="Property" id="P1"><name>item_number</name></Item></Relationships></Item>');
      }
      return stubResult('<Item type="Part" id="CUR"><id>CUR</id></Item>');
    });
    const calls = [];
    for (let i = 0; i < 2; i += 1) {
      const { result, thrown } = await outcome(() => lookups.getCurrentIdByUniqueKey(item(part), true));
      calls.push({ result: result ?? null, thrown });
    }
    expect({ calls, requests: stub.requests }).toEqual(probe["H.uniquePropertiesCached"][mode]);
  });
});

describe("the poly-type names are asked once per helper (EXP-046, EXP-047, H.polytypeNamesLatch)", () => {
  it("throws the failure once and returns an empty list after it", async () => {
    const { stub, lookups } = helperOver(() => stubFault("999", "boom"));
    const doc = loadXml(
      '<AML><Item type="ItemType"><Relationships><Item type="Property"><data_type>list</data_type><data_source keyed_name="Z">Z</data_source></Item></Relationships></Item></AML>',
      { preserveWhitespace: true },
    );
    const expected = probe["H.polytypeNamesLatch"];
    expect((await outcome(() => replaceReferencesToPolyLists(doc, lookups))).thrown).toEqual(expected.first);
    expect((await outcome(() => replaceReferencesToPolyLists(doc, lookups))).thrown).toEqual(expected.second);
    expect(stub.requests).toHaveLength(expected.requestsAfterTwoCalls);
  });
});

describe("the lookups that did not change (F.getCurrentIdOfVersion, H.getDepencyLevel*, Q.configIdAndUniqueKey)", () => {
  const answerFor = (mode: string) => (request: string) => {
    if (request.includes('select="config_id, is_current"')) {
      switch (mode) {
        case "current":
          return stubResult('<Item type="Part" id="OLD"><config_id>CFG</config_id><is_current>1</is_current></Item>');
        case "old":
          return stubResult('<Item type="Part" id="OLD"><config_id>CFG</config_id><is_current>0</is_current></Item>');
        case "missing":
          return stubFault("0", "No items of type Part found.");
        case "error":
          return stubFault("999", "boom");
        case "nocfg":
          return stubResult('<Item type="Part" id="OLD"><is_current>0</is_current></Item>');
        case "noflag":
          return stubResult('<Item type="Part" id="OLD"><config_id>CFG</config_id></Item>');
        case "spaced":
          return stubResult('<Item type="Part" id="OLD"><config_id>CFG</config_id><is_current> 1</is_current></Item>');
      }
    }
    if (request.includes('select="id"') && request.includes("config_id")) {
      return mode === "missing" ? stubFault("0", "No items of type Part found.") : stubResult('<Item type="Part" id="NEW"><id>NEW</id></Item>');
    }
    return undefined;
  };

  it.each(Object.keys(probe["F.getCurrentIdOfVersion"]))("current id: %s", async (mode) => {
    const expected = probe["F.getCurrentIdOfVersion"][mode];
    const { stub, lookups } = helperOver(answerFor(mode));
    const { result, thrown } = await outcome(() => lookups.getCurrentIdOfVersion("OLD", "Part"));
    expect(result ?? null).toEqual(expected.result);
    expect(thrown).toEqual(expected.thrown);
    expect(stub.requests).toEqual(expected.requests);
  });

  it("follows source_id until an answer has none, and returns the level it was given on a fault", async () => {
    const chain = helperOver((request) => {
      if (request.includes(">T1<")) return stubResult('<Item type="RelationshipType" id="R1"><source_id>T2</source_id></Item>');
      if (request.includes(">T2<")) return stubResult('<Item type="RelationshipType" id="R2"><source_id>T3</source_id></Item>');
      return stubFault("0", "No items");
    });
    expect(await chain.lookups.getDepencyLevel("T1", 0)).toBe(probe["H.getDepencyLevel"].level);
    expect(chain.stub.requests).toEqual(probe["H.getDepencyLevel"].requests);
    const fault = helperOver(() => stubFault("999", "boom"));
    expect(await fault.lookups.getDepencyLevel("T1", 5)).toBe(probe["H.getDepencyLevelError"].level);
  });

  it.each(["ok", "noProperty", "emptyProperty", "fault0", "fault999"])("config id: %s", async (mode) => {
    const modes: Record<string, string> = {
      ok: stubResult('<Item type="Part" id="I1"><config_id>CFG9</config_id></Item>'),
      noProperty: stubResult('<Item type="Part" id="I1"><id>I1</id></Item>'),
      emptyProperty: stubResult('<Item type="Part" id="I1"><config_id></config_id></Item>'),
      fault0: stubFault("0", "No items of type Part found."),
      fault999: stubFault("999", "boom"),
    };
    const expected = probe["Q.configIdAndUniqueKey"][`getConfigId.${mode}`];
    const { stub, lookups } = helperOver(() => modes[mode]);
    const { result, thrown } = await outcome(() => lookups.getConfigId("ID7", "Part"));
    expect(result ?? null).toEqual(expected.result);
    expect(thrown).toEqual(expected.thrown);
    expect(stub.requests).toEqual(expected.requests);
  });
});
