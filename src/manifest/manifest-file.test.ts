import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EngineNotSupportedError } from "../client/item-helper.js";
import { ExportItem } from "../export/export-item.js";
import { ArgumentException, ArgumentNullException, NullReferenceException } from "../io/errors.js";
import { loadXml, outerXml, XPathException } from "../xml/index.js";
import type { XmlDocument, XmlElement } from "../xml/index.js";
import { ManifestFile, MOVE_TO_ORDERED_LIST_MAX_DEPTH, StackOverflowException } from "./manifest-file.js";
import { DuplicateKeyError } from "./netfx-hashtable.js";
import { observe, probeSection, quotedStrings, resultOf, unescapeProbe } from "./probe-output.js";
import { getSolutionPath } from "./solution-path.js";

const work = mkdtempSync(join(tmpdir(), "libsjs-manifest-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

let counter = 0;
/** A manifest read from the XML text, the way the probes made theirs: through a file in UTF-8 without a mark. */
function manifestOf(xml: string): ManifestFile {
  counter += 1;
  const path = join(work, `m${counter}.mf`);
  writeFileSync(path, xml, "utf8");
  return new ManifestFile(path);
}

const CIRCULAR = (name: string) => `There is a circular dependency on package '${name}'`;
const MISSING = (name: string) =>
  `One of imported packages depends on the package '${name}' that neither imported in this session nor exists in the database`;

describe("MAN-002 MAN-006: a new manifest and Save", () => {
  it("is <imports /> without a mark or declaration when empty", () => {
    const path = join(work, "empty.mf");
    new ManifestFile().save(path);
    expect(readFileSync(path).toString("latin1")).toBe("<imports />");
  });

  it("writes packages, dependencies and elements with two-space indentation and CR LF", () => {
    const mf = new ManifestFile();
    const p = mf.addPackage("My.Pkg");
    const dep = mf.addDependsOn(p, "com.aras.innovator.core");
    mf.addReferencedElement(dep, new ExportItem("Part", "ABC", "ItemType"));
    mf.addDependsOn(p, "other");
    const path = join(work, "full.mf");
    mf.save(path);
    expect(readFileSync(path, "utf8")).toBe(
      '<imports>\r\n  <package name="My.Pkg" path="Pkg\\Import">\r\n    <dependson name="com.aras.innovator.core">\r\n' +
        '      <referenced_element id="ABC" type="ItemType" descr="Part" />\r\n    </dependson>\r\n    <dependson name="other" />\r\n  </package>\r\n</imports>',
    );
  });

  it("reads a manifest it wrote and saves it again with the same bytes", () => {
    const mf = new ManifestFile();
    mf.addPackage("My.Pkg");
    const first = join(work, "rt.mf");
    const second = join(work, "rt2.mf");
    mf.save(first);
    const again = new ManifestFile(first);
    expect(again.getAllPackageNames()).toEqual(["My.Pkg"]);
    again.save(second);
    expect(readFileSync(second)).toEqual(readFileSync(first));
  });

  it("fails as .NET does for a missing folder, an empty path and a null path", () => {
    const mf = new ManifestFile();
    expect(observe(() => mf.save(join(work, "nodir", "x.mf")) as unknown as string)).toMatchObject({ type: "DirectoryNotFoundException" });
    expect(() => mf.save("")).toThrow(new ArgumentException("Empty path name is not legal."));
    expect(() => mf.save(null)).toThrow("Path cannot be null.\r\nParameter name: path");
  });
});

describe("MAN-003: reading", () => {
  it("fails with the exceptions of .NET for a missing file, a missing folder, an empty file and malformed text", () => {
    const missing = join(work, "missing.mf");
    expect(() => new ManifestFile(missing)).toThrow(`Could not find file '${missing}'.`);
    const nodir = join(work, "nodir", "x.mf");
    expect(() => new ManifestFile(nodir)).toThrow(`Could not find a part of the path '${nodir}'.`);
    expect(() => manifestOf("")).toThrow("Root element is missing.");
    expect(() => manifestOf("<imports><package></imports>")).toThrow(
      "The 'package' start tag on line 1 position 11 does not match the end tag of 'imports'. Line 1, position 21.",
    );
    expect(() => new ManifestFile("")).toThrow("Empty path name is not legal.");
    expect(() => new ManifestFile(null)).toThrow("Value cannot be null.\r\nParameter name: path");
  });

  it("accepts a declaration and comments, and finds nothing in another root or a namespace", () => {
    expect(manifestOf('<?xml version="1.0" encoding="utf-8"?><!-- c --><imports><package name="P"/></imports>').getAllPackageNames()).toEqual(["P"]);
    expect(manifestOf('<?xml version="1.0"?><imports xmlns="urn:x"><package name="P"/></imports>').getAllPackageNames()).toEqual([]);
    expect(manifestOf('<Imports><package name="P"/></Imports>').getAllPackageNames()).toEqual([]);
    expect(manifestOf("<other/>").getAllPackageNames()).toEqual([]);
  });

  it("matches element and attribute names exactly", () => {
    expect(() => manifestOf('<imports><PACKAGE name="P"/><package NAME="Q"/></imports>').getAllPackageNames()).toThrow(NullReferenceException);
    expect(manifestOf('<imports><PACKAGE name="P"/></imports>').getAllPackageNames()).toEqual([]);
  });

  it("is implemented for 14.0.7 and 14.35, whose manifest rules are the same, and not yet for 12.0", () => {
    expect(() => new ManifestFile(undefined, { engine: "12.0" })).toThrow(EngineNotSupportedError);
    expect(() => new ManifestFile(undefined, { engine: "14.35" })).not.toThrow();
  });
});

describe("MAN-010 MAN-011 MAN-014: AddPackage replays probes 02 and 06", () => {
  const names = probeSection("02-manifest-edit-save.out", "5 AddPackage / Save").filter((line) => line.startsWith('AddPackage "'));
  for (const row of names) {
    const [name] = quotedStrings(row) as [string];
    it(`adds ${JSON.stringify(name)}`, () => {
      expect(observe(() => outerXml(new ManifestFile().addPackage(name)))).toEqual(resultOf(row));
    });
  }

  const second = probeSection("02-manifest-edit-save.out", "5 AddPackage / Save").filter((line) => line.startsWith('AddPackage2 "'));
  for (const row of second) {
    const [name] = quotedStrings(row) as [string];
    it(`adds ${JSON.stringify(name)} to a manifest that has My.Pkg, and looks it up`, () => {
      const mf = new ManifestFile();
      mf.addPackage("My.Pkg");
      expect(observe(() => outerXml(mf.addPackage(name)))).toEqual(resultOf(row));
      const lookup = probeSection("02-manifest-edit-save.out", "5 AddPackage / Save").find((line) => line.startsWith(`GetPackageNode "${row.split('"')[1]}`));
      expect(observe(() => { const node = mf.getPackageNode(name); return node ? outerXml(node) : "null"; })).toEqual(resultOf(lookup as string));
    });
  }

  const injection = probeSection("06-xpath-and-solution-path.out", "10 XPath failure shapes (AddPackage on a fresh manifest)");
  for (const row of injection) {
    const [name] = quotedStrings(row) as [string];
    it(`evaluates the name ${JSON.stringify(name)} as XPath`, () => {
      const mf = new ManifestFile();
      mf.addPackage("My.Pkg");
      mf.addPackage("Other");
      expect(observe(() => outerXml(mf.addPackage(name)))).toEqual(resultOf(row));
    });
  }

  it("refuses a null name with a null reference", () => {
    expect(() => new ManifestFile().addPackage(null)).toThrow(NullReferenceException);
  });

  it("returns the same node for a name that is there, and is case-sensitive", () => {
    const mf = new ManifestFile();
    const a = mf.addPackage("My.Pkg");
    expect(mf.addPackage("My.Pkg")).toBe(a);
    expect(mf.addPackage("my.pkg")).not.toBe(a);
    expect(mf.getAllPackageNames()).toEqual(["My.Pkg", "my.pkg"]);
  });

  it("appends to the document element whatever its name is", () => {
    const mf = manifestOf("<other/>");
    mf.addPackage("x");
    expect(outerXml(mf.document)).toBe('<other><package name="x" path="x\\Import" /></other>');
  });

  it("gives a name that ends with a dot or is empty the path \\Import (bug MAN-011)", () => {
    expect(new ManifestFile().addPackage("trailing.").getAttribute("path")).toBe("\\Import");
    expect(new ManifestFile().addPackage("").getAttribute("path")).toBe("\\Import");
  });
});

describe("MAN-012 MAN-013: AddDependsOn and AddReferencedElement replay probe 02 section 6", () => {
  const rows = probeSection("02-manifest-edit-save.out", "6 AddDependsOn / AddReferencedElement");
  const items = [
    // the probe script was read in a single-byte code page, so its é arrived as these two characters
    new ExportItem("Part & <\"Doc\"> 'q' \u00C3\u00A9", "ABC", "ItemType"),
    new ExportItem(null, "ID2", null),
    new ExportItem("", "ID3", ""),
    new ExportItem("x", null, "T"),
    new ExportItem("dup", "ABC", "Other"),
    new ExportItem("k\tl\r\nm", "I'D", "T2"),
  ];
  const mf = new ManifestFile();
  const p = mf.addPackage("My.Pkg");

  it("adds dependencies once, refuses blank names, and lets a quote through to XPath", () => {
    const dependsOn = rows.filter((row) => row.startsWith('AddDependsOn "'));
    const names = ["com.aras.innovator.core", "", "   ", "\t", null, 'dep"x', "dep'x", "com.aras.innovator.core", "dep&amp;"];
    expect(dependsOn.length).toBe(names.length);
    names.forEach((name, index) => {
      expect(observe(() => outerXml(mf.addDependsOn(p, name)))).toEqual(resultOf(dependsOn[index] as string));
    });
  });

  it("refuses a null package node", () => {
    expect(() => mf.addDependsOn(null, "x")).toThrow("Value cannot be null.\r\nParameter name: packageNode");
  });

  it("adds an element once per id, writes null as empty, and lets a quote in the id through to XPath", () => {
    const dep = mf.addDependsOn(p, "com.aras.innovator.core");
    const added = rows.filter((row) => row.startsWith("AddReferencedElement id="));
    expect(added.length).toBe(items.length);
    items.forEach((item, index) => {
      expect(observe(() => outerXml(mf.addReferencedElement(dep, item)))).toEqual(resultOf(added[index] as string));
    });
    expect(() => mf.addReferencedElement(dep, null)).toThrow("Value cannot be null.\r\nParameter name: referencedElement");
    expect(() => mf.addReferencedElement(null, new ExportItem("a", "b", "c"))).toThrow("Value cannot be null.\r\nParameter name: dependsOnNode");
  });

  it("saves the document the probe printed", () => {
    const expected = unescapeProbe((rows.find((row) => row.startsWith("saved => ")) as string).slice('saved => "'.length, -1));
    const path = join(work, "probe-full.mf");
    mf.save(path);
    expect(readFileSync(path, "utf8")).toBe(expected);
  });
});

describe("MAN-015 MAN-016: the lookups and GetDependsOnInfo", () => {
  it("replays the key orders of probe 03 section 9", () => {
    const rows = probeSection("03-order-and-lookups.out", "9 GetDependsOnInfo / lookups").filter((row) => row.startsWith("deps("));
    expect(rows.length).toBe(6);
    for (const row of rows) {
      const names = /^deps\((.*?)\) => /.exec(row)?.[1]?.split(",") as string[];
      const keys = /Keys=\[(.*?)\] enum=/.exec(row)?.[1] as string;
      const xml = `<imports><package name="P" path=".\\">${names.map((n) => `<dependson name="${n}"><referenced_element id="id-${n}" type="T" descr="D ${n}"/></dependson>`).join("")}</package></imports>`;
      const table = manifestOf(xml).getDependsOnInfo("P");
      expect([...table.keys()].join(",")).toBe(keys);
      expect(table.count).toBe(names.length);
    }
  });

  it("refuses a duplicate dependson with the Hashtable text, and builds nothing", () => {
    const mf = manifestOf('<imports><package name="P" path=".\\"><dependson name="d"/><dependson name="d"/></package></imports>');
    expect(() => mf.getDependsOnInfo("P")).toThrow(DuplicateKeyError);
    expect(() => mf.getDependsOnInfo("P")).toThrow("Item has already been added. Key in dictionary: 'd'  Key being added: 'd'");
  });

  it("is empty for an unknown or null package, and fails for a quote or a blank dependency", () => {
    const mf = manifestOf('<imports><package name="P"><dependson name=""/></package></imports>');
    expect(mf.getDependsOnInfo("nope").count).toBe(0);
    expect(mf.getDependsOnInfo(null).count).toBe(0);
    expect(() => mf.getDependsOnInfo("a'b")).toThrow(XPathException);
    expect(() => mf.getDependsOnInfo("P")).toThrow(new ArgumentException("Name of 'dependson' package can't be 'null' or empty"));
    expect(() => manifestOf('<imports><package name="P"><dependson/></package></imports>').getDependsOnInfo("P")).toThrow(NullReferenceException);
    expect(() => manifestOf('<imports><package name="P"><dependson name="x&apos;y"/></package></imports>').getDependsOnInfo("P")).toThrow(
      "'dependson[@name='x'y']' has an invalid token.",
    );
  });

  it("takes the elements of the first dependson an injected name matches", () => {
    const mf = manifestOf(
      '<imports><package name="P"><dependson name="a"><referenced_element id="1"/></dependson><dependson name="a&apos; or @name=&apos;a"/><dependson name="b"><referenced_element id="2"/></dependson></package></imports>',
    );
    const table = mf.getDependsOnInfo("P");
    expect([...table.keys()]).toEqual(["b", "a' or @name='a", "a"]);
    expect(table.get("a' or @name='a")?.map((item) => item.idName)).toEqual(["1"]);
  });

  it("keeps a key as written: padding and case make other keys", () => {
    const mf = manifestOf('<imports><package name="P"><dependson name=" a "><referenced_element id="1"/></dependson><dependson name="A"/></package></imports>');
    expect([...mf.getDependsOnInfo("P").keys()]).toEqual(["A", " a "]);
  });

  it("reads elements with missing attributes as empty strings, and keeps duplicates", () => {
    const mf = manifestOf(
      '<imports><package name="P"><dependson name="d"><referenced_element id="1" type="T" descr="x"/><referenced_element id="2"/><referenced_element type="Q"/><referenced_element id="1" type="T2" descr="y"/></dependson></package></imports>',
    );
    const items = mf.getDependsOnInfo("P").get("d") ?? [];
    expect(items.map((item) => [item.keyedName, item.idName, item.typeName])).toEqual([["x", "1", "T"], ["", "2", ""], ["", "", "Q"], ["y", "1", "T2"]]);
  });

  it("looks only at direct children", () => {
    const mf = manifestOf(
      '<imports><package name="P"><x><dependson name="nested"/></x><dependson name="top"><x><referenced_element id="deep"/></x><referenced_element id="top"/></dependson></package></imports>',
    );
    expect([...mf.getDependsOnInfo("P").keys()]).toEqual(["top"]);
    expect(mf.getPackageDependencies("P")).toEqual(["top"]);
    expect(mf.getReferencedElements(mf.getDependsOn(mf.getPackageNode("P"), "top")).map((item) => item.idName)).toEqual(["top"]);
  });

  it("looks packages up in document order, first wins, blank gives null", () => {
    const mf = manifestOf('<imports><package name="P" path="a"/><package name="P" path="b"/><package name="Q"/><other><package name="R"/></other></imports>');
    expect(outerXml(mf.getPackageNode("P") as XmlElement)).toBe('<package name="P" path="a" />');
    expect(mf.getAllPackageNames()).toEqual(["P", "P", "Q"]);
    expect(mf.getPackageNode("R")).toBeNull();
    for (const name of ["  ", null, "p", " P"]) expect(mf.getPackageNode(name)).toBeNull();
  });

  it("returns dependency names with an empty string for a missing or empty name, and throws for it elsewhere", () => {
    const mf = manifestOf('<imports><package name="P"><dependson name=""/><dependson/></package></imports>');
    expect(mf.getPackageDependencies("P")).toEqual(["", ""]);
    expect(mf.getPackageDependencies("nope")).toEqual([]);
    expect(() => mf.getAllDependsOnNames(mf.getPackageNode("P"))).toThrow(NullReferenceException);
  });

  it("refuses null arguments with the parameter names", () => {
    const mf = manifestOf('<imports><package name="P"><dependson name="d"/></package></imports>');
    expect(() => mf.getDependsOn(null, "d")).toThrow(new ArgumentNullException("packageNode"));
    expect(() => mf.getDependsOn(mf.getPackageNode("P"), " ")).toThrow(ArgumentException);
    expect(() => mf.getAllDependsOnNames(null)).toThrow(new ArgumentNullException("packageNode"));
    expect(() => mf.getReferencedElements(null)).toThrow(new ArgumentNullException("dependsOnNode"));
    expect(mf.getDependsOn(mf.getPackageNode("P"), "zz")).toBeNull();
  });
});

/** The packages of the probe's `Build`: `A>B,C;B>C;C` is A depending on B and C, B on C, and C on nothing. */
function build(spec: string): string {
  const packages = spec
    .split(";")
    .filter((part) => part !== "")
    .map((part) => {
      const arrow = part.indexOf(">");
      const name = arrow < 0 ? part : part.slice(0, arrow);
      const deps = arrow < 0 ? [] : part.slice(arrow + 1).split(",");
      return `<package name="${name}" path=".\\">${deps.map((d) => `<dependson name="${d}"/>`).join("")}</package>`;
    });
  return `<imports>${packages.join("")}</imports>`;
}

function databaseOf(names: string[]): XmlDocument {
  return loadXml(`<AML>${names.map((n) => `<Item type="PackageDefinition"><name>${n}</name></Item>`).join("")}</AML>`, { preserveWhitespace: false });
}

describe("MAN-020 to MAN-024: GetPackageNamesInImportOrder replays probe 03 section 8", () => {
  const rows = probeSection("03-order-and-lookups.out", "8 ordering").filter((row) => row.startsWith("spec=["));
  const replayable = rows.filter((row) => {
    const shape = /^spec=\[(.*?)\] import=\[(.*?)\](?: db=\[(.*?)\])? => (.*)$/.exec(row);
    if (!shape) return false;
    const result = shape[4] as string;
    // the PowerShell host refused these arguments before the engine was called, and `[X]` with a warning is a document
    // of another shape (an Item of another type), which has its own test below
    if (result.includes("System.Management.Automation") || result.includes("InvalidCastException")) return false;
    if (shape[3] === "X" && result.includes("warnings=\"")) return false;
    return true;
  });
  it("has the rows", () => expect(replayable.length).toBe(52));

  for (const row of replayable) {
    const shape = /^spec=\[(.*?)\] import=\[(.*?)\](?: db=\[(.*?)\])? => (.*)$/.exec(row) as RegExpExecArray;
    const [, spec, imported, db, result] = shape as unknown as [string, string, string, string | undefined, string];
    it(`${row.split(" => ")[0]}`, () => {
      const mf = manifestOf(build(spec));
      const warnings: string[] = [];
      const names = imported === "" ? [] : imported.split(",");
      const database = db === undefined ? databaseOf([]) : databaseOf(db === "" ? [] : db.split(","));
      const warned = [...result.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => unescapeProbe(match[1] as string));
      let actual: string;
      try {
        actual = `result=[${mf.getPackageNamesInImportOrder(names, database, warnings).join(",")}]`;
      } catch (error) {
        actual = `${(error as Error).name}: ${(error as Error).message}`;
      }
      if (result.startsWith("result=[")) {
        expect(actual).toBe(/^(result=\[.*?\])/.exec(result)?.[1]);
        expect(warnings).toEqual(warned);
      } else {
        const error = /^System\.(?:[\w.]*\.)?(\w+): "((?:[^"\\]|\\.)*)"/.exec(result) as RegExpExecArray;
        expect(actual).toBe(`${error[1]}: ${unescapeProbe(error[2] as string)}`);
        expect(warnings).toEqual([]);
      }
    });
  }

  it("returns a new list and leaves the manifest as it is", () => {
    const mf = manifestOf(build("A>B;B"));
    const before = outerXml(mf.document);
    expect(mf.getPackageNamesInImportOrder(["A", "B"], databaseOf([]), [])).toEqual(["B", "A"]);
    expect(outerXml(mf.document)).toBe(before);
  });

  it("tests the database for an Item of the PackageDefinition type with a name child of that exact text", () => {
    const mf = manifestOf(build("A>X;B>Q"));
    const shapes: [string, string[]][] = [
      ['<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><Result><Item type="PackageDefinition"><name>X</name></Item></Result></SOAP-ENV:Body></SOAP-ENV:Envelope>', [MISSING("Q")]],
      ['<AML><Item type="PackageDefinition"><name> X </name></Item><Item type="PackageDefinition" id="1"><Relationships><Item type="PackageDefinition"><name>Q</name></Item></Relationships></Item></AML>', [MISSING("X")]],
      ['<AML><Item type="Other"><name>X</name></Item></AML>', [MISSING("X"), MISSING("Q")]],
      ["<AML/>", [MISSING("X"), MISSING("Q")]],
    ];
    for (const [xml, expected] of shapes) {
      const warnings: string[] = [];
      mf.getPackageNamesInImportOrder(["A", "B"], loadXml(xml, { preserveWhitespace: false }), warnings);
      expect(warnings).toEqual(expected);
    }
  });

  it("evaluates a dependency named with a quote as XPath against the database", () => {
    const database = loadXml('<AML><Item type="PackageDefinition"><name>X</name></Item></AML>', { preserveWhitespace: false });
    const warnings: string[] = [];
    manifestOf(build("A>q' or name='X")).getPackageNamesInImportOrder(["A"], database, warnings);
    expect(warnings).toEqual([]);
    expect(() => manifestOf(build("A>X'Y")).getPackageNamesInImportOrder(["A"], databaseOf([]), [])).toThrow(
      "'//Item[@type='PackageDefinition' and name='X'Y']' has an invalid token.",
    );
    expect(() => manifestOf(build("A")).getPackageNamesInImportOrder(["A'B"], databaseOf([]), [])).toThrow(
      "'imports/package[@name='A'B']' has an invalid token.",
    );
  });

  it("fails as probe 04 shows for null arguments and a dependson without a name", () => {
    const mf = manifestOf(build("A>X"));
    expect(() => mf.getPackageNamesInImportOrder(null, databaseOf([]), [])).toThrow(NullReferenceException);
    expect(() => mf.getPackageNamesInImportOrder([null], databaseOf([]), [])).toThrow("Key cannot be null.\r\nParameter name: key");
    expect(() => mf.getPackageNamesInImportOrder(["A"], databaseOf([]), null)).toThrow(NullReferenceException);
    expect(() => mf.getPackageNamesInImportOrder(["A"], null, [])).toThrow(NullReferenceException);
    expect(manifestOf(build("A")).getPackageNamesInImportOrder(["A"], null, null)).toEqual(["A"]);
    expect(() => manifestOf('<imports><package name="A" path=".\\"><dependson/></package></imports>').getPackageNamesInImportOrder(["A"], databaseOf([]), [])).toThrow(
      NullReferenceException,
    );
    const empty = manifestOf('<imports><package name="A" path=".\\"><dependson name=""/></package></imports>');
    const warnings: string[] = [];
    expect(empty.getPackageNamesInImportOrder(["A"], databaseOf([]), warnings)).toEqual(["A"]);
    expect(warnings).toEqual([MISSING("")]);
  });

  it("refuses a package named twice before it warns (bug MAN-024)", () => {
    const warnings: string[] = [];
    expect(() => manifestOf(build("A>B;B")).getPackageNamesInImportOrder(["A", "B", "A"], databaseOf([]), warnings)).toThrow(
      "Item has already been added. Key in dictionary: 'A'  Key being added: 'A'",
    );
    expect(warnings).toEqual([]);
  });

  it("warns about each depending package, in the order met", () => {
    const warnings: string[] = [];
    manifestOf(build("A>X;B>X")).getPackageNamesInImportOrder(["B", "A"], databaseOf([]), warnings);
    expect(warnings).toEqual([MISSING("X"), MISSING("X")]);
    const circular: string[] = [];
    manifestOf(build("A>B,C;B>A;C>A")).getPackageNamesInImportOrder(["A", "B", "C"], databaseOf([]), circular);
    expect(circular).toEqual([CIRCULAR("A"), CIRCULAR("A")]);
  });
});

