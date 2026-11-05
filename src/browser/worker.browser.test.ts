import { commands } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TranscriptCall } from "../../oracle/src/transcript.js";
import { MembershipServer, type ServerItem } from "../cli/membership-server.js";
import { RecordedServer } from "../cli/replay-transport.js";
import { FakeTransport } from "../client/fake-transport.js";
import { packageCaches } from "../client/package-lookups.js";
import type { Engine } from "../engines.js";
import {
  type EngineWorker,
  CItemException,
  MemoryVfs,
  OptionError,
  WorkerDisposedError,
  commitToDirectory,
  connect,
  createEngineWorker,
  exportPackages,
  importPackages,
  vfsFromZip,
  vfsToZip,
} from "../browser.js";
import { LOGIN, engineMessages, recordedMessages } from "./api-test-support.js";
import { type FixtureOperation, fixtureBlobPath } from "./fixture-set.js";
import { loadFixtureTree, readFixtureText } from "./test-support.browser.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    workerBundle(): Promise<string>;
  }
}

/**
 * The engine's Worker in the browsers (HOST-274 to HOST-276): the bundle that ships, `dist/browser-worker.js`'s source built by the Vitest
 * server and started as a module Worker from a Blob URL, driven by the client of `worker-client.ts`. The smallest recorded export and
 * import run through it and must equal the direct call byte for byte; a 14.35 export must leave the page's thread free; an abort ends
 * a run as cancelled; the errors come back as the library's classes; and a folder is read in the Worker from a directory handle.
 *
 * The page serves the Worker's requests with the recorded server (the `transport` option of `connect`), so the wire itself, which
 * ticket 26 covers against a real origin, is not what these tests are about.
 *
 * @spec HOST-274 HOST-275 HOST-276
 */

// the dependency cache outlives a helper (EXP-619), and each case was recorded by a process of its own
beforeEach(() => packageCaches.dependsOn.clear());

// ------------------------------------------------------------------------------------------------------------------- the Worker

let bundleUrl: string | undefined;
const started: EngineWorker[] = [];

/** A Worker running the shipped bundle: a module Worker from the text of `dist/browser-worker.js`. */
async function startWorker(): Promise<EngineWorker> {
  bundleUrl ??= URL.createObjectURL(new Blob([await commands.workerBundle()], { type: "text/javascript" }));
  const worker = createEngineWorker({ worker: bundleUrl });
  started.push(worker);
  return worker;
}

afterEach(async () => {
  await Promise.all(started.splice(0).map((worker) => worker.dispose({ force: true })));
});

// ---------------------------------------------------------------------------------------------------------------- recordings

async function transcriptOf(dir: string, engine: Engine, operation: FixtureOperation): Promise<TranscriptCall[]> {
  const lines = (await readFixtureText(`${dir}/transcript.jsonl`)).split("\n").filter((line) => line !== "");
  return Promise.all(
    lines.map(async (line) => {
      const call = JSON.parse(line) as TranscriptCall;
      if (call.responseBlob === undefined) return call;
      const { responseBlob, ...rest } = call;
      return { ...rest, response: await readFixtureText(fixtureBlobPath({ engine, operation }, responseBlob)) };
    }),
  );
}

const osUserOf = (calls: readonly TranscriptCall[]): string => /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";

interface ExportCase {
  packages: Array<{ name: string; items: Array<{ type: string; id: string; keyedName: string }> }>;
}

/** The recorded server of an export case, wrapped in the membership reads of a selection by package, and the options the recording was made with. */
async function exportRecording(engine: Engine, name: string) {
  const base = `fixtures/${engine}/export/${name}`;
  const input = JSON.parse(await readFixtureText(`${base}/case.json`)) as ExportCase;
  const server = new RecordedServer(await transcriptOf(base, engine, "export"), engine);
  const items: ServerItem[] = input.packages.flatMap((entry) => entry.items.map((item) => ({ type: item.type, id: item.id, keyedName: item.keyedName, packageName: entry.name })));
  const membership = new MembershipServer(items, server.handler);
  membership.answersPackageList = true;
  const level = /^Export level: (.*)\r$/m.exec(await readFixtureText(`${base}/engine.log`))?.[1] ?? "";
  return {
    base,
    server,
    transport: new FakeTransport(membership.handler),
    packages: input.packages.map((entry) => entry.name),
    options: level === "" ? {} : { level },
  };
}

