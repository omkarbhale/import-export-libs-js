import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HttpConnectorExtension } from "./connection.js";
import { DotNetException } from "./dotnet.js";
import { FakeTransport } from "./fake-transport.js";
import { CItemException } from "./fault.js";
import { CItemHelper } from "./item-helper.js";
import { isMd5Hash, isSha256Hash, md5Digest, sha256Digest } from "./digest.js";
import { ScriptedConnection, fault } from "./scripted-connection.js";
import { stubFault, stubResult } from "./stub-connection.js";
import { TransportError } from "./transport.js";
import type { ArasVersion } from "./version.js";

/**
 * `fixtures/wire/14.35-probe/probe.json` is what the real 14.35 `CItemHelper`, `CItemException` and IOM 15 do against a
 * stub connection that answers from a script (ticket 69). The same scripts run here against the client.
 */
const PROBE = JSON.parse(readFileSync(new URL("../../fixtures/wire/14.35-probe/probe.json", import.meta.url), "utf8")) as {
  scenarios: Record<string, Record<string, any>>;
};

/** What the probe records of an exception it caught (`Desc`). */
function describeThrown(error: unknown): Record<string, unknown> | null {
  if (error === null) return null;
  if (error instanceof CItemException) {
    return { type: "Aras.Tools.SolutionUpgrade.CItemException", faultcode: error.faultcode, faultstring: error.faultstring, message: error.message };
  }
  if (error instanceof DotNetException) return { type: error.typeName, message: error.message };
  throw error;
}

/** The probe records long texts clipped, so a text matches when it starts like the recorded one. */
function expectThrown(actual: Record<string, unknown> | null, recorded: Record<string, any> | null): void {
  if (recorded === null) {
    expect(actual).toBeNull();
    return;
  }
  expect(actual).not.toBeNull();
  expect(actual!["type"]).toBe(recorded["type"]);
  expect(actual!["faultcode"]).toBe(recorded["faultcode"]);
  for (const key of ["faultstring", "message"]) {
    if (recorded[key] !== undefined) expect(String(actual![key]).startsWith(recorded[key])).toBe(true);
  }
}

const versionText = (version: ArasVersion | undefined): string | null => version?.fullString ?? null;

/** The probe's `Probe-Responder`: the answer to the four probe requests from a map of Variable values. */
function probeResponder(vars: Record<string, string | null>): (action: string, request: string) => string {
  return (_action, request) => {
    const names = [...request.matchAll(/<name>(Version\w+)<\/name>/g)].map((m) => m[1] ?? "");
    let rows = "";
    for (const name of names) {
      if (!(name in vars)) continue;
      const value = vars[name];
      if (value === "FAULT0") return stubFault("0", "No items of type Variable found.");
      if (value === "FAULT500") return stubFault("500", "boom");
      rows += `<Item type="Variable" id="V${name}"><name>${name}</name>${value === null ? "" : `<value>${value}</value>`}</Item>`;
    }
    return rows === "" ? stubFault("0", "No items of type Variable found.") : stubResult(rows);
  };
}

async function runLogin(vars: Record<string, string | null>, engine: "14.0.7" | "14.35" = "14.35") {
  const connection = new ScriptedConnection({ engine, respond: probeResponder(vars) });
  const helper = new CItemHelper(connection, { engine });
  let thrown: unknown = null;
  try {
    await helper.login();
  } catch (error) {
    thrown = error;
  }
  return { connection, helper, thrown };
}

describe("14.35 probe, A: the version probe and what it reads (WIRE-020, WIRE-021, WIRE-054)", () => {
  it.each(Object.keys(PROBE.scenarios["A.probe"]!))("%s", async (name) => {
    const recorded = PROBE.scenarios["A.probe"]![name]!;
    const { connection, helper, thrown } = await runLogin(recorded["vars"]);
    expect(connection.requests).toEqual(recorded["requests"]);
    expect(connection.actions).toEqual(recorded["actions"]);
    expectThrown(describeThrown(thrown), recorded["thrown"]);
    expect(helper.isConnected).toBe(recorded["isConnected"]);
    expect(versionText(helper.innovatorVersion)).toBe(recorded["innovatorVersion"]?.fullString ?? null);
    if (recorded["innovatorVersion"]) {
      const { major, minor, servicePack, build, serviceUpdate } = recorded["innovatorVersion"];
      expect(helper.innovatorVersion).toMatchObject({ major, minor, servicePack, build, serviceUpdate });
    }
  });
});

