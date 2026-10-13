import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkCoverage, loadCoverageInput, pendingMethods, type CoverageInput } from "./coverage.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const repo = loadCoverageInput(root);

const LOCK = {
  token: "0x060000ad",
  signatureSha256: "a".repeat(64),
  ilSha256: "b".repeat(64),
};

function build(methods: object[], extra: object = {}) {
  return {
    engine: "14.0.7",
    assemblyVersion: "14.0.7.35492",
    sha256: "c".repeat(64),
    mvid: "81698344-c4fa-4ec3-a48f-0961032d17f1",
    ...extra,
    methods,
  };
}

type Method = { fullName: string; signature: string; lock: object };
type Build = { engine: string; assemblyVersion: string; sha256: string; mvid: string; methods: Method[] };

/** The generated reachable sets that agree with a source map. */
function reachableOf(sourceMap: unknown): CoverageInput["reachable"] {
  const sets = new Map<string, object>();
  for (const b of (sourceMap as { builds: Build[] }).builds) {
    if (sets.has(b.engine)) continue;
    const methods = new Map(b.methods.map((m) => [`${m.fullName} ${m.signature}`, { fullName: m.fullName, signature: m.signature, lock: m.lock }]));
    sets.set(b.engine, {
      engine: b.engine,
      assemblyVersion: b.assemblyVersion,
      sha256: b.sha256,
      mvid: b.mvid,
      generator: { rea: "6.4.0", ilspycmd: "8.2.0.7535" },
      hosts: [{ file: "import.exe", sha256: "d".repeat(64) }],
      methods: [...methods.values()],
    });
  }
  return [...sets].map(([engine, data]) => ({ path: `spec/reachable/${engine}.json`, data }));
}

function mapped(overrides: object = {}) {
  return {
    fullName: "Aras.Tools.SolutionUpgrade.CItemHelper::applyAML",
    signature: "System.Boolean applyAML(System.String)",
    lock: LOCK,
    status: "mapped",
    rules: ["IMP-001"],
    symbols: ["src/import/apply.ts#applyAml"],
    ...overrides,
  };
}

const AREA_DOC = { path: "spec/import-run.md", text: "# Import run\n\n### IMP-001: Apply AML\n\n[14.0.7] Sends it.\n" };
const IMPL = { path: "src/import/apply.ts", text: "/** @spec IMP-001 */\nexport function applyAml(): void {}\n" };

function input(overrides: Partial<CoverageInput>): CoverageInput {
  const sourceMap = overrides.sourceMap ?? { builds: [build([mapped()])] };
  return {
    sourceMap,
    schema: repo.schema,
    areaDocs: [AREA_DOC],
    bugs: { path: "spec/bugs.md", text: "# Bugs\n" },
    srcFiles: [IMPL],
    reachable: reachableOf(sourceMap),
    reachableSchema: repo.reachableSchema,
    oracleDigests: {},
    ...overrides,
  };
}

