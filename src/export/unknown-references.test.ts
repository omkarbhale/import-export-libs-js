import { beforeEach, describe, expect, it } from "vitest";
import { isNullReference } from "../client/dotnet.js";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { packageCaches } from "../client/package-lookups.js";
import { StubConnection, stubFault, stubResult } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import { NetfxHashtable } from "../manifest/index.js";
import { loadXml, outerXml } from "../xml/index.js";
import type { XmlDocument } from "../xml/index.js";
import { guardExport } from "./export-errors.js";
import { ExportItem } from "./export-item.js";
import { RemovedReference } from "./removed-reference.js";
import { getItemId, removeReferencesToAnotherPackages } from "./unknown-references.js";

/** What the server knows: the data the removal's six requests read (EXP-608). */
interface World {
  /** Package name to the element ids of its groups, in the server's order of packages. */
  packages: Record<string, string[]>;
  /** Package name to the names it depends on directly. */
  dependsOn?: Record<string, string[]>;
  /** RelationshipType name to its id. */
  relationshipTypes?: Record<string, string>;
  /** Method name to its config id. */
  methods?: Record<string, string>;
  /** Requests answered with a transport-style failure instead. */
  failing?: RegExp[];
}

const ITEM = new ExportItem("Kn", "ID1", "ItemType");

function over(world: World) {
  const stub = new StubConnection((request) => {
    if (world.failing?.some((pattern) => pattern.test(request))) throw new Error("connection lost");
    const r1 = /^<Item type="PackageDefinition" action="get" select="id"><name>([^<]*)<\/name><Relationships>/.exec(request);
    if (r1) {
      const ids = world.packages[r1[1] as string];
      if (!ids) return stubFault("0", "No items of type PackageDefinition found.");
      const elements = ids.map((id) => `<Item><element_id>${id}</element_id></Item>`).join("");
      return stubResult(`<Item><Relationships><Item><Relationships>${elements}</Relationships></Item></Relationships></Item>`);
    }
    if (request === '<Item type="PackageDefinition" action="get" select="name" />') {
      return stubResult(Object.keys(world.packages).map((name) => `<Item><name>${name}</name></Item>`).join(""));
    }
    const r4 = /^<Item type="PackageDefinition" action="get" select="id"><name>([^<]*)<\/name><\/Item>$/.exec(request);
    if (r4) return world.packages[r4[1] as string] ? stubResult(`<Item><id>PD-${r4[1]}</id></Item>`) : stubFault("0", "No items found.");
    const r5 = /^<Item type="PackageDependsOn" action="get" select="name"><source_id>PD-([^<]*)<\/source_id><\/Item>$/.exec(request);
    if (r5) {
      const names = world.dependsOn?.[r5[1] as string];
      return names?.length ? stubResult(names.map((name) => `<Item><name>${name}</name></Item>`).join("")) : stubFault("0", "No items found.");
    }
    const r2 = /^<Item type="RelationshipType" action="get" select="id"><name>([^<]*)<\/name><\/Item>$/.exec(request);
    if (r2) {
      const id = world.relationshipTypes?.[r2[1] as string];
      return id === undefined ? stubFault("0", "No items of type RelationshipType found.") : stubResult(`<Item><id>${id}</id></Item>`);
    }
    if (request.startsWith('<Item type="Method"') && request.includes('select="config_id"')) {
      const name = /<name>([^<]*)<\/name>/.exec(request)?.[1] ?? "";
      const id = world.methods?.[name];
      if (id === undefined) return stubFault("0", "No items of type Method found.");
      return stubResult(id === "" ? "<Item/>" : `<Item><config_id>${id}</config_id></Item>`);
    }
    return undefined;
  });
  const helper = new CItemHelper(stub);
  helper.innovatorVersion = new ArasVersion(14, 0, 9, 1, 0);
  return { stub, helper };
}

const load = (xml: string): XmlDocument => loadXml(xml, { preserveWhitespace: false });
const table = () => new NetfxHashtable<RemovedReference>("the removed references");
const entries = (excluded: NetfxHashtable<RemovedReference>) => [...excluded.values()].map(({ from, to, reason }) => ({ from, to, reason }));

