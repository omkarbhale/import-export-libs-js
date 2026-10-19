import { describe, expect, it } from "vitest";
import { describeDifferences, diffOutcomes } from "./diff.js";
import type { RunOutcome } from "./outcome.js";

const base = (): RunOutcome => ({
  side: "oracle",
  calls: [
    { action: "ApplyItem", request: "<Item a/>", response: "" },
    { action: "ApplyItem", request: "<Item b/>", response: "" },
  ],
  files: new Map([
    ["imports.mf", Buffer.from("manifest")],
    ["a/b.xml", Buffer.from("item")],
  ]),
  log: "one\r\ntwo\r\n",
  messages: [{ channel: "status", text: "hello" }],
  console: "",
  termination: { kind: "exported" },
  exitCode: 0,
});

const port = (change: (o: RunOutcome) => void): RunOutcome => {
  const o = base();
  o.side = "port";
  change(o);
  return o;
};

describe("diffOutcomes", () => {
  it("finds no difference between equal runs", () => {
    expect(diffOutcomes(base(), port(() => undefined))).toEqual([]);
  });

  it("names the first request that differs and where", () => {
    const differences = diffOutcomes(base(), port((o) => void (o.calls[1] = { action: "ApplyItem", request: "<Item c/>", response: "" })));
    expect(differences).toHaveLength(1);
    expect(differences[0]).toMatchObject({ area: "calls", summary: "request 2 differs (first at character 16)" });
  });

  it("counts a request the port did not send", () => {
    const differences = diffOutcomes(base(), port((o) => void o.calls.pop()));
    expect(differences.map((d) => d.summary)).toContain("the oracle has 2 requests, the port 1");
  });

  it("compares the files byte for byte and lists the ones only one side wrote", () => {
    const differences = diffOutcomes(
      base(),
      port((o) => {
        o.files!.set("a/b.xml", Buffer.from("iten"));
        o.files!.delete("imports.mf");
        o.files!.set("extra.xml", Buffer.alloc(0));
      }),
    );
    expect(differences.map((d) => d.summary)).toEqual([
      "only the oracle wrote: imports.mf",
      "only the port wrote: extra.xml",
      "a/b.xml differs byte for byte (4 against 4 bytes, first at byte 3)",
    ]);
  });

  it("compares the log after normalisation only", () => {
    const withTime = (text: string) => ({ log: text });
    const a = { ...base(), ...withTime("10/19/2026 10:00:00 go\r\n") };
    const b = { ...port(() => undefined), ...withTime("10/20/2026 11:11:11 go\r\n") };
    expect(diffOutcomes(a, b)).toEqual([]);
    const c = { ...port(() => undefined), ...withTime("10/20/2026 11:11:11 gone\r\n") };
    expect(diffOutcomes(a, c).map((d) => d.area)).toEqual(["log"]);
  });

  it("compares messages, the console and how the run ended", () => {
    const differences = diffOutcomes(
      base(),
      port((o) => {
        o.messages[0] = { channel: "warning", text: "hello" };
        o.console = "x";
        o.termination = { kind: "exception", summary: "System.Exception: boom" };
        o.exitCode = 2;
      }),
    );
    expect(differences.map((d) => d.area)).toEqual(["messages", "console", "termination"]);
    expect(describeDifferences(differences).join("\n")).toContain("port:   exception System.Exception: boom (exit 2)");
  });
});
