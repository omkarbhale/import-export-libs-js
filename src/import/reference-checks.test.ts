import { describe, expect, it } from "vitest";
import { DotNetException } from "../client/dotnet.js";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import type { Engine } from "../engines.js";
import { StubConnection, stubFault, stubResult } from "../client/stub-connection.js";
import { ArgumentNullException } from "../io/errors.js";
import { documentElementOf } from "../xml/dom.js";
import type { XmlDocument, XmlElement } from "../xml/dom.js";
import { loadXml } from "../xml/parser.js";
import { selectNodes } from "../xml/xpath.js";
import { outerXml } from "../xml/writer-legacy.js";
import { ReferenceChecker } from "./reference-checks.js";
import type { DelayedResolution, UnresolvedReference } from "./reference-checks.js";

const NO_ITEMS = (type: string): string => stubFault("0", `No items of type ${type} found.`);

/** The definition of a type as the checks ask for it (IMP-130): its properties and relationship types by name. */
const definition = (relationshipTypes: string[] = [], properties: string[] = []): string =>
  stubResult(
    '<Item type="ItemType" id="T1"><Relationships>' +
      properties.map((name) => `<Item type="Property"><name>${name}</name></Item>`).join("") +
      relationshipTypes.map((name) => `<Item type="RelationshipType"><name>${name}</name></Item>`).join("") +
      "</Relationships></Item>",
  );

const FOUND = stubResult('<Item type="X" id="Z1"/>');
const NOT_VERSIONABLE = stubResult('<Item type="ItemType" id="T"><is_versionable>0</is_versionable></Item>');
const DEFINITION_REQUEST = /^<Item type="ItemType" action="get" select="id"><name>([^<]*)<\/name><Relationships>/;

interface Setup {
  checker: ReferenceChecker;
  helper: CItemHelper;
  stub: StubConnection;
  log: string[];
  writer: { writeLine(text: string): void };
}

/** A checker over a stub server that answers `respond(wire)`, and "no items" to what it has no answer for. */
function setup(respond: (wire: string) => string | undefined = () => FOUND, engine: Engine = "14.0.7"): Setup {
  const stub = new StubConnection((wire) => respond(wire) ?? NO_ITEMS("Item"));
  const helper = new CItemHelper(stub, { engine });
  const log: string[] = [];
  return { checker: new ReferenceChecker(helper), helper, stub, log, writer: { writeLine: (text) => log.push(text) } };
}

const doc = (xml: string): XmlDocument => loadXml(xml, { preserveWhitespace: false });
const root = (document: XmlDocument): XmlElement => documentElementOf(document)!;

const manager = () => {
  const received: UnresolvedReference[][] = [];
  const delayed: DelayedResolution = { processForDelayedResolution: (list) => void received.push([...list]) };
  return { delayed, received };
};

/** The code and the outer XML of each unresolved reference. */
const summary = (list: UnresolvedReference[]): [number, string][] => list.map((entry) => [entry.faultcode, outerXml(entry.problemNode)]);

