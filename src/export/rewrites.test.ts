import { describe, expect, it } from "vitest";
import { CItemException, ResponseDocument } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { StubConnection, stubFault, stubResult } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import { RECURSION_LIMIT, StackOverflowException } from "../recursion-limit.js";
import { loadXml, outerXml, selectNodes, selectSingleNode } from "../xml/index.js";
import type { XmlDocument, XmlElement } from "../xml/index.js";
import { CExportItems } from "./cexport-items.js";
import { ExportItem } from "./export-item.js";

/** A helper over a stub that answers each request with `respond(request)`, and the exporter around it. */
function over(respond: (request: string) => string | undefined = () => undefined) {
  const stub = new StubConnection(respond);
  const helper = new CItemHelper(stub);
  helper.innovatorVersion = new ArasVersion(14, 0, 9, 1, 0);
  const exporter = new CExportItems(helper);
  return { stub, helper, exporter, rewrites: exporter.rewrites };
}

/** An answer document as IOM holds it: whitespace preserved. */
const answer = (items: string): XmlDocument => loadXml(stubResult(items), { preserveWhitespace: true });

/** The Result element of an answer, as XML text. */
const result = (doc: XmlDocument): string => outerXml(selectSingleNode("//Result", doc) as XmlElement);

const outcome = async (work: () => Promise<unknown>): Promise<unknown> => work().then(() => undefined, (error: unknown) => error);

const itemTypeAnswer = (flags: string) => stubResult(`<Item type="ItemType" id="X">${flags}</Item>`);
const notVersionable = itemTypeAnswer("<is_versionable>0</is_versionable>");
const noItems = stubFault("0", "No items of type ItemType found.");

describe("EXP-100: the steps run in order, each when its condition holds", () => {
  it("runs steps 5 to 12 in the table's order for a RelationshipType and a versionable type", async () => {
    const order: string[] = [];
    const { rewrites, helper } = over();
    const spies = ["removeSpecialRelationshipsIfNeed", "processXProperties", "replaceIdWithConfigId", "processRelationshipType", "processSequence", "processForm", "includeDrRelationshipAsValue", "indentConditionXmlInDAC"] as const;
    for (const name of spies) {
      (rewrites as unknown as Record<string, unknown>)[name] = () => {
        order.push(name);
        return Promise.resolve();
      };
    }
    helper.references.processIndependentRelatedItems = async () => void order.push("processIndependentRelatedItems");
    helper.references.processPropertiesOfTypeItem = async () => void order.push("processPropertiesOfTypeItem");
    const run = async (type: string, versionable: boolean) => {
      order.length = 0;
      await rewrites.rewrite(answer('<Item type="X" id="A"/>'), type, versionable);
      return [...order];
    };
    expect(await run("Part", false)).toEqual(["removeSpecialRelationshipsIfNeed", "processXProperties", "processIndependentRelatedItems", "processPropertiesOfTypeItem"]);
    expect(await run("RelationshipType", true)).toEqual([
      "removeSpecialRelationshipsIfNeed",
      "processXProperties",
      "replaceIdWithConfigId",
      "processRelationshipType",
      "processIndependentRelatedItems",
      "processPropertiesOfTypeItem",
    ]);
    expect(await run("Sequence", false)).toContain("processSequence");
    expect(await run("Form", false)).toContain("processForm");
    expect(await run("dr_RelationshipFamily", false)).toContain("includeDrRelationshipAsValue");
    expect(await run("ac_PolicyAccessItemAttribute", false)).toContain("includeDrRelationshipAsValue");
    expect(await run("dac_DomainDefinition", false).then((steps) => steps.at(-1))).toBe("indentConditionXmlInDAC");
    expect(await run("Sequence", false)).not.toContain("processForm");
  });

  it("skips the float properties when the answer has no Envelope/Body/Result/Item", async () => {
    const { rewrites, helper } = over();
    let called = false;
    helper.references.processPropertiesOfTypeItem = async () => void (called = true);
    await rewrites.rewrite(loadXml("<Result><Item type='X'/></Result>", { preserveWhitespace: true }), "Part", false);
    expect(called).toBe(false);
  });
});

describe("EXP-101: which failures the steps raise", () => {
  it("wraps a missing element as the null reference of the engine, and leaves a CItemException as it is", async () => {
    const { exporter } = over();
    const item = new ExportItem("k", "ID1", "Part");
    const fetched = { fileName: "k.xml", versionable: true, id: "ID1", request: "", response: responseOf('<Item type="Part" id="ID1"/>') };
    await expect(exporter.rewrite(item, fetched)).rejects.toMatchObject({
      faultcode: -1,
      message: "Object reference not set to an instance of an object. Can't export item.",
    });
  });
});

