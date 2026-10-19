import { describe, expect, it } from "vitest";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { StubConnection, stubFault, stubResult } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import { documentElementOf } from "../xml/dom.js";
import type { XmlDocument, XmlElement } from "../xml/dom.js";
import { loadXml } from "../xml/parser.js";
import { outerXml } from "../xml/writer-legacy.js";
import { ReferenceChecker } from "./reference-checks.js";
import type { DelayedResolution, UnresolvedReference } from "./reference-checks.js";

/**
 * The reference checks of 14.35 (IMP-102, IMP-110, IMP-111, IMP-120, IMP-132, IMP-140, IMP-150, IMP-160, IMP-161, IMP-181,
 * IMP-182): the cases of the probes `n01` to `n04b` of `fixtures/import-run/probe-14.35.txt`, run against the port with a stub
 * that answers as the probe's world does. The recorded 14.35 runs (`import-run.replay.test.ts`) replay the same rules end to end.
 */
const NO_ITEMS = (type: string): string => stubFault("0", `No items of type ${type} found.`);
const FOUND = stubResult('<Item type="X" id="Z1"/>');
const DEFINITION_REQUEST = /^<Item type="ItemType" action="get" select="id"><name>([^<]*)<\/name><Relationships>/;
const definition = (relationshipTypes: string[] = []): string =>
  stubResult(
    `<Item type="ItemType" id="T1"><Relationships>${relationshipTypes.map((name) => `<Item type="RelationshipType"><name>${name}</name></Item>`).join("")}</Relationships></Item>`,
  );

function setup(respond: (wire: string) => string | undefined = () => FOUND) {
  const stub = new StubConnection((wire) => respond(wire) ?? NO_ITEMS("Item"));
  const helper = new CItemHelper(stub, { engine: "14.35" });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  const log: string[] = [];
  return { checker: new ReferenceChecker(helper), helper, stub, log, writer: { writeLine: (text: string) => void log.push(text) } };
}

const doc = (xml: string): XmlDocument => loadXml(xml, { preserveWhitespace: false });
const root = (document: XmlDocument): XmlElement => documentElementOf(document)!;

