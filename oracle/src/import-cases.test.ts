import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { IMPORT_ENGINES, blobsDir, casesDir, type ImportEngine } from "./case-engine.js";
import { IMPORT_CASES, casesFor, expectedOutcome, hostOptions } from "./import-cases.js";
import { exportBytes, manifestText, sid, writePackages, type ScratchPackage } from "./import-packages.js";
import { PROPERTY_WHERE } from "./import-packages-14.35.js";
import { caseFile, caseReadme, expectText, expectedReturn, indexReadme, outcomeMatches, returnedValue, type CaseFile } from "./record-import-cases.js";
import { manifestPackageNames } from "./record.js";
import { blobMatchesName } from "./transcript.js";

const allPackages = (): { id: string; step: string; pkg: ScratchPackage }[] =>
  IMPORT_CASES.flatMap((c) => c.steps.flatMap((s) => s.packages.map((pkg) => ({ id: c.id, step: s.name, pkg }))));

const SCRATCH = /^LIBSJS[-_]SCRATCH[-_]/;

/** Every file of a built tree, relative, with its bytes. */
function tree(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(relative(dir, path).split("\\").join("/"), readFileSync(path).toString("latin1"));
    }
  };
  walk(dir);
  return files;
}

describe("the import case list", () => {
  it("has unique, folder-safe ids and at least one step each", () => {
    const ids = IMPORT_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of IMPORT_CASES) {
      expect(c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.steps.length, c.id).toBeGreaterThan(0);
    }
  });

  it("records a case on every engine unless it names its engines, and the 12.0-only cases pin one variant rule each", () => {
    const only12 = IMPORT_CASES.filter((c) => c.engines?.includes("12.0") === true);
    expect(only12.map((c) => c.id)).toEqual(["r11-ac-attribute-actions", "r15-latin1-file", "r15-utf16-no-bom"]);
    for (const c of only12) {
      expect(c.engines, c.id).toEqual(["12.0"]);
      expect(c.id, c.id).toMatch(/^r\d+-/);
      expect(casesFor("14.0.7").map((x) => x.id), c.id).not.toContain(c.id);
      expect(casesFor("12.0").map((x) => x.id), c.id).toContain(c.id);
    }
    const only35 = IMPORT_CASES.filter((c) => c.engines?.includes("14.35") === true);
    for (const c of only35) {
      expect(c.engines, c.id).toEqual(["14.35"]);
      expect(casesFor("14.0.7").map((x) => x.id), c.id).not.toContain(c.id);
      expect(casesFor("12.0").map((x) => x.id), c.id).not.toContain(c.id);
    }
    expect(only35.length).toBeGreaterThan(0);
    expect(casesFor("14.0.7")).toHaveLength(IMPORT_CASES.length - only12.length - only35.length);
    expect(casesFor("14.35")).toHaveLength(IMPORT_CASES.length - only12.length);
  });

  it("takes the 14.35 outcome of the cancel case from expectOn", () => {
    const cancel = IMPORT_CASES.find((c) => c.id === "s0-mini-cancel")!;
    expect(expectedOutcome(cancel.steps[0]!, "14.0.7")).toBe("success");
    expect(expectedOutcome(cancel.steps[0]!, "14.35")).toBe("engine-failure");
    expect(cancel.exercisesOn?.["14.35"]).toContain("OperationCanceledException");
  });

  it("takes a step's expected outcome per engine", () => {
    expect(expectedOutcome({ expect: "success" }, "12.0")).toBe("success");
    expect(expectedOutcome({ expect: "success", expectOn: { "12.0": "engine-failure" } }, "12.0")).toBe("engine-failure");
    expect(expectedOutcome({ expect: "success", expectOn: { "12.0": "engine-failure" } }, "14.0.7")).toBe("success");
  });

  it("imports scratch packages only: every package, file and top-level item name carries the scratch prefix", () => {
    for (const { id, pkg } of allPackages()) {
      expect(pkg.name, id).toMatch(/^LIBSJS-SCRATCH-/);
      for (const f of pkg.files) {
        expect(f.file, `${id} ${pkg.name}`).toMatch(/^LIBSJS-SCRATCH-/);
        if (typeof f.content !== "string") continue;
        // Top-level item names: a `name` child of an Item that is a direct child of AML.
        for (const m of f.content.matchAll(/^ <Item\b[^\n]*>\n(?: {2}[^\n]*\n)*? {2}<name>([^<]*)<\/name>/gm)) {
          expect(m[1], `${id} ${f.file}`).toMatch(SCRATCH);
        }
      }
    }
  });

  it("addresses every delete by id or by a scratch ItemType, never by an open `where`", () => {
    const ids = new Set<string>();
    for (const { pkg } of allPackages()) for (const f of pkg.files) if (typeof f.content === "string") for (const m of f.content.matchAll(/ id="([0-9A-F]{32})"/g)) ids.add(m[1]!);
    for (const { id, pkg } of allPackages()) {
      for (const f of pkg.files) {
        if (typeof f.content !== "string") continue;
        for (const m of f.content.matchAll(/where="([^"]*)"/g)) {
          const where = m[1]!;
          if (where === PROPERTY_WHERE) {
            // The delayed Property edit of IMP-220: scoped to a scratch ItemType's id and one property name.
            expect(where, `${id} ${f.file}`).toMatch(/^\[Property\]\.source_id='[0-9A-F]{32}' AND \[Property\]\.name='ref'$/);
            continue;
          }
          const view = /^source_id='([0-9A-F]{32})'$/.exec(where);
          const form = /^name='(LIBSJS_SCRATCH_[A-Za-z0-9_]+)'$/.exec(where);
          expect(view !== null ? ids.has(view[1]!) : form !== null, `${id} ${f.file}: where="${where}"`).toBe(true);
        }
        for (const m of f.content.matchAll(/<Item [^>]*action="delete"[^>]*>/g)) {
          // The where clauses are checked above; a delete without one must name an id.
          expect(/ id="[0-9A-F]{32}"| where="/.test(m[0]), `${id} ${f.file}: ${m[0]}`).toBe(true);
        }
      }
    }
  });

  it("writes a manifest whose package names are the step's packages", () => {
    for (const c of IMPORT_CASES) {
      for (const s of c.steps) {
        expect(manifestPackageNames(manifestText(s.packages)), c.id).toEqual(s.packages.map((p) => p.name));
        for (const name of s.only ?? []) expect(name, c.id).toMatch(/^LIBSJS-SCRATCH-/);
      }
    }
  });

  it("gives every cancel, lock and version step a step before it to act on", () => {
    for (const c of IMPORT_CASES) {
      c.steps.forEach((s, i) => {
        if (s.options?.lockUpgradeRows === true || s.options?.versionBefore !== undefined) expect(i, c.id).toBeGreaterThan(0);
      });
    }
  });

  it("maps options to host parameters, leaving the rest at the engine default", () => {
    expect(hostOptions(undefined)).toEqual({});
    expect(
      hostOptions(
        {
          merge: true,
          fast: true,
          vault: true,
          verbose: true,
          release: "R",
          description: "D",
          cancelAfterStatus: 4,
          lockUpgradeRows: true,
          versionBefore: [{ type: "Method", id: "AB" }],
          languages: ["de", "*"],
          amlBatch: { maxSize: 3 },
          collectErrors: { maxCount: 0 },
        },
        ["P", "P"],
      ),
    ).toEqual({
      Merge: true,
      Fast: true,
      Vault: true,
      ContextVerbose: true,
      Release: "R",
      Description: "D",
      CancelAfterStatus: 4,
      LockUpgradeRows: true,
      VersionBefore: ["Method\tAB"],
      Languages: ["de", "*"],
      AmlBatchMode: true,
      AmlBatchMaxSize: 3,
      CollectImportErrors: true,
      CollectImportErrorsMaxCount: 0,
      Packages: ["P", "P"],
    });
  });
});

