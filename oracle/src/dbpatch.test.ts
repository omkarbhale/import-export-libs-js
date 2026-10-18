import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DBPATCH_DIR, MANIFEST_FILE, MANIFEST_SHA256, PATCH_FILE, PATCH_NUMBER, PATCH_RELEASE, PATCH_SHA256, TOOL_NAME, assertTestPatch } from "./dbpatch.js";
import {
  CASES_DIR,
  DBPATCH_CASES,
  caseFile,
  caseReadme,
  indexReadme,
  outcomeMatches,
  type CaseFile,
  type StepResult,
} from "./record-dbpatch-cases.js";
import { dbpatchHostParams } from "./record.js";

const MANIFEST = join(DBPATCH_DIR, MANIFEST_FILE);

describe("the committed test patch", () => {
  it("is the manifest and patch of DBP-070", () => {
    const manifest = readFileSync(MANIFEST, "utf8");
    expect(manifest).toContain(`<up_number>${PATCH_NUMBER}</up_number>`);
    expect(manifest).toContain("<software_version>9999</software_version>");
    expect(manifest.match(/<update>/g)).toHaveLength(1);
    expect(PATCH_RELEASE).toBe("99.99");
    expect(readFileSync(join(DBPATCH_DIR, PATCH_FILE), "utf8")).toBe("<Update><Type>C#</Type><Body><![CDATA[return this;]]></Body><Data/></Update>\n");
  });

  it("is accepted by the guard, with the patches folder defaulting to the manifest's folder", () => {
    expect(assertTestPatch(MANIFEST, DBPATCH_DIR, TOOL_NAME)).toEqual({ manifest: MANIFEST, folder: DBPATCH_DIR });
  });
});

describe("the guard (DBP-071)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "libsjs-dbpatch-test-"));
    copyFileSync(MANIFEST, join(dir, MANIFEST_FILE));
    copyFileSync(join(DBPATCH_DIR, PATCH_FILE), join(dir, PATCH_FILE));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("accepts a byte-identical copy anywhere", () => {
    expect(() => assertTestPatch(join(dir, MANIFEST_FILE), dir, TOOL_NAME)).not.toThrow();
  });

  it("refuses a manifest that differs by one byte", () => {
    writeFileSync(join(dir, MANIFEST_FILE), readFileSync(MANIFEST, "utf8").replace("<order>1</order>", "<order>2</order>"));
    expect(() => assertTestPatch(join(dir, MANIFEST_FILE), dir, TOOL_NAME)).toThrow(/not the committed test patch file/);
  });

  it("refuses a patch file that differs, however small the change", () => {
    writeFileSync(join(dir, PATCH_FILE), "<Update><Type>C#</Type><Body><![CDATA[return this;]]></Body><Data /></Update>\n");
    expect(() => assertTestPatch(join(dir, MANIFEST_FILE), dir, TOOL_NAME)).toThrow(/patch .* is not the committed test patch file/);
  });

  it("refuses a missing patch file and an unreadable manifest", () => {
    rmSync(join(dir, PATCH_FILE));
    expect(() => assertTestPatch(join(dir, MANIFEST_FILE), dir, TOOL_NAME)).toThrow(/patch .* is unreadable/);
    expect(() => assertTestPatch(join(dir, "nosuch", MANIFEST_FILE), dir, TOOL_NAME)).toThrow(/manifest .* is unreadable/);
  });

  it("refuses any tool name but Libs, and a manifest under another name", () => {
    expect(() => assertTestPatch(join(dir, MANIFEST_FILE), dir, "Aras Update")).toThrow(/--tool-name is 'Aras Update'/);
    copyFileSync(MANIFEST, join(dir, "other.xml"));
    expect(() => assertTestPatch(join(dir, "other.xml"), dir, TOOL_NAME)).toThrow(/not named manifest\.xml/);
  });

  it("names every problem at once", () => {
    writeFileSync(join(dir, MANIFEST_FILE), "<updates_manifest/>");
    rmSync(join(dir, PATCH_FILE));
    expect(() => assertTestPatch(join(dir, MANIFEST_FILE), dir, "x")).toThrow(/--tool-name.*manifest .*patch /s);
  });

  it("pins the digests to the committed files", () => {
    expect(MANIFEST_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(PATCH_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(PATCH_SHA256).not.toBe(MANIFEST_SHA256);
  });
});

describe("the DB patch case list", () => {
  it("has unique, folder-safe ids, at least one step each, and the engine's root login only where it can apply", () => {
    const ids = DBPATCH_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of DBPATCH_CASES) {
      expect(c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.steps.length, c.id).toBeGreaterThan(0);
      for (const s of c.steps) {
        if (s.expect.kind !== "refused") expect(s.user, `${c.id}/${s.name}`).toBe("root");
      }
    }
  });

  it("judges a step's outcome", () => {
    const base: StepResult = { hostExit: 0, calls: 16, error: null, errorMessages: 0, created: [] };
    expect(outcomeMatches({ kind: "applied" }, base)).toBe(true);
    expect(outcomeMatches({ kind: "applied" }, { ...base, errorMessages: 1, hostExit: 1 })).toBe(false);
    expect(outcomeMatches({ kind: "patch-failed" }, { ...base, errorMessages: 1, hostExit: 1 })).toBe(true);
    expect(outcomeMatches({ kind: "patch-failed" }, { ...base, errorMessages: 1, hostExit: 1, error: "x" })).toBe(false);
    const refused = { kind: "refused", message: "Login name is not root." } as const;
    expect(outcomeMatches(refused, { ...base, hostExit: 2, error: "System.ArgumentException: Login name is not root. It is 'admin'." })).toBe(true);
    expect(outcomeMatches(refused, { ...base, hostExit: 2, error: "System.ArgumentException: Login name is not root.", created: [{ type: "DatabaseUpgrade", id: "A" }] })).toBe(false);
  });
});

