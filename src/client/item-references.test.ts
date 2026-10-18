import { describe, expect, it } from "vitest";
import { loadXml, outerXml, selectSingleNode } from "../xml/index.js";
import type { XmlDocument, XmlElement } from "../xml/index.js";
import { CItemException } from "./fault.js";
import { CItemHelper } from "./item-helper.js";
import { isValueId } from "./item-references.js";
import { StubConnection, stubFault, stubResult } from "./stub-connection.js";
import { ArasVersion } from "./version.js";

/** A helper over a stub that answers a request with the first answer whose pattern the request contains. */
function over(answers: Array<[pattern: string, answer: string]>) {
  const stub = new StubConnection((request) => answers.find(([pattern]) => request.includes(pattern))?.[1]);
  const helper = new CItemHelper(stub);
  helper.innovatorVersion = new ArasVersion(14, 0, 9, 1, 0);
  return { stub, helper, references: helper.references };
}

const answer = (items: string): XmlDocument => loadXml(stubResult(items), { preserveWhitespace: true });
const result = (doc: XmlDocument): string => outerXml(selectSingleNode("//Result", doc) as XmlElement);
const failure = (work: () => Promise<unknown>): Promise<unknown> => work().then(() => undefined, (error: unknown) => error);

/** An ItemType answer for the lookup with this select. */
const itemType = (name: string, select: string, flags: string) =>
  [`select="${select}" action="get"><name>${name}</name>`, stubResult(`<Item type="ItemType" id="X">${flags}</Item>`)] as [string, string];
const independent = (name: string) => itemType(name, "is_dependent, is_versionable", "<is_dependent>0</is_dependent><is_versionable>0</is_versionable>");
const dependent = (name: string) => itemType(name, "is_dependent, is_versionable", "<is_dependent>1</is_dependent><is_versionable>0</is_versionable>");
const behavior = (name: string, value: string) => [`<name>${name}</name>`, stubResult(`<Item type="RelationshipType" id="R"><behavior>${value}</behavior></Item>`)] as [string, string];
const notVersionable = (name: string) => itemType(name, "is_versionable", "<is_versionable>0</is_versionable>");
const versionable = (name: string) => itemType(name, "is_versionable", "<is_versionable>1</is_versionable>");
const noItems = stubFault("0", "No items found.");

const related = (relationshipType: string, relatedType: string, inner: string) =>
  `<Item type="${relationshipType}" id="R-${relationshipType}"><related_id keyed_name="k" type="${relatedType}">${inner}</related_id></Item>`;
const full = (type: string, id: string, extra = "") => `<Item type="${type}" id="${id}">${extra}<name>n</name></Item>`;
const rootWith = (relationships: string) => answer(`<Item type="Root" id="ROOT"><Relationships>${relationships}</Relationships></Item>`);