async function failureOf(work: Promise<unknown>): Promise<Error> {
  try {
    await work;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a failure");
}

describe("DoChecking (IMP-100)", () => {
  it("writes the two lines around the checks and hands a non-empty list to the delayed resolution", async () => {
    const { checker, writer, log } = setup((wire) => (DEFINITION_REQUEST.test(wire) ? definition() : wire.includes("is_versionable") ? NOT_VERSIONABLE : NO_ITEMS("X")));
    const { delayed, received } = manager();
    const item = doc('<Item type="Part" id="P1" action="add"><owner_id keyed_name="o" type="Identity">I1</owner_id><related_id keyed_name="k" type="Part">R1</related_id></Item>');
    await checker.doChecking(delayed, item, writer, true);
    expect(log[0]).toBe("********** Start of reference checking ************");
    expect(log[log.length - 1]).toBe("************* End of reference checking ************");
    expect(received).toHaveLength(1);
    expect(summary(received[0]!)).toEqual([[10001, '<related_id keyed_name="k" type="Part">R1</related_id>']]);
  });

  it("does not call the manager when nothing is unresolved", async () => {
    const { checker, writer } = setup((wire) => (DEFINITION_REQUEST.test(wire) ? definition() : FOUND));
    const { delayed, received } = manager();
    await checker.doChecking(delayed, doc('<Item type="Part" id="P1" action="add"/>'), writer, true);
    expect(received).toEqual([]);
  });

  it("checks only the data sources of a delete, and leaves out the end line when a check throws", async () => {
    const { checker, writer, log, stub } = setup(() => NO_ITEMS("ItemType"));
    const { delayed, received } = manager();
    const property = doc('<Item type="Property" id="P1" action="delete"><data_type>item</data_type><data_source keyed_name="Gone" type="ItemType">G1</data_source></Item>');
    await checker.doChecking(delayed, property, writer, false);
    // no definition of Property is read: only the data source is
    expect(stub.requests).toEqual(['<Item type="ItemType" action="get" select="id"><name>Gone</name></Item>']);
    expect(received).toHaveLength(1);
    expect(log[log.length - 1]).toBe("************* End of reference checking ************");

    const failing = setup(() => stubFault("5", "refused"));
    failing.log.length = 0;
    const error = await failureOf(failing.checker.doChecking(delayed, doc('<Item type="Part" id="P1" action="add"/>'), failing.writer, true));
    expect(error).toBeInstanceOf(CItemException);
    expect(failing.log[failing.log.length - 1]).not.toBe("************* End of reference checking ************");
    expect(received).toHaveLength(1);
  });
});

describe("RecurseCheck (IMP-101, IMP-104, IMP-180)", () => {
  it("refuses a null argument before anything else, without wrapping it", async () => {
    const { checker, writer } = setup();
    const error = await failureOf(checker.recurseCheck(null as unknown as XmlDocument, writer, []));
    expect(error).toBeInstanceOf(ArgumentNullException);
    expect((error as ArgumentNullException).paramName).toBe("itemInXml");
    const noLog = (await failureOf(checker.recurseCheck(doc("<Item/>"), null as never, []))) as ArgumentNullException;
    expect(noLog.paramName).toBe("logWriter");
    const noList = (await failureOf(checker.recurseCheck(doc("<Item/>"), writer, null as never))) as ArgumentNullException;
    expect(noList.paramName).toBe("unresolvedRefs");
  });

  it("runs the checks in order, so the list holds 10005, then the gets, then 10000, then 10001", async () => {
    const { checker, writer } = setup((wire) => {
      if (DEFINITION_REQUEST.test(wire)) return definition(["DiscussionTemplate"], []);
      if (wire.includes("is_versionable")) return NOT_VERSIONABLE;
      if (wire.includes('type="DiscussionTemplate"')) return NO_ITEMS("DiscussionTemplate");
      return NO_ITEMS("X");
    });
    const item = doc(
      '<Item type="Forum" id="F1" action="add">' +
        '<related_id keyed_name="k" type="Part">R1</related_id>' +
        '<Relationships><Item type="DiscussionTemplate" id="D1" action="add"><name>t</name></Item></Relationships>' +
        '<owner_id type="Identity"><Item type="Identity" action="get" select="id"><name>nobody</name></Item></owner_id>' +
        "</Item>",
    );
    // the property with a data source is a child of a nested Property item
    root(item).appendChild(
      doc('<Item type="Property" id="Y1" action="add"><data_type>list</data_type><data_source keyed_name="L" type="List">L1</data_source></Item>').documentElement!.cloneNode(true) as never,
    );
    const unresolved: UnresolvedReference[] = [];
    await checker.recurseCheck(item, writer, unresolved);
    expect(unresolved.map((entry) => entry.faultcode)).toEqual([10005, 0, 10000, 10001]);
  });

  it("turns any failure into a faultcode -1 exception with the suffix, the original message and the original as its cause", async () => {
    const { checker, writer } = setup();
    const error = (await failureOf(checker.recurseCheck(doc('<Item id="X" action="add"/>'), writer, []))) as CItemException;
    expect(error).toBeInstanceOf(CItemException);
    expect(error.faultcode).toBe(-1);
    expect(error.message).toBe("type attribute is missing Recurse check has failed.");
    expect(error.faultdetail).toBe("type attribute is missing Recurse check has failed.");
    expect((error.cause as Error).message).toBe("type attribute is missing");
  });

  it("loses the faultcode 0 of a missing item, and shows the whole server text of a refused request", async () => {
    const { checker, writer } = setup((wire) => (DEFINITION_REQUEST.test(wire) ? NO_ITEMS("ItemType") : undefined));
    const error = (await failureOf(checker.recurseCheck(doc('<Item type="Nope" id="X" action="add"/>'), writer, []))) as CItemException;
    expect(error.faultcode).toBe(-1);
    expect(error.message.startsWith("Server error\r\n\r\nRequest: <Item type='ItemType' action='get' select='id'><name>Nope</name>")).toBe(true);
    expect(error.message.endsWith(" Recurse check has failed.")).toBe(true);
    expect((error.cause as CItemException).faultcode).toBe(0);
  });

  it("never shows the detail the lookups attach to a fault (IMP-180)", async () => {
    const { checker, writer } = setup((wire) => (DEFINITION_REQUEST.test(wire) ? NO_ITEMS("ItemType") : undefined));
    const error = (await failureOf(checker.recurseCheck(doc('<Item type="Nope" id="X" action="add"/>'), writer, []))) as CItemException;
    const original = error.cause as CItemException;
    // the detail names the attribute object, not its value, and nothing reads it
    expect(original.faultdetail).toBe("Unable to get definition of System.Xml.XmlAttribute: Nope");
    expect(error.message).not.toContain("Unable to get definition");
  });
});

describe("CheckRelationshipItems (IMP-110, IMP-111)", () => {
  const BUILT_IN = "9D257D4D16AC480493571BBF816D13BE";
  const forum = (id: string, inner: string, extra = ""): string =>
    `<Item type="Forum" id="F1" action="add"><Relationships><Item type="DiscussionTemplate" id="${id}"${extra}>${inner}</Item></Relationships></Item>`;

  it("sends the get with a space before = of action, and logs it", async () => {
    const { checker, writer, log, stub } = setup();
    await checker.checkRelationshipItems(doc(forum("D1", "<name>t</name>", ' action="add"')), writer, []);
    expect(stub.requests).toEqual(['<Item type="DiscussionTemplate" id="D1" action="get" select="id" levels="0"></Item>']);
    expect(log).toEqual(["checking item with get action:<Item type='DiscussionTemplate' id='D1' action ='get' select='id' levels='0'></Item>", "-> was obtained from server"]);
  });

  it("rewrites an existing template that has nested items and queues it (10005)", async () => {
    const { checker, writer } = setup();
    const item = doc(
      forum("D1", '<Relationships><Item type="Other" action="add"/><Item type="FeedTemplate" action="add"/><Item type="Other" action="edit"/></Relationships>', ' action="add"'),
    );
    const unresolved: UnresolvedReference[] = [];
    await checker.checkRelationshipItems(item, writer, unresolved);
    expect(outerXml(root(item))).toBe(
      '<Item type="Forum" id="F1" action="add"><Relationships><Item type="DiscussionTemplate" id="D1" action="edit"><Relationships><Item type="Other" action="merge" /><Item type="FeedTemplate" action="merge" /><Item type="Other" action="edit" /></Relationships></Item></Relationships></Item>',
    );
    expect(unresolved.map((entry) => entry.faultcode)).toEqual([10005]);
  });

  it("makes a FeedTemplate of the built-in template an edit", async () => {
    const { checker, writer } = setup();
    const item = doc(
      forum(BUILT_IN, '<Relationships><Item type="FeedTemplate" action="add"/><Item type="Other" action="add"/></Relationships>', ' action="add"'),
    );
    await checker.checkRelationshipItems(item, writer, []);
    const nested = selectNodes(".//Item[@type='FeedTemplate' or @type='Other']", item) as XmlElement[];
    expect(nested.map((node) => node.getAttribute("action"))).toEqual(["edit", "merge"]);
  });

  it("[12.0] makes every nested add a merge, the built-in template's FeedTemplate too (IMP-110)", async () => {
    const { checker, writer } = setup(() => FOUND, "12.0");
    const item = doc(
      forum(BUILT_IN, '<Relationships><Item type="FeedTemplate" action="add"/><Item type="Other" action="add"/><Item type="FeedTemplate" action="edit"/></Relationships>', ' action="add"'),
    );
    const unresolved: UnresolvedReference[] = [];
    await checker.checkRelationshipItems(item, writer, unresolved);
    const nested = selectNodes(".//Item[@type='FeedTemplate' or @type='Other']", item) as XmlElement[];
    expect(nested.map((node) => node.getAttribute("action"))).toEqual(["merge", "merge", "edit"]);
    expect(unresolved.map((entry) => entry.faultcode)).toEqual([10005]);
  });

  it("leaves a template without nested items alone and does not queue it", async () => {
    const { checker, writer } = setup();
    const item = doc(forum("D1", "<name>t</name>", ' action="add"'));
    const unresolved: UnresolvedReference[] = [];
    await checker.checkRelationshipItems(item, writer, unresolved);
    expect(unresolved).toEqual([]);
    expect(root(item).getElementsByTagName("Item").item(0)!.getAttribute("action")).toBe("add");
  });

  it("queues a missing template as it is (faultcode 0 is not cached), and throws any other fault", async () => {
    const missing = setup(() => NO_ITEMS("DiscussionTemplate"));
    const item = doc(forum("D1", '<Relationships><Item type="FeedTemplate" action="add"/></Relationships>', ' action="add"'));
    const unresolved: UnresolvedReference[] = [];
    await missing.checker.checkRelationshipItems(item, missing.writer, unresolved);
    await missing.checker.checkRelationshipItems(item, missing.writer, unresolved);
    expect(unresolved.map((entry) => entry.faultcode)).toEqual([10005, 10005]);
    expect(missing.stub.requests).toHaveLength(2);
    expect(missing.log).toEqual([
      "checking item with get action:<Item type='DiscussionTemplate' id='D1' action ='get' select='id' levels='0'></Item>",
      "checking item with get action:<Item type='DiscussionTemplate' id='D1' action ='get' select='id' levels='0'></Item>",
    ]);

    const refused = setup(() => stubFault("5", "no"));
    const failure = await failureOf(refused.checker.checkRelationshipItems(item, refused.writer, []));
    expect((failure as CItemException).faultcode).toBe(5);
  });

  it("skips a relationship with no type or no id without a request", async () => {
    const { checker, writer, stub, log } = setup();
    await checker.checkRelationshipItems(
      doc('<Item type="F"><Relationships><Item type="DiscussionTemplate" action="add"/><Item type="DiscussionTemplate" id="" action="add"/></Relationships></Item>'),
      writer,
      [],
    );
    expect(stub.requests).toEqual([]);
    expect(log).toEqual([]);
  });

  it("rewrites only the first relationship with an id, because the answer stays cached (IMP-111)", async () => {
    const { checker, writer, log } = setup();
    const nested = '<Relationships><Item type="FeedTemplate" action="add"/></Relationships>';
    const first = doc(forum("D1", nested, ' action="add"'));
    const second = doc(forum("D1", nested, ' action="add"'));
    const unresolved: UnresolvedReference[] = [];
    await checker.checkRelationshipItems(first, writer, unresolved);
    await checker.checkRelationshipItems(second, writer, unresolved);
    expect(root(first).getElementsByTagName("Item").item(0)!.getAttribute("action")).toBe("edit");
    expect(root(first).getElementsByTagName("Item").item(1)!.getAttribute("action")).toBe("merge");
    expect(root(second).getElementsByTagName("Item").item(0)!.getAttribute("action")).toBe("add");
    expect(root(second).getElementsByTagName("Item").item(1)!.getAttribute("action")).toBe("add");
    expect(unresolved).toHaveLength(1);
    expect(log[log.length - 1]).toBe("-> was obtained from cache");
  });

  it("throws a null reference after caching the answer when the relationship has nested items but no action", async () => {
    const { checker, writer } = setup();
    const item = doc(forum("D1", '<Relationships><Item type="FeedTemplate" action="add"/></Relationships>'));
    const error = await failureOf(checker.checkRelationshipItems(item, writer, []));
    expect((error as DotNetException).typeName).toBe("System.NullReferenceException");
    expect(error.message).toBe("Object reference not set to an instance of an object.");
    // the answer is cached, so a second element with the id is a hit and ends quietly
    await checker.checkRelationshipItems(item, writer, []);
  });
});

describe("CheckGetItems (IMP-120)", () => {
  const getItem = (inner: string): string => `<Item type="X" action="get" select="id"><name>n</name></Item>${inner}`;

  it("sends each get verbatim, in document order with nested ones included, and logs it", async () => {
    const { checker, writer, log, stub } = setup();
    const item = doc(
      '<Item type="Part" action="add"><owner_id type="Identity"><Item type="Identity" action="get" select="id"><name>a</name><Relationships><Item type="Q" action="get"/></Relationships></Item></owner_id></Item>',
    );
    await checker.checkGetItems(item, writer, []);
    expect(stub.requests).toEqual([
      '<Item type="Identity" action="get" select="id"><name>a</name><Relationships><Item type="Q" action="get" /></Relationships></Item>',
      '<Item type="Q" action="get" />',
    ]);
    expect(log).toEqual([
      'checking item with get action:<Item type="Identity" action="get" select="id"><name>a</name><Relationships><Item type="Q" action="get" /></Relationships></Item>',
      "-> was obtained from server",
      'checking item with get action:<Item type="Q" action="get" />',
      "-> was obtained from server",
    ]);
  });

  it.each([
    ["related_id of a RelationshipType", '<Item type="RelationshipType"><related_id type="ItemType">GET</related_id></Item>', 10003],
    ["related_id of any other item", '<Item type="Part"><related_id type="Part">GET</related_id></Item>', 10001],
    ["related_id of an item without a type", "<Item><related_id>GET</related_id></Item>", 10001],
    ["source_id of a RelationshipType", '<Item type="RelationshipType"><source_id type="ItemType">GET</source_id></Item>', 10002],
    ["source_id of any other item", '<Item type="Part"><source_id type="Part">GET</source_id></Item>', 0],
    ["data_source", '<Item type="Property"><data_source type="ItemType">GET</data_source></Item>', 10000],
    ["foreign_property", '<Item type="Property"><foreign_property>GET</foreign_property></Item>', 10004],
    ["any other parent", "<Item><anything>GET</anything></Item>", 0],
  ])("records %s as %i", async (_name, template, code) => {
    const { checker, writer } = setup(() => NO_ITEMS("X"));
    const item = doc(`<Item type="Wrapper" action="add">${template.replace("GET", '<Item type="X" action="get" select="id"><name>n</name></Item>')}</Item>`);
    const unresolved: UnresolvedReference[] = [];
    await checker.checkGetItems(item, writer, unresolved);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.faultcode).toBe(code);
    expect(unresolved[0]?.problemNode.nodeName).toBe(/<(\w+)[^>]*>GET/.exec(template)![1]);
  });

  it("records the root item with code 0 and the document as its node when it is a get", async () => {
    const { checker, writer } = setup(() => NO_ITEMS("X"));
    const item = doc(getItem("").replace("<Item", "<Item"));
    const unresolved: UnresolvedReference[] = [];
    await checker.checkGetItems(item, writer, unresolved);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.faultcode).toBe(0);
    expect(unresolved[0]?.problemNode).toBe(item);
  });

  it("answers a repeat from the cache, and sends a missing item again", async () => {
    const { checker, writer, log, stub } = setup((wire) => (wire.includes("<name>gone</name>") ? NO_ITEMS("X") : FOUND));
    const item = doc(
      '<Item type="P" action="add"><a><Item type="X" action="get"><name>there</name></Item></a><b><Item type="X" action="get"><name>there</name></Item></b>' +
        '<c><Item type="X" action="get"><name>gone</name></Item></c><d><Item type="X" action="get"><name>gone</name></Item></d></Item>',
    );
    await checker.checkGetItems(item, writer, []);
    expect(stub.requests).toHaveLength(3);
    // the answer of the missing item is a fault, so no line follows its request and it is sent again
    expect(log.filter((line) => line.startsWith("->"))).toEqual(["-> was obtained from server", "-> was obtained from cache"]);
  });

  it("throws a fault with another code, and only the faultcode 0 is a missing item", async () => {
    const { checker, writer } = setup(() => stubFault("5", "refused"));
    const error = await failureOf(checker.checkGetItems(doc(getItem("")), writer, []));
    expect((error as CItemException).faultcode).toBe(5);
  });
});

