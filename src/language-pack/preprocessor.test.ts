import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { CItemHelper } from "../client/item-helper.js";
import { directoryGetDirectories } from "../import/package-files.js";
import { ArgumentNullException } from "../io/errors.js";
import { directoryGetParentFullName, fileExists } from "../io/host-path.js";
import { ManifestFile, getSolutionPath } from "../manifest/index.js";
import { DEFAULT_LANGUAGES, cfg, envelope, esc, faultResponse, sections } from "./probe-harness.js";
import { PROBES } from "./probe-harness.js";
import { LanguagePackPreprocessor, getItemCount, itemTypeName, leftBehindTempFolder } from "./preprocessor.js";

/**
 * The behaviours of the preprocessor that the probe cases (`probes.test.ts`) do not print as a block: the object it leaves for the
 * host, the folders it leaves outside the temp folder, the failures that leave a temp package, `Dispose`, and the package
 * resolution of probe 04. Backs LP-003, LP-014, LP-020, LP-029 to LP-036.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

class FakeConnection implements ServerConnection {
  readonly requests: string[] = [];

  constructor(private readonly response: string = DEFAULT_LANGUAGES) {}

  async callAction(action: string, request: string): Promise<ResponseDocument> {
    this.requests.push(`${action} ${request}`);
    return ResponseDocument.parse(this.response);
  }
}

interface Setup {
  root: string;
  tempRoot: string;
  pack: string;
  config: string;
  connection: FakeConnection;
  helper: CItemHelper;
  options: { tempPath: string; randomFileName: () => string };
}

const ROW = '<export><Item type="Foo" id="A1"><property __name="name" de="Hallo"/></Item></export>';

function setup(response?: string): Setup {
  const root = mkdtempSync(join(tmpdir(), "libsjs-lp-unit-"));
  roots.push(root);
  const tempRoot = join(root, "tmp");
  const pack = join(root, "pack");
  mkdirSync(tempRoot);
  mkdirSync(join(pack, "xml"), { recursive: true });
  writeFileSync(join(pack, "ImportConfig.xml"), cfg("de", ['<itemtype name="Foo"/>']));
  writeFileSync(join(pack, "xml", "Foo.xml"), ROW);
  const connection = new FakeConnection(response);
  let counter = 0;
  return {
    root,
    tempRoot,
    pack,
    config: join(pack, "ImportConfig.xml"),
    connection,
    helper: new CItemHelper(connection),
    options: { tempPath: `${tempRoot}/`, randomFileName: () => `abcdefg${counter++}.xyz` },
  };
}

const create = (s: Setup, pkg: string | null, debug = false, path: string | null = s.config): Promise<LanguagePackPreprocessor> =>
  LanguagePackPreprocessor.create(s.helper, new ManifestFile(undefined, { engine: "14.0.7" }), path, pkg, debug, s.options);

describe("the object the preprocessor leaves for the host (LP-032, LP-036)", () => {
  it("holds the very manifest object it was given, with the one package, and lists the package name", async () => {
    const s = setup();
    const manifest = new ManifestFile(undefined, { engine: "14.0.7" });
    const pp = await LanguagePackPreprocessor.create(s.helper, manifest, s.config, "PKG", true, s.options);
    expect(pp.tempManifestFile).toBe(manifest);
    expect(manifest.getAllPackageNames()).toEqual(["PKG"]);
    expect(pp.tempPackagesNames).toEqual(["PKG"]);
    expect(pp.tempManifestFilePath).toBe(`${s.tempRoot}/LanguagePack_abcdefg0.xyz\\imports.mf`);
    expect(readFileSync(join(s.tempRoot, "LanguagePack_abcdefg0.xyz", "imports.mf"), "utf8")).toBe(
      '<imports>\r\n  <package name="PKG" path="PKG\\Import" />\r\n</imports>',
    );
  });

  it.each([["" as string | null], [null]])("does nothing for the language-pack path %j", async (lpPath) => {
    const s = setup();
    const pp = await create(s, "PKG", true, lpPath);
    expect(pp.tempManifestFilePath).toBe("imports.mf");
    expect(pp.tempPackagesNames).toEqual([]);
    expect(s.connection.requests).toEqual([]);
    expect(readdirSync(s.tempRoot)).toEqual([]);
    pp.dispose();
  });

  it("refuses a null helper and a null manifest, in that order, before it does anything", async () => {
    const s = setup();
    const options = s.options;
    await expect(LanguagePackPreprocessor.create(null, new ManifestFile(undefined, { engine: "14.0.7" }), s.config, "PKG", false, options)).rejects.toThrow(
      new ArgumentNullException("cItemHelper"),
    );
    await expect(LanguagePackPreprocessor.create(s.helper, null, s.config, "PKG", false, options)).rejects.toThrow(
      new ArgumentNullException("manifestFile"),
    );
    expect(readdirSync(s.tempRoot)).toEqual([]);
    expect(s.connection.requests).toEqual([]);
  });
});

describe("the engine parameter (LP-001)", () => {
  it.each(["12.0"] as const)("refuses engine %s, which has no language-pack import", async (engine) => {
    const s = setup();
    const helper = { engine } as unknown as CItemHelper;
    await expect(LanguagePackPreprocessor.create(helper, new ManifestFile(undefined, { engine: "14.0.7" }), s.config, "PKG", false, s.options)).rejects.toThrow(
      `engine ${engine} is not yet supported`,
    );
    expect(readdirSync(s.tempRoot)).toEqual([]);
  });
});

describe("Dispose (LP-034)", () => {
  it("deletes the temp folder, can be called again, and after someone else removed the folder", async () => {
    const s = setup();
    const pp = await create(s, "PKG");
    expect(readdirSync(s.tempRoot)).toHaveLength(1);
    pp.dispose();
    expect(readdirSync(s.tempRoot)).toEqual([]);
    pp.dispose();
    const again = await create(s, "PKG");
    rmSync(join(s.tempRoot, readdirSync(s.tempRoot)[0] as string), { recursive: true });
    again.dispose();
  });

  it("keeps the temp folder with lpdebug, however often it is called", async () => {
    const s = setup();
    const pp = await create(s, "PKG", true);
    pp.dispose();
    pp.dispose();
    expect(readdirSync(s.tempRoot)).toHaveLength(1);
  });

  it("deletes only the temp folder: a Fixes folder a rooted package name or `..` placed outside it stays", async () => {
    const s = setup();
    const outside = join(s.root, "rooted-out", "Lp");
    const rooted = await create(s, outside);
    expect(readFileSync(join(outside, "Import", "Fixes", "Foo.xml"), "utf8")).toContain("<i18n:name");
    expect(readdirSync(join(s.tempRoot, "LanguagePack_abcdefg0.xyz"))).toEqual(["imports.mf"]);
    rooted.dispose();
    expect(readdirSync(s.tempRoot)).toEqual([]);
    expect(existsSync(join(outside, "Import", "Fixes", "Foo.xml"))).toBe(true);

    const dotdot = await create(s, "..");
    expect(existsSync(join(s.tempRoot, "Import", "Fixes", "Foo.xml"))).toBe(true);
    dotdot.dispose();
    expect(existsSync(join(s.tempRoot, "Import", "Fixes", "Foo.xml"))).toBe(true);
  });
});

describe("a failed constructor leaves its temp package (LP-035)", () => {
  it.each([
    ["a missing configuration file", (s: Setup) => ({ path: join(s.pack, "none.xml"), pkg: "PKG" })],
    ["a missing xml folder", (s: Setup) => ({ path: join(s.root, "ImportConfig.xml"), pkg: "PKG", write: join(s.root, "ImportConfig.xml") })],
    ["a package name Path.Combine refuses", (s: Setup) => ({ path: s.config, pkg: "a|b" })],
  ])("%s", async (_, build) => {
    const s = setup();
    const { path, pkg, write } = build(s) as { path: string; pkg: string; write?: string };
    if (write) writeFileSync(write, cfg("de", ['<itemtype name="Foo"/>']));
    let failure: unknown;
    try {
      await create(s, pkg, false, path);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    const folder = leftBehindTempFolder(failure);
    expect(folder).toBe(join(s.tempRoot, "LanguagePack_abcdefg0.xyz"));
    expect(existsSync(folder as string)).toBe(true);
  });

  it("names no folder for a failure before the temp folder is made, and leaves none", async () => {
    const s = setup();
    let failure: unknown;
    try {
      await LanguagePackPreprocessor.create(null, new ManifestFile(undefined, { engine: "14.0.7" }), s.config, "PKG", false, s.options);
    } catch (error) {
      failure = error;
    }
    expect(leftBehindTempFolder(failure)).toBeUndefined();
    expect(readdirSync(s.tempRoot)).toEqual([]);
  });

  it("draws a new random name while a folder of that name exists (LP-030)", async () => {
    const s = setup();
    mkdirSync(join(s.tempRoot, "LanguagePack_first.one"));
    const names = ["first.one", "first.one", "second.two"];
    const pp = await LanguagePackPreprocessor.create(s.helper, new ManifestFile(undefined, { engine: "14.0.7" }), s.config, "PKG", true, {
      tempPath: `${s.tempRoot}/`,
      randomFileName: () => names.shift() as string,
    });
    expect(pp.tempManifestFilePath).toBe(`${s.tempRoot}/LanguagePack_second.two\\imports.mf`);
    expect(names).toEqual([]);
  });
});

describe("the import finds the fixes only for a package name without a dot (LP-033, probe 04)", () => {
  const recorded = sections("04-resolve-and-iom.out");
  // The rooted name of the probe is a Windows path; the POSIX equivalent is checked on its own below.
  const names: [label: string, pkg: string][] = [
    ["plain name", "LIBSJS-SCRATCH-LP"],
    ["name with a dot", "My.Pkg"],
    ["name with two dots", "com.example.lang"],
    ["core package name", "com.aras.innovator.core"],
    ["default package name", "com.aras.defaults.Lang"],
    ["solution package name", "com.aras.innovator.solution.PLM"],
    ["trailing dot", "a.b."],
    ["name with a space", "a b"],
    ["name with a slash", "a/b"],
  ];

  async function resolve(pkg: string): Promise<string[]> {
    const s = setup();
    const pp = await create(s, pkg, true);
    const manifest = new ManifestFile(pp.tempManifestFilePath, { engine: "14.0.7" });
    const folder = directoryGetParentFullName(pp.tempManifestFilePath);
    const lines = [`names in the saved manifest => ${manifest.getAllPackageNames().map(esc).join(", ")}`];
    const path = getSolutionPath(pkg, folder, manifest);
    lines.push(`GetSolutionPath => ${esc(path).split(esc(folder).slice(1, -1)).join("<temp>")}`);
    let subfolders: string[] = [];
    let exists = true;
    try {
      subfolders = directoryGetDirectories(path).map((entry) => entry.slice(entry.search(/[^\\/]+$/)));
    } catch {
      exists = false;
    }
    lines.push(`package folder exists => ${exists ? "True" : "False"}`);
    lines.push(`subfolders the import would read => ${subfolders.map(esc).join(", ")}`);
    lines.push(`Fixes\\Foo.xml found by the import => ${fileExists(`${path}\\Fixes\\Foo.xml`) ? "True" : "False"}`);
    return lines;
  }

  it.each(names)("%s", async (label, pkg) => {
    const expected = (recorded.get(label) as string[]).map((line) => line.replace("%USERPROFILE%\\\\AppData\\\\Local\\\\Temp\\\\LanguagePack_<random>", "<temp>"));
    expect((await resolve(pkg)).join("\n")).toBe(expected.join("\n"));
  });

  it("finds the fixes of a rooted name without dots at the place the name gives", async () => {
    const s = setup();
    const rooted = join(s.root, "rooted-resolve", "Lp");
    const pp = await create(s, rooted, true);
    const manifest = new ManifestFile(pp.tempManifestFilePath, { engine: "14.0.7" });
    const path = getSolutionPath(rooted, directoryGetParentFullName(pp.tempManifestFilePath), manifest);
    expect(path).toBe(`${rooted}\\Import`);
    expect(fileExists(`${path}\\Fixes\\Foo.xml`)).toBe(true);
  });
});

describe("IOM's item count of a Language answer (LP-014, probe 04)", () => {
  const text = (response: ResponseDocument): string => `isError=${response.isError ? "True" : "False"} getItemCount=${getItemCount(response)}`;
  const answers: [string, string][] = [
    ["two items", DEFAULT_LANGUAGES],
    ["no items fault 0", faultResponse("0", "No items of type Language found.")],
    ["other fault", faultResponse("1", "Access denied")],
    ["empty Result", envelope("<Result></Result>")],
    ["not a SOAP envelope", "<html/>"],
    ["Result holding an Item without children", envelope('<Result><Item type="Language"/></Result>')],
  ];
  const lines = readFileSync(join(PROBES, "04-resolve-and-iom.out"), "utf8").split(/\r?\n/);

  it.each(answers)("%s", (label, answer) => {
    expect(`${label} => ${text(ResponseDocument.parse(answer))}`).toBe(lines.find((line) => line.startsWith(`${label} =>`)));
  });
});

describe("the item type of a row file (LP-020)", () => {
  it.each([
    ["C:\\pack\\xml\\Foo.xml", "Foo"],
    ["/pack/xml/Foo.xml", "Foo"],
    ["x\\Foo.xmlbak", "Foobak"],
    ["x\\Foo.XML", "Foo.XML"],
    ["x\\Foo.xml.xml", "Foo"],
    ["x\\A.B.xml", "A.B"],
    ["x\\A.xml.xml.B.xml", "A.B"],
    ["x\\Sub Type.xml", "Sub Type"],
    ["x\\.xml", ""],
  ])("%s is %j", (path, name) => {
    expect(itemTypeName(path)).toBe(name);
  });
});