describe("EXP-113: related items of independent ItemTypes are collapsed to their id", () => {
  it("replaces the related Item by its id, keeps the attributes of related_id, and looks the types up", async () => {
    const { stub, references } = over([independent("Part"), behavior("Part BOM", "hard")]);
    const doc = rootWith(related("Part BOM", "Part", full("Part", "P1")));
    await references.processIndependentRelatedItems(doc);
    expect(result(doc)).toBe('<Result><Item type="Root" id="ROOT"><Relationships><Item type="Part BOM" id="R-Part BOM"><related_id keyed_name="k" type="Part">P1</related_id></Item></Relationships></Item></Result>');
    expect(stub.requests).toEqual([
      '<Item type="ItemType" select="is_dependent, is_versionable" action="get"><name>Part</name></Item>',
      '<Item type="RelationshipType" select="behavior" action="get"><name>Part BOM</name></Item>',
    ]);
  });

  it("leaves the item of a dependent ItemType in place, and looks up only the ItemType", async () => {
    const { stub, references } = over([dependent("Part")]);
    const text = related("Part BOM", "Part", full("Part", "P1"));
    const doc = rootWith(text);
    await references.processIndependentRelatedItems(doc);
    expect(result(doc)).toContain(full("Part", "P1"));
    expect(stub.requests).toHaveLength(1);
  });

  it("caches the lookups: one request per type name", async () => {
    const { stub, references } = over([independent("Part"), behavior("Part BOM", "hard")]);
    await references.processIndependentRelatedItems(rootWith(related("Part BOM", "Part", full("Part", "P1")) + related("Part BOM", "Part", full("Part", "P2"))));
    expect(stub.requests).toHaveLength(2);
  });

  it.each([
    ["a relationship of type ITPresentationConfiguration", related("ITPresentationConfiguration", "Part", full("Part", "P1"))],
    ["a related_id of type Identity", related("R", "Identity", full("Identity", "P1"))],
    ["a related_id of type Method", related("R", "Method", full("Method", "P1"))],
    ["a related_id of type SSVCPresentationConfiguration", related("R", "SSVCPresentationConfiguration", full("X", "P1"))],
    ["a related_id of type cmf_TabularViewHeaderRow", related("R", "cmf_TabularViewHeaderRow", full("X", "P1"))],
    ["an Item with an empty id", related("R", "Part", full("Part", ""))],
    ["an Item with no id", related("R", "Part", "<Item type='Part'><name>n</name></Item>")],
    ["a related_id with no type", `<Item type="R"><related_id>${full("Part", "P1")}</related_id></Item>`],
    ["a relationship with no type", `<Item><related_id type="Part">${full("Part", "P1")}</related_id></Item>`],
  ])("selects nothing for %s", async (_, relationship) => {
    const { stub, references } = over([]);
    const doc = rootWith(relationship);
    const before = result(doc);
    await references.processIndependentRelatedItems(doc);
    expect(result(doc)).toBe(before);
    expect(stub.requests).toEqual([]);
  });

  it("selects Relationships at any depth", async () => {
    const { references } = over([independent("Part"), behavior("R", "hard")]);
    const doc = answer(`<Item type="Root"><Relationships><Item type="Mid"><Relationships>${related("R", "Part", full("Part", "DEEP"))}</Relationships></Item></Relationships></Item>`);
    await references.processIndependentRelatedItems(doc);
    expect(result(doc)).toContain('<related_id keyed_name="k" type="Part">DEEP</related_id>');
  });

  it("uses the config id when the behavior contains float", async () => {
    const { stub, references } = over([independent("Part"), behavior("Part Float", "hard_float"), notVersionable("Part")]);
    const doc = rootWith(related("Part Float", "Part", full("Part", "GEN1", "<config_id>CFG</config_id>")));
    await references.processIndependentRelatedItems(doc);
    expect(result(doc)).toContain('<related_id keyed_name="k" type="Part">GEN1</related_id>');
    expect(stub.requests).toHaveLength(3);
  });

  it("takes the config id from the item's config_id child, or asks for it, when the type is versionable", async () => {
    const { stub, references } = over([
      independent("Part"),
      behavior("Part Float", "float"),
      versionable("Part"),
      ["select='config_id'", stubResult('<Item type="Part" id="GEN2"><config_id>ASKED</config_id></Item>')],
      ["select=\"config_id\"", stubResult('<Item type="Part" id="GEN2"><config_id>ASKED</config_id></Item>')],
    ]);
    const doc = rootWith(related("Part Float", "Part", full("Part", "GEN1", "<config_id>CFG</config_id>")) + related("Part Float", "Part", full("Part", "GEN2")));
    await references.processIndependentRelatedItems(doc);
    expect(result(doc)).toContain('type="Part">CFG</related_id>');
    expect(result(doc)).toContain('type="Part">ASKED</related_id>');
    expect(stub.requests.at(-1)).toBe('<Item type="Part" select="config_id" action="get"><id>GEN2</id></Item>');
  });

  it("fails like the engine's null reference when is_dependent or behavior is missing", async () => {
    const { references } = over([itemType("Part", "is_dependent, is_versionable", "<is_versionable>1</is_versionable>")]);
    expect(await failure(() => references.processIndependentRelatedItems(rootWith(related("R", "Part", full("Part", "P1")))))).toMatchObject({
      typeName: "System.NullReferenceException",
    });
    const { references: noBehavior } = over([independent("Part"), ["<name>R</name>", stubResult('<Item type="RelationshipType" id="R"/>')]]);
    expect(await failure(() => noBehavior.processIndependentRelatedItems(rootWith(related("R", "Part", full("Part", "P1")))))).toMatchObject({
      typeName: "System.NullReferenceException",
    });
  });

  it("raises the lookup's CItemException when the type is not there", async () => {
    const { references } = over([["<name>Part</name>", noItems]]);
    const thrown = (await failure(() => references.processIndependentRelatedItems(rootWith(related("R", "Part", full("Part", "P1")))))) as CItemException;
    expect(thrown).toBeInstanceOf(CItemException);
    expect(thrown.faultdetail).toBe("Unable to get definition of System.Xml.XmlAttribute: Part");
  });
});

