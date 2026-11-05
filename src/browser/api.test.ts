import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { MembershipServer, type ServerItem } from "../cli/membership-server.js";
import { RecordedDbPatchServer } from "../cli/replay-db-patch-transport.js";
import { RecordedServer } from "../cli/replay-transport.js";
import { FakeTransport, bodyText, devServer, header, respond } from "../client/fake-transport.js";
import { CItemException } from "../client/fault.js";
import { packageCaches } from "../client/package-lookups.js";
import { VersionRefusal } from "../client/version.js";
import { DbPatchesNotInEngineError } from "../db-patches/index.js";
import type { Engine } from "../engines.js";
import { CASES, type Case } from "../export/replay-cases.js";
import { MemoryVfs } from "../host/memory-fs.js";
import { BLOBS, BLOBS_12_0, BLOBS_14_35, CASES as IMPORT_CASES, CASES_12_0, CASES_14_35, LOGIN_CALLS, LOGIN_CALLS_12_0 } from "../import/transcript-replay.js";
import {
  type ApiMessage,
  type ProgressEvent,
  OptionError,
  SessionBusyError,
  SessionClosedError,
  connect,
  describeFailure,
  engineForServer,
  exportPackages,
  importLanguagePack,
  importPackages,
  applyDbPatches,
  planImport,
} from "./api.js";
import { LOGIN, SERVER_URL, type Recorded, engineMessages, recordedMessages as sharedRecordedMessages, serverOf } from "./api-test-support.js";
import { loadTreeIntoVfs, readDiskFiles } from "./test-support.js";
import { vfsFromZip, vfsToZip } from "./zip.js";

/**
 * The browser API over recorded runs, under Node (HOST-270 to HOST-273): `connect` against fake servers of the three versions, an
 * export and an import served from the recordings of the CLI's tests, the abort, a failing item, the order of the progress events, and
 * the options an engine refuses. The browser project runs the same API in three browsers (`api.browser.test.ts`).
 *
 * @spec HOST-270 HOST-271 HOST-272 HOST-273
 */

vi.setConfig({ testTimeout: 120_000 });

// the dependency cache outlives a helper (EXP-619), and each case was recorded by a process of its own
beforeEach(() => packageCaches.dependsOn.clear());

const login = LOGIN;
const URL_ = SERVER_URL;

