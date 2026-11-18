import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as library from "../browser.js";
import { README_BROWSER_SECTION, SnippetError, readmeSnippets, runSnippet, sectionOf } from "./readme-snippets.js";

/**
 * The extraction and the runner of the README's browser snippets (HOST-282), under Node: what a snippet is, what it may import, and
 * that the README's own snippets import only what the browser entry exports. The snippets themselves run in the browsers
 * (`readme.browser.test.ts`).
 */

const README = readFileSync(new URL("../../README.md", import.meta.url), "utf8");

const doc = (...lines: string[]): string => lines.join("\n");

describe("HOST-282: the README's browser snippets", () => {
  it("are the ts blocks of the Browser section, and each imports only names the browser entry exports", () => {
    const snippets = readmeSnippets(README);
    expect(snippets.length).toBeGreaterThanOrEqual(3);
    for (const snippet of snippets) {
      expect(snippet.imports.length, `README line ${snippet.line}`).toBeGreaterThan(0);
      for (const name of snippet.imports) expect(library, `README line ${snippet.line}: ${name}`).toHaveProperty(name);
      expect(README.split("\n")[snippet.line - 1], `README line ${snippet.line} is the snippet's first line`).toBe(snippet.code.split("\n")[0]);
    }
  });

  it("takes a section up to the next heading of its level, not a subsection", () => {
    const text = doc("# T", "## Browser", "a", "### Sub", "b", "## Next", "c");
    expect(sectionOf(text, README_BROWSER_SECTION)).toEqual({ text: doc("## Browser", "a", "### Sub", "b"), line: 2 });
    expect(() => sectionOf(text, "## Absent")).toThrow(SnippetError);
  });

  it("splits a snippet into its imports, its body and the constants it declares", () => {
    const [snippet, ...rest] = readmeSnippets(
      doc(
        "## Browser",
        "```sh",
        "npm install",
        "```",
        "```ts",
        'import { connect, vfsToZip } from "import-export-libs-js/browser";',
        "",
        "const session = await connect({ url });",
        "const { vfs, summary: result, ...others } = await session.run();",
        "  const inner = 1;",
        "```",
        "## After",
        "```ts",
        "const outside = 1;",
        "```",
      ),
    );
    expect(rest).toEqual([]);
    expect(snippet).toEqual({
      line: 6,
      code: doc('import { connect, vfsToZip } from "import-export-libs-js/browser";', "", "const session = await connect({ url });", "const { vfs, summary: result, ...others } = await session.run();", "  const inner = 1;"),
      imports: ["connect", "vfsToZip"],
      body: doc("", "const session = await connect({ url });", "const { vfs, summary: result, ...others } = await session.run();", "  const inner = 1;"),
      declared: ["session", "vfs", "result", "others"],
    });
  });

  it("refuses an import of anything but the library's browser entry", () => {
    expect(() => readmeSnippets(doc("## Browser", "```ts", 'import { readFileSync } from "node:fs";', "```"))).toThrow(/imports only the library's browser entry/);
    expect(() => readmeSnippets(doc("## Browser", "```ts", 'import * as lib from "import-export-libs-js/browser";', "```"))).toThrow(/an import a snippet may not have/);
    expect(() => readmeSnippets(doc("## Browser", "```ts", "const a = 1;"))).toThrow(/not closed/);
  });

  it("runs a snippet with its imports and inputs, and answers its constants", async () => {
    const [snippet] = readmeSnippets(doc("## Browser", "```ts", 'import { add } from "import-export-libs-js";', "const total = await add(a, 2);", "const { doubled } = { doubled: total * 2 };", "```"));
    if (snippet === undefined) throw new Error("no snippet");
    await expect(runSnippet(snippet, { add: async (x: number, y: number) => x + y }, { a: 1 })).resolves.toEqual({ total: 3, doubled: 6 });
    // an input may stand in for a library name
    await expect(runSnippet(snippet, { add: () => 0 }, { a: 1, add: (x: number, y: number) => x * y })).resolves.toEqual({ total: 2, doubled: 4 });
    await expect(runSnippet(snippet, {}, { a: 1 })).rejects.toThrow(/does not export add/);
  });
});
