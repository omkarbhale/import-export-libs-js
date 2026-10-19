import { describe, expect, it } from "vitest";
import type { ExportCasePackage } from "../export-cases.js";
import { describeDifferences } from "./diff.js";
import { diffExportRuns1435, logParts } from "./diff-1435.js";
import type { RunOutcome } from "./outcome.js";

const item = (n: number) => ({ type: "List", id: `${n}`.padStart(32, "0"), keyedName: `k-${n}` });
const PACKAGES: ExportCasePackage[] = [{ name: "pkg", items: [item(1), item(2), item(3)] }];

const HEADER = "Log file: <x>\r\nWorking directory: /w\r\nExport level: 1\r\n\r\n";
const success = (n: number) => `Item id : ${n} - List - k-${n} successfully exported\r\n`;

const login = Array.from({ length: 6 }, (_, i) => ({ action: "ApplyItem", request: `<login ${i}/>`, response: "" }));
const get = (name: string) => ({ action: "ApplyItem", request: `<Item type="List" action="get"><id>${name}</id></Item>`, response: "" });

const run = (side: "oracle" | "port", change: (o: RunOutcome) => void = () => undefined): RunOutcome => {
  const o: RunOutcome = {
    side,
    calls: [...login, get("1"), get("2"), get("3")],
    files: new Map([
      ["imports.mf", Buffer.from("manifest")],
      ["pkg/List/1.xml", Buffer.from("one")],
      ["pkg/List/2.xml", Buffer.from("two")],
    ]),
    log: `${HEADER}         ****Export pkg****\r\nstart of execution\r\n${success(1)}${success(2)}${success(3)}end of execution\r\n`,
    messages: [
      { channel: "currentPackage", text: "pkg" },
      { channel: "status", text: "Item 1 of 3: List - k-1" },
      { channel: "status", text: "Item 2 of 3: List - k-2" },
      { channel: "status", text: "Item 3 of 3: List - k-3" },
      { channel: "status", text: "completed" },
    ],
    console: "",
    termination: { kind: "exported" },
    exitCode: 0,
  };
  change(o);
  return o;
};

const diff = (oracle: RunOutcome, port: RunOutcome, options: Parameters<typeof diffExportRuns1435>[2]["options"] = {}) =>
  describeDifferences(diffExportRuns1435(oracle, port, { packages: PACKAGES, options }));