const R1 = (name: string) =>
  `<Item type="PackageDefinition" action="get" select="id"><name>${name}</name><Relationships><Item type="PackageGroup" action="get" select="id"><Relationships><Item type="PackageElement" action="get" select="element_id" /></Relationships></Item></Relationships></Item>`;
const R2 = (name: string) => `<Item type="RelationshipType" action="get" select="id"><name>${name}</name></Item>`;
const R3 = '<Item type="PackageDefinition" action="get" select="name" />';
const R4 = (name: string) => `<Item type="PackageDefinition" action="get" select="id"><name>${name}</name></Item>`;
const R5 = (name: string) => `<Item type="PackageDependsOn" action="get" select="name"><source_id>PD-${name}</source_id></Item>`;

/** pkg.a is exported; pkg.dep is its dependency; pkg.other and pkg.third are unknown; com.aras.innovator.core is core. */
const WORLD: World = {
  packages: {
    "pkg.a": ["A-OWN", "A-REL"],
    "pkg.dep": ["DEP-1"],
    "com.aras.innovator.core": ["CORE-1"],
    "pkg.other": ["OTHER-1", "OTHER-2"],
    "pkg.third": ["THIRD-1"],
  },
  dependsOn: { "pkg.a": ["pkg.dep"] },
  relationshipTypes: { Own: "A-REL", Foreign: "OTHER-1", Dep: "DEP-1", Core: "CORE-1", Loose: "NOWHERE" },
  methods: { M_Own: "A-OWN", M_Foreign: "OTHER-2", M_Dep: "DEP-1", M_Third: "THIRD-1" },
};

const REASON_TYPE = "The item contains a reference to an item of type that belongs to an unknown package (i.e. neither a core package nor a package that the package depends on)";
const REASON_RELATIONSHIP = "The item contains a reference to an relationship item that belongs to an unknown package (i.e. neither a core package nor a package that the package depends on)";
const REASON_ITEM = "The item contains a reference to an item that belongs to an unknown package (i.e. neither a core package nor a package that the package depends on)";

beforeEach(() => packageCaches.dependsOn.clear());

describe("EXP-603: a relationship whose type is in an unknown package is removed", () => {
  it("removes it, and its emptied Relationships parent, and records the type", async () => {
    const { helper, stub } = over(WORLD);
    const doc = load('<Item type="ItemType" id="ID1"><Relationships><Item type="Foreign" id="F1"/></Relationships><name>n</name></Item>');
    const excluded = table();
    await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", excluded);
    expect(outerXml(doc)).toBe('<Item type="ItemType" id="ID1"><name>n</name></Item>');
    expect(entries(excluded)).toEqual([{ from: "[pkg.a].[ItemType].Kn", to: "all items of type [Foreign]", reason: REASON_TYPE }]);
    // the request order of EXP-607: the package, the type, then the lists, then the candidates up to the first that holds the id
    expect(stub.requests).toEqual([R1("pkg.a"), R2("Foreign"), R3, R4("pkg.a"), R5("pkg.a"), R1("pkg.other")]);
  });

  it("keeps a type that is an element of the exported package, of a dependency, of a core package or of no package", async () => {
    const { helper, stub } = over(WORLD);
    const doc = load(
      '<Item type="ItemType"><Relationships><Item type="Own"/><Item type="Dep"/><Item type="Core"/><Item type="Loose"/></Relationships></Item>',
    );
    const excluded = table();
    await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", excluded);
    expect(outerXml(doc)).toContain('<Item type="Own" />');
    expect(excluded.count).toBe(0);
    // Own is in the package itself, so nothing more is asked; the others load the candidates once (pkg.other, pkg.third)
    expect(stub.requests).toEqual([
      R1("pkg.a"),
      R2("Own"),
      R2("Dep"),
      R3,
      R4("pkg.a"),
      R5("pkg.a"),
      R1("pkg.other"),
      R1("pkg.third"),
      R2("Core"),
      R2("Loose"),
    ]);
  });

  it("fails with the CItemException of a type that is no RelationshipType, faultcode 0 included", async () => {
    const { helper } = over(WORLD);
    const doc = load('<Item type="ItemType"><Relationships><Item type="Nothing"/></Relationships></Item>');
    const error = await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", table()).then(() => undefined, (thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(CItemException);
    expect((error as CItemException).faultcode).toBe(0);
  });
});

