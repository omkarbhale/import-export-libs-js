import { describe, expect, it } from "vitest";
import { BROWSER_TSCONFIG, ENTRY, GLOBALS, analyze, readBrowserFiles, summary } from "./browser-closure.js";

// The browser typecheck ratchet in its final form (roadmap/browser-host.md, D7; HOST-260). `tsc -p tsconfig.browser.json` already
// fails when a file of the closure touches Node; this test says which file and why, and fails the other way the config can go
// wrong: listing more than the one entry, which would hide a file the entry stopped reaching.
describe("browser closure ratchet", () => {
  const analysis = analyze();

  it("compiles the ambient Buffer declaration and the browser entry, and nothing else, as roots", () => {
    expect(readBrowserFiles()).toEqual([GLOBALS, ENTRY]);
  });

  it("has no file in the closure of the browser entry that touches Node", () => {
    expect(
      analysis.dirty,
      `These files of the closure of ${ENTRY} use Node, or import a file that does; ${BROWSER_TSCONFIG} compiles without Node's types:\n${summary(analysis)}`,
    ).toEqual({});
  });

  it("reaches the browser host and not the Node one", () => {
    expect(analysis.closure).toContain("src/host/default-host.browser.ts");
    expect(analysis.closure).not.toContain("src/host/default-host.ts");
    expect(analysis.closure).not.toContain("src/host/node-fs.ts");
  });
});
