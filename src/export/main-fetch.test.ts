import { describe, expect, it } from "vitest";
import { DotNetException } from "../client/dotnet.js";
import { CItemHelper } from "../client/item-helper.js";
import { type ProbedException, describeException, loadProbe } from "../client/probe-fixture.js";
import { StubConnection, StubStop, stubResult } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import { CExportItems } from "./cexport-items.js";
import { ExportItem } from "./export-item.js";
import { defaultSelect, mainFetchRequest, requestedLevel } from "./main-fetch.js";

interface ExportRun {
  type: string;
  level: string | null;
  versionable: boolean;
  serverMajor: number;
  serverServicePack: number;
  id: string;
  requests: string[];
  actions: string[];
  stoppedByStub: boolean;
  thrown: ProbedException | null;
}

const probe = loadProbe("14.0.7");

/** `Run-Export` of the probe: answers the is_versionable and current-id lookups and stops at the first thing it does not script. */
async function runExport(run: ExportRun) {
  const stub = new StubConnection((request) => {
    if (request.includes('select="is_versionable"')) {
      return stubResult(`<Item type="ItemType" id="X"><is_versionable>${run.versionable ? "1" : "0"}</is_versionable></Item>`);
    }
    if (request.includes('select="config_id, is_current"')) {
      return stubResult(`<Item type="${run.type}" id="${run.id}"><config_id>CFG</config_id><is_current>1</is_current></Item>`);
    }
    return undefined;
  });
  const helper = new CItemHelper(stub);
  helper.innovatorVersion = new ArasVersion(run.serverMajor, 0, run.serverServicePack, 1, 0);
  let thrown: ProbedException | null = null;
  let stoppedByStub = false;
  try {
    await new CExportItems(helper).fetch(new ExportItem("k", run.id, run.type), run.level);
  } catch (error) {
    if (error instanceof StubStop) stoppedByStub = true;
    else thrown = describeException(error);
  }
  return { requests: stub.requests, actions: stub.actions, stoppedByStub, thrown };
}

/** The probe's four scenario families that run `Export` up to its main fetch. */
const scenarios = ["A.typeTable", "B.levels", "C.serverVersion", "D.versionable"].flatMap((name) =>
  (probe[name] as ExportRun[]).map((run, index) => ({ name: `${name}[${index}] ${run.type} level=${JSON.stringify(run.level)} v${run.serverMajor}.${run.serverServicePack}`, run })),
);

describe("the requests of Export up to the main fetch, replayed from the 14.0.7 probe (EXP-001, EXP-020 to EXP-025)", () => {
  it("has the probe's scenarios", () => {
    expect(scenarios.length).toBeGreaterThan(60);
  });

  it.each(scenarios)("$name", async ({ run }) => {
    const result = await runExport(run);
    expect(result.requests).toEqual(run.requests);
    expect(result.actions).toEqual(run.actions);
    expect(result.stoppedByStub).toBe(run.stoppedByStub);
    expect(result.thrown).toEqual(run.thrown);
  });
});

describe("the requested level (EXP-022)", () => {
  it.each([
    [null, "1"],
    [undefined, "1"],
    ["", "1"],
    [" \t\r\n  \u0085", "1"],
    [" 3 ", " 3 "],
    ["abc", "abc"],
    ["0", "0"],
  ])("%j becomes %j", (level, expected) => {
    expect(requestedLevel(level)).toBe(expected);
  });

  it("treats U+FEFF as text, as .NET's IsWhiteSpace does", () => {
    expect(requestedLevel("﻿")).toBe("﻿");
  });
});

describe("the default select (EXP-023)", () => {
  const select = "xp-*($value, @explicit, @permission_id), *[is_not_null()]";

  it.each([
    [14, 0, select],
    [12, 0, select],
    [11, 12, select],
    [11, 11, undefined],
    [11, 0, undefined],
    [10, 0, undefined],
  ])("server %i SP%i gets %j", (major, servicePack, expected) => {
    expect(defaultSelect(new ArasVersion(major, 0, servicePack, 1, 0))).toBe(expected);
  });

  it("is a NullReferenceException without a server version", () => {
    expect(() => defaultSelect(undefined)).toThrow(DotNetException);
    expect(() => mainFetchRequest("Part", "ID", "", undefined)).toThrow("Object reference not set to an instance of an object.");
  });

  it("is not asked for a type with a row of its own", () => {
    expect(mainFetchRequest("Action", "ID", "3", undefined)).toBe('<Item type="Action" action="get" levels="1"><id>ID</id></Item>');
  });
});

describe("the type table matches by ordinal string equality (EXP-026)", () => {
  it.each(["item report", "ITEM REPORT", "Item Report ", "constructor", "__proto__", "toString"])("%s takes the default row", (type) => {
    const request = mainFetchRequest(type, "ID", "2", new ArasVersion(14, 0, 9, 1, 0));
    expect(request).toContain(' levels="2" select="xp-*');
    expect(request).not.toContain("related_expand");
  });
});
