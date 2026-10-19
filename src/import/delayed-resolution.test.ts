import { describe, expect, it } from "vitest";
import { DotNetException } from "../client/dotnet.js";
import type { XmlDocument, XmlNode } from "../xml/dom.js";
import { XmlException } from "../xml/errors.js";
import { loadXml } from "../xml/parser.js";
import { selectSingleNode } from "../xml/xpath.js";
import { outerXml } from "../xml/writer-legacy.js";
import {
  DelayedResolutionManager,
  FAKED_DATA_SOURCE,
  WrongFormatOfTheAmlException,
  type DelayedResolutionHelper,
} from "./delayed-resolution.js";
import type { UnresolvedReference } from "./reference-checks.js";

const WARNING_HEAD = "WARNING: The following portion of the AML \n";
const WARNING_TAIL = "\ncontains unresolved reference that will be tried to resolve at the end of the package import";

const parse = (xml: string): XmlDocument => loadXml(xml, { preserveWhitespace: false });
const at = (doc: XmlDocument, path: string): XmlNode => {
  const node = selectSingleNode(path, doc);
  if (!node) throw new Error(`no node at ${path}`);
  return node;
};
const ref = (faultcode: number, problemNode: XmlNode): UnresolvedReference => ({ faultcode, problemNode });

class Log {
  readonly lines: string[] = [];
  writeLine(text: string): void {
    this.lines.push(text);
  }
}

/** Processes the references and returns what the manager queued and logged. */
function run(manager: DelayedResolutionManager, references: UnresolvedReference[]): Log {
  const log = new Log();
  manager.processForDelayedResolution(references, log);
  return log;
}

function failure(manager: DelayedResolutionManager, references: UnresolvedReference[]): WrongFormatOfTheAmlException {
  try {
    run(manager, references);
  } catch (error) {
    expect(error).toBeInstanceOf(WrongFormatOfTheAmlException);
    return error as WrongFormatOfTheAmlException;
  }
  throw new Error("the processing did not fail");
}

const innerTypeName = (error: WrongFormatOfTheAmlException): string => (error.innerException as DotNetException).typeName;

describe("DelayedResolutionManager: the manager and its queue (IMP-200)", () => {
  it("starts with an empty queue and is built for every engine", () => {
    expect(new DelayedResolutionManager().queue).toEqual([]);
    for (const engine of ["12.0", "14.0.7", "14.35"] as const) expect(new DelayedResolutionManager(engine).engine).toBe(engine);
  });

  it("keeps the entries of every item of the package in the order they were added, without deduplicating", () => {
    const manager = new DelayedResolutionManager();
    for (let pass = 0; pass < 2; pass += 1) {
      const doc = parse(
        `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='add'><related_id type='Part'>B</related_id></Item></Relationships></Item>`,
      );
      run(manager, [ref(10001, at(doc, "//related_id"))]);
    }
    expect(manager.queue).toHaveLength(2);
    expect(manager.queue[0]).toBe(manager.queue[1]);
  });
});

describe("14.35: the queue holds each entry once (IMP-250, IMP-251)", () => {
  const relationship = (related: string): string =>
    `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='add'><related_id type='Part'>${related}</related_id></Item></Relationships></Item>`;

  it("drops a second entry equal to a queued one, and still detaches the node (IMP-210)", () => {
    const manager = new DelayedResolutionManager("14.35");
    const first = parse(relationship("B"));
    const second = parse(relationship("B"));
    run(manager, [ref(10001, at(first, "//related_id"))]);
    run(manager, [ref(10001, at(second, "//related_id"))]);
    expect(manager.queue).toHaveLength(1);
    expect(outerXml(second.documentElement!)).toBe(`<Item type="Part" id="A" action="add"><Relationships></Relationships></Item>`);
  });

  it("keeps entries that differ in any character", () => {
    const manager = new DelayedResolutionManager("14.35");
    run(manager, [ref(10001, at(parse(relationship("B")), "//related_id"))]);
    run(manager, [ref(10001, at(parse(relationship("C")), "//related_id"))]);
    expect(manager.queue).toHaveLength(2);
  });

  it("deduplicates a relationship item (IMP-212) and a data source (IMP-220), and still writes the zero id", () => {
    const manager = new DelayedResolutionManager("14.35");
    const template = (): XmlDocument =>
      parse(`<Item type='ItemType' id='IT' action='add'><Relationships><Item type='Property' id='P1' action='add'><data_type>list</data_type><data_source type='List'>L</data_source></Item></Relationships></Item>`);
    const a = template();
    const b = template();
    run(manager, [ref(10000, at(a, "//data_source"))]);
    run(manager, [ref(10000, at(b, "//data_source"))]);
    expect(manager.queue).toHaveLength(1);
    expect(outerXml(at(b, "//data_source"))).toBe(`<data_source type="List">${FAKED_DATA_SOURCE}</data_source>`);

    const owner = (): XmlDocument =>
      parse(`<Item type='Part' id='A'><Relationships><Item type='Part BOM' id='R1'><related_id>B</related_id></Item></Relationships></Item>`);
    const c = owner();
    const d = owner();
    run(manager, [ref(10005, at(c, "//Item[@id='R1']"))]);
    run(manager, [ref(10005, at(d, "//Item[@id='R1']"))]);
    expect(manager.queue).toHaveLength(2);
    expect(outerXml(at(d, "//Relationships"))).toBe(`<Relationships></Relationships>`);
  });

  it("14.0.7 still queues both", () => {
    const manager = new DelayedResolutionManager("14.0.7");
    run(manager, [ref(10001, at(parse(relationship("B")), "//related_id"))]);
    run(manager, [ref(10001, at(parse(relationship("B")), "//related_id"))]);
    expect(manager.queue).toHaveLength(2);
  });
});