async function failureOf(work: Promise<unknown>): Promise<Error> {
  try {
    await work;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a failure");
}

const SERVER = "-> was obtained from server";
const CACHE = "-> was obtained from cache";

describe("14.35 CheckGetItems: the line is written before the request, and a hit writes nothing (IMP-120, IMP-181, probes n01, n02)", () => {
  const item = `<Item type="Part" id="P1" action="add"><owner_id><Item type="Identity" action="get" select="id"><keyed_name>g</keyed_name></Item></owner_id></Item>`;

  it("writes 'from server' for a miss and nothing for the next hit", async () => {
    const { checker, writer, log, stub } = setup();
    await checker.checkGetItems(doc(item), writer, []);
    await checker.checkGetItems(doc(item), writer, []);
    const request = '<Item type="Identity" action="get" select="id"><keyed_name>g</keyed_name></Item>';
    expect(log).toEqual([`checking item with get action:${request}`, SERVER, `checking item with get action:${request}`]);
    expect(stub.requests).toHaveLength(1);
  });

  it("has written the line when the request is then refused (probe n02), and removes the entry so it is sent again", async () => {
    const { checker, writer, log, stub } = setup(() => stubFault("5", "no"));
    const first = await failureOf(checker.checkGetItems(doc(item), writer, []));
    expect((first as CItemException).faultcode).toBe(5);
    expect(log.at(-1)).toBe(SERVER);
    await failureOf(checker.checkGetItems(doc(item), writer, []));
    expect(stub.requests).toHaveLength(2);
  });

  it("queues a get that finds nothing (code 0 under an unlisted parent) and asks again next time", async () => {
    const { checker, writer, stub } = setup(() => NO_ITEMS("Identity"));
    const unresolved: UnresolvedReference[] = [];
    await checker.checkGetItems(doc(item), writer, unresolved);
    await checker.checkGetItems(doc(item), writer, unresolved);
    expect(unresolved.map((entry) => entry.faultcode)).toEqual([0, 0]);
    expect(stub.requests).toHaveLength(2);
  });

  it("14.0.7 writes 'from cache' for the hit", async () => {
    const stub = new StubConnection(() => FOUND);
    const helper = new CItemHelper(stub);
    const log: string[] = [];
    const writer = { writeLine: (text: string) => void log.push(text) };
    const checker = new ReferenceChecker(helper);
    await checker.checkGetItems(doc(item), writer, []);
    await checker.checkGetItems(doc(item), writer, []);
    expect(log.filter((line) => line === CACHE)).toHaveLength(1);
  });
});

describe("14.35 CheckRelationshipItems: the entry of a template with nested items is removed (IMP-110, IMP-111, probes n04, n04b)", () => {
  const forum = (id: string, inner: string): string =>
    `<Item type="Forum" id="F1" action="add"><Relationships><Item type="DiscussionTemplate" id="${id}" action="add">${inner}</Item></Relationships></Item>`;
  const nested = '<Relationships><Item type="FeedTemplate" action="add"/></Relationships>';

  it("rewrites and queues every element with the id of a template that has nested items (probe n04)", async () => {
    const { checker, writer, log, stub } = setup();
    const first = doc(forum("D1", nested));
    const second = doc(forum("D1", nested));
    const unresolved: UnresolvedReference[] = [];
    await checker.checkRelationshipItems(first, writer, unresolved);
    await checker.checkRelationshipItems(second, writer, unresolved);
    for (const item of [first, second]) {
      expect(outerXml(root(item))).toContain('<Item type="DiscussionTemplate" id="D1" action="edit"><Relationships><Item type="FeedTemplate" action="merge" />');
    }
    expect(unresolved.map((entry) => entry.faultcode)).toEqual([10005, 10005]);
    expect(stub.requests).toHaveLength(2);
    expect(log.filter((line) => line === SERVER)).toHaveLength(2);
    expect(log).not.toContain(CACHE);
  });

  it("keeps the entry of a template without nested items, so a later element with nested items is left alone (probe n04b)", async () => {
    const { checker, writer, log, stub } = setup();
    const first = doc(forum("D1", "<name>t</name>"));
    const second = doc(forum("D1", nested));
    const unresolved: UnresolvedReference[] = [];
    await checker.checkRelationshipItems(first, writer, unresolved);
    await checker.checkRelationshipItems(second, writer, unresolved);
    expect(unresolved).toEqual([]);
    expect(outerXml(root(second))).toContain('<Item type="DiscussionTemplate" id="D1" action="add">');
    expect(stub.requests).toHaveLength(1);
    expect(log.at(-1)).toBe(CACHE);
  });

  it("removes the entry of a missing template, which is queued as it is, and of a refused one", async () => {
    const missing = setup(() => NO_ITEMS("DiscussionTemplate"));
    const item = doc(forum("D1", nested));
    const unresolved: UnresolvedReference[] = [];
    await missing.checker.checkRelationshipItems(item, missing.writer, unresolved);
    await missing.checker.checkRelationshipItems(item, missing.writer, unresolved);
    expect(unresolved.map((entry) => entry.faultcode)).toEqual([10005, 10005]);
    expect(missing.stub.requests).toHaveLength(2);

    const refused = setup(() => stubFault("5", "no"));
    await failureOf(refused.checker.checkRelationshipItems(item, refused.writer, []));
    await failureOf(refused.checker.checkRelationshipItems(item, refused.writer, []));
    expect(refused.stub.requests).toHaveLength(2);
  });
});

describe("14.35 CheckPropertiesAndRelationshipTypes: a forced refresh is not stored (IMP-130, IMP-132, IMP-182, probe n03)", () => {
  it("sends the definition of Part four times for three Part items whose first answer lacks the relationship type", async () => {
    let parts = 0;
    const { checker, writer, stub } = setup((wire) => {
      const type = DEFINITION_REQUEST.exec(wire)?.[1];
      if (type === "Part") return definition(parts++ === 0 ? [] : ["Part BOM"]);
      return definition();
    });
    for (let i = 0; i < 3; i += 1) {
      const item = doc(`<Item type="Part" id="P${i}" action="add"><Relationships><Item type="Part BOM" action="add"/></Relationships></Item>`);
      await checker.checkPropertiesAndRelationshipTypes(item, writer);
    }
    expect(stub.requests.filter((wire) => DEFINITION_REQUEST.exec(wire)?.[1] === "Part")).toHaveLength(4);
  });

  it("writes the text and 'from cache' or 'from server' around the definition (IMP-132)", async () => {
    const { checker, writer, log } = setup(() => definition(["Part BOM"]));
    const item = doc(`<Item type="Part" id="P1" action="add"/>`);
    await checker.checkPropertiesAndRelationshipTypes(item, writer);
    await checker.checkPropertiesAndRelationshipTypes(item, writer);
    expect(log).toHaveLength(4);
    expect(log[1]).toBe("  was obtained from server");
    expect(log[3]).toBe("  was obtained from cache");
  });
});

describe("14.35 CheckDataSourceReferences, CheckRelatedItems and the RelationshipType checks (IMP-140, IMP-150, IMP-160, IMP-161, IMP-181)", () => {
  const property = `<Item type="ItemType" id="IT" action="add"><Relationships><Item type="Property" id="P1" action="add"><data_type>list</data_type><data_source>LID1</data_source></Item></Relationships></Item>`;

  it("writes the request, then 'from server' before it is sent, and nothing for a hit (probe n01)", async () => {
    const { checker, writer, log } = setup();
    await checker.checkDataSourceReferences(doc(property), writer, []);
    await checker.checkDataSourceReferences(doc(property), writer, []);
    expect(log).toEqual([
      "checking <data_source> reference to list/sequence",
      "<Item action='get' type='list' select='id'><id>LID1</id></Item>",
      "  was obtained from server",
      "checking <data_source> reference to list/sequence",
      "<Item action='get' type='list' select='id'><id>LID1</id></Item>",
    ]);
  });

  it("has written 'from server' when the data source is refused (probe n02b), removes the entry, and queues fault 0", async () => {
    const refused = setup(() => stubFault("5", "no"));
    await failureOf(refused.checker.checkDataSourceReferences(doc(property), refused.writer, []));
    expect(refused.log.at(-1)).toBe("  was obtained from server");
    await failureOf(refused.checker.checkDataSourceReferences(doc(property), refused.writer, []));
    expect(refused.stub.requests).toHaveLength(2);

    const missing = setup(() => NO_ITEMS("list"));
    const unresolved: UnresolvedReference[] = [];
    await missing.checker.checkDataSourceReferences(doc(property), missing.writer, unresolved);
    await missing.checker.checkDataSourceReferences(doc(property), missing.writer, unresolved);
    expect(unresolved.map((entry) => entry.faultcode)).toEqual([10000, 10000]);
    expect(missing.stub.requests).toHaveLength(2);
  });

  it("removes the entry of the get of a related item when a later lookup of the check throws a CItemException (IMP-150)", async () => {
    const related = `<Item type="Part" id="P1" action="add"><related_id keyed_name="k" type="Part">R1</related_id></Item>`;
    const { checker, writer, stub } = setup((wire) => {
      if (wire.includes("is_versionable")) return stubFault("999", "boom");
      return FOUND;
    });
    await failureOf(checker.checkRelatedItems(doc(related), writer, []));
    await failureOf(checker.checkRelatedItems(doc(related), writer, []));
    expect(stub.requests.filter((wire) => wire.includes("<id>R1</id>"))).toHaveLength(2);
  });

  it("writes 'from server' before the lookup of a RelationshipType's end and of a grid, and nothing for a hit (IMP-160, IMP-161)", async () => {
    const relationshipType = `<Item type="RelationshipType" id="R" action="add"><name>rt</name><source_id keyed_name="Part" type="ItemType">S1</source_id><Relationships><Item type="Relationship View" action="add"><grid keyed_name="G" type="Grid">GR1</grid></Item></Relationships></Item>`;
    const { checker, writer, log, stub } = setup((wire) => (DEFINITION_REQUEST.test(wire) ? definition(["Relationship View"]) : FOUND));
    const unresolved: UnresolvedReference[] = [];
    await checker.recurseCheck(doc(relationshipType), writer, unresolved);
    const first = log.length;
    await checker.recurseCheck(doc(relationshipType), writer, unresolved);
    expect(log.slice(0, first).filter((line) => line === "  was obtained from server").length).toBeGreaterThanOrEqual(2);
    expect(log.slice(first).filter((line) => line === "  was obtained from server")).toEqual([]);
    // the second pass sent only the lookups that are not cached; the two checks sent theirs once
    expect(stub.requests.filter((wire) => wire.includes("<id>S1</id>") || wire.includes("<id>GR1</id>"))).toHaveLength(2);
  });

  it("removes the entry of a missing end and sets the detail (IMP-160)", async () => {
    const relationshipType = `<Item type="RelationshipType" id="R" action="add"><name>rt</name><source_id keyed_name="Part" type="ItemType">S1</source_id></Item>`;
    const { checker, writer, stub } = setup((wire) => (wire.includes("<id>S1</id>") ? NO_ITEMS("ItemType") : FOUND));
    for (let i = 0; i < 2; i += 1) {
      const error = await failureOf(checker.recurseCheck(doc(relationshipType), writer, []));
      expect(error.message).toContain("Recurse check has failed.");
    }
    expect(stub.requests.filter((wire) => wire.includes("<id>S1</id>"))).toHaveLength(2);
  });
});

describe("the DoChecking handler hands the references on as before (IMP-100)", () => {
  it("works over a 14.35 helper", async () => {
    const { checker, writer } = setup((wire) => (DEFINITION_REQUEST.test(wire) ? definition() : FOUND));
    const received: UnresolvedReference[][] = [];
    const manager: DelayedResolution = { processForDelayedResolution: (list) => void received.push([...list]) };
    await checker.doChecking(manager, doc('<Item type="Part" id="P1" action="add"/>'), writer, true);
    expect(received).toEqual([]);
  });
});