describe("CheckPropertiesAndRelationshipTypes (IMP-130, IMP-131, IMP-132)", () => {
  it("refuses an item without a type", async () => {
    const { checker, writer } = setup();
    const error = await failureOf(checker.checkPropertiesAndRelationshipTypes(doc('<Item action="add"/>'), writer));
    expect(error.message).toBe("type attribute is missing");
    expect(error.name).toBe("XmlException");
  });

  it("reads the definition of every item's type, logs it, and caches it", async () => {
    const { checker, writer, log, stub } = setup(() => definition());
    await checker.checkPropertiesAndRelationshipTypes(doc('<Item type="Part" id="P1"><name>n</name></Item>'), writer);
    await checker.checkPropertiesAndRelationshipTypes(doc('<Item type="Part" id="P2"/>'), writer);
    const request =
      "<Item type='ItemType' action='get' select='id'><name>Part</name><Relationships><Item type='Property' action='get' select='name'/><Item type='RelationshipType' action='get' select='name'/></Relationships></Item>";
    expect(stub.requests).toEqual([
      '<Item type="ItemType" action="get" select="id"><name>Part</name><Relationships><Item type="Property" action="get" select="name" /><Item type="RelationshipType" action="get" select="name" /></Relationships></Item>',
    ]);
    expect(log).toEqual([request, "  was obtained from server", request, "  was obtained from cache"]);
  });

  it("fails with faultcode 0 for a type the server does not know", async () => {
    const { checker, writer } = setup(() => NO_ITEMS("ItemType"));
    const error = await failureOf(checker.checkPropertiesAndRelationshipTypes(doc('<Item type="Nope"/>'), writer));
    expect((error as CItemException).faultcode).toBe(0);
    expect((error as CItemException).faultdetail).toBe("Unable to get definition of System.Xml.XmlAttribute: Nope");
  });

  it("accepts a relationship type the definition names, and recurses on the relationship item", async () => {
    const { checker, writer, stub } = setup((wire) => {
      const name = DEFINITION_REQUEST.exec(wire)?.[1];
      return name === "Part" ? definition(["Part BOM"]) : name === "Part BOM" ? definition(["Alt"]) : name === "Alt" ? definition() : undefined;
    });
    const item = doc(
      '<Item type="Part" id="P1"><Relationships><Item type="Part BOM" id="B1"><Relationships><Item type="Alt" id="A1"/></Relationships></Item></Relationships></Item>',
    );
    await checker.checkPropertiesAndRelationshipTypes(item, writer);
    expect(stub.requests.map((request) => DEFINITION_REQUEST.exec(request)?.[1])).toEqual(["Part", "Part BOM", "Alt"]);
  });

  it("asks again with the cache bypassed when the definition lacks the relationship type, and fails when it still does", async () => {
    const { checker, writer, log, stub } = setup((wire) => (DEFINITION_REQUEST.test(wire) ? definition(["Other"]) : undefined));
    const error = (await failureOf(
      checker.checkPropertiesAndRelationshipTypes(doc('<Item type="Part"><Relationships><Item type="Part BOM"/></Relationships></Item>'), writer),
    )) as CItemException;
    expect(stub.requests).toHaveLength(2);
    expect(log.filter((line) => line.startsWith("  was"))).toEqual(["  was obtained from server", "  was obtained from server"]);
    expect(error.faultcode).toBe(-1);
    expect(error.faultstring).toBe("RecurseCheck");
    expect(error.faultdetail).toBe("Bad Relation type Part BOM for Part");
    expect(error.message).toBe("Bad Relation type Part BOM for Part");
  });

  it("replaces the cached definition with the forced answer, so a later item finds the relationship type there", async () => {
    let definitions = 0;
    const { checker, writer, stub } = setup((wire) => {
      const name = DEFINITION_REQUEST.exec(wire)?.[1];
      if (name === "Part") return definition(++definitions === 1 ? [] : ["Part BOM"]);
      return name === "Part BOM" ? definition() : undefined;
    });
    const item = () => doc('<Item type="Part"><Relationships><Item type="Part BOM"/></Relationships></Item>');
    for (let i = 0; i < 3; i += 1) await checker.checkPropertiesAndRelationshipTypes(item(), writer);
    // the first item asks twice, and the second answer replaced the entry: the other two items find it there
    expect(stub.requests.filter((request) => request.includes("<name>Part</name>"))).toHaveLength(2);
  });

  it("names the node type of anything but an element under Relationships", async () => {
    const { checker, writer } = setup(() => definition(["R"]));
    const comment = await failureOf(checker.checkPropertiesAndRelationshipTypes(doc('<Item type="Part"><Relationships><!--x--></Relationships></Item>'), writer));
    expect(comment).toBeInstanceOf(DotNetException);
    expect(comment.message).toBe("Unable to cast object of type 'System.Xml.XmlComment' to type 'System.Xml.XmlElement'.");
    const text = await failureOf(checker.checkPropertiesAndRelationshipTypes(doc('<Item type="Part"><Relationships>hello</Relationships></Item>'), writer));
    expect(text.message).toBe("Unable to cast object of type 'System.Xml.XmlText' to type 'System.Xml.XmlElement'.");
    const cdata = await failureOf(checker.checkPropertiesAndRelationshipTypes(doc('<Item type="Part"><Relationships><![CDATA[hello]]></Relationships></Item>'), writer));
    expect(cdata.message).toBe("Unable to cast object of type 'System.Xml.XmlCDataSection' to type 'System.Xml.XmlElement'.");
    const instruction = await failureOf(checker.checkPropertiesAndRelationshipTypes(doc('<Item type="Part"><Relationships><?pi x?></Relationships></Item>'), writer));
    expect(instruction.message).toBe("Unable to cast object of type 'System.Xml.XmlProcessingInstruction' to type 'System.Xml.XmlElement'.");
  });

  it("checks the relationship items before the node that is not an element, in order", async () => {
    const { checker, writer, stub } = setup((wire) => (DEFINITION_REQUEST.exec(wire)?.[1] === "Part" ? definition(["R"]) : definition()));
    const error = await failureOf(
      checker.checkPropertiesAndRelationshipTypes(doc('<Item type="Part"><Relationships><Item type="R"/><!--x--></Relationships></Item>'), writer),
    );
    expect(error.message).toContain("XmlComment");
    expect(stub.requests).toHaveLength(2);
  });

  it("refuses an element under Relationships that is not an Item", async () => {
    const { checker, writer } = setup(() => definition());
    const error = await failureOf(checker.checkPropertiesAndRelationshipTypes(doc('<Item type="Part"><Relationships><Thing/></Relationships></Item>'), writer));
    expect(error.message).toBe("Relationships tag can contain only Item tags, but found Thing");
    expect(error.name).toBe("XmlException");
  });

  it("does not check property names: it compares the name Property with itself (IMP-131)", async () => {
    const { checker, writer } = setup(() => definition([], ["size"]));
    // a property value the type does not have passes, as does a Property element when the type has no property of that name only through the forced request
    await checker.checkPropertiesAndRelationshipTypes(doc('<Item type="Part"><not_a_property>1</not_a_property></Item>'), writer);
    const error = (await failureOf(checker.checkPropertiesAndRelationshipTypes(doc('<Item type="Part"><Property>x</Property></Item>'), writer))) as CItemException;
    expect(error.faultdetail).toBe("Bad property name Property for type Part");
    expect(error.faultstring).toBe("RecurseCheck");
  });

  it("lets a Property element pass when the type has a property of that name", async () => {
    const { checker, writer } = setup(() => definition([], ["Property"]));
    await checker.checkPropertiesAndRelationshipTypes(doc('<Item type="Part"><Property>x</Property></Item>'), writer);
  });

  it("builds the XPath with the relationship type unescaped, so a quote breaks it", async () => {
    const { checker, writer } = setup(() => definition(["R"]));
    const error = await failureOf(
      checker.checkPropertiesAndRelationshipTypes(doc(`<Item type="Part"><Relationships><Item type="it's"/></Relationships></Item>`), writer),
    );
    expect(error.name).toBe("XPathException");
  });
});

