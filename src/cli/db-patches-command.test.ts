import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { run } from "../cli-run.js";
import { FakeTransport, header } from "../client/fake-transport.js";
import { EXIT } from "./exit.js";
import { RecordedDbPatchServer } from "./replay-db-patch-transport.js";
import { testIo } from "./test-io.js";

/**
 * `aras-pkg apply-db-patches`, end to end. The recorded runs of ticket 72 (`fixtures/14.35/dbpatch/`) are served over HTTP to the
 * CLI, which logs in with the library's own client, applies the patches and logs out: the requests must be the recorded ones, the
 * messages the recorded ones on standard error, and the exit code 0 for the run that applied the patch and 1 for the run whose patch
 * the server refused (DBP-002, DBP-042, DBP-050).
 */
const CASES = new URL("../../fixtures/14.35/dbpatch/", import.meta.url).pathname;

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const TAGGED = /^\[(INFO|WARN|ERROR|PKG)\] /;
const TAGS = { status: "INFO", warning: "WARN", error: "ERROR", currentPackage: "PKG", errorQuestion: "ERROR" } as const;
const headerValue = (log: string, label: string): string => new RegExp(`^${label}: (.*)\\r$`, "m").exec(log)?.[1] ?? "";

/** Runs `apply-db-patches` over a recorded step, with the input files of the step copied to a folder of their own. */
async function applyStep(caseName: string, step: string, extra: string[] = [], user?: string, manifestFolder = "", patchesAtRoot = false) {
  const dir = join(CASES, caseName, step);
  const calls = readTranscript(join(dir, "transcript.jsonl"), join(dir, "_blobs"));
  const recordedLog = readFileSync(join(dir, "engine.log"), "utf8");
  const osUser = /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";
  const server = new RecordedDbPatchServer(calls);
  const transport = new FakeTransport(server.handler);
  const work = mkdtempSync(join(tmpdir(), "libsjs-cli-dbp-"));
  roots.push(work);
  for (const file of readdirSync(join(dir, "input"))) {
    // the manifest may be put in a folder of its own, away from the patches
    const target = file === "manifest.xml" ? join(work, manifestFolder) : work;
    mkdirSync(target, { recursive: true });
    copyFileSync(join(dir, "input", file), join(target, file));
  }
  const logPath = join(work, "engine.log");
  const t = testIo({ env: { ARAS_PASSWORD: "pw" }, transport, cwd: work });
  const args = [
    "apply-db-patches",
    join(work, manifestFolder, "manifest.xml"),
    ...["--engine", "14.35", "--url", headerValue(recordedLog, "URL"), "--database", headerValue(recordedLog, "Database")],
    ...["--user", user ?? headerValue(recordedLog, "User"), "--time-zone", "UTC", "--log", logPath, "--os-user", osUser],
    ...(patchesAtRoot ? ["--patches-folder", work] : []),
    ...extra,
  ];
  const code = await run(args, t.io);
  return { code, t, server, transport, logPath, recordedLog, dir, work };
}

