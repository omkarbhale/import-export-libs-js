import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { CItemException } from "../client/fault.js";
import type { Engine } from "../engines.js";
import { ArgumentNullException, DirectoryNotFoundException, IOException } from "../io/errors.js";
import { ArgumentException, NotSupportedException, XmlException } from "../xml/errors.js";
import { documentElementOf } from "../xml/dom.js";
import type { XmlDocument, XmlElement } from "../xml/dom.js";
import { loadXml } from "../xml/parser.js";
import { outerXml } from "../xml/writer-legacy.js";
import { getItemsFromPackageDom } from "./items.js";
import { loadPackage, loadPackageDom } from "./load-package-dom.js";
import type { LogWriter } from "./load-package-dom.js";
import { directoryGetDirectories, directoryGetXmlFiles } from "./package-files.js";
import { planPackage } from "./plan.js";

/**
 * Replays fixtures/import-load/load-package-dom.out.txt, which the engine's own LoadPackageDom wrote on Windows, against
 * package folders built from load-package-dom.cases.json in a temporary folder. The cases that need Windows (a hidden attribute,
 * a locked file, a UNC path) are not replayed; the rule text carries their result.
 */

const DIR = fileURLToPath(new URL("../../fixtures/import-load/", import.meta.url));

interface LoadCase {
  name: string;
  solutionPath?: string;
  dirs?: string[];
  files: { path: string; text?: string; b64?: string }[];
  relative?: string;
  trailingSlash?: boolean;
  longCreate?: boolean;
  hidden?: string[];
  lock?: string[];
  unc?: boolean;
}

const cases = JSON.parse(readFileSync(DIR + "load-package-dom.cases.json", "utf8")) as LoadCase[];
const recordedSections = (file: string): string[][] =>
  readFileSync(DIR + file, "utf8")
    .split(/\r?\n(?==== )/)
    .map((section) => section.replace(/^=== [^\n]*\n/, "").replace(/\n$/, "").split("\n"));
const outSections = recordedSections("load-package-dom.out.txt");

const WINDOWS_ONLY = new Set(["hidden", "locked", "unc"]);
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function build(testCase: LoadCase): string {
  const root = mkdtempSync(join(tmpdir(), "libsjs-load-"));
  roots.push(root);
  for (const directory of testCase.dirs ?? []) mkdirSync(join(root, directory), { recursive: true });
  for (const file of testCase.files) {
    const path = join(root, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.b64 !== undefined ? Buffer.from(file.b64, "base64") : Buffer.from(file.text ?? "", "utf8"));
  }
  return root;
}

const escapeText = (text: string): string => text.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");

const DOTNET_TYPES: Record<string, string> = {
  CItemException: "Aras.Tools.SolutionUpgrade.CItemException",
  XmlException: "System.Xml.XmlException",
  ArgumentException: "System.ArgumentException",
  DirectoryNotFoundException: "System.IO.DirectoryNotFoundException",
  IOException: "System.IO.IOException",
};

/**
 * Runs a case as lpd.ps1 does and writes what it wrote, with the folder as `<ROOT>` and every path of the case with `\`, as
 * the recording on Windows has them.
 */
function observe(testCase: LoadCase, root: string, solutionPath: string, engine: Engine = "14.0.7"): string[] {
  const lines: string[] = [];
  const log: string[] = [];
  const logWriter: LogWriter = { writeLine: (text) => log.push(`${text}\r\n`) };
  const known = new Set<string>();
  for (const file of testCase.files) {
    const parts = file.path.split("/");
    for (let end = parts.length; end >= 1; end -= 1) known.add(parts.slice(0, end).join("/"));
  }
  for (const directory of testCase.dirs ?? []) known.add(directory);
  if (testCase.solutionPath) known.add(testCase.solutionPath);
  const paths = [...known].sort((a, b) => b.length - a.length);
  const shown = (text: string): string => {
    let result = text;
    for (const path of paths) result = result.split(join(root, path)).join(`<ROOT>\\${path.replace(/\//g, "\\")}`);
    return escapeText(result.split(root).join("<ROOT>"));
  };
  try {
    const doc = loadPackageDom(solutionPath, logWriter, { engine });
    lines.push(`RESULT: ${shown(outerXml(doc))}`);
    lines.push(`ITEMS: ${getItemsFromPackageDom(doc).length}`);
  } catch (error) {
    const caught = error as Error;
    lines.push(`EXC: ${DOTNET_TYPES[caught.name] ?? caught.name} :: ${shown(caught.message)}`);
    if (caught instanceof CItemException) {
      lines.push(`  faultcode=${caught.faultcode} bInnError=${caught.bInnError ? "True" : "False"}`);
      const inner = caught.cause as Error | undefined;
      if (inner) lines.push(`  inner=${DOTNET_TYPES[inner.name] ?? inner.name} :: ${shown(inner.message)}`);
    }
  }
  lines.push(`LOG: ${shown(log.join(""))}`);
  return lines;
}