const responseOf = (items: string): ResponseDocument => ResponseDocument.parse(stubResult(items));

describe("EXP-103: the Client Event cmf_OnShowContainer is removed from the answer", () => {
  const clientEvent = (name: string, id: string) =>
    `<Item type="Client Event" id="${id}"><related_id keyed_name="${name}" type="Method">M${id}</related_id></Item>`;

  it("removes the first match only and leaves the Relationships element", async () => {
    const { rewrites } = over(() => noItems);
    const doc = answer(`<Item type="ItemType" id="IT1"><Relationships>${clientEvent("cmf_OnShowContainer", "E1")}${clientEvent("cmf_OnShowContainer", "E2")}</Relationships></Item>`);
    await rewrites.removeSpecialRelationshipsIfNeed("ItemType", doc);
    expect(result(doc)).toBe(`<Result><Item type="ItemType" id="IT1"><Relationships>${clientEvent("cmf_OnShowContainer", "E2")}</Relationships></Item></Result>`);
  });

  it("keeps the other Client Events and the other event names", async () => {
    const { rewrites } = over(() => noItems);
    const events = `${clientEvent("onFormPopulate", "E1")}<Item type="Server Event" id="E2"><related_id keyed_name="cmf_OnShowContainer"/></Item>`;
    const doc = answer(`<Item type="ItemType" id="IT1"><Relationships>${events}</Relationships></Item>`);
    await rewrites.removeSpecialRelationshipsIfNeed("ItemType", doc);
    expect(result(doc)).toContain(events.replace('"cmf_OnShowContainer"/>', '"cmf_OnShowContainer" />'));
  });

  it("does nothing for any other type", async () => {
    const { stub, rewrites } = over(() => noItems);
    const doc = answer(`<Item type="Form" id="F1"><Relationships>${clientEvent("cmf_OnShowContainer", "E1")}</Relationships></Item>`);
    await rewrites.removeSpecialRelationshipsIfNeed("Form", doc);
    expect(result(doc)).toContain("cmf_OnShowContainer");
    expect(stub.requests).toEqual([]);
  });
});

