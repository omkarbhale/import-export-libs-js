import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { run } from "../cli-run.js";
import { FakeTransport, header } from "../client/fake-transport.js";
import { packageCaches } from "../client/package-lookups.js";
import { CASES, type Case } from "../export/replay-cases.js";
import { EXIT } from "./exit.js";
import { MembershipServer, type ServerItem } from "./membership-server.js";
import { RecordedServer } from "./replay-transport.js";
import { type TestIo, testIo } from "./test-io.js";

/**
 * `aras-pkg export`, end to end (HOST-001 to HOST-030). The recorded 14.0.7 export runs of tickets 24 and 67 are served over
 * HTTP to the CLI, preceded by the membership reads of HOST-010 to HOST-016, which a fake database answers: the items are given the
 * way the case's README says the reference host gave them, and the engine's requests, messages, output folder and `imports.mf`
 * must be the recorded ones.
 */

// each replay parses the recorded 2.7 MB list of package definitions, and several run on a busy machine
vi.setConfig({ testTimeout: 120_000 });

const BLOBS = join(CASES, "_blobs");
const TAGGED = /^\[(INFO|WARN|ERROR|PKG)\] /;
const TAGS = { status: "INFO", warning: "WARN", error: "ERROR", currentPackage: "PKG", errorQuestion: "ERROR" } as const;

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
// the dependency cache outlives a helper (EXP-619), and each case was recorded by a process of its own
beforeEach(() => packageCaches.dependsOn.clear());

const scratch = (): string => {
  const root = mkdtempSync(join(tmpdir(), "libsjs-cli-export-"));
  roots.push(root);
  return root;
};

const read = (name: string, file: string): string => readFileSync(join(CASES, name, file), "utf8");
const headerValue = (log: string, label: string): string => new RegExp(`^${label}: (.*)\\r$`, "m").exec(log)?.[1] ?? "";
const caseOf = (name: string): Case => JSON.parse(read(name, "case.json")) as Case;

