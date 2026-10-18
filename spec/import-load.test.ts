import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Replays the recorded .NET evidence in fixtures/import-load/ against the reference
 * algorithms that spec/import-load.md writes down (IMP-004, IMP-030). The build ticket
 * for import loading implements the same algorithms in src/ and replays the same files.
 */

const DIR = fileURLToPath(new URL("../fixtures/import-load/", import.meta.url));
const readJson = <T>(name: string): T => JSON.parse(readFileSync(DIR + name, "utf8")) as T;

const units = (hex: string): string => hex.split(" ").map((u) => String.fromCharCode(parseInt(u, 16))).join("");

describe("IMP-004: NTFS directory order", () => {
  const { pairs } = readJson<{ pairs: [string, string][] }>("invariant-upper.json");
  const upper = new Map(pairs.map(([from, to]) => [parseInt(from, 16), parseInt(to, 16)]));
  const key = (name: string): string =>
    Array.from({ length: name.length }, (_, i) => {
      const unit = name.charCodeAt(i);
      return String.fromCharCode(upper.get(unit) ?? unit);
    }).join("");
  const order = (a: string, b: string): number => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : a < b ? -1 : a > b ? 1 : 0;
  };

  const { runs } = readJson<{ runs: { files: string[]; dirs: string[] }[] }>("listing-order.json");
  runs.forEach((run, index) => {
    it(`reproduces the files NTFS listed in run ${index + 1}`, () => {
      const files = run.files.map(units);
      expect([...files].reverse().sort(order)).toEqual(files);
    });
    it(`reproduces the directories NTFS listed in run ${index + 1}`, () => {
      const dirs = run.dirs.map(units);
      expect([...dirs].reverse().sort(order)).toEqual(dirs);
    });
  });

  it("is not the host's upper-casing", () => {
    expect(upper.get(0x131)).toBeUndefined();
    expect(upper.get(0x17f)).toBeUndefined();
    expect(upper.get(0xb5)).toBeUndefined();
    expect(upper.get(0xff)).toBe(0x178);
    expect("ß".toUpperCase()).toBe("SS");
    expect(upper.get(0xdf)).toBeUndefined();
  });
});

describe("IMP-030: NLS word sort of build.xsl's @type", () => {
  interface Weights {
    p?: string;
    d?: string;
    c?: string;
    x?: string;
    special?: string;
  }
  const { chars, vectors } = readJson<{
    chars: Record<string, Weights>;
    vectors: { types: string[]; order: number[] }[];
  }>("nls-word-sort.json");

  const bytes = (hex: string | undefined): number[] =>
    hex === undefined ? [] : (hex.match(/../g) ?? []).map((b) => parseInt(b, 16));

  /** The key of IMP-030: P 01 D 01 C 01 X 01 S 00. */
  function sortKey(text: string): number[] {
    const primary: number[] = [];
    const diacritic: number[] = [];
    const casing: number[] = [];
    const extra: number[] = [];
    const specials: number[] = [];
    let pairs = 0;
    for (const ch of text) {
      const w = chars[ch.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? ""];
      if (!w) throw new Error(`U+${ch.codePointAt(0)?.toString(16)} is outside the IMP-030 repertoire`);
      if (w.special !== undefined) {
        specials.push(0xff, 0xff - pairs, ...bytes(w.special));
        continue;
      }
      const p = bytes(w.p);
      const count = p.length / 2;
      primary.push(...p);
      for (const [target, section] of [[diacritic, w.d], [casing, w.c]] as const) {
        const own = bytes(section);
        target.push(...own, ...Array<number>(count - own.length).fill(2));
      }
      extra.push(...bytes(w.x));
      pairs += count;
    }
    const trim = (section: number[]): number[] => {
      while (section.at(-1) === 2) section.pop();
      return section;
    };
    return [...primary, 1, ...trim(diacritic), 1, ...trim(casing), 1, ...extra, 1, ...specials, 0];
  }

  const compare = (a: number[], b: number[]): number => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d !== 0) return d;
    }
    return a.length - b.length;
  };

  vectors.forEach((vector, index) => {
    it(`orders ${vector.types.length} recorded type names as .NET did (vector ${index + 1})`, () => {
      const keys = vector.types.map(sortKey);
      const ranked = vector.types.map((_, i) => i).sort((a, b) => compare(keys[a] ?? [], keys[b] ?? []) || a - b);
      expect(ranked).toEqual(vector.order);
    });
  });

  it("matches the examples in the rule", () => {
    const sorted = (...names: string[]) => [...names].sort((a, b) => compare(sortKey(a), sortKey(b)));
    expect(sorted("-ab", "a--b", "a-b", "a'b", "ab-", "ab")).toEqual(["ab", "ab-", "a'b", "a-b", "a--b", "-ab"]);
    expect(sorted("A", "a")).toEqual(["a", "A"]);
    expect(sorted("ab", "a b", "a_b", "a.b")).toEqual(["a b", "a.b", "a_b", "ab"]);
  });
});