describe("EXP-104: the content-type lookup that edits a copy", () => {
  // as the connection writes it: IOM serialises the root again, which drops the space the engine's text has before the >
  const TAB = "\t";
  const expectedRequest = (id: string) =>
    `<AML>${TAB}<Item type="cmf_ContentType" action="get" select="id">${TAB}${TAB}<linked_item_type>${id}</linked_item_type>${TAB}${TAB}<Relationships>${TAB}${TAB}${TAB}` +
    `<Item type="cmf_ElementType" select="generated_type">${TAB}${TAB}${TAB}${TAB}<Relationships>${TAB}${TAB}${TAB}${TAB}${TAB}` +
    `<Item type="cmf_PropertyType" select="generated_type" />${TAB}${TAB}${TAB}${TAB}</Relationships>${TAB}${TAB}${TAB}</Item>${TAB}${TAB}</Relationships>${TAB}</Item></AML>`;
  const rel = (generated: string) => `<Item type="Property" id="P${generated}"><relationship_id>${generated}</relationship_id></Item>`;
  const itemType = (body: string, id = 'id="IT1"') => answer(`<Item type="ItemType" ${id}><Relationships>${body}</Relationships></Item>`);
  const contentType = (elements: string) =>
    stubResult(`<Item type="cmf_ContentType" id="C1"><Relationships>${elements}</Relationships></Item>`);
  const element = (generated: string, properties: string) =>
    `<Item type="cmf_ElementType" id="E${generated}"><generated_type>${generated}</generated_type><Relationships>${properties}</Relationships></Item>`;
  const property = (generated: string) => `<Item type="cmf_PropertyType" id="T${generated}"><generated_type>${generated}</generated_type></Item>`;

  it("sends one ApplyAML request with the id of the ItemType, and an end on a fault or <Empty />", async () => {
    for (const answerText of [noItems, '<Empty />']) {
      const { stub, rewrites } = over(() => answerText);
      await rewrites.removeAutoGeneratedRelationships(itemType(""));
      expect(stub.requests).toEqual([expectedRequest("IT1")]);
      expect(stub.actions).toEqual(["ApplyAML"]);
    }
  });

  it("reads the id from the id property when the attribute is empty (trimmed, plain conditions only)", async () => {
    const { stub, rewrites } = over(() => noItems);
    await rewrites.removeAutoGeneratedRelationships(answer('<Item type="ItemType" id=""><id> IDP </id><Relationships/></Item>'));
    await rewrites.removeAutoGeneratedRelationships(answer('<Item type="ItemType" id=""><id condition="eq">IDQ</id><Relationships/></Item>'));
    await rewrites.removeAutoGeneratedRelationships(answer('<Item type="ItemType" id=""><id condition="like">IDR</id><Relationships/></Item>'));
    expect(stub.requests).toEqual([expectedRequest("IDP"), expectedRequest("IDQ"), expectedRequest("")]);
  });

  it("removes the generated types from the copy, which nobody writes", async () => {
    const { stub, rewrites } = over(() => contentType(element("G1", property("G2") + property("G3")) + element("G4", "")));
    const doc = itemType(rel("G1") + rel("G2") + rel("G3") + rel("G4") + rel("G5"));
    await rewrites.removeAutoGeneratedRelationships(doc);
    expect(selectNodes("//Relationships/Item", doc)).toHaveLength(5);
    expect(stub.requests).toHaveLength(1);
  });

  it("raises 'Not a single item' when two content types are linked, unwrapped", async () => {
    const { exporter, rewrites } = over(() => stubResult('<Item type="cmf_ContentType" id="C1"/><Item type="cmf_ContentType" id="C2"/>'));
    const failure = await outcome(() => rewrites.removeAutoGeneratedRelationships(itemType("")));
    expect(failure).toMatchObject({ typeName: "System.Exception", message: "Not a single item" });
    const fetched = { fileName: "k.xml", versionable: false, id: "IT1", request: "", response: responseOf('<Item type="ItemType" id="IT1"><Relationships/></Item>') };
    await expect(exporter.rewrite(new ExportItem("k", "IT1", "ItemType"), fetched)).rejects.toMatchObject({ typeName: "System.Exception", message: "Not a single item" });
  });

  it("raises an ArgumentException when a generated type has no single relationship, unwrapped", async () => {
    for (const body of [rel("G9"), rel("G1") + rel("G1")]) {
      const { rewrites } = over(() => contentType(element("G1", "")));
      const failure = await outcome(() => rewrites.removeAutoGeneratedRelationships(itemType(body)));
      expect(failure).toMatchObject({ typeName: "System.ArgumentException", message: "The argument passed to the method is not a single item" });
    }
  });

  it("raises an XPathException, wrapped, when a generated type has an apostrophe", async () => {
    const { exporter } = over((request) => (request.includes("is_versionable") ? notVersionable : request.includes("cmf_ContentType") ? contentType(element("G'1", "")) : stubResult('<Item type="ItemType" id="IT1"><Relationships/></Item>')));
    const item = new ExportItem("k", "IT1", "ItemType");
    const fetched = await exporter.fetch(item, "");
    await expect(exporter.rewrite(item, fetched)).rejects.toSatisfy((error: unknown) => error instanceof CItemException && error.faultcode === -1 && error.message.endsWith(" Can't export item."));
  });
});

describe("EXP-105: the system xClass_xProperty_Flatten relationships are removed", () => {
  const flatten = '<Item type="xClass_xProperty_Flatten" id="F1" />';
  const xClass = (body: string) => `<Item type="xClass" id="X1"><Relationships>${body}</Relationships></Item>`;

  it("removes them from each xClass relationship, and nothing deeper", async () => {
    const { rewrites } = over();
    const deeper = `<Item type="Other" id="O1"><Relationships>${flatten}</Relationships></Item>`;
    const doc = answer(`<Item type="xClassificationTree" id="T1"><Relationships>${xClass(flatten + '<Item type="xClass_xProperty" id="K" />' + flatten + deeper)}${xClass(flatten)}${flatten}</Relationships></Item>`);
    await rewrites.removeSpecialRelationshipsIfNeed("xClassificationTree", doc);
    expect(result(doc)).toBe(
      `<Result><Item type="xClassificationTree" id="T1"><Relationships>${xClass('<Item type="xClass_xProperty" id="K" />' + deeper)}${xClass("")}${flatten}</Relationships></Item></Result>`,
    );
  });

  it("raises 'Not a single item' without a Result/Item", async () => {
    const { rewrites } = over();
    const failure = await outcome(() => rewrites.removeSpecialRelationshipsIfNeed("xClassificationTree", loadXml("<Envelope/>", { preserveWhitespace: true })));
    expect(failure).toMatchObject({ typeName: "System.Exception", message: "Not a single item" });
  });
});