describe("14.35: a Property with no id is addressed by its where (IMP-220)", () => {
  const edit = (property: string): string => {
    const manager = new DelayedResolutionManager("14.35");
    const doc = parse(
      `<Item type='ItemType' id='IT' action='add'><Relationships>${property}</Relationships></Item>`,
    );
    run(manager, [ref(10000, at(doc, "//data_source"))]);
    return manager.queue[0] as string;
  };

  it("uses the id when there is one", () => {
    expect(edit(`<Item type='Property' id='P1' where="name='p'"><data_type>text</data_type><data_source>X</data_source></Item>`)).toBe(
      `<Item type='ItemType' id='IT' action='edit' doGetItem='0'><Relationships><Item type='Property' id='P1' action='edit'><data_source>X</data_source></Item></Relationships></Item>`,
    );
  });

  it.each([
    [`where="name='p1' and source_id='I1'"`, `where="name='p1' and source_id='I1'"`],
    [`id='' where="a"`, `where="a"`],
    ["", `where=""`],
  ])("addresses a Property with attributes %j by %j", (attributes, address) => {
    expect(edit(`<Item type='Property' ${attributes}><data_type>text</data_type><data_source>X</data_source></Item>`)).toBe(
      `<Item type='ItemType' id='IT' action='edit' doGetItem='0'><Relationships><Item type='Property' ${address} action='edit'><data_source>X</data_source></Item></Relationships></Item>`,
    );
  });

  it("does not escape the where (IMP-204)", () => {
    expect(edit(`<Item type='Property' where="a&amp;b"><data_type>text</data_type><data_source>X</data_source></Item>`)).toContain(`where="a&b"`);
  });
});

