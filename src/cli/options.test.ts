import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EngineNotSupportedError } from "../client/engine-support.js";
import { CONNECTION_OPTIONS, parseOptions, requireEngine, resolveConnection, resolveEngine, resolveLogPath } from "./options.js";
import { testIo } from "./test-io.js";
import { UsageError } from "./usage.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const parse = (...args: string[]) => parseOptions(args, CONNECTION_OPTIONS).values;

describe("the engine", () => {
  it("defaults to 14.0.7", () => {
    expect(resolveEngine(parse(), testIo().io)).toBe("14.0.7");
  });

  it("comes from ARAS_PKG_ENGINE, and a flag wins over it", () => {
    const t = testIo({ env: { ARAS_PKG_ENGINE: "14.35" } });
    expect(resolveEngine(parse(), t.io)).toBe("14.35");
    expect(resolveEngine(parse("--engine", "12.0"), t.io)).toBe("12.0");
  });

  it("refuses a name that is not an engine, naming the engines", () => {
    expect(() => resolveEngine(parse("--engine", "13"), testIo().io)).toThrow(/unknown engine '13'.*12\.0, 14\.0\.7, 14\.35/);
  });

  it("reports an engine without its variant slice as not yet supported", () => {
    expect(() => requireEngine("12.0", ["14.0.7"])).toThrow(EngineNotSupportedError);
    expect(() => requireEngine("12.0", ["14.0.7"])).toThrow("engine 12.0 is not yet supported");
    expect(() => requireEngine("14.0.7", ["14.0.7"])).not.toThrow();
  });
});

describe("the connection", () => {
  const env = { ARAS_URL: "http://h/x", ARAS_DATABASE: "db", ARAS_USER: "admin", ARAS_PASSWORD: "secret" };

  it("comes from the environment", async () => {
    const connection = await resolveConnection(parse(), testIo({ env }).io);
    expect(connection).toEqual({
      url: "http://h/x",
      database: "db",
      user: "admin",
      password: "secret",
      timeout: 0,
      timeZoneName: undefined,
      skipVersionCheck: false,
    });
  });

  it("takes a flag over the variable", async () => {
    const connection = await resolveConnection(parse("--url", "http://other/", "--user", "u2"), testIo({ env }).io);
    expect(connection.url).toBe("http://other/");
    expect(connection.user).toBe("u2");
    expect(connection.database).toBe("db");
  });

  it("names everything that is missing at once", async () => {
    await expect(resolveConnection(parse(), testIo().io)).rejects.toThrow(
      "missing --url (or ARAS_URL), --database (or ARAS_DATABASE), --user (or ARAS_USER), the password (ARAS_PASSWORD, or --password-stdin)",
    );
  });

  it("reads the password from standard input, less one final line end, and ignores ARAS_PASSWORD", async () => {
    const t = testIo({ env, stdin: "from stdin\r\n" });
    expect((await resolveConnection(parse("--password-stdin"), t.io)).password).toBe("from stdin");
  });

  it("keeps the other white space of a password from standard input", async () => {
    const t = testIo({ env, stdin: " a b \n\n" });
    expect((await resolveConnection(parse("--password-stdin"), t.io)).password).toBe(" a b \n");
  });

  it("refuses an empty password from standard input", async () => {
    await expect(resolveConnection(parse("--password-stdin"), testIo({ env, stdin: "\n" }).io)).rejects.toThrow(UsageError);
  });

  it("has no flag for the password", () => {
    expect(() => parse("--password", "x")).toThrow(UsageError);
  });

  it("parses the timeout: 0, a number of milliseconds, or -1 for no limit", async () => {
    const timeout = async (...args: string[]) => (await resolveConnection(parse(...args), testIo({ env }).io)).timeout;
    expect(await timeout()).toBe(0);
    expect(await timeout("--timeout", "600000")).toBe(600000);
    expect(await timeout("--timeout=-1")).toBe(-1);
  });

  it.for(["abc", "1.5", "-2", ""])("refuses the timeout '%s'", async (value) => {
    await expect(resolveConnection(parse(`--timeout=${value}`), testIo({ env }).io)).rejects.toThrow(/--timeout needs a whole number/);
  });

  it("reads --time-zone", async () => {
    expect((await resolveConnection(parse("--time-zone", "UTC"), testIo({ env }).io)).timeZoneName).toBe("UTC");
  });

  it("reads --skip-version-check", async () => {
    expect((await resolveConnection(parse("--skip-version-check"), testIo({ env }).io)).skipVersionCheck).toBe(true);
  });
});

describe("the log path", () => {
  it("defaults to a dated file in the current directory", () => {
    const t = testIo({ cwd: mkdtempSync(join(tmpdir(), "libsjs-cli-")) });
    roots.push(t.io.cwd());
    expect(resolveLogPath(parse(), "import", t.io)).toBe(join(t.io.cwd(), "aras-pkg-import-20261019-080503.log"));
  });

  it("is --log, and its folder is made", () => {
    const root = mkdtempSync(join(tmpdir(), "libsjs-cli-"));
    roots.push(root);
    const path = join(root, "a", "b", "run.log");
    expect(resolveLogPath(parse("--log", path), "import", testIo().io)).toBe(path);
    expect(existsSync(join(root, "a", "b"))).toBe(true);
  });

  it("refuses a log folder that cannot be made", () => {
    const root = mkdtempSync(join(tmpdir(), "libsjs-cli-"));
    roots.push(root);
    expect(() => resolveLogPath(parse("--log", join(root, "x\0y", "run.log")), "import", testIo().io)).toThrow(/the log folder cannot be made/);
  });
});
