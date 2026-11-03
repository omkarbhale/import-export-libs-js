import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { flavourOf, posix, win32 } from "./path.js";
import type { PathFlavour } from "./path.js";

/**
 * HOST-202: `posix` and `win32` of `path.ts` equal `node:path` for every function the core uses. Node is the oracle here: on
 * every run, each function is called with the same arguments on both and the results are compared, so the claim does not rest
 * on a recorded list.
 */

/** A seeded generator (mulberry32), so a failing case is the same on every machine. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = ["a", "B", ".", "..", "/", "\\", ":", "?", " ", "é"];

/** A path of up to ten tokens of the alphabet; one in eight is empty. */
function randomPath(next: () => number): string {
  if (next() < 0.125) return "";
  const length = 1 + Math.floor(next() * 10);
  let path = "";
  for (let i = 0; i < length; i += 1) path += ALPHABET[Math.floor(next() * ALPHABET.length)] as string;
  return path;
}

const CORPUS_SIZE = 20_000;

/** The corpus: pairs of paths, the same on every run. */
const corpus: Array<[string, string]> = (() => {
  const next = generator(20_260_502);
  return Array.from({ length: CORPUS_SIZE }, (): [string, string] => [randomPath(next), randomPath(next)]);
})();

/** The cases written by hand: the ones where the rules of a platform are least obvious. */
const HAND = [
  "",
  ".",
  "..",
  "/",
  "\\",
  "//",
  "\\\\",
  "///",
  "/..",
  "/../..",
  "../..",
  "a",
  "a/b",
  "a//b/./c/..",
  "a\\b\\..\\c",
  "a/b/",
  "a\\b\\",
  "a/./",
  "./a",
  "/a/b/../../..",
  "C:",
  "C:\\",
  "C:/",
  "c:",
  "c:\\x",
  "C:foo",
  "C:foo\\bar",
  "C:..\\foo",
  "C:\\..\\..",
  "C:\\a\\..\\..\\b",
  "D:\\x",
  "D:x",
  "C:/x/y",
  "1:\\x",
  "\\\\host\\share",
  "\\\\host\\share\\",
  "\\\\host\\share\\x",
  "\\\\host\\share\\x\\..\\..\\y",
  "\\\\host\\share\\..",
  "\\\\host\\",
  "\\\\host",
  "\\\\\\host\\share",
  "//host/share/x",
  "//host//share//x",
  "\\\\?\\C:\\x",
  "\\\\?\\C:\\",
  "\\\\?\\UNC\\host\\share\\x",
  "\\\\.\\pipe\\name",
  "\\\\.\\COM1",
  "\\\\.\\",
  "\\\\?\\",
  "\\?\\C:\\x",
  "?\\C:\\x",
  "\\x",
  "\\x\\y",
  "/x\\y/z",
  "x:y:z",
  "a.b.c",
  ".hidden",
  "a.",
  "a..",
  "..a",
  "dir\\file.tar.gz",
  "dir/.bashrc",
  " ",
  "a b\\c d",
  "é\\É",
  "\\\\host\\SHARE\\x",
];

const FLAVOURS: Array<{ name: string; ours: PathFlavour; node: nodePath.PlatformPath }> = [
  { name: "posix", ours: posix, node: nodePath.posix },
  { name: "win32", ours: win32, node: nodePath.win32 },
];

/** Runs a function, giving its result or the text of what it threw, so that a throw on one side and a value on the other differ. */
function outcome<T>(run: () => T): { value: T } | { thrown: string } {
  try {
    return { value: run() };
  } catch (error) {
    return { thrown: String(error) };
  }
}

/**
 * Node changed how `win32.normalize`, `join` and `resolve` read a `\\.\` or `\\?\` device path in a patch release of each line (Node 20.20.2 and
 * 24.18.1 read a device path by the new rules, 22.18.0 by the old ones); `path.ts` follows the new rules. On an older Node the inputs that have a device path are left out, so that the
 * rest of the comparison still runs there.
 */
const DEVICE_RULES_OF_NODE = nodePath.win32.normalize("\\\\.\\a\\..\\b") === "\\\\.\\b";
const DEVICE_PATH = /[\\/]{2}[.?]/;

/** Compares `ours` and `theirs` over `inputs`; the mismatches come back as text, empty when there is none. */
function mismatches<A extends unknown[]>(inputs: A[], ours: (...args: A) => unknown, theirs: (...args: A) => unknown): string[] {
  const found: string[] = [];
  for (const input of inputs) {
    if (!DEVICE_RULES_OF_NODE && DEVICE_PATH.test(input.join("\\"))) continue;
    const mine = outcome(() => ours(...input));
    const expected = outcome(() => theirs(...input));
    if (JSON.stringify(mine) !== JSON.stringify(expected)) {
      found.push(`${JSON.stringify(input)}: got ${JSON.stringify(mine)}, node gives ${JSON.stringify(expected)}`);
      if (found.length >= 10) break;
    }
  }
  return found;
}