describe("GetTypeAmlInner and the metadata lookups (IMP-132)", () => {
  it("writes the request, then where the answer came from, and forces a new answer that replaces the cached one", async () => {
    let calls = 0;
    const { helper, log, writer } = setup(() => stubResult(`<Item type="ItemType" id="T"><n>${++calls}</n></Item>`));
    const lookups = helper.lookups;
    const aml = "<Item type='ItemType' select='x' action='get'><name>Part</name></Item>";
    await lookups.getTypeAmlInner(aml, writer);
    await lookups.getTypeAmlInner(aml, writer);
    const forced = await lookups.getTypeAmlInner(aml, writer, true);
    const after = await lookups.getTypeAmlInner(aml, writer);
    expect(log).toEqual([aml, "  was obtained from server", aml, "  was obtained from cache", aml, "  was obtained from server", aml, "  was obtained from cache"]);
    expect(after).toBe(forced);
  });

  it("builds the request of GetMetaDataInfo, GetItemType and GetRelationshipType, with a log writer when given one", async () => {
    const { helper, log, writer, stub } = setup();
    await helper.lookups.getMetaDataInfo("ItemType", "Part", "", "<id>1</id>", writer);
    await helper.lookups.getItemType("Part", "is_versionable", writer);
    await helper.lookups.getRelationshipType("Part BOM", "behavior");
    expect(log).toEqual([
      "<Item type='ItemType' action='get'><id>1</id><name>Part</name></Item>",
      "  was obtained from server",
      "<Item type='ItemType' select='is_versionable' action='get'><name>Part</name></Item>",
      "  was obtained from server",
    ]);
    expect(stub.requests).toHaveLength(3);
  });

  it("does not write to the log for the lookups that pass none (IsVersionable)", async () => {
    const { helper, log } = setup(() => stubResult('<Item type="ItemType" id="T"><is_versionable>1</is_versionable></Item>'));
    expect(await helper.lookups.isVersionable("Part")).toBe(true);
    expect(log).toEqual([]);
  });
});