/** The same probe against 14.0.7 (`fixtures/wire/14.0.7-probe/`): the version is read the same way; only the exception texts differ. */
describe("14.0.7 probe, A: the version probe and what it reads (WIRE-020, WIRE-021, WIRE-054)", () => {
  const recordedAll = (
    JSON.parse(readFileSync(new URL("../../fixtures/wire/14.0.7-probe/probe.json", import.meta.url), "utf8")) as {
      scenarios: Record<string, Record<string, any>>;
    }
  ).scenarios["A.probe"]!;

  it.each(Object.keys(recordedAll))("%s", async (name) => {
    const recorded = recordedAll[name]!;
    const { connection, helper, thrown } = await runLogin(recorded["vars"], "14.0.7");
    expect(connection.requests).toEqual(recorded["requests"]);
    const actual = describeThrown(thrown);
    expect(actual?.["type"] ?? null).toBe(recorded["thrown"]?.type ?? null);
    expect(actual?.["faultcode"]).toBe(recorded["thrown"]?.faultcode);
    expect(versionText(helper.innovatorVersion)).toBe(recorded["innovatorVersion"]?.fullString ?? null);
  });
});

describe("14.35 probe, B: the gate (WIRE-022 to WIRE-024)", () => {
  it.each(Object.keys(PROBE.scenarios["B.gate"]!))("server %s", async (name) => {
    const recorded = PROBE.scenarios["B.gate"]![name]!;
    const { helper, thrown } = await runLogin(recorded["vars"]);
    expectThrown(describeThrown(thrown), recorded["thrown"]);
    expect(helper.isConnected).toBe(recorded["isConnected"]);
    expect(versionText(helper.innovatorVersion)).toBe(recorded["innovatorVersion"].fullString);
  });
});

describe("14.35 probe, C: login faults (WIRE-017, WIRE-056)", () => {
  it.each(Object.keys(PROBE.scenarios["C.loginFaults"]!))("%s", async (name) => {
    const recorded = PROBE.scenarios["C.loginFaults"]![name]!;
    const connection = new ScriptedConnection({ login: () => recorded["fault"] });
    const helper = new CItemHelper(connection, { engine: "14.35" });
    let thrown: unknown = null;
    try {
      await helper.login();
    } catch (error) {
      thrown = error;
    }
    expect(connection.requests).toEqual(recorded["requests"]);
    expectThrown(describeThrown(thrown), recorded["thrown"]);
    expect(helper.isConnected).toBe(recorded["isConnected"]);
    expect(versionText(helper.innovatorVersion)).toBe(recorded["innovatorVersion"]);
  });

  it("builds the same faults as the client does for the OAuth server and for a transport failure", async () => {
    const scenarios = PROBE.scenarios["C.loginFaults"]!;
    expect(fault("invalid_grant", "Authentication failed for u", "OAuthServer")).toBe(scenarios["oauth-invalid-grant"]!["fault"]);
    expect(fault("999", "System.Net.WebException: The operation has timed out")).toBe(scenarios["io-999-transport"]!["fault"]);
    const transport = new FakeTransport(() => {
      throw new TransportError("timeout", "The operation has timed out", "stub.example");
    });
    const made = await new HttpConnectorExtension({ engine: "14.35", url: "http://stub.example/db", database: "db", userName: "u", password: "p", transport }).login();
    expect(made.outerXml).toBe(fault("999", "System.Threading.Tasks.TaskCanceledException: A task was canceled."));
  });
});

