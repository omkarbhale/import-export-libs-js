import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { FORUMS, LP_CASES, LP_PACKAGE, configXml, forumXml, writePack } from "./language-pack-cases.js";
import { outcomeMatches } from "./record-import-cases.js";
import { LP_BLOBS_DIR, LP_DIR, lpCaseFile, lpCaseReadme, lpIndexReadme, type LpCaseFile } from "./record-lp-cases.js";
import { blobMatchesName } from "./transcript.js";

const OLD_DIR = join(LP_DIR, "..", "..", "14.0.7", "language-pack");

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

describe("the language-pack case list", () => {
  it("has unique ids and imports one scratch package", () => {
    expect(new Set(LP_CASES.map((c) => c.id)).size).toBe(LP_CASES.length);
    for (const c of LP_CASES) expect(c.lpPackage ?? LP_PACKAGE, c.id).toMatch(/^LIBSJS-SCRATCH-/);
  });

  it("translates scratch Forums only", () => {
    for (const f of FORUMS) expect(f.keyedName).toMatch(/^LIBSJS-SCRATCH-/);
    for (const c of LP_CASES) for (const m of forumXml(c).matchAll(/keyed_name="([^"]*)"/g)) expect(m[1], c.id).toMatch(/^LIBSJS-SCRATCH-/);
  });

  it("builds the packs of ticket 45's 14.0.7 runs byte for byte", () => {
    for (const c of LP_CASES.filter((x) => /^lp0[1-5]$/.test(x.id))) {
      expect(readFileSync(join(OLD_DIR, c.id, "lp", "ImportConfig.xml"), "utf8"), c.id).toBe(configXml(c));
      expect(readFileSync(join(OLD_DIR, c.id, "lp", "xml", "Forum.xml"), "utf8"), c.id).toBe(forumXml(c));
    }
  });
});

describe("the recorded 14.35 language-pack fixtures", () => {
  const recorded = LP_CASES.filter((c) => existsSync(join(LP_DIR, c.id, "case.json")));
  const read = (id: string) => JSON.parse(readFileSync(join(LP_DIR, id, "case.json"), "utf8")) as LpCaseFile;

  it("covers every case in the list", () => {
    expect(recorded.map((c) => c.id)).toEqual(LP_CASES.map((c) => c.id));
  });

  it.each(recorded.map((c) => [c.id, c] as const))("%s: ran as its case says and cleaned up", (id, c) => {
    const file = read(id);
    expect(outcomeMatches(c.expect, file.result), id).toBe(true);
    const run = JSON.parse(readFileSync(join(LP_DIR, id, "run.json"), "utf8"));
    expect(run.engine).toBe("14.35");
    expect(run.command).toBe("lpimport");
    expect(run.cleanup.kept).toEqual([]);
    expect(run.cleanup.unverified).toEqual([]);
    expect(run.cleanup.deleted).toEqual(expect.arrayContaining(run.cleanup.created));
    expect(run.cleanup.deleted).toHaveLength(run.cleanup.created.length);
    expect(run.params.LPPackage).toBe(c.lpPackage ?? LP_PACKAGE);
    expect(run.params.Languages).toEqual(c.languages);
  });

  it.each(recorded.map((c) => [c.id, c] as const))("%s: the README and case.json are what the case list and the run record generate", (id, c) => {
    const file = read(id);
    const again = lpCaseFile(c, file.result, file.deleted);
    expect(file).toEqual(again);
    expect(readFileSync(join(LP_DIR, id, "README.md"), "utf8")).toBe(lpCaseReadme(again));
  });

  it.each(recorded.map((c) => [c.id, c] as const))("%s: the pack the engine read is what the pack builder writes", (id, c) => {
    const dir = mkdtempSync(join(tmpdir(), "lp-pack-"));
    try {
      writePack(dir, c);
      expect(tree(join(LP_DIR, id, "lp"))).toEqual(tree(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends only the selected languages' elements", () => {
    const sent = (id: string) =>
      readFileSync(join(LP_DIR, id, "transcript.jsonl"), "utf8")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => (JSON.parse(l) as { request: string }).request)
        .filter((r) => r.includes("i18n:") && r.includes('action="edit"'))
        .map((r) => [...new Set([...r.matchAll(/xml:lang="([^"]*)"/g)].map((m) => m[1]))].sort());
    if (existsSync(join(LP_DIR, "lp06", "transcript.jsonl"))) for (const langs of sent("lp06")) expect(langs).toEqual(["de"]);
    if (existsSync(join(LP_DIR, "lp07", "transcript.jsonl"))) for (const langs of sent("lp07")) expect(langs).toEqual(["de", "fr"]);
  });

  it("indexes every recorded case", () => {
    if (recorded.length === 0) return;
    expect(readFileSync(join(LP_DIR, "README.md"), "utf8")).toBe(lpIndexReadme(recorded.map((c) => read(c.id))));
  });

  it("names each blob by the sha256 of its content, and every blob is used", () => {
    if (!existsSync(LP_BLOBS_DIR)) return;
    const used = new Set<string>();
    for (const c of recorded) {
      for (const line of readFileSync(join(LP_DIR, c.id, "transcript.jsonl"), "utf8").split("\n").filter((l) => l !== "")) {
        const call = JSON.parse(line) as { responseBlob?: string };
        if (call.responseBlob !== undefined) used.add(call.responseBlob);
      }
    }
    const blobs = readdirSync(LP_BLOBS_DIR).filter((f) => statSync(join(LP_BLOBS_DIR, f)).isFile()).map((f) => f.replace(/\.xml$/, ""));
    expect(blobs.sort()).toEqual([...used].sort());
    for (const sha of blobs) expect(blobMatchesName(LP_BLOBS_DIR, sha), sha).toBe(true);
  });
});
