import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTranscript } from "../../oracle/src/transcript.js";
import { MembershipServer, type ServerItem } from "../cli/membership-server.js";
import { RecordedServer } from "../cli/replay-transport.js";
import { FakeTransport, header, respond } from "../client/fake-transport.js";
import { CItemException } from "../client/fault.js";
import { packageCaches } from "../client/package-lookups.js";
import type { TransportRequest } from "../client/transport.js";
import { ArasVersion, VersionRefusal } from "../client/version.js";
import { CASES, type Case } from "../export/replay-cases.js";
import { MemoryVfs } from "../host/memory-fs.js";
import { BLOBS, CASES as IMPORT_CASES } from "../import/transcript-replay.js";
import { OptionError, SessionBusyError, SessionClosedError, connect, exportPackages } from "./api.js";
import type { ApiMessage, ProgressEvent } from "./api.js";
import { LOGIN, SERVER_URL, engineMessages, fakeDrop, recordedMessages as sharedRecordedMessages, serverOf } from "./api-test-support.js";
import { loadTreeIntoVfs, readDiskFiles } from "./test-support.js";
import { type ServerPort, serveEngine } from "./worker-host.js";
import { type EngineWorker, type WorkerLike, createEngineWorker } from "./worker-client.js";
import { WorkerDisposedError, WorkerProtocolError, toWorker } from "./worker-protocol.js";
import { mountDataTransfer, mountWalked, takeEntries, walkEntries } from "./file-list.js";
import { ZipError, vfsFromZip, vfsToZip } from "./zip.js";

/**
 * The engine's Worker under Node (HOST-274, HOST-275): the client of `worker-client.ts` and the server of `worker-host.ts` joined by a
 * `MessageChannel`, which clones and transfers as a Worker's port does. The page's side holds the fake server of the recording and
 * answers the Worker's requests; the Worker runs the engine. Every operation, the errors, the abort and the stop are covered here; the
 * browsers run the built Worker bundle in `worker.browser.test.ts`.
 *
 * @spec HOST-274 HOST-275
 */

vi.setConfig({ testTimeout: 120_000 });

beforeEach(() => packageCaches.dependsOn.clear());

interface Started {
  worker: EngineWorker;
  /** What the client posted to the Worker, as the Worker's port saw it. */
  posted: unknown[];
  port: MessagePort;
}

const open: EngineWorker[] = [];

function start(options: { onDisposed?: () => void } = {}): Started {
  const { port1, port2 } = new MessageChannel();
  const posted: unknown[] = [];
  const post = port1.postMessage.bind(port1) as (message: unknown, transfer: ArrayBuffer[]) => void;
  const spy: WorkerLike = {
    postMessage: (message, transfer) => {
      posted.push(structuredClone(message));
      post(message, transfer);
    },
    addEventListener: (type, listener) => port1.addEventListener(type, listener as EventListener),
    start: () => port1.start(),
    close: () => port1.close(),
  };
  serveEngine(port2 as unknown as ServerPort, options);
  const worker = createEngineWorker({ worker: spy });
  open.push(worker);
  return { worker, posted, port: port2 };
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((worker) => worker.dispose({ force: true })));
});

// -------------------------------------------------------------------------------------------------------------- the recordings

const read = (name: string, file: string): string => readFileSync(join(CASES, name, file), "utf8");
const headerValue = (log: string, label: string): string => new RegExp(`^${label}: (.*)\\r$`, "m").exec(log)?.[1] ?? "";
const recordedMessages = (dir: string) => sharedRecordedMessages(readFileSync(join(dir, "messages.jsonl"), "utf8"));
const osUserOf = (dir: string, blobs: string): string =>
  /<os_user>([^<]*)<\/os_user>/.exec(readTranscript(join(dir, "transcript.jsonl"), blobs).map((call) => call.request).join("\n"))?.[1] ?? "";

/** The recorded server of an export case, with the membership reads answered, as the page would serve the Worker's transport. */
function exportServer(name: string, packages: boolean) {
  const input = JSON.parse(read(name, "case.json")) as Case;
  const server = new RecordedServer(readTranscript(join(CASES, name, "transcript.jsonl"), join(CASES, "_blobs")));
  const items: ServerItem[] = input.packages.flatMap((entry) => entry.items.map((item) => ({ type: item.type, id: item.id, keyedName: item.keyedName, packageName: entry.name })));
  const membership = new MembershipServer(items, server.handler);
  membership.answersPackageList = packages;
  const log = read(name, "engine.log");
  const level = headerValue(log, "Export level");
  return { input, server, transport: new FakeTransport(membership.handler), options: level === "" ? {} : { level } };
}