const singles: Array<[string]> = [...HAND.map((path): [string] => [path]), ...corpus.map(([first]): [string] => [first])];
const handPairs: Array<[string, string]> = HAND.flatMap((first) => HAND.map((second): [string, string] => [first, second]));
const pairs: Array<[string, string]> = [...handPairs, ...corpus];
const triples: Array<[string, string, string]> = corpus.map(([first, second], index): [string, string, string] => [
  first,
  second,
  (corpus[(index + 1) % corpus.length] as [string, string])[0],
]);

describe("HOST-202: path.ts equals node:path", () => {
  it("states its corpus", () => {
    expect(corpus).toHaveLength(CORPUS_SIZE);
    expect(corpus.length).toBeGreaterThanOrEqual(20_000);
  });

  for (const { name, ours, node } of FLAVOURS) {
    describe(name, () => {
      it("has the separator of Node", () => {
        expect(ours.sep).toBe(node.sep);
      });

      it("join", () => {
        expect(mismatches(pairs, (a, b) => ours.join(a, b), (a, b) => node.join(a, b))).toEqual([]);
        expect(mismatches(triples, (a, b, c) => ours.join(a, b, c), (a, b, c) => node.join(a, b, c))).toEqual([]);
        expect(ours.join()).toBe(node.join());
        expect(ours.join("a")).toBe(node.join("a"));
      });

      it("dirname", () => {
        expect(mismatches(singles, (a) => ours.dirname(a), (a) => node.dirname(a))).toEqual([]);
      });

      it("normalize", () => {
        expect(mismatches(singles, (a) => ours.normalize(a), (a) => node.normalize(a))).toEqual([]);
      });

      it("parse", () => {
        expect(mismatches(singles, (a) => ours.parse(a), (a) => node.parse(a))).toEqual([]);
      });

      it("isAbsolute", () => {
        expect(mismatches(singles, (a) => ours.isAbsolute(a), (a) => node.isAbsolute(a))).toEqual([]);
      });

      it("basename, without and with a suffix", () => {
        expect(mismatches(singles, (a) => ours.basename(a), (a) => node.basename(a))).toEqual([]);
        expect(mismatches(pairs, (a, b) => ours.basename(a, b), (a, b) => node.basename(a, b))).toEqual([]);
        expect(mismatches(singles, (a) => ours.basename(`${a}.xml`, ".xml"), (a) => node.basename(`${a}.xml`, ".xml"))).toEqual([]);
      });

      it("resolveFrom(process.cwd(), …) equals resolve", () => {
        const cwd = process.cwd();
        expect(mismatches(singles, (a) => ours.resolveFrom(cwd, a), (a) => node.resolve(a))).toEqual([]);
        expect(mismatches(pairs, (a, b) => ours.resolveFrom(cwd, a, b), (a, b) => node.resolve(a, b))).toEqual([]);
        expect(mismatches(triples, (a, b, c) => ours.resolveFrom(cwd, a, b, c), (a, b, c) => node.resolve(a, b, c))).toEqual([]);
        expect(ours.resolveFrom(cwd)).toBe(node.resolve());
      });

      it("relativeFrom(process.cwd(), …) equals relative", () => {
        const cwd = process.cwd();
        expect(mismatches(pairs, (a, b) => ours.relativeFrom(cwd, a, b), (a, b) => node.relative(a, b))).toEqual([]);
      });
    });
  }

  // `resolve` of Node cannot be given a current directory, but a current directory that is absolute and has its drive is the
  // first segment of the same call: so the equality holds for every path that names no other drive, which the colon would
  describe("resolveFrom with a current directory of its own", () => {
    const noColon = corpus.filter(([first, second]) => !first.includes(":") && !second.includes(":"));

    it("posix: equals resolve(cwd, …)", () => {
      for (const cwd of ["/", "/work", "/work/a b/é"]) {
        expect(mismatches(noColon, (a, b) => posix.resolveFrom(cwd, a, b), (a, b) => nodePath.posix.resolve(cwd, a, b))).toEqual([]);
      }
    });

    it("win32: equals resolve(cwd, …)", () => {
      for (const cwd of ["C:\\", "C:\\work", "c:\\work\\a b\\é", "\\\\host\\share\\dir", "\\\\host\\share"]) {
        expect(mismatches(noColon, (a, b) => win32.resolveFrom(cwd, a, b), (a, b) => nodePath.win32.resolve(cwd, a, b))).toEqual([]);
      }
    });

    it("win32: a path on another drive starts at the root of that drive, one on the same drive at the current directory", () => {
      expect(win32.resolveFrom("C:\\work", "D:foo")).toBe("D:\\foo");
      expect(win32.resolveFrom("C:\\work", "C:foo")).toBe("C:\\work\\foo");
      expect(win32.resolveFrom("c:\\work", "C:foo")).toBe("C:\\work\\foo");
      expect(win32.resolveFrom("C:\\work", "\\x")).toBe("C:\\x");
      expect(win32.resolveFrom("\\\\host\\share\\dir", "\\x")).toBe("\\\\host\\share\\x");
    });
  });

  it("flavourOf follows the platform name", () => {
    expect(flavourOf("win32")).toBe(win32);
    expect(flavourOf("linux")).toBe(posix);
    expect(flavourOf("darwin")).toBe(posix);
    expect(flavourOf("browser")).toBe(posix);
  });
});