describe("EXP-106: xp-* properties get a set attribute", () => {
  const rewrite = (xml: string): string => {
    const { rewrites } = over();
    const doc = answer(`<Item type="X" id="A">${xml}</Item>`);
    rewrites.processXProperties(doc);
    return result(doc).replace('<Result><Item type="X" id="A">', "").replace("</Item></Result>", "");
  };

  it("writes the four possible values, set first, and drops explicit and is_null when they are not what set says", () => {
    expect(rewrite('<xp-a explicit="1" is_null="0" permission_id="P">v</xp-a>')).toBe('<xp-a set="permission_id|explicit" explicit="1" permission_id="P">v</xp-a>');
    expect(rewrite('<xp-a explicit="0" is_null="1" permission_id="P"/>')).toBe('<xp-a set="permission_id|value" is_null="1" permission_id="P" />');
    expect(rewrite('<xp-a explicit="1" is_null="1" permission_id="P"/>')).toBe('<xp-a set="permission_id|explicit|value" explicit="1" is_null="1" permission_id="P" />');
    expect(rewrite('<xp-a explicit="2" is_null="0" permission_id="P"/>')).toBe('<xp-a set="permission_id" permission_id="P" />');
  });

  it("treats an absent is_null as not 0, adds an empty permission_id, and replaces an old set", () => {
    expect(rewrite("<xp-a>v</xp-a>")).toBe('<xp-a set="permission_id|value" permission_id="">v</xp-a>');
    expect(rewrite('<xp-a is_null=" 0">v</xp-a>')).toBe('<xp-a set="permission_id|value" is_null=" 0" permission_id="">v</xp-a>');
    expect(rewrite('<xp-a b="1" set="old" c="2"/>')).toBe('<xp-a set="permission_id|value" b="1" c="2" permission_id="" />');
  });

  it("visits xp-* children of Items at any depth, in document order, and nothing else", () => {
    const { rewrites } = over();
    const doc = answer('<Item type="X"><Relationships><Item type="Y"><xp-b is_null="0"/></Item></Relationships><xp-a is_null="0"/><xpx is_null="0"/><Other><xp-c/></Other></Item>');
    rewrites.processXProperties(doc);
    expect(result(doc)).toBe(
      '<Result><Item type="X"><Relationships><Item type="Y"><xp-b set="permission_id" permission_id="" /></Item></Relationships><xp-a set="permission_id" permission_id="" /><xpx is_null="0" /><Other><xp-c /></Other></Item></Result>',
    );
  });
});

describe("EXP-107: ids of versionable items are replaced by config ids", () => {
  it("sets the id of the item, the source_id of its relationships, and drops the relationships' ids", () => {
    const { rewrites } = over();
    const doc = answer(
      '<Item type="Part" id="GEN2"><config_id>CFG</config_id><Relationships>' +
        '<Item type="Part BOM" id="R1"><source_id keyed_name="x" type="Part">GEN2</source_id><related_id><Item id="N1" type="Part"><source_id>KEEP</source_id></Item></related_id><Relationships><Item type="Deep" id="D1"><source_id>DEEP</source_id></Item></Relationships></Item>' +
        '</Relationships></Item>',
    );
    rewrites.replaceIdWithConfigId(doc);
    expect(result(doc)).toBe(
      '<Result><Item type="Part" id="CFG"><config_id>CFG</config_id><Relationships>' +
        '<Item type="Part BOM"><source_id keyed_name="x" type="Part">CFG</source_id><related_id><Item id="N1" type="Part"><source_id>KEEP</source_id></Item></related_id><Relationships><Item type="Deep" id="D1"><source_id>DEEP</source_id></Item></Relationships></Item>' +
        "</Relationships></Item></Result>",
    );
  });

  it("adds a missing id after the other attributes, and drops a child of source_id", () => {
    const { rewrites } = over();
    const doc = answer('<Item type="Part"><config_id>CFG</config_id><Relationships><Item type="R"><source_id><Item id="Z"/></source_id></Item></Relationships></Item>');
    rewrites.replaceIdWithConfigId(doc);
    expect(result(doc)).toBe('<Result><Item type="Part" id="CFG"><config_id>CFG</config_id><Relationships><Item type="R"><source_id>CFG</source_id></Item></Relationships></Item></Result>');
  });

  it("fails with the null reference of the engine when there is no config_id", () => {
    const { rewrites } = over();
    expect(() => rewrites.replaceIdWithConfigId(answer('<Item type="Part" id="A"/>'))).toThrow("Object reference not set to an instance of an object.");
  });
});