describe("connect, HOST-270", () => {
  it.for([
    [12, 0, "12.0"],
    [13, 0, "14.0.7"],
    [14, 0, "14.0.7"],
    [14, 34, "14.0.7"],
    [14, 35, "14.35"],
  ] as const)("a server %i.%i runs engine %s, and the session says so", async ([major, minor, engine]) => {
    const transport = serverOf(major, minor);
    const session = await connect({ ...login, transport });
    expect(session.engine).toBe(engine);
    expect(session.serverVersion.major).toBe(major);
    expect(session.serverVersion.minor).toBe(minor);
    expect(session.userName).toBe(engine === "12.0" ? "admin" : "admin");
    expect(engineForServer(session.serverVersion)).toBe(engine);
    await session.close();
    expect(header(transport.requests.at(-1) as never, "SOAPAction")).toBe("Logoff");
  });

  it("logs off once, however often it is closed, and a closed session serves nothing", async () => {
    const transport = serverOf(14, 0);
    const session = await connect({ ...login, transport });
    await session.close();
    await session.close();
    expect(transport.requests.filter((request) => header(request, "SOAPAction") === "Logoff")).toHaveLength(1);
    expect(session.closed).toBe(true);
    const sent = transport.requests.length;
    await expect(exportPackages(session, { packages: ["x"] })).rejects.toBeInstanceOf(SessionClosedError);
    expect(transport.requests).toHaveLength(sent);
  });

  it("with the engine named, probes nothing and logs in once", async () => {
    const transport = serverOf(12, 0);
    const session = await connect({ ...login, engine: "14.35", transport });
    expect(session.engine).toBe("14.35");
    expect(transport.requests.filter((request) => header(request, "SOAPAction") === "ValidateUser")).toHaveLength(1);
  });

  it("refuses a server no engine takes, naming the engines that would, unless the check is skipped", async () => {
    await expect(connect({ ...login, transport: serverOf(16, 0) })).rejects.toBeInstanceOf(VersionRefusal);
    await expect(connect({ ...login, engine: "12.0", transport: serverOf(14, 0) })).rejects.toBeInstanceOf(VersionRefusal);
    const session = await connect({ ...login, engine: "12.0", skipVersionCheck: true, transport: serverOf(14, 0) });
    expect(session.versionGate?.skipped).toBe(true);
  });

  it("says in a message of its own when a refused server is let through", async () => {
    const session = await connect({ ...login, engine: "12.0", skipVersionCheck: true, transport: serverOf(14, 0) });
    const lines: ApiMessage[] = [];
    await exportPackages(session, { packages: ["x"], onMessage: (line) => lines.push(line) }).catch(() => undefined);
    expect(lines[0]).toMatchObject({ source: "host", level: "warning" });
    expect(lines[0]?.text).toContain("is outside the window of engine 12.0");
  });

  it("passes the engine's login failure through as it is", async () => {
    const transport = new FakeTransport((request, index) =>
      header(request, "SOAPAction") === "ValidateUser" ? respond("<nonsense/>") : devServer()(request, index),
    );
    await expect(connect({ ...login, transport })).rejects.toBeInstanceOf(CItemException);
  });

  it("refuses options that cannot log in, before any request", async () => {
    const transport = serverOf(14, 0);
    await expect(connect({ ...login, password: "", transport })).rejects.toBeInstanceOf(OptionError);
    await expect(connect({ ...login, url: "", transport })).rejects.toBeInstanceOf(OptionError);
    await expect(connect({ ...login, timeoutMs: -5, transport })).rejects.toBeInstanceOf(OptionError);
    await expect(connect({ ...login, engine: "9.9" as Engine, transport })).rejects.toBeInstanceOf(OptionError);
    expect(transport.requests).toHaveLength(0);
  });

  it("never lets the password out of the connection", async () => {
    const transport = serverOf(14, 0);
    const session = await connect({ ...login, transport });
    expect(JSON.stringify({ ...session, helper: undefined })).not.toContain("secret-pw");
    await session.close();
  });
});

describe("connect with a token provider, HOST-271", () => {
  it("sends the provider's token as the bearer, makes no password grant, and needs no password", async () => {
    const transport = serverOf(14, 0);
    const getAccessToken = vi.fn(() => Promise.resolve("from-the-client"));
    const session = await connect({ url: URL_, database: "12sp9", timeZoneName: "UTC", tokenProvider: { getAccessToken }, transport });
    expect(getAccessToken).toHaveBeenCalled();
    expect(transport.requests.some((request) => request.url.endsWith("/connect/token"))).toBe(false);
    const soap = transport.requests.filter((request) => header(request, "SOAPAction") !== undefined);
    expect(soap.length).toBeGreaterThan(0);
    for (const request of soap) {
      expect(header(request, "Authorization")).toBe("Bearer from-the-client");
      expect(header(request, "AUTHPASSWORD")).toBeUndefined();
    }
    // the user's name is the server's, since none was given
    expect(session.userName).toBe("admin");
  });

  it("asks for a new token once when the server refuses the first", async () => {
    const tokens = ["old", "new"];
    const base = serverOf(14, 0);
    let refused = false;
    const transport = new FakeTransport((request, index) => {
      if (header(request, "SOAPAction") === "ValidateUser" && header(request, "Authorization") === "Bearer old" && !refused) {
        refused = true;
        return respond("", { status: 401, reason: "Unauthorized" });
      }
      return base.send(request).then((response) => response) as never;
    });
    const session = await connect({
      url: URL_,
      database: "12sp9",
      timeZoneName: "UTC",
      engine: "14.0.7",
      tokenProvider: { getAccessToken: () => Promise.resolve(tokens.shift() ?? "none") },
      transport,
    });
    expect(refused).toBe(true);
    expect(session.userName).toBe("admin");
  });

  it("fails the login when the server offers no OAuth, and sends no password", async () => {
    const transport = new FakeTransport((request, index) =>
      request.url.endsWith("/OAuthServerDiscovery.aspx") ? respond("", { status: 404, reason: "Not Found" }) : devServer()(request, index),
    );
    await expect(
      connect({ url: URL_, database: "12sp9", timeZoneName: "UTC", engine: "14.0.7", tokenProvider: { getAccessToken: () => Promise.resolve("t") }, transport }),
    ).rejects.toThrow(/token provider needs a server with OAuth/);
    for (const request of transport.requests) expect(bodyText(request)).not.toContain("secret-pw");
  });
});