async function importRecording(engine: Engine, name: string, index = 1) {
  const base = `fixtures/${engine}/import/${name}`;
  const dir = `${base}/step-${index}`;
  const calls = await transcriptOf(dir, engine, "import");
  const definition = JSON.parse(await readFixtureText(`${base}/case.json`)) as { steps: Array<{ options: { cancelAfterStatus?: number } }> };
  const input = await loadFixtureTree(`${dir}/input`);
  return {
    dir,
    server: new RecordedServer(calls, engine),
    osUser: osUserOf(calls),
    input,
    cancelAfterStatus: definition.steps[index - 1]?.options.cancelAfterStatus,
    recorded: recordedMessages(await readFixtureText(`${dir}/messages.jsonl`)),
  };
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);

// ----------------------------------------------------------------------------------------------------------------- the runs

describe("an export through the Worker equals the direct call, byte for byte (HOST-274, HOST-275)", () => {
  it.for(["12.0", "14.0.7", "14.35"] as const)("replays e27-permission on %s", async (engine) => {
    const worker = await startWorker();
    const { base, server, transport, packages, options } = await exportRecording(engine, "e27-permission");
    const session = await worker.connect({ ...LOGIN, engine, transport });
    expect(session.engine).toBe(engine);
    const result = await worker.exportPackages(session, { packages, ...options, zip: true });
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(await readFixtureText(`${base}/messages.jsonl`)));
    expect(result.summary).toMatchObject({ operation: "export", engine, result: "success" });

    // the files the recording holds
    const wanted = new Map((await loadFixtureTree(`${base}/output`)).map((file) => [file.path, file.bytes] as const));
    expect([...result.files.keys()].sort()).toEqual([...wanted.keys()].sort());
    for (const [path, bytes] of wanted) expect(sameBytes(result.files.get(path) as Uint8Array, bytes), `${path} of the recording`).toBe(true);

    // the files of the direct call, on a server of its own
    const again = await exportRecording(engine, "e27-permission");
    const direct = await exportPackages(await connect({ ...LOGIN, engine, transport: again.transport }), { packages: again.packages, ...again.options });
    expect([...direct.files.keys()].sort()).toEqual([...result.files.keys()].sort());
    for (const [path, bytes] of direct.files) expect(sameBytes(result.files.get(path) as Uint8Array, bytes), `${path}: Worker and direct call`).toBe(true);
    expect(engineMessages(direct.messages)).toEqual(engineMessages(result.messages));
    expect(direct.summary).toEqual(result.summary);

    // the zip is the zip of the direct call's tree
    expect(sameBytes(result.zip as Uint8Array, vfsToZip(direct.vfs, "/export"))).toBe(true);
  });

  it("streams the progress and the messages to the page as they come, in the engine's order", async () => {
    const worker = await startWorker();
    const { transport, packages, options } = await exportRecording("14.0.7", "e27-permission");
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const phases: string[] = [];
    const seen: string[] = [];
    const result = await worker.exportPackages(session, {
      packages,
      ...options,
      onProgress: (event) => phases.push(event.phase),
      onMessage: (message) => seen.push(message.text),
    });
    expect(phases).toEqual(["package", "item", "completed"]);
    expect(seen).toEqual(result.messages.map((message) => message.text));
  });
});

