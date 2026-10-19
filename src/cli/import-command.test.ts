import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { run } from "../cli-run.js";
import { FakeTransport, devServer, header, respond, soapFault } from "../client/fake-transport.js";
import type { Engine } from "../engines.js";
import { BLOBS, BLOBS_12_0, BLOBS_14_35, CASES, CASES_12_0, CASES_14_35 } from "../import/transcript-replay.js";
import { EXIT } from "./exit.js";
import { RecordedServer } from "./replay-transport.js";
import { type TestIo, testIo } from "./test-io.js";

/**
 * `aras-pkg import`, end to end. The recorded 14.0.7 import runs of ticket 25 are served over HTTP to the CLI, which logs in with
 * the library's own client, runs the import and logs out: the requests must be the recorded ones, the messages the recorded ones on
 * standard error, and the result the recorded return code (IMP-480, WIRE-002).
 */

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const scratch = (): string => {
  const root = mkdtempSync(join(tmpdir(), "libsjs-cli-"));
  roots.push(root);
  return root;
};

const headerValue = (log: string, label: string): string => new RegExp(`^${label}: (.*)\\r$`, "m").exec(log)?.[1] ?? "";
const TAGGED = /^\[(INFO|WARN|ERROR|PKG)\] /;
const TAGS = { status: "INFO", warning: "WARN", error: "ERROR", currentPackage: "PKG", errorQuestion: "ERROR" } as const;

interface Step {
  name: string;
  dir: string;
  options: {
    merge?: boolean;
    release?: string;
    description?: string;
    verbose?: boolean;
    amlBatch?: { maxSize?: number };
    collectErrors?: { maxCount?: number };
  };
  engine: Engine;
  blobs: string;
}

function step(name: string, index: number, engine: Engine = "14.0.7"): Step {
  const cases = engine === "14.35" ? CASES_14_35 : engine === "12.0" ? CASES_12_0 : CASES;
  const definition = JSON.parse(readFileSync(join(cases, name, "case.json"), "utf8")) as { steps: Pick<Step, "options">[] };
  return {
    name: `${name}/step-${index}`,
    dir: join(cases, name, `step-${index}`),
    options: definition.steps[index - 1]?.options ?? {},
    engine,
    blobs: engine === "14.35" ? BLOBS_14_35 : engine === "12.0" ? BLOBS_12_0 : BLOBS,
  };
}

const SUCCESS = [step("s0-mini-defaults", 1), step("s0-mini-merge", 1), step("s0-mini-release-description", 1), step("s0-mini-verbose", 1)];
const FAILURE = [step("s3-unres-reltype-nested", 1), step("s4-del-refused", 2)];

/** Runs `aras-pkg import` over a recorded step, with the options the step was recorded with. */
async function importStep(recorded: Step, extra: string[] = []) {
  const calls = readTranscript(join(recorded.dir, "transcript.jsonl"), recorded.blobs);
  const recordedLog = readFileSync(join(recorded.dir, "engine.log"), "utf8");
  const osUser = /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";
  const server = new RecordedServer(calls, recorded.engine);
  const transport = new FakeTransport(server.handler);
  const work = scratch();
  const logPath = join(work, "engine.log");
  const t = testIo({ env: { ARAS_PASSWORD: "pw" }, transport, cwd: work });
  const { options } = recorded;
  // 12.0 writes no header to its log, so its connection settings come from the run's record
  const recordedRun = JSON.parse(readFileSync(join(recorded.dir, "run.json"), "utf8")) as { server: { url: string; database: string; user: string } };
  const connection = recorded.engine === "12.0" ? recordedRun.server : { url: headerValue(recordedLog, "URL"), database: headerValue(recordedLog, "Database"), user: headerValue(recordedLog, "User") };
  const args = [
    "import",
    join(recorded.dir, "input", "imports.mf"),
    ...(recorded.engine === "14.0.7" ? [] : ["--engine", recorded.engine]),
    ...(options.amlBatch === undefined ? [] : ["--batch", "--batch-max", String(options.amlBatch.maxSize ?? 0)]),
    ...(options.collectErrors === undefined ? [] : ["--collect-errors", "--max-errors", String(options.collectErrors.maxCount ?? 0)]),
    ...["--url", connection.url, "--database", connection.database, "--user", connection.user],
    ...["--time-zone", "UTC", "--log", logPath, "--os-user", osUser],
    ...(options.merge === true ? ["--merge"] : []),
    ...(options.verbose === true ? ["--verbose"] : []),
    ...(options.release === undefined ? [] : ["--release", options.release]),
    ...(options.description === undefined ? [] : ["--description", options.description]),
    ...extra,
  ];
  const code = await run(args, t.io);
  return { code, t, server, transport, logPath, recordedLog, work };
}

