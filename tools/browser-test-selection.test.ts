import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SELECTION_FILE, ownReason, readSelectionFile, renderSelectionFile, selectPureTests, toFile } from "./browser-test-selection.js";

/**
 * The selection of the unit tests that run in the browsers (HOST-264): the checked-in list is the computed one, and the
 * classification is what the rule says, on small synthetic trees.
 *
 * @spec HOST-264
 */

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "libsjs-selection-"));
  roots.push(root);
  writeFileSync(path.join(root, "tsconfig.json"), "{}");
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
  return root;
}

describe("HOST-264: the checked-in selection", () => {
  it("is the list the tool computes, so a test that became pure or impure is noticed", async () => {
    const selection = await selectPureTests();
    expect(
      readSelectionFile().files,
      `${SELECTION_FILE} is stale. Run \`npx tsx tools/browser-test-selection.ts --write\` and commit it.`,
    ).toEqual(selection.pure);
    expect(renderSelectionFile(toFile(selection))).toBe(renderSelectionFile(readSelectionFile()));
  });

  it("lists only unit tests of src/ that are not browser tests, sorted, and is not empty", () => {
    const { files } = readSelectionFile();
    expect(files.length).toBeGreaterThan(0);
    expect(files).toEqual([...files].sort());
    for (const file of files) {
      expect(file).toMatch(/^src\/.*\.test\.ts$/);
      expect(file).not.toMatch(/\.browser\.test\.ts$/);
    }
  });
});

describe("HOST-264: what makes a test file impure", () => {
  it("selects a test whose closure is source files and packages, and leaves out the rest with the reason", async () => {
    const root = tree({
      "src/pure.ts": "export const one = 1;",
      "src/a.test.ts": 'import { it } from "vitest"; import { one } from "./pure.js"; it("a", () => one);',
      "src/b.test.ts": 'import { readFileSync } from "node:fs"; export const b = readFileSync;',
      "src/helper.ts": 'import { join } from "path"; export const j = join;',
      "src/c.test.ts": 'import { j } from "./helper.js"; export const c = j;',
      "src/d.test.ts": "export const d = process.env.HOME;",
      "src/e.test.ts": "const require = (a: string) => a; export const e = require('x');",
      "tools/x.ts": "export const x = 1;",
      "src/f.test.ts": 'import { x } from "../tools/x.js"; export const f = x;',
      "src/g.test.ts": 'import { vi } from "vitest"; vi.mock("node:fs"); export const g = 1;',
      "src/h.test.ts": "export const h = import.meta.url;",
      "src/i.test.ts": 'import { xml } from "@xmldom/xmldom"; export const i = xml;',
      "src/j.test.ts": 'export const j = async () => import("node:os");',
      "src/k.browser.test.ts": "export const k = 1;",
      "src/sub/l.test.ts": 'import { one } from "../pure.js"; export const l = one;',
      "spec/m.test.ts": "export const m = 1;",
    });
    const { pure, impure } = await selectPureTests(root);
    expect(pure).toEqual(["src/a.test.ts", "src/e.test.ts", "src/i.test.ts", "src/sub/l.test.ts"]);
    expect(impure).toEqual({
      "src/b.test.ts": "src/b.test.ts names node:fs",
      "src/c.test.ts": "src/helper.ts imports path",
      "src/d.test.ts": "src/d.test.ts uses process",
      "src/f.test.ts": "tools/x.ts is outside src/",
      "src/g.test.ts": "src/g.test.ts names node:fs",
      "src/h.test.ts": "src/h.test.ts uses import.meta.url",
      "src/j.test.ts": "src/j.test.ts names node:os",
    });
  });

  it("follows the browser's default host and not the Node one, as the bundle does", async () => {
    const root = tree({
      "src/host/default-host.ts": 'import { readFileSync } from "node:fs"; export const host = readFileSync;',
      "src/host/default-host.browser.ts": "export const host = 1;",
      "src/n.test.ts": 'import { host } from "./host/default-host.js"; export const n = host;',
      "src/host/other.ts": 'import { host } from "./default-host.js"; export const other = host;',
      "src/o.test.ts": 'import { other } from "./host/other.js"; export const o = other;',
    });
    const { pure, impure } = await selectPureTests(root);
    expect(pure).toEqual(["src/n.test.ts", "src/o.test.ts"]);
    expect(impure).toEqual({});
  });
});

describe("HOST-264: the Node-only names in one file", () => {
  it("finds a Node global that the file does not declare, and a module location", () => {
    expect(ownReason("const x = process.cwd();")).toBe("uses process");
    expect(ownReason("const x = __dirname;")).toBe("uses __dirname");
    expect(ownReason("setImmediate(() => 1);")).toBe("uses setImmediate");
    expect(ownReason("const u = import.meta.dirname;")).toBe("uses import.meta.dirname");
    expect(ownReason('const m = "node:path";')).toBe("names node:path");
  });

  it("does not take a member, a key, a type or a local binding of the same name for the global", () => {
    expect(ownReason("const a = { process: 1 }; a.process; type T = { process: number };")).toBeUndefined();
    expect(ownReason("function f(process: number) { return process; }")).toBeUndefined();
    expect(ownReason("const require = 1; require;")).toBeUndefined();
    expect(ownReason("const url = import.meta; const s = 'path';")).toBeUndefined();
    expect(ownReason("// process, node:fs and __dirname in a comment\nconst x = 1;")).toBeUndefined();
  });
});
