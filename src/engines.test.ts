import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE, ENGINE_ASSEMBLY_VERSIONS, ENGINES, isEngine } from "./engines.js";

describe("engines", () => {
  it("defaults to 14.0.7", () => {
    expect(DEFAULT_ENGINE).toBe("14.0.7");
  });

  it("has an assembly version for every engine", () => {
    for (const engine of ENGINES) {
      expect(ENGINE_ASSEMBLY_VERSIONS[engine].startsWith(`${engine}.`)).toBe(true);
    }
  });

  it("recognises only the three engines", () => {
    expect(isEngine("14.35")).toBe(true);
    expect(isEngine("14.0")).toBe(false);
  });
});
