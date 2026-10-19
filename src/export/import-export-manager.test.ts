import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { StubConnection, stubFault, stubResult } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import { ArgumentNullException, IOException, NullReferenceException } from "../io/errors.js";
import { NetfxHashtable } from "../manifest/index.js";
import { XmlException } from "../xml/errors.js";
import { SUExportContext } from "./export-context.js";
import { ExportItem } from "./export-item.js";
import { ImportExportManager, type SelectionInsertions } from "./import-export-manager.js";
import { type SentMessage, createMessagesFactory } from "./messages.js";
import { packageItem } from "./package-item.js";
import { RemovedReference } from "./removed-reference.js";

vi.mock("./package-item.js", async (original) => ({
  ...(await original<typeof import("./package-item.js")>()),
  packageItem: vi.fn(),
}));

/**
 * `ExportSolutions` with the export of one item stubbed out (that is `export-*.md`'s and replayed in run-replay.test.ts): the
 * package lookups are answered by a scripted connection, and what is checked is what the run does around the items (EXP-500 to
 * EXP-520).
 */
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const CLOCK = new Date(2026, 9, 19, 1, 2, 3);
const STAMP = "10/19/2026 01:02:03";
const ITEM_LOG = (id: string, keyedName: string): string => `Item id :${id}  keyed_name : ${keyedName}   type : List successfully exported`;

const HEADER = (working: string, log: string, extra: { referenced?: boolean; mode?: string } = {}): string =>
  [
    "Tool version: 14.0.7.35492",
    "Action: Export",
    "Manifest file: ",
    `Log file: ${log}`,
    `Working directory: ${working}`,
    "URL: http://stub/",
    "Database: db",
    "User: u",
    "Innovator version: 14.0.7.1",
    "Language pack: ",
    "Language pack name: ",
    `Export referenced items: ${extra.referenced ? "True" : "False"}`,
    `Export unknown packages action: ${extra.mode ?? "DoNotRemove"}`,
    "Export level: 1",
    "Export using import structure: False",
    "",
    "",
  ].join("\r\n");

/** The answer to the list of package definitions: each package with its dependencies. */
function definitions(packages: Record<string, string[]>): string {
  const items = Object.entries(packages).map(
    ([name, dependencies]) =>
      `<Item type="PackageDefinition" id="D-${name}"><name>${name}</name><Relationships>` +
      dependencies.map((dependency) => `<Item type="PackageDependsOn"><name>${dependency}</name></Item>`).join("") +
      "</Relationships></Item>",
  );
  return stubResult(items.join(""));
}

interface Script {
  /** The answer to the list of definitions: a document, `null` for faultcode 0, or a fault `[code, text]`. */
  list?: string | null | [string, string];
  /** The packages that have a current definition. */
  known?: string[];
  /** The referenced elements of a dependency: `[id, type, description]`. */
  referenced?: Record<string, Array<[string, string, string]>>;
}

interface Run {
  working: string;
  logPath: string;
  sent: SentMessage[];
  context: SUExportContext;
  helper: CItemHelper;
  connection: StubConnection;
  manager: ImportExportManager;
  exported: Array<{ id: string; folder: string | null; packageName: string; excluded: boolean }>;
  log: () => string;
  manifest: () => string | undefined;
}