describe("CheckDataSourceReferences (IMP-140)", () => {
  const property = (dataType: string | null, dataSource: string, extra = ""): string =>
    `<Item type="Property" id="Y1" action="add">${dataType === null ? "" : `<data_type>${dataType}</data_type>`}${dataSource}${extra}</Item>`;
  const source = (text: string, attributes = ' keyed_name="Pet" type="List"'): string => `<data_source${attributes}>${text}</data_source>`;

  it("asks for the ItemType by its keyed_name for an item property, and skips one without keyed_name silently", async () => {
    const { checker, writer, log, stub } = setup();
    await checker.checkDataSourceReferences(doc(property("item", source("I1", ' keyed_name="Part" type="ItemType"'))), writer, []);
    await checker.checkDataSourceReferences(doc(property("item", source("I1", ' type="ItemType"'))), writer, []);
    expect(stub.requests).toEqual(['<Item type="ItemType" action="get" select="id"><name>Part</name></Item>']);
    expect(log).toEqual([
      "checking <data_source> reference to the ItemType",
      "<Item type='ItemType' action='get' select='id'><name>Part</name></Item>",
      "  was obtained from server",
      "checking <data_source> reference to the ItemType",
    ]);
  });

  it("skips a foreign property, and sends the data type in the case it has", async () => {
    const { checker, writer, stub, log } = setup();
    await checker.checkDataSourceReferences(doc(property("foreign", source("F1"))), writer, []);
    await checker.checkDataSourceReferences(doc(property("list", source("L1"))), writer, []);
    await checker.checkDataSourceReferences(doc(property("sequence", source("S1"))), writer, []);
    await checker.checkDataSourceReferences(doc(property("List", source("L2"))), writer, []);
    await checker.checkDataSourceReferences(doc(property(null, source("N1"))), writer, []);
    expect(stub.requests).toEqual([
      '<Item action="get" type="list" select="id"><id>L1</id></Item>',
      '<Item action="get" type="sequence" select="id"><id>S1</id></Item>',
      '<Item action="get" type="List" select="id"><id>L2</id></Item>',
      '<Item action="get" type="" select="id"><id>N1</id></Item>',
    ]);
    expect(log.filter((line) => line.startsWith("checking"))).toEqual(Array(4).fill("checking <data_source> reference to list/sequence"));
  });

  it.each(["color list", "filter list", "mv_list", "my_mv_list"])("sends the type List for the data type %s", async (dataType) => {
    const { checker, writer, stub } = setup();
    await checker.checkDataSourceReferences(doc(property(dataType, source("L1"))), writer, []);
    expect(stub.requests).toEqual(['<Item action="get" type="List" select="id"><id>L1</id></Item>']);
  });

  it("does not select a data source that is empty, all zeros or an item", async () => {
    const { checker, writer, stub } = setup();
    await checker.checkDataSourceReferences(
      doc(
        '<Item type="Root"><Relationships>' +
          property("list", source("")) +
          property("list", source("00000000000000000000000000000000")) +
          property("list", '<data_source keyed_name="k" type="List"><Item type="List" action="get"/></data_source>') +
          property("list", "") +
          "</Relationships></Item>",
      ),
      writer,
      [],
    );
    expect(stub.requests).toEqual([]);
  });

  it("records a missing list as 10000 with the data_source element, and sends the request again next time", async () => {
    const { checker, writer, stub } = setup(() => NO_ITEMS("List"));
    const unresolved: UnresolvedReference[] = [];
    const item = doc(property("list", source("L1")));
    await checker.checkDataSourceReferences(item, writer, unresolved);
    await checker.checkDataSourceReferences(item, writer, unresolved);
    expect(summary(unresolved)).toEqual(Array(2).fill([10000, '<data_source keyed_name="Pet" type="List">L1</data_source>']));
    expect(stub.requests).toHaveLength(2);
  });

  it("throws a fault with another code, and a repeat of a found request is a hit", async () => {
    const refused = setup(() => stubFault("7", "no"));
    const error = await failureOf(refused.checker.checkDataSourceReferences(doc(property("list", source("L1"))), refused.writer, []));
    expect((error as CItemException).faultcode).toBe(7);

    const { checker, writer, log } = setup();
    await checker.checkDataSourceReferences(doc(property("list", source("L1"))), writer, []);
    await checker.checkDataSourceReferences(doc(property("list", source("L1"))), writer, []);
    expect(log[log.length - 1]).toBe("  was obtained from cache");
  });
});

