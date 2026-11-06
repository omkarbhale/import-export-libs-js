import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { originDifferences, outcomeOf, paddedInputDir, parseRuntimeOptions, treeFromDisk, wireDifferences } from "./browser-runner.js";
import type { BrowserRunResult } from "./browser-page/protocol.js";
import { describeDifferences, diffOutcomes, relabelDifferences } from "./diff.js";
import type { RunOutcome } from "./outcome.js";
import { scrubbedOutcome } from "./port-run.js";
import { type StepReport, compare, withBrowser } from "./runners.js";

/** The driver's arguments, its conversion of the page's result, and the three-way comparison, on synthetic runs (HOST-277). No browser starts here. */

describe("--runtime, --browser and --browser-cors", () => {
  it("defaults to the Node runtime, and to Chromium through the proxy for the browser runtime", () => {
    expect(parseRuntimeOptions({})).toEqual({ runtime: "node" });
    expect(parseRuntimeOptions({ runtime: "node" })).toEqual({ runtime: "node" });
    expect(parseRuntimeOptions({ runtime: "browser" })).toEqual({ runtime: "browser", browser: "chromium", cors: "proxy" });
  });

  it("takes the three browsers and the two ways to the server", () => {
    for (const browser of ["chromium", "firefox", "webkit"] as const) {
      for (const cors of ["proxy", "server"] as const) {
        expect(parseRuntimeOptions({ runtime: "browser", browser, "browser-cors": cors })).toEqual({ runtime: "browser", browser, cors });
      }
    }
  });

  it("refuses a value that is not a choice, naming the choices", () => {
    expect(() => parseRuntimeOptions({ runtime: "deno" })).toThrow("unknown runtime 'deno' (node, browser)");
    expect(() => parseRuntimeOptions({ runtime: "browser", browser: "safari" })).toThrow("unknown browser 'safari' (chromium, firefox, webkit)");
    expect(() => parseRuntimeOptions({ runtime: "browser", "browser-cors": "magic" })).toThrow("unknown --browser-cors 'magic' (proxy, server)");
  });

  it("refuses the browser options without the browser runtime", () => {
    expect(() => parseRuntimeOptions({ browser: "firefox" })).toThrow("--browser and --browser-cors need --runtime browser");
    expect(() => parseRuntimeOptions({ runtime: "node", "browser-cors": "proxy" })).toThrow("--browser and --browser-cors need --runtime browser");
  });
});

describe("the package folder of the page", () => {
  it("is a path of the length asked for, ending in /input", () => {
    for (const length of [60, 96, 120]) {
      const path = paddedInputDir(length);
      expect(path).toHaveLength(length);
      expect(path.startsWith("/")).toBe(true);
      expect(path.endsWith("/input")).toBe(true);
    }
  });

  it("is /input when the length leaves no room to pad", () => {
    expect(paddedInputDir(3)).toBe("/input");
  });
});

describe("treeFromDisk", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("gives the files of a folder under a root of the page's tree, and an empty folder as a path ending in /", () => {
    const dir = mkdtempSync(join(tmpdir(), "libsjs-tree-"));
    made.push(dir);
    mkdirSync(join(dir, "a", "empty"), { recursive: true });
    writeFileSync(join(dir, "a", "b.xml"), "<AML/>");
    writeFileSync(join(dir, "imports.mf"), "m");
    const tree = treeFromDisk(dir, "/work/in");
    expect(tree.map(([path]) => path).sort()).toEqual(["/work/in/a/b.xml", "/work/in/a/empty/", "/work/in/imports.mf"]);
    expect(Buffer.from(tree.find(([path]) => path.endsWith("b.xml"))![1]).toString()).toBe("<AML/>");
  });
});

const PASSWORD = "Sup3r-Secret-pw";