describe("EXP-115: nodes already detached are still processed", () => {
  const nested = () =>
    rootWith(
      related("RelP", "TypeP", full("TypeP", "P", `<Relationships>${related("RelQ", "TypeQ", full("TypeQ", "Q"))}</Relationships>`)) +
        related("RelS1", "TypeS1", full("TypeS1", "S1")) +
        related("RelS2", "TypeS2", full("TypeS2", "S2")),
    );
  const lookups = () => ["P", "Q", "S1", "S2"].flatMap((id) => [independent(`Type${id}`), behavior(`Rel${id}`, "hard")]);

  it("looks up the types of an item nested in a collapsed one, in document order", async () => {
    const { stub, references } = over(lookups());
    const doc = nested();
    await references.processIndependentRelatedItems(doc);
    const names = stub.requests.map((request) => /<name>([^<]*)<\/name>/.exec(request)?.[1]);
    expect(names).toEqual(["TypeP", "RelP", "TypeQ", "RelQ", "TypeS1", "RelS1", "TypeS2", "RelS2"]);
    expect(result(doc)).not.toContain("Relationships>" + related("RelQ", "TypeQ", ""));
    expect(result(doc)).toBe(
      '<Result><Item type="Root" id="ROOT"><Relationships>' +
        '<Item type="RelP" id="R-RelP"><related_id keyed_name="k" type="TypeP">P</related_id></Item>' +
        '<Item type="RelS1" id="R-RelS1"><related_id keyed_name="k" type="TypeS1">S1</related_id></Item>' +
        '<Item type="RelS2" id="R-RelS2"><related_id keyed_name="k" type="TypeS2">S2</related_id></Item>' +
        "</Relationships></Item></Result>",
    );
  });

  it("aborts on a lookup that fails for a node nobody reads any more", async () => {
    const { references } = over([["<name>TypeQ</name>", noItems], ...lookups()]);
    const thrown = (await failure(() => references.processIndependentRelatedItems(nested()))) as CItemException;
    expect(thrown.faultdetail).toBe("Unable to get definition of System.Xml.XmlAttribute: TypeQ");
  });

  it("processes the items nested in a dependent one on the document", async () => {
    const { references } = over([dependent("TypeP"), independent("TypeQ"), behavior("RelQ", "hard")]);
    const doc = rootWith(related("RelP", "TypeP", full("TypeP", "P", `<Relationships>${related("RelQ", "TypeQ", full("TypeQ", "Q"))}</Relationships>`)));
    await references.processIndependentRelatedItems(doc);
    expect(result(doc)).toContain('<related_id keyed_name="k" type="TypeQ">Q</related_id>');
    expect(result(doc)).toContain('<Item type="TypeP" id="P">');
  });
});