// ------------------------------------------------------------------------------------------------------------------ export

const read = (name: string, file: string): string => readFileSync(join(CASES, name, file), "utf8");
const headerValue = (log: string, label: string): string => new RegExp(`^${label}: (.*)\\r$`, "m").exec(log)?.[1] ?? "";
const caseOf = (name: string): Case => JSON.parse(read(name, "case.json")) as Case;

const recordedMessages = (dir: string): Recorded[] => sharedRecordedMessages(readFileSync(join(dir, "messages.jsonl"), "utf8"));

function databaseOf(input: Case): ServerItem[] {
  return input.packages.flatMap((entry) => entry.items.map((item) => ({ type: item.type, id: item.id, keyedName: item.keyedName, packageName: entry.name })));
}

/** A session on the recorded server of an export case, with the membership reads of HOST-010 to HOST-016 answered. */
async function exportSession(name: string, packages: boolean) {
  const input = caseOf(name);
  const calls = readTranscript(join(CASES, name, "transcript.jsonl"), join(CASES, "_blobs"));
  const server = new RecordedServer(calls);
  const membership = new MembershipServer(databaseOf(input), server.handler);
  membership.answersPackageList = packages;
  const transport = new FakeTransport(membership.handler);
  const session = await connect({ ...login, engine: "14.0.7", transport });
  const log = read(name, "engine.log");
  return { input, server, transport, session, recordedLog: log };
}

function optionsOf(name: string, recordedLog: string) {
  const level = headerValue(recordedLog, "Export level");
  const unknown = headerValue(recordedLog, "Export unknown packages action");
  return {
    ...(level === "" ? {} : { level }),
    ...(headerValue(recordedLog, "Export referenced items") === "True" ? { exportReferencedItems: true } : {}),
    ...(unknown === "" ? {} : { unknownReferences: unknown.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase() as "do-not-remove" }),
  };
}

function expectOutput(name: string, files: Map<string, Uint8Array>): void {
  const wanted = readDiskFiles(join(CASES, name, "output"));
  expect([...files.keys()].sort(), `${name}: the files`).toEqual([...wanted.keys()].sort());
  for (const [path, bytes] of wanted) expect(Buffer.from(files.get(path) as Uint8Array).equals(bytes), `${name}: ${path} byte for byte`).toBe(true);
}

