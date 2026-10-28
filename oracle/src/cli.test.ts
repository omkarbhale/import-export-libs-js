import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CleanupReport, RecordResult } from "./record.js";

// The Windows side is replaced; everything the CLI does with its report is real.
const recorded = vi.hoisted(() => ({ result: null as RecordResult | null }));
vi.mock("./record.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./record.js")>()),
  record: vi.fn(async () => recorded.result!),
}));

const xslCalls = vi.hoisted(() => ({ requests: [] as unknown[] }));
vi.mock("./xsl.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./xsl.js")>()),
  recordXsl: vi.fn(async (req: { out: string }) => {
    xslCalls.requests.push(req);
    return { out: req.out, hostExit: 0, cases: 1, remainingSecrets: [] };
  }),
}));

const { main } = await import("./cli.js");

const LIST = { type: "List", id: "D82CDE4CAF7E43CF99BF5542C3197357" };

function result(hostExit: number, cleanup: CleanupReport | null): RecordResult {
  return { out: "/tmp/oracle-cli-test", hostExit, calls: 20, error: null, cleanup, remainingSecrets: [] };
}

describe("oracle import exit status", () => {
  let stdout: string;
  let stderr: string;

  beforeEach(() => {
    stdout = "";
    stderr = "";
    vi.stubEnv("ARAS_PASSWORD", "test-only");
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => ((stdout += String(chunk)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => ((stderr += String(chunk)), true));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const run = (r: RecordResult) => {
    recorded.result = r;
    return main(["import", "/tmp/oracle-cli-test-input", "--out", "/tmp/oracle-cli-test"]);
  };

  it("exits 1 and asks for a re-check when an unconfirmed item is unverified", async () => {
    const code = await run(result(0, { created: [{ ...LIST, unconfirmed: true }], deleted: [], kept: [], unverified: [{ ...LIST, unconfirmed: true }] }));
    expect(code).toBe(1);
    expect(stdout).toContain("cleanup: created 1, deleted 0, kept 0, unverified 1");
    expect(stdout).toContain(`created List ${LIST.id} (unconfirmed: its call failed in transport)`);
    expect(stdout).toContain(`unverified List ${LIST.id}`);
    expect(stderr).toContain("re-check those ids later");
  });

  it("exits 1 when anything is kept", async () => {
    const code = await run(result(0, { created: [LIST], deleted: [], kept: [{ ...LIST, reason: "cleanup failed: timed out" }], unverified: [] }));
    expect(code).toBe(1);
    expect(stdout).toContain(`kept List ${LIST.id}: cleanup failed: timed out`);
  });

  it("exits 1 when the host reports no cleanup", async () => {
    expect(await run(result(0, null))).toBe(1);
    expect(stderr).toContain("the host reported no cleanup");
  });

  it("exits 0 for a run that keeps what it created for a later cleanup", async () => {
    const code = await run(result(0, { created: [LIST], deferred: true, deleted: [], kept: [], unverified: [] }));
    expect(code).toBe(0);
    expect(stdout).toContain("kept 1 created items for a later cleanup run");
    expect(stderr).toBe("");
  });

  it("passes the host's status through once everything created is deleted", async () => {
    const clean: CleanupReport = { created: [LIST], deleted: [LIST], kept: [], unverified: [] };
    expect(await run(result(0, clean))).toBe(0);
    expect(await run(result(2, clean))).toBe(2);
    expect(stderr).not.toContain("re-check");
  });
});

describe("oracle connection", () => {
  beforeEach(() => {
    vi.stubEnv("ARAS_PASSWORD", "test-only");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    recorded.result = result(0, { created: [], deleted: [], kept: [], unverified: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const connection = async (...flags: string[]) => {
    const { record } = await import("./record.js");
    vi.mocked(record).mockClear();
    await main(["import", "/tmp/oracle-cli-test-input", "--out", "/tmp/oracle-cli-test", ...flags]);
    const req = vi.mocked(record).mock.calls[0]![0];
    return { url: req.url, database: req.database };
  };

  it("defaults to the dev instance", async () => {
    vi.stubEnv("ARAS_URL", undefined);
    vi.stubEnv("ARAS_DATABASE", undefined);
    const { DEV_SERVER } = await import("./record.js");
    expect(await connection()).toEqual({ url: DEV_SERVER.url, database: DEV_SERVER.database });
  });

  it("falls back to ARAS_URL, as Windows reaches it, and ARAS_DATABASE", async () => {
    vi.stubEnv("ARAS_URL", "http://172.19.0.1/ah-12sp9-01/");
    vi.stubEnv("ARAS_DATABASE", "arashouse_12sp9_01");
    expect(await connection()).toEqual({ url: "http://localhost/ah-12sp9-01", database: "arashouse_12sp9_01" });
  });

  it("lets the flags win over the environment", async () => {
    vi.stubEnv("ARAS_URL", "http://172.19.0.1/ah-12sp9-01");
    vi.stubEnv("ARAS_DATABASE", "arashouse_12sp9_01");
    expect(await connection("--url", "http://localhost/12sp9", "--database", "12sp9")).toEqual({ url: "http://localhost/12sp9", database: "12sp9" });
  });
});

describe("oracle dbpatch", () => {
  let stdout: string;
  let stderr: string;

  beforeEach(() => {
    stdout = "";
    stderr = "";
    vi.stubEnv("ARAS_PASSWORD", "test-only");
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => ((stdout += String(chunk)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => ((stderr += String(chunk)), true));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const clean: CleanupReport = { created: [LIST], deleted: [LIST], kept: [], unverified: [] };
  const manifest = new URL("../dbpatch/manifest.xml", import.meta.url).pathname;

  it("hands the manifest, the patches folder and the tool name to the recorder, connecting as root unless told otherwise", async () => {
    const { record } = await import("./record.js");
    recorded.result = result(0, clean);
    expect(await main(["--engine", "14.35", "dbpatch", manifest, "--out", "/tmp/oracle-cli-test"])).toBe(0);
    expect(vi.mocked(record).mock.lastCall![0]).toMatchObject({
      engine: "14.35",
      command: "dbpatch",
      user: "root",
      dbpatch: { manifest, folder: manifest.replace(/\/manifest\.xml$/, ""), toolName: "Libs" },
    });
    expect(await main(["--engine", "14.35", "dbpatch", manifest, "--user", "admin", "--patches-folder", "/tmp/p", "--tool-name", "X", "--out", "/tmp/o"])).toBe(0);
    expect(vi.mocked(record).mock.lastCall![0]).toMatchObject({ user: "admin", dbpatch: { folder: "/tmp/p", toolName: "X" } });
    expect(stdout).toContain("cleanup: created 1, deleted 1, kept 0, unverified 0");
  });

  it("needs exactly one manifest", async () => {
    expect(await main(["--engine", "14.35", "dbpatch"])).toBe(64);
    expect(stderr).toContain("dbpatch needs one manifest file");
  });

  it("exits 1 when anything is left behind, and passes an engine exception (2) through", async () => {
    recorded.result = result(0, { created: [LIST], deleted: [], kept: [{ ...LIST, reason: "still present after the cleanup" }], unverified: [] });
    expect(await main(["--engine", "14.35", "dbpatch", manifest, "--out", "/tmp/o"])).toBe(1);
    recorded.result = result(2, clean);
    expect(await main(["--engine", "14.35", "dbpatch", manifest, "--out", "/tmp/o"])).toBe(2);
  });
});

describe("oracle xsl", () => {
  let stdout: string;
  let stderr: string;

  beforeEach(() => {
    stdout = "";
    stderr = "";
    xslCalls.requests.length = 0;
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => ((stdout += String(chunk)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => ((stderr += String(chunk)), true));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const input = new URL("../xsl-cases/export/two-items.xml", import.meta.url).pathname;

  it("needs a stylesheet, inputs, and a transcript with its call numbers", async () => {
    expect(await main(["xsl", input])).toBe(64);
    expect(stderr).toContain("xsl needs --xsl export.xsl|build.xsl");
    expect(await main(["xsl", "--xsl", "nosuch.xsl", input])).toBe(64);
    expect(await main(["xsl", "--xsl", "export.xsl"])).toBe(64);
    expect(await main(["xsl", "--xsl", "export.xsl", "--seq", "3", input])).toBe(64);
    expect(await main(["xsl", "--xsl", "export.xsl", "--transcript", "/tmp/nosuch", input])).toBe(64);
    expect(xslCalls.requests).toEqual([]);
  });

  it("needs no password and hands the engine's options to the recorder", async () => {
    vi.stubEnv("ARAS_PASSWORD", "");
    const code = await main(["--engine", "14.35", "xsl", "--xsl", "build.xsl", "--culture", "sv-SE", "--out", "/tmp/oracle-xsl-test", input]);
    vi.unstubAllEnvs();
    expect(code).toBe(0);
    expect(xslCalls.requests).toMatchObject([{ engine: "14.35", xsl: "build.xsl", culture: "sv-SE", out: "/tmp/oracle-xsl-test" }]);
    expect((xslCalls.requests[0] as { inputs: { name: string }[] }).inputs.map((i) => i.name)).toEqual(["two-items"]);
  });
});