/** The recorded server of an import step. */
function importServer(name: string, index = 1) {
  const base = join(IMPORT_CASES, name);
  const dir = join(base, `step-${index}`);
  const calls = readTranscript(join(dir, "transcript.jsonl"), BLOBS);
  const server = new RecordedServer(calls, "14.0.7");
  const definition = JSON.parse(readFileSync(join(base, "case.json"), "utf8")) as { steps: Array<{ options: { cancelAfterStatus?: number } }> };
  return { dir, server, transport: new FakeTransport(server.handler), osUser: osUserOf(dir, BLOBS), options: definition.steps[index - 1]?.options ?? {} };
}

/** The same export as a direct call of the browser API, on a server of its own: what the Worker's result must equal. */
async function runDirect(name: string) {
  const { input, transport, options } = exportServer(name, true);
  const session = await connect({ ...LOGIN, engine: "14.0.7", transport });
  const result = await exportPackages(session, { packages: input.packages.map((entry) => entry.name), ...options });
  return { files: result.files, messages: engineMessages(result.messages) };
}

function inputFiles(dir: string): Map<string, Uint8Array> {
  return new Map([...readDiskFiles(dir)].map(([path, bytes]) => [`/${path}`, new Uint8Array(bytes)] as const));
}

const secret = LOGIN.password;

// ------------------------------------------------------------------------------------------------------------------ operations