const result = (change: (r: BrowserRunResult) => void = () => undefined): BrowserRunResult => {
  const r: BrowserRunResult = {
    calls: [
      { action: "ApplyItem", request: "\r\n<Item a/>", response: "<r/>" },
      { action: "ApplyItem", request: "<Item b/>", response: "<r/>" },
    ],
    files: [
      ["imports.mf", new TextEncoder().encode("manifest")],
      ["empty/", new Uint8Array(0)],
    ],
    log: "one\r\ntwo\r\n",
    messages: [{ channel: "status", text: "hello" }],
    console: "",
    termination: { kind: "exported" },
    exitCode: 0,
    wire: [
      { action: "ApplyItem", body: "<Item a/>" },
      { action: "ApplyItem", body: "<Item b/>" },
    ],
    origins: ["http://127.0.0.1:1"],
  };
  change(r);
  return r;
};

describe("the page's result as a RunOutcome", () => {
  it("is a browser outcome with the files as buffers and the empty folder kept", () => {
    const outcome = outcomeOf(result(), PASSWORD);
    expect(outcome.side).toBe("browser");
    expect(outcome.files?.get("imports.mf")?.toString()).toBe("manifest");
    expect(outcome.files?.has("empty/")).toBe(true);
    expect(outcome.calls).toHaveLength(2);
  });

  it("is scrubbed as the Node port's: a password that is a common word leaves the same text on every side", () => {
    const text = "com.aras.innovator.history";
    const browser = outcomeOf(
      result((r) => {
        r.log = `${text}\r\n`;
        r.calls = [{ action: "ApplyItem", request: `<Item a="${text}"/>`, response: `<r>${text}</r>` }];
      }),
      "innovator",
    );
    expect(browser.log).toBe(`${text}\r\n`);
    expect(browser.calls[0]).toEqual({ action: "ApplyItem", request: `<Item a="${text}"/>`, response: `<r>${text}</r>` });
    const node = scrubbedOutcome({ ...browser, side: "port" }, "innovator");
    expect(diffOutcomes(node, browser)).toEqual([]);
  });
});

describe("the origins the page called", () => {
  it("is no difference when each is the page's own", () => {
    expect(originDifferences(["http://127.0.0.1:1"], "http://127.0.0.1:1")).toEqual([]);
  });

  it("names any other origin as a difference of the wire", () => {
    const found = originDifferences(["http://127.0.0.1:1", "http://172.19.0.1"], "http://127.0.0.1:1");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ area: "wire", summary: "the page called http://172.19.0.1, not its own origin" });
  });
});

describe("the wire check", () => {
  it("finds each call's request on the wire, whatever white space the engine's record keeps before the root", () => {
    const r = result();
    expect(wireDifferences(r.calls, r.wire)).toEqual([]);
  });

  it("allows a request that was sent twice (a renewed token, a changed digest)", () => {
    const r = result((x) => x.wire.splice(0, 0, { action: "ApplyItem", body: "<Item a/>" }));
    expect(wireDifferences(r.calls, r.wire)).toEqual([]);
  });

  it("reports a call the transport did not send, with what it sent instead", () => {
    const r = result((x) => (x.wire[1] = { action: "ApplyItem", body: "<Item c/>" }));
    const found = wireDifferences(r.calls, r.wire);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ area: "wire", summary: "call 2 (ApplyItem) is not the body of a request that the transport sent", oracle: "<Item b/>", port: "<Item c/>" });
    expect(describeDifferences(found)).toEqual(expect.arrayContaining([expect.stringContaining("engine: <Item b/>"), expect.stringContaining("wire:   <Item c/>")]));
  });

  it("reports a call when the wire has fewer requests than the engine made", () => {
    const r = result((x) => x.wire.pop());
    expect(wireDifferences(r.calls, r.wire)).toHaveLength(1);
  });

  it("matches the action too", () => {
    const r = result((x) => (x.wire[0] = { action: "ApplyAML", body: "<Item a/>" }));
    expect(wireDifferences(r.calls, r.wire)).toHaveLength(1);
  });
});