function start(script: Script = {}, tune: (context: SUExportContext) => void = () => undefined, answer: "continue" | "abort-package" = "continue"): Run {
  const working = mkdtempSync(join(tmpdir(), "libsjs-manager-"));
  roots.push(working);
  const output = join(working, "out");
  mkdirSync(output);
  const logPath = join(working, "engine.log");
  const context = new SUExportContext();
  Object.assign(context, { url: "http://stub/", dataBase: "db", userName: "u", workingDirectory: output, logFilePath: logPath, level: "1", refToUnknownPacks: "DoNotRemove" });
  tune(context);
  const known = script.known ?? [];
  const connection = new StubConnection((request) => {
    if (request.startsWith("<Item type=\"PackageDefinition\" select=\"name,generation\"")) {
      const list = script.list === undefined ? definitions({}) : script.list;
      if (list === null) return stubFault("0", "No items of type PackageDefinition found.");
      return Array.isArray(list) ? stubFault(list[0], list[1]) : list;
    }
    const definition = /^<Item type="PackageDefinition" select="id,name,generation" action="get"><name>([\s\S]*)<\/name>/.exec(request);
    if (definition) {
      return known.includes(definition[1] as string)
        ? stubResult(`<Item type="PackageDefinition"><id>D-${definition[1]}</id></Item>`)
        : stubFault("0", "No items of type PackageDefinition found.");
    }
    const dependency = /^<Item type="PackageDependsOn" levels="1"[^>]*><name>([\s\S]*)<\/name>/.exec(request);
    if (dependency) {
      const elements = script.referenced?.[dependency[1] as string] ?? [];
      return elements.length === 0
        ? stubFault("0", "No items of type PackageDependsOn found.")
        : stubResult(
            `<Item type="PackageDependsOn"><Relationships>` +
              elements
                .map(([id, type, text]) => `<Item type="PackageReferencedElement"><element_id>${id}</element_id><element_type>${type}</element_type><element_description>${text}</element_description></Item>`)
                .join("") +
              "</Relationships></Item>",
          );
    }
    return undefined;
  });
  const helper = new CItemHelper(connection);
  helper.innovatorVersion = new ArasVersion(14, 0, 0, 1, 7);
  const sent: SentMessage[] = [];
  const manager = new ImportExportManager(context, createMessagesFactory({ onMessage: (message) => void sent.push(message), onItemError: answer }), helper, {
    cwd: working,
    now: () => CLOCK,
  });
  const exported: Run["exported"] = [];
  vi.mocked(packageItem).mockImplementation(async (h, item, packageName, _level, excluded) => {
    exported.push({ id: item.idName ?? "", folder: h.folder, packageName, excluded: excluded !== null });
    if ((item.idName ?? "").startsWith("BAD")) throw new CItemException(1, "boom", "it broke");
    if ((item.idName ?? "").startsWith("IO")) throw new IOException("the disk is full");
    return "";
  });
  return {
    working: output,
    logPath,
    sent,
    context,
    helper,
    connection,
    manager,
    exported,
    log: () => readFileSync(logPath, "utf8"),
    manifest: () => (existsSync(join(output, "imports.mf")) ? readFileSync(join(output, "imports.mf"), "utf8") : undefined),
  };
}

const item = (id: string, keyedName = `k-${id}`): ExportItem => new ExportItem(keyedName, id, "List");
const one = (packageName: string, ...ids: string[]): SelectionInsertions[number] => [packageName, ids.map((id) => [id, item(id)] as const)];
const text = (run: Run, ...channels: string[]): string[] => run.sent.filter((m) => channels.length === 0 || channels.includes(m.channel)).map((m) => `${m.channel}|${m.text}`);

beforeEach(() => {
  vi.mocked(packageItem).mockReset();
});

describe("the manager's constructor (EXP-502)", () => {
  it("checks the helper first and then the context, and does not check the factory", () => {
    const helper = new CItemHelper(new StubConnection(() => undefined));
    const factory = createMessagesFactory();
    expect(() => new ImportExportManager(null, factory, null)).toThrow(ArgumentNullException);
    expect(() => new ImportExportManager(null, factory, null)).toThrow(/itemHelper/);
    expect(() => new ImportExportManager(null, factory, helper)).toThrow(/context/);
    expect(() => new ImportExportManager(new SUExportContext(), undefined as never, helper)).not.toThrow();
  });

  it("applies the context's timeout to the helper's connection (WIRE-031)", () => {
    const helper = new CItemHelper(new StubConnection(() => undefined));
    const applyTimeout = vi.spyOn(helper, "applyTimeout");
    const context = new SUExportContext();
    context.timeout = 30000;
    new ImportExportManager(context, createMessagesFactory(), helper);
    expect(applyTimeout).toHaveBeenCalledWith(30000);
  });

  it("loads the manifest the context names when the file exists, and a file that is not XML fails the constructor", () => {
    const run = start();
    const manifest = join(run.working, "given.mf");
    writeFileSync(manifest, '<imports><package name="p" path=".\\" /></imports>');
    const context = new SUExportContext();
    context.manifestFile = manifest;
    const manager = new ImportExportManager(context, createMessagesFactory(), run.helper, { cwd: run.working });
    expect(manager.manifestFile?.getAllPackageNames()).toEqual(["p"]);
    expect(new ImportExportManager(new SUExportContext(), createMessagesFactory(), run.helper).manifestFile).toBeNull();

    writeFileSync(manifest, "not xml");
    expect(() => new ImportExportManager(context, createMessagesFactory(), run.helper, { cwd: run.working })).toThrow(XmlException);
    context.manifestFile = join(run.working, "absent.mf");
    expect(new ImportExportManager(context, createMessagesFactory(), run.helper, { cwd: run.working }).manifestFile).toBeNull();
  });
});