/** Every file below a folder, as a path with `/` in sorted order, and every folder that holds a file with a trailing `/`. */
function tree(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${prefix}${entry.name}`;
      if (!entry.isDirectory()) return [path];
      const below = tree(root, `${path}/`);
      return below.length > 0 ? [`${path}/`, ...below] : [];
    })
    .sort();
}

const taggedLines = (t: TestIo): string[] => t.stderr().split("\n").filter((line) => TAGGED.test(line));

function expectedLines(name: string): string[] {
  return read(name, "messages.jsonl")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { channel: keyof typeof TAGS; text: string })
    // a message with no text (the engine clears the package label at the end) is not shown
    .filter(({ text }) => text !== "")
    .flatMap(({ channel, text }) => `[${TAGS[channel]}] ${text}`.split("\n"))
    .filter((line) => TAGGED.test(line));
}

/** The database of a case: its items, each in the package the case puts it under. */
function databaseOf(input: Case): ServerItem[] {
  return input.packages.flatMap((entry) =>
    entry.items.map((item) => ({ type: item.type, id: item.id, keyedName: item.keyedName, packageName: entry.name })),
  );
}

type Mode = "items" | "stdin" | "packages";

interface Run {
  code: number;
  t: TestIo;
  server: RecordedServer;
  membership: MembershipServer;
  transport: FakeTransport;
  outDir: string;
  logPath: string;
}

/** Runs `aras-pkg export` over a recorded case, with the options the case was recorded with. */
async function exportCase(
  name: string,
  mode: Mode,
  extra: string[] = [],
  prepare?: (outDir: string) => void,
  database: (items: ServerItem[]) => ServerItem[] = (items) => items,
): Promise<Run> {
  const input = caseOf(name);
  const calls = readTranscript(join(CASES, name, "transcript.jsonl"), BLOBS);
  const recordedLog = read(name, "engine.log");
  const server = new RecordedServer(calls);
  const membership = new MembershipServer(database(databaseOf(input)), server.handler);
  membership.answersPackageList = mode === "packages";
  const transport = new FakeTransport(membership.handler);
  const work = scratch();
  const outDir = join(work, "output");
  prepare?.(outDir);
  const logPath = join(work, "engine.log");
  const level = headerValue(recordedLog, "Export level");
  const items = input.packages.flatMap((entry) => entry.items.map((item) => `${item.type}:${item.id}`));
  const selection =
    mode === "items" ? items : mode === "stdin" ? ["-"] : input.packages.flatMap((entry) => ["--package", entry.name]);
  const t = testIo({
    env: { ARAS_PASSWORD: "pw" },
    transport,
    cwd: work,
    stdin: mode === "stdin" ? `${items.join("\r\n")}\r\n\r\n` : "",
  });
  const unknownReferences = headerValue(recordedLog, "Export unknown packages action");
  const args = [
    "export",
    outDir,
    ...selection,
    ...["--url", headerValue(recordedLog, "URL"), "--database", headerValue(recordedLog, "Database"), "--user", headerValue(recordedLog, "User")],
    ...["--time-zone", "UTC", "--log", logPath],
    ...(level === "" ? [] : ["--level", level]),
    ...(headerValue(recordedLog, "Export referenced items") === "True" ? ["--export-referenced"] : []),
    ...(unknownReferences === "" ? [] : ["--unknown-references", unknownReferences.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()]),
    ...extra,
  ];
  const code = await run(args, t.io);
  return { code, t, server, membership, transport, outDir, logPath };
}

/** The cases whose items sit in one package each, so a package's elements come in the order they were recorded. */
const ONE_PER_PACKAGE = ["e14-list", "e27-permission", "p1-order-six-forward", "p1-order-six-reverse", "e33-user"];
/** More cases: several items under a package, other options. */
const MORE = ["p5-ref-on", "e06-scopecachedependency-removesilently", "e02-part-itemtype"];

function expectReplay(name: string, result: Run): void {
  const { code, t, server, outDir } = result;
  expect(server.mismatches, `${name}: the engine's requests`).toEqual([]);
  expect(server.consumed, `${name}: the engine's requests`).toBe(server.total);
  expect(code, `${name}: the exit code`).toBe(EXIT.ok);
  expect(taggedLines(t), `${name}: the messages`).toEqual(expectedLines(name));
  const made = tree(outDir);
  expect(made, `${name}: the folders and files`).toEqual(tree(join(CASES, name, "output")));
  for (const path of made.filter((entry) => !entry.endsWith("/"))) {
    expect(readFileSync(join(outDir, path)).equals(readFileSync(join(CASES, name, "output", path))), `${name}: ${path} byte for byte`).toBe(true);
  }
}

describe.for(["items", "stdin"] as const)("export, the items given as %s (HOST-001 to HOST-003, HOST-020)", (mode) => {
  it.for([...ONE_PER_PACKAGE, ...MORE])("replays %s", async (name) => {
    const result = await exportCase(name, mode);
    expectReplay(name, result);
    expect(header(result.transport.requests.at(-1) as never, "SOAPAction")).toBe("Logoff");
  });
});

describe("export, whole packages given with --package (HOST-015, HOST-016, HOST-021)", () => {
  it.for(ONE_PER_PACKAGE)("replays %s", async (name) => {
    const result = await exportCase(name, "packages");
    expectReplay(name, result);
  });

  it("reads the list of packages once, then one read per package", async () => {
    const result = await exportCase("p1-order-six-forward", "packages");
    expect(result.membership.requests.length).toBe(7);
    expect(result.membership.requests[0]).toBe('<Item type="PackageDefinition" action="get" select="name"></Item>'.replace("></Item>", " />"));
    expect(result.membership.requests[1]).toMatch(
      /^<Item type="PackageElement" action="get" select="name,element_id,element_type"><source_id><Item type="PackageGroup" action="get"><source_id>[0-9A-F]{32}<\/source_id><\/Item><\/source_id><\/Item>$/,
    );
  });
});