describe("ProcessForDelayedResolution (IMP-201, IMP-202)", () => {
  it("writes the warning line of each reference with the node as it is at that moment, before the edit", () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(
      `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='add'><related_id type='Part'>B</related_id></Item></Relationships></Item>`,
    );
    const node = at(doc, "//related_id");
    const log = run(manager, [ref(10001, node)]);
    expect(log.lines).toEqual([`${WARNING_HEAD}<related_id type="Part">B</related_id>${WARNING_TAIL}`]);
  });

  it("handles the references in list order, each on the document the earlier ones left", () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(
      `<Item type='Part' id='A' action='add'><Relationships>` +
        `<Item type='Part BOM' action='add'><related_id type='Part'>B</related_id></Item>` +
        `<Item type='Part BOM' action='add'><related_id type='Part'>C</related_id></Item>` +
        `</Relationships></Item>`,
    );
    const log = run(manager, [ref(10001, at(doc, "//Item[2]/related_id")), ref(10001, at(doc, "//Item[1]/related_id"))]);
    expect(log.lines).toHaveLength(2);
    expect(manager.queue[0]).toContain("<related_id type=\"Part\">C</related_id>");
    expect(manager.queue[1]).toContain("<related_id type=\"Part\">B</related_id>");
    expect(outerXml(doc.documentElement!)).toBe(`<Item type="Part" id="A" action="add"><Relationships></Relationships></Item>`);
  });

  it("writes only the warning for 10002, 10003, 0 and unknown codes, and goes on (IMP-230)", () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(`<Item type='RelationshipType' id='R'><source_id>S</source_id><related_id>T</related_id></Item>`);
    const before = outerXml(doc.documentElement!);
    const nodes = [at(doc, "//source_id"), at(doc, "//related_id"), at(doc, "//source_id"), at(doc, "//related_id")];
    const log = run(manager, [ref(10002, nodes[0]!), ref(10003, nodes[1]!), ref(0, nodes[2]!), ref(10006, nodes[3]!)]);
    expect(log.lines).toHaveLength(4);
    expect(manager.queue).toEqual([]);
    expect(outerXml(doc.documentElement!)).toBe(before);
  });

  it("does nothing for an empty list", () => {
    const manager = new DelayedResolutionManager();
    expect(run(manager, []).lines).toEqual([]);
  });

  it("uses the text of the node as the engine DOM writes it, with the apostrophes and ampersands decoded and raw in the entry (IMP-204)", () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(
      `<Item type="Pa'rt" id="A" action="add"><Relationships><Item type="Part BOM" action="add"><related_id keyed_name="A &amp; B" type="Part">B</related_id></Item></Relationships></Item>`,
    );
    run(manager, [ref(10001, at(doc, "//related_id"))]);
    expect(manager.queue[0]).toBe(
      `<Item type='Pa'rt' id='A' action='edit' doGetItem='0' version='0'><Relationships><Item type="Part BOM" action="add"><related_id keyed_name="A &amp; B" type="Part">B</related_id></Item></Relationships></Item>`,
    );
  });
});

describe("a missing related item, code 10001 (IMP-210, IMP-211)", () => {
  it("detaches the relationship as an add under an edit of the owner (the probed result)", () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(
      `<Item type='Part' id='AAA' action='add'><Relationships><Item type='Part BOM' action='add'><related_id keyed_name='x' type='Part'>BBB</related_id></Item></Relationships></Item>`,
    );
    run(manager, [ref(10001, at(doc, "//related_id"))]);
    expect(manager.queue).toEqual([
      `<Item type='Part' id='AAA' action='edit' doGetItem='0' version='0'><Relationships><Item type="Part BOM" action="add"><related_id keyed_name="x" type="Part">BBB</related_id></Item></Relationships></Item>`,
    ]);
    expect(outerXml(doc.documentElement!)).toBe(`<Item type="Part" id="AAA" action="add"><Relationships></Relationships></Item>`);
  });

  it("sets the action of a relationship that had none after its other attributes, and keeps the place of an existing one", () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(
      `<Item type='Part' id='R' action='add'><Relationships><Item type='Part BOM' id='R1'><related_id type='Part'>B</related_id></Item></Relationships></Item>`,
    );
    run(manager, [ref(10001, at(doc, "//related_id"))]);
    expect(manager.queue[0]).toContain(`<Item type="Part BOM" id="R1" action="add">`);

    const second = new DelayedResolutionManager();
    const other = parse(
      `<Item type='Part' id='R' action='add'><Relationships><Item action='merge' type='Part BOM'><related_id type='Part'>B</related_id></Item></Relationships></Item>`,
    );
    run(second, [ref(10001, at(other, "//related_id"))]);
    expect(second.queue[0]).toContain(`<Item action="add" type="Part BOM">`);
  });

  it("carries the whole relationship: nested relationships and the floating-reference attribute (IMP-242)", () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(
      `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='add'>` +
        `<related_id __find_latest_generation_='yes' type='Part'>B</related_id>` +
        `<Relationships><Item type='Alt' action='add' /></Relationships></Item></Relationships></Item>`,
    );
    run(manager, [ref(10001, at(doc, "//related_id"))]);
    expect(manager.queue[0]).toContain(`<related_id __find_latest_generation_="yes" type="Part">B</related_id><Relationships><Item type="Alt" action="add" /></Relationships></Item></Relationships></Item>`);
  });

  it("addresses the owner by id when it has one, even empty, and by id also when it has neither id nor where", () => {
    const build = (owner: string) =>
      parse(`<Item ${owner} action='add'><Relationships><Item type='R' action='add'><related_id type='P'>B</related_id></Item></Relationships></Item>`);
    const entryFor = (owner: string): string => {
      const manager = new DelayedResolutionManager();
      run(manager, [ref(10001, at(build(owner), "//related_id"))]);
      return manager.queue[0]!;
    };
    expect(entryFor(`type='Part' id=''`)).toContain(`<Item type='Part' id='' action='edit'`);
    expect(entryFor(`type='Part' id='X' where="a='b'"`)).toContain(`<Item type='Part' id='X' action='edit'`);
  });

  it("queues the text System.Xml.XmlAttribute for an owner addressed only by where (IMP-211, bug)", () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(
      `<Item type='Part' where="item_number='A1'" action='edit'><Relationships><Item type='Part BOM' action='add'><related_id type='Part'>B</related_id></Item></Relationships></Item>`,
    );
    run(manager, [ref(10001, at(doc, "//related_id"))]);
    expect(manager.queue[0]).toBe(
      `<Item type='Part' where='System.Xml.XmlAttribute' action='edit' doGetItem='0' version='0'><Relationships><Item type="Part BOM" action="add"><related_id type="Part">B</related_id></Item></Relationships></Item>`,
    );
  });

  it.each([
    ["an owner with no type", `<Item id='A'><Relationships><Item type='R'><related_id>B</related_id></Item></Relationships></Item>`],
    ["an owner with neither id nor where", `<Item type='Part'><Relationships><Item type='R'><related_id>B</related_id></Item></Relationships></Item>`],
    ["a relationship that is the root item", `<Item type='R'><related_id>B</related_id></Item>`],
  ])("fails with a wrapped NullReferenceException for %s and changes nothing", (_name, xml) => {
    const manager = new DelayedResolutionManager();
    const doc = parse(xml);
    const before = outerXml(doc.documentElement!);
    const error = failure(manager, [ref(10001, at(doc, "//related_id"))]);
    expect(innerTypeName(error)).toBe("System.NullReferenceException");
    expect(outerXml(doc.documentElement!)).toBe(before);
    expect(manager.queue).toEqual([]);
  });

  it("fails with a wrapped InvalidCastException when the parent is not an element", () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(`<related_id>B</related_id>`);
    const error = failure(manager, [ref(10001, doc.documentElement!)]);
    expect(innerTypeName(error)).toBe("System.InvalidCastException");
  });
});

