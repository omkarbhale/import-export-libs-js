import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { CItemHelper } from "../client/item-helper.js";
import { ArasVersion } from "../client/version.js";
import { SolutionUpgradeContext } from "../export/export-context.js";
import { createMessagesFactory } from "../export/messages.js";
import { SUImportContext } from "../import/import-context.js";
import { languagePackImport } from "./lp-import.js";
import { leftBehindTempFolder } from "./preprocessor.js";
import { DEFAULT_LANGUAGES, cfg } from "./probe-harness.js";

/**
 * The failures of the `lpimport` sequence (LP-001, LP-003, LP-034, LP-035): what is logged, what is rethrown, what stays on disk,
 * and what the `finally` does. The whole successful runs are replayed in `lp-import.replay.test.ts`.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

class FakeConnection implements ServerConnection {
  readonly actions: string[] = [];

  async callAction(action: string): Promise<ResponseDocument> {
    this.actions.push(action);
    return ResponseDocument.parse(DEFAULT_LANGUAGES);
  }
}

function setup(engine: "14.0.7" | "14.35" = "14.0.7") {
  const root = mkdtempSync(join(tmpdir(), "libsjs-lp-run-"));
  roots.push(root);
  const tempRoot = join(root, "tmp");
  const pack = join(root, "pack");
  mkdirSync(tempRoot);
  mkdirSync(join(pack, "xml"), { recursive: true });
  writeFileSync(join(pack, "ImportConfig.xml"), cfg("de", ['<itemtype name="Foo"/>']));
  writeFileSync(join(pack, "xml", "Foo.xml"), '<export><Item type="Foo" id="A1"><property __name="name" de="Hallo"/></Item></export>');

  const context = new SolutionUpgradeContext();
  context.action = "LPImport";
  context.url = "http://localhost/db";
  context.dataBase = "db";
  context.userName = "root";
  context.workingDirectory = root;
  context.logFilePath = join(root, "engine.log");
  context.lpPath = join(pack, "ImportConfig.xml");
  context.lpPackage = "PKG";
  const helper = new CItemHelper(new FakeConnection(), { engine });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  let loggedOut = 0;
  helper.logout = async () => void (loggedOut += 1);
  return {
    root,
    tempRoot,
    pack,
    context,
    helper,
    loggedOut: () => loggedOut,
    options: { cwd: root, tempPath: `${tempRoot}/`, randomFileName: () => "abcdefgh.xyz" },
  };
}

const messages = createMessagesFactory();

describe("LP-003 LP-035: a failure of the preprocessor", () => {
  it("is logged as a line, thrown again unchanged, leaves the temp package and the context as it was, and still logs out", async () => {
    const s = setup();
    s.context.lpPath = join(s.pack, "missing.xml");
    let failure: unknown;
    try {
      await languagePackImport(s.context, new SUImportContext(), messages, s.helper, s.options);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ name: "FileNotFoundException", message: `File not found : ${join(s.pack, "missing.xml")}.` });
    expect(readFileSync(s.context.logFilePath as string, "utf8")).toBe(
      `System.IO.FileNotFoundException: File not found : ${join(s.pack, "missing.xml")}.\r\n`,
    );
    expect(leftBehindTempFolder(failure)).toBe(join(s.tempRoot, "LanguagePack_abcdefgh.xyz"));
    expect(readdirSync(s.tempRoot)).toEqual(["LanguagePack_abcdefgh.xyz"]);
    expect(s.context.action).toBe("LPImport");
    expect(s.context.manifestFile).toBeNull();
    expect(s.loggedOut()).toBe(1);
  });

  it("reports the failure even when the log cannot be written", async () => {
    const s = setup();
    s.context.lpPath = join(s.pack, "missing.xml");
    s.context.logFilePath = join(s.root, "no-such-folder", "engine.log");
    await expect(languagePackImport(s.context, new SUImportContext(), messages, s.helper, s.options)).rejects.toThrow("File not found");
  });
});

describe("LP-001 LP-034: a failure after the preprocessor", () => {
  it("makes the context an import of the temp manifest, then disposes the temp package after logging out", async () => {
    const s = setup();
    await expect(languagePackImport(s.context, null as unknown as SUImportContext, messages, s.helper, s.options)).rejects.toThrow(
      "Value cannot be null.\r\nParameter name: importContext",
    );
    expect(s.context.action).toBe("Import");
    expect(s.context.manifestFile).toBe(`${s.tempRoot}/LanguagePack_abcdefgh.xyz\\imports.mf`);
    expect(readFileSync(s.context.logFilePath as string, "utf8")).toContain(
      "System.ArgumentNullException: Value cannot be null.\r\nParameter name: importContext\r\n",
    );
    expect(s.loggedOut()).toBe(1);
    expect(readdirSync(s.tempRoot)).toEqual([]);
  });

  it("keeps the temp package with lpdebug", async () => {
    const s = setup();
    s.context.lpDebug = true;
    await expect(languagePackImport(s.context, null as unknown as SUImportContext, messages, s.helper, s.options)).rejects.toThrow();
    expect(readdirSync(s.tempRoot)).toEqual(["LanguagePack_abcdefgh.xyz"]);
  });
});

describe("LP-003 [14.35]: the catch is split", () => {
  function withConsole(s: ReturnType<typeof setup>) {
    let text = "";
    return {
      options: { ...s.options, console: { write: (chunk: string) => void (text += chunk), writeLine: (chunk = "") => void (text += `${chunk}\r\n`) } },
      text: () => text,
    };
  }

  it("logs a CItemException, writes Error: and its message with no line break, and returns 1 (IMP-621)", async () => {
    const s = setup("14.35");
    s.context.languages = ["xx"];
    const out = withConsole(s);
    const code = await languagePackImport(s.context, new SUImportContext(), messages, s.helper, out.options);
    const message =
      "Some of the selected languages are not installed for current Aras Innovator: xx.\r\nPlease, install missing languages or remove them from import package before proceeding.";
    expect(code).toBe(1);
    expect(out.text()).toBe(`Error: ${message}`);
    expect(readFileSync(s.context.logFilePath as string, "utf8")).toBe(`Aras.Tools.SolutionUpgrade.CItemException: ${message}\r\n`);
    expect(s.loggedOut()).toBe(1);
    expect(readdirSync(s.tempRoot)).toEqual([]);
  });

  it("accepts a selection without en for a language pack, which the host does not check (IMP-640)", async () => {
    const s = setup("14.35");
    s.context.languages = ["de"];
    const out = withConsole(s);
    await expect(languagePackImport(s.context, null as unknown as SUImportContext, messages, s.helper, out.options)).rejects.toThrow(
      "Parameter name: importContext",
    );
    expect(s.context.languages).toEqual(["de"]);
  });

  it("logs and throws again every other exception, and the scan of a dotted package name fails the constructor (LP-033, IMP-612)", async () => {
    const s = setup("14.35");
    s.context.lpPackage = "My.Pkg";
    const out = withConsole(s);
    const failure = await languagePackImport(s.context, new SUImportContext(), messages, s.helper, out.options).catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: "DirectoryNotFoundException" });
    expect(out.text()).toBe("");
    expect(readFileSync(s.context.logFilePath as string, "utf8")).toMatch(/^System\.IO\.DirectoryNotFoundException: Could not find a part of the path '.*Pkg.Import'\.\r\n$/);
    expect(s.loggedOut()).toBe(1);
    expect(readdirSync(s.tempRoot)).toEqual([]);
  });
});
