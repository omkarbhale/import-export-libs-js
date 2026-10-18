import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORT_CASES, hostItems } from "./export-cases.js";
import { SCRATCH_EXPORT_CASES, SEED_GROUPS, resolveCase, resolveItem } from "./export-scratch-cases.js";
import { writePackages } from "./import-packages.js";
import { CASE_ENGINES, blobsDir, casesDir, type CaseEngine } from "./case-engine.js";
import { caseFile, caseReadme, type CaseFile } from "./record-export-cases.js";
import { readTranscript } from "./transcript.js";

const SCRATCH = /^(LIBSJS[-_]SCRATCH[-_]|xp-libsjs_scratch_)/i;

describe("the scratch-seeded export case list", () => {
  it("has unique, folder-safe ids that do not clash with the stock cases", () => {
    const ids = SCRATCH_EXPORT_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(EXPORT_CASES.some((c) => c.id === id), id).toBe(false);
    }
    expect(SEED_GROUPS.map((g) => g.id).sort()).toEqual(["s2-ref", "s6-special", "s7-xprop", "s8-coll"]);
  });

  it("seeds scratch packages only: every package, file and top-level item name carries the scratch prefix", () => {
    for (const g of SEED_GROUPS) {
      expect(g.steps.length, g.id).toBeGreaterThan(0);
      for (const s of g.steps) {
        expect(s.expect, `${g.id} ${s.name}`).toBe("success");
        for (const pkg of s.packages) {
          expect(pkg.name, g.id).toMatch(/^LIBSJS-SCRATCH-/);
          for (const f of pkg.files) {
            expect(f.file, `${g.id} ${pkg.name}`).toMatch(/^LIBSJS-SCRATCH-/);
            if (typeof f.content !== "string") continue;
            for (const m of f.content.matchAll(/^ <Item\b[^\n]*>\n(?: {2}[^\n]*\n)*? {2}<name>([^<]*)<\/name>/gm)) {
              expect(m[1], `${g.id} ${f.file}`).toMatch(SCRATCH);
            }
          }
        }
      }
    }
  });

  it("writes the same bytes every time a seed is built", () => {
    for (const g of SEED_GROUPS) {
      for (const s of g.steps) {
        const a = mkdtempSync(join(tmpdir(), "libsjs-seed-a-"));
        const b = mkdtempSync(join(tmpdir(), "libsjs-seed-b-"));
        writePackages(a, s.packages);
        writePackages(b, s.packages);
        const walk = (d: string): string[] => readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(d.length));
        expect(walk(a), `${g.id} ${s.name}`).toEqual(walk(b));
        for (const f of walk(a)) expect(readFileSync(join(a, f)).equals(readFileSync(join(b, f))), f).toBe(true);
      }
    }
  });

  it("exports only items of the packages its group seeds, and names them by scratch names", () => {
    for (const g of SEED_GROUPS) {
      const seeded = new Set(g.steps.flatMap((s) => s.packages.map((p) => p.name)));
      for (const c of g.cases) {
        expect(c.packages.length, c.id).toBeGreaterThan(0);
        for (const p of c.packages) {
          expect(seeded.has(p.name), `${c.id}: ${p.name}`).toBe(true);
          expect(p.items.length, c.id).toBeGreaterThan(0);
          for (const i of p.items) {
            expect(i.keyedName, c.id).toMatch(SCRATCH);
            if (typeof i.id === "string") expect(i.id, c.id).toMatch(/^[0-9A-F]{32}$/);
          }
        }
      }
    }
  });

  it("resolves an item the server gave a new id to the created item of that type, in creation order", () => {
    const created = [
      { type: "PackageDefinition", id: "A".repeat(32) },
      { type: "mp_MacPolicy", id: "B".repeat(32) },
      { type: "mp_MacPolicy", id: "C".repeat(32) },
    ];
    expect(resolveItem({ type: "mp_MacPolicy", keyedName: "x", id: { created: 1 } }, created)).toBe("C".repeat(32));
    expect(resolveItem({ type: "mp_MacPolicy", keyedName: "x", id: "D".repeat(32) }, created)).toBe("D".repeat(32));
    expect(() => resolveItem({ type: "mp_MacPolicy", keyedName: "x", id: { created: 2 } }, created)).toThrow(/no number 2/);
    expect(() => resolveItem({ type: "List", keyedName: "x", id: { created: 0 } }, created)).toThrow(/created 0 List/);
    const c = SCRATCH_EXPORT_CASES.find((x) => x.id === "s6-mac-two-filters")!;
    const resolved = resolveCase(c, created);
    expect(resolved.packages[0]!.items[0]!.id).toBe("B".repeat(32));
    expect(hostItems(resolved.packages)[0]!.split("\t")).toEqual(["LIBSJS-SCRATCH-SPECIAL", "mp_MacPolicy", "B".repeat(32), "LIBSJS-SCRATCH-SPECIAL-MacPolicy_1"]);
  });
});

describe.each(CASE_ENGINES)("recorded %s scratch-seeded export fixtures", (engine: CaseEngine) => {
  const CASES_DIR = casesDir(engine, "export");
  const BLOBS_DIR = blobsDir(engine, "export");
  const readCase = (id: string) => JSON.parse(readFileSync(join(CASES_DIR, id, "case.json"), "utf8")) as CaseFile;

  it("records every case in the list", () => {
    for (const c of SCRATCH_EXPORT_CASES) expect(existsSync(join(CASES_DIR, c.id, "case.json")), c.id).toBe(true);
  });

  it.each(SCRATCH_EXPORT_CASES.map((c) => [c.id, c] as const))("%s", (id, c) => {
    const dir = join(CASES_DIR, id);
    for (const name of ["case.json", "README.md", "run.json", "transcript.jsonl", "messages.jsonl", "engine.log", "host.log"]) {
      expect(existsSync(join(dir, name)), name).toBe(true);
    }
    expect(existsSync(join(dir, "output", "imports.mf")), "imports.mf").toBe(true);

    const file = readCase(id);
    const group = SEED_GROUPS.find((g) => g.cases.includes(c))!;
    expect(file.seed?.group).toBe(group.id);
    expect(file).toEqual(caseFile({ ...resolveCase(c, file.seed!.steps.flatMap((s) => s.created)) }, file.result, file.seed, engine));
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe(caseReadme(file));

    // The seed: one record per step, in order, and everything it created was deleted again.
    expect(file.seed!.steps.map((s) => s.packages)).toEqual(group.steps.map((s) => s.packages.map((p) => p.name)));
    const created = file.seed!.steps.flatMap((s) => s.created);
    expect(created.length).toBeGreaterThan(0);
    const deleted = new Set(file.seed!.deleted.map((d) => `${d.type}:${d.id}`));
    for (const item of created) expect(deleted.has(`${item.type}:${item.id}`), `${item.type} ${item.id} was deleted`).toBe(true);

    // The Hashtable insertion order is recorded twice and must agree.
    const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as { engine: string; params: { Items: string[] } };
    expect(run.engine).toBe(engine);
    expect(run.params.Items).toEqual(hostItems(file.packages));
    expect(file.result.error).toBeNull();

    const calls = readTranscript(join(dir, "transcript.jsonl"), BLOBS_DIR);
    expect(calls.length).toBe(file.result.calls);
  });
});
