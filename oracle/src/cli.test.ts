import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CleanupReport, RecordResult } from "./record.js";

// The Windows side is replaced; everything the CLI does with its report is real.
const recorded = vi.hoisted(() => ({ result: null as RecordResult | null }));
vi.mock("./record.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./record.js")>()),
  record: vi.fn(async () => recorded.result!),
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

  it("passes the host's status through once everything created is deleted", async () => {
    const clean: CleanupReport = { created: [LIST], deleted: [LIST], kept: [], unverified: [] };
    expect(await run(result(0, clean))).toBe(0);
    expect(await run(result(2, clean))).toBe(2);
    expect(stderr).not.toContain("re-check");
  });
});