describe("EXP-114: the config id of a related item", () => {
  const relatedId = (inner: string, doc = answer(`<Item type="Root"><related_id>${inner}</related_id></Item>`)) => selectSingleNode("//related_id", doc) as XmlElement;

  it("is the text of related_id when there is no Item", async () => {
    const { references } = over([]);
    expect(await references.getRelatedItemConfigId(relatedId("SOME-ID"))).toBe("SOME-ID");
  });

  it("fails with the engine's message when there is no id", async () => {
    const { references } = over([["<is_keyed>1</is_keyed>", noItems], notVersionable("T")]);
    for (const inner of ["", '<Item type="T"/>']) {
      const thrown = (await failure(() => references.getRelatedItemConfigId(relatedId(inner)))) as CItemException;
      expect(thrown).toBeInstanceOf(CItemException);
      expect([thrown.faultcode, thrown.faultstring, thrown.faultdetail]).toEqual([-1, "Unable to find ID of the related item", "Unable to find ID of the related item"]);
    }
  });

  it("is the id attribute of the Item, untrimmed, for a type that is not versionable", async () => {
    const { references } = over([notVersionable("Part")]);
    expect(await references.getRelatedItemConfigId(relatedId('<Item type="Part" id=" P1 "/>'))).toBe(" P1 ");
  });

  it("is the config_id child of a versionable Item, or the answer to a config_id request", async () => {
    const { stub, references } = over([versionable("Part"), ["select=\"config_id\"", stubResult('<Item type="Part" id="G"><config_id>FROM-SERVER</config_id></Item>')]]);
    expect(await references.getRelatedItemConfigId(relatedId('<Item type="Part" id="G"><config_id>CHILD</config_id></Item>'))).toBe("CHILD");
    expect(await references.getRelatedItemConfigId(relatedId('<Item type="Part" id="G"/>'))).toBe("FROM-SERVER");
    expect(stub.requests.at(-1)).toBe('<Item type="Part" select="config_id" action="get"><id>G</id></Item>');
  });

  it("raises a null reference for an Item without type", async () => {
    const { references } = over([]);
    expect(await failure(() => references.getRelatedItemConfigId(relatedId('<Item id="G"/>')))).toMatchObject({ typeName: "System.NullReferenceException" });
  });

  it("looks the id up by the unique key when the Item has none, and fails when the key is not there", async () => {
    const { stub, references } = over([
      ["<name>Part</name><Relationships>", noItems],
      notVersionable("Part"),
    ]);
    const thrown = (await failure(() => references.getRelatedItemConfigId(relatedId('<Item type="Part" id=" "><name>x</name></Item>')))) as CItemException;
    expect(thrown.faultstring).toBe("Unable to find ID of the related item");
    expect(stub.requests[0]).toContain("<is_keyed>1</is_keyed>");
  });

  it("asks for the unique key of a get Item without requiring its properties", async () => {
    const { stub, references } = over([
      ["<is_keyed>1</is_keyed>", stubResult('<Item type="ItemType" id="IT"><Relationships><Item type="Property" id="PR"><name>name</name></Item><Item type="Property" id="PQ"><name>missing</name></Item></Relationships></Item>')],
      ["<name>x</name>", stubResult('<Item type="Part" id="FOUND"/>')],
      notVersionable("Part"),
    ]);
    expect(await references.getRelatedItemConfigId(relatedId('<Item type="Part" action="get" id="IGNORED"><name>x</name></Item>'))).toBe("FOUND");
    expect(stub.requests.find((request) => request.includes("select=\"id\"") && request.includes("<name>x</name>"))).toBe('<Item type="Part" action="get" select="id"><name>x</name></Item>');
  });
});

