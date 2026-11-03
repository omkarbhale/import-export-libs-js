import { describe, expect, it } from "vitest";
import {
  ALLOWLIST,
  BROWSER_TSCONFIG,
  GLOBALS,
  analyze,
  allowlistOf,
  browserFilesOf,
  readAllowlist,
  readBrowserFiles,
  summary,
} from "./browser-closure.js";

// The browser typecheck ratchet (roadmap/browser-host.md, D7). `tsc -p tsconfig.browser.json` already fails when a listed file
// touches Node; this test fails the other two ways the list can go wrong, and says which file and why.
describe("browser closure ratchet", () => {
  const analysis = analyze();
  const listed = readBrowserFiles().filter((file) => file !== GLOBALS);

  it("lists the ambient Buffer declaration first", () => {
    expect(readBrowserFiles()[0]).toBe(GLOBALS);
  });

  it("lists no file that stopped being clean", () => {
    const stale = listed.filter((file) => analysis.dirty[file] !== undefined || !analysis.closure.includes(file));
    expect(
      stale,
      `${BROWSER_TSCONFIG} lists files that are not clean, or not in the closure, any more:\n${stale
        .map((file) => `  ${file}  ${analysis.dirty[file] ?? "not in the closure"}`)
        .join("\n")}\nA file that touches Node, or imports one that does, must be fixed or removed from \`files\` (and given a reason in ${ALLOWLIST}).`,
    ).toEqual([]);
  });

  it("lists every file that became clean (the ratchet only tightens)", () => {
    const missing = analysis.clean.filter((file) => !listed.includes(file));
    expect(
      missing,
      `These files are clean now and missing from ${BROWSER_TSCONFIG}: add them (npx tsx tools/browser-closure.ts --write):\n${missing.map((file) => `  ${file}`).join("\n")}`,
    ).toEqual([]);
  });

  it("holds exactly the files that still use Node in the allowlist, each with its reason", () => {
    const expected = allowlistOf(analysis);
    const actual = readAllowlist();
    expect(actual.entry).toBe(expected.entry);
    expect(actual.files, `${ALLOWLIST} is out of date: npx tsx tools/browser-closure.ts --write`).toEqual(expected.files);
    // Print what is left, so that a seam ticket sees its target.
    console.info(summary(analysis));
  });

  it("keeps the files list sorted and equal to the computed subset", () => {
    expect(readBrowserFiles()).toEqual(browserFilesOf(analysis));
  });
});