describe("MAN-025: a cycle that avoids the starting package", () => {
  it("is stopped with the engine's own text at a nesting depth of 100,000 (C>A, A>B, B>A)", () => {
    const mf = manifestOf('<imports><package name="A"><dependson name="B"/></package><package name="B"><dependson name="A"/></package><package name="C"><dependson name="A"/></package></imports>');
    const warnings: string[] = [];
    expect(() => mf.getPackageNamesInImportOrder(["C", "A", "B"], loadXml("<AML/>", { preserveWhitespace: false }), warnings)).toThrow(
      new StackOverflowException(),
    );
    expect(new StackOverflowException().message).toBe("Process is terminated due to StackOverflowException.");
    expect(MOVE_TO_ORDERED_LIST_MAX_DEPTH).toBe(100_000);
  });

  it("is stopped for a package that depends on itself while another one is placed (A>B, B>B)", () => {
    const mf = manifestOf('<imports><package name="A"><dependson name="B"/></package><package name="B"><dependson name="B"/></package></imports>');
    expect(() => mf.getPackageNamesInImportOrder(["A", "B"], loadXml("<AML/>", { preserveWhitespace: false }), [])).toThrow(StackOverflowException);
  });

  it("orders a chain of 300 dependencies placed by the search, as the engine does for thousands (probe 07)", () => {
    const names = Array.from({ length: 300 }, (_, index) => `P${index}`);
    const xml = `<imports>${names.map((n, i) => `<package name="${n}">${i < names.length - 1 ? `<dependson name="P${i + 1}"/>` : ""}</package>`).join("")}</imports>`;
    const result = manifestOf(xml).getPackageNamesInImportOrder(names, loadXml("<AML/>", { preserveWhitespace: false }), []);
    expect(result.length).toBe(300);
    expect(result[0]).toBe("P299");
    expect(result[299]).toBe("P0");
  });
});