describe("a relationship item that could not be resolved, code 10005 (IMP-212, IMP-213)", () => {
  it("queues it as an edit of its owner, without changing its action (the probed result)", () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(
      `<Item type='Discussion Forum' id='AAA' action='add'><Relationships><Item type='DiscussionTemplate' id='T1' action='add'><name>x</name></Item></Relationships></Item>`,
    );
    run(manager, [ref(10005, at(doc, "//Item[@type='DiscussionTemplate']"))]);
    expect(manager.queue).toEqual([
      `<Item type='Discussion Forum' id='AAA' action='edit' doGetItem='0' version='0'><Relationships><Item type="DiscussionTemplate" id="T1" action="add"><name>x</name></Item></Relationships></Item>`,
    ]);
    expect(outerXml(doc.documentElement!)).toBe(`<Item type="Discussion Forum" id="AAA" action="add"><Relationships></Relationships></Item>`);
  });

  it("addresses an owner with no id, or with only a where, by an empty id (IMP-213, bug); a missing type does not fail", () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(
      `<Item type='Discussion Forum' where="name='f'" action='edit'><Relationships><Item type='DiscussionTemplate' id='T1' action='add' /></Relationships></Item>`,
    );
    run(manager, [ref(10005, at(doc, "//Item[@type='DiscussionTemplate']"))]);
    expect(manager.queue[0]).toContain(`<Item type='Discussion Forum' id='' action='edit' doGetItem='0' version='0'>`);

    const bare = new DelayedResolutionManager();
    const noType = parse(`<Item action='add'><Relationships><Item type='DiscussionTemplate' action='add' /></Relationships></Item>`);
    run(bare, [ref(10005, at(noType, "//Item[@type='DiscussionTemplate']"))]);
    expect(bare.queue[0]).toContain(`<Item type='' id='' action='edit'`);
  });

  it("fails with a wrapped InvalidCastException for the root item and a NullReferenceException for a detached node", () => {
    const manager = new DelayedResolutionManager();
    const root = parse(`<Item type='DiscussionTemplate' id='T1' action='add' />`);
    expect(innerTypeName(failure(manager, [ref(10005, root.documentElement!)]))).toBe("System.InvalidCastException");

    const holder = parse(`<Item type='F' id='A'><Relationships><Item type='DiscussionTemplate' /></Relationships></Item>`);
    const node = at(holder, "//Item[@type='DiscussionTemplate']");
    node.parentNode!.removeChild(node);
    expect(innerTypeName(failure(manager, [ref(10005, node)]))).toBe("System.NullReferenceException");

    // the owner would be the document itself
    const direct = parse(`<Relationships><Item type='DiscussionTemplate' /></Relationships>`);
    expect(innerTypeName(failure(manager, [ref(10005, at(direct, "//Item"))]))).toBe("System.InvalidCastException");
  });
});