describe("exportPackages, HOST-272", () => {
  it.for(["e27-permission", "e04-design-to-goal", "e14-list"])("replays %s by its packages", async (name) => {
    const { input, server, session, recordedLog } = await exportSession(name, true);
    const result = await exportPackages(session, { packages: input.packages.map((entry) => entry.name), ...optionsOf(name, recordedLog) });
    expect(server.mismatches, `${name}: the engine's requests`).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(join(CASES, name)));
    expectOutput(name, result.files);
    expect(result.summary).toMatchObject({ operation: "export", engine: "14.0.7", result: "success", returnCode: 0, aborted: false });
    expect(result.summary.packages.map((entry) => entry.name)).toEqual(input.packages.map((entry) => entry.name));
    expect(result.log).toContain("Export level");
    expect(result.vfs.exists("/aras-pkg-logs/export.log")).toBe(true);
  });

  it("replays an export by its items, and writes the files under the working directory of the caller's tree", async () => {
    const { input, server, session, recordedLog } = await exportSession("e27-permission", false);
    const vfs = new MemoryVfs();
    const items = input.packages.flatMap((entry) => entry.items.map(({ type, id }) => ({ type, id })));
    const result = await exportPackages(session, { items, vfs, workingDirectory: "/out/pkg", ...optionsOf("e27-permission", recordedLog) });
    expect(server.mismatches).toEqual([]);
    expect(result.vfs).toBe(vfs);
    expect(vfs.exists("/out/pkg/imports.mf")).toBe(true);
    expectOutput("e27-permission", result.files);
  });

  it("zips what it exported, and the zip is the one a download gives (round trip to the same tree)", async () => {
    const { input, session, recordedLog } = await exportSession("e27-permission", true);
    const result = await exportPackages(session, { packages: input.packages.map((entry) => entry.name), ...optionsOf("e27-permission", recordedLog) });
    const zip = vfsToZip(result.vfs, "/export");
    expect(vfsToZip(result.vfs, "/export")).toEqual(zip);
    expectOutput("e27-permission", vfsFromZip(zip).snapshot("/"));
  });

  it("orders its progress: the package, then its items, then completed", async () => {
    const { input, session, recordedLog } = await exportSession("e04-design-to-goal", true);
    const events: ProgressEvent[] = [];
    const lines: ApiMessage[] = [];
    await exportPackages(session, {
      packages: input.packages.map((entry) => entry.name),
      onProgress: (event) => events.push(event),
      onMessage: (message) => lines.push(message),
      ...optionsOf("e04-design-to-goal", recordedLog),
    });
    expect(events.map((event) => event.phase)).toEqual(["package", "item", "completed"]);
    expect(events[0]).toMatchObject({ operation: "export", package: "com.aras.innovator.solution.PLM" });
    expect(events[1]).toMatchObject({ phase: "item", index: 1, total: 1, item: { type: "ItemType", name: "Design To Goal" }, package: "com.aras.innovator.solution.PLM" });
    expect(lines.map((line) => line.level)).toEqual(["info", "info", "info"]);
  });

  it("a failing item, answered to continue, completes with engine errors and says what failed", async () => {
    const name = "e40-workflow-promotion-error-yes";
    const { input, server, session, recordedLog } = await exportSession(name, true);
    const answers: string[] = [];
    const result = await exportPackages(session, {
      packages: input.packages.map((entry) => entry.name),
      onItemError: (question) => {
        answers.push(question.text);
        return "continue";
      },
      ...optionsOf(name, recordedLog),
    });
    expect(server.mismatches).toEqual([]);
    expect(result.summary.result).toBe("completed with engine errors");
    expect(result.summary.messages.errors).toBeGreaterThan(0);
    expect(answers.length).toBeGreaterThan(0);
    expect(answers[0]).toContain("Abort current export");
    expect(result.messages.some((message) => message.level === "error")).toBe(true);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(join(CASES, name)));
  });

  it("an abort during the run cancels it as the engine's Cancel does, and says so", async () => {
    const name = "e55-lists-no-package-pair";
    const { input, session, recordedLog } = await exportSession(name, false);
    const controller = new AbortController();
    const items: number[] = [];
    const result = await exportPackages(session, {
      items: input.packages.flatMap((entry) => entry.items.map(({ type, id }) => ({ type, id }))),
      signal: controller.signal,
      onProgress: (event) => {
        if (event.phase !== "item") return;
        items.push(event.index as number);
        controller.abort();
      },
      ...optionsOf(name, recordedLog),
    });
    expect(items).toEqual([1]);
    expect(result.summary.aborted).toBe(true);
    expect(result.summary.result).toBe("cancelled");
    expect(result.messages.some((message) => message.text === "Export was canceled by user")).toBe(true);
  });

  it("an abort before the start rejects with the reason and sends nothing", async () => {
    const { session, transport } = await exportSession("e27-permission", true);
    const sent = transport.requests.length;
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(exportPackages(session, { packages: ["a"], signal: controller.signal })).rejects.toThrow("stop");
    expect(transport.requests).toHaveLength(sent);
  });

  it("an abort during the lookups of the selection ends the call before the export starts", async () => {
    const { input, session, server } = await exportSession("e27-permission", true);
    const controller = new AbortController();
    const applyAML = session.helper.applyAML.bind(session.helper);
    vi.spyOn(session.helper, "applyAML").mockImplementation((aml) => {
      controller.abort(new Error("stop in the lookups"));
      return applyAML(aml);
    });
    await expect(exportPackages(session, { packages: input.packages.map((entry) => entry.name), signal: controller.signal })).rejects.toThrow("stop in the lookups");
    // nothing of the export itself was asked of the server
    expect(server.consumed).toBe(0);
  });

  it("refuses what the engine cannot do, before the first request", async () => {
    const { session, transport } = await exportSession("e27-permission", true);
    const sent = transport.requests.length;
    const refused = async (options: Parameters<typeof exportPackages>[1], text: RegExp): Promise<void> => {
      await expect(exportPackages(session, options)).rejects.toThrow(text);
      await expect(exportPackages(session, options)).rejects.toBeInstanceOf(OptionError);
    };
    await refused({ packages: ["a"], parallelism: 2 }, /parallelism needs engine 14.35/);
    await refused({ packages: ["a"], languages: "en" }, /needs engine 14.35/);
    await refused({ packages: ["a"], languageResources: "only" }, /needs engine 14.35/);
    await refused({}, /exactly one of/);
    await refused({ packages: ["a"], allPackages: true }, /exactly one of/);
    await refused({ packages: ["a", "a"] }, /given twice/);
    await refused({ packages: ["a"], unknownReferences: "nope" as never }, /unknownReferences is/);
    await refused({ packages: ["a"], onItemError: "nope" as never }, /onItemError is/);
    expect(transport.requests).toHaveLength(sent);
  });

  it("serves one operation at a time", async () => {
    const { input, session, recordedLog } = await exportSession("e27-permission", true);
    const first = exportPackages(session, { packages: input.packages.map((entry) => entry.name), ...optionsOf("e27-permission", recordedLog) });
    await expect(exportPackages(session, { packages: ["x"] })).rejects.toBeInstanceOf(SessionBusyError);
    await first;
  });

  it("refuses 14.35's own options on other engines and onItemError on 14.35", async () => {
    const transport = serverOf(14, 35);
    const session = await connect({ ...login, transport });
    expect(session.engine).toBe("14.35");
    await expect(exportPackages(session, { packages: ["a"], onItemError: "continue" })).rejects.toThrow(/not supported with engine 14.35/);
    await expect(exportPackages(session, { packages: ["a"], languageResources: "only" })).rejects.toThrow(/needs languages/);
    await expect(exportPackages(session, { packages: ["a"], languages: "de" })).rejects.toThrow(/must include en/);
    await expect(exportPackages(session, { packages: ["a"], parallelism: 0 })).rejects.toThrow(/1 or more/);
  });
});