describe("EXP-108 and EXP-109: a RelationshipType embeds its relationship ItemType", () => {
  const relationshipType = (extra = "") =>
    `<Item type="RelationshipType" id="RT1"><relationship_id keyed_name="Grid Event" type="ItemType">REL1</relationship_id><source_id keyed_name="Property" type="ItemType">SRC1</source_id>${extra}</Item>`;

  it("embeds a deep copy of the ItemType, and adds dependencyLevel after the other attributes", async () => {
    const requests: string[] = [];
    const { rewrites } = over((request) => {
      requests.push(request);
      if (request.startsWith('<Item type="ItemType" action="get" id="REL1">')) return stubResult('<Item type="ItemType" id="REL1"><name>Grid Event</name><source_id>NOT-THIS</source_id></Item>');
      if (request.includes("<relationship_id>SRC1</relationship_id>")) return stubResult('<Item type="RelationshipType" id="RT2"><source_id>SRC2</source_id></Item>');
      if (request.includes("<relationship_id>SRC2</relationship_id>")) return noItems;
      return undefined;
    });
    const doc = answer(relationshipType());
    await rewrites.processRelationshipType(doc);
    expect(result(doc)).toBe(
      '<Result><Item type="RelationshipType" id="RT1" dependencyLevel="1"><relationship_id keyed_name="Grid Event" type="ItemType"><Item type="ItemType" id="REL1"><name>Grid Event</name><source_id>NOT-THIS</source_id></Item></relationship_id><source_id keyed_name="Property" type="ItemType">SRC1</source_id></Item></Result>',
    );
    expect(requests[0]).toMatch(/^<Item type="ItemType" action="get" id="REL1"><Relationships>/);
    expect(requests.slice(1)).toEqual([
      '<Item type="RelationshipType" select="source_id,relationship_id" page="1" pagesize="1" action="get"><relationship_id>SRC1</relationship_id></Item>',
      '<Item type="RelationshipType" select="source_id,relationship_id" page="1" pagesize="1" action="get"><relationship_id>SRC2</relationship_id></Item>',
    ]);
  });

  it("gives level 0 when no RelationshipType has the source as its relationship ItemType", async () => {
    const { rewrites } = over((request) => (request.startsWith('<Item type="ItemType"') ? stubResult('<Item type="ItemType" id="REL1"/>') : noItems));
    const doc = answer(relationshipType());
    await rewrites.processRelationshipType(doc);
    expect(result(doc)).toContain('<Item type="RelationshipType" id="RT1" dependencyLevel="0">');
  });

  it("replaces an existing dependencyLevel in place, and skips the level without a source_id", async () => {
    const { rewrites } = over((request) => (request.startsWith('<Item type="ItemType"') ? stubResult('<Item type="ItemType" id="REL1"/>') : noItems));
    const doc = answer('<Item type="RelationshipType" dependencyLevel="9" id="RT1"><relationship_id>REL1</relationship_id><source_id>S</source_id></Item>');
    await rewrites.processRelationshipType(doc);
    expect(result(doc)).toContain('<Item type="RelationshipType" dependencyLevel="0" id="RT1">');
    const without = answer('<Item type="RelationshipType" id="RT1"><relationship_id>REL1</relationship_id></Item>');
    await rewrites.processRelationshipType(without);
    expect(result(without)).toBe('<Result><Item type="RelationshipType" id="RT1"><relationship_id><Item type="ItemType" id="REL1" /></relationship_id></Item></Result>');
  });

  it("leaves relationship_id empty when the ItemType answer has no Result/Item, and fails on a fault", async () => {
    const { rewrites } = over(() => stubResult(""));
    const doc = answer(relationshipType());
    await rewrites.processRelationshipType(doc);
    expect(result(doc)).toContain('<relationship_id keyed_name="Grid Event" type="ItemType"></relationship_id>');
    const { rewrites: failing } = over(() => noItems);
    await expect(failing.processRelationshipType(answer(relationshipType()))).rejects.toMatchObject({ faultcode: 0 });
  });

  it("fails with the null reference of the engine without a relationship_id", async () => {
    const { rewrites } = over();
    await expect(rewrites.processRelationshipType(answer('<Item type="RelationshipType"/>'))).rejects.toThrow("Object reference not set");
  });

  it("stops a cycle of RelationshipTypes at the recursion limit with the engine's stack overflow text (EXP-109)", async () => {
    const { stub, helper } = over((request) => (request.startsWith("<Item type=\"RelationshipType\"") ? stubResult('<Item type="RelationshipType"><source_id>LOOP</source_id></Item>') : undefined));
    const failure = await helper.lookups.getDepencyLevel("LOOP", 0).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StackOverflowException);
    expect((failure as Error).message).toBe("Process is terminated due to StackOverflowException.");
    expect(stub.requests).toHaveLength(RECURSION_LIMIT - 1);
  }, 30_000);
});