describe("EXP-602: a relationship item needs a type", () => {
  it("fails with a NullReferenceException when there is none, which the export turns into a CItemException (EXP-617)", async () => {
    const { helper } = over(WORLD);
    const doc = load('<Item type="ItemType"><Relationships><Item id="x"/></Relationships></Item>');
    const error = await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", table()).then(() => undefined, (thrown: unknown) => thrown);
    expect(isNullReference(error)).toBe(true);
    const wrapped = await guardExport(() => removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", table())).then(() => undefined, (thrown: unknown) => thrown);
    expect(wrapped).toBeInstanceOf(CItemException);
    expect((wrapped as CItemException).faultcode).toBe(-1);
    expect((wrapped as CItemException).faultdetail).toBe("Object reference not set to an instance of an object. Can't export item.");
  });

  it("fails with the AML portion when the type is empty", async () => {
    const { helper } = over(WORLD);
    const doc = load('<Item type="ItemType"><Relationships><Item type="" id="x"/></Relationships></Item>');
    const error = (await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", table()).then(() => undefined, (thrown: unknown) => thrown)) as CItemException;
    expect(error).toBeInstanceOf(CItemException);
    expect([error.faultcode, error.faultstring, error.faultdetail]).toEqual([
      -1,
      "Type of relationship is not defined",
      'Type of relationship is not defined in the AML portion: <Item type="" id="x" />',
    ]);
  });
});

describe("EXP-604: in a core package, a relationship item that is itself in an unknown package is removed", () => {
  const core: World = {
    ...WORLD,
    packages: { ...WORLD.packages, "com.aras.innovator.thing": ["CORE-OWN"] },
    dependsOn: {},
    relationshipTypes: { Own: "CORE-OWN" },
  };

  it("tests the id attribute, or the id child, only when the exported package is core", async () => {
    const { helper } = over(core);
    const doc = load(
      '<Item type="ItemType"><Relationships><Item type="Own" id="OTHER-2"/><Item type="Own"><id>THIRD-1</id></Item><Item type="Own" id="CORE-OWN"/></Relationships></Item>',
    );
    const excluded = table();
    await removeReferencesToAnotherPackages(helper, ITEM, doc, "com.aras.innovator.thing", excluded);
    expect(outerXml(doc)).toBe('<Item type="ItemType"><Relationships><Item type="Own" id="CORE-OWN" /></Relationships></Item>');
    expect(new Set(entries(excluded))).toEqual(
      new Set([
        { from: "[com.aras.innovator.thing].[ItemType].Kn", to: "[Own].OTHER-2", reason: REASON_RELATIONSHIP },
        { from: "[com.aras.innovator.thing].[ItemType].Kn", to: "[Own].THIRD-1", reason: REASON_RELATIONSHIP },
      ]),
    );
  });

  it("leaves the relationship alone when the exported package is not core", async () => {
    const { helper } = over(WORLD);
    const doc = load('<Item type="ItemType"><Relationships><Item type="Own" id="OTHER-2"/></Relationships></Item>');
    const excluded = table();
    await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", excluded);
    expect(excluded.count).toBe(0);
  });

  it("tests the empty string like any id: nothing is removed, and the candidates are still loaded", async () => {
    const { helper, stub } = over(core);
    const doc = load('<Item type="ItemType"><Relationships><Item type="Own"/></Relationships></Item>');
    await removeReferencesToAnotherPackages(helper, ITEM, doc, "com.aras.innovator.thing", table());
    expect(outerXml(doc)).toContain('<Item type="Own" />');
    expect(stub.requests).toContain(R1("pkg.third"));
  });

  it("reads the id from the attribute, then the child, then gives the empty string (getItemId)", () => {
    const element = (xml: string) => load(xml).documentElement as Parameters<typeof getItemId>[0];
    expect(getItemId(element('<Item id="a"><id>b</id></Item>'))).toBe("a");
    expect(getItemId(element('<Item id=""><id>b</id></Item>'))).toBe("b");
    expect(getItemId(element("<Item><name>b</name></Item>"))).toBe("");
  });
});

describe("EXP-605: a relationship item whose related item is in an unknown package is removed", () => {
  it("records the related item with its type, or with its id when the related_id has no type", async () => {
    const { helper } = over(WORLD);
    const doc = load(
      '<Item type="ItemType"><Relationships>' +
        '<Item type="Own"><related_id type="Thing">OTHER-1</related_id></Item>' +
        '<Item type="Own"><related_id>OTHER-2</related_id></Item>' +
        '<Item type="Own"><related_id type="Thing">DEP-1</related_id></Item>' +
        "</Relationships></Item>",
    );
    const excluded = table();
    await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", excluded);
    expect(outerXml(doc)).toBe('<Item type="ItemType"><Relationships><Item type="Own"><related_id type="Thing">DEP-1</related_id></Item></Relationships></Item>');
    const from = "[pkg.a].[ItemType].Kn (ID='ID1')";
    expect(new Set(entries(excluded))).toEqual(
      new Set([
        { from, to: "[Thing].OTHER-1", reason: REASON_ITEM },
        { from, to: "ID='OTHER-2'", reason: REASON_ITEM },
      ]),
    );
  });

  it("does nothing for a relationship item without related_id", async () => {
    const { helper } = over(WORLD);
    const doc = load('<Item type="ItemType"><Relationships><Item type="Own"><x/></Item></Relationships></Item>');
    await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", table());
    expect(outerXml(doc)).toContain("<x />");
  });
});

describe("EXP-606: Method references elsewhere are removed with their property element", () => {
  it("removes the property element of a stub in an unknown package and records it with a leading space", async () => {
    const { helper, stub } = over(WORLD);
    const doc = load(
      '<Item type="Action"><method keyed_name="Foreign Method"><Item type="Method" action="get" select="id"><name>M_Foreign</name></Item></method>' +
        '<on_complete keyed_name="Dep Method"><Item type="Method" action="get"><name>M_Dep</name></Item></on_complete>' +
        '<other keyed_name="Own"><Item type="Method" action="get" select="id"><name>M_Own</name></Item></other></Item>',
    );
    const excluded = table();
    await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", excluded);
    expect(outerXml(doc)).toBe(
      '<Item type="Action"><on_complete keyed_name="Dep Method"><Item type="Method" action="get"><name>M_Dep</name></Item></on_complete>' +
        '<other keyed_name="Own"><Item type="Method" action="get" select="id"><name>M_Own</name></Item></other></Item>',
    );
    expect(entries(excluded)).toEqual([{ from: "[pkg.a].[ItemType].Kn", to: " [Method].[Foreign Method(ID=OTHER-2)]", reason: REASON_ITEM }]);
    // the stub's select is replaced in place, or appended when it had none; nothing is cached
    expect(stub.requests.filter((request) => request.startsWith('<Item type="Method"'))).toEqual([
      '<Item type="Method" action="get" select="config_id"><name>M_Foreign</name></Item>',
      '<Item type="Method" action="get" select="config_id"><name>M_Dep</name></Item>',
      '<Item type="Method" action="get" select="config_id"><name>M_Own</name></Item>',
    ]);
  });

  it("visits the stubs of a relationship item that stayed, and not those of one the first pass removed", async () => {
    const { helper, stub } = over(WORLD);
    const doc = load(
      '<Item type="X"><Relationships>' +
        '<Item type="Own"><method keyed_name="Gone"><Item type="Method" action="get"><name>M_Foreign</name></Item></method></Item>' +
        '<Item type="Foreign"><method keyed_name="Never"><Item type="Method" action="get"><name>M_Third</name></Item></method></Item>' +
        "</Relationships></Item>",
    );
    const excluded = table();
    await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", excluded);
    expect(outerXml(doc)).toBe('<Item type="X"><Relationships><Item type="Own"></Item></Relationships></Item>');
    expect(new Set(entries(excluded).map(({ to }) => to))).toEqual(new Set(["all items of type [Foreign]", " [Method].[Gone(ID=OTHER-2)]"]));
    expect(stub.requests.filter((request) => request.startsWith('<Item type="Method"'))).toHaveLength(1);
  });

  it("fails on any fault of the lookup, and on an answer without a config_id", async () => {
    const stubs = over(WORLD);
    const unknown = load('<Item type="X"><p><Item type="Method" action="get"><name>M_None</name></Item></p></Item>');
    const fault = (await removeReferencesToAnotherPackages(stubs.helper, ITEM, unknown, "pkg.a", table()).then(() => undefined, (thrown: unknown) => thrown)) as CItemException;
    expect(fault).toBeInstanceOf(CItemException);
    expect(fault.faultcode).toBe(0);

    const empty = over({ ...WORLD, methods: { M_Empty: "" } });
    const missing = load('<Item type="X"><p><Item type="Method" action="get"><name>M_Empty</name></Item></p></Item>');
    const error = await removeReferencesToAnotherPackages(empty.helper, ITEM, missing, "pkg.a", table()).then(() => undefined, (thrown: unknown) => thrown);
    expect(isNullReference(error)).toBe(true);
  });

  it("removes nothing, and records nothing, for a stub whose parent has no parent", async () => {
    const { helper } = over(WORLD);
    const doc = load('<Item type="Method" action="get"><name>M_Foreign</name></Item>');
    const excluded = table();
    await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", excluded);
    expect(excluded.count).toBe(0);
    expect(outerXml(doc)).toContain("M_Foreign");
  });
});

describe("EXP-610: removing a relationship item", () => {
  it("removes an emptied Relationships, but only one level, and not one that still holds a comment", async () => {
    const { helper } = over(WORLD);
    const doc = load(
      '<Item type="A"><Relationships><!--keep--><Item type="Foreign"/></Relationships><x><Relationships><Item type="Foreign"/></Relationships></x></Item>',
    );
    await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", table());
    expect(outerXml(doc)).toBe('<Item type="A"><Relationships><!--keep--></Relationships><x></x></Item>');
  });
});

describe("EXP-611: the table of removed references", () => {
  it("counts removals with the same from and to once", async () => {
    const { helper } = over(WORLD);
    const doc = load('<Item type="A"><Relationships><Item type="Foreign" id="1"/><Item type="Foreign" id="2"/></Relationships></Item>');
    const excluded = table();
    await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", excluded);
    expect(excluded.count).toBe(1);
  });

  it("keeps entries added by an earlier item and an earlier visit when a later one fails", async () => {
    const { helper } = over(WORLD);
    const doc = load('<Item type="A"><Relationships><Item type="Foreign"/><Item type="Nothing"/></Relationships></Item>');
    const excluded = table();
    await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", excluded).catch(() => undefined);
    expect(excluded.count).toBe(1);
  });

  it("holds the reason texts of the engine's catalogue", () => {
    expect(new RemovedReference("f", "t", "type").reason).toBe(REASON_TYPE);
    expect(new RemovedReference("f", "t", "relationship").reason).toBe(REASON_RELATIONSHIP);
    expect(new RemovedReference("f", "t", "item").reason).toBe(REASON_ITEM);
  });
});

describe("EXP-607: which packages are unknown", () => {
  it("leaves out core packages, direct dependencies, the exported package and fetches candidates in the server's order", async () => {
    const { helper, stub } = over({
      ...WORLD,
      packages: { "com.aras.innovator.core": ["C"], "pkg.dep": ["D"], "pkg.a": ["A-OWN"], "pkg.first": ["F"], "pkg.second": ["S"], "com.aras.defaults.x": ["DEF"] },
      relationshipTypes: { T: "S" },
    });
    const doc = load('<Item type="A"><Relationships><Item type="T"/></Relationships></Item>');
    await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", table());
    expect(stub.requests).toEqual([R1("pkg.a"), R2("T"), R3, R4("pkg.a"), R5("pkg.a"), R1("pkg.first"), R1("pkg.second")]);
    expect(outerXml(doc)).toBe('<Item type="A"></Item>');
  });

  it("treats a package name with an ignorable code point like the culture-sensitive core test (MAN-031)", async () => {
    const { helper, stub } = over({
      ...WORLD,
      packages: { "pkg.a": ["A"], "com.aras.innovator­.soft": ["SOFT"], "pkg.x": ["X"] },
      relationshipTypes: { T: "NONE" },
    });
    const doc = load('<Item type="A"><Relationships><Item type="T"/></Relationships></Item>');
    await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", table());
    expect(stub.requests.filter((request) => request.includes("<Relationships><Item type="))).toEqual([R1("pkg.a"), R1("pkg.x")]);
  });

  it("treats a dependency of a dependency as unknown", async () => {
    const { helper } = over({ ...WORLD, dependsOn: { "pkg.a": ["pkg.dep"], "pkg.dep": ["pkg.other"] }, relationshipTypes: { T: "OTHER-1" } });
    const doc = load('<Item type="A"><Relationships><Item type="T"/></Relationships></Item>');
    const excluded = table();
    await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", excluded);
    expect(excluded.count).toBe(1);
  });
});

describe("EXP-609, EXP-619, EXP-620: what is kept between items and runs", () => {
  it("asks each lookup once per run, and not again for the next item", async () => {
    const { helper, stub } = over(WORLD);
    for (let i = 0; i < 2; i += 1) {
      const doc = load('<Item type="A"><Relationships><Item type="Foreign"/></Relationships></Item>');
      await removeReferencesToAnotherPackages(helper, ITEM, doc, "pkg.a", table());
    }
    expect(stub.requests).toEqual([R1("pkg.a"), R2("Foreign"), R3, R4("pkg.a"), R5("pkg.a"), R1("pkg.other")]);
  });

  it("does not cache the error of a lookup", async () => {
    const world = { ...WORLD, failing: [/select="id"><name>Foreign<\/name>/] };
    const { helper, stub } = over(world);
    const doc = () => load('<Item type="A"><Relationships><Item type="Foreign"/></Relationships></Item>');
    const first = await removeReferencesToAnotherPackages(helper, ITEM, doc(), "pkg.a", table()).then(() => undefined, (thrown: unknown) => thrown);
    expect(first).toBeInstanceOf(Error);
    world.failing = [];
    await removeReferencesToAnotherPackages(helper, ITEM, doc(), "pkg.a", table());
    expect(stub.requests.filter((request) => request === R2("Foreign"))).toHaveLength(2);
    expect(stub.requests.filter((request) => request === R1("pkg.a"))).toHaveLength(1);
  });

  it("empties the caches but the dependency table when a helper is made (EXP-619)", async () => {
    const first = over(WORLD);
    await removeReferencesToAnotherPackages(first.helper, ITEM, load('<Item type="A"><Relationships><Item type="Foreign"/></Relationships></Item>'), "pkg.a", table());
    const second = over(WORLD);
    await removeReferencesToAnotherPackages(second.helper, ITEM, load('<Item type="A"><Relationships><Item type="Foreign"/></Relationships></Item>'), "pkg.a", table());
    // R4 and R5 are not asked again, whatever the database says now; everything else is
    expect(second.stub.requests).toEqual([R1("pkg.a"), R2("Foreign"), R3, R1("pkg.other")]);
  });

  it("leaves an empty list of non-core packages after R3 failed, so the references stay (EXP-620)", async () => {
    const { helper, stub } = over({ ...WORLD, failing: [/^<Item type="PackageDefinition" action="get" select="name" \/>$/] });
    const doc = () => load('<Item type="A"><Relationships><Item type="Foreign"/></Relationships></Item>');
    const first = await removeReferencesToAnotherPackages(helper, ITEM, doc(), "pkg.a", table()).then(() => undefined, (thrown: unknown) => thrown);
    expect(first).toBeInstanceOf(Error);
    const kept = doc();
    const excluded = table();
    await removeReferencesToAnotherPackages(helper, ITEM, kept, "pkg.a", excluded);
    expect(excluded.count).toBe(0);
    expect(outerXml(kept)).toContain('<Item type="Foreign" />');
    expect(stub.requests.filter((request) => request === R3)).toHaveLength(1);
  });
});

describe("EXP-600: the removal asks for the package's own element ids first", () => {
  it("sends R1 for the exported package even when the document has no relationships", async () => {
    const { helper, stub } = over(WORLD);
    await removeReferencesToAnotherPackages(helper, ITEM, load('<Item type="A"><name>n</name></Item>'), "pkg.a", table());
    expect(stub.requests).toEqual([R1("pkg.a")]);
  });

  it("fails with faultcode 0 when the exported package has no PackageDefinition", async () => {
    const { helper } = over(WORLD);
    const error = (await removeReferencesToAnotherPackages(helper, ITEM, load("<Item/>"), "pkg.none", table()).then(() => undefined, (thrown: unknown) => thrown)) as CItemException;
    expect(error.faultcode).toBe(0);
  });
});