describe("connect through the Worker (HOST-274)", () => {
  it.for([
    [12, 0, "12.0"],
    [14, 0, "14.0.7"],
    [14, 35, "14.35"],
  ] as const)("follows a %i.%i server to engine %s, with the server's version as an object", async ([major, minor, engine]) => {
    const { worker } = start();
    const transport = serverOf(major, minor);
    const session = await worker.connect({ ...LOGIN, transport });
    expect(session.engine).toBe(engine);
    expect(session.serverVersion.major).toBe(major);
    expect(session.serverVersion.minor).toBe(minor);
    const text = major < 14 ? `${major}.${minor} SP0 Build 0` : `${major}.${minor}.9.36073`;
    expect(session.serverVersionText).toBe(text);
    expect(session.serverVersion).toBeInstanceOf(ArasVersion);
    expect(session.serverVersion.fullString).toBe(text);
    expect(session.versionGate?.server).toBeInstanceOf(ArasVersion);
    expect(session.versionGate?.server.fullString).toBe(text);
    expect(session.userName).toBe("admin");
    expect(session.closed).toBe(false);
    await session.close();
    expect(session.closed).toBe(true);
    expect(header(transport.requests.at(-1) as TransportRequest, "SOAPAction")).toBe("Logoff");
    const sent = transport.requests.length;
    await session.close();
    expect(transport.requests).toHaveLength(sent);
    await expect(worker.exportPackages(session, { packages: ["x"] })).rejects.toBeInstanceOf(SessionClosedError);
  });

  it("asks the page's token provider for each token, on the page, and sends no password grant", async () => {
    const { worker } = start();
    const transport = serverOf(14, 0);
    const getAccessToken = vi.fn(() => Promise.resolve("from-the-client"));
    const session = await worker.connect({ url: SERVER_URL, database: "12sp9", timeZoneName: "UTC", tokenProvider: { getAccessToken }, transport });
    expect(getAccessToken).toHaveBeenCalled();
    expect(transport.requests.some((request) => request.url.endsWith("/connect/token"))).toBe(false);
    for (const request of transport.requests.filter((r) => header(r, "SOAPAction") !== undefined)) {
      expect(header(request, "Authorization")).toBe("Bearer from-the-client");
    }
    expect(session.userName).toBe("admin");
  });

  it("gives the page's transport the Worker's requests with the headers and bodies the engine made, and the Worker takes its responses", async () => {
    const { worker } = start();
    const transport = serverOf(14, 35);
    await worker.connect({ ...LOGIN, transport });
    const soap = transport.requests.filter((request) => header(request, "SOAPAction") !== undefined);
    expect(soap.length).toBeGreaterThan(0);
    for (const request of soap) {
      expect(request.method).toBe("POST");
      expect(request.body).toBeInstanceOf(Uint8Array);
      expect(header(request, "Authorization")).toMatch(/^Bearer /);
    }
  });

  it("refuses an option, and a server outside the engine's window, with the library's own classes", async () => {
    const { worker } = start();
    const transport = serverOf(14, 0);
    const refused = await worker.connect({ ...LOGIN, password: "", transport }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(OptionError);
    expect(transport.requests).toHaveLength(0);
    const outside = await worker.connect({ ...LOGIN, engine: "12.0", transport: serverOf(14, 0) }).catch((error: unknown) => error);
    expect(outside).toBeInstanceOf(VersionRefusal);
    expect(outside).toBeInstanceOf(CItemException);
    expect((outside as VersionRefusal).fittingEngines).toEqual(["14.0.7", "14.35"]);
    expect((outside as VersionRefusal).serverVersion.major).toBe(14);
    expect((outside as VersionRefusal).hint).toContain("--skip-version-check");
  });

  it("rejects a login the server refuses with the engine's CItemException and its fault members", async () => {
    const { worker } = start();
    const base = serverOf(14, 0);
    const transport = new FakeTransport(async (request, index) =>
      header(request, "SOAPAction") === "ValidateUser" ? respond(`<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>1</faultcode><faultstring>Authentication failed</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`, { status: 500, reason: "Internal Server Error" }) : base.send(request).then((response) => response),
    );
    const error = (await worker.connect({ ...LOGIN, engine: "14.0.7", transport }).catch((failure: unknown) => failure)) as CItemException;
    expect(error).toBeInstanceOf(CItemException);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CItemException");
    expect(error.message).toContain("Failed login to Innovator");
    expect(error.faultcode).toBeTypeOf("number");
    expect(error.stack).toContain("CItemException");
  });
});

describe("importPackages through the Worker (HOST-272, HOST-274)", () => {
  it("replays s0-mini-defaults from files, with the messages and progress of the direct call, and sends events as they come", async () => {
    const { worker } = start();
    const { dir, server, transport, osUser } = importServer("s0-mini-defaults");
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const events: ProgressEvent[] = [];
    const lines: ApiMessage[] = [];
    const result = await worker.importPackages(session, { source: { files: inputFiles(join(dir, "input")) }, osUser, onProgress: (event) => events.push(event), onMessage: (line) => lines.push(line) });
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(dir));
    expect(result.summary).toMatchObject({ operation: "import", engine: "14.0.7", result: "success", returnCode: 0 });
    expect(result.log).toContain("Start of importing packages");
    expect(events.filter((event) => event.phase === "item").map((event) => event.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.at(-1)?.phase).toBe("completed");
    expect(lines).toEqual(result.messages);
    expect("vfs" in result).toBe(false);
  });

  it("imports from the bytes of a zip, which are transferred and not copied", async () => {
    const { worker } = start();
    const { dir, server, transport, osUser } = importServer("s0-mini-defaults");
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const tree = new MemoryVfs();
    loadTreeIntoVfs(join(dir, "input"), tree, "/");
    const zip = vfsToZip(tree, "/");
    const length = zip.byteLength;
    expect(length).toBeGreaterThan(0);
    const result = await worker.importPackages(session, { source: { zip }, osUser });
    expect(server.mismatches).toEqual([]);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(dir));
    expect(zip.byteLength, "the buffer went to the Worker").toBe(0);
  });

  it("copies the zip when the bytes are a view into a larger buffer", async () => {
    const { worker } = start();
    const { dir, transport, osUser } = importServer("s0-mini-defaults");
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const tree = new MemoryVfs();
    loadTreeIntoVfs(join(dir, "input"), tree, "/");
    const zip = vfsToZip(tree, "/");
    const again = importServer("s0-mini-defaults");
    const padded = new Uint8Array(zip.byteLength + 16);
    padded.set(zip, 8);
    const view = padded.subarray(8, 8 + zip.byteLength);
    await worker.importPackages(session, { source: { zip: view }, osUser });
    expect(again.server.mismatches).toEqual([]);
    expect(padded.byteLength, "a view into a larger buffer is copied, so the buffer it is in stays whole").toBe(zip.byteLength + 16);
  });

  it("imports from the files of a folder input: a File keeps its name and bytes across the Worker, and its relative path goes beside it", async () => {
    const { worker } = start();
    const { dir, server, transport, osUser } = importServer("s0-mini-defaults");
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const fileList = [...inputFiles(join(dir, "input"))].map(([path, bytes]) => {
      const file = new File([bytes as BlobPart], path.slice(path.lastIndexOf("/") + 1));
      // what `<input webkitdirectory>` gives: the chosen folder's name first
      Object.defineProperty(file, "webkitRelativePath", { value: `Chosen${path}` });
      return file;
    });
    const result = await worker.importPackages(session, { source: { fileList: fileList as never, mount: { root: "auto" } }, osUser });
    expect(server.mismatches).toEqual([]);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(dir));
    expect(result.summary.result).toBe("success");
  });

  it("imports from a drop, whose entries are taken before the handler returns and walked on the page, as from a folder input", async () => {
    const { worker, posted } = start();
    const { dir, server, transport, osUser } = importServer("s0-mini-defaults");
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const files = [...inputFiles(join(dir, "input"))].map(([path, bytes]) => ({ path: `Dropped${path}`, bytes }));
    const items = fakeDrop(files, ["Dropped/empty/inner"]) as unknown as { length: number };
    const running = worker.importPackages(session, { source: { dataTransfer: items as never, mount: { root: "auto" } }, osUser });
    items.length = 0;
    const result = await running;
    expect(server.mismatches).toEqual([]);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(dir));
    expect(result.summary.result).toBe("success");
    const call = posted.find((message) => (message as { op?: string }).op === "import") as { source: { kind: string; entries: Array<{ path: string; file?: File }>; options: unknown } };
    expect(call.source.kind).toBe("drop");
    expect(call.source.options).toEqual({ root: "auto" });
    expect(call.source.entries.find((entry) => entry.path === "Dropped/empty/inner")).toEqual({ path: "Dropped/empty/inner" });
    expect(call.source.entries.filter((entry) => entry.file !== undefined).map((entry) => entry.path).sort()).toEqual(files.map((file) => file.path).sort());
  });

  it("mounts what the client sends for a drop as the drop adapter mounts the items: same paths, same empty folders", async () => {
    const files = [
      { path: "Pkg/a.xml", bytes: new Uint8Array([1]) },
      { path: "Pkg/sub/a.xml", bytes: new Uint8Array([2]) },
    ];
    const direct = await mountDataTransfer(fakeDrop(files, ["Pkg/empty"]), { root: "auto" });
    const walked = await walkEntries(takeEntries(fakeDrop(files, ["Pkg/empty"])));
    const viaWalk = await mountWalked(walked, { root: "auto" });
    expect(viaWalk.snapshot("/")).toEqual(direct.snapshot("/"));
    expect(viaWalk.snapshot("/").get("sub/a.xml")).toEqual(new Uint8Array([2]));
    expect(viaWalk.exists("/empty")).toBe(true);
    expect(direct.exists("/empty")).toBe(true);
  });

  it("routes a drop of one zip to the zip reader in the Worker", async () => {
    const { worker } = start();
    const { dir, server, transport, osUser } = importServer("s0-mini-defaults");
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const tree = new MemoryVfs();
    loadTreeIntoVfs(join(dir, "input"), tree, "/");
    const zip = vfsToZip(tree, "/");
    expect(vfsFromZip(zip).snapshot("/").size).toBeGreaterThan(0);
    const result = await worker.importPackages(session, { source: { dataTransfer: fakeDrop([{ path: "pkg.zip", bytes: zip }]) }, osUser });
    expect(server.mismatches).toEqual([]);
    expect(result.summary.result).toBe("success");
  });

  it("stops the walk of a drop on abort(), and sends nothing", async () => {
    const { worker, posted } = start();
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport: serverOf(14, 0) });
    const seen = posted.length;
    let answer: ((file: never) => void) | undefined;
    const first = { isFile: true, isDirectory: false, name: "a.xml", file: (success: (file: never) => void) => void (answer = success) };
    const items = [
      { kind: "file", webkitGetAsEntry: () => first },
      { kind: "file", webkitGetAsEntry: () => ({ ...first, name: "b.xml", file: () => expect.fail("the walk went on") }) },
    ];
    const running = worker.importPackages(session, { source: { dataTransfer: items as never } });
    await vi.waitFor(() => expect(answer).toBeDefined());
    worker.abort();
    answer?.(new File([], "a.xml") as never);
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(posted).toHaveLength(seen);
  });

  it("imports from a zip that is a File or a Blob, read in the Worker", async () => {
    const { worker } = start();
    const { dir, server, transport, osUser } = importServer("s0-mini-defaults");
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const tree = new MemoryVfs();
    loadTreeIntoVfs(join(dir, "input"), tree, "/");
    const result = await worker.importPackages(session, { source: { zip: new Blob([vfsToZip(tree, "/") as BlobPart]) as never }, osUser });
    expect(server.mismatches).toEqual([]);
    expect(result.summary.result).toBe("success");
  });

  it("is cancelled by its signal as the recorded cancel is, and rejects nothing", async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown): number => unhandled.push(reason);
    process.on("unhandledRejection", record);
    try {
      const { worker } = start();
      const { dir, server, transport, osUser, options } = importServer("s0-mini-cancel");
      const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
      const controller = new AbortController();
      let statuses = 0;
      const result = await worker.importPackages(session, {
        source: { files: inputFiles(join(dir, "input")) },
        osUser,
        signal: controller.signal,
        onMessage: (message) => {
          if (message.channel === "status" && (statuses += 1) === options.cancelAfterStatus) controller.abort();
        },
      });
      expect(server.mismatches).toEqual([]);
      expect(engineMessages(result.messages)).toEqual(recordedMessages(dir));
      expect(result.summary).toMatchObject({ aborted: true, result: "cancelled" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });

  it("is cancelled by worker.abort() the same way", async () => {
    const { worker } = start();
    const { dir, server, transport, osUser, options } = importServer("s0-mini-cancel");
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    let statuses = 0;
    const result = await worker.importPackages(session, {
      source: { files: inputFiles(join(dir, "input")) },
      osUser,
      onMessage: (message) => {
        if (message.channel === "status" && (statuses += 1) === options.cancelAfterStatus) worker.abort();
      },
    });
    expect(server.mismatches).toEqual([]);
    expect(result.summary).toMatchObject({ aborted: true, result: "cancelled" });
  });

  it("rejects with the signal's reason, and sends nothing, when the signal was raised before the call", async () => {
    const { worker, posted } = start();
    const session = await worker.connect({ ...LOGIN, transport: serverOf(14, 0) });
    const before = posted.length;
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(worker.importPackages(session, { source: { files: new Map() }, signal: controller.signal })).rejects.toThrow("stop");
    expect(posted).toHaveLength(before);
  });

  it("rejects an operation that the engine fails, with the library's class, its members and its stack, and the Worker serves on", async () => {
    const { worker } = start();
    const { dir, transport, osUser } = importServer("s0-mini-defaults");
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const corrupt = await worker.importPackages(session, { source: { zip: new Uint8Array([1, 2, 3]) }, osUser }).catch((error: unknown) => error);
    expect(corrupt).toBeInstanceOf(ZipError);
    expect((corrupt as ZipError).code).toBe("ZIP_INVALID");
    expect((corrupt as ZipError).stack).toContain("ZipError");
    const missing = await worker.importPackages(session, { source: { files: new Map() }, osUser }).catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(OptionError);
    expect((missing as Error).message).toContain("does not exist");
    // still open, and still serving
    const result = await worker.importPackages(session, { source: { files: inputFiles(join(dir, "input")) }, osUser });
    expect(result.summary.result).toBe("success");
  });

  it("says a session serves one operation at a time, as the direct call does", async () => {
    const { worker } = start();
    const { dir, transport, osUser } = importServer("s0-mini-defaults");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let armed = false;
    let held = false;
    const slow: FakeTransport = new FakeTransport(async (request, index) => {
      if (armed && !held) {
        held = true;
        await gate;
      }
      return (await transport.send(request)) as never;
    });
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport: slow });
    armed = true;
    const first = worker.importPackages(session, { source: { files: inputFiles(join(dir, "input")) }, osUser });
    await vi.waitFor(() => expect(held).toBe(true));
    await expect(worker.importPackages(session, { source: { files: inputFiles(join(dir, "input")) }, osUser })).rejects.toBeInstanceOf(SessionBusyError);
    release();
    expect((await first).summary.result).toBe("success");
  });
});

