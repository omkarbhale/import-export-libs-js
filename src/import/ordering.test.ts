import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NTFS_UPPER_RUNS } from "./ntfs-upper-data.js";
import { compareNtfsNames, ntfsOrderKey, sortNtfsNames } from "./ntfs-order.js";
import { TypeNameOutsideRepertoireError, nlsSortKey, sortByTypeName } from "./nls-word-sort.js";

const DIR = fileURLToPath(new URL("../../fixtures/import-load/", import.meta.url));
const readJson = <T>(name: string): T => JSON.parse(readFileSync(DIR + name, "utf8")) as T;
const units = (hex: string): string => hex.split(" ").map((u) => String.fromCharCode(parseInt(u, 16))).join("");

describe("IMP-004: NTFS directory order", () => {
  const { pairs } = readJson<{ pairs: [string, string][] }>("invariant-upper.json");

  it("expands the embedded runs to the recorded ToUpperInvariant table, unit for unit", () => {
    const recorded = new Map(pairs.map(([from, to]) => [parseInt(from, 16), parseInt(to, 16)]));
    const embedded = new Map<number, number>();
    for (const [first, last, stride, delta] of NTFS_UPPER_RUNS) {
      for (let at = first; at <= last; at += stride) embedded.set(at, at + delta);
    }
    expect([...embedded].sort((a, b) => a[0] - b[0])).toEqual([...recorded].sort((a, b) => a[0] - b[0]));
  });

  it("upper-cases each UTF-16 unit on its own, not as the host does", () => {
    expect(ntfsOrderKey("ß")).toBe("ß");
    expect(ntfsOrderKey("ı")).toBe("ı");
    expect(ntfsOrderKey("ÿ")).toBe("Ÿ");
    expect(ntfsOrderKey("ǅ")).toBe("ǅ");
    expect(ntfsOrderKey("𐐨")).toBe("𐐨");
    expect(ntfsOrderKey("a-b.XML")).toBe("A-B.XML");
  });

  const { runs } = readJson<{ runs: { files: string[]; dirs: string[] }[] }>("listing-order.json");
  runs.forEach((run, index) => {
    it(`lists the files NTFS listed in run ${index + 1} whatever order they come in`, () => {
      const files = run.files.map(units);
      expect(sortNtfsNames([...files].reverse())).toEqual(files);
      expect(sortNtfsNames([...files].sort())).toEqual(files);
    });
    it(`lists the directories NTFS listed in run ${index + 1} whatever order they come in`, () => {
      const dirs = run.dirs.map(units);
      expect(sortNtfsNames([...dirs].reverse())).toEqual(dirs);
    });
  });

  it("orders the names of the rule's examples", () => {
    expect(sortNtfsNames(["Z", "é", "b", "_x", "a-b", "a b", "A", "9", "10", "ä"])).toEqual(["10", "9", "A", "a b", "a-b", "b", "Z", "_x", "ä", "é"]);
    expect(sortNtfsNames(["x.XML", "Z.xml", "s.xml.xml", "q.Xml", "p.xml~", "m.xmlx", "B.xml", "a.xmlbak", "a.xml", ".xml"])).toEqual([
      ".xml",
      "a.xml",
      "a.xmlbak",
      "B.xml",
      "m.xmlx",
      "p.xml~",
      "q.Xml",
      "s.xml.xml",
      "x.XML",
      "Z.xml",
    ]);
  });

  it("breaks a tie on a case-sensitive file system by the code units of the names", () => {
    expect(compareNtfsNames("a", "A")).toBeGreaterThan(0);
    expect(sortNtfsNames(["a", "A", "b"])).toEqual(["A", "a", "b"]);
    expect(compareNtfsNames("a", "a")).toBe(0);
  });
});

describe("IMP-030: NLS word sort of type names", () => {
  const { vectors } = readJson<{ vectors: { types: string[]; order: number[] }[] }>("nls-word-sort.json");

  vectors.forEach((vector, index) => {
    it(`orders ${vector.types.length} recorded type names as .NET did (vector ${index + 1})`, () => {
      const indexed = vector.types.map((type, at) => ({ type, at }));
      expect(sortByTypeName(indexed, (entry) => entry.type).map((entry) => entry.at)).toEqual(vector.order);
    });
  });

  it("matches the examples in the rule", () => {
    const sorted = (...names: string[]) => sortByTypeName(names, (name) => name);
    expect(sorted("-ab", "a--b", "a-b", "a'b", "ab-", "ab")).toEqual(["ab", "ab-", "a'b", "a-b", "a--b", "-ab"]);
    expect(sorted("A", "a")).toEqual(["a", "A"]);
    expect(sorted("ab", "a b", "a_b", "a.b")).toEqual(["a b", "a.b", "a_b", "ab"]);
    expect(sorted("b", "á", "a")).toEqual(["a", "á", "b"]);
  });

  it("is stable: equal names keep their order", () => {
    const rows = [
      { type: "b", id: 1 },
      { type: "a", id: 2 },
      { type: "b", id: 3 },
      { type: "a", id: 4 },
    ];
    expect(sortByTypeName(rows, (row) => row.type).map((row) => row.id)).toEqual([2, 4, 1, 3]);
  });

  it("builds the key of a string of specials with an empty primary section", () => {
    expect(nlsSortKey("-")).toEqual([1, 1, 1, 1, 0xff, 0xff, 0x82, 0x12, 0]);
  });

  it("refuses a type name with a character outside the table instead of guessing", () => {
    expect(() => nlsSortKey("Typ€")).toThrow(TypeNameOutsideRepertoireError);
    expect(() => sortByTypeName(["Ω"], (name) => name)).toThrow(/U\+03A9/);
    try {
      nlsSortKey("日本");
    } catch (error) {
      expect((error as TypeNameOutsideRepertoireError).typeName).toBe("日本");
      expect((error as TypeNameOutsideRepertoireError).character).toBe("日");
    }
  });
});