/** The `[TAG] text` lines the recorded messages make. */
function expectedLines(recorded: Step): string[] {
  return readFileSync(join(recorded.dir, "messages.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { channel: keyof typeof TAGS; text: string })
    .flatMap(({ channel, text }) => `[${TAGS[channel]}] ${text}`.split("\n"))
    .filter((line) => TAGGED.test(line));
}

const taggedLines = (t: TestIo): string[] => t.stderr().split("\n").filter((line) => TAGGED.test(line));

describe.for(SUCCESS.map((recorded) => [recorded.name, recorded] as const))("import, replaying %s", ([, recorded]) => {
  it("exits 0, sends the recorded requests and messages, and logs out", async () => {
    const { code, t, server, transport } = await importStep(recorded);
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(code).toBe(EXIT.ok);
    expect(taggedLines(t)).toEqual(expectedLines(recorded));
    expect(header(transport.requests.at(-1) as never, "SOAPAction")).toBe("Logoff");
  });

  it("writes the engine's log with the header of the run", async () => {
    const { logPath, recordedLog } = await importStep(recorded);
    const log = readFileSync(logPath, "utf8");
    expect(log).toMatch(/^Tool version: 14\.0\.7\.35492\r\nAction: Import\r\n/);
    for (const label of ["URL", "Database", "User", "Merge import mode", "Import release"]) {
      expect(headerValue(log, label), label).toBe(headerValue(recordedLog, label));
    }
    expect(log).toContain("Start of importing packages");
  });

  it("prints the summary on standard output with the engine used", async () => {
    const { t } = await importStep(recorded);
    expect(t.stdout()).toMatch(/^command: import\nengine: 14\.0\.7\nresult: success\nexitCode: 0\n/);
    expect(t.stdout()).toContain("server: 12.0 SP9 Build 24090\n");
    expect(t.stdout()).toMatch(/\nmessages: \d+ info, 0 warnings, 0 errors, 0 packages\n/);
    // the log path holds a random temporary name, which can contain "pw" by chance
    expect(t.stdout().replace(/^log: .*$/m, "")).not.toContain("pw");
  });
});

describe.for(FAILURE.map((recorded) => [recorded.name, recorded] as const))("import, replaying the failure %s", ([, recorded]) => {
  it("exits 1 with the recorded error messages", async () => {
    const { code, t, server } = await importStep(recorded);
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(code).toBe(EXIT.failed);
    expect(taggedLines(t)).toEqual(expectedLines(recorded));
    expect(taggedLines(t).some((line) => line.startsWith("[ERROR] "))).toBe(true);
    expect(t.stdout()).toMatch(/\nresult: failed\nexitCode: 1\n/);
  });
});

describe("import --engine 12.0, replaying the 12.0 runs of ticket 48 (IMP-480, WIRE-002)", () => {
  const success = step("s0-mini-defaults", 1, "12.0");
  const merge = step("s0-mini-merge", 1, "12.0");
  const failure = step("s4-del-refused", 2, "12.0");

  it.for([success, merge])("exits 0, sends the recorded requests and messages, and logs out: %o", async (recorded) => {
    const { code, t, server, transport } = await importStep(recorded);
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(code).toBe(EXIT.ok);
    expect(taggedLines(t)).toEqual(expectedLines(recorded));
    expect(header(transport.requests.at(-1) as never, "SOAPAction")).toBe("Logoff");
    expect(t.stdout()).toMatch(/^command: import\nengine: 12\.0\nresult: success\nexitCode: 0\n/);
  });

  it("writes the log without a header: the start line comes first, and the package block is cut at the buffer (IMP-403, IMP-412)", async () => {
    const { logPath } = await importStep(success);
    const log = readFileSync(logPath, "utf8");
    expect(log.startsWith("Start of importing packages\r\n")).toBe(true);
    expect(log).not.toContain("Tool version");
  });

  it("exits 1 with the recorded error messages of the failing item and of the run (IMP-407, IMP-427)", async () => {
    const { code, t, server } = await importStep(failure);
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(code).toBe(EXIT.failed);
    expect(taggedLines(t)).toEqual(expectedLines(failure));
    expect(taggedLines(t).filter((line) => line.startsWith("[ERROR] "))).toHaveLength(2);
  });
});

describe("import --json", () => {
  const recorded = SUCCESS[0] as Step;

  it("prints the summary as JSON, with the engine, the result and the counts", async () => {
    const { code, t, logPath } = await importStep(recorded, ["--json"]);
    expect(code).toBe(EXIT.ok);
    const summary = JSON.parse(t.stdout()) as Record<string, unknown>;
    expect(summary).toMatchObject({
      command: "import",
      engine: "14.0.7",
      result: "success",
      exitCode: 0,
      packages: ["LIBSJS-SCRATCH-MINI"],
      merge: false,
      log: logPath,
      messages: { warnings: 0, errors: 0 },
    });
    expect(summary).not.toHaveProperty("error");
    expect(JSON.stringify({ ...summary, log: undefined })).not.toContain("pw");
  });

  it("takes the engine from ARAS_PKG_ENGINE and the connection from the environment", async () => {
    const calls = readTranscript(join(recorded.dir, "transcript.jsonl"), BLOBS);
    const server = new RecordedServer(calls);
    const work = scratch();
    const t = testIo({
      env: { ARAS_URL: "http://dev.example/12sp9", ARAS_DATABASE: "12sp9", ARAS_USER: "root", ARAS_PASSWORD: "pw", ARAS_PKG_ENGINE: "14.0.7" },
      transport: new FakeTransport(server.handler),
      cwd: work,
    });
    const osUser = /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";
    const code = await run(["import", join(recorded.dir, "input", "imports.mf"), "--time-zone", "UTC", "--os-user", osUser, "--json"], t.io);
    expect(code).toBe(EXIT.ok);
    expect(existsSync(join(work, "aras-pkg-import-20261019-080503.log"))).toBe(true);
    expect(JSON.parse(t.stdout())).toMatchObject({ engine: "14.0.7", url: "http://dev.example/12sp9", user: "root" });
  });

  it("reads the password from standard input", async () => {
    const calls = readTranscript(join(recorded.dir, "transcript.jsonl"), BLOBS);
    const server = new RecordedServer(calls);
    const transport = new FakeTransport(server.handler);
    const t = testIo({ stdin: "from-stdin\n", transport, cwd: scratch() });
    const osUser = /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";
    const code = await run(
      ["import", join(recorded.dir, "input", "imports.mf"), "--url", "http://h/x", "--database", "d", "--user", "u", "--time-zone", "UTC", "--os-user", osUser, "--password-stdin"],
      t.io,
    );
    expect(code).toBe(EXIT.ok);
    const sent = transport.requests.map((request) => Buffer.from(request.body ?? new Uint8Array()).toString("utf8")).join("\n");
    expect(sent).toContain(createHash("md5").update("from-stdin").digest("hex"));
  });
});

describe("import --batch and --collect-errors, replaying the 14.35 runs (IMP-500)", () => {
  const BATCH = step("batch-size-3", 1, "14.35");
  const FALLBACK = step("batch-server-failure", 1, "14.35");
  const COLLECT = step("collect-two-packages", 1, "14.35");
  const BOTH = step("batch-collect-fallback", 1, "14.35");

  it("--batch --batch-max 3 sends the recorded batches and exits 0", async () => {
    const { code, t, server, transport } = await importStep(BATCH);
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(code).toBe(EXIT.ok);
    expect(taggedLines(t)).toEqual(expectedLines(BATCH));
    expect(header(transport.requests.at(-1) as never, "SOAPAction")).toBe("Logoff");
  });

  it("a refused batch is imported one item at a time, as recorded, and the run fails (exit 1)", async () => {
    const { code, t, server } = await importStep(FALLBACK);
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(code).toBe(EXIT.failed);
    expect(taggedLines(t)).toEqual(expectedLines(FALLBACK));
  });

  it("--collect-errors --max-errors 5 collects the failed package, goes on with the next, and exits 1 for the collected error", async () => {
    const { code, t, server } = await importStep(COLLECT);
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(code).toBe(EXIT.failed);
    expect(taggedLines(t)).toEqual(expectedLines(COLLECT));
    expect(t.stdout()).toMatch(/\nresult: failed\nexitCode: 1\n/);
  });

  it("both modes together", async () => {
    const { code, t, server } = await importStep(BOTH);
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(code).toBe(EXIT.failed);
    expect(taggedLines(t)).toEqual(expectedLines(BOTH));
  });

  it("the summary tells the settings of the run", async () => {
    const { t } = await importStep(BATCH, ["--json"]);
    expect(JSON.parse(t.stdout())).toMatchObject({ command: "import", engine: "14.35", batch: { size: 3 }, result: "success" });
    expect(JSON.parse(t.stdout())).not.toHaveProperty("collectErrors");
    const collected = await importStep(COLLECT, ["--json"]);
    expect(JSON.parse(collected.t.stdout())).toMatchObject({ collectErrors: { limit: 5 } });
  });

  it("leaves the modes off, and the sizes at 0, when no flag is given", async () => {
    const plain = step("s0-mini-defaults", 1, "14.35");
    const { code, t, server } = await importStep(plain);
    expect(server.mismatches).toEqual([]);
    expect(code).toBe(EXIT.ok);
    expect(t.stdout()).not.toContain("batch");
  });
});

describe("import --package", () => {
  it("imports only the named package", async () => {
    const recorded = step("s0-mini-defaults", 1);
    const { code, server } = await importStep(recorded, ["--package", "LIBSJS-SCRATCH-MINI"]);
    expect(code).toBe(EXIT.ok);
    expect(server.consumed).toBe(server.total);
  });
});

describe("what is refused before any request is made", () => {
  const manifest = join(SUCCESS[0]?.dir as string, "input", "imports.mf");
  const base = ["--url", "http://h/x", "--database", "d", "--user", "u", "--time-zone", "UTC"];

  async function refused(args: string[], env: Record<string, string> = { ARAS_PASSWORD: "pw" }) {
    const transport = new FakeTransport(() => respond("", { status: 500 }));
    const t = testIo({ env, transport, cwd: scratch() });
    const code = await run(args, t.io);
    expect(transport.requests, "no request was made").toEqual([]);
    return { code, t };
  }

  it("a missing manifest argument", async () => {
    const { code, t } = await refused(["import", ...base]);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("import needs the manifest");
  });

  it("a manifest that does not exist", async () => {
    const { code, t } = await refused(["import", join(scratch(), "imports.mf"), ...base]);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toMatch(/the manifest '.*imports\.mf' does not exist/);
  });

  it("a package the manifest does not have, naming the ones it has", async () => {
    const { code, t } = await refused(["import", manifest, ...base, "--package", "NOPE"]);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("the manifest has no package 'NOPE'; it has LIBSJS-SCRATCH-MINI");
  });

  it("a package given twice", async () => {
    const { code, t } = await refused(["import", manifest, ...base, "--package", "LIBSJS-SCRATCH-MINI", "--package", "LIBSJS-SCRATCH-MINI"]);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("'LIBSJS-SCRATCH-MINI' is given twice");
  });

  it("--merge together with --no-merge", async () => {
    const { code, t } = await refused(["import", manifest, ...base, "--merge", "--no-merge"]);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("--merge and --no-merge cannot be used together");
  });

  it("a missing password", async () => {
    const { code, t } = await refused(["import", manifest, ...base], {});
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("missing the password (ARAS_PASSWORD, or --password-stdin)");
  });

  it("an option that does not exist, and a second positional", async () => {
    expect((await refused(["import", manifest, ...base, "--on-item-error", "abort"])).code).toBe(EXIT.usage);
    const { code, t } = await refused(["import", manifest, "other.mf", ...base]);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("unexpected argument 'other.mf'");
  });

  it.for([
    { flag: "--batch", args: ["--batch"] },
    { flag: "--collect-errors", args: ["--collect-errors"] },
    { flag: "--batch-max", args: ["--batch-max", "3"] },
    { flag: "--max-errors", args: ["--max-errors", "3"] },
  ])("$flag is valid only with --engine 14.35", async ({ flag, args }) => {
    const { code, t } = await refused(["import", manifest, ...base, ...args]);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain(`${flag} is valid only with --engine 14.35: engine 14.0.7 has no AML batch mode and no collected errors`);
  });

  it("--batch-max without --batch, and --max-errors without --collect-errors", async () => {
    const batchMax = await refused(["import", manifest, ...base, "--engine", "14.35", "--batch-max", "3"]);
    expect(batchMax.code).toBe(EXIT.usage);
    expect(batchMax.t.stderr()).toContain("--batch-max needs --batch");
    const maxErrors = await refused(["import", manifest, ...base, "--engine", "14.35", "--max-errors", "3"]);
    expect(maxErrors.code).toBe(EXIT.usage);
    expect(maxErrors.t.stderr()).toContain("--max-errors needs --collect-errors");
  });

  it.for(["x", "-1", "1.5", "2147483648", ""])("a size or a limit of '%s' is not a count", async (value) => {
    const batch = await refused(["import", manifest, ...base, "--engine", "14.35", "--batch", `--batch-max=${value}`]);
    expect(batch.code).toBe(EXIT.usage);
    expect(batch.t.stderr()).toContain(`--batch-max needs a whole number from 0 to 2147483647, not '${value}'`);
    const collect = await refused(["import", manifest, ...base, "--engine", "14.35", "--collect-errors", `--max-errors=${value}`]);
    expect(collect.code).toBe(EXIT.usage);
    expect(collect.t.stderr()).toContain(`--max-errors needs a whole number from 0 to 2147483647, not '${value}'`);
  });

  it("the import-language-pack command does not take them", async () => {
    const { code } = await refused(["import-language-pack", "ImportConfig.xml", "--lp-package", "P", ...base, "--engine", "14.35", "--batch"]);
    expect(code).toBe(EXIT.usage);
  });

  it("engine 12.0 has no language-pack import (LP-001)", async () => {
    const { code, t } = await refused(["import-language-pack", manifest, ...base, "--lp-package", "LIBSJS-SCRATCH-LP", "--engine", "12.0"]);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("engine 12.0 has no language-pack import (LP-001)");
  });
});

describe("failures of the run itself", () => {
  const manifest = join(SUCCESS[0]?.dir as string, "input", "imports.mf");
  const args = (work: string) => ["import", manifest, "--url", "http://dev.example/12sp9", "--database", "d", "--user", "u", "--time-zone", "UTC", "--log", join(work, "e.log")];

  it("a failed login exits 1 with the engine's text, prints the summary, and sends no logoff", async () => {
    const transport = new FakeTransport(devServer({ override: (request) => (header(request, "SOAPAction") === "ValidateUser" ? respond(soapFault("1", "Authentication failed")) : undefined) }));
    const work = scratch();
    const t = testIo({ env: { ARAS_PASSWORD: "bad" }, transport, cwd: work });
    const code = await run([...args(work), "--json"], t.io);
    expect(code).toBe(EXIT.failed);
    expect(t.stderr()).toMatch(/^\[ERROR\] Failed login to Innovator; original error: /);
    expect(JSON.parse(t.stdout())).toMatchObject({ command: "import", engine: "14.0.7", result: "failed", exitCode: 1 });
    expect(transport.requests.map((request) => header(request, "SOAPAction"))).not.toContain("Logoff");
  });

  it("a server outside the window is refused naming the engines that fit, and --skip-version-check goes on with a warning", async () => {
    const variables = { VersionMajor: "10", VersionMinor: "0", VersionServicePack: "SP1", VersionBuild: "1", VersionServiceUpdate: "0" };
    const work = scratch();
    const refusal = testIo({ env: { ARAS_PASSWORD: "pw" }, transport: new FakeTransport(devServer({ variables })), cwd: work });
    expect(await run(args(work), refusal.io)).toBe(EXIT.failed);
    expect(refusal.stderr()).toContain("[ERROR] Exception of type 'Aras.Tools.SolutionUpgrade.CItemException' was thrown.");
    expect(refusal.stderr()).toContain("Engine 14.0.7 does not accept Aras server 10.0. Engines that accept it: 12.0.");
    expect(refusal.stderr()).toContain("--skip-version-check");

    const skipped = testIo({ env: { ARAS_PASSWORD: "pw" }, transport: new FakeTransport(devServer({ variables })), cwd: work });
    await run([...args(work), "--skip-version-check"], skipped.io);
    expect(skipped.stderr()).toContain("[WARN] Aras server 10.0 SP1 Build 1 is outside the window of engine 14.0.7; the run goes on because of --skip-version-check.");
  });

  it("a manifest that is not well-formed XML fails the run (exit 1), not the command line", async () => {
    const work = scratch();
    const broken = join(work, "imports.mf");
    writeFileSync(broken, "<imports><package");
    const t = testIo({ env: { ARAS_PASSWORD: "pw" }, cwd: work });
    const code = await run(["import", broken, "--url", "http://h", "--database", "d", "--user", "u"], t.io);
    expect(code).toBe(EXIT.failed);
    expect(t.stderr()).toMatch(/^aras-pkg import: /);
  });
});