describe("exportPackages through the Worker (HOST-272, HOST-275)", () => {
  it.for(["e27-permission", "e04-design-to-goal"])("exports %s to the files the recording holds, byte for byte, as the direct call does", async (name) => {
    const { worker } = start();
    const { input, server, transport, options } = exportServer(name, true);
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const events: ProgressEvent[] = [];
    const result = await worker.exportPackages(session, { packages: input.packages.map((entry) => entry.name), ...options, onProgress: (event) => events.push(event) });
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(join(CASES, name)));
    const wanted = readDiskFiles(join(CASES, name, "output"));
    expect([...result.files.keys()].sort()).toEqual([...wanted.keys()].sort());
    for (const [path, bytes] of wanted) expect(Buffer.from(result.files.get(path) as Uint8Array).equals(bytes), `${name}: ${path} byte for byte`).toBe(true);
    expect(result.summary).toMatchObject({ operation: "export", engine: "14.0.7", result: "success" });
    expect(events.map((event) => event.phase)).toContain("completed");

    // the direct call on its own server gives the same files
    const direct = await runDirect(name);
    expect([...direct.files.keys()].sort()).toEqual([...result.files.keys()].sort());
    for (const [path, bytes] of direct.files) expect(Buffer.from(result.files.get(path) as Uint8Array).equals(Buffer.from(bytes)), `${name}: ${path} Worker and direct`).toBe(true);
    expect(direct.messages).toEqual(engineMessages(result.messages));
  });

  it("returns the zip of the working directory, which unzips to the same files", async () => {
    const { worker } = start();
    const { input, transport, options } = exportServer("e27-permission", true);
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const result = await worker.exportPackages(session, { packages: input.packages.map((entry) => entry.name), ...options, zip: true });
    expect(result.zip).toBeInstanceOf(Uint8Array);
    const { vfsFromZip } = await import("./zip.js");
    const unzipped = vfsFromZip(result.zip as Uint8Array).snapshot("/");
    for (const [path, bytes] of result.files) expect(Buffer.from(unzipped.get(path) as Uint8Array).equals(Buffer.from(bytes)), path).toBe(true);
    const without = exportServer("e27-permission", true);
    const second = await worker.connect({ ...LOGIN, engine: "14.0.7", transport: without.transport });
    expect((await worker.exportPackages(second, { packages: input.packages.map((entry) => entry.name), ...without.options })).zip).toBeUndefined();
  });

  it("asks the page's function for the answer to a failed item, and goes on as it answers", async () => {
    const { worker } = start();
    const name = "e40-workflow-promotion-error-yes";
    const { input, server, transport, options } = exportServer(name, true);
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const questions: string[] = [];
    const result = await worker.exportPackages(session, {
      packages: input.packages.map((entry) => entry.name),
      ...options,
      onItemError: (question) => {
        questions.push(question.text);
        return "continue";
      },
    });
    expect(server.mismatches).toEqual([]);
    expect(questions[0]).toContain("Abort current export");
    expect(result.summary.result).toBe("completed with engine errors");
    expect(engineMessages(result.messages)).toEqual(recordedMessages(join(CASES, name)));
  });

  it("takes a fixed answer to a failed item as it is, and refuses a wrong one with an OptionError", async () => {
    const { worker } = start();
    const { input, transport, options } = exportServer("e40-workflow-promotion-error-yes", true);
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const result = await worker.exportPackages(session, { packages: input.packages.map((entry) => entry.name), ...options, onItemError: "continue" });
    expect(result.summary.result).toBe("completed with engine errors");
    await expect(worker.exportPackages(session, { packages: ["a"], onItemError: "nope" as never })).rejects.toBeInstanceOf(OptionError);
  });

  it("an abort during the run cancels it as the engine's Cancel does, and the files that were written are returned", async () => {
    const { worker } = start();
    const name = "e55-lists-no-package-pair";
    const { input, transport, options } = exportServer(name, false);
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const controller = new AbortController();
    const result = await worker.exportPackages(session, {
      items: input.packages.flatMap((entry) => entry.items.map(({ type, id }) => ({ type, id }))),
      ...options,
      signal: controller.signal,
      onProgress: (event) => {
        if (event.phase === "item") controller.abort();
      },
    });
    expect(result.summary).toMatchObject({ aborted: true, result: "cancelled" });
    expect(result.messages.some((message) => message.text === "Export was canceled by user")).toBe(true);
  });

  it("reads the manifest a manifest-mode export names from the source it was given", async () => {
    const { worker } = start();
    const { transport } = exportServer("e27-permission", true);
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const error = await worker.exportPackages(session, { manifest: "/imports.mf", source: { files: new Map([["/other.txt", new Uint8Array([1])]]) } }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/imports\.mf/);
  });
});

