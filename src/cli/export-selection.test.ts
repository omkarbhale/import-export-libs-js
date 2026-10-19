import { describe, expect, it } from "vitest";
import { parseItem, parseItemLines, parseItems, suggestions } from "./export-selection.js";
import { UsageError } from "./usage.js";

describe("an item is written Type:id (HOST-002)", () => {
  it("splits at the first colon, so an id may hold one only if it is the id alphabet", () => {
    expect(parseItem("Life Cycle Map:0123abcd")).toEqual({ type: "Life Cycle Map", id: "0123abcd" });
    expect(() => parseItem("List:a:b")).toThrow(UsageError);
  });

  it.for([
    ["", "is not Type:id"],
    ["List", "is not Type:id"],
    [":ABC", "no ItemType"],
    ["List:", "no id"],
    [" List:ABC", "white space"],
    ["Li\u0001st:ABC", "cannot be in a name"],
    ['Li"st:ABC', "cannot be in a name"],
    ["List:A B", "an id with a character"],
    ["List:A'B", "an id with a character"],
    ["List:A,B", "an id with a character"],
  ] as const)("refuses %j", ([text, reason]) => {
    expect(() => parseItem(text)).toThrow(reason);
  });

  it("refuses one id for two types, ignoring case, and allows the same item twice", () => {
    expect(() => parseItems(["List:abc", "Method:ABC"])).toThrow("given for two ItemTypes");
    expect(parseItems(["List:abc", "List:ABC"])).toHaveLength(2);
  });
});

describe("items on standard input (HOST-003)", () => {
  it("takes one per line, trims, skips empty lines and reads CRLF", () => {
    expect(parseItemLines("List:A1\r\n  Method:B2  \r\n\r\n\n")).toEqual([
      { type: "List", id: "A1" },
      { type: "Method", id: "B2" },
    ]);
  });

  it("names the line of a bad item", () => {
    expect(() => parseItemLines("List:A1\nnope")).toThrow("standard input, line 2: 'nope' is not Type:id");
  });
});

describe("the suggestions for an unknown package (HOST-015)", () => {
  const known = ["com.aras.innovator.core", "com.aras.innovator.cui", "com.aras.innovator.es", "other"];

  it("keeps the names within the edit distance, closest first", () => {
    expect(suggestions("com.aras.innovator.corre", known)).toEqual(["com.aras.innovator.core"]);
    expect(suggestions("COM.ARAS.INNOVATOR.CUI", known)[0]).toBe("com.aras.innovator.cui");
  });

  it("also takes a name that contains the typed one or that it contains", () => {
    expect(suggestions("innovator.es", known)).toEqual(["com.aras.innovator.es"]);
    expect(suggestions("com.aras.innovator.es.extra", known)).toContain("com.aras.innovator.es");
  });

  it("gives nothing for a name that is far from all", () => {
    expect(suggestions("zzzzzzzzzzzz", known)).toEqual([]);
  });

  it("gives three at most, ties by ordinal name", () => {
    expect(suggestions("pkg", ["pkg.d", "pkg.c", "pkg.a", "pkg.b"])).toEqual(["pkg.a", "pkg.b", "pkg.c"]);
  });
});
