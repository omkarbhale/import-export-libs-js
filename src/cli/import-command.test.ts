import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { run } from "../cli-run.js";
import { FakeTransport, devServer, header, respond, soapFault } from "../client/fake-transport.js";
import { BLOBS, CASES } from "../import/transcript-replay.js";
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
  options: { merge?: boolean; release?: string; description?: string; verbose?: boolean };
}

function step(name: string, index: number): Step {
  const definition = JSON.parse(readFileSync(join(CASES, name, "case.json"), "utf8")) as { steps: Pick<Step, "options">[] };
  return { name: `${name}/step-${index}`, dir: join(CASES, name, `step-${index}`), options: definition.steps[index - 1]?.options ?? {} };
}

const SUCCESS = [step("s0-mini-defaults", 1), step("s0-mini-merge", 1), step("s0-mini-release-description", 1), step("s0-mini-verbose", 1)];
const FAILURE = [step("s3-unres-reltype-nested", 1), step("s4-del-refused", 2)];

/** Runs `aras-pkg import` over a recorded step, with the options the step was recorded with. */
async function importStep(recorded: Step, extra: string[] = []) {
  const calls = readTranscript(join(recorded.dir, "transcript.jsonl"), BLOBS);
  const recordedLog = readFileSync(join(recorded.dir, "engine.log"), "utf8");
  const osUser = /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";
  const server = new RecordedServer(calls);
  const transport = new FakeTransport(server.handler);
  const work = scratch();
  const logPath = join(work, "engine.log");
  const t = testIo({ env: { ARAS_PASSWORD: "pw" }, transport, cwd: work });
  const { options } = recorded;
  const args = [
    "import",
    join(recorded.dir, "input", "imports.mf"),
    ...["--url", headerValue(recordedLog, "URL"), "--database", headerValue(recordedLog, "Database"), "--user", headerValue(recordedLog, "User")],
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
    expect(t.stdout()).not.toContain("pw");
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
    expect(JSON.stringify(summary)).not.toContain("pw");
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

  it.for(["12.0", "14.35"])("engine %s, whose import is not built yet, is reported as not yet supported (exit 1)", async (engine) => {
    const { code, t } = await refused(["import", manifest, ...base, "--engine", engine]);
    expect(code).toBe(EXIT.failed);
    expect(t.stderr()).toContain(`engine ${engine} is not yet supported`);
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