describe("EXP-116: float item properties holding an id become config ids", () => {
  const ID = "0123456789ABCDEF0123456789ABCDEF";
  const row = (name: string, dataSource: string) => `<Item type="Property" id="PR-${name}"><name>${name}</name>${dataSource}</Item>`;
  const source = (name: string | null, extra = "") => `<data_source keyed_name="${name}" type="ItemType"${name === null ? "" : ` name="${name}"`}${extra}>DSID</data_source>`;
  const floatLookup = (type: string, rows: string) =>
    [`<name>${type}</name><Relationships><Item type="Property" select="name, data_type, data_source"`, stubResult(`<Item type="ItemType" id="IT"><Relationships>${rows}</Relationships></Item>`)] as [string, string];
  const configId = (value: string) => ["select=\"config_id\"", stubResult(`<Item type="X" id="G"><config_id>${value}</config_id></Item>`)] as [string, string];
  const itemOf = (xml: string): XmlElement => selectSingleNode("//Item", answer(xml)) as XmlElement;

  it("is a 32 character upper-case hex id", () => {
    expect(isValueId(ID)).toBe(true);
    for (const value of [ID.toLowerCase(), ID.slice(1), `${ID}0`, `${ID.slice(0, 31)}G`, " " + ID, "", "0123456789abcdef0123456789ABCDEF"]) expect(isValueId(value)).toBe(false);
  });

  it("replaces the value by the config id, asking with the untrimmed text and the data source's name", async () => {
    const { stub, references } = over([floatLookup("Cmd", row("method_ref", source("Method"))), versionable("Method"), configId("CFG")]);
    const doc = answer(`<Item type="Cmd" id="C1"><method_ref keyed_name="m" type="Method"> ${ID}\n</method_ref></Item>`);
    await references.processPropertiesOfTypeItem(selectSingleNode("//Item", doc) as XmlElement);
    expect(result(doc)).toBe('<Result><Item type="Cmd" id="C1"><method_ref keyed_name="m" type="Method">CFG</method_ref></Item></Result>');
    expect(stub.requests.at(-1)).toBe(`<Item type="Method" select="config_id" action="get"><id> ${ID}\n</id></Item>`);
  });

  it.each([
    ["a lower-case id", ID.toLowerCase(), source("Method")],
    ["a value that is not an id", "not an id", source("Method")],
    ["no data_source", ID, ""],
    ["a data_source with is_null 1", ID, source("Method", ' is_null=" 1 "')],
    ["a data_source with no name attribute", ID, source(null)],
  ])("leaves the value alone for %s", async (_, value, dataSource) => {
    const { references } = over([floatLookup("Cmd", row("ref", dataSource)), versionable("Method"), configId("CFG")]);
    const doc = answer(`<Item type="Cmd" id="C1"><ref>${value}</ref></Item>`);
    await references.processPropertiesOfTypeItem(selectSingleNode("//Item", doc) as XmlElement);
    expect(result(doc)).toBe(`<Result><Item type="Cmd" id="C1"><ref>${value}</ref></Item></Result>`);
  });

  it("leaves it alone when the data source is not versionable, or the item has no such property", async () => {
    const { references } = over([floatLookup("Cmd", row("ref", source("Method")) + row("absent", source("Method"))), notVersionable("Method")]);
    const doc = answer(`<Item type="Cmd"><ref>${ID}</ref></Item>`);
    await references.processPropertiesOfTypeItem(selectSingleNode("//Item", doc) as XmlElement);
    expect(result(doc)).toBe(`<Result><Item type="Cmd"><ref>${ID}</ref></Item></Result>`);
  });

  it("recurses into the Item children of the item's children, in document order, for 14.0.7", async () => {
    const { stub, references } = over([noItemsFor("Cmd"), noItemsFor("Rel"), noItemsFor("Held")]);
    function noItemsFor(type: string): [string, string] {
      return [`<name>${type}</name><Relationships>`, noItems];
    }
    const doc = answer(
      '<Item type="Cmd"><Relationships><Item type="Rel"><holder><Item type="Held"/></holder></Item></Relationships><ref><Item type="Held"/></ref><Item type="NotAChild"/></Item>',
    );
    await references.processPropertiesOfTypeItem(selectSingleNode("//Item", doc) as XmlElement);
    const names = stub.requests.map((request) => /<name>([^<]*)<\/name>/.exec(request)?.[1]);
    expect(names).toEqual(["Cmd", "Rel", "Held", "Held"]);
  });

  it("does not cache a faultcode 0 answer, so each item of the type asks again", async () => {
    const { stub, references } = over([["<name>Root</name>", noItems], ["<name>Cmd</name>", noItems]]);
    const doc = answer('<Item type="Root"><Relationships><Item type="Cmd"/><Item type="Cmd"/></Relationships></Item>');
    await references.processPropertiesOfTypeItem(selectSingleNode("//Item", doc) as XmlElement);
    expect(stub.requests).toHaveLength(3);
  });

  it("wraps any other fault with the text of the engine, without a space, and keeps the original as the cause", async () => {
    const { references } = over([["<name>Cmd</name>", stubFault("999", "boom")]]);
    const thrown = (await failure(() => references.processPropertiesOfTypeItem(itemOf('<Item type="Cmd"/>')))) as CItemException;
    expect(thrown.faultcode).toBe(-1);
    expect(thrown.message.endsWith("Failed to process properties of type 'Item' for ItemType 'Cmd'")).toBe(true);
    expect(thrown.cause).toBeInstanceOf(CItemException);
  });

  it("fails on an item without type, and on a property name that is not an XPath", async () => {
    const { references } = over([floatLookup("Cmd", row("a'b", source("Method"))), versionable("Method")]);
    expect(await failure(() => references.processPropertiesOfTypeItem(itemOf("<Item id='I'/>")))).toMatchObject({ typeName: "System.NullReferenceException" });
    expect(await failure(() => references.processPropertiesOfTypeItem(itemOf('<Item type="Cmd"/>')))).toMatchObject({ name: "XPathException" });
  });
});