describe("an import through the Worker equals the direct call (HOST-274, HOST-275)", () => {
  it.for(["12.0", "14.0.7", "14.35"] as const)("replays s0-mini-defaults on %s from the bytes of a zip, which are transferred", async (engine) => {
    const worker = await startWorker();
    const { server, osUser, input, recorded } = await importRecording(engine, "s0-mini-defaults");
    const session = await worker.connect({ ...LOGIN, engine, transport: new FakeTransport(server.handler) });
    const tree = new MemoryVfs();
    tree.mount(Object.fromEntries(input.map((file) => [`/${file.path}`, file.bytes])));
    const zip = vfsToZip(tree, "/");
    const bytes = zip.byteLength;
    const result = await worker.importPackages(session, { source: { zip }, osUser });
    expect(zip.byteLength, "the buffer was transferred").toBe(0);
    expect(bytes).toBeGreaterThan(0);
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(engineMessages(result.messages)).toEqual(recorded);
    expect(result.summary).toMatchObject({ operation: "import", engine, result: "success", returnCode: 0 });

    // the direct call on a server of its own gives the same messages and summary
    const again = await importRecording(engine, "s0-mini-defaults");
    const source = new MemoryVfs();
    source.mount(Object.fromEntries(again.input.map((file) => [`/${file.path}`, file.bytes])));
    const direct = await importPackages(await connect({ ...LOGIN, engine, transport: new FakeTransport(again.server.handler) }), { source, osUser: again.osUser });
    expect(engineMessages(direct.messages)).toEqual(engineMessages(result.messages));
    expect(direct.summary).toEqual(result.summary);
  });

  it("imports from the files of a map, and from the Files of a folder input read in the Worker", async () => {
    const worker = await startWorker();
    const first = await importRecording("14.0.7", "s0-mini-defaults");
    const one = await worker.connect({ ...LOGIN, engine: "14.0.7", transport: new FakeTransport(first.server.handler) });
    const byFiles = await worker.importPackages(one, { source: { files: new Map(first.input.map((file) => [file.path, file.bytes])) }, osUser: first.osUser });
    expect(engineMessages(byFiles.messages)).toEqual(first.recorded);

    const second = await importRecording("14.0.7", "s0-mini-defaults");
    const two = await worker.connect({ ...LOGIN, engine: "14.0.7", transport: new FakeTransport(second.server.handler) });
    const fileList = second.input.map((file) => {
      const picked = new File([file.bytes as BlobPart], file.path.slice(file.path.lastIndexOf("/") + 1));
      // what `<input webkitdirectory>` reports; a cloned File loses it, so the client sends it beside the File
      Object.defineProperty(picked, "webkitRelativePath", { value: `Chosen/${file.path}` });
      return picked;
    });
    const byList = await worker.importPackages(two, { source: { fileList, mount: { root: "auto" } }, osUser: second.osUser });
    expect(second.server.mismatches).toEqual([]);
    expect(engineMessages(byList.messages)).toEqual(second.recorded);
  });

  // WebKit writes a file of the origin private file system only from a Worker (`createWritable` is not on the page's thread there),
  // and this test writes the folder from the page: where that cannot be done, the handle cannot be made and the test is not run.
  const canWriteOnPage = typeof FileSystemFileHandle !== "undefined" && "createWritable" in FileSystemFileHandle.prototype;
  it.skipIf(!canWriteOnPage)("imports from a directory handle, which the Worker reads: the picker's job stays on the page, the reading does not", async () => {
    const worker = await startWorker();
    const { server, osUser, input, recorded } = await importRecording("14.0.7", "s0-mini-defaults");
    const root = await navigator.storage.getDirectory();
    const name = `worker-test-${crypto.randomUUID()}`;
    const folder = await root.getDirectoryHandle(name, { create: true });
    try {
      const tree = new MemoryVfs();
      tree.mount(Object.fromEntries(input.map((file) => [`/${file.path}`, file.bytes])));
      await commitToDirectory(tree, folder as never);
      const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport: new FakeTransport(server.handler) });
      const result = await worker.importPackages(session, { source: { directory: folder as never }, osUser });
      expect(server.mismatches).toEqual([]);
      expect(engineMessages(result.messages)).toEqual(recorded);
      expect(result.summary.result).toBe("success");
    } finally {
      await root.removeEntry(name, { recursive: true });
    }
  });

  it("is cancelled by its signal as the recorded cancel is, and nothing is left unhandled", async () => {
    const unhandled: unknown[] = [];
    const record = (event: PromiseRejectionEvent): void => void unhandled.push(event.reason);
    globalThis.addEventListener("unhandledrejection", record);
    try {
      const worker = await startWorker();
      const { server, osUser, input, recorded, cancelAfterStatus } = await importRecording("14.0.7", "s0-mini-cancel");
      const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport: new FakeTransport(server.handler) });
      const controller = new AbortController();
      let statuses = 0;
      const result = await worker.importPackages(session, {
        source: { files: new Map(input.map((file) => [file.path, file.bytes])) },
        osUser,
        signal: controller.signal,
        onMessage: (message) => {
          if (message.channel === "status" && (statuses += 1) === cancelAfterStatus) controller.abort();
        },
      });
      expect(server.mismatches).toEqual([]);
      expect(engineMessages(result.messages)).toEqual(recorded);
      expect(result.summary).toMatchObject({ aborted: true, result: "cancelled" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
    } finally {
      globalThis.removeEventListener("unhandledrejection", record);
    }
  });
});

describe("an abort in the middle of an export (HOST-274)", () => {
  it("ends it as the engine ends a cancelled run, and the files it had written come back", async () => {
    const unhandled: unknown[] = [];
    const record = (event: PromiseRejectionEvent): void => void unhandled.push(event.reason);
    globalThis.addEventListener("unhandledrejection", record);
    try {
      const worker = await startWorker();
      const base = "fixtures/14.0.7/export/e55-lists-no-package-pair";
      const input = JSON.parse(await readFixtureText(`${base}/case.json`)) as ExportCase;
      const server = new RecordedServer(await transcriptOf(base, "14.0.7", "export"), "14.0.7");
      const items: ServerItem[] = input.packages.flatMap((entry) => entry.items.map((item) => ({ type: item.type, id: item.id, keyedName: item.keyedName, packageName: entry.name })));
      const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport: new FakeTransport(new MembershipServer(items, server.handler).handler) });
      const controller = new AbortController();
      const result = await worker.exportPackages(session, {
        items: input.packages.flatMap((entry) => entry.items.map(({ type, id }) => ({ type, id }))),
        signal: controller.signal,
        onProgress: (event) => {
          if (event.phase === "item") controller.abort();
        },
      });
      expect(result.summary).toMatchObject({ aborted: true, result: "cancelled" });
      expect(result.messages.some((message) => message.text === "Export was canceled by user")).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
    } finally {
      globalThis.removeEventListener("unhandledrejection", record);
    }
  });
});