/** The recorded lines with the stack text of a fault dropped. */
function expected(section: string[]): string[] {
  return section.map((line) => {
    const fault = /^ {2}faultcode=(-?\d+) faultstring=.* bInnError=(True|False)$/.exec(line);
    return fault ? `  faultcode=${fault[1]} bInnError=${fault[2]}` : line;
  });
}

function replayLoads(engine: Engine, sections: string[][]): void {
  describe(`IMP-001 to IMP-012: LoadPackageDom replays the engine's own run (${engine})`, () => {
    it("has a recorded section for every case", () => expect(sections.length).toBe(cases.length));

    cases.forEach((testCase, index) => {
      const label = `${testCase.name} (case ${index + 1})`;
      if (WINDOWS_ONLY.has(testCase.name)) {
        it.skip(`${label}: needs Windows`);
        return;
      }
      it(label, () => {
        const root = build(testCase);
        let solutionPath = testCase.solutionPath === undefined ? root : join(root, testCase.solutionPath);
        if (testCase.relative !== undefined) solutionPath = relative(process.cwd(), join(root, testCase.relative));
        if (testCase.trailingSlash) solutionPath += "/";
        const observed = observe(testCase, root, solutionPath, engine);
        let recorded = expected(sections[index] ?? []);
        if (testCase.name === "decl-second") {
          // the position counts the stamp, so the length of the path: 5, the first file's serialization, and 3 (IMP-010)
          const first = testCase.files[0] as LoadCase["files"][number];
          const doc = loadXml(first.text ?? "", { preserveWhitespace: false });
          const item = (documentElementOf(doc) as XmlElement).firstChild as XmlElement;
          item.setAttribute("tempKeyName", "a");
          item.setAttribute("tempFullName", join(root, first.path));
          const position = 5 + outerXml(doc).length + 3;
          recorded = recorded.map((line) => line.replace("position 158.", `position ${position}.`));
        }
        if (testCase.relative !== undefined) {
          // the paths of the log are relative to the current directory here, as the engine shows a relative path
          expect(observed.filter((line) => !line.startsWith("LOG:"))).toEqual(recorded.filter((line) => !line.startsWith("LOG:")));
          return;
        }
        expect(observed).toEqual(recorded);
      });
    });
  });
}

replayLoads("14.0.7", outSections);
replayLoads("14.35", recordedSections("load-package-dom.out.14.35.txt"));