describe("14.35 probe, D: applyAML's exceptions (WIRE-006, WIRE-051)", () => {
  const responses: Record<string, string> = {
    "fault-0": stubFault("0", "No items of type Part found."),
    "fault-999": stubFault("SOAP-ENV:Server", "boom & <b>"),
    "fault-attr-and-text": stubFault("1", "Plain text fault"),
    "not-a-single-item": stubResult(""),
    "malformed-request": stubResult(""),
  };

  it.each(Object.keys(PROBE.scenarios["D.applyAML"]!))("%s", async (name) => {
    const recorded = PROBE.scenarios["D.applyAML"]![name]!;
    const connection = new ScriptedConnection({ respond: () => responses[name]! });
    const helper = new CItemHelper(connection, { engine: "14.35" });
    let thrown: unknown = null;
    let returned: string | undefined;
    try {
      returned = (await helper.applyAML(recorded["aml"])).outerXml;
    } catch (error) {
      thrown = error;
    }
    // The probe's stub did not record the requests of this scenario (`requests` is empty even where one was sent).
    if (recorded["thrown"]) {
      const actual = describeThrown(thrown) as Record<string, unknown>;
      expectThrown(actual, recorded["thrown"]);
      if (thrown instanceof CItemException) expect((thrown.faultdetail ?? "").startsWith(recorded["thrown"].faultdetail)).toBe(true);
    } else {
      expect(thrown).toBeNull();
      expect(returned!.startsWith(recorded["returned"].slice(0, 120))).toBe(true);
    }
  });
});

describe("14.35 probe, E: logout and IsConnected (WIRE-040)", () => {
  it("a connection of another type is forgotten without a request, and a second logout does nothing", async () => {
    const recorded = PROBE.scenarios["E.logout"]!["stub-connection"]!;
    const connection = new ScriptedConnection({});
    const helper = new CItemHelper(connection, { engine: "14.35" });
    expect(helper.isConnected).toBe(recorded["isConnectedBefore"]);
    await helper.logout();
    expect(helper.isConnected).toBe(recorded["isConnectedAfter"]);
    expect(connection.requests).toEqual(recorded["requests"]);
    await expect(helper.logout()).resolves.toBeUndefined();
  });

  it("an HttpConnectorExtension whose server refuses connections: the failure is swallowed", async () => {
    const recorded = PROBE.scenarios["E.logout"]!["http-connector-extension-unreachable"]!;
    const transport = new FakeTransport(() => {
      throw new TransportError("refused", "Unable to connect to the remote server", "127.0.0.1");
    });
    const connection = new HttpConnectorExtension({ engine: "14.35", url: "http://127.0.0.1:9/probe", database: "db", userName: "u", password: "p", transport });
    const helper = new CItemHelper(connection, { engine: "14.35" });
    await expect(helper.logout()).resolves.toBeUndefined();
    expect(helper.isConnected).toBe(recorded["isConnectedAfter"]);
    expect(recorded["thrown"]).toBeNull();
  });
});

describe("14.35 probe, F: IOM 15's password helpers (WIRE-014, WIRE-055)", () => {
  const recorded = PROBE.scenarios["F.iomHelpers"]!;
  const nonAscii = "päss€";

  it("digests the ASCII bytes: non-ASCII characters hash as question marks", () => {
    expect(md5Digest("abc")).toBe(recorded["md5(abc)"]);
    expect(md5Digest(nonAscii)).toBe(recorded["md5(non-ascii)"]);
    expect(md5Digest("p?ss?")).toBe(recorded["md5(question-marks)"]);
    expect(sha256Digest("abc")).toBe(recorded["sha256(abc)"]);
    expect(sha256Digest(nonAscii)).toBe(recorded["sha256(non-ascii)"]);
    expect(sha256Digest("p?ss?")).toBe(recorded["sha256(question-marks)"]);
  });

  it("tests the shape of a hash in either case, and before a final line feed", () => {
    const hash = recorded["isHash"];
    expect(isMd5Hash("0123456789abcdef0123456789abcdef")).toBe(hash["md5Lower"]);
    expect(isMd5Hash("0123456789ABCDEF0123456789ABCDEF")).toBe(hash["md5Upper"]);
    expect(isMd5Hash("0123456789abcdef0123456789abcdef\n")).toBe(hash["md5Newline"]);
    expect(isMd5Hash("a".repeat(64))).toBe(hash["md5Of64"]);
    expect(isSha256Hash("a".repeat(64))).toBe(hash["sha256Of64"]);
    expect(isSha256Hash("a".repeat(32))).toBe(hash["sha256Of32"]);
    expect(isSha256Hash(`${"a".repeat(64)}\n`)).toBe(true);
    expect(isMd5Hash("0123456789abcdef0123456789abcdef\r\n")).toBe(false);
    expect(isMd5Hash("0123456789abcdef0123456789abcdef\n\n")).toBe(false);
  });
});