// ------------------------------------------------------------------------------------------------------------------ import

interface Step {
  name: string;
  dir: string;
  engine: Engine;
  blobs: string;
  options: { merge?: boolean; verbose?: boolean; release?: string; description?: string; cancelAfterStatus?: number; languages?: string; amlBatch?: { maxSize?: number }; collectErrors?: { maxCount?: number } };
}

function step(name: string, index: number, engine: Engine = "14.0.7"): Step {
  const cases = engine === "14.35" ? CASES_14_35 : engine === "12.0" ? CASES_12_0 : IMPORT_CASES;
  const definition = JSON.parse(readFileSync(join(cases, name, "case.json"), "utf8")) as { steps: Array<Pick<Step, "options">> };
  return {
    name: `${name}/step-${index}`,
    dir: join(cases, name, `step-${index}`),
    engine,
    blobs: engine === "14.35" ? BLOBS_14_35 : engine === "12.0" ? BLOBS_12_0 : BLOBS,
    options: definition.steps[index - 1]?.options ?? {},
  };
}

async function importSession(recorded: Step) {
  const calls = readTranscript(join(recorded.dir, "transcript.jsonl"), recorded.blobs);
  const osUser = /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";
  const server = new RecordedServer(calls, recorded.engine);
  const transport = new FakeTransport(server.handler);
  const session = await connect({ ...login, engine: recorded.engine, transport });
  const source = new MemoryVfs();
  loadTreeIntoVfs(join(recorded.dir, "input"), source, "/");
  return { server, transport, session, source, osUser };
}

