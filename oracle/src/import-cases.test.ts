import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { IMPORT_CASES, hostOptions } from "./import-cases.js";
import { exportBytes, manifestText, sid, writePackages, type ScratchPackage } from "./import-packages.js";
import { BLOBS_DIR, CASES_DIR, caseFile, caseReadme, indexReadme, outcomeMatches, returnedValue, type CaseFile } from "./record-import-cases.js";
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

describe("the 14.0.7 import case list", () => {
  it("has unique, folder-safe ids and at least one step each", () => {
    const ids = IMPORT_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of IMPORT_CASES) {
      expect(c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.steps.length, c.id).toBeGreaterThan(0);
    }
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
        { merge: true, fast: true, vault: true, verbose: true, release: "R", description: "D", cancelAfterStatus: 4, lockUpgradeRows: true, versionBefore: [{ type: "Method", id: "AB" }] },
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
  });
});

describe("the recorded 14.0.7 import fixtures", () => {
  const recorded = IMPORT_CASES.filter((c) => existsSync(join(CASES_DIR, c.id, "case.json")));
  const read = (id: string) => JSON.parse(readFileSync(join(CASES_DIR, id, "case.json"), "utf8")) as CaseFile;

  it("covers every case in the list", () => {
    expect(recorded.map((c) => c.id)).toEqual(IMPORT_CASES.map((c) => c.id));
  });

  it.each(recorded.map((c) => [c.id, c] as const))("%s: ran as its case says and cleaned up", (id, c) => {
    const file = read(id);
    expect(file.steps).toHaveLength(c.steps.length);
    file.steps.forEach((s, i) => {
      expect(outcomeMatches(c.steps[i]!.expect, s.result), `${id} step ${i + 1}`).toBe(true);
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
    const again = caseFile(c, file.steps.map((s) => s.result), file.deleted);
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
    expect(readFileSync(join(CASES_DIR, "README.md"), "utf8")).toBe(indexReadme(recorded.map((c) => read(c.id))));
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
