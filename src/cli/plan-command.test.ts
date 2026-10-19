import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../cli-run.js";
import { FakeTransport, respond } from "../client/fake-transport.js";
import { EXIT } from "./exit.js";
import { testIo } from "./test-io.js";

/** `aras-pkg plan import` (IMP-033): offline, from the recorded import inputs of ticket 25. */

const INPUT = (name: string) => new URL(`../../fixtures/14.0.7/import/${name}/input/imports.mf`, import.meta.url).pathname;

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function plan(args: string[]) {
  const transport = new FakeTransport(() => respond("", { status: 500 }));
  const t = testIo({ transport });
  const code = await run(["plan", "import", ...args], t.io);
  expect(transport.requests, "plan makes no request").toEqual([]);
  return { code, t };
}

describe("plan import", () => {
  it("lists the sequence, and every dropped item with the check it failed", async () => {
    const { code, t } = await plan([INPUT("s4-del/step-2")]);
    expect(code).toBe(EXIT.ok);
    const out = t.stdout();
    expect(out).toMatch(/^engine: 14\.0\.7\nmanifest: .*imports\.mf\nimport order: LIBSJS-SCRATCH-DEL\n/);
    expect(out).toContain("sequence (3 items):");
    expect(out).toMatch(/\n\s+1\s+G37\s+Field delete id=28BBB4301BFE2E4CB6EAD529D97A117F\s+\(LIBSJS-SCRATCH-DEL\/Import\/Field\/LIBSJS-SCRATCH-Del_Field_1\.xml #1\)/);
    expect(out).toContain("dropped (3):");
    expect(out).toContain("Identity delete id=8D1FA15B385BD9268D12CDB127520F9C: action not selected for this type");
    expect(out).toContain("ItemType delete id=0B033B1E3B6425C1276A61E3F5E5F283: ItemType has no action or the action is not edit or add");
    expect(t.stderr()).toBe("");
  });

  it("prints the whole plan as JSON with --json, with the engine used", async () => {
    const { code, t } = await plan([INPUT("s4-del/step-2"), "--json"]);
    expect(code).toBe(EXIT.ok);
    const summary = JSON.parse(t.stdout()) as { engine: string; order: string[]; packages: { name: string; sequence: unknown[]; dropped: { reason: string }[] }[] };
    expect(summary).toMatchObject({ command: "plan import", engine: "14.0.7", result: "success", exitCode: 0, order: ["LIBSJS-SCRATCH-DEL"] });
    expect(summary.packages).toHaveLength(1);
    expect(summary.packages[0]?.sequence).toHaveLength(3);
    expect(summary.packages[0]?.dropped.map((drop) => drop.reason)).toContain("action not selected for this type");
  });

  it("orders the packages by their dependencies and warns about a circle", async () => {
    const { code, t } = await plan([INPUT("man-cycle/step-1")]);
    expect(code).toBe(EXIT.ok);
    expect(t.stdout()).toContain("import order: LIBSJS-SCRATCH-CYC2, LIBSJS-SCRATCH-CYC1\n");
    expect(t.stdout()).toContain("warning: There is a circular dependency on package 'LIBSJS-SCRATCH-CYC1'\n");
    expect(t.stdout()).toContain("package 1 of 2: LIBSJS-SCRATCH-CYC2");
  });

  it("plans only the packages named", async () => {
    const { code, t } = await plan([INPUT("man-cycle/step-1"), "--package", "LIBSJS-SCRATCH-CYC1", "--json"]);
    expect(code).toBe(EXIT.ok);
    const summary = JSON.parse(t.stdout()) as { order: string[] };
    expect(summary.order).toEqual(["LIBSJS-SCRATCH-CYC1"]);
  });

  it("takes a dependency that is not among the packages to exist in the database (no missing-dependency warning offline)", async () => {
    const { t } = await plan([INPUT("man-absent-dependency/step-1")]);
    expect(t.stdout()).not.toMatch(/^warning: /m);
  });

  it("stops at a package whose folder cannot be loaded, prints what it planned, and exits 1", async () => {
    const root = mkdtempSync(join(tmpdir(), "libsjs-cli-plan-"));
    roots.push(root);
    mkdirSync(join(root, "GOOD", "Import", "Variable"), { recursive: true });
    writeFileSync(
      join(root, "GOOD", "Import", "Variable", "v.xml"),
      '<AML><Item type="Variable" id="A1" action="add"><name>v</name></Item></AML>',
    );
    writeFileSync(
      join(root, "imports.mf"),
      '<imports><package name="GOOD" path="GOOD\\Import"/><package name="BAD" path="BAD\\Import"><dependson name="GOOD"/></package></imports>',
    );
    const { code, t } = await plan([join(root, "imports.mf")]);
    expect(code).toBe(EXIT.failed);
    expect(t.stdout()).toContain("package 1 of 2: GOOD");
    expect(t.stdout()).toMatch(/\nfailed: package BAD: /);
    expect(t.stderr()).toMatch(/^\[ERROR\] package BAD: /);
  });
});

describe("what plan import refuses", () => {
  it.for([
    [[], "plan needs a subject"],
    [["export", "x.mf"], "plan needs a subject"],
    [["import"], "plan import needs the manifest"],
    [["import", "/nope/imports.mf"], "does not exist"],
    [["import", "a.mf", "b.mf"], "unexpected argument 'b.mf'"],
  ] as const)("%j", async ([args, message]) => {
    const t = testIo();
    expect(await run(["plan", ...args], t.io)).toBe(EXIT.usage);
    expect(t.stderr()).toContain(message);
  });

  it("a package the manifest does not have", async () => {
    const { code, t } = await plan([INPUT("s4-del/step-2"), "--package", "NOPE"]);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("the manifest has no package 'NOPE'; it has LIBSJS-SCRATCH-DEL");
  });

  it.for(["12.0"])("engine %s is not yet supported (exit 1)", async (engine) => {
    const { code, t } = await plan([INPUT("s4-del/step-2"), "--engine", engine]);
    expect(code).toBe(EXIT.failed);
    expect(t.stderr()).toContain(`engine ${engine} is not yet supported`);
  });

  it("has no connection options: a plan is offline", async () => {
    const { code, t } = await plan([INPUT("s4-del/step-2"), "--url", "http://h"]);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("Unknown option '--url'");
  });
});
