import { describe, expect, it } from "vitest";
import { CASE_ENGINES, IMPORT_ENGINES, blobsDir, casesDir, isCaseEngine, isImportEngine, recorderCommand } from "./case-engine.js";

describe("the case recorders' engines", () => {
  it("knows 14.0.7 and 12.0 only", () => {
    expect([...CASE_ENGINES].sort()).toEqual(["12.0", "14.0.7"]);
    expect(isCaseEngine("12.0")).toBe(true);
    expect(isCaseEngine("14.35")).toBe(false);
  });

  it("records import cases on 14.35 too, which has no export cases here yet", () => {
    expect([...IMPORT_ENGINES].sort()).toEqual(["12.0", "14.0.7", "14.35"]);
    expect(isImportEngine("14.35")).toBe(true);
    expect(isImportEngine("13.0")).toBe(false);
    expect(casesDir("14.35", "import").endsWith("/fixtures/14.35/import")).toBe(true);
    expect(recorderCommand("oracle:import-cases", "14.35", "--only a --force")).toBe("npm run oracle:import-cases -- --engine 14.35 --only a --force");
  });

  it("keeps each engine's cases and blobs in its own folder", () => {
    expect(casesDir("12.0", "export").endsWith("/fixtures/12.0/export")).toBe(true);
    expect(blobsDir("14.0.7", "import").endsWith("/fixtures/14.0.7/import/_blobs")).toBe(true);
  });

  it("prints the re-record command, with --engine only for a non-default engine", () => {
    expect(recorderCommand("oracle:export-cases", "14.0.7")).toBe("npm run oracle:export-cases");
    expect(recorderCommand("oracle:export-cases", "14.0.7", "--only a --force")).toBe("npm run oracle:export-cases -- --only a --force");
    expect(recorderCommand("oracle:export-cases", "12.0")).toBe("npm run oracle:export-cases -- --engine 12.0");
    expect(recorderCommand("oracle:import-cases", "12.0", "--only a --force")).toBe("npm run oracle:import-cases -- --engine 12.0 --only a --force");
  });
});
