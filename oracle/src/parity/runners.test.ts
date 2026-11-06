import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseXml } from "../../../src/client/mini-xml.js";
import type { ImportCase } from "../import-cases.js";
import { type ParityEnv, inputDirLikeOracle, runImportCase, timed } from "./runners.js";

const sideConnection = vi.hoisted(() => vi.fn());
const emptyOutcome = vi.hoisted(() => (side: string) => ({ side, calls: [], files: null, log: "", messages: [], console: null, termination: { kind: "returned", value: 0 }, exitCode: 0 }));

vi.mock("../stage.js", () => ({ oracleWindowsRoot: () => "C:\\Users\\u\\AppData\\Local\\libsjs\\oracle" }));
vi.mock("../record.js", async (original) => ({
  ...(await original<typeof import("../record.js")>()),
  record: async () => ({ hostExit: 0, error: null, remainingSecrets: [], cleanup: { created: [], deleted: [], kept: [], unverified: [] } }),
}));
vi.mock("./outcome.js", async (original) => ({ ...(await original<typeof import("./outcome.js")>()), readOracleOutcome: () => emptyOutcome("oracle") }));
vi.mock("./port-core.js", async (original) => ({ ...(await original<typeof import("./port-core.js")>()), openSideConnection: sideConnection, osUserOf: () => "tester" }));
vi.mock("./port-run.js", async (original) => ({
  ...(await original<typeof import("./port-run.js")>()),
  runPortImport: async () => ({ outcome: emptyOutcome("port"), created: [], preRunCreated: [] }),
}));
vi.mock("../import-packages.js", async (original) => ({ ...(await original<typeof import("../import-packages.js")>()), writePackages: () => undefined }));
vi.mock("../record-import-cases.js", async (original) => ({ ...(await original<typeof import("../record-import-cases.js")>()), outcomeMatches: () => true }));

const xmlItem = (xml: string) => parseXml(xml).root;

describe("timed", () => {
  it("adds a run's time to its side, also when the run fails, and needs no counter", async () => {
    const timing = { node: 0, browser: 0 };
    await expect(timed({ timing }, "browser", async () => "done")).resolves.toBe("done");
    await expect(timed({ timing }, "node", () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(timing.browser).toBeGreaterThan(0);
    expect(timing.node).toBeGreaterThan(0);
    await expect(timed({}, "node", async () => 1)).resolves.toBe(1);
  });
});

describe("inputDirLikeOracle", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("returns the root it made, so removing it leaves the base folder intact even when no padding fits", () => {
    const outer = mkdtempSync(join(tmpdir(), "libsjs-runners-"));
    made.push(outer);
    const base = join(outer, ...Array.from({ length: 4 }, () => "b".repeat(100)));
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "sibling.txt"), "keep");

    const { input, root } = inputDirLikeOracle("12.0", "import", base);
    expect(dirname(root)).toBe(base);
    expect(input).toBe(join(root, "input"));
    expect(existsSync(input)).toBe(true);

    rmSync(root, { recursive: true, force: true });
    expect(readdirSync(base)).toEqual(["sibling.txt"]);
  });

  it("pads the input folder to the oracle's input path length below the root", () => {
    const base = mkdtempSync(join(tmpdir(), "libsjs-runners-"));
    made.push(base);
    const { input, root } = inputDirLikeOracle("12.0", "import", base);
    expect(input.startsWith(root + "/")).toBe(true);
    expect(dirname(dirname(input))).toBe(root);
  });
});

describe("an import whose page crashes", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("cleans up and reports what the pre-run made, and says what the lost run may have left", async () => {
    const out = mkdtempSync(join(tmpdir(), "libsjs-runners-"));
    made.push(out);
    const generation = { type: "Forum", id: "NEWGENERATION", unconfirmed: false };
    const inn = {
      applyItem: vi.fn(async (aml: string) => {
        if (aml.includes('action="version"')) return { isError: false, items: [xmlItem('<Item id="NEWGENERATION"/>')] };
        if (aml.includes('action="delete"')) return { isError: false, items: [] };
        return { isError: false, items: [xmlItem("<Item><name>LIBSJS-SCRATCH-Forum</name></Item>")] };
      }),
    };
    sideConnection.mockResolvedValue({ inn, close: async () => undefined });
    const browser = {
      options: { cors: "proxy" },
      pageOrigin: "http://127.0.0.1:1",
      serverOf: () => ({}),
      run: vi.fn(async () => {
        throw new Error("Target page, context or browser has been closed");
      }),
    };
    const report = await runImportCase(
      { engine: "14.0.7", out, port: {}, browser, password: "pw", log: () => undefined } as unknown as ParityEnv,
      { id: "crash", title: "crash", steps: [{ name: "one", packages: [], only: ["LIBSJS-SCRATCH-P"], options: { versionBefore: [{ type: "Forum", id: "OLD" }] }, expect: "returned-0" }] } as unknown as ImportCase,
    );

    expect(browser.run).toHaveBeenCalledOnce();
    expect(report.status).toBe("failed");
    expect(report.note).toContain("Target page, context or browser has been closed");
    expect(report.note).toContain("may leave LIBSJS-SCRATCH-* items on the server, which assertNoScratchLeft catches on the next start");
    expect(report.created).toContainEqual({ type: generation.type, id: generation.id });
    expect(report.deleted).toContainEqual({ type: generation.type, id: generation.id });
    expect(inn.applyItem).toHaveBeenCalledWith('<Item type="Forum" id="NEWGENERATION" action="delete"/>');
  });
});
