import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL("../../fixtures/14.0.7/language-pack", import.meta.url));
const CASES = readdirSync(DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const json = (case_: string, file: string) => JSON.parse(readFileSync(join(DIR, case_, file), "utf8")) as Record<string, any>;
const lines = (case_: string, file: string) =>
  readFileSync(join(DIR, case_, file), "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, any>);

/** Ticket 45's recorded lpimport runs: each is a complete run on scratch items, cleaned up, with the pack the engine read. */
describe("14.0.7 language-pack fixtures", () => {
  it("records five cases", () => {
    expect(CASES).toEqual(["lp01", "lp02", "lp03", "lp04", "lp05"]);
  });

  describe.each(CASES)("%s", (name) => {
    it("is a successful lpimport of a scratch package", () => {
      const run = json(name, "run.json");
      expect(run.command).toBe("lpimport");
      expect(run.engine).toBe("14.0.7");
      expect(run.hostExit).toBe(0);
      expect(run.params.LPPackage).toBe("LIBSJS-SCRATCH-LP");
    });

    it("cleaned up everything it created", () => {
      const { created, deleted, kept, unverified } = json(name, "run.json").cleanup;
      expect(kept).toEqual([]);
      expect(unverified).toEqual([]);
      expect(deleted).toEqual(expect.arrayContaining(created));
      expect(deleted).toHaveLength(created.length);
    });

    it("has the call count its case.json states", () => {
      expect(lines(name, "transcript.jsonl")).toHaveLength(json(name, "case.json").calls);
    });

    it("sends the Language get once, before any row-derived request", () => {
      const requests = lines(name, "transcript.jsonl").map((c) => c.request as string);
      const gets = requests.flatMap((r, i) => (r.includes('type="Language" action="get" select="code,suffix"') ? [i] : []));
      expect(gets).toHaveLength(1);
      const firstEdit = requests.findIndex((r) => r.includes('action="edit"') && r.includes("i18n:"));
      if (firstEdit !== -1) expect(gets[0]).toBeLessThan(firstEdit);
    });

    it("reads its pack from lp/ and every row item is a scratch item", () => {
      expect(existsSync(join(DIR, name, "lp", "ImportConfig.xml"))).toBe(true);
      const rows = readFileSync(join(DIR, name, "lp", "xml", "Forum.xml"), "utf8");
      for (const keyed of rows.matchAll(/keyed_name="([^"]*)"/g)) expect(keyed[1]).toMatch(/^LIBSJS-SCRATCH-/);
    });
  });

  it("generates edit items only for the requested languages", () => {
    const edits = (name: string) =>
      lines(name, "transcript.jsonl")
        .map((c) => c.request as string)
        .filter((r) => r.includes("i18n:label"))
        .join("\n");
    expect(edits("lp01")).toContain('xml:lang="de"');
    expect(edits("lp01")).toContain('xml:lang="fr"');
    expect(edits("lp02")).toContain('xml:lang="de"');
    expect(edits("lp02")).not.toContain('xml:lang="fr"');
    expect(edits("lp03")).toContain('xml:lang="fr"');
    expect(edits("lp05")).toBe("");
  });

  it("drops the property that the label list excludes", () => {
    for (const name of CASES) {
      const requests = lines(name, "transcript.jsonl").map((c) => c.request as string);
      expect(requests.some((r) => r.includes("i18n:name"))).toBe(false);
    }
  });

  it("keeps the temp package only for lpdebug", () => {
    expect(existsSync(join(DIR, "lp04", "temp-package", "imports.mf"))).toBe(true);
    expect(existsSync(join(DIR, "lp04", "temp-package", "LIBSJS-SCRATCH-LP", "Import", "Fixes", "Forum.xml"))).toBe(true);
    expect(existsSync(join(DIR, "lp01", "temp-package"))).toBe(false);
  });
});