function importOptions(recorded: Step, osUser: string) {
  const { options } = recorded;
  return {
    osUser,
    ...(options.merge === true ? { merge: true } : {}),
    ...(options.verbose === true ? { verbose: true } : {}),
    ...(options.release === undefined ? {} : { release: options.release }),
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.languages === undefined ? {} : { languages: options.languages }),
    ...(options.amlBatch === undefined ? {} : { batch: { maxSize: options.amlBatch.maxSize ?? 0 } }),
    ...(options.collectErrors === undefined ? {} : { collectErrors: { maxCount: options.collectErrors.maxCount ?? 0 } }),
  };
}

const SUCCESS = [step("s0-mini-defaults", 1), step("s0-mini-merge", 1), step("s0-mini-verbose", 1), step("s0-mini-release-description", 1)];

describe("importPackages, HOST-272", () => {
  it.for(SUCCESS.map((recorded) => [recorded.name, recorded] as const))("replays %s from a tree", async ([, recorded]) => {
    const { server, session, source, osUser } = await importSession(recorded);
    const before = source.toTree();
    const result = await importPackages(session, { source, ...importOptions(recorded, osUser) });
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(recorded.dir));
    expect(result.summary).toMatchObject({ operation: "import", engine: "14.0.7", result: "success", returnCode: 0 });
    expect(result.log).toContain("Start of importing packages");
    // the package is read and never changed; the log is the one file the run adds
    expect(source.toTree().filter((path) => !path.startsWith("aras-pkg-logs"))).toEqual(before);
  });

  it("imports from the bytes of a zip, with the same requests and messages", async () => {
    const recorded = step("s0-mini-defaults", 1);
    const { server, session, source, osUser } = await importSession(recorded);
    const zip = vfsToZip(source, "/");
    const result = await importPackages(session, { source: { zip }, ...importOptions(recorded, osUser) });
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(recorded.dir));
  });

  it("orders its progress: the package, its items in turn, the delayed resolution, completed", async () => {
    const recorded = step("s0-mini-defaults", 1);
    const { session, source, osUser } = await importSession(recorded);
    const events: ProgressEvent[] = [];
    const lines: ApiMessage[] = [];
    await importPackages(session, { source, onProgress: (event) => events.push(event), onMessage: (message) => lines.push(message), ...importOptions(recorded, osUser) });
    const phases = events.map((event) => event.phase);
    expect(phases[0]).toBe("package");
    expect(events[0]).toMatchObject({ package: "LIBSJS-SCRATCH-MINI" });
    const items = events.filter((event) => event.phase === "item");
    expect(items.map((event) => event.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(items.every((event) => event.total === 6 && event.package === "LIBSJS-SCRATCH-MINI")).toBe(true);
    expect(phases.indexOf("references")).toBeGreaterThan(phases.lastIndexOf("item"));
    expect(phases.at(-1)).toBe("completed");
    // the console banner and the dots are delivered as lines, and nothing is printed
    expect(lines.filter((line) => line.source === "console").map((line) => line.text)).toContain("       ****Import   LIBSJS-SCRATCH-MINI****".trimEnd());
  });

  it("an abort during the run cancels it, as the recorded cancel", async () => {
    const recorded = step("s0-mini-cancel", 1);
    const after = recorded.options.cancelAfterStatus ?? 0;
    expect(after).toBeGreaterThan(0);
    const { server, session, source, osUser } = await importSession(recorded);
    const controller = new AbortController();
    let statuses = 0;
    const result = await importPackages(session, {
      source,
      signal: controller.signal,
      onMessage: (message) => {
        if (message.channel === "status" && (statuses += 1) === after) controller.abort();
      },
      ...importOptions(recorded, osUser),
    });
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(recorded.dir));
    expect(result.summary.aborted).toBe(true);
    expect(result.summary.result).toBe("cancelled");
  });

  it("a failing import returns the engine's failure and the error messages", async () => {
    const recorded = step("s3-unres-reltype-nested", 1);
    const { server, session, source, osUser } = await importSession(recorded);
    const result = await importPackages(session, { source, ...importOptions(recorded, osUser) });
    expect(server.mismatches).toEqual([]);
    expect(result.summary.result).toBe("failed");
    expect(result.summary.returnCode).not.toBe(0);
    expect(result.messages.some((message) => message.level === "error")).toBe(true);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(recorded.dir));
  });

  it("replays 14.35 with its batch and collected-errors settings", async () => {
    const recorded = step("batch-relationships", 1, "14.35");
    const { server, session, source, osUser } = await importSession(recorded);
    const result = await importPackages(session, { source, ...importOptions(recorded, osUser) });
    expect(server.mismatches).toEqual([]);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(recorded.dir));
  });

  it("replays 12.0", async () => {
    const recorded = step("s3-unres-delayed", 1, "12.0");
    const { server, session, source, osUser } = await importSession(recorded);
    const result = await importPackages(session, { source, ...importOptions(recorded, osUser) });
    expect(server.mismatches).toEqual([]);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(recorded.dir));
    expect(result.summary.engine).toBe("12.0");
  });

  it("defaults os_user to the login name", async () => {
    const recorded = step("s0-mini-defaults", 1);
    const { transport, session, source } = await importSession(recorded);
    await importPackages(session, { source }).catch(() => undefined);
    const bodies = transport.requests.map(bodyText).join("\n");
    expect(bodies).toContain("<os_user>admin</os_user>");
    expect(bodies).not.toContain("secret-pw");
  });

  it("refuses what is missing or an engine lacks, before the first request", async () => {
    const recorded = step("s0-mini-defaults", 1);
    const { session, source, transport } = await importSession(recorded);
    const sent = transport.requests.length;
    await expect(importPackages(session, { source, manifestPath: "/nope.mf" })).rejects.toThrow(/manifest '\/nope.mf' does not exist/);
    await expect(importPackages(session, { source, packages: ["NOPE"] })).rejects.toThrow(/has no package 'NOPE'/);
    await expect(importPackages(session, { source, batch: true })).rejects.toThrow(/valid only with engine 14.35/);
    await expect(importPackages(session, { source, collectErrors: { maxCount: 2 } })).rejects.toBeInstanceOf(OptionError);
    await expect(importPackages(session, { source, languages: "en" })).rejects.toThrow(/needs engine 14.35/);
    expect(transport.requests).toHaveLength(sent);
  });
});