describe("a data source or foreign property, codes 10000 and 10004 (IMP-220 to IMP-222)", () => {
  const itemType = (property: string): XmlDocument =>
    parse(`<Item type='ItemType' id='IT' action='add'><Relationships>${property}</Relationships></Item>`);
  const property = (dataType: string, source: string): string =>
    `<Item type='Property' id='P1' action='add'><data_type>${dataType}</data_type>${source}</Item>`;

  it("rewrites a bare list source as a get, queues the edit of the Property and sets the zero id", () => {
    const manager = new DelayedResolutionManager();
    const doc = itemType(property("list", `<data_source keyed_name='My List' type='List'>LID1</data_source>`));
    run(manager, [ref(10000, at(doc, "//data_source"))]);
    expect(manager.queue).toEqual([
      `<Item type='ItemType' id='IT' action='edit' doGetItem='0'><Relationships><Item type='Property' id='P1' action='edit'><data_source type='List'><Item type='List' keyed_name='My List' action='get'><id>LID1</id></Item></data_source></Item></Relationships></Item>`,
    ]);
    expect(outerXml(at(doc, "//data_source"))).toBe(`<data_source keyed_name="My List" type="List">${FAKED_DATA_SOURCE}</data_source>`);
  });

  it.each([
    ["list", "List"],
    ["filter list", "List"],
    ["color list", "List"],
    ["sequence", "Sequence"],
    ["item", "ItemType"],
  ])("types the get of a %s data source as %s, with an empty keyed_name when it has none (IMP-221)", (dataType, type) => {
    const manager = new DelayedResolutionManager();
    const doc = itemType(property(dataType, `<data_source>SID</data_source>`));
    run(manager, [ref(10000, at(doc, "//data_source"))]);
    expect(manager.queue[0]).toContain(`<data_source type='${type}'><Item type='${type}' keyed_name='' action='get'><id>SID</id></Item></data_source>`);
  });

  it.each(["mv_list", "LIST", "foreign", "list ", "Item"])("keeps the outer XML of a source whose data type is %j", (dataType) => {
    const manager = new DelayedResolutionManager();
    const doc = itemType(property(dataType, `<data_source keyed_name='K' type='List'>SID</data_source>`));
    run(manager, [ref(10000, at(doc, "//data_source"))]);
    expect(manager.queue[0]).toContain(`<Item type='Property' id='P1' action='edit'><data_source keyed_name="K" type="List">SID</data_source></Item>`);
  });

  it("keeps the outer XML of a source that already has a nested Item, nested item included, and sets the zero id over it", () => {
    const manager = new DelayedResolutionManager();
    const doc = itemType(property("list", `<data_source type='List'><Item type='List' action='get'><id>X</id></Item></data_source>`));
    run(manager, [ref(10000, at(doc, "//data_source"))]);
    expect(manager.queue[0]).toContain(`<data_source type="List"><Item type="List" action="get"><id>X</id></Item></data_source>`);
    expect(outerXml(at(doc, "//data_source"))).toBe(`<data_source type="List">${FAKED_DATA_SOURCE}</data_source>`);
  });

  it("never rewrites a foreign_property (10004), and keeps its attributes", () => {
    const manager = new DelayedResolutionManager();
    const doc = itemType(property("list", `<foreign_property keyed_name='FP' type='Property'>FID</foreign_property>`));
    const log = run(manager, [ref(10004, at(doc, "//foreign_property"))]);
    expect(log.lines).toHaveLength(1);
    expect(manager.queue[0]).toContain(`<foreign_property keyed_name="FP" type="Property">FID</foreign_property>`);
    expect(outerXml(at(doc, "//foreign_property"))).toBe(`<foreign_property keyed_name="FP" type="Property">${FAKED_DATA_SOURCE}</foreign_property>`);
  });

  it("addresses a Property with no id by an empty id, and reads a missing owner attribute as empty", () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(
      `<Item action='add'><Relationships><Item type='Property' action='add'><data_type>text</data_type><data_source>X</data_source></Item></Relationships></Item>`,
    );
    run(manager, [ref(10000, at(doc, "//data_source"))]);
    expect(manager.queue[0]).toBe(
      `<Item type='' id='' action='edit' doGetItem='0'><Relationships><Item type='Property' id='' action='edit'><data_source>X</data_source></Item></Relationships></Item>`,
    );
  });

  it("takes the data type from a child of the Property only", () => {
    const manager = new DelayedResolutionManager();
    const doc = itemType(
      `<Item type='Property' id='P1'><Relationships><Item type='x'><data_type>list</data_type></Item></Relationships><data_source>X</data_source></Item>`,
    );
    const error = failure(manager, [ref(10000, at(doc, "//data_source"))]);
    expect(innerTypeName(error)).toBe("System.NullReferenceException");
    expect(error.message).toBe(`Wrong format of the AML that contains tag <data_source>X</data_source>`);
    expect(manager.queue).toEqual([]);
    expect(outerXml(at(doc, "//data_source"))).toBe(`<data_source>X</data_source>`);
  });

  it("does not escape what it puts between the quotes (IMP-204)", () => {
    const manager = new DelayedResolutionManager();
    const doc = itemType(property("list", `<data_source keyed_name="A &amp; B 'x'">a&lt;b</data_source>`));
    run(manager, [ref(10000, at(doc, "//data_source"))]);
    expect(manager.queue[0]).toContain(`<data_source type='List'><Item type='List' keyed_name='A & B 'x'' action='get'><id>a<b</id></Item></data_source>`);
  });

  it("fails with a wrapped NullReferenceException when there is no owner, and with an InvalidCastException for a non-element node", () => {
    const manager = new DelayedResolutionManager();
    const orphan = parse(`<Item type='Property'><data_type>list</data_type><data_source>X</data_source></Item>`);
    expect(innerTypeName(failure(manager, [ref(10000, at(orphan, "//data_source"))]))).toBe("System.NullReferenceException");

    const text = parse(`<Item>x</Item>`).documentElement!.firstChild!;
    expect(() => run(manager, [ref(10000, text)])).toThrow(DotNetException);
    try {
      run(manager, [ref(10000, text)]);
    } catch (error) {
      expect(error).not.toBeInstanceOf(WrongFormatOfTheAmlException);
      expect((error as DotNetException).typeName).toBe("System.InvalidCastException");
    }
  });
});