describe("CheckRelatedItems and GetCurrentIdOfVersion (IMP-150, IMP-151)", () => {
  const item = (related: string, parentType = "Part BOM"): string =>
    `<Item type="Part" id="P1" action="add"><Relationships><Item type="${parentType}" id="B1" action="add">${related}</Item></Relationships></Item>`;
  const related = (text: string, attributes = ' keyed_name="k" type="Part"'): string => `<related_id${attributes}>${text}</related_id>`;

  /** A server where Part is versionable, Part BOM floats, and the item `old` is an old generation of config `c1` whose current is `new`. */
  const server = (options: { versionable?: boolean; behavior?: string | null; present?: boolean } = {}) => (wire: string) => {
    const versionable = options.versionable ?? true;
    const behavior = options.behavior === undefined ? "float" : options.behavior;
    if (wire.includes('select="is_versionable"')) return stubResult(`<Item type="ItemType" id="T"><is_versionable>${versionable ? 1 : 0}</is_versionable></Item>`);
    if (wire.includes('type="RelationshipType" select="behavior"')) {
      return stubResult(behavior === null ? '<Item type="RelationshipType" id="R"/>' : `<Item type="RelationshipType" id="R"><behavior>${behavior}</behavior></Item>`);
    }
    if (wire.includes('select="config_id, is_current"')) return stubResult('<Item type="Part" id="old"><config_id>c1</config_id><is_current>0</is_current></Item>');
    if (wire.includes("<config_id>c1</config_id>")) return stubResult('<Item type="Part" id="new"><id>new</id></Item>');
    if (wire.includes("<id>missing</id>")) return NO_ITEMS("Part");
    if ((options.present ?? true) === false) return NO_ITEMS("Part");
    return FOUND;
  };

  it("sends the get of the related item whole, and logs the check, the request and the answer", async () => {
    const { checker, writer, log, stub } = setup(server({ versionable: false }));
    await checker.checkRelatedItems(doc(item(related("old"))), writer, []);
    expect(stub.requests[0]).toBe('<Item type="Part" action="get" levels="0"><id>old</id></Item>');
    expect(log).toEqual(["checking for related items", "<Item type='Part' action='get' levels='0'><id>old</id></Item>", "  was obtained from server"]);
  });

  it.each([
    ["14.0.7", "  was obtained from"],
    ["12.0", "   was obtained from"],
  ] as const)("%s writes %j before the cache words of this check", async (engine, words) => {
    const { checker, writer, log } = setup(server({ versionable: false }), engine);
    await checker.checkRelatedItems(doc(item(related("old"))), writer, []);
    await checker.checkRelatedItems(doc(item(related("old"))), writer, []);
    expect(log.filter((line) => line.includes("was obtained"))).toEqual([`${words} server`, `${words} cache`]);
  });

  it("moves a floating reference of a versionable type to the current generation", async () => {
    const { checker, writer, stub } = setup(server());
    const document = doc(item(related("old")));
    const unresolved: UnresolvedReference[] = [];
    await checker.checkRelatedItems(document, writer, unresolved);
    expect(outerXml(root(document))).toContain('<related_id keyed_name="k" type="Part">new</related_id>');
    expect(unresolved).toEqual([]);
    expect(stub.requests.map((request) => /select="([^"]*)"/.exec(request)?.[1])).toEqual([undefined, "is_versionable", "behavior", "config_id, is_current", "id"]);
  });

  it("leaves the reference alone when the relationship does not float, or the type is not versionable", async () => {
    for (const options of [{ behavior: "hard" }, { versionable: false }]) {
      const { checker, writer } = setup(server(options));
      const document = doc(item(related("old")));
      await checker.checkRelatedItems(document, writer, []);
      expect(outerXml(root(document))).toContain(">old</related_id>");
    }
  });

  it("tests the behavior as a substring", async () => {
    const { checker, writer } = setup(server({ behavior: "hard_not_float_really" }));
    const document = doc(item(related("old")));
    await checker.checkRelatedItems(document, writer, []);
    expect(outerXml(root(document))).toContain(">new</related_id>");
  });

  it("marks a missing floating reference to find the latest generation, and records 10001", async () => {
    const { checker, writer } = setup(server());
    const document = doc(item(related("missing")));
    const unresolved: UnresolvedReference[] = [];
    await checker.checkRelatedItems(document, writer, unresolved);
    expect(summary(unresolved)).toEqual([[10001, '<related_id keyed_name="k" type="Part" __find_latest_generation_="yes">missing</related_id>']]);
  });

  it("records a missing reference that does not float as 10001 without the marker", async () => {
    const { checker, writer } = setup(server({ behavior: "hard" }));
    const unresolved: UnresolvedReference[] = [];
    await checker.checkRelatedItems(doc(item(related("missing"))), writer, unresolved);
    expect(summary(unresolved)).toEqual([[10001, '<related_id keyed_name="k" type="Part">missing</related_id>']]);
  });

  it("treats a faultcode 0 of the versionable test as a missing item, and then fails on the repeated lookup", async () => {
    const { checker, writer, stub } = setup((wire) => (wire.includes('select="is_versionable"') ? NO_ITEMS("ItemType") : FOUND));
    const error = await failureOf(checker.checkRelatedItems(doc(item(related("missing"))), writer, []));
    expect((error as CItemException).faultcode).toBe(0);
    // the versionable test is sent twice: it failed, and a failure is not cached
    expect(stub.requests.filter((request) => request.includes("is_versionable"))).toHaveLength(2);
  });

  it("throws a null reference when the relationship type has no behavior", async () => {
    const { checker, writer } = setup(server({ behavior: null }));
    const error = await failureOf(checker.checkRelatedItems(doc(item(related("old"))), writer, []));
    expect((error as DotNetException).typeName).toBe("System.NullReferenceException");
  });

  it("selects the related_id of items that are not RelationshipTypes and have no nested Item, and skips one without a type or keyed_name", async () => {
    const { checker, writer, stub } = setup(server({ versionable: false }));
    await checker.checkRelatedItems(
      doc(
        item(
          related("a", ' keyed_name="k"') +
            related("b", ' type="Part"') +
            related("c", ' keyed_name="" type="Part"') +
            '<related_id keyed_name="k" type="Part"><Item type="Part" action="get"/></related_id>',
        ),
      ),
      writer,
      [],
    );
    await checker.checkRelatedItems(
      doc('<Item type="RelationshipType" id="R1"><related_id keyed_name="k" type="ItemType">I1</related_id></Item>'),
      writer,
      [],
    );
    await checker.checkRelatedItems(doc('<Item><related_id keyed_name="k" type="Part">I1</related_id></Item>'), writer, []);
    expect(stub.requests).toEqual([]);
  });

  it("throws a fault with another code from the get", async () => {
    const { checker, writer } = setup(() => stubFault("8", "no"));
    const error = await failureOf(checker.checkRelatedItems(doc(item(related("old"))), writer, []));
    expect((error as CItemException).faultcode).toBe(8);
  });

  it("explains GetCurrentIdOfVersion: the id itself when it is current, the current generation otherwise, an error when nothing matches", async () => {
    const current = setup((wire) => (wire.includes("is_current") ? stubResult('<Item type="Part" id="x"><config_id>c1</config_id><is_current>1</is_current></Item>') : undefined));
    expect(await current.helper.lookups.getCurrentIdOfVersion("x", "Part")).toBe("x");
    const old = setup(server());
    expect(await old.helper.lookups.getCurrentIdOfVersion("old", "Part")).toBe("new");
    const nothing = setup(() => NO_ITEMS("Part"));
    const error = await failureOf(nothing.helper.lookups.getCurrentIdOfVersion("zzz", "Part"));
    expect(error).toBeInstanceOf(CItemException);
    expect((error as CItemException).faultcode).toBe(-1);
    expect(error.message.endsWith("Unable to find a current version of the item (ID='zzz'; Type='Part')")).toBe(true);
  });
});