/** The `[TAG] text` lines the recorded messages make. */
function expectedLines(dir: string): string[] {
  return readFileSync(join(dir, "messages.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { channel: keyof typeof TAGS; text: string })
    .flatMap(({ channel, text }) => `[${TAGS[channel]}] ${text}`.split("\n"))
    .filter((line) => TAGGED.test(line));
}

/** The lines of standard error with the recording machine's paths and the clock replaced. */
const taggedLines = (stderr: string, paths: string[]): string[] =>
  stderr
    .split("\n")
    .filter((line) => TAGGED.test(line))
    .map((line) => paths.reduce((text, path) => text.split(path).join("<path>"), line).replace(/\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d/g, "<time>").replace(/^(\[INFO\] Loaded \[).*(\] for upgrade)/, "$1<manifest>$2"));
const recordedLines = (dir: string): string[] =>
  expectedLines(dir).map((line) => line.replace(/\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d/g, "<time>").replace(/^(\[INFO\] Loaded \[).*(\] for upgrade)/, "$1<manifest>$2"));

describe("apply-db-patches, replaying apply/step-1: the no-op patch applied (DBP-002, DBP-044)", () => {
  it("exits 0, sends the recorded requests and messages, and logs out", async () => {
    const { code, t, server, transport, dir, work } = await applyStep("apply", "step-1");
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(code).toBe(EXIT.ok);
    expect(taggedLines(t.stderr(), [work])).toEqual(recordedLines(dir));
    expect(header(transport.requests.at(-1) as never, "SOAPAction")).toBe("Logoff");
  });

  it("writes the log of the engine, with the action ImportDPPatch and the defaults of the reference host", async () => {
    const { logPath, work } = await applyStep("apply", "step-1");
    const log = readFileSync(logPath, "utf8");
    expect(log).toMatch(/^Tool version: 14\.35\.0\.43890\r\nAction: ImportDPPatch\r\nManifest file: \r\n/);
    expect(headerValue(log, "DB updated nanifest file path")).toBe(join(work, "manifest.xml"));
    expect(headerValue(log, "DB pathes folder path")).toBe(work);
    expect(headerValue(log, "Tool name")).toBe("Libs");
    expect(log).toContain("Start of importing DB packages.");
  });

  it("prints the summary with the engine, the manifest, the folder and the tool name", async () => {
    const { t, work } = await applyStep("apply", "step-1");
    expect(t.stdout()).toMatch(/^command: apply-db-patches\nengine: 14\.35\nresult: success\nexitCode: 0\n/);
    expect(t.stdout()).toContain(`manifest: ${join(work, "manifest.xml")}\n`);
    expect(t.stdout()).toContain(`patchesFolder: ${work}\n`);
    expect(t.stdout()).toContain("toolName: Libs\n");
    expect(t.stdout()).toContain("server: 12.0 SP9 Build 24090\n");
    expect(t.stdout()).not.toContain("pw");
  });

  it("prints the summary as JSON with --json", async () => {
    const { code, t } = await applyStep("apply", "step-1", ["--json"]);
    expect(code).toBe(EXIT.ok);
    expect(JSON.parse(t.stdout())).toMatchObject({ command: "apply-db-patches", engine: "14.35", result: "success", exitCode: 0, toolName: "Libs" });
  });
});

describe("apply-db-patches, replaying apply/step-2: the patch the server refuses (DBP-042, DBP-050, DBP-094)", () => {
  it("exits 1 with the recorded messages, though no exception escaped", async () => {
    const { code, t, server, dir, work } = await applyStep("apply", "step-2");
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(code).toBe(EXIT.failed);
    expect(taggedLines(t.stderr(), [work])).toEqual(recordedLines(dir));
    expect(taggedLines(t.stderr(), [work]).some((line) => line.startsWith("[ERROR] Error of import DB patch"))).toBe(true);
    expect(t.stdout()).toMatch(/\nresult: failed\nexitCode: 1\n/);
    expect(t.stdout()).toMatch(/\nmessages: \d+ info, 0 warnings, 1 errors, 0 packages\n/);
  });
});

describe("apply-db-patches: what is refused before anything is sent (DBP-001, DBP-010)", () => {
  it("refuses a login that is not root, though the engine would take it for the login and refuse it after", async () => {
    const { code, t, transport } = await applyStep("non-root", "step-1", [], "admin");
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("needs the login 'root'");
    expect(transport.requests).toEqual([]);
  });

  it.each(["Root", "ROOT"])("compares the user name as it is: %s is refused", async (user) => {
    const { code, transport } = await applyStep("non-root", "step-1", [], user);
    expect(code).toBe(EXIT.usage);
    expect(transport.requests).toEqual([]);
  });

  it.each(["12.0", "14.0.7"])("refuses engine %s", async (engine) => {
    const { code, t, transport } = await applyStep("apply", "step-1", ["--engine", engine]);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("exists only in engine 14.35");
    expect(transport.requests).toEqual([]);
  });

  it("refuses the default engine, which is not 14.35", async () => {
    const t = testIo({ env: { ARAS_PASSWORD: "pw" } });
    const code = await run(["apply-db-patches", "manifest.xml", "--url", "http://x/db", "--database", "db", "--user", "root"], t.io);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("exists only in engine 14.35");
  });

  it("takes the engine from ARAS_PKG_ENGINE", async () => {
    const { work } = await applyStep("apply", "step-1");
    const t = testIo({ env: { ARAS_PASSWORD: "pw", ARAS_PKG_ENGINE: "14.35" }, cwd: work });
    const code = await run(["apply-db-patches", join(work, "missing.xml"), "--url", "http://x/db", "--database", "db", "--user", "root"], t.io);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("does not exist");
  });

  it("refuses a manifest or a patches folder that does not exist", async () => {
    const { work } = await applyStep("apply", "step-1");
    const base = ["--engine", "14.35", "--url", "http://x/db", "--database", "db", "--user", "root"];
    const missing = testIo({ env: { ARAS_PASSWORD: "pw" }, cwd: work });
    expect(await run(["apply-db-patches", join(work, "none.xml"), ...base], missing.io)).toBe(EXIT.usage);
    expect(missing.stderr()).toContain("the manifest");
    const folder = testIo({ env: { ARAS_PASSWORD: "pw" }, cwd: work });
    expect(await run(["apply-db-patches", join(work, "manifest.xml"), "--patches-folder", join(work, "nope"), ...base], folder.io)).toBe(EXIT.usage);
    expect(folder.stderr()).toContain("the patches folder");
    const empty = testIo({ env: { ARAS_PASSWORD: "pw" }, cwd: work });
    expect(await run(["apply-db-patches", join(work, "manifest.xml"), "--patches-folder", "", ...base], empty.io)).toBe(EXIT.usage);
  });

  it("needs the manifest and takes no second argument", async () => {
    const base = ["--engine", "14.35", "--url", "http://x/db", "--database", "db", "--user", "root"];
    const none = testIo({ env: { ARAS_PASSWORD: "pw" } });
    expect(await run(["apply-db-patches", ...base], none.io)).toBe(EXIT.usage);
    expect(none.stderr()).toContain("needs the manifest");
    const two = testIo({ env: { ARAS_PASSWORD: "pw" } });
    expect(await run(["apply-db-patches", "a.xml", "b.xml", ...base], two.io)).toBe(EXIT.usage);
  });

  it("has no flag for the password", async () => {
    const t = testIo({ env: {} });
    expect(await run(["apply-db-patches", "m.xml", "--password", "x"], t.io)).toBe(EXIT.usage);
  });

  it("prints its usage with --help", async () => {
    const t = testIo();
    expect(await run(["apply-db-patches", "--help"], t.io)).toBe(EXIT.ok);
    expect(t.stdout()).toContain("--patches-folder <dir>");
    expect(t.stdout()).toContain("--tool-name <text>");
    const top = testIo();
    await run(["--help"], top.io);
    expect(top.stdout()).toContain("apply-db-patches <manifest>");
  });
});

describe("apply-db-patches: the options of DBP-002", () => {
  it("looks for the patch files in the folder of the manifest by default", async () => {
    // the manifest is away from the patch, so the default folder has none: the engine reports the file after its four checks
    const { code, t, work } = await applyStep("apply", "step-2", [], undefined, "manifests");
    expect(code).toBe(EXIT.failed);
    expect(t.stderr()).toContain("[ERROR] File not found : ");
    expect(t.stdout()).toContain(`patchesFolder: ${join(work, "manifests")}\n`);
  });

  it("takes the folder of the patches from --patches-folder", async () => {
    // the patch is where the flag says, so the recorded run replays: its one error is the server's refusal, not a missing file
    const { code, t, server, work } = await applyStep("apply", "step-2", [], undefined, "manifests", true);
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(code).toBe(EXIT.failed);
    expect(t.stderr()).not.toContain("File not found");
    expect(t.stdout()).toContain(`patchesFolder: ${work}\n`);
  });

  it("refuses a --patches-folder that does not exist", async () => {
    const { code, t } = await applyStep("apply", "step-2", ["--patches-folder", "/no/such/folder"]);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("the patches folder '/no/such/folder' does not exist");
  });

  it("takes the tool name from --tool-name: it shows in the log and the summary", async () => {
    // the row exists in this recording, so the description is not sent and the run still replays
    const { code, logPath, t, server } = await applyStep("apply", "step-2", ["--tool-name", "Other tool"]);
    expect(code).toBe(EXIT.failed);
    expect(server.mismatches).toEqual([]);
    expect(readFileSync(logPath, "utf8")).toContain("Tool name: Other tool\r\n");
    expect(t.stdout()).toContain("toolName: Other tool\n");
  });
});