describe("failures and live-document interplay (IMP-203, IMP-250)", () => {
  it("ends the call at the first failure and leaves the earlier effects in place", () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(
      `<Item type='Part' id='A' action='add'><Relationships>` +
        `<Item type='Part BOM' action='add'><related_id type='Part'>B</related_id></Item>` +
        `</Relationships><bad><related_id>Z</related_id></bad></Item>`,
    );
    const log = new Log();
    expect(() =>
      manager.processForDelayedResolution([ref(10001, at(doc, "//Item/related_id")), ref(10001, at(doc, "//bad/related_id")), ref(10001, at(doc, "//Item/related_id"))], log),
    ).toThrow(WrongFormatOfTheAmlException);
    expect(log.lines).toHaveLength(2);
    expect(manager.queue).toHaveLength(1);
  });

  it("fails on a node processed twice, because its relationship is already detached", () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(
      `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='add'><related_id type='Part'>B</related_id></Item></Relationships></Item>`,
    );
    const node = at(doc, "//related_id");
    run(manager, [ref(10001, node)]);
    const error = failure(manager, [ref(10001, node)]);
    expect(innerTypeName(error)).toBe("System.NullReferenceException");
    expect(error.message).toBe(`Wrong format of the AML that contains tag <related_id type="Part">B</related_id>`);
    expect(manager.queue).toHaveLength(1);
  });

  const forum = (): XmlDocument =>
    parse(
      `<Item type='Discussion Forum' id='F' action='add'><Relationships>` +
        `<Item type='DiscussionTemplate' id='T' action='add'><Relationships>` +
        `<Item type='FeedTemplate' id='FT' action='add'><related_id type='Q'>Q1</related_id></Item>` +
        `</Relationships></Item></Relationships></Item>`,
    );

  it("processes a node that an earlier reference detached with its subtree intact: the nested relationship is queued twice", () => {
    const manager = new DelayedResolutionManager();
    const doc = forum();
    run(manager, [ref(10005, at(doc, "//Item[@type='DiscussionTemplate']")), ref(10001, at(doc, "//related_id"))]);
    expect(manager.queue).toEqual([
      `<Item type='Discussion Forum' id='F' action='edit' doGetItem='0' version='0'><Relationships><Item type="DiscussionTemplate" id="T" action="add"><Relationships><Item type="FeedTemplate" id="FT" action="add"><related_id type="Q">Q1</related_id></Item></Relationships></Item></Relationships></Item>`,
      `<Item type='DiscussionTemplate' id='T' action='edit' doGetItem='0' version='0'><Relationships><Item type="FeedTemplate" id="FT" action="add"><related_id type="Q">Q1</related_id></Item></Relationships></Item>`,
    ]);
  });

  it("queues the nested relationship first, and without it in the template, when the order is reversed", () => {
    const manager = new DelayedResolutionManager();
    const doc = forum();
    run(manager, [ref(10001, at(doc, "//related_id")), ref(10005, at(doc, "//Item[@type='DiscussionTemplate']"))]);
    expect(manager.queue).toEqual([
      `<Item type='DiscussionTemplate' id='T' action='edit' doGetItem='0' version='0'><Relationships><Item type="FeedTemplate" id="FT" action="add"><related_id type="Q">Q1</related_id></Item></Relationships></Item>`,
      `<Item type='Discussion Forum' id='F' action='edit' doGetItem='0' version='0'><Relationships><Item type="DiscussionTemplate" id="T" action="add"><Relationships></Relationships></Item></Relationships></Item>`,
    ]);
  });

  it("does not report a processed data source again: its zero id is what the data-source check ignores (IMP-222)", () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(
      `<Item type='ItemType' id='IT'><Relationships><Item type='Property' id='P'><data_type>list</data_type><data_source>L</data_source></Item></Relationships></Item>`,
    );
    run(manager, [ref(10000, at(doc, "//data_source"))]);
    expect(selectSingleNode(`//Item[@type='Property' and data_source and data_source!='' and data_source!='${FAKED_DATA_SOURCE}']`, doc)).toBeNull();
  });
});

