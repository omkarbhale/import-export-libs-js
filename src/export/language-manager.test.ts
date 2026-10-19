import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CItemException } from "../client/fault.js";
import { CItemHelper, EngineNotSupportedError } from "../client/item-helper.js";
import { getLanguagesFromInnovator } from "../client/language-lookups.js";
import { StubConnection, stubFault, stubResult } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import { LANGUAGE_RESOURCES_ONLY, LANGUAGE_RESOURCES_WITH_METADATA, SUExportContext } from "./export-context.js";
import { ImportExportManager } from "./import-export-manager.js";
import { type LangScript, langResponse } from "./language-probe.js";
import { createMessagesFactory } from "./messages.js";

/**
 * The port's shape of the engine's constructor (LP-110): `create` does the language work that needs the server, and a manager made with
 * `new` does it before its first run. The cases themselves are in `language-requests.test.ts`, against the probe.
 */
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const helperOver = (connection: StubConnection, engine: "14.0.7" | "14.35" = "14.35"): CItemHelper => {
  const helper = new CItemHelper(connection, { engine });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 1, 0);
  return helper;
};

function contextOf(action: string, languages: string[] | null): { context: SUExportContext; working: string } {
  const working = mkdtempSync(join(tmpdir(), "libsjs-langmgr-"));
  roots.push(working);
  const context = new SUExportContext();
  context.action = action;
  context.languages = languages;
  context.workingDirectory = working;
  context.logFilePath = join(working, "engine.log");
  return { context, working };
}

const SERVER: LangScript = { languageCodes: ["en", "de", "fr"] };

describe("ImportExportManager.create and prepare (LP-110)", () => {
  it("resolves the list of the context it was given, in place", async () => {
    const { context, working } = contextOf(LANGUAGE_RESOURCES_ONLY, ["*"]);
    const stub = new StubConnection((request) => langResponse(SERVER, request));
    await ImportExportManager.create(context, createMessagesFactory({ engine: "14.35" }), helperOver(stub), { cwd: working });
    expect(context.languages).toEqual(["de", "fr"]);
    expect(stub.requests).toHaveLength(2);
  });

  it("checks the languages of a manager made with new before its first run, and leaves no log behind", async () => {
    const { context, working } = contextOf(LANGUAGE_RESOURCES_WITH_METADATA, ["de", "xx"]);
    const stub = new StubConnection((request) => langResponse(SERVER, request));
    const manager = new ImportExportManager(context, createMessagesFactory({ engine: "14.35" }), helperOver(stub), { cwd: working });
    expect(stub.requests).toHaveLength(0);
    const failure = await manager.exportSolutions(context, []).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CItemException);
    expect((failure as CItemException).message).toContain("not installed for current Aras Innovator: xx.");
    expect(existsSync(context.logFilePath as string)).toBe(false);
    // the failure is kept: asking again does not send the requests again
    const requests = stub.requests.length;
    await expect(manager.prepare()).rejects.toBe(failure);
    expect(stub.requests).toHaveLength(requests);
  });

  it("does nothing for a plain export of an engine without the setting", async () => {
    const { context, working } = contextOf("Export", ["fr"]);
    const stub = new StubConnection((request) => langResponse(SERVER, request));
    await ImportExportManager.create(context, createMessagesFactory({ engine: "14.0.7" }), helperOver(stub, "14.0.7"), { cwd: working });
    expect(stub.requests).toHaveLength(0);
    expect(context.languages).toEqual(["fr"]);
  });

  it.each([LANGUAGE_RESOURCES_ONLY, LANGUAGE_RESOURCES_WITH_METADATA])("refuses %s on an engine that lacks the mode (LP-100)", async (action) => {
    const { context, working } = contextOf(action, ["de"]);
    const stub = new StubConnection((request) => langResponse(SERVER, request));
    await expect(
      ImportExportManager.create(context, createMessagesFactory({ engine: "14.0.7" }), helperOver(stub, "14.0.7"), { cwd: working }),
    ).rejects.toBeInstanceOf(EngineNotSupportedError);
    expect(stub.requests).toHaveLength(0);
  });
});

describe("GetLanguagesFromInnovator (LP-115)", () => {
  const languages = (answer: string): Promise<Awaited<ReturnType<typeof getLanguagesFromInnovator>>> =>
    getLanguagesFromInnovator(helperOver(new StubConnection(() => answer)).inn);

  it("lower-cases the codes and keeps the order and the names", async () => {
    const found = await languages(
      stubResult('<Item type="Language" id="1"><code>DE</code><name>German</name></Item><Item type="Language" id="2"><code>Zh-CN</code></Item>'),
    );
    expect(found).toEqual([
      { code: "de", name: "German" },
      { code: "zh-cn", name: null },
    ]);
  });

  it("gives none for a fault of any code", async () => {
    expect(await languages(stubFault("0", "No items of type Language found."))).toEqual([]);
    expect(await languages(stubFault("1", "boom"))).toEqual([]);
  });

  it("throws the unwrapped NullReferenceException for a Language without a code (LP-181)", async () => {
    const failure = await languages(stubResult('<Item type="Language" id="1"><name>x</name></Item>')).catch((error: unknown) => error);
    expect(failure).toMatchObject({ typeName: "System.NullReferenceException" });
  });
});