describe("export, the membership reads (HOST-010 to HOST-013)", () => {
  it("makes the four passes in order: one read per ItemType, then the elements, the groups and the definitions", async () => {
    const result = await exportCase("p1-order-six-forward", "items");
    const requests = result.membership.requests;
    expect(requests).toHaveLength(6 + 3);
    expect(requests.slice(0, 6).map((request) => /type="([^"]*)"/.exec(request)?.[1])).toEqual([
      "Item Report",
      "Form",
      "ItemType",
      "Grid",
      "Variable",
      "Identity",
    ]);
    expect(requests[0]).toMatch(/^<Item type="Item Report" action="get" select="config_id,keyed_name" idlist="128C30A645F04E5380F8B4709A3BD1A1" \/>$/);
    expect(requests[6]).toMatch(/^<Item type="PackageElement" action="get" select="element_id,source_id"><element_id condition="in">'128C30A645F04E5380F8B4709A3BD1A1','F288A3345225407EACBC936191097BCD',/);
    expect(requests[7]).toMatch(/^<Item type="PackageGroup" action="get" select="source_id" idlist="[0-9A-F]{32}(,[0-9A-F]{32}){5}" \/>$/);
    expect(requests[8]).toMatch(/^<Item type="PackageDefinition" action="get" select="name" idlist="[0-9A-F]{32}(,[0-9A-F]{32}){5}" \/>$/);
  });

  it("orders the packages by the order the items were given: forward and reversed give the recorded runs", async () => {
    const forward = await exportCase("p1-order-six-forward", "items");
    const reverse = await exportCase("p1-order-six-reverse", "items");
    const packages = (result: Run): string[] => taggedLines(result.t).filter((line) => line.startsWith("[PKG] Exporting"));
    expect(packages(forward)).not.toEqual(packages(reverse));
    expect(packages(forward)).toEqual(expectedLines("p1-order-six-forward").filter((line) => line.startsWith("[PKG] Exporting")));
  });
});

describe("export, the output folder is used as it is (HOST-006)", () => {
  it("does not refuse a folder that holds files, and leaves what the engine does not wipe", async () => {
    const result = await exportCase("e14-list", "items", [], (outDir) => {
      mkdirSync(join(outDir, "com", "aras", "innovator", "cmf"), { recursive: true });
      writeFileSync(join(outDir, "keep.txt"), "stays");
      writeFileSync(join(outDir, "com", "aras", "innovator", "cmf", "old.xml"), "wiped");
    });
    expect(result.code).toBe(EXIT.ok);
    expect(readFileSync(join(result.outDir, "keep.txt"), "utf8")).toBe("stays");
    expect(existsSync(join(result.outDir, "com", "aras", "innovator", "cmf", "old.xml"))).toBe(false);
    expect(existsSync(join(result.outDir, "imports.mf"))).toBe(true);
  });

  it("is refused only when the path cannot be a folder", async () => {
    const work = scratch();
    writeFileSync(join(work, "file"), "x");
    const t = testIo({ env: { ARAS_PASSWORD: "pw" }, cwd: work });
    const code = await run(["export", join(work, "file", "below"), "ItemType:ABC", "--url", "http://x", "--database", "d", "--user", "u"], t.io);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("is not a folder");
  });
});

