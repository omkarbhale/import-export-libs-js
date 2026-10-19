import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadXml, outerXml, removeChild } from "../xml/index.js";
import type { XmlElement } from "../xml/index.js";
import { DescendantSearch, RelationshipItemSearch, lazyNodeList } from "./live-node-list.js";

const FOLDER = new URL("../../fixtures/unknown-refs/enumeration/", import.meta.url);
const lines = (name: string): string[] => readFileSync(new URL(name, FOLDER), "utf8").split("\n").filter((line) => line !== "");

/** The recorded cases: the document, the `k` values to remove, and what the real framework saw and left. */
function recorded(mode: string): Array<{ xml: string; remove: Set<string>; seen: string; after: string }> {
  const cases = lines(`${mode}-cases.tsv`);
  const results = lines(`${mode}-dotnet.tsv`);
  expect(results).toHaveLength(cases.length);
  return cases.map((line, index) => {
    const [xml = "", remove = ""] = line.split("\t");
    const [seen = "", after = ""] = (results[index] as string).split("\t");
    return { xml, remove: new Set(remove.split(",").filter((k) => k !== "")), seen, after };
  });
}

const key = (element: XmlElement): string => element.getAttribute("k") ?? "";

describe("the enumeration while removing (EXP-615)", () => {
  it("visits and leaves what the real framework did for .//Relationships/Item", () => {
    for (const [index, { xml, remove, seen, after }] of recorded("relationships").entries()) {
      const doc = loadXml(xml, { preserveWhitespace: false });
      const visited: string[] = [];
      const search = new RelationshipItemSearch(doc);
      for (const item of lazyNodeList(() => search.next())) {
        visited.push(key(item));
        if (!remove.has(key(item))) continue;
        const parent = item.parentNode as XmlElement;
        removeChild(parent, item);
        if (!parent.hasChildNodes()) removeChild(parent.parentNode as XmlElement, parent);
      }
      expect(visited.join(","), `case ${index + 1}: the items seen`).toBe(seen);
      expect(outerXml(doc), `case ${index + 1}: the document left`).toBe(after);
    }
  });

  it("visits and leaves what the real framework did for .//Item[@type='Method' and @action='get']", () => {
    for (const [index, { xml, remove, seen, after }] of recorded("methods").entries()) {
      const doc = loadXml(xml, { preserveWhitespace: false });
      const visited: string[] = [];
      const search = new DescendantSearch(doc, "Item", (item) => item.getAttribute("type") === "Method" && item.getAttribute("action") === "get");
      for (const item of lazyNodeList(() => search.next())) {
        visited.push(key(item));
        if (!remove.has(key(item))) continue;
        const parent = item.parentNode as XmlElement;
        const grandparent = parent.parentNode;
        if (grandparent) removeChild(grandparent, parent);
      }
      expect(visited.join(","), `case ${index + 1}: the items seen`).toBe(seen);
      expect(outerXml(doc), `case ${index + 1}: the document left`).toBe(after);
    }
  });

  it("gives the documented example: removing a leaves c1 unvisited, and a1 and a2 still visited", () => {
    const text = '<R><Relationships><Item k="a"><Relationships><Item k="a1"/><Item k="a2"/></Relationships></Item><Item k="b"/><Item k="c"><Relationships><Item k="c1"/></Relationships></Item></Relationships></R>';
    for (const removing of [new Set(["a"]), new Set<string>()]) {
      const doc = loadXml(text, { preserveWhitespace: false });
      const visited: string[] = [];
      const search = new RelationshipItemSearch(doc);
      for (const item of lazyNodeList(() => search.next())) {
        visited.push(key(item));
        if (removing.has(key(item))) removeChild(item.parentNode as XmlElement, item);
      }
      expect(visited.join(",")).toBe(removing.size > 0 ? "a,a1,a2,b,c" : "a,a1,a2,b,c,c1");
    }
  });

  it("reads one element ahead of the loop", () => {
    const reads: number[] = [];
    let next = 0;
    const seen: Array<[number, number[]]> = [];
    for (const value of lazyNodeList(() => (next < 4 ? (reads.push(next), next++) : undefined))) {
      seen.push([value, [...reads]]);
    }
    expect(seen).toEqual([
      [0, [0, 1]],
      [1, [0, 1, 2]],
      [2, [0, 1, 2, 3]],
      [3, [0, 1, 2, 3]],
    ]);
  });
});
