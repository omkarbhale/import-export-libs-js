import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { vfsFromZip } from "../src/browser/zip.js";
import { FixturePathError, adapterCommands, fixtureCommands, makeManyFilesFolder, manyFilesNames, resolveInputPaths, zipOfFixtureFolder } from "./browser-vitest.js";

/**
 * The Node side of the commands that choose and drop files in a page and write the reference zip (HOST-267): what a page may name,
 * the folder of many files, and the zip that Node writes of a fixture folder.
 *
 * @spec HOST-267
 */
const root = mkdtempSync(path.join(tmpdir(), "libsjs-adapter-commands-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(path.join(root, "fixtures", "pkg", "sub"), { recursive: true });
writeFileSync(path.join(root, "fixtures", "pkg", "imports.mf"), "<imports/>");
writeFileSync(path.join(root, "fixtures", "pkg", "sub", "a.xml"), `<a>${"x".repeat(2000)}</a>`);
writeFileSync(path.join(root, "fixtures", "one.xml"), "<one/>");
writeFileSync(path.join(root, "fixtures", "two.xml"), "<two/>");
mkdirSync(path.join(root, "outside"));

describe("HOST-267: what a page may choose in a file input", () => {
  it("is a fixture folder alone, or fixture files, as absolute paths", () => {
    expect(resolveInputPaths("fixtures/pkg", root)).toEqual([path.join(root, "fixtures", "pkg")]);
    expect(resolveInputPaths(["fixtures/one.xml", "fixtures/two.xml"], root)).toEqual([path.join(root, "fixtures", "one.xml"), path.join(root, "fixtures", "two.xml")]);
  });

  it.each([["outside"], ["fixtures/../outside"], ["/etc/passwd"], ["fixtures/missing"], [["fixtures/one.xml", "outside/x"]], [[]], [7]])("refuses %j", (requested) => {
    expect(() => resolveInputPaths(requested, root)).toThrow(FixturePathError);
  });

  it("refuses a folder among other paths, because a folder input takes one folder", () => {
    expect(() => resolveInputPaths(["fixtures/pkg", "fixtures/one.xml"], root)).toThrow(/a folder is chosen alone/);
  });
});

describe("HOST-267: the folder of many files", () => {
  it("has the number of files asked for, named so that they sort by number, an empty folder, and files a page can read", () => {
    const made = makeManyFilesFolder(250);
    try {
      expect(made.folder).toBe(path.join(made.root, "Many"));
      const names = readdirSync(made.folder).sort();
      expect(names.filter((name) => name !== "empty")).toEqual(manyFilesNames(250));
      expect(names).toContain("empty");
      expect(readdirSync(path.join(made.folder, "empty"))).toEqual([]);
      expect(readFileSync(path.join(made.folder, "item-0137.xml"), "utf8")).toBe('<Item id="item-0137.xml"/>');
      expect(manyFilesNames(3)).toEqual(["item-0000.xml", "item-0001.xml", "item-0002.xml"]);
    } finally {
      rmSync(made.root, { recursive: true, force: true });
    }
    expect(existsSync(made.root)).toBe(false);
  });

  it.each([[0], [-1], [5001], [1.5], ["250"], [undefined]])("refuses a count of %j", (count) => {
    expect(() => makeManyFilesFolder(count)).toThrow(FixturePathError);
  });
});

describe("HOST-267: the reference zip", () => {
  it("is the zip of the files of the folder, which reads back to them, the same bytes every time", () => {
    const base64 = zipOfFixtureFolder("fixtures/pkg", 6, root);
    const tree = vfsFromZip(new Uint8Array(Buffer.from(base64, "base64")));
    expect(tree.toTree()).toEqual(["imports.mf", "sub/", "sub/a.xml"]);
    expect(Buffer.from(tree.readFile("/sub/a.xml")).toString()).toBe(`<a>${"x".repeat(2000)}</a>`);
    expect(zipOfFixtureFolder("fixtures/pkg", 6, root)).toBe(base64);
    expect(zipOfFixtureFolder("fixtures/pkg", 0, root)).not.toBe(base64);
  });

  it("takes a level of 0 or 6 and a fixture folder, and nothing else", () => {
    expect(() => zipOfFixtureFolder("fixtures/pkg", 5, root)).toThrow(/level/);
    expect(() => zipOfFixtureFolder("outside", 6, root)).toThrow(FixturePathError);
  });
});

describe("HOST-267: the commands the browser projects register", () => {
  it("are the ones the tests call, and none of them is a fixture command", () => {
    expect(Object.keys(adapterCommands).sort()).toEqual(["chooseFixtureInput", "chooseManyFilesFolder", "dropFixtureOn", "dropManyFilesFolderOn", "zipFixtureFolder"]);
    for (const name of Object.keys(adapterCommands)) expect(Object.keys(fixtureCommands)).not.toContain(name);
  });
});
