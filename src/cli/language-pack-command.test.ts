import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { run } from "../cli-run.js";
import { FakeTransport, header, respond } from "../client/fake-transport.js";
import { EXIT } from "./exit.js";
import { RecordedServer } from "./replay-transport.js";
import { testIo } from "./test-io.js";

/**
 * `aras-pkg import-language-pack`, end to end: the recorded `lpimport` runs of ticket 45 served over HTTP to the CLI (LP-001). The
 * preprocessor's temporary package goes to the temp folder, which each test points at a folder of its own.
 */

const CASES = new URL("../../fixtures/14.0.7/language-pack/", import.meta.url).pathname;
const TAGS = { status: "INFO", warning: "WARN", error: "ERROR", currentPackage: "PKG", errorQuestion: "ERROR" } as const;
const TAGGED = /^\[(INFO|WARN|ERROR|PKG)\] /;

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

let temp = "";
beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "libsjs-cli-lp-"));
  roots.push(temp);
  vi.stubEnv("TMPDIR", temp);
  vi.stubEnv("TMP", temp);
  vi.stubEnv("TEMP", temp);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const headerValue = (log: string, label: string): string => new RegExp(`^${label}: (.*)\\r$`, "m").exec(log)?.[1] ?? "";

async function importLanguagePack(name: string, extra: string[] = []) {
  const dir = join(CASES, name);
  const definition = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as { lpPackage: string; lpDebug: boolean };
  const calls = readTranscript(join(dir, "transcript.jsonl"), join(CASES, "_blobs"));
  const recordedLog = readFileSync(join(dir, "engine.log"), "utf8");
  const osUser = /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";
  const server = new RecordedServer(calls);
  const transport = new FakeTransport(server.handler);
  const logPath = join(temp, "engine.log");
  const t = testIo({ env: { ARAS_PASSWORD: "pw" }, transport, cwd: temp });
  const code = await run(
    [
      "import-language-pack",
      join(dir, "lp", "ImportConfig.xml"),
      ...["--lp-package", definition.lpPackage],
      ...["--url", headerValue(recordedLog, "URL"), "--database", headerValue(recordedLog, "Database"), "--user", headerValue(recordedLog, "User")],
      ...["--time-zone", "UTC", "--log", logPath, "--os-user", osUser],
      ...(definition.lpDebug ? ["--lp-debug"] : []),
      ...extra,
    ],
    t.io,
  );
  const expected = readFileSync(join(dir, "messages.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { channel: keyof typeof TAGS; text: string })
    .flatMap(({ channel, text }) => `[${TAGS[channel]}] ${text}`.split("\n"))
    .filter((line) => TAGGED.test(line));
  return { code, t, server, transport, logPath, expected, definition };
}

describe.for(["lp01", "lp02", "lp03", "lp04", "lp05"].map((name) => [name] as const))("import-language-pack, replaying %s", ([name]) => {
  it("exits 0, sends the recorded requests and messages, and logs out once", async () => {
    const { code, t, server, transport, expected } = await importLanguagePack(name);
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(code).toBe(EXIT.ok);
    expect(t.stderr().split("\n").filter((line) => TAGGED.test(line))).toEqual(expected);
    const actions = transport.requests.map((request) => header(request, "SOAPAction"));
    expect(actions.filter((action) => action === "Logoff")).toHaveLength(1);
    expect(actions.at(-1)).toBe("Logoff");
  });

  it("makes the language package and keeps it only for --lp-debug", async () => {
    const { logPath, definition } = await importLanguagePack(name);
    const left = readdirSync(temp).filter((entry) => entry.startsWith("LanguagePack_"));
    expect(left).toHaveLength(definition.lpDebug ? 1 : 0);
    expect(readFileSync(logPath, "utf8")).toContain("Start of importing packages");
  });

  it("prints the summary with the engine and the package", async () => {
    const { t, definition } = await importLanguagePack(name, ["--json"]);
    expect(JSON.parse(t.stdout())).toMatchObject({
      command: "import-language-pack",
      engine: "14.0.7",
      result: "success",
      exitCode: 0,
      package: definition.lpPackage,
    });
  });
});

describe("what import-language-pack refuses", () => {
  const base = ["--url", "http://h/x", "--database", "d", "--user", "u"];

  async function refused(args: string[]) {
    const transport = new FakeTransport(() => respond("", { status: 500 }));
    const t = testIo({ env: { ARAS_PASSWORD: "pw" }, transport, cwd: temp });
    const code = await run(args, t.io);
    expect(transport.requests, "no request was made").toEqual([]);
    return { code, t };
  }

  it("engine 12.0, which has no language-pack import: a usage error (64)", async () => {
    const { code, t } = await refused(["import-language-pack", "ImportConfig.xml", "--lp-package", "P", ...base, "--engine", "12.0"]);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("engine 12.0 has no language-pack import");
  });

  it("engine 12.0 from ARAS_PKG_ENGINE, too", async () => {
    const t = testIo({ env: { ARAS_PASSWORD: "pw", ARAS_PKG_ENGINE: "12.0" } });
    expect(await run(["import-language-pack", "ImportConfig.xml", "--lp-package", "P", ...base], t.io)).toBe(EXIT.usage);
  });

  it("engine 14.35, whose import is not built yet: not yet supported (1)", async () => {
    const { code, t } = await refused(["import-language-pack", "ImportConfig.xml", "--lp-package", "P", ...base, "--engine", "14.35"]);
    expect(code).toBe(EXIT.failed);
    expect(t.stderr()).toContain("engine 14.35 is not yet supported");
  });

  it("a missing language pack or package name", async () => {
    expect((await refused(["import-language-pack", ...base, "--lp-package", "P"])).code).toBe(EXIT.usage);
    const { code, t } = await refused(["import-language-pack", "ImportConfig.xml", ...base]);
    expect(code).toBe(EXIT.usage);
    expect(t.stderr()).toContain("needs --lp-package <name>");
  });

  it("a language pack that is not there fails the run after the login (the preprocessor's own failure), exit 1", async () => {
    const recorded = readTranscript(join(CASES, "lp01", "transcript.jsonl"), join(CASES, "_blobs"));
    const server = new RecordedServer(recorded);
    const t = testIo({ env: { ARAS_PASSWORD: "pw" }, transport: new FakeTransport(server.handler), cwd: temp });
    const code = await run(["import-language-pack", join(temp, "missing", "ImportConfig.xml"), "--lp-package", "P", ...base, "--time-zone", "UTC", "--log", join(temp, "e.log")], t.io);
    expect(code).toBe(EXIT.failed);
    expect(t.stderr()).toMatch(/\[ERROR\] .*ImportConfig\.xml/);
    expect(readFileSync(join(temp, "e.log"), "utf8")).toContain("ImportConfig.xml");
  });
});
