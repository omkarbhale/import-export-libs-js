import { describe, expect, it } from "vitest";
import { catalogue, duplicateIds, CONSOLE_MODE_CASES, languagePackCases } from "./cases.js";
import { EXPORT_CASES } from "../export-cases.js";
import { SCRATCH_EXPORT_CASES } from "../export-scratch-cases.js";
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