describe("IMP-002 to IMP-006: the file listing", () => {
  const make = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), "libsjs-list-"));
    roots.push(root);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return root;
  };

  it("lists only the immediate subdirectories, in NTFS order, and the *.xml files of one folder", () => {
    const root = make({ "loose.xml": "", "b/x.XML": "", "b/y.xmlbak": "", "b/z.txt": "", "b/t.xml.bak": "", "B2/q.xm": "", "a/deep/d.xml": "", "a/.xml": "" });
    mkdirSync(join(root, "c.xml"));
    expect(directoryGetDirectories(root).map((path) => path.slice(root.length + 1))).toEqual(["a", "b", "B2", "c.xml"]);
    expect(directoryGetXmlFiles(join(root, "b")).map((path) => path.slice(root.length + 3))).toEqual(["x.XML", "y.xmlbak"]);
    expect(directoryGetXmlFiles(join(root, "a")).map((path) => path.slice(root.length + 3))).toEqual([".xml"]);
    expect(directoryGetXmlFiles(root).map((path) => path.slice(root.length + 1))).toEqual(["loose.xml"]);
  });

  it("does not double a trailing separator", () => {
    const root = make({ "d/a.xml": "" });
    expect(directoryGetDirectories(`${root}/`)).toEqual([`${root}/d`]);
  });

  it("follows a link to a directory and to a file", () => {
    const root = make({ "real/a.xml": "<AML/>", "target.xml": "<AML/>" });
    symlinkSync(join(root, "real"), join(root, "linkdir"));
    symlinkSync(join(root, "target.xml"), join(root, "real", "b.xml"));
    expect(directoryGetDirectories(root).map((path) => path.slice(root.length + 1))).toEqual(["linkdir", "real"]);
    expect(directoryGetXmlFiles(join(root, "real")).map((path) => path.slice(root.length + 6))).toEqual(["a.xml", "b.xml"]);
  });

  it("raises DirectoryNotFoundException for a missing folder and IOException for a file", () => {
    const root = make({ "f.xml": "" });
    expect(() => directoryGetDirectories(join(root, "nope"))).toThrow(DirectoryNotFoundException);
    expect(() => directoryGetDirectories(join(root, "nope"))).toThrow(`Could not find a part of the path '${join(root, "nope")}'.`);
    expect(() => directoryGetDirectories(join(root, "f.xml"))).toThrow(IOException);
    expect(() => directoryGetDirectories(join(root, "f.xml"))).toThrow("The directory name is invalid.\r\n");
  });

  it("removes a leading ? from the folder as the engine's path trim does, also off Windows (IMP-006)", () => {
    const root = make({ "d/a.xml": "" });
    const folder = relative(process.cwd(), root);
    expect(directoryGetDirectories(`??${folder}`)).toEqual([`${folder}/d`]);
  });

  it("removes every leading backslash of a UNC path, which makes it relative (IMP-006)", () => {
    expect(() => directoryGetDirectories("\\\\server\\share\\pkg", { platform: "win32", cwd: "C:\\work" })).toThrow();
    expect(() => directoryGetDirectories("\\\\server\\share\\pkg")).toThrow(/network share/);
  });
});

describe("IMP-008, IMP-009: skipped files and stamps", () => {
  const package_ = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), "libsjs-stamp-"));
    roots.push(root);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return root;
  };

  it("logs one warning per skipped file in file order and keeps reading", () => {
    const root = package_({ "d/a.xml": "<AML><Foo/></AML>", "d/b.xml": "<aml><Item/></aml>", "d/c.xml": "<AML><Item type='List' action='add' id='ok'/></AML>" });
    const log: string[] = [];
    const loaded = loadPackage(root, { writeLine: (text) => log.push(text) });
    expect(log).toEqual([
      `WARNING: File '${join(root, "d", "a.xml")}' doesn't have any items by next xpath : 'AML/Item'. File is skipped.`,
      `WARNING: File '${join(root, "d", "b.xml")}' doesn't have any items by next xpath : 'AML/Item'. File is skipped.`,
    ]);
    expect(loaded.files.map((file) => file.skipped)).toEqual([true, true, false]);
    expect(planPackage(root).skipped.map((file) => file.file)).toEqual([join(root, "d", "a.xml"), join(root, "d", "b.xml")]);
  });

  it("stamps only the first item and keeps the position of an attribute that exists", () => {
    const root = package_({ "d/c.xmlbak": "<AML><Item tempKeyName='old' type='List' tempFullName='oldf' action='add' id='x'/><Item type='List' action='add' id='y'/></AML>" });
    const items = getItemsFromPackageDom(loadPackageDom(root, { writeLine: () => undefined })).map((doc) => outerXml(doc));
    expect(items).toEqual([
      `<Item tempKeyName="c" type="List" tempFullName="${join(root, "d", "c.xmlbak")}" action="add" id="x" />`,
      '<Item type="List" action="add" id="y" />',
    ]);
  });

  it("takes the stamp from the file name up to its last dot", () => {
    const root = package_({ "d/a.b.xml": "<AML><Item type='List' action='add' id='1'/></AML>", "d/.xml": "<AML><Item type='List' action='add' id='2'/></AML>" });
    const plan = planPackage(root);
    expect(plan.sequence.map((entry) => entry.source.tempKeyName)).toEqual(["", "a.b"]);
  });
});