describe("planImport, HOST-272", () => {
  it("shows the order and the plan of a package with no server", () => {
    const recorded = step("s0-mini-defaults", 1);
    const source = new MemoryVfs();
    loadTreeIntoVfs(join(recorded.dir, "input"), source, "/");
    const plan = planImport({ source });
    expect(plan.order).toEqual(["LIBSJS-SCRATCH-MINI"]);
    expect(plan.packages[0]?.plan.sequence).toHaveLength(6);
    expect(plan.packages[0]?.folder).toContain("LIBSJS-SCRATCH-MINI");
    expect(() => planImport({ source, packages: ["NOPE"] })).toThrow(OptionError);
  });
});

// ------------------------------------------------------------------------------------------------------ language pack, patches

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const LP_CASES = join(FIXTURES, "14.0.7", "language-pack");
const DBP_CASES = join(FIXTURES, "14.35", "dbpatch");
const TIME = /\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d/g;

describe("importLanguagePack, replaying the recorded runs (LP-001)", () => {
  it.for(["lp01", "lp02"])("replays %s on 14.0.7, logs the session off, and closes it", async (name) => {
    const dir = join(LP_CASES, name);
    const definition = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as { lpPackage: string; lpDebug: boolean };
    const calls = readTranscript(join(dir, "transcript.jsonl"), join(LP_CASES, "_blobs"));
    const osUser = /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";
    const server = new RecordedServer(calls);
    const transport = new FakeTransport(server.handler);
    const session = await connect({ ...login, engine: "14.0.7", transport });
    const source = new MemoryVfs();
    loadTreeIntoVfs(join(dir, "lp"), source, "/");
    const events: ProgressEvent[] = [];
    const result = await importLanguagePack(session, { source, lpPackage: definition.lpPackage, lpDebug: definition.lpDebug, osUser, onProgress: (event) => events.push(event) });
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(dir));
    expect(result.summary).toMatchObject({ operation: "language-pack", result: "success" });
    expect(events[0]?.phase).toBe("package");
    expect(transport.requests.filter((request) => header(request, "SOAPAction") === "Logoff")).toHaveLength(1);
    expect(session.closed).toBe(true);
    await expect(exportPackages(session, { packages: ["x"] })).rejects.toBeInstanceOf(SessionClosedError);
    await session.close();
    expect(transport.requests.filter((request) => header(request, "SOAPAction") === "Logoff")).toHaveLength(1);
  });
});

