import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORT_CASES, hostItems, hostOptions } from "./export-cases.js";
import { CORE_LISTS, EXPORT_CASES_1435 } from "./export-cases-1435.js";
import { SCRATCH_EXPORT_CASES, SCRATCH_EXPORT_CASES_1435, SEED_GROUPS_1435, resolveCase } from "./export-scratch-cases.js";
import { EXPORT_ENGINES, blobsDir, casesDir, isExportEngine } from "./case-engine.js";
import { caseFile, caseReadme, indexReadme, recordedCases, type CaseFile } from "./record-export-cases.js";
import { blobMatchesName, readTranscript } from "./transcript.js";

const DIR = casesDir("14.35", "export");
const BLOBS = blobsDir("14.35", "export");
const readCase = (id: string) => JSON.parse(readFileSync(join(DIR, id, "case.json"), "utf8")) as CaseFile;
const read = (id: string, file: string) => readFileSync(join(DIR, id, file), "utf8");

describe("the case recorders' export engines", () => {
  it("record export cases on 14.0.7, 12.0 and 14.35", () => {
    expect([...EXPORT_ENGINES].sort()).toEqual(["12.0", "14.0.7", "14.35"]);
    expect(isExportEngine("14.35")).toBe(true);
    expect(isExportEngine("13.0")).toBe(false);
    expect(DIR.endsWith("/fixtures/14.35/export")).toBe(true);
  });
});