describe("diffExportRuns1435 (EXP-558)", () => {
  it("finds no difference between equal runs", () => {
    expect(diff(run("oracle"), run("port"))).toEqual([]);
  });

  it("does not compare the order of the requests after the login, the success lines or the item statuses", () => {
    const port = run("port", (o) => {
      o.calls = [...login, get("3"), get("1"), get("2"), get("2")];
      o.log = `${HEADER}         ****Export pkg****\r\nstart of execution\r\n${success(3)}${success(1)}${success(2)}end of execution\r\n`;
      o.messages = [o.messages[0]!, { channel: "status", text: "Item 1 of 3: List - k-3" }, { channel: "status", text: "Item 1 of 3: List - k-1" }, { channel: "status", text: "Item 3 of 3: List - k-2" }, o.messages[4]!];
    });
    expect(diff(run("oracle"), port)).toEqual([]);
  });

  it("accepts an item status that the oracle's workers lost", () => {
    const oracle = run("oracle", (o) => void (o.messages = o.messages.filter((m) => m.text !== "Item 2 of 3: List - k-2")));
    expect(diff(oracle, run("port"))).toEqual([]);
  });

  it("finds a request only one side sent, and a login request that differs", () => {
    const port = run("port", (o) => void (o.calls = [...login, get("1"), get("2"), get("9")]));
    expect(diff(run("oracle"), port).join("\n")).toMatch(/\[calls\] 1 distinct request\(s\) only the oracle sent[\s\S]*\[calls\] 1 distinct request\(s\) only the port sent/);
    const other = run("port", (o) => void (o.calls[2] = { action: "ApplyItem", request: "<login other/>", response: "" }));
    expect(diff(run("oracle"), other)[0]).toBe("    [calls] login request 3 differs");
  });

  it("finds a file that differs or is missing when nothing stopped the run", () => {
    const port = run("port", (o) => {
      o.files!.set("pkg/List/1.xml", Buffer.from("uno"));
      o.files!.delete("pkg/List/2.xml");
    });
    const lines = diff(run("oracle"), port).join("\n");
    expect(lines).toMatch(/only the oracle wrote: pkg\/List\/2\.xml/);
    expect(lines).toMatch(/pkg\/List\/1\.xml differs byte for byte/);
  });

  it("finds a success line that is missing, and a line between the markers that differs", () => {
    const missing = run("port", (o) => void (o.log = o.log.replace(success(2), "")));
    expect(diff(run("oracle"), missing).join("\n")).toMatch(/the success lines of \*\*\*\*Export pkg\*\*\*\* differ \(3 against 2\)/);
    const other = run("port", (o) => void (o.log = o.log.replace("end of execution", "end of the execution")));
    expect(diff(run("oracle"), other).join("\n")).toMatch(/the lines of \*\*\*\*Export pkg\*\*\*\* other than the success lines differ/);
  });

  it("finds a package the log does not visit, a header that differs and a different ending", () => {
    expect(diff(run("oracle"), run("port", (o) => void (o.log = o.log.replace("pkg****", "pkg2****")))).join("\n")).toMatch(/the packages the log visits differ/);
    expect(diff(run("oracle"), run("port", (o) => void (o.log = o.log.replace("level: 1", "level: 2")))).join("\n")).toMatch(/the log header differs/);
    const failed = run("port", (o) => void ((o.termination = { kind: "exception", summary: "boom" }), (o.exitCode = 2)));
    expect(diff(run("oracle"), failed).join("\n")).toMatch(/the run ended differently/);
  });

  it("compares a run with one item per package in full", () => {
    const single: ExportCasePackage[] = [{ name: "pkg", items: [item(1)] }];
    const port = run("port", (o) => void (o.calls = [...login, get("1"), get("1")]));
    const oracle = run("oracle", (o) => void (o.calls = [...login, get("1")]));
    expect(describeDifferences(diffExportRuns1435(oracle, port, { packages: single, options: {} }))[0]).toMatch(/the oracle has 7 requests, the port 8|request 8 differs/);
    // the same two transcripts, with racing items, agree as sets
    expect(diff(oracle, port)).toEqual([]);
  });

  it("treats the pass over the referenced items as racing, though the case lists one item", () => {
    const single: ExportCasePackage[] = [{ name: "pkg", items: [item(1)] }];
    const swap = (o: RunOutcome) => void (o.calls = [...login, get("2"), get("1")]);
    const oracle = run("oracle", (o) => void (o.calls = [...login, get("1"), get("2")]));
    const port = run("port", swap);
    expect(describeDifferences(diffExportRuns1435(oracle, port, { packages: single, options: {} })).join("\n")).toMatch(/request 7 differs/);
    expect(describeDifferences(diffExportRuns1435(oracle, port, { packages: single, options: { exportReferencedItems: true } }))).toEqual([]);
  });

  describe("a run that a failure or a cancel stopped", () => {
    const failure = (side: "oracle" | "port", failing: number, files: string[]) =>
      run(side, (o) => {
        o.calls = [...login, get("1"), { action: "ApplyItem", request: `<Item type="List" action="get"><id>${`${failing}`.padStart(32, "0")}</id></Item>`, response: "<SOAP-ENV:Fault/>" }];
        o.files = new Map([["imports.mf", Buffer.from("manifest")], ...files.map((f) => [f, Buffer.from(f)] as const)]);
        o.log = `${HEADER}         ****Export pkg****\r\nstart of execution\r\nerror at k-${failing}\r\nend of execution\r\n`;
        o.messages = [{ channel: "currentPackage", text: "pkg" }, { channel: "errorQuestion", text: `failed: k-${failing}` }];
        o.termination = { kind: "exported" };
      });

    it("accepts other files in flight, the other failing item and other requests", () => {
      const oracle = failure("oracle", 2, ["pkg/List/1.xml", "pkg/List/3.xml"]);
      const port = failure("port", 3, ["pkg/List/1.xml"]);
      port.log = port.log.replace("k-3", "k-2");
      port.messages[1]!.text = oracle.messages[1]!.text;
      expect(diff(oracle, port)).toEqual([]);
    });

    it("still finds a file both wrote with other bytes, and a manifest only one side wrote", () => {
      const oracle = failure("oracle", 2, ["pkg/List/1.xml"]);
      const port = failure("port", 2, ["pkg/List/1.xml"]);
      port.files!.set("pkg/List/1.xml", Buffer.from("changed"));
      expect(diff(oracle, port).join("\n")).toMatch(/1 file\(s\) both wrote differ byte for byte/);
      port.files!.delete("imports.mf");
      expect(diff(oracle, port).join("\n")).toMatch(/only one side wrote imports.mf/);
    });
  });
});

describe("logParts", () => {
  it("keeps the header, sorts the success lines and collapses a repeated cancel pair", () => {
    const lines = `${HEADER}         ****Export pkg****\r\nstart of execution\r\n${success(2)}${success(1)}Export was canceled by user\r\nend of execution\r\nExport was canceled by user\r\nend of execution\r\n`.split("\n");
    const parts = logParts(lines);
    expect(parts.header).toContain("Export level: 1");
    expect(parts.packages).toHaveLength(1);
    expect(parts.packages[0]!.successes).toEqual([success(1).trim(), success(2).trim()]);
    expect(parts.packages[0]!.rest).toEqual(["start of execution", "Export was canceled by user", "end of execution"]);
  });
});