describe("the RelationshipType checks (IMP-160, IMP-161)", () => {
  const relationshipType = (ends: string, extra = ""): string => `<Item type="RelationshipType" id="R1" action="add"><name>rt</name>${ends}${extra}</Item>`;
  const end = (name: string, text: string, attributes = ' keyed_name="Part" type="ItemType"'): string => `<${name}${attributes}>${text}</${name}>`;
  const run = async (respond: (wire: string) => string | undefined, xml: string) => {
    const set = setup((wire) => respond(wire) ?? undefined);
    const unresolved: UnresolvedReference[] = [];
    let failure: Error | undefined;
    try {
      await set.checker.recurseCheck(doc(xml), set.writer, unresolved);
    } catch (error) {
      failure = error as Error;
    }
    return { ...set, unresolved, failure };
  };
  const known = (wire: string) => (DEFINITION_REQUEST.test(wire) ? definition(["Relationship View"]) : FOUND);

  it("asks for the ItemType of each source_id and related_id, in document order, and logs it", async () => {
    const { log, failure, stub } = await run(known, relationshipType(end("source_id", "S1") + end("related_id", "S2")));
    expect(failure).toBeUndefined();
    expect(stub.requests.slice(1)).toEqual([
      '<Item levels="0" action="get" type="ItemType"><id>S1</id></Item>',
      '<Item levels="0" action="get" type="ItemType"><id>S2</id></Item>',
    ]);
    expect(log.slice(-6)).toEqual([
      "checking RelationshipType's source_id,related_id",
      "<Item levels='0' action='get' type='ItemType'><id>S1</id></Item>",
      "  was obtained from server",
      "checking RelationshipType's source_id,related_id",
      "<Item levels='0' action='get' type='ItemType'><id>S2</id></Item>",
      "  was obtained from server",
    ]);
  });

  it("fails when an end names an ItemType that does not exist, with the whole server text and not the detail (IMP-180)", async () => {
    const { failure } = await run(
      (wire) => (wire.includes('type="ItemType"><id>S1</id>') ? NO_ITEMS("ItemType") : known(wire)),
      relationshipType(end("source_id", "S1")),
    );
    const error = failure as CItemException;
    expect(error.faultcode).toBe(-1);
    expect(error.message.startsWith("Server error\r\n\r\nRequest: <Item levels='0' action='get' type='ItemType'><id>S1</id></Item>\r\n\r\nResponce: ")).toBe(true);
    expect(error.message.endsWith(" Recurse check has failed.")).toBe(true);
    expect((error.cause as CItemException).faultdetail).toBe("Bad source_id Part for rt");
  });

  it("skips an end that holds a nested item, or has no type or keyed_name", async () => {
    const { failure, stub } = await run(
      known,
      relationshipType(
        '<source_id keyed_name="Part" type="ItemType"><Item type="ItemType" action="get"><name>Part</name></Item></source_id>' + end("related_id", "S2", ' type="ItemType"') + end("related_id", "S3", ' keyed_name="k"'),
      ),
    );
    expect(failure).toBeUndefined();
    expect(stub.requests.some((request) => request.includes("<id>S"))).toBe(false);
  });

  it("takes the name from the first RelationshipType name anywhere in the document", async () => {
    const { failure } = await run(
      (wire) => (wire.includes("<id>S1</id>") ? NO_ITEMS("ItemType") : known(wire)),
      `<Item type="Wrapper" id="W">${relationshipType(end("source_id", "S1"))}</Item>`,
    );
    expect(((failure as CItemException).cause as CItemException).faultdetail).toBe("Bad source_id Part for rt");
  });

  it("asks for each grid of a Relationship View", async () => {
    const view = '<Relationships><Item type="Relationship View" id="V1" action="add"><grid keyed_name="G" type="Grid">G1</grid></Item></Relationships>';
    const { log, failure, stub } = await run(known, relationshipType("", view));
    expect(failure).toBeUndefined();
    expect(stub.requests.slice(-1)).toEqual(['<Item levels="0" action="get" type="Grid"><id>G1</id></Item>']);
    expect(log.slice(-3)).toEqual(["checking Grids types", "<Item levels='0' action='get' type='Grid'><id>G1</id></Item>", "  was obtained from server"]);
  });

  it("fails when the grid does not exist, with the detail of the grid that nothing shows", async () => {
    const view = '<Relationships><Item type="Relationship View" id="V1" action="add"><grid keyed_name="G" type="Grid">G1</grid></Item></Relationships>';
    const { failure } = await run((wire) => (wire.includes("type=\"Grid\"") ? NO_ITEMS("Grid") : known(wire)), relationshipType("", view));
    expect(((failure as CItemException).cause as CItemException).faultdetail).toBe("Bad Grid G for rt");
  });

  it("sends the concatenated text of a grid that holds a nested item, because it is not excluded", async () => {
    const view = '<Relationships><Item type="Relationship View" id="V1" action="add"><grid keyed_name="G" type="Grid"><Item type="Grid" action="get"><name>grid</name></Item></grid></Item></Relationships>';
    const { stub } = await run(known, relationshipType("", view));
    expect(stub.requests.some((request) => request === '<Item levels="0" action="get" type="Grid"><id>grid</id></Item>')).toBe(true);
  });

  it("fails with a null reference when no RelationshipType in the document has a name and the check needs it", async () => {
    const { failure } = await run(
      (wire) => (wire.includes("<id>S1</id>") ? NO_ITEMS("ItemType") : known(wire)),
      '<Item type="RelationshipType" id="R1" action="add"><source_id keyed_name="Part" type="ItemType">S1</source_id></Item>',
    );
    expect(failure?.message).toBe("Object reference not set to an instance of an object. Recurse check has failed.");
  });
});

describe("the XPath of the checks reads through a parenthesis after and", () => {
  it("selects with a predicate of the form a and (b or c)", () => {
    const document = doc('<a><b x="1"/><b x="2"/></a>');
    expect(selectNodes("b[@x='1' and (@x='1' or @x='2')]", root(document)).length).toBe(1);
    expect(selectNodes("b[@x='1' or(@x='2')]", root(document)).length).toBe(2);
  });
});