describe("the 14.35 export case list", () => {
  const ids = [...EXPORT_CASES_1435, ...SCRATCH_EXPORT_CASES_1435].map((c) => c.id);

  it("has unique, folder-safe ids", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("repeats ticket 05's catalogue and the scratch-seeded cases of 14.0.7 under the same ids", () => {
    const own = new Set(EXPORT_CASES_1435.map((c) => c.id));
    for (const c of EXPORT_CASES) expect(own.has(c.id), c.id).toBe(true);
    const scratch = new Set(SCRATCH_EXPORT_CASES_1435.map((c) => c.id));
    for (const c of SCRATCH_EXPORT_CASES) expect(scratch.has(c.id), c.id).toBe(true);
  });

  it("gives every item a type, an id and a package, and keeps a package's items together", () => {
    for (const c of EXPORT_CASES_1435) {
      expect(c.packages.length, c.id).toBeGreaterThan(0);
      const names = c.packages.map((p) => p.name);
      expect(new Set(names).size, c.id).toBe(names.length);
      for (const p of c.packages) {
        expect(p.items.length, c.id).toBeGreaterThan(0);
        for (const i of p.items) {
          expect(i.type, c.id).not.toBe("");
          expect(i.id, c.id).toMatch(/^[0-9A-F]{32}$/);
        }
      }
    }
  });

  it("names the spec rules of every case it adds", () => {
    const catalogue = new Set(EXPORT_CASES.map((c) => c.id));
    for (const c of EXPORT_CASES_1435.filter((x) => !catalogue.has(x.id))) {
      expect(c.rules?.length ?? 0, c.id).toBeGreaterThan(0);
      for (const r of c.rules!) expect(r, c.id).toMatch(/^(EXP|LP)-\d{3}$/);
    }
    for (const g of SEED_GROUPS_1435) {
      for (const c of g.cases.filter((x) => !SCRATCH_EXPORT_CASES.some((y) => y.id === x.id))) {
        expect(c.rules?.length ?? 0, c.id).toBeGreaterThan(0);
      }
    }
  });

  it("uses only the engine options the 14.35 host has", () => {
    expect(hostOptions({ engineAction: "ExportLanguageResourcesOnly", languages: ["*"], cancelAfterStatus: 5 })).toEqual({
      EngineAction: "ExportLanguageResourcesOnly",
      Languages: ["*"],
      CancelAfterStatus: 5,
    });
  });

  it("records the timing-dependent cases three times, with the same input each time", () => {
    for (const base of ["x-cancel-after-5", "x-par-18-lists", "x-par-two-packages"]) {
      const runs = [1, 2, 3].map((n) => EXPORT_CASES_1435.find((c) => c.id === `${base}-run${n}`)!);
      for (const run of runs) expect(run, base).toBeDefined();
      for (const run of runs) {
        expect(run.packages, run.id).toEqual(runs[0]!.packages);
        expect(run.options, run.id).toEqual(runs[0]!.options);
      }
    }
  });

  it("exports the same eighteen Lists in every parallel run", () => {
    expect(CORE_LISTS.length).toBe(18);
    expect(new Set(CORE_LISTS.map((i) => i.id)).size).toBe(18);
  });

  it("passes the 14.35 language modes only through the 14.35 host options", () => {
    for (const c of [...EXPORT_CASES_1435, ...SCRATCH_EXPORT_CASES_1435]) {
      const language = c.options?.engineAction?.startsWith("Export") === true && c.options.engineAction !== "Export";
      if (language && c.expectsError !== true && c.id !== "l1-only-no-list") expect(c.options?.languages?.length ?? 0, c.id).toBeGreaterThan(0);
    }
  });
});

describe("recorded 14.35 export fixtures", () => {
  const plain = EXPORT_CASES_1435;
  const recorded = plain.filter((c) => existsSync(join(DIR, c.id, "case.json")));

  it("records every case in the lists and nothing else", () => {
    const folders = readdirSync(DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "_blobs")
      .map((d) => d.name)
      .sort();
    expect(folders).toEqual([...EXPORT_CASES_1435, ...SCRATCH_EXPORT_CASES_1435].map((c) => c.id).sort());
    expect(recorded.length).toBe(EXPORT_CASES_1435.length);
  });

  it("has an index README that is current", () => {
    expect(read(".", "README.md")).toBe(indexReadme(recordedCases("14.35"), "14.35"));
  });

  it.each(recorded.map((c) => [c.id, c] as const))("%s", (id, c) => {
    // A manager that fails in its constructor (the language checks) never opens the log.
    const names = ["case.json", "README.md", "run.json", "transcript.jsonl", "messages.jsonl", "host.log", ...(c.expectsError === true ? [] : ["engine.log"])];
    for (const name of names) expect(existsSync(join(DIR, id, name)), name).toBe(true);
    const file = readCase(id);
    expect(file.engine).toBe("14.35");
    expect(file).toEqual(caseFile(c, file.result, undefined, "14.35"));
    expect(read(id, "README.md")).toBe(caseReadme(file));
    const run = JSON.parse(read(id, "run.json")) as { engine: string; params: Record<string, unknown> };
    expect(run.engine).toBe("14.35");
    expect(run.params.Items).toEqual(hostItems(c.packages));
    for (const [name, value] of Object.entries(hostOptions(c.options))) expect(run.params[name], name).toEqual(value);
    expect(file.result.error !== null, "error").toBe(c.expectsError === true);
    if (c.expectsError !== true) expect(existsSync(join(DIR, id, "output", "imports.mf")), "imports.mf").toBe(true);

    const calls = readTranscript(join(DIR, id, "transcript.jsonl"), BLOBS);
    expect(calls.length).toBe(file.result.calls);
    for (const call of calls) expect(typeof call.response === "string" || call.error !== undefined).toBe(true);
  });

  it("names each blob by the sha256 of its content, and every blob is used", () => {
    const used = new Set<string>();
    for (const c of recordedCases("14.35")) {
      for (const line of read(c.id, "transcript.jsonl").split("\n")) {
        if (line === "") continue;
        const call = JSON.parse(line) as { responseBlob?: string };
        if (call.responseBlob !== undefined) used.add(call.responseBlob);
      }
    }
    const blobs = readdirSync(BLOBS).map((f) => f.replace(/\.xml$/, ""));
    expect(blobs.sort()).toEqual([...used].sort());
    for (const sha of blobs) expect(blobMatchesName(BLOBS, sha), sha).toBe(true);
  });
});

describe("recorded 14.35 scratch-seeded export fixtures", () => {
  const scratch = SCRATCH_EXPORT_CASES_1435;

  it("records every case in the list", () => {
    for (const c of scratch) expect(existsSync(join(DIR, c.id, "case.json")), c.id).toBe(true);
  });

  it.each(scratch.map((c) => [c.id, c] as const))("%s", (id, c) => {
    const file = readCase(id);
    const group = SEED_GROUPS_1435.find((g) => g.cases.includes(c))!;
    expect(file.engine).toBe("14.35");
    expect(file.seed?.group).toBe(group.id);
    expect(file).toEqual(caseFile({ ...resolveCase(c, file.seed!.steps.flatMap((s) => s.created)) }, file.result, file.seed, "14.35"));
    expect(read(id, "README.md")).toBe(caseReadme(file));
    const created = file.seed!.steps.flatMap((s) => s.created);
    expect(created.length).toBeGreaterThan(0);
    const deleted = new Set(file.seed!.deleted.map((d) => `${d.type}:${d.id}`));
    for (const item of created) expect(deleted.has(`${item.type}:${item.id}`), `${item.type} ${item.id} was deleted`).toBe(true);
    const run = JSON.parse(read(id, "run.json")) as { engine: string; params: { Items: string[] } };
    expect(run.engine).toBe("14.35");
    expect(run.params.Items).toEqual(hostItems(file.packages));
    expect(file.result.error !== null, "error").toBe(c.expectsError === true);
    const calls = readTranscript(join(DIR, id, "transcript.jsonl"), BLOBS);
    expect(calls.length).toBe(file.result.calls);
  });
});

/** EXP-558: what two runs of 14.35 agree on, and what is a set. */
describe("the parallel and cancel runs agree where EXP-558 says they must", () => {
  const lines = (id: string): string[] => read(id, "engine.log").split("\r\n");
  const stamp = (line: string) => line.replace(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/, "<T>");
  /** The header of EXP-506 minus the lines that name the run's folders. */
  const header = (id: string) =>
    lines(id)
      .slice(0, lines(id).findIndex((l) => l.includes("****Export")))
      .filter((l) => !/^(Log file|Working directory):/.test(l));
  /** The lines of a package between its 'start of execution' and 'end of execution', as a sorted multiset. */
  const body = (id: string) => lines(id).filter((l) => l.startsWith("Item id :")).sort();
  const fixedLines = (id: string) => lines(id).filter((l) => l.includes("****Export") || l.startsWith("start of execution")).map(stamp);
  const manifest = (id: string) => read(id, "output/imports.mf");
  const messages = (id: string) => read(id, "messages.jsonl").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as { channel: string; text: string });
  const files = (id: string): string[] =>
    (readdirSync(join(DIR, id, "output"), { recursive: true, withFileTypes: true }) as { isFile(): boolean; parentPath: string; name: string }[])
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name).slice(join(DIR, id, "output").length))
      .sort();

  const runs = (base: string) => [1, 2, 3].map((n) => `${base}-run${n}`);
  const bases = ["x-par-18-lists", "x-par-two-packages", "x-cancel-after-5"];

  it.each(bases)("%s: header, package lines and manifest are fixed", (base) => {
    if (!existsSync(join(DIR, `${base}-run1`, "case.json"))) return;
    const [a, ...rest] = runs(base);
    for (const other of rest) {
      expect(header(other), other).toEqual(header(a!));
      expect(fixedLines(other), other).toEqual(fixedLines(a!));
      expect(manifest(other), other).toBe(manifest(a!));
      const packages = (id: string) => messages(id).filter((m) => m.channel === "currentPackage").map((m) => m.text);
      expect(packages(other), other).toEqual(packages(a!));
    }
  });

  it.each(["x-par-18-lists", "x-par-two-packages"])("%s: every item succeeds, as a set of lines and of files", (base) => {
    if (!existsSync(join(DIR, `${base}-run1`, "case.json"))) return;
    const [a, ...rest] = runs(base);
    for (const other of rest) {
      expect(body(other), other).toEqual(body(a!));
      expect(files(other), other).toEqual(files(a!));
      // The status texts name each item once, in any order and with any index (EXP-552, EXP-553).
      const items = (id: string) => [...new Set(messages(id).filter((m) => m.channel === "status").map((m) => m.text.replace(/^Item \d+ of /, "")))].sort();
      expect(items(other).filter((t) => t !== "completed").length, other).toBeGreaterThan(0);
    }
    expect(body(a!).length).toBeGreaterThan(0);
    for (const l of body(a!)) expect(l).toMatch(/successfully exported$/);
  });

  it("x-par-18-lists: a run writes all eighteen files, and the status index is a counter, not the item number (EXP-552)", () => {
    if (!existsSync(join(DIR, "x-par-18-lists-run1", "case.json"))) return;
    for (const id of runs("x-par-18-lists")) {
      expect(files(id).filter((f) => f.endsWith(".xml")).length, id).toBe(18);
      expect(body(id).length, id).toBe(18);
    }
  });

  it("x-cancel-after-5: the cancel pair is written once or more, and the run ends normally (EXP-557)", () => {
    if (!existsSync(join(DIR, "x-cancel-after-5-run1", "case.json"))) return;
    for (const id of runs("x-cancel-after-5")) {
      const cancelled = lines(id).filter((l) => l === "Export was canceled by user").length;
      expect(cancelled, id).toBeGreaterThan(0);
      expect(messages(id).filter((m) => m.text === "Export was canceled by user").length, id).toBeGreaterThan(0);
      expect(readCase(id).result.error, id).toBeNull();
    }
  });

  it("x-abort-*: the first failure is reported and no more is (EXP-555, EXP-572)", () => {
    for (const id of ["x-abort-middle-no", "x-abort-middle-yes", "x-abort-two-failures"]) {
      if (!existsSync(join(DIR, id, "case.json"))) continue;
      expect(messages(id).filter((m) => m.channel === "errorQuestion").length, id).toBe(1);
      expect(lines(id).filter((l) => l.startsWith("Error of exporting Item")).length, id).toBe(1);
    }
    if (existsSync(join(DIR, "x-abort-middle-no", "case.json"))) {
      // The answer is never read (EXP-571): both answers end the same way.
      const no = messages("x-abort-middle-no").map((m) => m.channel);
      const yes = messages("x-abort-middle-yes").map((m) => m.channel);
      expect(no.filter((c) => c === "errorQuestion")).toEqual(yes.filter((c) => c === "errorQuestion"));
      expect(lines("x-abort-middle-no").some((l) => l.startsWith("end of execution")), "no").toBe(true);
    }
  });
});