describe("the scratch packages", () => {
  it("get stable 32-hex ids", () => {
    expect(sid("BASE:List_1")).toMatch(/^[0-9A-F]{32}$/);
    expect(sid("BASE:List_1")).toBe(sid("BASE:List_1"));
    expect(sid("BASE:List_1")).not.toBe(sid("BASE:List_2"));
  });

  it("are written the way the export writes files: BOM, CRLF, no trailing newline", () => {
    const bytes = exportBytes("<AML>\n <Item />\n</AML>\n");
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString("utf8")).toBe("\ufeff<AML>\r\n <Item />\r\n</AML>");
  });

  it("build into the same files each time", () => {
    const a = mkdtempSync(join(tmpdir(), "import-pkg-a-"));
    const b = mkdtempSync(join(tmpdir(), "import-pkg-b-"));
    try {
      for (const c of IMPORT_CASES) {
        const step = c.steps[0]!;
        writePackages(join(a, c.id), step.packages);
        writePackages(join(b, c.id), step.packages);
        expect(tree(join(a, c.id))).toEqual(tree(join(b, c.id)));
      }
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});

describe("outcomes", () => {
  it("reads the return value from the host's result text", () => {
    expect(returnedValue("ImportSolutions returned 0")).toBe(0);
    expect(returnedValue("ImportSolutions returned 1")).toBe(1);
    expect(returnedValue(null)).toBeNull();
    expect(returnedValue("exported")).toBeNull();
  });

  it("matches a step against what its case expects", () => {
    expect(outcomeMatches("success", { hostExit: 0, returned: 0, error: null })).toBe(true);
    expect(outcomeMatches("success", { hostExit: 0, returned: 1, error: null })).toBe(false);
    expect(outcomeMatches("engine-failure", { hostExit: 0, returned: 1, error: null })).toBe(true);
    expect(outcomeMatches("engine-failure", { hostExit: 2, returned: null, error: "boom" })).toBe(false);
    expect(outcomeMatches("returned:2", { hostExit: 0, returned: 2, error: null })).toBe(true);
    expect(outcomeMatches("returned:2", { hostExit: 0, returned: 1, error: null })).toBe(false);
    expect(outcomeMatches("refused", { hostExit: 2, returned: null, error: "System.Exception" })).toBe(true);
    expect(outcomeMatches("refused", { hostExit: 0, returned: 0, error: null })).toBe(false);
  });

  it("names each outcome's return value and README text", () => {
    expect(expectedReturn("success")).toBe(0);
    expect(expectedReturn("engine-failure")).toBe(1);
    expect(expectedReturn("returned:3")).toBe(3);
    expect(expectText("returned:2")).toBe("2 errors collected (2)");
    expect(expectText("refused")).toBe("constructor refused (exception)");
  });
});

describe.each(IMPORT_ENGINES)("the recorded %s import fixtures", (engine: ImportEngine) => {
  const CASES_DIR = casesDir(engine, "import");
  const BLOBS_DIR = blobsDir(engine, "import");
  const recorded = casesFor(engine).filter((c) => existsSync(join(CASES_DIR, c.id, "case.json")));
  const read = (id: string) => JSON.parse(readFileSync(join(CASES_DIR, id, "case.json"), "utf8")) as CaseFile;

  it("covers every case in the list", () => {
    expect(recorded.map((c) => c.id)).toEqual(casesFor(engine).map((c) => c.id));
  });

  it.each(recorded.map((c) => [c.id, c] as const))("%s: ran as its case says and cleaned up", (id, c) => {
    const file = read(id);
    expect(file.steps).toHaveLength(c.steps.length);
    file.steps.forEach((s, i) => {
      expect(outcomeMatches(expectedOutcome(c.steps[i]!, engine), s.result), `${id} step ${i + 1}`).toBe(true);
      expect(existsSync(join(CASES_DIR, id, `step-${i + 1}`, "transcript.jsonl"))).toBe(true);
      expect(existsSync(join(CASES_DIR, id, `step-${i + 1}`, "input", "imports.mf"))).toBe(true);
    });
    // Everything the steps created that still existed at the end was deleted by the last step's cleanup.
    const created = file.steps.flatMap((s) => s.result.created.map((x) => x.id));
    const deleted = new Set(file.deleted.map((x) => x.id));
    for (const x of deleted) expect(created, `${id}: deleted ${x} was never created`).toContain(x);
  });

  it.each(recorded.map((c) => [c.id, c] as const))("%s: the README and case.json are what the case list and the run records generate", (id, c) => {
    const file = read(id);
    const again = caseFile(c, file.steps.map((s) => s.result), file.deleted, engine);
    expect(file).toEqual(again);
    expect(readFileSync(join(CASES_DIR, id, "README.md"), "utf8")).toBe(caseReadme(again));
  });

  it.each(recorded.map((c) => [c.id, c] as const))("%s: each step's input is what the package builder writes", (id, c) => {
    const dir = mkdtempSync(join(tmpdir(), "import-input-"));
    try {
      c.steps.forEach((s, i) => {
        writePackages(join(dir, String(i)), s.packages);
        expect(tree(join(CASES_DIR, id, `step-${i + 1}`, "input")), `${id} step ${i + 1}`).toEqual(tree(join(dir, String(i))));
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("indexes every recorded case", () => {
    if (recorded.length === 0) return;
    expect(readFileSync(join(CASES_DIR, "README.md"), "utf8")).toBe(indexReadme(recorded.map((c) => read(c.id)), engine));
  });

  it("names each blob by the sha256 of its content, and every blob is used", () => {
    if (!existsSync(BLOBS_DIR)) return;
    const used = new Set<string>();
    for (const c of recorded) {
      c.steps.forEach((_s, i) => {
        const text = readFileSync(join(CASES_DIR, c.id, `step-${i + 1}`, "transcript.jsonl"), "utf8");
        for (const line of text.split("\n").filter((l) => l !== "")) {
          const call = JSON.parse(line) as { responseBlob?: string };
          if (call.responseBlob !== undefined) used.add(call.responseBlob);
        }
      });
    }
    const blobs = readdirSync(BLOBS_DIR).filter((f) => statSync(join(BLOBS_DIR, f)).isFile()).map((f) => f.replace(/\.xml$/, ""));
    expect(blobs.sort()).toEqual([...used].sort());
    for (const sha of blobs) expect(blobMatchesName(BLOBS_DIR, sha), sha).toBe(true);
  });
});
