import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { run } from "../cli-run.js";
import { FakeTransport, respond } from "../client/fake-transport.js";
import { BLOBS_14_35, CASES_14_35 } from "../import/transcript-replay.js";
import { EXIT } from "./exit.js";
import { RecordedServer } from "./replay-transport.js";
import { testIo } from "./test-io.js";

/**
 * `aras-pkg import --languages`, end to end: the recorded 14.35 language-selection runs of ticket 75 served over HTTP to the CLI
 * (IMP-600 to IMP-635). The selection reaches the manager as `Languages`, which checks it against the server and cuts the packages.
 */

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const scratch = (): string => {
  const root = mkdtempSync(join(tmpdir(), "libsjs-cli-lang-"));
  roots.push(root);
  return root;
};

/** Runs `aras-pkg import --engine 14.35` over the first step of a recorded case, with the given extra arguments. */
async function importCase(name: string, extra: string[], command = "import") {
  const dir = join(CASES_14_35, name, "step-1");
  const calls = readTranscript(join(dir, "transcript.jsonl"), BLOBS_14_35);
  const recorded = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as { server: { url: string; database: string; user: string } };
  const osUser = /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";
  const server = new RecordedServer(calls);
  const work = scratch();
  const logPath = join(work, "engine.log");
  const t = testIo({ env: { ARAS_PASSWORD: "pw" }, transport: new FakeTransport(server.handler), cwd: work });
  const code = await run(
    [
      command,
      join(dir, "input", "imports.mf"),
      ...["--url", recorded.server.url, "--database", recorded.server.database, "--user", recorded.server.user],
      ...["--time-zone", "UTC", "--log", logPath, "--os-user", osUser, "--engine", "14.35"],
      ...extra,
    ],
    t.io,
  );
  return { code, t, server, logPath };
}

describe("import --languages, replaying the recorded runs", () => {
  it.each([
    ["lang-select-en", "en"],
    ["lang-star-installed", "*"],
    ["lang-star-en-only", "*"],
    ["lang-two-packages", "de,en"],
  ])("%s with --languages %s sends the recorded requests and exits 0", async (name, languages) => {
    const { code, server, t } = await importCase(name, ["--languages", languages]);
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(code).toBe(EXIT.ok);
    expect(t.stdout()).toContain(`languages: ${languages}\n`);
  });

  it("a language the server lacks fails the run before any item is read (lang-not-installed)", async () => {
    const { code, server, t } = await importCase("lang-not-installed", ["--languages", "en,xx"]);
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(code).toBe(EXIT.failed);
    expect(t.stderr()).toContain("Some of the selected languages are not installed for current Aras Innovator: xx.");
    expect(t.stdout()).toMatch(/\nresult: failed\nexitCode: 1\n/);
  });

  it("a malformed file in a package fails the run with the scan's exception, with no --languages at all (lang-scan-stray-file)", async () => {
    const { code, server, t } = await importCase("lang-scan-stray-file", []);
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(code).toBe(EXIT.failed);
    expect(t.stderr()).toContain("One or more errors occurred.\nData at the root level is invalid. Line 1, position 1.");
  });

  it("does not check en for a language-pack import, where the host does not (IMP-601)", async () => {
    // the import-language-pack command takes a language pack, not a manifest: only the argument checks are made here
    const t = testIo({ env: { ARAS_PASSWORD: "pw" }, transport: new FakeTransport(() => respond("", { status: 500 })), cwd: scratch() });
    const code = await run(
      ["import-language-pack", join(scratch(), "ImportConfig.xml"), "--lp-package", "LP", "--url", "http://h", "--database", "d", "--user", "u", "--engine", "14.35", "--languages", "de"],
      t.io,
    );
    expect(t.stderr()).not.toContain("--languages");
    expect(code).toBe(EXIT.failed);
  });
});

describe("what --languages refuses before any request is made", () => {
  const manifest = join(CASES_14_35, "lang-select-en", "step-1", "input", "imports.mf");
  const base = ["--url", "http://h/x", "--database", "d", "--user", "u", "--time-zone", "UTC"];

  async function refused(args: string[]) {
    const transport = new FakeTransport(() => respond("", { status: 500 }));
    const t = testIo({ env: { ARAS_PASSWORD: "pw" }, transport, cwd: scratch() });
    const code = await run(args, t.io);
    expect(transport.requests, "no request was made").toEqual([]);
    return { code, stderr: t.stderr() };
  }

  it.each(["14.0.7"])("engine %s, which has no language selection (IMP-600)", async (engine) => {
    const { code, stderr } = await refused(["import", manifest, ...base, "--engine", engine, "--languages", "en"]);
    expect(code).toBe(EXIT.usage);
    expect(stderr).toContain(`--languages needs --engine 14.35; engine ${engine} has no language selection on import`);
  });

  it("the default engine, which is 14.0.7", async () => {
    expect((await refused(["import", manifest, ...base, "--languages", "en"])).code).toBe(EXIT.usage);
  });

  it("a list without en, as the console host refuses it (IMP-601)", async () => {
    const { code, stderr } = await refused(["import", manifest, ...base, "--engine", "14.35", "--languages", "de"]);
    expect(code).toBe(EXIT.usage);
    expect(stderr).toContain("--languages must include en, unless the list starts with *");
  });

  it("an empty value", async () => {
    const { code, stderr } = await refused(["import", manifest, ...base, "--engine", "14.35", "--languages", ""]);
    expect(code).toBe(EXIT.usage);
    expect(stderr).toContain("--languages needs a list of language codes, or *");
  });

  it("lets a list that starts with *, or has en in any case, through to the run", async () => {
    for (const languages of ["*,de", "EN,de", "de,en"]) {
      const transport = new FakeTransport(() => respond("", { status: 500 }));
      const t = testIo({ env: { ARAS_PASSWORD: "pw" }, transport, cwd: scratch() });
      await run(["import", manifest, ...base, "--engine", "14.35", "--languages", languages], t.io);
      expect(t.stderr(), languages).not.toContain("--languages");
    }
  });
});

describe("the log of a refused run", () => {
  it("is not written when the constructor fails (IMP-612)", async () => {
    const { logPath } = await importCase("lang-scan-stray-file", []);
    expect(existsSync(logPath)).toBe(false);
  });
});
