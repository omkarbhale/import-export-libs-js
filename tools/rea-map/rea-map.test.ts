import { describe, expect, it } from "vitest";
import { BlobReader } from "./metadata.js";
import { sequencePointSpan } from "./pdb.js";
import { type Graph, type GraphMethod, reachable } from "./reachability.js";
import { slicePropertyDeclaration, sliceMethod } from "./slices.js";
import { mergeBuild, type ReachableSet, type SourceMap } from "./sourcemap.js";

describe("compressed integers", () => {
  it("reads unsigned and signed forms of every width", () => {
    const r = new BlobReader(Uint8Array.from([0x03, 0x80, 0x80, 0xc0, 0x00, 0x40, 0x00, 0x06, 0x7b, 0x80, 0x01]));
    expect(r.uint()).toBe(3);
    expect(r.uint()).toBe(0x80);
    expect(r.uint()).toBe(0x4000);
    expect(r.int()).toBe(3);
    expect(r.int()).toBe(-3);
    expect(r.int()).toBe(-0x2000);
  });
});

describe("sequence points", () => {
  it("spans the visible points of the first document, skipping hidden ones", () => {
    // local sig 0; lines 10-11 from column 5; a hidden point; line 12;
    // then a switch to document 2 and a point at line 16 there.
    const blob = Uint8Array.from([
      0x00, 0x00, 0x01, 0x06, 0x0a, 0x05, 0x04, 0x00, 0x00, 0x02, 0x00, 0x04, 0x04, 0x00, 0x00, 0x02, 0x03, 0x00, 0x02, 0x08, 0x00,
    ]);
    expect(sequencePointSpan(blob, 1)).toEqual({ document: 1, startLine: 10, endLine: 12 });
    expect(sequencePointSpan(new Uint8Array(), 1)).toBeUndefined();
  });
});

describe("slices", () => {
  const file = [
    "public class C",
    "{",
    "\t[Attr]",
    "\tpublic int M(int a)",
    "\t{",
    "\t\tif (a > 0)",
    "\t\t{",
    "\t\t\treturn Run(delegate",
    "\t\t\t{",
    "\t\t\t\treturn a;",
    "\t\t\t});",
    "\t\t}",
    "\t\treturn 0;",
    "\t}",
    "",
    "\tpublic string Name { get; set; }",
    "}",
  ];

  it("widens a method's span to its attributes, declaration and braces", () => {
    expect(sliceMethod(file, 6, 13)).toMatchObject({ startLine: 3, endLine: 14 });
    expect(sliceMethod(file, 5, 14).text.split("\n")[0]).toBe("\t[Attr]");
  });

  it("keeps a delegate's own braces and the line that opens it", () => {
    expect(sliceMethod(file, 10, 10)).toMatchObject({ startLine: 8, endLine: 11 });
  });

  it("keeps a lambda that is part of an expression as its bare span", () => {
    const query = ["\t\treturn from x in xs", "\t\t\tselect x.Name;"];
    expect(sliceMethod(query, 2, 2)).toEqual({ startLine: 2, endLine: 2, text: "\t\t\tselect x.Name;" });
  });

  it("finds an auto-property's declaration for its accessors", () => {
    expect(slicePropertyDeclaration(file, "set_Name")).toMatchObject({ startLine: 16, endLine: 16 });
    expect(slicePropertyDeclaration(file, "get_Other")).toBeUndefined();
    expect(slicePropertyDeclaration(file, "M")).toBeUndefined();
  });
});