describe("importLanguagePack through the Worker (HOST-270, HOST-274)", () => {
  it("replays lp01, logs the session off, and the page's session knows it is closed", async () => {
    const { worker } = start();
    const lp = join(new URL("../../fixtures/", import.meta.url).pathname, "14.0.7", "language-pack");
    const dir = join(lp, "lp01");
    const definition = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as { lpPackage: string; lpDebug: boolean };
    const server = new RecordedServer(readTranscript(join(dir, "transcript.jsonl"), join(lp, "_blobs")));
    const transport = new FakeTransport(server.handler);
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const result = await worker.importLanguagePack(session, {
      source: { files: inputFiles(join(dir, "lp")) },
      lpPackage: definition.lpPackage,
      lpDebug: definition.lpDebug,
      osUser: osUserOf(dir, join(lp, "_blobs")),
    });
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(dir));
    expect(result.summary).toMatchObject({ operation: "language-pack", result: "success" });
    expect(session.closed).toBe(true);
    expect(transport.requests.filter((request) => header(request, "SOAPAction") === "Logoff")).toHaveLength(1);
    await expect(worker.exportPackages(session, { packages: ["x"] })).rejects.toBeInstanceOf(SessionClosedError);
  });
});

describe("a failed language-pack import through the Worker (HOST-270, HOST-274)", () => {
  it("rejects, and the page's session knows the engine's flow closed it", async () => {
    const { worker } = start();
    const transport = serverOf(14, 0);
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    let down = false;
    const failing = await worker.connect({
      ...LOGIN,
      engine: "14.0.7",
      transport: {
        send: (request) => {
          if (down) throw new Error("the server went away");
          return transport.send(request);
        },
      },
    });
    down = true;
    await expect(worker.importLanguagePack(failing, { source: { files: new Map([["/ImportConfig.xml", "<x/>"]]) }, lpPackage: "p" })).rejects.toBeInstanceOf(Error);
    expect(failing.closed).toBe(true);
    await expect(worker.exportPackages(failing, { packages: ["x"] })).rejects.toBeInstanceOf(SessionClosedError);
    expect(session.closed).toBe(false);
  });

  it("leaves the session open when the failure comes before the engine's flow", async () => {
    const { worker } = start();
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport: serverOf(14, 0) });
    await expect(worker.importLanguagePack(session, { source: { zip: new Uint8Array([1, 2, 3]) }, lpPackage: "p" })).rejects.toBeInstanceOf(ZipError);
    expect(session.closed).toBe(false);
  });
});