describe("applyDbPatches, replaying the recorded runs (DBP-002)", () => {
  async function applyStep(step: string, user = "root") {
    const dir = join(DBP_CASES, "apply", step);
    const calls = readTranscript(join(dir, "transcript.jsonl"), join(dir, "_blobs"));
    const osUser = /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";
    const server = new RecordedDbPatchServer(calls);
    const transport = new FakeTransport(server.handler);
    const session = await connect({ ...login, userName: user, engine: "14.35", transport });
    const source = new MemoryVfs();
    loadTreeIntoVfs(join(dir, "input"), source, "/");
    const result = await applyDbPatches(session, { source, manifestPath: "/manifest.xml", osUser });
    return { dir, server, transport, result };
  }

  const normalised = (lines: readonly string[]): string[] =>
    lines.map((line) => line.replace(/\b[0-9A-F]{32}\b/g, "<id>").replace(TIME, "<time>").replace(/^(Loaded \[).*(\] for upgrade)/, "$1<manifest>$2"));

  it("applies the no-op patch of step-1, with the recorded requests and messages", async () => {
    const { dir, server, result } = await applyStep("step-1");
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(normalised(engineMessages(result.messages).map(({ text }) => text))).toEqual(normalised(recordedMessages(dir).map(({ text }) => text)));
    expect(result.summary).toMatchObject({ operation: "db-patches", engine: "14.35", result: "success", returnCode: 0 });
    expect(result.log).toContain("Start of importing DB packages.");
  });

  it("reports the patch the server refuses as a failed run, though no exception escaped (DBP-094)", async () => {
    const { server, result } = await applyStep("step-2");
    expect(server.mismatches).toEqual([]);
    expect(result.summary.result).toBe("failed");
    expect(result.summary.messages.errors).toBe(1);
  });

  it("has no language-pack import on 12.0, and no DB patches outside 14.35", async () => {
    const old = await connect({ ...login, transport: serverOf(12, 0) });
    expect(old.engine).toBe("12.0");
    await expect(importLanguagePack(old, { source: new MemoryVfs(), lpPackage: "x" })).rejects.toThrow(/no language-pack import/);
    await expect(applyDbPatches(old, { source: new MemoryVfs(), manifestPath: "/m.xml" })).rejects.toBeInstanceOf(DbPatchesNotInEngineError);
  });

  it("needs the login root for DB patches before it sends anything", async () => {
    const transport = serverOf(14, 35);
    const session = await connect({ ...login, transport });
    const sent = transport.requests.length;
    await expect(applyDbPatches(session, { source: new MemoryVfs(), manifestPath: "/m.xml" })).rejects.toThrow(/needs the login 'root'/);
    expect(transport.requests).toHaveLength(sent);
  });

  it("describes a failure for display", () => {
    expect(describeFailure(new Error("plain"))).toBe("plain");
    expect(describeFailure("text")).toBe("text");
  });
});

describe("fixtures stay where the tests expect them", () => {
  it("has the cases", () => {
    expect(existsSync(join(CASES, "e27-permission", "transcript.jsonl"))).toBe(true);
  });
});

describe("the portable replay server", () => {
  it("counts the same login calls as the disk replays do (replay-transport.ts holds a copy, because transcript-replay.ts reads the disk)", () => {
    const calls = readTranscript(join(IMPORT_CASES, "s0-mini-defaults", "step-1", "transcript.jsonl"), BLOBS);
    expect(new RecordedServer(calls).total).toBe(calls.length - LOGIN_CALLS);
    const calls12 = readTranscript(join(CASES_12_0, "s3-unres-delayed", "step-1", "transcript.jsonl"), BLOBS_12_0);
    expect(new RecordedServer(calls12, "12.0").total).toBe(calls12.length - LOGIN_CALLS_12_0);
  });
});
