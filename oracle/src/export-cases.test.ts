import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORT_CASES, hostItems, hostOptions } from "./export-cases.js";
import { SCRATCH_EXPORT_CASES } from "./export-scratch-cases.js";
import { CASE_ENGINES, blobsDir, casesDir, type CaseEngine } from "./case-engine.js";
import { caseFile, caseReadme, indexReadme, recordedCases, type CaseFile } from "./record-export-cases.js";
import { BLOB_THRESHOLD, blobMatchesName, externalizeLargeResponses, readTranscript } from "./transcript.js";


describe("the 14.0.7 export case list", () => {
  it("has unique, folder-safe ids", () => {
    const ids = EXPORT_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("gives every item a type, a 32-hex id and a package", () => {
    for (const c of EXPORT_CASES) {
      expect(c.packages.length, c.id).toBeGreaterThan(0);
      for (const p of c.packages) {
        expect(p.name, c.id).not.toBe("");
        expect(p.items.length, c.id).toBeGreaterThan(0);
        for (const i of p.items) {
          expect(i.type, c.id).not.toBe("");
          expect(i.id, c.id).toMatch(/^[0-9A-F]{32}$/);
        }
      }
    }
  });

  it("keeps a package's items together, so the insertion order is the list order", () => {
    for (const c of EXPORT_CASES) {
      const names = c.packages.map((p) => p.name);
      expect(new Set(names).size, c.id).toBe(names.length);
    }
  });

  it("builds the host's tab-separated item specs in insertion order", () => {
    const c = EXPORT_CASES.find((x) => x.id === "p1-order-cui-core-admin")!;
    expect(hostItems(c.packages).map((s) => s.split("\t")[0])).toEqual([
      "com.aras.innovator.cui",
      "com.aras.innovator.core",
      "com.aras.innovator.admin",
    ]);
  });

  it("maps options to host parameters, leaving the rest at the engine default", () => {
    expect(hostOptions(undefined)).toEqual({});
    expect(
      hostOptions({ level: "", refToUnknownPacks: "RemoveWithWarning", exportReferencedItems: true, timeout: -1, errorQuestionAnswer: "yes" }),
    ).toEqual({
      Level: "",
      RefToUnknownPacks: "RemoveWithWarning",
      ExportReferencedItems: true,
      Timeout: -1,
      ErrorQuestionAnswer: "yes",
    });
  });
});

describe.each(CASE_ENGINES)("recorded %s export fixtures", (engine: CaseEngine) => {
  const CASES_DIR = casesDir(engine, "export");
  const BLOBS_DIR = blobsDir(engine, "export");
  const readCase = (id: string) => JSON.parse(readFileSync(join(CASES_DIR, id, "case.json"), "utf8")) as CaseFile;
  const recorded = EXPORT_CASES.filter((c) => existsSync(join(CASES_DIR, c.id, "case.json")));

  it("records every case in the list and nothing else", () => {
    const folders = readdirSync(CASES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "_blobs")
      .map((d) => d.name)
      .sort();
    // The scratch-seeded cases are recorded by oracle:export-scratch-cases and checked in export-scratch-cases.test.ts.
    expect(folders).toEqual([...EXPORT_CASES, ...SCRATCH_EXPORT_CASES].map((c) => c.id).sort());
    expect(recorded.length).toBe(EXPORT_CASES.length);
  });

  it("has an index README that is current", () => {
    expect(readFileSync(join(CASES_DIR, "README.md"), "utf8")).toBe(indexReadme(recordedCases(engine), engine));
  });

  it.each(recorded.map((c) => [c.id, c] as const))("%s", (id, c) => {
    const dir = join(CASES_DIR, id);
    for (const name of ["case.json", "README.md", "run.json", "transcript.jsonl", "messages.jsonl", "engine.log", "host.log"]) {
      expect(existsSync(join(dir, name)), name).toBe(true);
    }
    expect(existsSync(join(dir, "output", "imports.mf")), "imports.mf").toBe(true);

    // The input and its Hashtable insertion order are recorded twice, and must agree with the list.
    const file = readCase(id);
    expect(file).toEqual(caseFile(c, file.result, undefined, engine));
    const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as { engine: string; params: { Items: string[] } };
    expect(run.engine).toBe(engine);
    expect(run.params.Items).toEqual(hostItems(c.packages));
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe(caseReadme(file));

    expect(file.result.error !== null, "error").toBe(c.expectsError === true);

    const calls = readTranscript(join(dir, "transcript.jsonl"), BLOBS_DIR);
    expect(calls.length).toBe(file.result.calls);
    calls.forEach((call, n) => {
      expect(call.seq, "seq").toBeGreaterThan(0);
      expect(typeof call.response === "string" || call.error !== undefined, `call ${n + 1} has a response or an error`).toBe(true);
    });
  });

  it("names each blob by the sha256 of its content, and every blob is used", () => {
    const used = new Set<string>();
    for (const c of [...recorded, ...SCRATCH_EXPORT_CASES]) {
      for (const line of readFileSync(join(CASES_DIR, c.id, "transcript.jsonl"), "utf8").split("\n")) {
        if (line === "") continue;
        const call = JSON.parse(line) as { responseBlob?: string };
        if (call.responseBlob !== undefined) used.add(call.responseBlob);
      }
    }
    const blobs = readdirSync(BLOBS_DIR).map((f) => f.replace(/\.xml$/, ""));
    expect(blobs.sort()).toEqual([...used].sort());
    for (const sha of blobs) expect(blobMatchesName(BLOBS_DIR, sha), sha).toBe(true);
  });
});

describe("large transcript responses", () => {
  it("moves them to blobs and reads them back unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "libsjs-transcript-"));
    const big = `<Result>${"x".repeat(BLOB_THRESHOLD)}</Result>`;
    const small = `{"seq":1,"action":"ApplyItem","request":"<a/>","response":"<ok/>"}`;
    const file = join(dir, "transcript.jsonl");
    writeFileSync(file, `${small}\n${JSON.stringify({ seq: 2, action: "ApplyItem", request: "<b/>", response: big })}\n`);
    expect(externalizeLargeResponses(file, join(dir, "blobs"))).toBe(1);
    const text = readFileSync(file, "utf8");
    expect(text.split("\n")[0]).toBe(small);
    expect(text).not.toContain("xxxx");
    const calls = readTranscript(file, join(dir, "blobs"));
    expect(calls.map((c) => c.response)).toEqual(["<ok/>", big]);
  });
});