describe("IMP-011: failures", () => {
  const folder = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), "libsjs-fail-"));
    roots.push(root);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return root;
  };
  const failure = (run: () => unknown): Error => {
    try {
      run();
    } catch (error) {
      return error as Error;
    }
    throw new Error("did not fail");
  };
  const quiet: LogWriter = { writeLine: () => undefined };

  it("names the package folder when it cannot be listed", () => {
    const root = folder({});
    const error = failure(() => loadPackageDom(join(root, "nope"), quiet)) as CItemException;
    expect(error).toBeInstanceOf(CItemException);
    expect(error.faultcode).toBe(-1);
    expect(error.bInnError).toBe(true);
    expect(error.message).toBe(`Could not find a part of the path '${join(root, "nope")}'. Unable to get solutions files by path in .mf file ${join(root, "nope")}`);
    expect(error.faultdetail).toBe(error.message);
    expect(error.cause).toBeInstanceOf(DirectoryNotFoundException);
  });

  it("lets a malformed file's XmlException through, naming no file", () => {
    const root = folder({ "d/a.xml": "<AML><Item></AML>" });
    const error = failure(() => loadPackageDom(root, quiet));
    expect(error).toBeInstanceOf(XmlException);
    expect(error.message).toBe("The 'Item' start tag on line 1 position 7 does not match the end tag of 'AML'. Line 1, position 14.");
  });

  it("wraps the failure of the joined string with the build.xsl suffix", () => {
    const root = folder({ "d/a.xml": '<?xml version="1.0"?><AML><Item type="List"/></AML>' });
    const error = failure(() => loadPackageDom(root, quiet)) as CItemException;
    expect(error).toBeInstanceOf(CItemException);
    expect(error.message).toBe(
      "Unexpected XML declaration. The XML declaration must be the first node in the document, and no white space characters are allowed to appear before it. Line 1, position 8. Unable to apply build.xsl.",
    );
    expect(error.cause).toBeInstanceOf(XmlException);
  });

  it("reports a character reference the output writer refuses as the engine's ApplyXsl error", () => {
    const root = folder({ "d/a.xml": "<AML><Item type='List' action='add' id='x'><name>a&#1;b</name></Item></AML>" });
    const error = failure(() => loadPackageDom(root, quiet)) as CItemException;
    expect(error.message).toBe("'\u0001', hexadecimal value 0x01, is an invalid character. Error of  applying export.xsl.");
    expect(error.cause).toBeInstanceOf(ArgumentException);
  });

  it("fails a DOCTYPE with a declaration inside as the port's NotSupportedException, not the engine's XmlException (IMP-016)", () => {
    const root = folder({ "d/a.xml": '<!DOCTYPE AML [<!ENTITY e "x">]><AML><Item type="List" action="add" id="x"/></AML>' });
    const error = failure(() => loadPackageDom(root, quiet));
    expect(error).toBeInstanceOf(NotSupportedException);
    expect(error.message).toMatch(/IMP-016/);
  });

  it("refuses an engine whose stylesheet is not built, after reading the files", () => {
    const root = folder({ "d/a.xml": "<AML><Item type='List' action='add' id='x'/></AML>" });
    expect(failure(() => loadPackageDom(root, quiet, { engine: "12.0" }))).toBeInstanceOf(NotSupportedException);
  });
});

