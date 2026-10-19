import { describe, expect, it } from "vitest";
import { catalogue, duplicateIds, exportCasesOf, seedGroupsOf, CONSOLE_MODE_CASES, PARITY_ENGINES, languagePackCases } from "./cases.js";
import { EXPORT_CASES } from "../export-cases.js";
import { EXPORT_CASES_1435 } from "../export-cases-1435.js";
import { SCRATCH_EXPORT_CASES, SCRATCH_EXPORT_CASES_1435 } from "../export-scratch-cases.js";
import { casesFor } from "../import-cases.js";

describe("the 14.0.7 catalogue", () => {
  const entries = catalogue("14.0.7");

  it("has one entry per recorded case of every family, with unique ids", () => {
    expect(duplicateIds(entries)).toEqual([]);
    const count = (kind: string) => entries.filter((e) => e.kind === kind).length;
    expect(count("export")).toBe(EXPORT_CASES.length);
    expect(count("scratch-export")).toBe(SCRATCH_EXPORT_CASES.length);
    expect(count("import")).toBe(casesFor("14.0.7").length);
    expect(count("language-pack")).toBe(5);
    expect(count("console-mode")).toBe(CONSOLE_MODE_CASES.length);
  });

  it("covers the three console modes, and the unknown-package removal modes", () => {
    expect(new Set(CONSOLE_MODE_CASES.map((c) => c.mode))).toEqual(new Set(["all-packages", "from-manifest", "use-import"]));
    const removal = EXPORT_CASES.filter((c) => c.options?.refToUnknownPacks === "RemoveSilently" || c.options?.refToUnknownPacks === "RemoveWithWarning");
    expect(removal.length).toBeGreaterThan(2);
    expect(removal.some((c) => c.options?.refToUnknownPacks === "RemoveSilently")).toBe(true);
    expect(removal.some((c) => c.options?.refToUnknownPacks === "RemoveWithWarning")).toBe(true);
  });

  it("marks only the run of every package as slow", () => {
    expect(entries.filter((e) => e.slow === true).map((e) => e.id)).toEqual(["mode-all-packages"]);
  });

  it("has the language-pack cases of 14.0.7 only", () => {
    expect(languagePackCases("14.0.7").map((c) => c.id)).toEqual(["lp01", "lp02", "lp03", "lp04", "lp05"]);
    expect(catalogue("12.0")).toEqual([]);
  });
});

describe("the 14.35 catalogue (ticket 76, part A: the export side)", () => {
  const entries = catalogue("14.35");

  it("has one entry per recorded export case of the engine, the scratch-seeded ones and the console modes, with unique ids", () => {
    expect(duplicateIds(entries)).toEqual([]);
    const count = (kind: string) => entries.filter((e) => e.kind === kind).length;
    expect(count("export")).toBe(EXPORT_CASES_1435.length);
    expect(count("scratch-export")).toBe(SCRATCH_EXPORT_CASES_1435.length);
    expect(count("console-mode")).toBe(CONSOLE_MODE_CASES.length);
  });

  it("covers the parallel, abort, cancel and language-resource cases of 14.35's export rules", () => {
    const ids = entries.map((e) => e.id);
    for (const id of ["x-par-18-lists-run1", "x-par-18-lists-run3", "x-abort-two-failures", "x-cancel-after-5-run2", "l1-only-star", "lang-both-packages-only-star"]) {
      expect(ids, id).toContain(id);
    }
  });

  it("leaves the import side to part B", () => {
    expect(entries.filter((e) => e.kind === "import" || e.kind === "language-pack")).toEqual([]);
    expect(PARITY_ENGINES).toContain("14.35");
  });

  it("takes the 14.35 cases and groups for 14.35 and the 14.0.7 ones for 14.0.7", () => {
    expect(exportCasesOf("14.35")).toBe(EXPORT_CASES_1435);
    expect(exportCasesOf("14.0.7")).toBe(EXPORT_CASES);
    expect(seedGroupsOf("14.35").map((g) => g.id)).toEqual([...seedGroupsOf("14.0.7").map((g) => g.id), "lang-ml"]);
  });
});