describe("what happens before the run (EXP-500, EXP-506)", () => {
  it("throws for a null context, then for a null table, before the log is opened", async () => {
    const run = start();
    await expect(run.manager.exportSolutions(null, [])).rejects.toThrow(/exportContext/);
    await expect(run.manager.exportSolutions(run.context, null)).rejects.toThrow(/selItemsTable/);
    expect(existsSync(run.logPath)).toBe(false);
  });

  it("fails with a null reference when the helper never logged in: the log is created and empty, and nothing else happens", async () => {
    const run = start();
    run.helper.innovatorVersion = undefined;
    await expect(run.manager.exportSolutions(run.context, [one("pkg.a", "A1")])).rejects.toBeInstanceOf(NullReferenceException);
    expect(run.log()).toBe("");
    expect(run.sent).toEqual([]);
    expect(run.manifest()).toBeUndefined();
    expect(run.connection.requests).toEqual([]);
  });

  it("writes the header block and one empty line, and appends to a log that exists", async () => {
    const run = start({ list: definitions({}) });
    writeFileSync(run.logPath, "earlier run\r\n");
    await run.manager.exportSolutions(run.context, []);
    expect(run.log()).toBe(`earlier run\r\n${HEADER(run.working, run.logPath)}`);
    expect(readFileSync(run.logPath).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
  });

  it("fails on a log in a folder that does not exist, and on an empty path", async () => {
    const run = start();
    run.context.logFilePath = join(run.working, "missing", "engine.log");
    await expect(run.manager.exportSolutions(run.context, [])).rejects.toThrow(/Could not find a part of the path/);
    run.context.logFilePath = "";
    await expect(run.manager.exportSolutions(run.context, [])).rejects.toThrow(/Empty path name is not legal/);
  });
});

describe("the package definitions (EXP-507, EXP-541)", () => {
  it("sends the request with its whitespace", async () => {
    const run = start();
    await run.manager.exportSolutions(run.context, []);
    expect(run.connection.requests[0]).toBe(
      '<Item type="PackageDefinition" select="name,generation" action="get">\r\n' +
        `${" ".repeat(14)}<is_current>1</is_current>\r\n${" ".repeat(14)}<Relationships>\r\n${" ".repeat(16)}<Item type="PackageGroup" select="name">\r\n` +
        `${" ".repeat(18)}<Relationships>\r\n${" ".repeat(20)}<Item type="PackageElement" select="name,element_id,element_type" />\r\n` +
        `${" ".repeat(18)}</Relationships>\r\n${" ".repeat(16)}</Item>\r\n${" ".repeat(16)}<Item type="PackageDependsOn" select="name" />\r\n` +
        `${" ".repeat(14)}</Relationships>\r\n${" ".repeat(12)}</Item>`,
    );
  });

  it("warns when the database holds no definitions, and an empty selection still ends with the empty package message and an empty manifest", async () => {
    const run = start({ list: null });
    await run.manager.exportSolutions(run.context, []);
    expect(text(run)).toEqual([
      "warning|The database contains no package definitions. Please select another database and try again",
      "currentPackage|",
    ]);
    expect(run.manifest()).toBe("<imports />");
  });

  it("goes on without definitions and fails at the first package with items: a null reference, reported and logged, manifest saved", async () => {
    const run = start({ list: null, known: ["pkg.a"] });
    await run.manager.exportSolutions(run.context, [one("pkg.a", "A1")]);
    const failure = "          ****ErrorMessage****\r\n       Object reference not set to an instance of an object.";
    expect(text(run)).toEqual([
      "warning|The database contains no package definitions. Please select another database and try again",
      `warning|${failure}`,
    ]);
    expect(run.log()).toBe(`${HEADER(run.working, run.logPath)}${failure}\r\n`);
    expect(run.manifest()).toBe('<imports>\r\n  <package name="pkg.a" path="a\\Import" />\r\n</imports>');
    expect(run.exported).toEqual([]);
  });

  it("sends the error of any other fault, and the second log writer it opens fails while the export holds the log (EXP-541)", async () => {
    const run = start({ list: ["1", "boom"] });
    await expect(run.manager.exportSolutions(run.context, [one("pkg.a", "A1")])).rejects.toThrow(
      /^The process cannot access the file '.*engine\.log' because it is being used by another process\.$/,
    );
    expect(run.sent.map((m) => m.channel)).toEqual(["error"]);
    expect(run.sent[0]?.text).toMatch(/^ {6}\*{6}Error message\*{6}\r\nfaultstring: Server error\r\n\r\nRequest: <Item type='PackageDefinition'/);
    expect(run.sent[0]?.text).toMatch(/faultdetail: boomUnable to get packages meta\.\r\nServer error\r\n\r\nRequest: [\s\S]*\r\nfaultcode: {3}1\r\n {5}\*{22}$/);
    expect(run.log()).toBe(HEADER(run.working, run.logPath));
    expect(run.manifest()).toBeUndefined();
  });

  it("writes the error to the log when called on its own, and returns null", async () => {
    const run = start({ list: ["1", "boom"] });
    await expect(run.manager.getSolutions2Xml()).resolves.toBeNull();
    expect(run.log()).toBe(`${run.sent[0]?.text}\r\n`);
    expect(run.sent.map((m) => m.channel)).toEqual(["error"]);
  });

  it("does not catch what is not a CItemException", async () => {
    const run = start({ list: "<not-a-response" });
    await expect(run.manager.getSolutions2Xml()).rejects.toThrow();
  });
});

describe("the package loop (EXP-508 to EXP-514)", () => {
  it("skips a package with no items, exports the others in table order, and logs each item and package", async () => {
    const run = start({ list: definitions({ "pkg.a": [], "other.b": [] }), known: ["pkg.a", "other.b"] });
    await run.manager.exportSolutions(run.context, [one("pkg.a", "A1", "A2"), ["empty.pkg", []], one("other.b", "B1")]);
    // the table order of the two packages is the engine's Hashtable order (MAN-030), here other.b first
    const order = run.exported.map((entry) => entry.packageName);
    expect(order).toHaveLength(3);
    expect(new Set(order)).toEqual(new Set(["pkg.a", "other.b"]));
    expect(text(run)).toContain("currentPackage|Exporting package pkg.a");
    expect(text(run).filter((line) => /^status\|Item \d of 2: List - k-A\d$/.test(line))).toHaveLength(2);
    expect(text(run).at(-1)).toBe("currentPackage|");
    expect(run.exported.every((entry) => entry.excluded === false)).toBe(true);
    expect(run.manifest()).toContain('<package name="pkg.a" path="a\\Import" />');
    expect(run.manifest()).not.toContain("empty.pkg");
    expect(run.log()).toContain(`         ****Export pkg.a****\r\nstart of execution : ${STAMP}\r\n`);
    expect(run.log()).toContain(`${ITEM_LOG("B1", "k-B1")}\r\nend of execution : ${STAMP}\r\n`);
    expect(run.exported.find((e) => e.packageName === "pkg.a")?.folder).toBe(`${run.working}\\a\\Import`);
  });

  it("fails the run with the lookup's exception when a package has no current definition, and still saves the manifest (EXP-542)", async () => {
    const run = start({ known: ["pkg.a"] });
    await expect(run.manager.exportSolutions(run.context, [one("pkg.a", "A1"), one("gone.pkg", "G1")])).rejects.toBeInstanceOf(CItemException);
    expect(run.manifest()).toMatch(/<package name="gone.pkg" path="pkg\\Import" \/>/);
    expect(text(run).at(-1)).not.toBe("currentPackage|");
  });

  it("collects the referenced elements of the dependencies into the manifest, and only exports them when asked (EXP-510 to EXP-512)", async () => {
    const script: Script = {
      list: definitions({ "pkg.a": ["dep.x", "dep.y", "dep.x", ""] }),
      known: ["pkg.a"],
      referenced: { "dep.x": [["R1", "List", "ref one"], ["R2", "Method", ""]] },
    };
    const off = start(script);
    await off.manager.exportSolutions(off.context, [one("pkg.a", "A1")]);
    expect(off.manifest()).toBe(
      '<imports>\r\n  <package name="pkg.a" path="a\\Import">\r\n    <dependson name="dep.x">\r\n' +
        '      <referenced_element id="R1" type="List" descr="ref one" />\r\n      <referenced_element id="R2" type="Method" descr="" />\r\n' +
        '    </dependson>\r\n    <dependson name="dep.y" />\r\n  </package>\r\n</imports>',
    );
    expect(off.exported.map((entry) => entry.packageName)).toEqual(["pkg.a"]);
    // dep.x is asked twice, because it is named twice
    expect(off.connection.requests.filter((request) => request.includes("<name>dep.x</name><source_id>D-pkg.a</source_id>"))).toHaveLength(2);

    const on = start(script, (context) => {
      context.exportReferencedItems = true;
    });
    await on.manager.exportSolutions(on.context, [one("pkg.a", "A1")]);
    expect(on.manifest()).toBe(off.manifest());
    expect(on.exported.map((entry) => entry.packageName)).toEqual(["pkg.a", "dep.x", "dep.x"]);
    expect(on.exported.map((entry) => entry.id).sort()).toEqual(["A1", "R1", "R2"]);
    expect(text(on, "currentPackage")).toEqual([
      "currentPackage|Exporting package pkg.a",
      "currentPackage|Exporting referenced items from 'dep.x'",
      "currentPackage|",
    ]);
    expect(on.log()).toContain(`         ****Export dep.x****\r\nstart of execution : ${STAMP}\r\n`);
    expect(on.manifest()).not.toContain('<package name="dep.x"');
    expect(on.exported[1]?.folder).toBe(`${on.working}\\x\\Import`);
    expect(on.helper.folder).toBe(`${on.working}\\x\\Import`);
  });

  it("keeps the first element of an id when two dependencies' elements collide, and numbers the second pass by its own table (EXP-512)", () => {
    const run = start();
    const refs = new NetfxHashtable<NetfxHashtable<ExportItem>>("refs");
    run.manager.addToRefsForExport(refs, "dep.x", item("R1", "first"));
    run.manager.addToRefsForExport(refs, "dep.x", item("R1", "second"));
    run.manager.addToRefsForExport(refs, "dep.y", item("R1", "third"));
    expect([...refs.keys()].sort()).toEqual(["dep.x", "dep.y"]);
    expect(refs.get("dep.x")?.count).toBe(1);
    expect(refs.get("dep.x")?.get("R1")?.keyedName).toBe("first");
    expect(refs.get("dep.y")?.get("R1")?.keyedName).toBe("third");
  });

  it("fails a dependency that is only white space, a referenced element without an id, and a package name with an apostrophe (EXP-510, EXP-544)", async () => {
    const white = start({ list: definitions({ "pkg.a": [" "] }), known: ["pkg.a"] });
    await white.manager.exportSolutions(white.context, [one("pkg.a", "A1")]);
    expect(text(white, "warning")).toEqual(["warning|          ****ErrorMessage****\r\n       Name of 'dependson' package can't be 'null' or empty"]);
    expect(white.manifest()).toBe('<imports>\r\n  <package name="pkg.a" path="a\\Import" />\r\n</imports>');

    const noId = start({ list: definitions({ "pkg.a": ["dep.x"] }), known: ["pkg.a"], referenced: { "dep.x": [[" ", "List", "x"]] } });
    await expect(noId.manager.exportSolutions(noId.context, [one("pkg.a", "A1")])).rejects.toThrow(/Referenced element doesn't have 'element_id' set/);
    expect(noId.manifest()).toBe('<imports>\r\n  <package name="pkg.a" path="a\\Import">\r\n    <dependson name="dep.x" />\r\n  </package>\r\n</imports>');

    const quote = start({ known: ["O'B"] });
    await quote.manager.exportSolutions(quote.context, [one("O'B", "A1")]);
    const message = "          ****ErrorMessage****\r\n       'imports/package[@name='O'B']' has an invalid token.";
    expect(text(quote, "warning")).toEqual([`warning|${message}`]);
    expect(quote.log()).toBe(`${HEADER(quote.working, quote.logPath)}${message}\r\n`);
    expect(quote.manifest()).toBe("<imports />");
    expect(quote.connection.requests.filter((request) => request.includes("select=\"id,name,generation\""))).toEqual([]);
  });
});

describe("the items of a package (EXP-514 to EXP-517)", () => {
  it("asks whether to abort after a failed item: continue goes on to the next item, abort-package ends the package only", async () => {
    const selection: SelectionInsertions = [one("pkg.a", "A1", "BAD1", "A3"), one("pkg.b", "B1")];
    const script: Script = { list: definitions({ "pkg.a": [], "pkg.b": [] }), known: ["pkg.a", "pkg.b"] };
    const goOn = start(script);
    await goOn.manager.exportSolutions(goOn.context, selection);
    expect(goOn.exported.map((entry) => entry.id).sort()).toEqual(["A1", "A3", "B1", "BAD1"]);
    const failure = text(goOn, "status", "errorQuestion").filter((line) => line.startsWith("status|Error") || line.startsWith("errorQuestion"));
    expect(failure[0]).toBe("status|Error of exporting Item id :BAD1  keyed_name : k-BAD1    type : List");
    expect(failure[1]).toBe(
      "errorQuestion|          ****ErrorMessage****\r\nfaultstring: boom\r\nfaultdetail :it broke\r\nfaultcode: 1\r\n          *******************\r\n\r\n  Abort current export of pkg.a ?",
    );
    expect(goOn.log()).toContain(
      `Error of exporting Item id :BAD1  keyed_name : k-BAD1    type : List\r\n      ******Error message******\r\nfaultstring: boom\r\nfaultdetail: it broke\r\nfaultcode:   1\r\n     **********************\r\n`,
    );

    const abort = start(script, undefined, "abort-package");
    await abort.manager.exportSolutions(abort.context, selection);
    const ids = abort.exported.map((entry) => entry.id);
    expect(ids).toContain("BAD1");
    expect(ids).toContain("B1");
    expect(ids.length).toBeLessThan(4);
    const statuses = text(abort, "status");
    expect(statuses.filter((line) => line === "status|completed")).toHaveLength(2);
    expect(abort.log()).toContain(`faultcode:   1\r\n     **********************\r\nend of execution : ${STAMP}\r\n`);
  });

  it("ends the whole run on an exception that is not a CItemException: the warning, no completion, the manifest saved (EXP-520)", async () => {
    const run = start({ known: ["pkg.a"] });
    await run.manager.exportSolutions(run.context, [one("pkg.a", "A1", "IO2", "A3")]);
    const failure = "          ****ErrorMessage****\r\n       the disk is full";
    const last = text(run).slice(-2);
    expect(last[1]).toBe(`warning|${failure}`);
    expect(text(run)).not.toContain("status|completed");
    expect(text(run)).not.toContain("currentPackage|");
    expect(run.log().endsWith(`${failure}\r\n`)).toBe(true);
    expect(run.manifest()).toContain('<package name="pkg.a"');
    expect(run.exported.map((entry) => entry.id)).toContain("IO2");
  });

  it("writes the removed references and warns only in RemoveWithWarning, and hands each item the table (EXP-613, EXP-614)", async () => {
    const selection: SelectionInsertions = [one("pkg.a", "A1")];
    for (const mode of ["RemoveSilently", "RemoveWithWarning"] as const) {
      const run = start({ known: ["pkg.a"] }, (context) => {
        context.refToUnknownPacks = mode;
      });
      vi.mocked(packageItem).mockImplementation(async (_h, _exportItem, packageName, _level, excluded) => {
        expect(excluded).not.toBeNull();
        excluded?.set(`${packageName}-1`, new RemovedReference("[a].[ItemType].X", "[b].[Method].Y", "item"));
        return "";
      });
      await run.manager.exportSolutions(run.context, selection);
      expect(run.log()).toContain(
        "\n --- REMOVED REFERENCE ---\r\nFrom:\t[a].[ItemType].X\r\nTo:\t[b].[Method].Y\r\n" +
          "Reason:\tThe item contains a reference to an item that belongs to an unknown package " +
          `(i.e. neither a core package nor a package that the package depends on)\r\nend of execution : ${STAMP}\r\n`,
      );
      expect(text(run, "warning")).toEqual(
        mode === "RemoveWithWarning"
          ? ["warning|There are references to unknown packages that were removed during the export of the package 'pkg.a'.\nSee log file for more details (search for words 'REMOVED REFERENCE')"]
          : [],
      );
    }
  });
});

describe("cancel (EXP-518, EXP-543)", () => {
  it("has no effect before the run starts", async () => {
    const run = start({ known: ["pkg.a"] });
    run.manager.cancel();
    await run.manager.exportSolutions(run.context, [one("pkg.a", "A1")]);
    expect(run.exported.map((entry) => entry.id)).toEqual(["A1"]);
  });

  it("stops at the next item, writes the cancel text and end of execution, sends no completion, and still ends normally", async () => {
    const run = start({ known: ["pkg.a", "pkg.b"], list: definitions({ "pkg.a": [], "pkg.b": [] }) });
    vi.mocked(packageItem).mockImplementation(async (_h, exportItem, packageName) => {
      run.exported.push({ id: exportItem.idName ?? "", folder: null, packageName, excluded: false });
      run.manager.cancel();
      return "";
    });
    await run.manager.exportSolutions(run.context, [one("pkg.a", "A1", "A2"), one("pkg.b", "B1")]);
    expect(run.exported).toHaveLength(1);
    const statuses = text(run, "status");
    expect(statuses.at(-1)).toBe("status|Export was canceled by user");
    expect(statuses).not.toContain("status|completed");
    expect(text(run).at(-1)).toBe("currentPackage|");
    expect(run.log()).toContain(`Export was canceled by user\r\nend of execution : ${STAMP}\r\n`);
    expect(run.manifest()).toContain("pkg.a");
  });

  it("still runs the referenced pass for its first package after a cancel (EXP-543)", async () => {
    const run = start(
      { known: ["pkg.a"], list: definitions({ "pkg.a": ["dep.x", "dep.y"] }), referenced: { "dep.x": [["R1", "List", "one"]], "dep.y": [["R2", "List", "two"]] } },
      (context) => {
        context.exportReferencedItems = true;
      },
    );
    vi.mocked(packageItem).mockImplementation(async (_h, exportItem, packageName) => {
      run.exported.push({ id: exportItem.idName ?? "", folder: null, packageName, excluded: false });
      run.manager.cancel();
      return "";
    });
    await run.manager.exportSolutions(run.context, [one("pkg.a", "A1")]);
    expect(run.exported.map((entry) => entry.id)).toEqual(["A1"]);
    const packages = text(run, "currentPackage");
    expect(packages).toHaveLength(3);
    expect(packages[1]).toMatch(/^currentPackage\|Exporting referenced items from 'dep\.[xy]'$/);
    expect(text(run, "status").at(-1)).toBe("status|Export was canceled by user");
    expect(run.log().match(/Export was canceled by user/g)).toHaveLength(1);
  });
});
