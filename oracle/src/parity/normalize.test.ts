import { describe, expect, it } from "vitest";
import { dbPatchIds, normalizeLog, normalizeOutcome, replaceIds, serverIds } from "./normalize.js";
import type { RunOutcome } from "./outcome.js";

const A = "A".repeat(32);
const B = "B".repeat(32);
const C = "C".repeat(32);
const D = "D".repeat(32);

const outcome = (overrides: Partial<RunOutcome>): RunOutcome => ({
  side: "oracle",
  calls: [],
  files: null,
  log: "",
  messages: [],
  console: null,
  termination: { kind: "returned", value: 0 },
  exitCode: 0,
  ...overrides,
});

describe("the ids the server assigned", () => {
  it("numbers an id by its first appearance in the answer to a request that adds", () => {
    const ids = serverIds([
      { request: `<Item type="PackageDefinition" action="add"><name>x</name></Item>`, response: `<Result><Item id="${A}"/></Result>` },
      { request: `<Item type="PackageGroup" action="add"><source_id>${A}</source_id></Item>`, response: `<Result><Item id="${B}"/></Result>` },
    ]);
    expect([...ids]).toEqual([
      [A, "<ID#1>"],
      [B, "<ID#2>"],
    ]);
  });

  it("leaves an id that a request names, and one that a get answers", () => {
    const ids = serverIds([
      { request: `<Item type="Method" action="add" id="${C}"/>`, response: `<Result><Item id="${C}"/></Result>` },
      { request: `<Item type="User" action="get"/>`, response: `<Result><Item id="${D}"/></Result>` },
    ]);
    expect(ids.size).toBe(0);
  });

  it("does not number an id the run has seen before the add that returns it", () => {
    const ids = serverIds([
      { request: `<Item type="User" action="get"/>`, response: `<Result><Item id="${D}"/></Result>` },
      { request: `<Item type="Method" action="add"/>`, response: `<Result><Item id="${A}" created_by_id="${D}"/></Result>` },
    ]);
    expect([...ids.keys()]).toEqual([A]);
  });

  it("numbers the ids a pre-run made first, and the ids of earlier steps before the current one", () => {
    const ids = serverIds([{ request: `<Item action="add"/>`, response: `<Result><Item id="${B}"/></Result>` }], [A]);
    expect([...ids]).toEqual([
      [A, "<ID#1>"],
      [B, "<ID#2>"],
    ]);
    const normal = normalizeOutcome(
      outcome({ calls: [{ action: "ApplyItem", request: `<Item id="${A}" action="edit"/>`, response: "<Result/>" }] }),
      { madeBefore: [A] },
    );
    expect(normal.calls).toEqual([`ApplyItem <Item id="<ID#1>" action="edit"/>`]);
    const later = normalizeOutcome(
      outcome({ calls: [{ action: "ApplyItem", request: `<Item action="get" id="${C}"/>`, response: "<Result/>" }] }),
      { earlier: [{ action: "ApplyItem", request: `<Item action="add"/>`, response: `<Result><Item id="${C}"/></Result>` }] },
    );
    expect(later.calls).toEqual([`ApplyItem <Item action="get" id="<ID#1>"/>`]);
  });

  it("replaces the numbered ids and no others, whatever their case", () => {
    const ids = new Map([[A, "<ID#1>"]]);
    expect(replaceIds(`x ${A.toLowerCase()} ${B}`, ids)).toBe(`x <ID#1> ${B}`);
  });
});

describe("the log", () => {
  const log = [
    "Log file: /tmp/run/engine.log\r",
    "Working directory: C:\\Users\\x\\runs\\1\\input\r",
    "Manifest file: C:\\Users\\x\\runs\\1\\input\\imports.mf\r",
    "URL: http://localhost/12sp9\r",
    "10/19/2026 16:00:01 start\r",
    "File full name 'C:\\Users\\x\\runs\\1\\input\\Pkg\\Import\\List\\a.xml'\r",
    "File full name '/tmp/elsewhere/fixes.xml'\r",
    `Item ${A}\r`,
  ].join("\n");

  it("replaces what is the run's own and keeps the rest", () => {
    const text = normalizeLog(log, new Map([[A, "<ID#1>"]]));
    expect(text).toBe(
      [
        "Log file: <path>\r",
        "Working directory: <path>\r",
        "Manifest file: <path>\r",
        "URL: http://localhost/12sp9\r",
        "<time> start\r",
        "File full name '<working>/Pkg/Import/List/a.xml'\r",
        "File full name '<other>/fixes.xml'\r",
        "Item <ID#1>\r",
      ].join("\n"),
    );
  });

  it("compares a Windows working directory and a POSIX one as equal", () => {
    const windows = normalizeLog("Working directory: C:\\w\\input\r\nFile full name 'C:\\w\\input\\a\\b.xml'\r\n", new Map());
    const posix = normalizeLog("Working directory: /w/input\r\nFile full name '/w/input/a/b.xml'\r\n", new Map());
    expect(windows).toBe(posix);
  });
});