class Helper implements DelayedResolutionHelper {
  readonly applied: string[] = [];
  readonly currentIdRequests: [string, string][] = [];
  constructor(private readonly failAt: number | null = null) {}
  async applyAML(aml: string): Promise<unknown> {
    this.applied.push(aml);
    if (this.applied.length === this.failAt) throw new Error("server said no");
    return undefined;
  }
  readonly lookups = {
    getCurrentIdOfVersion: async (id: string, type: string): Promise<string> => {
      this.currentIdRequests.push([id, type]);
      return `current-${id}`;
    },
  };
}

function queued(...entries: string[]): DelayedResolutionManager {
  const manager = new DelayedResolutionManager();
  for (const [index, entry] of entries.entries()) {
    const doc = parse(
      `<Item type='ItemType' id='IT${index}'><Relationships><Item type='Property' id='P'><data_type>text</data_type><data_source>${entry.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</data_source></Item></Relationships></Item>`,
    );
    run(manager, [ref(10000, at(doc, "//data_source"))]);
  }
  return manager;
}

describe("ExecuteDelayedResolution (IMP-240)", () => {
  it("does nothing for an empty queue", async () => {
    const helper = new Helper();
    const log = new Log();
    await new DelayedResolutionManager().executeDelayedResolution(helper, log);
    expect(helper.applied).toEqual([]);
    expect(log.lines).toEqual([]);
  });

  it("logs and applies each entry in queue order, and does not look at the response", async () => {
    const manager = queued("a", "b");
    const helper = new Helper();
    const log = new Log();
    await manager.executeDelayedResolution(helper, log);
    expect(helper.applied).toEqual([...manager.queue]);
    expect(log.lines).toEqual(manager.queue.map((aml) => `DELAYED RESOLUTION: applying AML ${aml}`));
  });

  it("writes the AML as it is: a $ in it is not a replacement pattern", async () => {
    const manager = queued("$& $1 $$");
    const log = new Log();
    await manager.executeDelayedResolution(new Helper(), log);
    expect(log.lines[0]).toContain("<data_source>$&amp; $1 $$</data_source>");
  });

  it("stops at the first failure: earlier entries stay applied, later ones are not sent, and the failing line is written", async () => {
    const manager = queued("a", "b", "c");
    const helper = new Helper(2);
    const log = new Log();
    await expect(manager.executeDelayedResolution(helper, log)).rejects.toThrow("server said no");
    expect(helper.applied).toHaveLength(2);
    expect(log.lines).toHaveLength(2);
  });

  it("sends an entry that holds the floating-reference marker unchanged: the replacement never matches (IMP-241, IMP-242)", async () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(
      `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='add'><related_id __find_latest_generation_='yes' type='Part'>B</related_id></Item></Relationships></Item>`,
    );
    run(manager, [ref(10001, at(doc, "//related_id"))]);
    const helper = new Helper();
    await manager.executeDelayedResolution(helper, new Log());
    expect(helper.applied).toEqual([...manager.queue]);
    expect(helper.applied[0]).toContain(`__find_latest_generation_="yes"`);
    expect(helper.currentIdRequests).toEqual([]);
  });

  it("looks for the marker without regard to case, anywhere in the entry, and sends the entry unchanged", async () => {
    const manager = queued("__Find_Latest_Generation_ here");
    const helper = new Helper();
    const log = new Log();
    await manager.executeDelayedResolution(helper, log);
    expect(helper.applied).toEqual([...manager.queue]);
    expect(log.lines).toHaveLength(1);
  });

  it("parses an entry that holds the marker first: a malformed one fails before its log line is written", async () => {
    const manager = new DelayedResolutionManager();
    const doc = parse(
      `<Item type="Pa'rt" id="A"><Relationships><Item type="R"><related_id __find_latest_generation_="yes" type="P">B</related_id></Item></Relationships></Item>`,
    );
    run(manager, [ref(10001, at(doc, "//related_id"))]);
    const helper = new Helper();
    const log = new Log();
    await expect(manager.executeDelayedResolution(helper, log)).rejects.toBeInstanceOf(XmlException);
    expect(log.lines).toEqual([]);
    expect(helper.applied).toEqual([]);
  });

  it("hands a malformed entry without the marker to applyAML, after the log line", async () => {
    const manager = queued("a'b");
    const doc = parse(`<Item type="Pa'rt" id="A"><Relationships><Item type="R"><related_id>B</related_id></Item></Relationships></Item>`);
    run(manager, [ref(10001, at(doc, "//related_id"))]);
    const bad = manager.queue[1]!;
    expect(bad.startsWith(`<Item type='Pa'rt'`)).toBe(true);
    const helper = new Helper();
    const log = new Log();
    await manager.executeDelayedResolution(helper, log);
    expect(log.lines[1]).toBe(`DELAYED RESOLUTION: applying AML ${bad}`);
    expect(helper.applied[1]).toBe(bad);
  });
});

