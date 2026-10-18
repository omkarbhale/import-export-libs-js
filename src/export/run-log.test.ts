import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ArasVersion } from "../client/version.js";
import { SUExportContext } from "./export-context.js";
import { RunLog, formatWithArgs, invariantDateTime, logInputParameters } from "./run-log.js";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const folder = (): string => {
  const root = mkdtempSync(join(tmpdir(), "libsjs-log-"));
  roots.push(root);
  return root;
};

describe("the log writer (EXP-505)", () => {
  it("creates the file on open, appends, ends lines with CRLF and writes UTF-8 without a BOM when it is disposed", () => {
    const path = join(folder(), "engine.log");
    const log = RunLog.open(path);
    expect(existsSync(path)).toBe(true);
    log.writeLine("first ä");
    log.writeLine();
    expect(readFileSync(path, "utf8")).toBe("");
    log.dispose();
    log.dispose();
    expect(readFileSync(path)).toEqual(Buffer.from("first ä\r\n\r\n", "utf8"));

    const again = RunLog.open(path);
    again.writeLine("second\nline");
    again.dispose();
    expect(readFileSync(path, "utf8")).toBe("first ä\r\n\r\nsecond\nline\r\n");
  });

  it("fails like a StreamWriter for a null path, an empty path and a missing folder", () => {
    expect(() => RunLog.open(null)).toThrow(/Value cannot be null\.\r\nParameter name: path/);
    expect(() => RunLog.open("")).toThrow("Empty path name is not legal.");
    expect(() => RunLog.open(join(folder(), "missing", "engine.log"))).toThrow(/Could not find a part of the path/);
  });

  it("refuses a second writer on a file that is open, and accepts one after it is closed (EXP-541)", () => {
    const path = join(folder(), "engine.log");
    const first = RunLog.open(path);
    expect(() => RunLog.open(path)).toThrow(/^The process cannot access the file '.*engine\.log' because it is being used by another process\.$/);
    first.dispose();
    const second = RunLog.open(path);
    second.dispose();
  });

  it("keeps what an earlier run wrote in front", () => {
    const path = join(folder(), "engine.log");
    writeFileSync(path, "earlier\r\n");
    const log = RunLog.open(path);
    log.writeLine("now");
    log.dispose();
    expect(readFileSync(path, "utf8")).toBe("earlier\r\nnow\r\n");
  });
});

describe("the log's date-time and header (EXP-505, EXP-506)", () => {
  it("writes the local time as MM/dd/yyyy HH:mm:ss", () => {
    expect(invariantDateTime(new Date(2026, 9, 18, 5, 22, 16))).toBe("10/18/2026 05:22:16");
    expect(invariantDateTime(new Date(2026, 0, 2, 13, 4, 5))).toBe("01/02/2026 13:04:05");
  });

  it("formats a bool as True or False and nothing for null", () => {
    expect(formatWithArgs("{0}|{1}|{2}|{3}", true, false, null, "x")).toBe("True|False||x");
  });

  it("builds the header of the settings, the server's version in its full form, and ends with the last line's CRLF", () => {
    const context = new SUExportContext();
    Object.assign(context, { url: "http://h/", dataBase: "db", userName: "u", logFilePath: "L", workingDirectory: "W", level: "2", useImport: true, exportReferencedItems: true });
    context.refToUnknownPacks = "RemoveWithWarning";
    expect(logInputParameters(context, new ArasVersion(12, 0, 9, 24090, 0), "14.0.7")).toBe(
      [
        "Tool version: 14.0.7.35492",
        "Action: Export",
        "Manifest file: ",
        "Log file: L",
        "Working directory: W",
        "URL: http://h/",
        "Database: db",
        "User: u",
        "Innovator version: 12.0 SP9 Build 24090",
        "Language pack: ",
        "Language pack name: ",
        "Export referenced items: True",
        "Export unknown packages action: RemoveWithWarning",
        "Export level: 2",
        "Export using import structure: True",
        "",
      ].join("\r\n"),
    );
  });
});