describe("an outcome", () => {
  it("leaves out the calls to skip, and numbers the ids of the rest", () => {
    const calls = [
      { action: "ApplyItem", request: `<Item action="get"/>`, response: "<Result/>" },
      { action: "ApplyItem", request: `<Item action="add"/>`, response: `<Result><Item id="${A}"/></Result>` },
      { action: "ApplyItem", request: `<Item action="get" id="${A}"/>`, response: "<Result/>" },
    ];
    const normal = normalizeOutcome(outcome({ calls }), { skipCalls: 1 });
    expect(normal.calls).toEqual([`ApplyItem <Item action="add"/>`, `ApplyItem <Item action="get" id="<ID#1>"/>`]);
  });

  it("writes how a run ended, with its own folder left out of an exception", () => {
    const normal = normalizeOutcome(
      outcome({ log: "Working directory: /w/input\r\n", termination: { kind: "exception", summary: `Aras.X: no manifest at /w/input/imports.mf` }, exitCode: 2 }),
    );
    expect(normal.termination).toBe("exception Aras.X: no manifest at <working>/imports.mf");
    expect(normal.exitCode).toBe(2);
  });
});

describe("the normalisations of the 14.35 runs (ticket 76)", () => {
  it("replaces the ISO date-times of the items a server answers with, and the elapsed times of the AML batch mode", () => {
    const log = "Working directory: /w\r\n   AML batch time: 00:00:00.0237003\r\n<created_on>2026-10-20T02:28:25</created_on>\r\n";
    const lines = normalizeLog(log, new Map());
    expect(lines).toContain("   AML batch time: <elapsed>\r");
    expect(lines).toContain("<created_on><time></created_on>\r");
    const messages = normalizeOutcome(outcome({ messages: [{ channel: "status", text: "AML batch time: 00:00:01.5000000 at 2026-10-20T02:28:25" }] })).messages;
    expect(messages).toEqual(["status: AML batch time: <elapsed> at <time>"]);
  });

  it("reads a path below the working directory the same on Windows and POSIX, in the log and in the messages", () => {
    const log = "Working directory: C:\\run\\input\r\nDB updated manifest file path: C:\\run\\input\\manifest.xml\r\n";
    expect(normalizeLog(log, new Map())).toContain("DB updated manifest file path: <working>/manifest.xml\r");
    const posix = normalizeOutcome(
      outcome({ log: "Working directory: /run/input\r\n", messages: [{ channel: "status", text: "Loaded [/run/input/manifest.xml] for release 99.99" }] }),
    ).messages;
    const windows = normalizeOutcome(
      outcome({ log: "Working directory: C:\\run\\input\r\n", messages: [{ channel: "status", text: "Loaded [C:\\run\\input\\manifest.xml] for release 99.99" }] }),
    ).messages;
    expect(windows).toEqual(posix);
    expect(posix).toEqual(["status: Loaded [<working>/manifest.xml] for release 99.99"]);
  });
});

describe("the language-pack temp folder", () => {
  it("is the run's own: the same exception on Windows and POSIX reads alike", () => {
    const windows = normalizeOutcome(
      outcome({ termination: { kind: "exception", summary: "System.IO.DirectoryNotFoundException: Could not find a part of the path 'C:\\Users\\u\\AppData\\Local\\Temp\\LanguagePack_gu3a3hu0.2sw\\Dot\\Import'." } }),
    ).termination;
    const posix = normalizeOutcome(
      outcome({ termination: { kind: "exception", summary: "System.IO.DirectoryNotFoundException: Could not find a part of the path '/tmp/libsjs-parity-lptemp-7CUtiD/LanguagePack_nqfphja5.qtv/Dot/Import'." } }),
    ).termination;
    expect(windows).toBe(posix);
    expect(posix).toBe("exception System.IO.DirectoryNotFoundException: Could not find a part of the path '<lp-temp>/Dot/Import'.");
  });
});

describe("dbPatchIds", () => {
  it("lists, in order, the ids an add asks for and the id the server gave the applied update", () => {
    const row = "1".repeat(32);
    const update = "2".repeat(32);
    const link = "3".repeat(32);
    const calls = [
      { action: "ApplyItem", request: `<Item type="DatabaseUpgrade" action="add" id="${row}" select="id"/>`, response: "" },
      { action: "ApplyUpdate", request: "<Item/>", response: `<Result><Item type="Applied Updates" id="${update}"/></Result>` },
      { action: "ApplyItem", request: `<Item type="DatabaseUpgradePatch" action="add" id="${link}"/>`, response: "" },
      { action: "ApplyItem", request: `<Item type="DatabaseUpgrade" action="edit" id="${row}"/>`, response: "" },
    ];
    expect(dbPatchIds(calls)).toEqual([row, update, link]);
  });
});

describe("the warning for a skipped file, whose path is the run's own", () => {
  it("is the same on the oracle's Windows path and the port's POSIX one, with no header naming the working directory (12.0)", () => {
    const windows = normalizeLog("WARNING: File 'C:\\r\\runs\\x\\input\\P\\Import\\V\\a.xml' doesn't have root tag 'AML/Item'. File is skipped.\r\n", new Map());
    const posix = normalizeLog("WARNING: File '/t/p/input/P/Import/V/a.xml' doesn't have root tag 'AML/Item'. File is skipped.\r\n", new Map());
    expect(windows).toBe(posix);
    expect(posix).toContain("<input>/P/Import/V/a.xml");
  });
});