describe("ReplaceRelatedIdOnLatestId (IMP-241, IMP-242)", () => {
  const manager = new DelayedResolutionManager();

  it("returns null for any entry the manager queues, whose root is Item", async () => {
    const helper = new Helper();
    const aml = `<Item type='Part' id='A'><Relationships><Item type='R'><related_id __find_latest_generation_="yes" type="Part">B</related_id></Item></Relationships></Item>`;
    expect(await manager.replaceRelatedIdOnLatestId(helper, aml)).toBeNull();
    expect(helper.currentIdRequests).toEqual([]);
  });

  it("lets the parser's XmlException of a malformed entry escape", async () => {
    await expect(manager.replaceRelatedIdOnLatestId(new Helper(), "<Item type='Pa'rt'>")).rejects.toBeInstanceOf(XmlException);
  });

  it("returns null when the related_id has no marker", async () => {
    const aml = `<AML><Item><Relationships><Item><related_id type="Part">B</related_id></Item></Relationships></Item></AML>`;
    expect(await manager.replaceRelatedIdOnLatestId(new Helper(), aml)).toBeNull();
  });

  it("replaces the id by the current one for an AML rooted at AML (the probed direct call)", async () => {
    const helper = new Helper();
    const aml = `<AML><Item><Relationships><Item><related_id __find_latest_generation_="yes" type="Part">B</related_id></Item></Relationships></Item></AML>`;
    expect(await manager.replaceRelatedIdOnLatestId(helper, aml)).toBe(
      `<AML><Item><Relationships><Item><related_id type="Part">current-B</related_id></Item></Relationships></Item></AML>`,
    );
    expect(helper.currentIdRequests).toEqual([["B", "Part"]]);
  });

  it("fails with a NullReferenceException when the marked related_id has no type", async () => {
    const aml = `<AML><Item><Relationships><Item><related_id __find_latest_generation_="yes">B</related_id></Item></Relationships></Item></AML>`;
    await expect(manager.replaceRelatedIdOnLatestId(new Helper(), aml)).rejects.toMatchObject({ typeName: "System.NullReferenceException" });
  });
});
