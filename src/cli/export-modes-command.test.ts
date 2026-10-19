import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { run } from "../cli-run.js";
import { FakeTransport, bodyText, header, respond } from "../client/fake-transport.js";
import { packageCaches } from "../client/package-lookups.js";
import { stubResult } from "../client/stub-connection.js";
import { CASES } from "../export/replay-cases.js";
import { EXIT } from "./exit.js";
import { MembershipServer } from "./membership-server.js";
import { RecordedServer } from "./replay-transport.js";
import { testIo } from "./test-io.js";

/**
 * `aras-pkg export --use-import | --from-manifest | --all-packages` end to end (HOST-100 to HOST-130). The recorded run `e14-list`
 * of ticket 24 exports one List item of one package; each mode is made to select exactly that item (the database holds that one
 * package with that one element, or a package folder adds it), so the engine's requests, messages, output folder and `imports.mf`
 * must be the recorded ones.
 */

vi.setConfig({ testTimeout: 120_000 });

const CASE = "e14-list";
const PACKAGE = "com.aras.innovator.cmf";
const ID = "01B506E02528434DB36D562A3FAB826D";
const KEYED_NAME = "cmf_DocumentPropertyDataType";
const BLOBS = join(CASES, "_blobs");

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
beforeEach(() => packageCaches.dependsOn.clear());

const scratch = (): string => {
  const root = mkdtempSync(join(tmpdir(), "libsjs-cli-modes-"));
  roots.push(root);
  return root;
};