// ----------------------------------------------------------------------------------------------------------------- the thread

/** Records the longest time between two ticks of a timer: the longest the page's thread was held. */
function ticker(intervalMs: number) {
  let last = performance.now();
  let longest = 0;
  const id = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, intervalMs);
  return {
    stop(): number {
      clearInterval(id);
      return Math.max(longest, performance.now() - last);
    },
  };
}

describe("the page stays responsive (HOST-274)", () => {
  it("the ticker sees a thread that is held (the alarm is not vacuous)", async () => {
    const watch = ticker(10);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const until = performance.now() + 300;
    while (performance.now() < until) {
      // hold the thread
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(watch.stop()).toBeGreaterThanOrEqual(250);
  });

  it("a 14.35 export through the Worker never holds the page's thread for 200 ms", async () => {
    const worker = await startWorker();
    const { transport, packages, options } = await exportRecording("14.35", "e27-permission");
    const session = await worker.connect({ ...LOGIN, engine: "14.35", transport });
    const watch = ticker(10);
    const result = await worker.exportPackages(session, { packages, ...options });
    const longest = watch.stop();
    expect(result.summary.result).toBe("success");
    console.info(`HOST-274: longest gap of the page's timer during a 14.35 export through the Worker: ${longest.toFixed(1)} ms`);
    expect(longest, "a regression alarm for engine work that ran on the page's thread").toBeLessThan(200);
  });
});

// ------------------------------------------------------------------------------------------------------------------- errors

describe("errors and the stop, in the browsers (HOST-274, HOST-275)", () => {
  it("rejects with the library's own classes, which the page can test with instanceof", async () => {
    const worker = await startWorker();
    const { transport } = await exportRecording("14.0.7", "e27-permission");
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const refused = await worker.exportPackages(session, { packages: [] }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(OptionError);
    expect((refused as Error).stack).toContain("OptionError");
    const noLogin = await worker.connect({ ...LOGIN, password: "", transport }).catch((error: unknown) => error);
    expect(noLogin).toBeInstanceOf(OptionError);
  });

  it("a network failure inside the Worker comes back as an error of the library, not a bare TypeError", async () => {
    const worker = await startWorker();
    // no transport given: the Worker's own fetch, to a port nothing listens on
    const error = await worker.connect({ ...LOGIN, url: "http://127.0.0.1:9/Server", timeoutMs: 5_000 }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(CItemException);
    expect(error).not.toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain("Failed login to Innovator");
    console.info(`HOST-275: a refused connection inside the Worker is ${(error as Error).name}: ${(error as Error).message}`);
  });

  it("a forced dispose stops the Worker at once and the call that waits rejects with WorkerDisposedError", async () => {
    const worker = await startWorker();
    // the page's transport never answers: the Worker waits for it
    const stuck = { send: () => new Promise<never>(() => undefined) };
    const waiting = worker.connect({ ...LOGIN, transport: stuck });
    const assertion = expect(waiting).rejects.toBeInstanceOf(WorkerDisposedError);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await worker.dispose({ force: true });
    await assertion;
    expect(worker.disposed).toBe(true);
  });

  it("a graceful dispose logs the open session off before the Worker stops", async () => {
    const worker = await startWorker();
    const { transport } = await exportRecording("14.0.7", "e27-permission");
    await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    await worker.dispose();
    expect(transport.requests.at(-1)?.headers.find(([name]) => name.toLowerCase() === "soapaction")?.[1]).toBe("Logoff");
  });

  it("round-trips a zip the Worker unzipped: the files of an export, zipped by the Worker, unzip on the page to the same tree", async () => {
    const worker = await startWorker();
    const { transport, packages, options } = await exportRecording("14.0.7", "e27-permission");
    const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport });
    const result = await worker.exportPackages(session, { packages, ...options, zip: true });
    const unzipped = vfsFromZip(result.zip as Uint8Array).snapshot("/");
    expect([...unzipped.keys()].sort()).toEqual([...result.files.keys()].sort());
    for (const [path, bytes] of result.files) expect(sameBytes(unzipped.get(path) as Uint8Array, bytes), path).toBe(true);
  });
});
