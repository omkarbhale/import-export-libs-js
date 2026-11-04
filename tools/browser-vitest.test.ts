import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_HOST, DEFAULT_HOST_BROWSER, repoRoot } from "./browser-bundle.js";
import { FixturePathError, fixtureCommands, readFixtureBytes, readFixtureText, readFixtureTree, replaceDefaultHostForVite, resolveFixturePath } from "./browser-vitest.js";

/**
 * The Node side of the browser test project (HOST-263): the fixture commands refuse every path outside `fixtures/`, and the
 * replaced module is that one module and no other.
 *
 * @spec HOST-263
 */
const root = mkdtempSync(path.join(tmpdir(), "libsjs-browser-vitest-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(path.join(root, "fixtures", "a", "b"), { recursive: true });
mkdirSync(path.join(root, "outside"));
writeFileSync(path.join(root, "secret.txt"), "secret");
writeFileSync(path.join(root, "outside", "x.txt"), "outside");
writeFileSync(path.join(root, "fixtures", "a", "z.bin"), Buffer.from([0xff, 0xfe, 0x00, 0x41]));
writeFileSync(path.join(root, "fixtures", "a", "b", "t.txt"), "﻿text é");
writeFileSync(path.join(root, "fixtures", "a", "A.txt"), "upper");
symlinkSync(path.join(root, "outside"), path.join(root, "fixtures", "link"));
mkdirSync(path.join(root, "fixtures", "c"));
symlinkSync(path.join(root, "secret.txt"), path.join(root, "fixtures", "c", "link.txt"));

describe("HOST-263: the fixture commands read only under fixtures/", () => {
  it.each([
    ["package.json"],
    ["fixtures"],
    ["fixtures/"],
    ["/etc/passwd"],
    ["fixtures/../secret.txt"],
    ["fixtures/a/../../secret.txt"],
    ["fixtures/./a"],
    ["fixtures//a"],
    ["fixtures\\a"],
    ["fixtures/a\\..\\..\\secret.txt"],
    ["fixtures/a/z.bin\0"],
    ["Fixtures/a"],
    ["fixtures/missing"],
    ["fixtures/link/x.txt"],
    ["fixtures/c/link.txt"],
  ])("refuses %j", (requested) => {
    expect(() => resolveFixturePath(requested, root)).toThrow(FixturePathError);
    expect(() => readFixtureText(requested, root)).toThrow(/HOST-263/);
  });

  it("refuses what is not a string", () => {
    for (const bad of [undefined, null, 1, {}, ["fixtures/a"]]) expect(() => resolveFixturePath(bad, root)).toThrow(/not a string/);
  });

  it("reads a folder as its files in code-unit order, with exact bytes", () => {
    const tree = readFixtureTree("fixtures/a", root);
    expect(tree.map((file) => file.path)).toEqual(["A.txt", "b/t.txt", "z.bin"]);
    expect(Buffer.from(tree[2]!.bytesBase64, "base64")).toEqual(Buffer.from([0xff, 0xfe, 0x00, 0x41]));
  });

  it("does not follow a link inside a folder it reads", () => {
    expect(() => readFixtureTree("fixtures/c", root)).toThrow(/link or a special file/);
  });

  it("reads a file as base64 or as text, and a byte-order mark stays", () => {
    expect(readFixtureText("fixtures/a/b/t.txt", root)).toBe("﻿text é");
    expect(Buffer.from(readFixtureBytes("fixtures/a/b/t.txt", root), "base64").toString("utf8")).toBe("﻿text é");
  });

  it("tells a folder from a file", () => {
    expect(() => readFixtureText("fixtures/a", root)).toThrow(/not a file/);
    expect(() => readFixtureBytes("fixtures/a", root)).toThrow(/not a file/);
    expect(() => readFixtureTree("fixtures/a/z.bin", root)).toThrow(/not a folder/);
  });

  it("registers the three commands the page calls, which read this repository's fixtures", () => {
    expect(Object.keys(fixtureCommands).sort()).toEqual(["readFixtureBytes", "readFixtureText", "readFixtureTree"]);
    const real = readFixtureTree("fixtures/14.0.7/import/s0-mini-defaults");
    expect(real.length).toBeGreaterThan(3);
    expect(resolveFixturePath("fixtures/14.0.7", repoRoot)).toBe(path.join(repoRoot, "fixtures", "14.0.7"));
  });
});

describe("HOST-263: the browser project replaces the default host, and only it", () => {
  const plugin = replaceDefaultHostForVite(repoRoot);
  const resolveId = plugin.resolveId as (source: string, importer: string | undefined) => string | null;
  const from = path.join(repoRoot, DEFAULT_HOST);

  it("maps default-host.js, imported from the file next to it or from elsewhere in src, to the browser module", () => {
    expect(resolveId("./default-host.js", path.join(repoRoot, "src/host/node.ts"))).toBe(path.join(repoRoot, DEFAULT_HOST_BROWSER));
    expect(resolveId("../host/default-host.js", path.join(repoRoot, "src/io/host-path.ts"))).toBe(path.join(repoRoot, DEFAULT_HOST_BROWSER));
    expect(resolveId("../host/default-host.js", `${path.join(repoRoot, "src/io/host-path.ts")}?t=1`)).toBe(path.join(repoRoot, DEFAULT_HOST_BROWSER));
    expect(from.endsWith("src/host/default-host.ts")).toBe(true);
  });

  it("leaves every other module alone", () => {
    expect(resolveId("./default-host.browser.js", path.join(repoRoot, "src/host/node.ts"))).toBeNull();
    expect(resolveId("./other/default-host.js", path.join(repoRoot, "src/host/node.ts"))).toBeNull();
    expect(resolveId("./default-host.js", path.join(repoRoot, "tools/default-host.ts"))).toBeNull();
    expect(resolveId("./default-host.js", undefined)).toBeNull();
    expect(resolveId("./fs.js", path.join(repoRoot, "src/host/node.ts"))).toBeNull();
  });
});