describe("applyDbPatches through the Worker (HOST-272, HOST-274)", () => {
  it("refuses a DB patch run on an engine that has none, as the library's own error", async () => {
    const { worker } = start();
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport: serverOf(14, 0) });
    const error = await worker.applyDbPatches(session, { source: { files: new Map([["/manifest.xml", "<x/>"]]) }, manifestPath: "/manifest.xml" }).catch((failure: unknown) => failure);
    const { DbPatchesNotInEngineError } = await import("../db-patches/index.js");
    expect(error).toBeInstanceOf(DbPatchesNotInEngineError);
  });
});

// ------------------------------------------------------------------------------------------------------------ the credentials

describe("the password (HOST-274)", () => {
  it("crosses once, in the connect message, and the client keeps it nowhere", async () => {
    const { worker, posted } = start();
    const { dir, transport, osUser } = importServer("s0-mini-defaults");
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    await worker.importPackages(session, { source: { files: inputFiles(join(dir, "input")) }, osUser });
    await session.close();
    const carrying = posted.filter((message) => JSON.stringify(message).includes(secret));
    expect(carrying).toHaveLength(1);
    expect(carrying[0]).toMatchObject({ kind: "call", op: "connect" });
    expect(JSON.stringify(session)).not.toContain(secret);
    expect(JSON.stringify(Object.entries(worker))).not.toContain(secret);
    // the page's transport sees the password grant only, as with the direct call (WIRE-012)
    expect(transport.requests.filter((request) => !request.url.endsWith("/connect/token")).map((request) => Buffer.from(request.body ?? []).toString()).join("\n")).not.toContain(secret);
  });
});