const tree = (root: string, prefix = ""): string[] =>
  readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${prefix}${entry.name}`;
      if (!entry.isDirectory()) return [path];
      const below = tree(root, `${path}/`);
      return below.length > 0 ? [`${path}/`, ...below] : [];
    })
    .sort();

const SOLUTIONS = stubResult(
  `<Item type="PackageDefinition" id="PD1"><name>${PACKAGE}</name><generation>1</generation><Relationships>` +
    `<Item type="PackageGroup" id="PG1"><name>List</name><Relationships><Item type="PackageElement" id="PE1">` +
    `<element_id>${ID}</element_id><element_type>List</element_type><name>${KEYED_NAME}</name></Item></Relationships></Item></Relationships></Item>`,
);

interface ModeRun {
  code: number;
  stdout: string;
  stderr: string;
  outDir: string;
  logPath: string;
  server: RecordedServer;
  transport: FakeTransport;
  /** How many package-definition lists were asked for. */
  lists: number;
}

/** Runs the CLI over the recorded case with `selection` as the source and `solutions` as the host's own reads of the database. */
async function exportMode(selection: (work: string) => string[], extra: string[] = []): Promise<ModeRun> {
  const calls = readTranscript(join(CASES, CASE, "transcript.jsonl"), BLOBS);
  const server = new RecordedServer(calls);
  const membership = new MembershipServer([], server.handler);
  let lists = 0;
  let hostReadDone = false;
  const transport = new FakeTransport((request, index) => {
    if (/select="name,generation"/.test(bodyText(request))) {
      lists += 1;
      // the first list belongs to the mode, when the mode reads the database; the engine's own read is the recorded one
      if (!hostReadDone && needsHostRead) {
        hostReadDone = true;
        return respond(SOLUTIONS);
      }
    }
    return membership.handler(request, index);
  });
  const work = scratch();
  const outDir = join(work, "output");
  const logPath = join(work, "engine.log");
  const args = ["export", outDir, ...selection(work)];
  const needsHostRead = args.includes("--from-manifest") || args.includes("--all-packages");
  const t = testIo({ env: { ARAS_PASSWORD: "pw" }, transport, cwd: work });
  const code = await run([...args, "--url", "http://localhost/12sp9", "--database", "12sp9", "--user", "root", "--time-zone", "UTC", "--log", logPath, ...extra], t.io);
  return { code, stdout: t.stdout(), stderr: t.stderr(), outDir, logPath, server, transport, lists };
}

function expectRecordedExport(result: ModeRun): void {
  expect(result.code, result.stderr).toBe(EXIT.ok);
  expect(result.server.mismatches).toEqual([]);
  expect(result.server.consumed).toBe(result.server.total);
  const recorded = join(CASES, CASE, "output");
  const made = tree(result.outDir);
  expect(made).toEqual(tree(recorded));
  for (const path of made.filter((entry) => !entry.endsWith("/"))) {
    expect(readFileSync(join(result.outDir, path)).equals(readFileSync(join(recorded, path))), path).toBe(true);
  }
  expect(header(result.transport.requests.at(-1) as never, "SOAPAction")).toBe("Logoff");
}

/** A manifest that names the package and a folder that adds the item, as an import would find them. */
function importFolder(work: string): string {
  const folder = join(work, "import");
  const files = join(folder, "com", "aras", "innovator", "cmf", "List");
  mkdirSync(files, { recursive: true });
  writeFileSync(join(folder, "imports.mf"), `<imports><package name="${PACKAGE}" path=".\\"/></imports>`);
  writeFileSync(
    join(files, `${KEYED_NAME}.xml`),
    `<AML><Item type="List" id="${ID}" action="add"><name>${KEYED_NAME}</name></Item><Item type="List" id="${ID}" action="edit"/></AML>`,
  );
  return join(folder, "imports.mf");
}

describe("export --use-import (HOST-110 to HOST-113)", () => {
  it("exports the items the package folders add, as the recorded run did", async () => {
    const result = await exportMode((work) => ["--use-import", importFolder(work)]);
    expectRecordedExport(result);
    expect(result.lists).toBe(1);
    const log = readFileSync(result.logPath, "utf8");
    expect(log).toContain("Export using import structure: True\r\n");
    expect(log).toMatch(/Manifest file: .*imports\.mf\r\n/);
    expect(result.stdout).toMatch(/\nsource: use-import\n/);
    expect(result.stdout).toContain(`${PACKAGE}: 1 item(s)`);
  });

  it("writes a conflict to the log before the engine's header, and exports the first item", async () => {
    const result = await exportMode((work) => {
      const manifest = importFolder(work);
      writeFileSync(join(work, "import", "com", "aras", "innovator", "cmf", "List", "second.xml"), `<AML><Item type="List" id="${ID}" action="add"><name>second</name></Item></AML>`);
      return ["--use-import", manifest];
    });
    const log = readFileSync(result.logPath, "utf8");
    expect(log).toMatch(new RegExp(`^\\r?\\nConflict: id = ${ID}; itemName = 'second' type = 'List' and itemName = '${KEYED_NAME}' type = 'List'\\r\\n`));
    expect(log.indexOf("Conflict:")).toBeLessThan(log.indexOf("Tool version:"));
  });

  it("is offered for every engine: 14.35 reaches the manifest check, where it was once refused as not yet supported (HOST-113)", async () => {
    for (const engine of ["12.0", "14.0.7", "14.35"]) {
      const work = scratch();
      const t = testIo({ env: { ARAS_PASSWORD: "pw" }, cwd: work });
      const code = await run(["export", join(work, "out"), "--use-import", join(work, "missing.mf"), "--engine", engine, "--url", "http://x", "--database", "d", "--user", "u"], t.io);
      expect(code).toBe(EXIT.usage);
      expect(t.stderr()).toContain("the manifest file does not exist");
      expect(t.stderr()).not.toContain("is not yet supported");
    }
  });
});

describe("export --from-manifest and --all-packages (HOST-120, HOST-121)", () => {
  it("--from-manifest takes the elements of the packages the manifest names", async () => {
    const result = await exportMode((work) => {
      const manifest = join(work, "named.mf");
      writeFileSync(manifest, `<imports><package name="${PACKAGE}" path=".\\"/></imports>`);
      return ["--from-manifest", manifest];
    });
    expectRecordedExport(result);
    expect(result.lists).toBe(2);
    expect(readFileSync(result.logPath, "utf8")).toContain("Export using import structure: False\r\n");
    expect(result.stdout).toMatch(/\nsource: from-manifest\n/);
  });

  it("--from-manifest leaves the packages the manifest does not name empty; with nothing to export the engine cannot save imports.mf", async () => {
    const result = await exportMode((work) => {
      const manifest = join(work, "other.mf");
      writeFileSync(manifest, `<imports><package name="not.this.one" path=".\\"/></imports>`);
      return ["--from-manifest", manifest];
    });
    // every table is empty, so the engine makes no package folder and the output folder does not exist when it saves the manifest (EXP-511)
    expect(result.code).toBe(EXIT.failed);
    expect(result.stdout).toContain(`${PACKAGE}: 0 item(s)`);
    expect(existsSync(result.outDir)).toBe(false);
    expect(result.stderr).toContain("Could not find a part of the path");
  });

  it("--all-packages takes every element of every package", async () => {
    const result = await exportMode(() => ["--all-packages"]);
    expectRecordedExport(result);
    expect(result.lists).toBe(2);
    expect(result.stdout).toMatch(/\nsource: all-packages\n/);
  });

  it("reports the table of the mode in the JSON summary", async () => {
    const result = await exportMode(() => ["--all-packages"], ["--json"]);
    const summary = JSON.parse(result.stdout) as { source: string; packages: unknown; items: number };
    expect(summary).toMatchObject({ source: "all-packages", packages: [{ name: PACKAGE, items: 1 }], items: 1 });
  });
});

describe("export, the modes are checked before any request (HOST-100, HOST-101)", () => {
  async function refuse(args: string[]): Promise<{ code: number; stderr: string; requests: number }> {
    const work = scratch();
    writeFileSync(join(work, "m.mf"), "<imports/>");
    const transport = new FakeTransport(() => respond(""));
    const t = testIo({ env: { ARAS_PASSWORD: "pw" }, cwd: work, transport });
    const code = await run(["export", join(work, "out"), ...args, "--url", "http://x", "--database", "d", "--user", "u"], t.io);
    return { code, stderr: t.stderr(), requests: transport.requests.length };
  }

  it.for([
    [["--all-packages", "--from-manifest", "m.mf"], "--from-manifest and --all-packages cannot be combined"],
    [["--use-import", "m.mf", "--from-manifest", "m.mf"], "--use-import and --from-manifest cannot be combined"],
    [["--all-packages", "List:ABC"], "--all-packages cannot be combined with items"],
    [["--from-manifest", "m.mf", "-"], "--from-manifest cannot be combined with items"],
    [["--use-import", "m.mf", "--package", "p"], "--use-import cannot be combined with items"],
  ] as const)("refuses %j", async ([args, message]) => {
    const result = await refuse([...args]);
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain(message);
    expect(result.requests).toBe(0);
  });

  it("makes a missing manifest a usage error, not the console tool's fall back to every package", async () => {
    for (const option of ["--from-manifest", "--use-import"]) {
      const result = await refuse([option, "absent.mf"]);
      expect(result.code).toBe(EXIT.usage);
      expect(result.stderr).toContain(`${option} 'absent.mf': the manifest file does not exist`);
      expect(result.requests).toBe(0);
    }
  });

  it("lists the modes in the usage", async () => {
    const t = testIo();
    expect(await run(["export", "--help"], t.io)).toBe(EXIT.ok);
    expect(t.stdout()).toContain("--use-import <manifest>");
    expect(t.stdout()).toContain("--from-manifest <manifest>");
    expect(t.stdout()).toContain("--all-packages");
  });
});
