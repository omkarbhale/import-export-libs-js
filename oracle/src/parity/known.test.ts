import { describe, expect, it } from "vitest";
import { catalogue } from "./cases.js";
import { KNOWN_DIFFERENCES } from "./known.js";

describe("the known differences", () => {
  it("name cases of the catalogue, each with a reason and a follow-up", () => {
    const ids = new Set(catalogue("14.0.7").map((e) => e.id));
    for (const [id, known] of Object.entries(KNOWN_DIFFERENCES)) {
      expect(ids.has(id), id).toBe(true);
      expect(known.reason.length).toBeGreaterThan(40);
      expect(known.followUp).toMatch(/roadmap\//);
    }
  });
});