describe("EXP-110: Sequence loses its current_value", () => {
  it("removes the first current_value child of the first Sequence, and its neighbouring white space stays", () => {
    const { rewrites } = over();
    const doc = answer('<Item type="Sequence" id="S1">\n  <current_value>5</current_value>\n  <current_value>6</current_value>\n  <name>n</name>\n</Item>');
    rewrites.processSequence(doc);
    expect(result(doc)).toBe('<Result><Item type="Sequence" id="S1">\n  \n  <current_value>6</current_value>\n  <name>n</name>\n</Item></Result>');
  });

  it("does nothing without a Sequence item or without the child", () => {
    const { rewrites } = over();
    const other = answer('<Item type="Other"><current_value>5</current_value></Item>');
    rewrites.processSequence(other);
    expect(result(other)).toContain("current_value");
    const bare = answer('<Item type="Sequence" id="S1"><name>n</name></Item>');
    rewrites.processSequence(bare);
    expect(result(bare)).toBe('<Result><Item type="Sequence" id="S1"><name>n</name></Item></Result>');
  });
});

describe("EXP-111 and EXP-112: Form fields embed their Property", () => {
  const field = (name: string, attributes = 'keyed_name="p" type="Property"', id = "PT1") =>
    `<Item type="Field" id="F${id}"><name>${name}</name><propertytype_id ${attributes}>${id}</propertytype_id></Item>`;
  const form = (fields: string) => answer(`<Item type="Form" id="FORM1"><Relationships>${fields}</Relationships></Item>`);

  it("replaces the content of propertytype_id by the Property, one request per field, uncached", async () => {
    const requests: string[] = [];
    const { rewrites } = over((request) => {
      requests.push(request);
      return stubResult(`<Item type="Property" id="${/id="([^"]*)"/.exec(request)?.[1]}"><name>pname</name><source_id>S</source_id></Item>`);
    });
    const doc = form(field("one") + field("two", 'keyed_name="p" type="Property"', "PT2") + field("three"));
    await rewrites.processForm(doc);
    expect(requests).toEqual([
      '<Item type="Property" action="get" id="PT1" select="name,source_id" page="1" pagesize="1" />',
      '<Item type="Property" action="get" id="PT2" select="name,source_id" page="1" pagesize="1" />',
      '<Item type="Property" action="get" id="PT1" select="name,source_id" page="1" pagesize="1" />',
    ]);
    expect(result(doc)).toContain(
      '<propertytype_id keyed_name="p" type="Property"><Item type="Property" id="PT1"><name>pname</name><source_id>S</source_id></Item></propertytype_id>',
    );
  });

  it("aborts the form on a faultcode 0 and puts the type and the field in the detail (the inverted catch)", async () => {
    const { rewrites } = over(() => noItems);
    const failure = (await outcome(() => rewrites.processForm(form(field("fld"))))) as CItemException;
    expect(failure).toBeInstanceOf(CItemException);
    expect(failure.faultcode).toBe(0);
    expect(failure.faultdetail).toBe("Unable to get property Property for field fld");
    const bare = (await outcome(() => rewrites.processForm(form(field("fld", ""))))) as CItemException;
    expect(bare.faultdetail).toBe("Unable to get property  for field fld");
  });

  it("raises a null reference when keyed_name is there and type is not", async () => {
    const { rewrites } = over(() => noItems);
    const failure = await outcome(() => rewrites.processForm(form(field("fld", 'keyed_name="p"'))));
    expect(failure).toMatchObject({ typeName: "System.NullReferenceException" });
  });

  it("swallows every other fault and leaves the plain id", async () => {
    for (const code of ["999", "1", "-5"]) {
      const { rewrites } = over(() => stubFault(code, "boom"));
      const doc = form(field("fld"));
      await rewrites.processForm(doc);
      expect(result(doc)).toContain('<propertytype_id keyed_name="p" type="Property">PT1</propertytype_id>');
    }
  });

  it("names the field with an empty string when it has no name, and ignores a propertytype_id that is not a Field's", async () => {
    const { stub, rewrites } = over(() => noItems);
    const doc = answer('<Item type="Form"><propertytype_id keyed_name="p" type="Property">X</propertytype_id><Item type="Field"><propertytype_id keyed_name="p" type="Property">PT1</propertytype_id></Item></Item>');
    const failure = (await outcome(() => rewrites.processForm(doc))) as CItemException;
    expect(failure.faultdetail).toBe("Unable to get property Property for field ");
    expect(stub.requests).toHaveLength(1);
  });
});

