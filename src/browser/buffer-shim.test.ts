import { Buffer as NodeBuffer } from "node:buffer";
import { afterAll, describe, expect, it } from "vitest";
import { type BufferClass, buildCases, usageKey } from "./buffer-conformance.js";
import { Buffer as ShimBuffer } from "./buffer-shim.js";

// Differential conformance of the browser's Buffer (the `buffer` package) against Node's (roadmap/browser-host.md, D5 and D14).
// Every method the core calls is compared over every corpus; the result must be byte-equal. @spec HOST-262
const node: BufferClass = NodeBuffer;
const shim = ShimBuffer as unknown as BufferClass;

type Outcome = { value: unknown } | { threw: { name: string; message: string } };

function outcome(run: () => unknown): Outcome {
  try {
    return { value: run() };
  } catch (error) {
    const e = error as { name?: string; message?: string };
    return { threw: { name: String(e.name), message: String(e.message) } };
  }
}

function preview(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 300 ? `${text.slice(0, 300)}... (${text.length} chars)` : text;
}

/** Differences that are allowed, and why they are not a difference the engine can observe: the exception type or message of a call that throws in both. */
const notes = new Map<string, string>();
/** Per case with a `differs` reason: how many items the shim and Node disagree on, out of how many. */
const differences = new Map<string, { differing: number; total: number; reason: string }>();
const triples: string[] = [];

const cases = buildCases(node);

describe("the shim is the buffer package, not Node's Buffer", () => {
  it("is a different class, with Node's methods under test", () => {
    expect(shim).not.toBe(node);
    expect(shim.from("é", "utf8").toString("hex")).toBe("c3a9");
    expect(shim.isBuffer(node.from("x"))).toBe(false);
  });
});

describe("Buffer conformance: shim against node:buffer (HOST-262)", () => {
  for (const entry of cases) {
    const key = usageKey(entry.method, entry.encoding);
    const triple = `${entry.method} | ${entry.encoding === "" ? "-" : entry.encoding} | ${entry.corpus}`;
    triples.push(triple);
    it(`${key} over ${entry.corpus} (${entry.items.length} items)`, () => {
      let differing = 0;
      entry.items.forEach((item, index) => {
        const expected = outcome(() => (entry.reference ?? entry.run)(node, item));
        const actual = outcome(() => entry.run(shim, item));
        const where = `${triple} item ${index}: ${preview(item)}`;
        if (entry.reference) {
          // A helper: it must equal Node's Buffer on Node (the Node build uses it too) and on the shim.
          const onNode = outcome(() => entry.run(node, item));
          expect(preview(onNode), `${where}: the helper on Node differs from Node's Buffer`).toBe(preview(expected));
        }
        if (entry.throws) {
          expect("threw" in expected, `${where}: Node did not throw`).toBe(true);
          expect("threw" in actual, `${where}: the shim did not throw (Node: ${preview(expected)})`).toBe(true);
          const a = (actual as { threw: { name: string; message: string } }).threw;
          const e = (expected as { threw: { name: string; message: string } }).threw;
          if (a.name !== e.name || a.message !== e.message) notes.set(`${entry.method}${entry.encoding ? `:${entry.encoding}` : ""} ${entry.corpus}`, `Node ${e.name}: ${e.message} | shim ${a.name}: ${a.message}`);
          return;
        }
        expect("threw" in expected ? expected.threw : undefined, `${where}: Node threw`).toBeUndefined();
        expect("threw" in actual ? actual.threw : undefined, `${where}: the shim threw`).toBeUndefined();
        const same = JSON.stringify((actual as { value: unknown }).value) === JSON.stringify((expected as { value: unknown }).value);
        if (!same && entry.differs) {
          differing++;
          return;
        }
        if (!same) {
          throw new Error(`${where}\n  Node: ${preview((expected as { value: unknown }).value)}\n  shim: ${preview((actual as { value: unknown }).value)}`);
        }
      });
      if (entry.differs) differences.set(`${entry.method}${entry.encoding ? `:${entry.encoding}` : ""} ${entry.corpus}`, { differing, total: entry.items.length, reason: entry.differs });
    });
  }

  afterAll(() => {
    const keys = new Set(cases.map((entry) => usageKey(entry.method, entry.encoding)));
    console.info(
      [
        `Buffer conformance: ${triples.length} (method, encoding, corpus) triples over ${keys.size} usage keys:`,
        ...triples.map((triple) => `  ${triple}`),
        `Calls where the raw shim differs from Node on some items, and the core goes through a helper instead (${differences.size} cases, ${[...differences.values()].reduce((sum, d) => sum + d.differing, 0)} differing items):`,
        ...[...differences].filter(([, d]) => d.differing > 0).map(([name, d]) => `  ${name}: ${d.differing} of ${d.total} items differ: ${d.reason}`),
        `Differences in the exception of calls that throw in both (${notes.size}):`,
        ...[...notes].map(([name, text]) => `  ${name}: ${text}`),
      ].join("\n"),
    );
  });

  it("finds the known differences of the raw shim (the reason the core goes through io/utf8.ts)", () => {
    const total = [...differences.values()].reduce((sum, d) => sum + d.differing, 0);
    expect(total, "the buffer package no longer differs from Node on UTF-8; io/utf8.ts and the guard's forbidden calls can go").toBeGreaterThan(0);
    for (const method of ["Buffer.from(string) utf8", "Buffer.byteLength utf8", "#toString utf8"]) {
      const encode = [...differences].filter(([name, d]) => name.startsWith(method.replace(" ", ":")) && d.differing > 0);
      expect(encode.length, method).toBeGreaterThan(0);
    }
  });

  it("compares at least 40 triples", () => {
    expect(new Set(triples).size).toBeGreaterThanOrEqual(40);
    expect(new Set(triples).size).toBe(triples.length);
  });
});
