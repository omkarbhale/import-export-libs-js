import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ArgumentException, NullReferenceException } from "../io/errors.js";
import { createElement, createXmlDocument } from "../xml/index.js";
import type { XmlElement } from "../xml/index.js";
import { NLS_AFTER_PREFIX_BREAKS, NLS_EQUALS_DOT, NLS_EQUALS_N_AFTER_N, NLS_IGNORABLE } from "./nls-startswith-data.js";
import { getPackagePath, isCorePackage, isDefaultPackage, isStandardPackage } from "./package-path.js";
import { observe, probeSection, quotedStrings, resultOf } from "./probe-output.js";

const doc = createXmlDocument();

function packageNode(name: string, path: string | null): XmlElement {
  const element = createElement(doc, "package");
  element.setAttribute("name", name);
  if (path !== null) element.setAttribute("path", path);
  return element;
}

describe("MAN-030: GetPackagePath replays probe 01 section 1", () => {
  const rows = probeSection("01-package-paths.out", "1 GetPackagePath").filter((line) => line.startsWith("name="));
  it("has the rows", () => expect(rows.length).toBe(44));

  for (const row of rows) {
    const [name, path, folder] = quotedStrings(row) as [string, string, string];
    it(`name=${JSON.stringify(name)} path=${JSON.stringify(path)} folder=${JSON.stringify(folder)}`, () => {
      expect(observe(() => getPackagePath(packageNode(name, path), folder))).toEqual(resultOf(row));
    });
  }

  it("treats a missing path attribute as blank", () => {
    expect(getPackagePath(packageNode("com.aras.innovator.core", null), "C:\\m")).toBe("C:\\m\\.\\\\com\\aras\\innovator\\core");
    expect(getPackagePath(packageNode("NoPath", null), "C:\\m")).toBe("C:\\m\\.\\");
  });

  it("refuses a null package node with a null reference", () => {
    expect(() => getPackagePath(null, "C:\\m")).toThrow(NullReferenceException);
  });

  it("refuses a null manifest folder only when the path is not rooted", () => {
    expect(() => getPackagePath(packageNode("My.Pkg", "x"), null)).toThrow("Value cannot be null.\r\nParameter name: path1");
    expect(getPackagePath(packageNode("My.Pkg", "C:\\abs"), null)).toBe("C:\\abs");
  });
});

describe("MAN-030: Path.Combine and the rooted test replay probe 08 section 13", () => {
  for (const row of probeSection("08-path-chars-and-edges.out", "13 Combine / IsPathRooted shapes")) {
    const [folder, path] = quotedStrings(row) as [string, string];
    it(`folder=${JSON.stringify(folder)} path=${JSON.stringify(path)}`, () => {
      expect(observe(() => getPackagePath(packageNode("N", path), folder))).toEqual(resultOf(row));
    });
  }
});

describe("MAN-030: the characters that make GetPackagePath throw (probe 08 section 12)", () => {
  const thrower = probeSection("08-path-chars-and-edges.out", "12 which characters make GetPackagePath throw (path attr / folder)")
    .find((line) => line.startsWith("path attr throws for"))
    ?.split("=> ")[1]
    ?.split(" ")
    .map((hex) => Number.parseInt(hex, 16));

  it("lists the controls, quote, less-than, greater-than and bar, in the path, the folder and a rooted path", () => {
    expect(thrower).toEqual([...Array.from({ length: 32 }, (_, code) => code), 0x22, 0x3c, 0x3e, 0x7c]);
    for (let code = 0; code <= 0x9f; code += 1) {
      const char = String.fromCharCode(code);
      const bad = thrower?.includes(code) ?? false;
      const inPath = () => getPackagePath(packageNode("N", `a${char}b`), "C:\\m");
      const inFolder = () => getPackagePath(packageNode("N", "x"), `C:\\a${char}b`);
      const inRooted = () => getPackagePath(packageNode("N", `C:\\a${char}b`), "C:\\m");
      for (const call of [inPath, inFolder, inRooted]) {
        if (bad) expect(call).toThrow(new ArgumentException("Illegal characters in path."));
        else expect(call).not.toThrow();
      }
    }
  });
});

describe("MAN-031: standard packages replay probe 01 section 2", () => {
  for (const row of probeSection("01-package-paths.out", "2 IsStandard").filter((line) => line.startsWith("name="))) {
    const [name] = quotedStrings(row) as [string];
    const expected = /standard=(\w+) core=(\w+) default=(\w+)/.exec(row) as RegExpExecArray;
    it(`name=${JSON.stringify(name)}`, () => {
      expect([isStandardPackage(name), isCorePackage(name), isDefaultPackage(name)]).toEqual(
        [expected[1], expected[2], expected[3]].map((word) => word === "True"),
      );
    });
  }

  it("refuses a null name with a null reference", () => {
    for (const test of [isStandardPackage, isCorePackage, isDefaultPackage]) expect(() => test(null)).toThrow(NullReferenceException);
  });

  it("does not fold characters that .NET's ordinal comparison leaves alone (long s)", () => {
    expect(isDefaultPackage("com.aras.default\u017F.x")).toBe(false);
    expect(isDefaultPackage("com.aras.defaults\u017F.x")).toBe(false);
    expect(isDefaultPackage("com.aras.defaults.x")).toBe(true);
  });

  it("agrees with the code point ranges of the recorded probe", () => {
    const recorded = JSON.parse(readFileSync(new URL("../../fixtures/manifest/14.0.7/nls-startswith.json", import.meta.url), "utf8")) as Record<string, number[][]>;
    expect(NLS_IGNORABLE).toEqual(recorded.ignorable);
    expect(NLS_AFTER_PREFIX_BREAKS).toEqual(recorded.afterPrefixBreaks);
    expect(NLS_EQUALS_DOT).toEqual(recorded.equalsDot);
    expect(NLS_EQUALS_N_AFTER_N).toEqual(recorded.equalsNAfterN);
  });

  it("follows the ranges: ignorable code points are skipped, marks after the final dot attach, U+2024 is a dot", () => {
    const soft = "\u00AD";
    expect(isCorePackage(`com.aras.innovator${soft}.x`)).toBe(true);
    expect(isCorePackage(`${soft}com.aras.innovator.x`)).toBe(true);
    expect(isCorePackage("com.aras.innovator.\u0301x")).toBe(false);
    expect(isCorePackage("com.aras.innovator.solution.\u0301x")).toBe(true);
    expect(isCorePackage("com\u2024aras.innovator.x")).toBe(true);
    expect(isCorePackage("com.aras.in\u3031ovator.x")).toBe(true);
    expect(isCorePackage("com.aras.inn\u3031ovator.x")).toBe(false);
    expect(isCorePackage("com.aras.innovator.\u{E0001}x")).toBe(true);
    expect(isCorePackage("com.aras.\u0131nnovator.x")).toBe(false);
  });
});
