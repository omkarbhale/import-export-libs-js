import { describe, expect, it } from "vitest";
import { loadXml } from "../xml/parser.js";
import { documentElementOf } from "../xml/dom.js";
import { CItemHelper } from "./item-helper.js";
import { type ProbedException, describeException, loadProbe } from "./probe-fixture.js";
import { StubConnection, stubFault, stubResult } from "./stub-connection.js";
import { ArasVersion } from "./version.js";
import { ResponseDocument } from "./fault.js";
import { independentRelatedItems } from "./item-lookups.js";

const probe = loadProbe("14.0.7");

/** `New-Helper` of the probe: a helper over a stub, with the server version `Login` would have set. */
const helperOver = (respond: (request: string) => string | undefined) => {
  const stub = new StubConnection(respond);
  const helper = new CItemHelper(stub);
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

describe("IsVersionable and the metadata lookup (EXP-010, EXP-030, EXP-031, EXP-032)", () => {
  it("caches an answer by its text, per helper (E.isVersionableCache, E.cachePerHelper)", async () => {
    const { stub, lookups } = helperOver(() => stubResult('<Item type="ItemType" id="X"><is_versionable>1</is_versionable></Item>'));
    expect([await lookups.isVersionable("Part"), await lookups.isVersionable("Part"), await lookups.isVersionable("Document")]).toEqual(
      probe["E.isVersionableCache"].results,
    );
    expect(stub.requests).toEqual(probe["E.isVersionableCache"].requests);

    const shared = new StubConnection(() => stubResult('<Item type="ItemType" id="X"><is_versionable>0</is_versionable></Item>'));
    const one = new CItemHelper(shared).lookups;
    const two = new CItemHelper(shared).lookups;
    await one.isVersionable("Part");
    await two.isVersionable("Part");
    await one.isVersionable("Part");
    expect(shared.requests).toHaveLength(probe["E.cachePerHelper"].requestCount);
  });

  it.each([
    ["E.isVersionableUnknownType", "0", "No items of type ItemType found."],
    ["E.isVersionableServerError", "999", "boom"],
  ])("never caches a fault, and names the wrong type in the detail of 'no items' (%s)", async (name, code, text) => {
    const { stub, lookups } = helperOver(() => stubFault(code, text));
    const errors = [];
    for (let i = 0; i < 2; i += 1) errors.push((await outcome(() => lookups.isVersionable("Nope"))).thrown);
    expect(errors).toEqual(probe[name].errors);
    expect(stub.requests).toEqual(probe[name].requests);
  });

  it("reads is_versionable as exactly 1 (E.isVersionableValues)", async () => {
    const values = probe["E.isVersionableValues"];
    for (const text of ["1", "0", "", "true", " 1"]) {
      const { lookups } = helperOver(() => stubResult(`<Item type="ItemType" id="X"><is_versionable>${text}</is_versionable></Item>`));
      expect(await lookups.isVersionable("Part")).toBe(values[`[${text}]`]);
    }
    const absent = helperOver(() => stubResult('<Item type="ItemType" id="X"><name>Part</name></Item>'));
    expect((await outcome(() => absent.lookups.isVersionable("Part"))).thrown).toEqual(values.absent);
    const two = helperOver(() =>
      stubResult('<Item type="ItemType" id="X"><is_versionable>1</is_versionable></Item><Item type="ItemType" id="Y"><is_versionable>0</is_versionable></Item>'),
    );
    expect(await two.lookups.isVersionable("Part")).toBe(values.twoItems);
  });

  it("refuses a name that does not make well-formed XML, before sending anything (EXP-004)", async () => {
    const { stub, lookups } = helperOver(() => stubResult("<Item />"));
    const thrown = (await outcome(() => lookups.isVersionable("Part & Co"))).thrown;
    expect(thrown).toMatchObject({ type: "System.Xml.XmlException", message: "An error occurred while parsing EntityName. Line 1, position 72." });
    expect(stub.requests).toEqual([]);
  });
});

describe("GetCurrentIdOfVersion (EXP-011, F.getCurrentIdOfVersion)", () => {
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

  it.each(Object.keys(probe["F.getCurrentIdOfVersion"]))("%s", async (mode) => {
    const expected = probe["F.getCurrentIdOfVersion"][mode];
    const { stub, lookups } = helperOver(answerFor(mode));
    const { result, thrown } = await outcome(() => lookups.getCurrentIdOfVersion("OLD", "Part"));
    expect(result ?? null).toEqual(expected.result);
    expect(thrown).toEqual(expected.thrown);
    expect(stub.requests).toEqual(expected.requests);
  });

  it("wraps an id that does not make well-formed XML, sending nothing (EXP-004)", async () => {
    const { stub, lookups } = helperOver(() => stubResult("<Item />"));
    await expect(lookups.getCurrentIdOfVersion("A&B", "Part")).rejects.toMatchObject({
      faultcode: -1,
      faultstring: expect.stringMatching(/^System\.Xml\.XmlException: An error occurred while parsing EntityName\./),
      faultdetail: expect.stringMatching(/^An error occurred while parsing EntityName\. Line 1, position \d+\.Unable to find a current version of the item \(ID='A&B'; Type='Part'\)$/),
    });
    expect(stub.requests).toEqual([]);
  });

  it("keeps the original's stack text in the faultstring of the wrapped exception (EXP-055)", async () => {
    const { lookups } = helperOver(answerFor("missing"));
    await expect(lookups.getCurrentIdOfVersion("OLD", "Part")).rejects.toMatchObject({
      faultcode: -1,
      faultstring: expect.stringContaining("Aras.Tools.SolutionUpgrade.CItemException: Server error"),
      faultdetail: expect.stringMatching(/Unable to find a current version of the item \(ID='OLD'; Type='Part'\)$/),
    });
  });
});

describe("GetItemType by name: the default permission (EXP-045, G.getItemTypeCache)", () => {
  it("gives null for any CItemException, caches only successes", async () => {
    const { stub, lookups } = helperOver((request) => {
      if (request.includes(">Nope<")) return stubFault("0", "No items");
      if (request.includes(">Boom<")) return stubFault("999", "boom");
      return stubResult('<Item type="ItemType" id="X"><id>X</id><is_relationship>0</is_relationship></Item>');
    });
    const results = [];
    for (const name of ["Part", "Part", "Nope", "Nope", "Boom", "Boom"]) {
      results.push((await lookups.getItemTypeWithDefaultPermission(name)) === null ? "null" : "doc");
    }
    expect(results).toEqual(probe["G.getItemTypeCache"].results);
    expect(stub.requests).toEqual(probe["G.getItemTypeCache"].requests);
  });
});

describe("getDepencyLevel (EXP-043, H.*)", () => {
  it("follows source_id until an answer has none", async () => {
    const { stub, lookups } = helperOver((request) => {
      if (request.includes(">T1<")) return stubResult('<Item type="RelationshipType" id="R1"><source_id>T2</source_id></Item>');
      if (request.includes(">T2<")) return stubResult('<Item type="RelationshipType" id="R2"><source_id>T3</source_id></Item>');
      return stubFault("0", "No items");
    });
    expect(await lookups.getDepencyLevel("T1", 0)).toBe(probe["H.getDepencyLevel"].level);
    expect(stub.requests).toEqual(probe["H.getDepencyLevel"].requests);
  });

  it("returns the level it was given when the first request faults", async () => {
    const { stub, lookups } = helperOver(() => stubFault("999", "boom"));
    expect(await lookups.getDepencyLevel("T1", 5)).toBe(probe["H.getDepencyLevelError"].level);
    expect(stub.requests).toEqual(probe["H.getDepencyLevelError"].requests);
  });

  it("turns an answer that is not XML into a CItemException -1 with the exception's message and nothing after it", async () => {
    const { lookups } = helperOver(() => "Internal Server Error");
    await expect(lookups.getDepencyLevel("T1", 0)).rejects.toMatchObject({
      faultcode: -1,
      message: "Data at the root level is invalid. Line 1, position 1.",
      faultdetail: "Data at the root level is invalid. Line 1, position 1.",
    });
  });
});

describe("GetCurrentIdByUniqueKey (EXP-041, I.getCurrentIdByUniqueKey, Q.uniqueKey.*)", () => {
  const item = (xml: string) => documentElementOf(loadXml(xml, { preserveWhitespace: false }))!;
  const keyedRows =
    '<Item type="ItemType" id="IT"><Relationships><Item type="Property" id="P1"><name>item_number</name></Item><Item type="Property" id="P2"><name>major_rev</name></Item></Relationships></Item>';

  it("asks for the keyed properties once and the item every time", async () => {
    const { stub, lookups } = helperOver((request) =>
      request.includes("<is_keyed>1</is_keyed>") ? stubResult(keyedRows) : stubResult('<Item type="Part" id="CUR"><id>CUR</id></Item>'),
    );
    const part = item('<Item type="Part" id="X"><item_number>P1</item_number><major_rev>A</major_rev></Item>');
    expect([await lookups.getCurrentIdByUniqueKey(part, true), await lookups.getCurrentIdByUniqueKey(part, true)]).toEqual(
      probe["I.getCurrentIdByUniqueKey"].results,
    );
    expect(stub.requests).toEqual(probe["I.getCurrentIdByUniqueKey"].requests);
  });

  const onePart = '<Item type="Part" id="X"><item_number>P1</item_number></Item>';
  const oneRow = '<Item type="ItemType" id="IT"><Relationships><Item type="Property" id="P1"><name>item_number</name></Item></Relationships></Item>';
  const modes: Record<string, (request: string) => string> = {
    noKeyedProperties: () => stubFault("0", "No items of type ItemType found."),
    propertiesError: () => stubFault("999", "boom"),
    noPropertyRows: () => stubResult('<Item type="ItemType" id="IT"><id>IT</id></Item>'),
    keyLookupFault: (r) => (r.includes("is_keyed") ? stubResult(oneRow) : stubFault("0", "No items")),
    keyLookupNoId: (r) => (r.includes("is_keyed") ? stubResult(oneRow) : stubResult('<Item type="Part"><id>Z</id></Item>')),
    propertyWithoutName: () => stubResult('<Item type="ItemType" id="IT"><Relationships><Item type="Property" id="P1" /></Relationships></Item>'),
  };

  it.each(Object.keys(modes))("%s", async (mode) => {
    const expected = probe["Q.configIdAndUniqueKey"][`uniqueKey.${mode}`];
    const { stub, lookups } = helperOver(modes[mode]!);
    const { result, thrown } = await outcome(() => lookups.getCurrentIdByUniqueKey(item(onePart), true));
    expect(result ?? null).toEqual(expected.result);
    expect(thrown).toEqual(expected.thrown);
    expect(stub.requests).toEqual(expected.requests);
  });

  it.each([
    ["noTypeAttribute", '<Item id="X"><item_number>P1</item_number></Item>'],
    ["blankTypeAttribute", '<Item type=" " id="X"><item_number>P1</item_number></Item>'],
  ])("%s", async (mode, xml) => {
    const { lookups } = helperOver(() => stubFault("0", "x"));
    const thrown = (await outcome(() => lookups.getCurrentIdByUniqueKey(item(xml), true))).thrown;
    expect(thrown).toEqual(probe["Q.configIdAndUniqueKey"][`uniqueKey.${mode}`].thrown);
  });

  it("leaves out a keyed property the item lacks unless asked to throw (EXP-041 step 2)", async () => {
    const answer = (request: string) => (request.includes("is_keyed") ? stubResult(keyedRows) : stubResult('<Item type="Part" id="FOUND" />'));
    const lenient = helperOver(answer);
    expect(await lenient.lookups.getCurrentIdByUniqueKey(item(onePart), false)).toBe("FOUND");
    expect(lenient.stub.requests[1]).toBe('<Item type="Part" action="get" select="id"><item_number>P1</item_number></Item>');

    const strict = helperOver(answer);
    await expect(strict.lookups.getCurrentIdByUniqueKey(item(onePart), true)).rejects.toMatchObject({
      faultcode: -1,
      message: "Property major_rev that is part of the unique key for type Part is not part of the response",
    });
  });

  it("does not cache a fault of the keyed-properties request, so the next call asks again", async () => {
    const { stub, lookups } = helperOver(() => stubFault("999", "boom"));
    await outcome(() => lookups.getCurrentIdByUniqueKey(item(onePart), true));
    await outcome(() => lookups.getCurrentIdByUniqueKey(item(onePart), true));
    expect(stub.requests).toHaveLength(2);
  });
});

describe("GetConfigId (EXP-042, Q.getConfigId.*)", () => {
  const modes: Record<string, string> = {
    ok: stubResult('<Item type="Part" id="I1"><config_id>CFG9</config_id></Item>'),
    noProperty: stubResult('<Item type="Part" id="I1"><id>I1</id></Item>'),
    emptyProperty: stubResult('<Item type="Part" id="I1"><config_id></config_id></Item>'),
    fault0: stubFault("0", "No items of type Part found."),
    fault999: stubFault("999", "boom"),
  };

  it.each(Object.keys(modes))("%s", async (mode) => {
    const expected = probe["Q.configIdAndUniqueKey"][`getConfigId.${mode}`];
    const { stub, lookups } = helperOver(() => modes[mode]);
    const { result, thrown } = await outcome(() => lookups.getConfigId("ID7", "Part"));
    expect(result ?? null).toEqual(expected.result);
    expect(thrown).toEqual(expected.thrown);
    expect(stub.requests).toEqual(expected.requests);
  });
});

describe("GetCustomFloatPropertiesOfTypeItem (EXP-044, I.floatProperties*, R.floatProperties)", () => {
  const typeNames = (requests: string[]) => requests.map((request) => /<name>([^<]*)<\/name>/.exec(request)?.[1]);

  it("asks again after 'no items', because it is not cached", async () => {
    const { stub, lookups } = helperOver(() => stubFault("0", "No items of type ItemType found."));
    for (const type of ["List", "Value", "Value", "Value"]) expect(await lookups.getCustomFloatPropertiesOfTypeItem(type)).toEqual([]);
    expect(stub.requests).toHaveLength(probe["I.floatPropertiesFault0NotCached"].requestCount);
    expect(typeNames(stub.requests)).toEqual(probe["I.floatPropertiesFault0NotCached"].typeNames);
  });

  it("caches a success", async () => {
    const { stub, lookups } = helperOver(() => stubResult('<Item type="ItemType" id="IT"><Relationships /></Item>'));
    for (const type of ["List", "Value", "Value", "Value"]) await lookups.getCustomFloatPropertiesOfTypeItem(type);
    expect(stub.requests).toHaveLength(probe["R.floatProperties"].floatPropertiesSuccessCached.requestCount);
    expect(typeNames(stub.requests)).toEqual(probe["R.floatProperties"].floatPropertiesSuccessCached.typeNames);
  });

  it("wraps any other failure, a CItemException included, and stops", async () => {
    const { stub, lookups } = helperOver(() => stubFault("999", "boom"));
    const thrown = (await outcome(() => lookups.getCustomFloatPropertiesOfTypeItem("List"))).thrown;
    expect(thrown).toEqual(probe["R.floatProperties"].floatPropertiesServerError.thrown);
    expect(stub.requests).toHaveLength(probe["R.floatProperties"].floatPropertiesServerError.requestCount);
  });

  it("returns the property rows of the answer", async () => {
    const { lookups } = helperOver(() =>
      stubResult(
        '<Item type="ItemType" id="IT"><Relationships><Item type="Property" id="P1"><name>a</name></Item><Item type="Property" id="P2"><name>b</name></Item></Relationships></Item>',
      ),
    );
    const rows = await lookups.getCustomFloatPropertiesOfTypeItem("Part");
    expect(rows.map((row) => row.attributes.find((a) => a.name === "id")?.value)).toEqual(["P1", "P2"]);
  });

  it("states the closing quote of the failure text, which 12.0 lacks", async () => {
    const { lookups } = helperOver(() => stubFault("999", "boom"));
    await expect(lookups.getCustomFloatPropertiesOfTypeItem("List")).rejects.toMatchObject({
      faultdetail: expect.stringMatching(/Failed to process properties of type 'Item' for ItemType 'List'$/),
    });
  });
});

describe("GetPolytypeNames (EXP-046, EXP-047, I.polytypeNamesLatch)", () => {
  it("asks once, reads every name, and keeps an empty list after a failure", async () => {
    const names = helperOver(() => stubResult('<Item type="ItemType" id="A"><name>Document</name></Item><Item type="ItemType" id="B"><name>Part</name></Item>'));
    expect(await names.lookups.getPolytypeNames()).toEqual(["Document", "Part"]);
    expect(await names.lookups.getPolytypeNames()).toEqual(["Document", "Part"]);
    expect(names.stub.requests).toHaveLength(1);

    const shared = new StubConnection(() => stubFault("999", "boom"));
    const first = new CItemHelper(shared);
    const expected = probe["I.polytypeNamesLatch"];
    expect((await outcome(() => first.lookups.getPolytypeNames())).thrown).toEqual(expected.first);
    expect(await first.lookups.getPolytypeNames()).toEqual([]);
    expect(shared.requests).toHaveLength(expected.requestsAfterTwoCalls);
    expect((await outcome(() => new CItemHelper(shared).lookups.getPolytypeNames())).thrown).toEqual(expected.thirdOnNewHelper);
    expect(shared.requests).toHaveLength(expected.requestsAfterThree);
  });

  it("keeps an empty list for 'no items'", async () => {
    const { lookups } = helperOver(() => stubFault("0", "No items of type ItemType found."));
    expect(await lookups.getPolytypeNames()).toEqual([]);
  });
});

describe("the related items of an answer and their metadata (EXP-040)", () => {
  const answer = ResponseDocument.parse(
    stubResult(
      '<Item type="ItemType" id="IT"><Relationships>' +
        '<Item type="View" id="V1"><related_id type="Form"><Item type="Form" id="F1"><Relationships><Item type="Body" id="B1"><related_id type="Item Type"><Item type="Item Type" id="IGNORED" /></related_id></Item></Relationships></Item></related_id></Item>' +
        '<Item type="ITPresentationConfiguration" id="V2"><related_id type="Form"><Item type="Form" id="F2" /></related_id></Item>' +
        '<Item type="TOC Access" id="V3"><related_id type="Identity"><Item type="Identity" id="I1" /></related_id></Item>' +
        '<Item type="Can Add" id="V4"><related_id type="Method"><Item type="Method" id="M1" /></related_id></Item>' +
        '<Item type="Allowed Permission" id="V5"><related_id type="Permission"><Item type="Permission" id="" /></related_id></Item>' +
        '<Item type="Allowed Permission" id="V6"><related_id type="Permission">P1</related_id></Item>' +
        '<Item type="Property" id="V7"><related_id type="Permission"><Item type="Permission" id="P2" /></related_id></Item>' +
        "</Relationships></Item>",
    ),
  );

  it("selects the related items with an id, except the skipped types, in document order", () => {
    expect(independentRelatedItems(answer)).toEqual([
      { relatedItemType: "Form", relationshipType: "View" },
      { relatedItemType: "Item Type", relationshipType: "Body" },
      { relatedItemType: "Permission", relationshipType: "Property" },
    ]);
  });

  it("asks for the related type's flags, and for the relationship's behaviour only when it is not dependent", async () => {
    const dependent = helperOver(() => stubResult('<Item type="ItemType" id="X"><is_dependent>1</is_dependent><is_versionable>0</is_versionable></Item>'));
    expect(await dependent.lookups.relatedItemMetadata({ relatedItemType: "Form", relationshipType: "View" })).toMatchObject({ isDependent: true });
    expect(dependent.stub.requests).toEqual(["<Item type=\"ItemType\" select=\"is_dependent, is_versionable\" action=\"get\"><name>Form</name></Item>"]);

    const independent = helperOver((request) =>
      request.includes('type="ItemType"')
        ? stubResult('<Item type="ItemType" id="X"><is_dependent>0</is_dependent></Item>')
        : stubResult('<Item type="RelationshipType" id="R"><behavior>float</behavior></Item>'),
    );
    expect(await independent.lookups.relatedItemMetadata({ relatedItemType: "Form", relationshipType: "View" })).toMatchObject({
      isDependent: false,
      behavior: "float",
    });
    expect(independent.stub.requests[1]).toBe('<Item type="RelationshipType" select="behavior" action="get"><name>View</name></Item>');
  });

  it("is a NullReferenceException when an answer lacks the flag it is read for", async () => {
    const noFlag = helperOver(() => stubResult('<Item type="ItemType" id="X"><name>Form</name></Item>'));
    expect((await outcome(() => noFlag.lookups.relatedItemMetadata({ relatedItemType: "Form", relationshipType: "View" }))).thrown?.type).toBe(
      "System.NullReferenceException",
    );
    const noBehavior = helperOver((request) =>
      request.includes('type="ItemType"')
        ? stubResult('<Item type="ItemType" id="X"><is_dependent>0</is_dependent></Item>')
        : stubResult('<Item type="RelationshipType" id="R" />'),
    );
    expect((await outcome(() => noBehavior.lookups.relatedItemMetadata({ relatedItemType: "Form", relationshipType: "View" }))).thrown?.type).toBe(
      "System.NullReferenceException",
    );
  });
});