const recorded = (side: "oracle" | "port"): RunOutcome => ({
  side,
  calls: [
    { action: "ApplyItem", request: "\r\n<Item a/>", response: "<r/>" },
    { action: "ApplyItem", request: "<Item b/>", response: "<r/>" },
  ],
  files: new Map([
    ["imports.mf", Buffer.from("manifest")],
    ["empty/", Buffer.alloc(0)],
  ]),
  log: "one\r\ntwo\r\n",
  messages: [{ channel: "status", text: "hello" }],
  console: "",
  termination: { kind: "exported" },
  exitCode: 0,
});

const sameRule = (left: RunOutcome, right: RunOutcome) => diffOutcomes(left, right);

describe("the three-way comparison", () => {
  const first = (): StepReport => compare("step", recorded("oracle"), recorded("port"));

  it("finds no difference when the page's run is the oracle's and the Node port's", () => {
    const browser = { outcome: outcomeOf(result(), PASSWORD), wire: wireDifferences(result().calls, result().wire) };
    const step = withBrowser(first(), recorded("oracle"), recorded("port"), browser, sameRule);
    expect(step.differences).toEqual([]);
    expect(step.browserCalls).toBe(2);
    expect(step.browserEnd).toBe("exported");
  });

  it("names a difference of the page against the oracle and against the Node port, each for its pair", () => {
    const browser = { outcome: outcomeOf(result((r) => (r.log = "one\r\nTHREE\r\n")), PASSWORD), wire: [] };
    const step = withBrowser(first(), recorded("oracle"), recorded("port"), browser, sameRule);
    expect(step.differences.map((d) => d.summary)).toEqual(["browser against oracle: log line 2 differs (first at character 0)", "browser against node: log line 2 differs (first at character 0)"]);
    const lines = describeDifferences(step.differences);
    expect(lines).toEqual(expect.arrayContaining([expect.stringContaining("oracle: \"two"), expect.stringContaining("browser: \"THREE"), expect.stringContaining("node:")]));
  });

  it("a difference the Node port already has against the oracle is in the step once, and the page's own is added", () => {
    const port = recorded("port");
    port.log = "one\r\nTWO\r\n";
    const step = withBrowser(compare("step", recorded("oracle"), port), recorded("oracle"), port, { outcome: outcomeOf(result(), PASSWORD), wire: [] }, sameRule);
    expect(step.differences.map((d) => d.summary)).toEqual(["log line 2 differs (first at character 0)", "browser against node: log line 2 differs (first at character 0)"]);
  });

  it("adds the wire's differences to the step", () => {
    const r = result((x) => x.wire.pop());
    const step = withBrowser(first(), recorded("oracle"), recorded("port"), { outcome: outcomeOf(r, PASSWORD), wire: wireDifferences(r.calls, r.wire) }, sameRule);
    expect(step.differences.map((d) => d.area)).toEqual(["wire"]);
  });

  it("compares the files byte for byte, in each pair", () => {
    const r = result((x) => (x.files = [["imports.mf", new TextEncoder().encode("manifesT")], ["empty/", new Uint8Array(0)]]));
    const step = withBrowser(first(), recorded("oracle"), recorded("port"), { outcome: outcomeOf(r, PASSWORD), wire: [] }, sameRule);
    expect(step.differences.map((d) => d.summary)).toEqual([
      "browser against oracle: imports.mf differs byte for byte (8 against 8 bytes, first at byte 7)",
      "browser against node: imports.mf differs byte for byte (8 against 8 bytes, first at byte 7)",
    ]);
  });
});

describe("relabelDifferences", () => {
  it("renames both sides in the line and in the labels, and says which pair it is about", () => {
    const [d] = relabelDifferences([{ area: "calls", summary: "the oracle has 3 requests, the port 4", oracle: "a", port: "b" }], "node", "browser");
    expect(d).toMatchObject({ summary: "browser against node: the node has 3 requests, the browser 4", labels: { oracle: "node", port: "browser" } });
  });
});