describe("EXP-117, EXP-118 and EXP-121: dr_Relationship items are embedded", () => {
  const family = (ids: string[]) =>
    answer(`<Item type="dr_RelationshipFamily" id="FAM"><Relationships>${ids.map((id) => `<Item type="dr_FamilyElement" id="E${id}"><dr_relationship_id keyed_name="k" type="dr_Relationship">${id}</dr_relationship_id></Item>`).join("")}</Relationships></Item>`);
  const drRelationship = (query: string | null) =>
    stubResult(`<Item type="dr_Relationship" id="DR1"><name>n</name>${query === null ? "" : `<implementation_query>${query}</implementation_query>`}</Item>`);

  it("replaces dr_relationship_id by the dr_Relationship, after emptying it, and re-indents implementation_query", async () => {
    const { stub, rewrites } = over(() => drRelationship("&lt;a&gt;&lt;b/&gt;&lt;c&gt;t&lt;/c&gt;&lt;/a&gt;"));
    const doc = family(["DR1"]);
    await rewrites.includeDrRelationshipAsValue(doc);
    expect(stub.requests).toEqual(['<Item type="dr_Relationship" action="get" id="DR1" />']);
    expect(result(doc)).toContain(
      '<dr_relationship_id keyed_name="k" type="dr_Relationship"><Item type="dr_Relationship" id="DR1"><name>n</name><implementation_query>&lt;a&gt;\r\n  &lt;b /&gt;\r\n  &lt;c&gt;t&lt;/c&gt;\r\n&lt;/a&gt;</implementation_query></Item></dr_relationship_id>',
    );
  });

  it("embeds a dr_Relationship without implementation_query as it is, one request per element", async () => {
    const { stub, rewrites } = over(() => drRelationship(null));
    const doc = family(["DR1", "DR2"]);
    await rewrites.includeDrRelationshipAsValue(doc);
    expect(stub.requests).toEqual(['<Item type="dr_Relationship" action="get" id="DR1" />', '<Item type="dr_Relationship" action="get" id="DR2" />']);
    expect(selectNodes("//dr_relationship_id/Item", doc)).toHaveLength(2);
  });

  it("fails on an empty, blank or malformed implementation_query, and on a fault", async () => {
    for (const query of ["", "  ", "not xml", "&lt;a/&gt;&lt;b/&gt;"]) {
      const { exporter } = over((request) => (request.includes("is_versionable") ? notVersionable : request.includes('type="dr_Relationship"') ? drRelationship(query) : stubResult(`<Item type="dr_RelationshipFamily" id="FAM"><Relationships><Item type="dr_FamilyElement"><dr_relationship_id>DR1</dr_relationship_id></Item></Relationships></Item>`)));
      const item = new ExportItem("k", "FAM", "dr_RelationshipFamily");
      const fetched = await exporter.fetch(item, "");
      await expect(exporter.rewrite(item, fetched)).rejects.toSatisfy((error: unknown) => error instanceof CItemException && error.faultcode === -1 && error.message.endsWith(" Can't export item."));
    }
    const { rewrites } = over(() => noItems);
    await expect(rewrites.includeDrRelationshipAsValue(family(["DR1"]))).rejects.toMatchObject({ faultcode: 0 });
  });

  it("looks only at the direct relationships of the Result item", async () => {
    const { stub, rewrites } = over(() => drRelationship(null));
    const doc = answer('<Item type="X"><Relationships><Item type="Y"><Relationships><Item type="Z"><dr_relationship_id>DEEP</dr_relationship_id></Item></Relationships></Item></Relationships></Item>');
    await rewrites.includeDrRelationshipAsValue(doc);
    expect(stub.requests).toEqual([]);
  });

  it("is the routine of an ac_PolicyAccessItemAttribute too (the copy-paste of EXP-118)", async () => {
    const { stub, exporter } = over((request) =>
      request.includes("is_versionable")
        ? notVersionable
        : request.includes('type="dr_Relationship"')
          ? drRelationship(null)
          : request.includes("Property")
            ? noItems
            : stubResult('<Item type="ac_PolicyAccessItemAttribute" id="AC1"><Relationships><Item type="ac_PolicyAccessAttrDefinition"><dr_relationship_id>DR1</dr_relationship_id></Item></Relationships></Item>'),
    );
    const item = new ExportItem("k", "AC1", "ac_PolicyAccessItemAttribute");
    const fetched = await exporter.fetch(item, "");
    const doc = await exporter.rewrite(item, fetched);
    expect(selectNodes("//dr_relationship_id/Item[@type='dr_Relationship']", doc)).toHaveLength(1);
    expect(stub.requests.filter((request) => request.includes('type="dr_Relationship"'))).toHaveLength(1);
  });
});