describe("reachability", () => {
  const method = (token: string, type: string, name: string, extra: Partial<GraphMethod> = {}): GraphMethod => ({
    token,
    fullName: `${type}::${name}`,
    name,
    type,
    shape: "System.Void()",
    virtual: false,
    newSlot: false,
    ...extra,
  });

  const methods = [
    method("e", "Host", "Run"),
    method("i", "IWork", "Do", { virtual: true, newSlot: true }),
    method("a", "A", ".ctor"),
    method("a1", "A", "IWork.Do", { virtual: true, newSlot: true }),
    method("a2", "A", ".cctor"),
    method("a3", "A", "ToString", { virtual: true, shape: "System.String()" }),
    method("b", "B", ".ctor"),
    method("b1", "B", "Do", { virtual: true, newSlot: true }),
    method("s", "A/<Run>d__1", "MoveNext", { virtual: true, newSlot: true }),
    method("l", "A/<>c", "<Run>b__0"),
    method("x", "Unused", "Never"),
  ];
  const graph: Graph = {
    methods,
    calls: new Map([
      ["e", [{ opcode: "newobj", target: { token: "a" } }, { opcode: "callvirt", target: { token: "i" } }]],
      ["a1", [{ opcode: "ldftn", target: { token: "l" } }]],
    ]),
    fieldTypes: new Map([["a1", ["A/<Run>d__1"]]]),
  };

  it("dispatches to instantiated types only and follows what the runtime drives", () => {
    const seen = reachable(graph, [{ token: "e" }]);
    expect([...seen].sort()).toEqual(["a", "a1", "a2", "a3", "e", "i", "l", "s"]);
  });

  it("seeds instantiation and virtual calls a host makes", () => {
    const seen = reachable(graph, [{ instantiates: "B" }, { virtualCall: { name: "Do", shape: "System.Void()" } }]);
    expect([...seen].sort()).toEqual(["b1"]);
  });
});

describe("merging into the source map", () => {
  const lock = (il: string) => ({ token: "0x06000001", signatureSha256: "a".repeat(64), ilSha256: il.repeat(64) });
  const set = (methods: ReachableSet["methods"]): ReachableSet => ({
    engine: "14.0.7",
    assemblyVersion: "14.0.7.35492",
    sha256: "c".repeat(64),
    mvid: "81698344-c4fa-4ec3-a48f-0961032d17f1",
    generator: { rea: "6.4.0", ilspycmd: "8.2.0.7535" },
    hosts: [],
    methods,
  });

  it("adds a new build in progress with every method unmapped", () => {
    const map: SourceMap = { builds: [] };
    const report = mergeBuild(map, set([{ fullName: "A::B", signature: "System.Void B()", lock: lock("b") }]));
    expect(report.added).toEqual(["A::B System.Void B()"]);
    expect(map.builds[0]).toMatchObject({ inProgress: true, methods: [{ fullName: "A::B", status: "unmapped" }] });
  });

  it("keeps coverage when the code is unchanged, and reopens it when the code changed", () => {
    const map: SourceMap = {
      builds: [
        {
          engine: "14.0.7",
          assemblyVersion: "14.0.7.35492",
          sha256: "c".repeat(64),
          mvid: "81698344-c4fa-4ec3-a48f-0961032d17f1",
          methods: [
            { fullName: "A::Same", signature: "S", lock: lock("b"), status: "mapped", rules: ["EXP-001"], symbols: ["src/a.ts#a"] },
            { fullName: "A::Moved", signature: "S", lock: lock("b"), status: "not-ported", reason: "r" },
            { fullName: "A::Gone", signature: "S", lock: lock("b"), status: "unmapped" },
          ],
        },
      ],
    };
    const report = mergeBuild(
      map,
      set([
        { fullName: "A::Same", signature: "S", lock: { ...lock("b"), token: "0x06000009" } },
        { fullName: "A::Moved", signature: "S", lock: lock("d") },
      ]),
    );
    expect(report).toEqual({ added: [], removed: ["A::Gone S"], relocked: ["A::Moved S"] });
    const [build] = map.builds;
    expect(build?.inProgress).toBeUndefined();
    expect(build?.methods).toEqual([
      { fullName: "A::Moved", signature: "S", lock: lock("d"), status: "unmapped" },
      { fullName: "A::Same", signature: "S", lock: { ...lock("b"), token: "0x06000009" }, status: "mapped", rules: ["EXP-001"], symbols: ["src/a.ts#a"] },
    ]);
  });
});
