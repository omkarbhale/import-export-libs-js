import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toLowerInvariant } from "./invariant-lower.js";

/** LP-013: `ToLower(CultureInfo.InvariantCulture)` replayed from the table the probe recorded (`fixtures/language-pack/invariant-lower.json`). */
const table = JSON.parse(readFileSync(new URL("../../fixtures/language-pack/invariant-lower.json", import.meta.url), "utf8")) as {
  pairs: [string, string][];
  astral: [string, string][];
};

describe("LP-013: the invariant lower-casing", () => {
  it("maps every code point of the recorded table, and every BMP unit it does not list to itself", () => {
    const mapped = new Map(table.pairs.map(([from, to]) => [Number.parseInt(from, 16), Number.parseInt(to, 16)]));
    expect(mapped.size).toBe(973);
    for (let unit = 0; unit <= 0xffff; unit += 1) {
      if (unit >= 0xd800 && unit <= 0xdfff) continue;
      expect(toLowerInvariant(String.fromCharCode(unit)).charCodeAt(0), `U+${unit.toString(16)}`).toBe(mapped.get(unit) ?? unit);
    }
    expect(toLowerInvariant("\ud800")).toBe("\ud800");
    expect(toLowerInvariant("\udc00x")).toBe("\udc00x");
  });

  it("maps the supplementary-plane code points as one code point", () => {
    expect(table.astral).toHaveLength(40);
    for (const [from, to] of table.astral) {
      expect(toLowerInvariant(String.fromCodePoint(Number.parseInt(from, 16))), from).toBe(String.fromCodePoint(Number.parseInt(to, 16)));
    }
    expect(toLowerInvariant("A\u{1F600}\u{10400}")).toBe("a\u{1F600}\u{10428}");
  });

  it("has no context rule and no special casing, which JavaScript's toLowerCase has", () => {
    expect(toLowerInvariant("\u03a3")).toBe("\u03c3");
    expect("\u03a3".toLowerCase()).toBe("\u03c3");
    expect(toLowerInvariant("\u0391\u03a3")).toBe("\u03b1\u03c3");
    expect("\u0391\u03a3".toLowerCase()).toBe("\u03b1\u03c2");
    expect(toLowerInvariant("\u0130")).toBe("\u0130");
    expect("\u0130".toLowerCase()).not.toBe("\u0130");
    expect(toLowerInvariant("\u00c9X")).toBe("\u00e9x");
  });
});
