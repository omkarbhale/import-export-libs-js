import { describe, expect, it } from "vitest";
import { DotNetException } from "../client/dotnet.js";
import { AggregateException } from "../export/parallel-for-each.js";
import { exceptionText } from "./exception-text.js";

describe("exceptionText", () => {
  it("is the type name and the message", () => {
    expect(exceptionText(new DotNetException("System.Xml.XmlException", "Data at the root level is invalid."))).toBe("System.Xml.XmlException: Data at the root level is invalid.");
  });

  it("continues an AggregateException's first line with its first inner exception, as Exception.ToString does", () => {
    const inner = new DotNetException("System.Xml.XmlException", "Data at the root level is invalid. Line 1, position 1.");
    expect(exceptionText(new AggregateException([inner, new Error("second")]))).toBe(
      "System.AggregateException: One or more errors occurred. ---> System.Xml.XmlException: Data at the root level is invalid. Line 1, position 1.",
    );
    expect(exceptionText(new AggregateException([]))).toBe("System.AggregateException: One or more errors occurred.");
  });
});