// --------------------------------------------------------------------------------------------------------- the stop and the wire

describe("dispose and the wire (HOST-274)", () => {
  it("a graceful dispose logs the open sessions off and stops the Worker; later calls reject with WorkerDisposedError", async () => {
    const stopped = vi.fn();
    const { worker } = start({ onDisposed: stopped });
    const transport = serverOf(14, 0);
    const session = await worker.connect({ ...LOGIN, transport });
    await worker.dispose();
    expect(worker.disposed).toBe(true);
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(header(transport.requests.at(-1) as TransportRequest, "SOAPAction")).toBe("Logoff");
    await expect(worker.exportPackages(session, { packages: ["x"] })).rejects.toBeInstanceOf(WorkerDisposedError);
    await expect(worker.connect({ ...LOGIN, transport })).rejects.toBeInstanceOf(WorkerDisposedError);
    await worker.dispose();
  });

  it("a forced dispose stops a Worker that does not answer, and the calls that wait reject with WorkerDisposedError", async () => {
    const { port1 } = new MessageChannel();
    const closed = vi.fn();
    // nobody serves this port: a Worker that hangs
    const hung: WorkerLike = {
      postMessage: (message, transfer) => port1.postMessage(message, transfer),
      addEventListener: (type, listener) => port1.addEventListener(type, listener as EventListener),
      start: () => port1.start(),
      close: () => {
        closed();
        port1.close();
      },
    };
    const worker = createEngineWorker({ worker: hung });
    const waiting = worker.connect({ ...LOGIN, transport: serverOf(14, 0) });
    const assertion = expect(waiting).rejects.toBeInstanceOf(WorkerDisposedError);
    await worker.dispose({ force: true });
    await assertion;
    expect(closed).toHaveBeenCalled();
  });

  it("a graceful dispose of a Worker that does not answer ends at its timeout, and stops it", async () => {
    const { port1 } = new MessageChannel();
    const hung: WorkerLike = { postMessage: (message, transfer) => port1.postMessage(message, transfer), addEventListener: (type, listener) => port1.addEventListener(type, listener as EventListener), close: () => port1.close() };
    const worker = createEngineWorker({ worker: hung });
    const waiting = worker.connect({ ...LOGIN, transport: serverOf(14, 0) });
    const assertion = expect(waiting).rejects.toBeInstanceOf(WorkerDisposedError);
    await worker.dispose({ timeoutMs: 20 });
    await assertion;
  });

  it("a Worker that fails (its error event) ends the calls that wait with WorkerCrashedError", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const broken: WorkerLike = { postMessage: () => undefined, addEventListener: (type, listener) => void listeners.set(type, listener), terminate: vi.fn() };
    const worker = createEngineWorker({ worker: broken });
    const waiting = worker.connect({ ...LOGIN, transport: serverOf(14, 0) });
    listeners.get("error")?.({ message: "Failed to load the script" });
    await expect(waiting).rejects.toMatchObject({ name: "WorkerCrashedError", message: expect.stringContaining("Failed to load the script") as string });
    expect(broken.terminate).toHaveBeenCalled();
  });

  it("a message that cannot be read ends the calls that wait with WorkerCrashedError, and stops the Worker", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const broken: WorkerLike = { postMessage: () => undefined, addEventListener: (type, listener) => void listeners.set(type, listener), terminate: vi.fn() };
    const worker = createEngineWorker({ worker: broken });
    const waiting = worker.connect({ ...LOGIN, transport: serverOf(14, 0) });
    listeners.get("messageerror")?.({});
    await expect(waiting).rejects.toMatchObject({ name: "WorkerCrashedError" });
    expect(broken.terminate).toHaveBeenCalled();
    await expect(worker.connect({ ...LOGIN, transport: serverOf(14, 0) })).rejects.toBeInstanceOf(WorkerDisposedError);
  });

  it("an abort stops the reading of a file list at the next file, and the call rejects with the caller's reason", async () => {
    const toServer: Array<(event: unknown) => void> = [];
    const toClient: Array<(event: unknown) => void> = [];
    const page: WorkerLike = {
      postMessage: (message) => queueMicrotask(() => toServer.forEach((listener) => listener({ data: message }))),
      addEventListener: (type, listener) => void (type === "message" && toClient.push(listener)),
      close: () => undefined,
    };
    const port: ServerPort = {
      postMessage: (message) => queueMicrotask(() => toClient.forEach((listener) => listener({ data: message }))),
      addEventListener: (_type, listener) => void toServer.push(listener),
    };
    const worker = createEngineWorker({ worker: page });
    serveEngine(port);
    open.push(worker);
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport: serverOf(14, 0) });
    const controller = new AbortController();
    const reason = new Error("stop reading");
    let reads = 0;
    const fileNamed = (name: string) => ({
      name,
      size: 1,
      webkitRelativePath: `Pkg/${name}`,
      arrayBuffer: async () => {
        reads += 1;
        controller.abort(reason);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new ArrayBuffer(1);
      },
      slice: () => ({ arrayBuffer: async () => new ArrayBuffer(1) }),
    });
    await expect(worker.importPackages(session, { source: { fileList: [fileNamed("a.xml"), fileNamed("b.xml"), fileNamed("c.xml")] }, signal: controller.signal })).rejects.toBe(reason);
    expect(reads).toBe(1);
  });

  it("a graceful dispose ends its wait when the Worker crashes during it", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const broken: WorkerLike = { postMessage: () => undefined, addEventListener: (type, listener) => void listeners.set(type, listener), terminate: vi.fn() };
    const worker = createEngineWorker({ worker: broken });
    const done = vi.fn();
    const disposing = worker.dispose({ timeoutMs: 60_000 }).then(done);
    listeners.get("error")?.({ message: "gone" });
    await disposing;
    expect(done).toHaveBeenCalled();
  });

  it("transfers a page transport's response body", async () => {
    const { worker } = start();
    const inner = serverOf(14, 0);
    const bodies: Uint8Array[] = [];
    const session = await worker.connect({
      ...LOGIN,
      engine: "14.0.7",
      transport: {
        send: async (request) => {
          const response = await inner.send(request);
          const body = new Uint8Array(response.body);
          bodies.push(body);
          return { ...response, body };
        },
      },
    });
    expect(session.engine).toBe("14.0.7");
    expect(bodies.length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(bodies.every((body) => body.byteLength === 0)).toBe(true));
  });

  it("refuses a Worker of another protocol version, by name, and ends the calls that wait", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const other: WorkerLike = { postMessage: () => undefined, addEventListener: (type, listener) => void listeners.set(type, listener), terminate: vi.fn() };
    const worker = createEngineWorker({ worker: other });
    const waiting = worker.connect({ ...LOGIN, transport: serverOf(14, 0) });
    listeners.get("message")?.({ data: { v: 999, kind: "ready" } });
    await expect(waiting).rejects.toBeInstanceOf(WorkerProtocolError);
  });

  it("the Worker answers a call of another protocol version with WorkerProtocolError, and ignores what is not a message", async () => {
    const { port1, port2 } = new MessageChannel();
    serveEngine(port2 as unknown as ServerPort);
    const received: unknown[] = [];
    port1.addEventListener("message", (event) => received.push((event as MessageEvent).data));
    port1.start();
    port1.postMessage("hello");
    port1.postMessage({ v: 999, kind: "call", id: 7, op: "close", session: 1 });
    await vi.waitFor(() => expect(received.length).toBeGreaterThanOrEqual(2));
    expect(received[0]).toMatchObject({ kind: "ready" });
    expect(received[1]).toMatchObject({ kind: "error", id: 7, error: { type: "WorkerProtocolError" } });
    port1.close();
  });

  it("the Worker refuses a session it never made", async () => {
    const { port1, port2 } = new MessageChannel();
    serveEngine(port2 as unknown as ServerPort);
    const received: Array<{ kind: string; id?: number; error?: { type: string } }> = [];
    port1.addEventListener("message", (event) => received.push((event as MessageEvent).data));
    port1.start();
    port1.postMessage(toWorker({ kind: "call", id: 3, op: "close", session: 42 }));
    await vi.waitFor(() => expect(received.some((message) => message.kind === "error")).toBe(true));
    expect(received.find((message) => message.kind === "error")).toMatchObject({ id: 3, error: { type: "WorkerProtocolError" } });
    port1.close();
  });
});