describe("IMP-015: GetItemsFromPackageDom", () => {
  it("throws for a null document, naming the parameter", () => {
    expect(() => getItemsFromPackageDom(null)).toThrow(ArgumentNullException);
    expect(() => getItemsFromPackageDom(null)).toThrow("Value cannot be null.\r\nParameter name: packageDom");
  });

  it("gives an independent document per item, once per copy, and none for an empty AML", () => {
    const root = mkdtempSync(join(tmpdir(), "libsjs-items-"));
    roots.push(root);
    mkdirSync(join(root, "d"));
    writeFileSync(
      join(root, "d", "a.xml"),
      "<AML><Item type='ItemType' action='add' id='A'/><Item type='ItemType' action='add' id='B'/><Item type='ItemType' action='edit' id='E'/></AML>",
    );
    const dom = loadPackageDom(root, { writeLine: () => undefined });
    const items = getItemsFromPackageDom(dom);
    const idOf = (doc: XmlDocument | undefined): string | null => (doc ? (documentElementOf(doc) as XmlElement).getAttribute("id") : null);
    expect(items.map(idOf)).toEqual(["A", "E", "B", "E"]);
    ((documentElementOf(items[1] as XmlDocument)) as XmlElement).setAttribute("id", "changed");
    expect(idOf(items[3])).toBe("E");

    const empty = mkdtempSync(join(tmpdir(), "libsjs-items-"));
    roots.push(empty);
    expect(getItemsFromPackageDom(loadPackageDom(empty, { writeLine: () => undefined }))).toEqual([]);
  });
});

describe("IMP-033: the plan", () => {
  it("reports the sequence with sources, the repeats, and the dropped items", () => {
    const root = mkdtempSync(join(tmpdir(), "libsjs-plan-"));
    roots.push(root);
    mkdirSync(join(root, "ItemType"));
    mkdirSync(join(root, "List"));
    writeFileSync(
      join(root, "ItemType", "a.xml"),
      "<AML><Item type='ItemType' action='add' id='A'/><Item type='ItemType' action='edit' id='E'/><Item type='ItemType' action='delete' id='D'/></AML>",
    );
    writeFileSync(join(root, "List", "b.xml"), "<AML><Item type='List' action='add' id='L'/><Item type='List' action='delete' id='LD'/></AML>");
    const plan = planPackage(root);
    expect(plan.engine).toBe("14.0.7");
    expect(plan.sequence).toEqual([
      { position: 1, type: "List", action: "add", id: "L", group: "G01", source: { file: join(root, "List", "b.xml"), itemIndex: 1, tempKeyName: "b" } },
      { position: 2, type: "ItemType", action: "add", id: "A", group: "G32", source: { file: join(root, "ItemType", "a.xml"), itemIndex: 1, tempKeyName: "a" } },
      { position: 3, type: "ItemType", action: "edit", id: "E", group: "copy of 2", source: { file: join(root, "ItemType", "a.xml"), itemIndex: 2, tempKeyName: null } },
      { position: 4, type: "ItemType", action: "delete", id: "D", group: "copy of 2", source: { file: join(root, "ItemType", "a.xml"), itemIndex: 3, tempKeyName: null } },
    ]);
    expect(plan.repeats.map((repeat) => [repeat.carriedBy.position, repeat.position, repeat.id])).toEqual([
      [2, 3, "E"],
      [2, 4, "D"],
    ]);
    expect(plan.dropped).toEqual([
      {
        type: "List",
        action: "delete",
        id: "LD",
        reason: "action not selected for this type",
        source: { file: join(root, "List", "b.xml"), itemIndex: 2, tempKeyName: null },
      },
    ]);
    expect(plan.warnings).toEqual([]);
    expect(resolve(plan.packageFolder)).toBe(resolve(root));
  });

  it("lists the copies nested in an emitted item", () => {
    const root = mkdtempSync(join(tmpdir(), "libsjs-plan-"));
    roots.push(root);
    mkdirSync(join(root, "d"));
    writeFileSync(
      join(root, "d", "a.xml"),
      "<AML><Item type='ItemType' action='add' id='A'><Relationships><Item type='ItemType' action='add' id='n'/><Item type='ItemType' action='edit' id='ne'/></Relationships></Item></AML>",
    );
    const plan = planPackage(root);
    expect(plan.repeats).toEqual([{ carriedBy: { type: "ItemType", action: "add", id: "n" }, insideEntry: 1, type: "ItemType", action: "edit", id: "ne" }]);
  });
});