describe("spec coverage", () => {
  it("passes on the repository", () => {
    expect(checkCoverage(repo)).toEqual([]);
  });

  // What is left to map in builds still in progress (see spec/README.md).
  for (const method of pendingMethods(repo.sourceMap)) it.todo(`map ${method}`);

  it("passes on a fully mapped build", () => {
    expect(checkCoverage(input({}))).toEqual([]);
  });

  it("fails on an unmapped reachable method", () => {
    const sourceMap = { builds: [build([mapped(), mapped({ fullName: "A.B::C", status: "unmapped", rules: [], symbols: [] })])] };
    expect(checkCoverage(input({ sourceMap }))).toEqual(["[14.0.7] A.B::C is reachable but unmapped"]);
  });

  it("lists unmapped methods of an in-progress build as pending instead of failing", () => {
    const unmapped = mapped({ fullName: "A.B::C", status: "unmapped", rules: [], symbols: [] });
    const sourceMap = { builds: [build([mapped(), unmapped], { inProgress: true })] };
    expect(checkCoverage(input({ sourceMap }))).toEqual([]);
    expect(pendingMethods(sourceMap)).toEqual(["[14.0.7] A.B::C System.Boolean applyAML(System.String)"]);
  });

  it("fails when a build and its reachable set disagree on methods or locks", () => {
    const other = mapped({ fullName: "A.B::C" });
    const sourceMap = { builds: [build([mapped(), other])] };
    const reachable = reachableOf({ builds: [build([mapped({ lock: { ...LOCK, ilSha256: "e".repeat(64) } }), mapped({ fullName: "A.B::D" })])] });
    expect(checkCoverage(input({ sourceMap, reachable }))).toEqual([
      "[14.0.7] Aras.Tools.SolutionUpgrade.CItemHelper::applyAML (System.Boolean applyAML(System.String)) has a lock that differs from spec/reachable/14.0.7.json",
      "[14.0.7] A.B::C (System.Boolean applyAML(System.String)) is not in spec/reachable/14.0.7.json",
      "[14.0.7] A.B::D System.Boolean applyAML(System.String) is reachable but missing from source-map.json",
    ]);
  });

  it("fails on a build whose identity disagrees with its engine, reachable set or oracle DLL", () => {
    const sourceMap = { builds: [build([mapped()], { assemblyVersion: "12.0.0.13341" })] };
    const reachable = reachableOf({ builds: [build([mapped()], { mvid: "73656177-796f-4071-beb9-1ff7e94a9e63" })] });
    expect(checkCoverage(input({ sourceMap, reachable, oracleDigests: { "14.0.7": "f".repeat(64) } }))).toEqual([
      "source-map.json build 14.0.7 has assemblyVersion 12.0.0.13341, but engine 14.0.7 is 14.0.7.35492",
      "source-map.json build 14.0.7 has assemblyVersion 12.0.0.13341, but spec/reachable/14.0.7.json has 14.0.7.35492",
      "source-map.json build 14.0.7 has mvid 81698344-c4fa-4ec3-a48f-0961032d17f1, but spec/reachable/14.0.7.json has 73656177-796f-4071-beb9-1ff7e94a9e63",
      `source-map.json build 14.0.7 has sha256 ${"c".repeat(64)}, but oracle/native/14.0.7/Libs.dll is ${"f".repeat(64)}`,
    ]);
  });

  it("fails on a build without a reachable set, and on a reachable set without a build", () => {
    expect(checkCoverage(input({ reachable: [] }))).toEqual([
      "source-map.json build 14.0.7 has no generated spec/reachable/14.0.7.json (run tools/rea-map)",
    ]);
    const reachable = reachableOf({ builds: [build([mapped()]), build([mapped()], { engine: "14.35", assemblyVersion: "14.35.0.43890" })] });
    expect(checkCoverage(input({ reachable }))).toEqual(["spec/reachable/14.35.json has no build in source-map.json"]);
  });

  it("fails on a reachable set that breaks its schema or sits under the wrong name", () => {
    const [set] = reachableOf({ builds: [build([mapped()])] });
    const reachable = [{ path: "spec/reachable/14.35.json", data: set?.data }, { path: "spec/reachable/x.json", data: { engine: "14.0.7" } }];
    const problems = checkCoverage(input({ reachable }));
    expect(problems).toContain("spec/reachable/14.35.json holds engine 14.0.7");
    expect(problems.some((p) => p.startsWith("spec/reachable/x.json: must have required property"))).toBe(true);
  });

  it("fails on a mapped symbol whose file is missing", () => {
    expect(checkCoverage(input({ srcFiles: [] }))).toEqual([
      "[14.0.7] Aras.Tools.SolutionUpgrade.CItemHelper::applyAML maps to src/import/apply.ts#applyAml, but src/import/apply.ts does not exist",
    ]);
  });

  it("fails on a mapped symbol that is not exported", () => {
    const srcFiles = [{ path: IMPL.path, text: "/** @spec IMP-001 */\nfunction applyAml(): void {}\n" }];
    expect(checkCoverage(input({ srcFiles }))).toEqual([
      "[14.0.7] Aras.Tools.SolutionUpgrade.CItemHelper::applyAML maps to src/import/apply.ts#applyAml, but src/import/apply.ts does not export applyAml",
    ]);
  });

  it("resolves class members, object members and re-exports", () => {
    const srcFiles = [
      IMPL,
      { path: "src/a.ts", text: "export class Client { login() {} }\nexport const EXIT = { usage: 64 } as const;\n" },
      { path: "src/index.ts", text: 'export { Client } from "./a.js";\n' },
    ];
    const ok = mapped({ symbols: ["src/a.ts#Client.login", "src/a.ts#EXIT.usage", "src/index.ts#Client"] });
    expect(checkCoverage(input({ srcFiles, sourceMap: { builds: [build([ok])] } }))).toEqual([]);

    const bad = mapped({ symbols: ["src/a.ts#Client.logout"] });
    expect(checkCoverage(input({ srcFiles, sourceMap: { builds: [build([bad])] } }))).toEqual([
      "[14.0.7] Aras.Tools.SolutionUpgrade.CItemHelper::applyAML maps to src/a.ts#Client.logout, but Client in src/a.ts has no member logout",
    ]);
  });

  it("fails on a rule that is defined but cited nowhere", () => {
    const areaDocs = [{ path: AREA_DOC.path, text: `${AREA_DOC.text}\n### IMP-002: Unused\n\n[14.0.7] Never cited.\n` }];
    expect(checkCoverage(input({ areaDocs }))).toEqual([
      "IMP-002 (spec/import-run.md:7) is cited nowhere: no @spec tag and no source-map entry",
    ]);
  });

  it("counts an @spec tag alone as a citation, but not one in a test file", () => {
    const areaDocs = [{ path: AREA_DOC.path, text: `${AREA_DOC.text}\n### IMP-002: Tagged\n\n[14.0.7] Tagged only.\n` }];
    const tagged = [{ path: IMPL.path, text: "/**\n * @spec IMP-001, IMP-002\n */\nexport function applyAml(): void {}\n" }];
    expect(checkCoverage(input({ areaDocs, srcFiles: tagged }))).toEqual([]);

    const inTest = [IMPL, { path: "src/import/apply.test.ts", text: "// @spec IMP-002\n" }];
    expect(checkCoverage(input({ areaDocs, srcFiles: inTest }))).toHaveLength(1);
  });

  it("does not count a mistyped @spec id as a citation of its prefix", () => {
    const areaDocs = [{ path: AREA_DOC.path, text: `${AREA_DOC.text}\n### IMP-002: Tagged\n\n[14.0.7] Tagged only.\n` }];
    const typo = [IMPL, { path: "src/import/other.ts", text: "/** @spec IMP-0021 */\nexport const other = 1;\n" }];
    expect(checkCoverage(input({ areaDocs, srcFiles: typo }))).toEqual([
      "IMP-002 (spec/import-run.md:7) is cited nowhere: no @spec tag and no source-map entry",
    ]);
  });

  it("fails on a cited rule that is defined nowhere", () => {
    const srcFiles = [{ path: IMPL.path, text: "/** @spec IMP-001 IMP-009 */\nexport function applyAml(): void {}\n" }];
    expect(checkCoverage(input({ srcFiles }))).toEqual(["IMP-009 is cited in src/import/apply.ts but defined in no spec document"]);
  });

  it("fails on a bug registered for an undefined rule, ignoring fenced examples", () => {
    const bugs = { path: "spec/bugs.md", text: "# Bugs\n\n```markdown\n## EXP-000: example\n```\n\n## IMP-003: Cancel is success\n" };
    expect(checkCoverage(input({ bugs }))).toEqual([
      "IMP-003 is registered in spec/bugs.md:7 but defined in no spec document",
    ]);
  });

  it("fails on a rule defined twice, without a variant, or with an unknown engine", () => {
    const areaDocs = [
      AREA_DOC,
      { path: "spec/other.md", text: "### IMP-001: Again\n\n[14.0.7] x\n\n## IMP-004: Bare\n\n- [14.0] y\n" },
    ];
    const srcFiles = [{ path: IMPL.path, text: "/** @spec IMP-001 IMP-004 */\nexport function applyAml(): void {}\n" }];
    expect(checkCoverage(input({ areaDocs, srcFiles }))).toEqual([
      "IMP-001 is defined twice: spec/import-run.md:3 and spec/other.md:1",
      "IMP-004 (spec/other.md:5) has a variant for unknown engine [14.0]",
    ]);

    const noVariant = [{ path: AREA_DOC.path, text: "### IMP-001: Apply AML\n\nNo engine here.\n" }];
    expect(checkCoverage(input({ areaDocs: noVariant }))).toEqual([
      "IMP-001 (spec/import-run.md:1) has no engine variant such as [14.0.7]",
    ]);
  });

  it("fails on a source map that breaks the schema", () => {
    const sourceMap = { builds: [build([mapped({ status: "not-ported" })])] };
    const problems = checkCoverage(input({ sourceMap }));
    expect(problems.some((p) => p.includes("must have required property 'reason'"))).toBe(true);

    const noLock = { builds: [build([mapped({ lock: undefined })])] };
    expect(checkCoverage(input({ sourceMap: JSON.parse(JSON.stringify(noLock)) })).join("\n")).toContain("'lock'");
  });

  it("fails on duplicate builds and methods", () => {
    const sourceMap = { builds: [build([mapped(), mapped()]), build([mapped()])] };
    expect(checkCoverage(input({ sourceMap }))).toEqual([
      "[14.0.7] Aras.Tools.SolutionUpgrade.CItemHelper::applyAML (System.Boolean applyAML(System.String)) is listed twice",
      "source-map.json lists engine 14.0.7 twice",
    ]);
  });
});
