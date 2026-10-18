import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { collisionCases, dec, enc, evaluateCases, generateCases } from "./hashtable-cases.js";
import { DuplicateKeyError, NetfxHashtable, RandomizedHashingError, netfxStringHash64 } from "./netfx-hashtable.js";

const keysOf = (table: NetfxHashtable<unknown>): string[] => [...table.keys()];

describe("MAN-017: the 64-bit String.GetHashCode", () => {
  // from the probe of ticket 07, identical on .NET Framework 4.8.1 and in the emulation
  const vectors: [string, number][] = [
    ["", 371857150],
    ["a", 372029373],
    ["ab", 1093630535],
    ["abc", 1099313834],
    ["com.aras.innovator.solution.PLM", 1099781384],
    ["005102D88C68467C9378686CCF08AC3D", 395110467],
    ["a\u0000b", 372029373],
    ["\u{1F600}", 1126268081],
  ];
  for (const [text, hash] of vectors) {
    it(`hashes ${JSON.stringify(text)} as ${hash}`, () => expect(netfxStringHash64(text)).toBe(hash));
  }
});

describe("MAN-017: the table", () => {
  it("enumerates the buckets from the last to the first, not in insertion order", () => {
    const table = new NetfxHashtable<number>();
    "abcdefgh".split("").forEach((key, index) => table.set(key, index));
    expect(keysOf(table)).toEqual(["b", "c", "a", "f", "g", "d", "e", "h"]);
  });

  it("depends on the order of insertion", () => {
    const forward = new NetfxHashtable<number>();
    const backward = new NetfxHashtable<number>();
    const keys = Array.from({ length: 40 }, (_, index) => `key-${index}`);
    keys.forEach((key) => forward.set(key, 0));
    [...keys].reverse().forEach((key) => backward.set(key, 0));
    expect(keysOf(forward)).not.toEqual(keysOf(backward));
    expect(keysOf(forward).sort()).toEqual(keysOf(backward).sort());
  });

  it("keeps the bucket of a key that is set again, and the new value", () => {
    const table = new NetfxHashtable<number>();
    "abcdefgh".split("").forEach((key, index) => table.set(key, index));
    table.set("c", 99);
    expect(keysOf(table)).toEqual(["b", "c", "a", "f", "g", "d", "e", "h"]);
    expect(table.get("c")).toBe(99);
    expect(table.count).toBe(8);
  });

  it("refuses Add of a present key with the text of .NET, two spaces before 'Key being added'", () => {
    const table = new NetfxHashtable<number>();
    table.add("d", 1);
    expect(() => table.add("d", 2)).toThrow(DuplicateKeyError);
    expect(() => table.add("d", 2)).toThrow("Item has already been added. Key in dictionary: 'd'  Key being added: 'd'");
    expect(table.get("d")).toBe(1);
  });

  it("removes keys, and a removed key can be added again", () => {
    const table = new NetfxHashtable<number>();
    "abcdefgh".split("").forEach((key, index) => table.set(key, index));
    table.remove("c");
    table.remove("zz");
    expect(table.has("c")).toBe(false);
    expect(table.count).toBe(7);
    expect(keysOf(table)).toEqual(["b", "a", "f", "g", "d", "e", "h"]);
    table.set("c", 1);
    expect(table.has("c")).toBe(true);
  });

  it("treats keys as ordinal: case and padding make other keys", () => {
    const table = new NetfxHashtable<number>();
    for (const key of ["a", "A", " a "]) table.set(key, 0);
    expect(table.count).toBe(3);
  });

  it("replays the host's nested table: packages in order of first sight, then each package's items", () => {
    const table = new NetfxHashtable<NetfxHashtable<string>>();
    for (const [pkg, id] of [["P", "1"], ["Q", "2"], ["P", "3"], ["P", "1"]] as const) {
      let inner = table.get(pkg);
      if (!inner) table.set(pkg, (inner = new NetfxHashtable<string>()));
      inner.set(id, "x");
    }
    expect(table.count).toBe(2);
    expect(keysOf(table.get("P") as NetfxHashtable<string>).sort()).toEqual(["1", "3"]);
  });
});

describe("MAN-017: probe cases run in 64-bit Windows PowerShell 5.1", () => {
  // The 1,200 random operation sequences (indexer, Add and Remove, 3,273 operations at most, with exotic Unicode,
  // lone surrogates and NULs), the 200 nested tables of the host's shape and 421,159 hashes of ticket 07, seed 7.
  // The digest is that of the output .NET printed for the same cases (fixtures/manifest/14.0.7/hashtable/README.md).
  it("gives byte for byte what .NET printed (sha256 of the output)", { timeout: 120_000 }, () => {
    const hash = createHash("sha256");
    let lines = 0;
    for (const line of evaluateCases(generateCases(7))) {
      hash.update(`${line}\n`);
      lines += 1;
    }
    expect(lines).toBe(422_559);
    expect(hash.digest("hex")).toBe("fd2dd7ffde7fa5b4dc5075e80d9ed294639d797999b6ac7ebb7982a53b523d5f");
  });

  it("encodes keys as base64 of UTF-16LE code units, lone surrogates and NULs included", () => {
    for (const text of ["", "abc", "\ud800", "a\u0000b", "\u{1F600}"]) expect(dec(enc(text))).toBe(text);
  });
});

describe("MAN-018: past 100 probe collisions .NET randomizes the order, and the port stops", () => {
  const keys = collisionCases()[1]?.split("\t")[2]?.split(" ").map((op) => dec(op.slice(2))) ?? [];

  it("builds the collision keys with one hash", () => {
    expect(keys.length).toBeGreaterThan(102);
    expect(new Set(keys.map(netfxStringHash64)).size).toBe(1);
  });

  it("follows 101 keys of one hash, as .NET does (the order is deterministic there)", () => {
    const table = new NetfxHashtable<number>("test table");
    keys.slice(0, 101).forEach((key, index) => table.set(key, index));
    expect(table.count).toBe(101);
  });

  it("stops at the 102nd, with an error that names the table and the key", () => {
    const table = new NetfxHashtable<number>("the test table");
    keys.slice(0, 101).forEach((key, index) => table.set(key, index));
    const error = (() => {
      try {
        table.set(keys[101] as string, 101);
      } catch (caught) {
        return caught as RandomizedHashingError;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(RandomizedHashingError);
    expect(error?.message).toContain("the test table");
    expect(error?.message).toContain(JSON.stringify(keys[101]));
  });
});