describe("export, items that cannot be exported are refused by name (HOST-014)", () => {
  async function refuse(items: string[], database: ServerItem[], extra: string[] = []) {
    const server = new RecordedServer([]);
    const membership = new MembershipServer(database, server.handler);
    membership.answersPackageList = true;
    const transport = new FakeTransport(membership.handler);
    const work = scratch();
    const outDir = join(work, "output");
    const t = testIo({ env: { ARAS_PASSWORD: "pw" }, transport, cwd: work });
    const args = ["export", outDir, ...items, "--url", "http://dev.example/12sp9", "--database", "12sp9", "--user", "u", "--time-zone", "UTC", "--log", join(work, "e.log"), ...extra];
    const code = await run(args, t.io);
    return { code, t, membership, transport, outDir };
  }

  const ORPHAN: ServerItem = { type: "Part", id: "A1B2C3D4E5F60718293A4B5C6D7E8F90", keyedName: "Loose part" };
  const MEMBER: ServerItem = { type: "List", id: "0123456789ABCDEF0123456789ABCDEF", keyedName: "A list", packageName: "pkg.a" };

  it("refuses an item in no package, exports nothing, and logs out", async () => {
    const { code, t, transport, outDir } = await refuse([`Part:${ORPHAN.id}`, `List:${MEMBER.id}`], [ORPHAN, MEMBER]);
    expect(code).toBe(EXIT.failed);
    expect(t.stderr()).toContain(`[ERROR] Export refused: 1 item(s) belong to no package: Part "Loose part" (${ORPHAN.id}). Add them to a PackageDefinition first.\n`);
    expect(existsSync(outDir)).toBe(false);
    const actions = transport.requests.map((request) => header(request, "SOAPAction"));
    expect(actions.at(-1)).toBe("Logoff");
    expect(t.stdout()).toMatch(/^command: export\nengine: 14\.0\.7\nresult: refused\nexitCode: 1\n/);
    expect(t.stdout()).toContain(`noPackage: Part "Loose part" (${ORPHAN.id})\n`);
  });

  it("names an item that does not exist", async () => {
    const { code, t } = await refuse([`List:${MEMBER.id}`, "Method:FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"], [MEMBER]);
    expect(code).toBe(EXIT.failed);
    expect(t.stderr()).toContain("[ERROR] Export refused: 1 item(s) were not found: Method FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF\n");
  });

  it("names both kinds, the unpackaged first, and prints the lists in the JSON summary", async () => {
    const { code, t } = await refuse([`Part:${ORPHAN.id}`, "Method:FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"], [ORPHAN], ["--json"]);
    expect(code).toBe(EXIT.failed);
    const lines = t.stderr().split("\n").filter((line) => line.startsWith("[ERROR]"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("belong to no package");
    expect(lines[1]).toContain("were not found");
    const summary = JSON.parse(t.stdout()) as { result: string; noPackage: string[]; notFound: string[]; packages: unknown[] };
    expect(summary).toMatchObject({ result: "refused", noPackage: [`Part "Loose part" (${ORPHAN.id})`], notFound: ["Method FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"], packages: [] });
  });

  it("matches ids without regard to case, and passes the id to the engine as written", async () => {
    const { code, membership } = await refuse([`list:${MEMBER.id.toLowerCase()}`.replace("list", "List")], [MEMBER]);
    expect(code).not.toBe(EXIT.usage);
    expect(membership.requests[0]).toContain(`idlist="${MEMBER.id.toLowerCase()}"`);
  });

  it("uses the id as the keyed name when the server sends none, as the recorded runs of the reference host did", async () => {
    // the Item Report of the case was recorded with its id as the keyed name
    const blank = (items: ServerItem[]): ServerItem[] => items.map((item) => (item.type === "Item Report" ? { ...item, keyedName: " " } : item));
    const result = await exportCase("p1-order-six-forward", "items", [], undefined, blank);
    expectReplay("p1-order-six-forward", result);
  });

  it("batches at 200 values a request", async () => {
    const database: ServerItem[] = Array.from({ length: 450 }, (_, index) => ({
      type: "List",
      id: index.toString(16).toUpperCase().padStart(32, "0"),
      keyedName: `L${index}`,
      packageName: "pkg.a",
    }));
    const { membership } = await refuse(
      database.map((item) => `List:${item.id}`),
      database,
    );
    const lists = membership.requests.filter((request) => request.startsWith('<Item type="List"'));
    expect(lists.map((request) => /idlist="([^"]*)"/.exec(request)?.[1]?.split(",").length)).toEqual([200, 200, 50]);
    expect(membership.requests.filter((request) => request.startsWith('<Item type="PackageElement"')).length).toBe(3);
  });
});

describe("export, a mistyped package (HOST-015, HOST-016)", () => {
  async function packages(names: string[], database: ServerItem[], extra: string[] = []) {
    const server = new RecordedServer([]);
    const membership = new MembershipServer(database, server.handler, ["com.aras.innovator.empty"]);
    membership.answersPackageList = true;
    const transport = new FakeTransport(membership.handler);
    const work = scratch();
    const t = testIo({ env: { ARAS_PASSWORD: "pw" }, transport, cwd: work });
    const code = await run(
      ["export", join(work, "out"), ...names.flatMap((name) => ["--package", name]), "--url", "http://dev.example/12sp9", "--database", "12sp9", "--user", "u", "--time-zone", "UTC", "--log", join(work, "e.log"), ...extra],
      t.io,
    );
    return { code, t, membership, transport };
  }
  const DATABASE: ServerItem[] = [
    { type: "List", id: "0123456789ABCDEF0123456789ABCDEF", keyedName: "A list", packageName: "com.aras.innovator.core" },
    { type: "List", id: "FEDCBA9876543210FEDCBA9876543210", keyedName: "B list", packageName: "com.aras.innovator.cui" },
  ];

  it("suggests the known names near an unknown one, and exports nothing", async () => {
    const { code, t, membership } = await packages(["com.aras.innovator.corre"], DATABASE);
    expect(code).toBe(EXIT.failed);
    expect(t.stderr()).toContain("[ERROR] Export refused: there is no package 'com.aras.innovator.corre'. Did you mean 'com.aras.innovator.core'?\n");
    expect(membership.requests).toHaveLength(1);
  });

  it("is case sensitive, as every other use of a package name is", async () => {
    const { t } = await packages(["COM.ARAS.INNOVATOR.CORE"], DATABASE);
    expect(t.stderr()).toContain("there is no package 'COM.ARAS.INNOVATOR.CORE'. Did you mean 'com.aras.innovator.core'");
  });

  it("writes no suggestion when nothing is near", async () => {
    const { t } = await packages(["zzzzzzzzzzzzzzzzzzzz"], DATABASE);
    expect(t.stderr()).toContain("[ERROR] Export refused: there is no package 'zzzzzzzzzzzzzzzzzzzz'.\n");
  });

  it("lists up to three, closest first", async () => {
    const database: ServerItem[] = ["pkg.ab", "pkg.aa", "pkg.ac", "pkg.ad"].map((name, index) => ({
      type: "List",
      id: `0000000000000000000000000000000${index}`,
      keyedName: name,
      packageName: name,
    }));
    const { t } = await packages(["pkg.a"], database);
    expect(t.stderr()).toContain("Did you mean 'pkg.aa', 'pkg.ab' or 'pkg.ac'?");
  });

  it("warns about a package with no element and refuses when none has one", async () => {
    const { code, t } = await packages(["com.aras.innovator.empty"], DATABASE);
    expect(code).toBe(EXIT.failed);
    expect(t.stderr()).toContain("[WARN] package 'com.aras.innovator.empty' has no elements\n");
    expect(t.stderr()).toContain("[ERROR] Export refused: the named packages have no elements.\n");
  });
});

describe("export, local checks come before any server call (HOST-005)", () => {
  const CONNECTION = ["--url", "http://dev.example/12sp9", "--database", "12sp9", "--user", "u"];

  async function refused(args: string[], env: Record<string, string> = { ARAS_PASSWORD: "pw" }, stdin = "") {
    const server = new RecordedServer([]);
    const transport = new FakeTransport(server.handler);
    const t = testIo({ env, transport, stdin });
    const code = await run(["export", ...args], t.io);
    expect(transport.requests, "nothing is sent").toHaveLength(0);
    return { code, t };
  }

  it.for([
    ["no output folder", []],
    ["no items", ["out", ...CONNECTION]],
    ["an item that is not Type:id", ["out", "NoColon", ...CONNECTION]],
    ["an item with no id", ["out", "Part:", ...CONNECTION]],
    ["an item with no type", ["out", ":ABC", ...CONNECTION]],
    ["an id with a bad character", ["out", "Part:AB'C", ...CONNECTION]],
    ["a type with a bad character", ["out", "Pa<rt:ABC", ...CONNECTION]],
    ["one id for two types", ["out", "Part:ABC", "Document:abc", ...CONNECTION]],
    ["items and --package", ["out", "Part:ABC", "--package", "p", ...CONNECTION]],
    ["a package given twice", ["out", "--package", "p", "--package", "p", ...CONNECTION]],
    ["an empty package name", ["out", "--package", "", ...CONNECTION]],
    ["'-' with items", ["out", "-", "Part:ABC", ...CONNECTION]],
    ["'-' with --password-stdin", ["out", "-", "--password-stdin", ...CONNECTION]],
    ["a bad --unknown-references", ["out", "Part:ABC", "--unknown-references", "maybe", ...CONNECTION]],
    ["a bad --on-item-error", ["out", "Part:ABC", "--on-item-error", "stop", ...CONNECTION]],
    ["an unknown engine", ["out", "Part:ABC", "--engine", "9.9", ...CONNECTION]],
    ["an unknown option", ["out", "Part:ABC", "--nope", ...CONNECTION]],
    ["a missing connection setting", ["out", "Part:ABC", "--url", "http://x"]],
    ["--on-item-error on 14.35", ["out", "Part:ABC", "--engine", "14.35", "--on-item-error", "continue", ...CONNECTION]],
  ] as const)("%s is a usage error", async ([, args]) => {
    const { code, t } = await refused([...args], { ARAS_PASSWORD: "pw" }, "Part:ABC\n");
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("aras-pkg export:");
  });

  it("names the line of a bad item on standard input", async () => {
    const { code, t } = await refused(["out", "-", ...CONNECTION], { ARAS_PASSWORD: "pw" }, "Part:ABC\n\nbad line\n");
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("standard input, line 3: 'bad line' is not Type:id");
  });

  it("refuses an empty standard input", async () => {
    const { code, t } = await refused(["out", "-", ...CONNECTION], { ARAS_PASSWORD: "pw" }, "\n  \n");
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("standard input holds no items");
  });

  it("reports engine 12.0 as not yet supported, after the other checks, sending nothing", async () => {
    const { code, t } = await refused(["out", "Part:ABC", "--engine", "12.0", ...CONNECTION]);
    expect(code).toBe(EXIT.failed);
    expect(t.stderr()).toContain("engine 12.0 is not yet supported");
    const bad = await refused(["out", "NoColon", "--engine", "12.0", ...CONNECTION]);
    expect(bad.code).toBe(EXIT.usage);
  });

  it("prints its usage with --help and exits 0", async () => {
    const t = testIo();
    expect(await run(["export", "--help"], t.io)).toBe(EXIT.ok);
    expect(t.stdout()).toContain("Usage: aras-pkg export <outDir>");
    const top = testIo();
    await run(["--help"], top.io);
    expect(top.stdout()).toContain("export <outDir> [Type:id…]");
  });
});

describe("export, the summary (HOST-030)", () => {
  it("prints the facts of the run as text with the packages in table order", async () => {
    const { t, outDir } = await exportCase("p1-order-six-forward", "items");
    expect(t.stdout()).toMatch(/^command: export\nengine: 14\.0\.7\nresult: success\nexitCode: 0\n/);
    expect(t.stdout()).toContain(`outDir: ${outDir}\nsource: items\npackages: 6\n  `);
    expect(t.stdout()).toContain("items: 6\n");
    expect(t.stdout()).toContain("server: 12.0 SP9 Build 24090\n");
  });

  it("prints the same as JSON with --json", async () => {
    const { t } = await exportCase("e14-list", "packages", ["--json"]);
    const summary = JSON.parse(t.stdout()) as Record<string, unknown>;
    expect(summary).toMatchObject({
      command: "export",
      engine: "14.0.7",
      result: "success",
      exitCode: 0,
      source: "packages",
      packages: [{ name: "com.aras.innovator.cmf", items: 1 }],
      items: 1,
    });
  });
});