describe("EXP-119 and EXP-120: dac_DomainDefinition conditions are re-indented", () => {
  const permission = (content: string) => `<Item type="dac_SubdomainPermission" id="P1"><condition_xml>${content}</condition_xml></Item>`;
  const run = (content: string): string => {
    const { rewrites } = over();
    const doc = answer(`<Item type="dac_DomainDefinition" id="D1"><Relationships>${permission(content)}</Relationships></Item>`);
    rewrites.indentConditionXmlInDAC(doc);
    return (selectSingleNode("//condition_xml", doc) as XmlElement).textContent ?? "";
  };

  it.each([
    ["&lt;and&gt;&lt;eq&gt;&lt;property name=&quot;a&quot;/&gt;&lt;/eq&gt;&lt;/and&gt;", '<and>\r\n <eq>\r\n  <property name="a" />\r\n </eq>\r\n</and>'],
    ['&lt;and&gt;&lt;eq&gt;&lt;property name="a"/&gt;&lt;/eq&gt;&lt;/and&gt;', '<and>\r\n <eq>\r\n  <property name="a" />\r\n </eq>\r\n</and>'],
    ['<![CDATA[<and><eq a="1"/></and>]]>', '<![CDATA[<and><eq a="1"/></and>]]>'],
    ["&lt;a/&gt;&lt;b/&gt;", "<a />\r\n<b />"],
    ["&lt;c&gt;&amp;nbsp;&lt;/c&gt;", "<c>&nbsp;</c>"],
    ['&lt;?xml version="1.0"?&gt;&lt;a/&gt;', "<a />"],
    ["", ""],
  ])("probed: %s", (content, expected) => {
    expect(run(content)).toBe(expected);
  });

  it("holds the indented XML as one text node, and an empty condition stays empty", () => {
    const { rewrites } = over();
    const doc = answer(`<Item type="dac_DomainDefinition">${permission("&lt;a&gt;&lt;b/&gt;&lt;/a&gt;")}${permission("")}</Item>`);
    rewrites.indentConditionXmlInDAC(doc);
    const [full, empty] = selectNodes("//condition_xml", doc) as XmlElement[];
    expect(full?.childNodes).toHaveLength(1);
    expect(full?.firstChild?.nodeType).toBe(3);
    expect(empty?.childNodes).toHaveLength(0);
  });

  it("fails with an XmlException on a bare ampersand, on plain text with &amp;, and on unbalanced tags", () => {
    for (const content of ["&lt;a&gt;x &amp; y&lt;/a&gt;", "plain &amp; text", "&lt;a&gt;&lt;b&gt;"]) {
      expect(() => run(content), content).toThrow();
    }
  });

  it("visits only the conditions of dac_SubdomainPermission items", () => {
    const { rewrites } = over();
    const doc = answer('<Item type="dac_DomainDefinition"><condition_xml>&lt;a/&gt;</condition_xml><Item type="Other"><condition_xml>&lt;a/&gt;</condition_xml></Item></Item>');
    rewrites.indentConditionXmlInDAC(doc);
    expect(result(doc)).toBe('<Result><Item type="dac_DomainDefinition"><condition_xml>&lt;a/&gt;</condition_xml><Item type="Other"><condition_xml>&lt;a/&gt;</condition_xml></Item></Item></Result>');
  });
});
