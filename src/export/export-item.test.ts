import { describe, expect, it } from "vitest";
import { DotNetException } from "../client/dotnet.js";
import { CItemException } from "../client/fault.js";
import { XPathException, XmlException } from "../xml/errors.js";
import { exportFailure } from "./export-errors.js";
import { ExportItem, exportFileName } from "./export-item.js";

describe("an item and its file name (EXP-002)", () => {
  it("prints as its keyed name", () => {
    expect(String(new ExportItem("Part", "ID", "ItemType"))).toBe("Part");
  });

  it.each([
    ["Part", "Part.xml"],
    ["  ", "  .xml"],
    [" Part ", " Part .xml"],
    ["café €", "café €.xml"],
    ["", "ID7.xml"],
    ["True/False", "ID7.xml"],
    ["PE: rollup", "ID7.xml"],
    ['say "hi"', "ID7.xml"],
    ["a<b", "ID7.xml"],
    ["a>b", "ID7.xml"],
    ["a|b", "ID7.xml"],
    ["a?b", "ID7.xml"],
    ["a*b", "ID7.xml"],
    ["a\\b", "ID7.xml"],
    ["tab\there", "ID7.xml"],
    ["nul\u0000", "ID7.xml"],
    ["unit\u001f", "ID7.xml"],
    ["del\u007f", "del\u007f.xml"],
    ["\u0080 high", "\u0080 high.xml"],
  ])("names the file of keyed name %j %j", (keyedName, expected) => {
    expect(exportFileName(new ExportItem(keyedName, "ID7", "Part"))).toBe(expected);
  });

  it("falls back to the requested id as it was given", () => {
    expect(exportFileName(new ExportItem("a/b", "id with:colon", "Part"))).toBe("id with:colon.xml");
  });
});

describe("what Export catches (EXP-054, EXP-055)", () => {
  it("wraps an XmlException, a NullReferenceException and an XPathException as CItemException -1", () => {
    for (const error of [
      new DotNetException("System.Xml.XmlException", "Root element is missing."),
      new XmlException("Data at the root level is invalid.", 1, 1),
      new DotNetException("System.NullReferenceException", "Object reference not set to an instance of an object."),
      new DotNetException("System.Xml.XPath.XPathException", "bad"),
      new XPathException("Expression must evaluate to a node-set."),
    ]) {
      const wrapped = exportFailure(error);
      expect(wrapped).toBeInstanceOf(CItemException);
      expect(wrapped).toMatchObject({ faultcode: -1, message: `${error.message} Can't export item.`, faultdetail: `${error.message} Can't export item.` });
    }
  });

  it("writes the type name and message where the engine wrote the stack text", () => {
    const wrapped = exportFailure(new DotNetException("System.NullReferenceException", "Object reference not set to an instance of an object."));
    expect((wrapped as CItemException).faultstring).toBe("System.NullReferenceException: Object reference not set to an instance of an object.");
  });

  it("lets a CItemException and every other exception through as they are", () => {
    const fault = new CItemException(999, "boom", "boom");
    const other = new DotNetException("System.IO.IOException", "disk full");
    const argument = new DotNetException("System.ArgumentException", "Illegal characters in path.");
    expect(exportFailure(fault)).toBe(fault);
    expect(exportFailure(other)).toBe(other);
    expect(exportFailure(argument)).toBe(argument);
  });
});