describe("the dbpatch host parameters", () => {
  it("are the staged paths, the tool name and the committed digests", () => {
    const params = dbpatchHostParams({ manifest: MANIFEST, toolName: TOOL_NAME }, "C:\\run");
    expect(params).toMatchObject({
      DbManifest: "C:\\run\\input\\manifest.xml",
      DbPatchesFolder: "C:\\run\\input",
      DbToolName: "Libs",
      ExpectedDbManifestSha256: MANIFEST_SHA256,
      ExpectedDbPatchSha256: PATCH_SHA256,
    });
  });
});

describe("the recorded fixtures (fixtures/14.35/dbpatch)", () => {
  const files = DBPATCH_CASES.map((c) => ({ c, file: JSON.parse(readFileSync(join(CASES_DIR, c.id, "case.json"), "utf8")) as CaseFile }));
  const lines = (c: string, step: number, name: string): Record<string, unknown>[] =>
    readFileSync(join(CASES_DIR, c, `step-${step}`, name), "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown>);
  const calls = (c: string, step: number) => lines(c, step, "transcript.jsonl") as { seq: number; action: string; request: string; response: string }[];
  const messages = (c: string, step: number) => lines(c, step, "messages.jsonl") as { channel: string; text: string }[];
  const run = (c: string, step: number) =>
    JSON.parse(readFileSync(join(CASES_DIR, c, `step-${step}`, "run.json"), "utf8")) as {
      hostExit: number;
      server: { user: string };
      host: { errorMessages: number; error: string | null };
      cleanup: { created: { type: string; id: string }[]; deleted: { type: string; id: string }[]; kept: unknown[]; unverified: unknown[]; deferred?: true };
    };

  it("records every case in the list, each step as its case says, and rewrites to the committed READMEs", () => {
    for (const { c, file } of files) {
      expect(file.id).toBe(c.id);
      expect(file.steps.map((s) => s.name), c.id).toEqual(c.steps.map((s) => s.name));
      for (const [i, s] of c.steps.entries()) expect(outcomeMatches(s.expect, file.steps[i]!.result), `${c.id}/${s.name}`).toBe(true);
      expect(caseFile(c, file.steps.map((s) => s.result), file.deleted)).toEqual(file);
      expect(readFileSync(join(CASES_DIR, c.id, "README.md"), "utf8"), c.id).toBe(caseReadme(file));
    }
    expect(readFileSync(join(CASES_DIR, "README.md"), "utf8")).toBe(indexReadme(files.map((f) => f.file)));
  });

  it("deletes everything a case created, and leaves nothing kept or unverified", () => {
    for (const { c, file } of files) {
      const created = file.steps.flatMap((s) => s.result.created.map((i) => `${i.type}:${i.id}`));
      expect(file.deleted.map((i) => `${i.type}:${i.id}`).sort(), c.id).toEqual([...created].sort());
      const last = run(c.id, c.steps.length);
      expect(last.cleanup.kept, c.id).toEqual([]);
      expect(last.cleanup.unverified, c.id).toEqual([]);
      for (let i = 1; i < c.steps.length; i++) expect(run(c.id, i).cleanup.deferred, `${c.id} step ${i}`).toBe(true);
    }
  });

  it("creates only the test patch's three items in a fresh run: the row, the update and the link", () => {
    const first = run("apply", 1).cleanup.created;
    expect(first.map((i) => i.type)).toEqual(["DatabaseUpgrade", "Applied Updates", "DatabaseUpgradePatch"]);
    expect(run("apply", 1).host.errorMessages).toBe(0);
  });

  it("refuses a login that is not root before any DB request (DBP-010)", () => {
    const refused = calls("non-root", 1);
    expect(refused.map((x) => x.action).filter((a) => a === "ValidateUser" || a === "GetItem" || a === "ApplyUpdate")).toEqual(["ValidateUser"]);
    expect(refused.every((x) => x.action !== "ApplyUpdate")).toBe(true);
    expect(run("non-root", 1).server.user).toBe("admin");
    expect(run("non-root", 1).host.error).toContain("Login name is not root. It is 'admin'. Check your config file.");
    expect(messages("non-root", 1).map((m) => [m.channel, m.text.split("\n")[0]])).toEqual([
      ["status", "Start of importing DB packages."],
      ["status", expect.stringMatching(/^Start time: /)],
      ["error", "Login name is not root. It is 'admin'. Check your config file."],
      ["status", "End of importing DB packages."],
      ["status", expect.stringMatching(/^End time: /)],
    ]);
  });

  it("asks the server the four questions of ValidateRootUser, then applies the patch (DBP-011, DBP-041)", () => {
    const actions = calls("apply", 1).slice(6).map((x) => [x.action, x.request]);
    expect(actions.slice(0, 4)).toEqual([
      ["ValidateUser", "<Empty />"],
      ["GetItem", expect.stringMatching(/^<Item type="USER" id="[0-9A-F]{32}" select="id" config_path="Alias" levels="1" \/>$/)],
      ["GetItem", '<Item type="Identity"><name>Super User</name></Item>'],
      ["GetItem", '<Item type="Identity"><name>Innovator Admin</name></Item>'],
    ]);
    const update = calls("apply", 1).find((x) => x.action === "ApplyUpdate")!;
    expect(update.request).toBe(
      `<Item><Number>${PATCH_NUMBER}</Number><Name>LIBSJS-SCRATCH-noop</Name><Generation>1</Generation><Update><Type>C#</Type><Body><![CDATA[return this;]]></Body><Data /></Update></Item>`,
    );
  });

  it("refuses the same number the second time with the server's own fault (DBP-042)", () => {
    const update = calls("apply", 2).find((x) => x.action === "ApplyUpdate")!;
    expect(update.response).toContain("has already been applied to this database");
    const errors = messages("apply", 2).filter((m) => m.channel === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.text.startsWith("Error of import DB patch\r\n")).toBe(true);
    expect(calls("apply", 2).some((x) => x.request.includes('type="DatabaseUpgradePatch"'))).toBe(false);
    expect(calls("apply", 2).at(-1)!.request).toContain("<upgrade_status>2</upgrade_status>");
  });

  it("has its inputs in each step folder", () => {
    for (const { c } of files) {
      for (const i of c.steps.keys()) {
        expect(readFileSync(join(CASES_DIR, c.id, `step-${i + 1}`, "input", MANIFEST_FILE))).toEqual(readFileSync(MANIFEST));
        expect(existsSync(join(CASES_DIR, c.id, `step-${i + 1}`, "input", PATCH_FILE))).toBe(true);
      }
    }
  });
});