describe("MAN-032: getSolutionPath replays probe 06 section 11", () => {
  const mf = manifestOf('<imports><package name="My.Pkg" path="Pkg\\Import"/><package name="com.aras.innovator.core" path=".\\"/><package name="NoPath"/><package name="Blank" path="  "/></imports>');
  const rows = probeSection("06-xpath-and-solution-path.out", "11 GetSolutionPath").filter((row) => row.startsWith('GetSolutionPath "'));
  for (const row of rows) {
    const [name] = quotedStrings(row) as [string];
    it(`for ${JSON.stringify(name)}`, () => {
      expect(observe(() => getSolutionPath(name, "C:\\m", mf))).toEqual(resultOf(row));
    });
  }

  it("refuses a null manifest, a null name and a null folder like the engine", () => {
    expect(() => getSolutionPath("x", "C:\\m", null)).toThrow(new ArgumentNullException("manifestFile"));
    expect(() => getSolutionPath(null, "C:\\m", mf)).toThrow("Node for package '' doesn't exist in the manifest file Enable to detemine path to .");
    expect(() => getSolutionPath("com.aras.innovator.core", null, mf)).toThrow(
      "Value cannot be null.\r\nParameter name: path1 Enable to detemine path to com.aras.innovator.core.",
    );
    expect(() => getSolutionPath("Bad", null, mf)).toThrow("Node for package 'Bad' doesn't exist in the manifest file Enable to detemine path to Bad.");
  });

  it("wraps an illegal path, keeping the original as the inner exception of a plain Exception", () => {
    const bad = manifestOf('<imports><package name="Bad" path="a|b"/></imports>');
    let caught: (Error & { innerException?: Error }) | undefined;
    try {
      getSolutionPath("Bad", "C:\\m", bad);
    } catch (error) {
      caught = error as Error;
    }
    expect(caught?.name).toBe("Exception");
    expect(caught?.message).toBe("Illegal characters in path. Enable to detemine path to Bad.");
    expect(caught?.innerException).toBeInstanceOf(ArgumentException);
  });
});
