import { beforeEach, describe, expect, it } from "vitest";
import type { TranscriptCall } from "../../oracle/src/transcript.js";
import { MembershipServer, type ServerItem } from "../cli/membership-server.js";
import { RecordedDbPatchServer } from "../cli/replay-db-patch-transport.js";
import { RecordedServer } from "../cli/replay-transport.js";
import { FakeTransport, bodyText, header } from "../client/fake-transport.js";
import { packageCaches } from "../client/package-lookups.js";
import type { Engine } from "../engines.js";
import {
  type ApiMessage,
  type ProgressEvent,
  MemoryVfs,
  OptionError,
  SessionClosedError,
  applyDbPatches,
  connect,
  exportPackages,
  importLanguagePack,
  importPackages,
  vfsFromZip,
  vfsToZip,
} from "../browser.js";
import { LOGIN, engineMessages, recordedMessages, serverOf } from "./api-test-support.js";
import { type FixtureOperation, fixtureBlobPath } from "./fixture-set.js";
import { loadFixtureTree, readFixtureText } from "./test-support.browser.js";

/**
 * The browser API in the browsers (HOST-270 to HOST-273): the same calls as `api.test.ts`, through the bundle's entry, on recorded
 * runs that the Vitest server hands the page (HOST-263). `connect` follows the version of fake servers; an import runs from a tree and
 * from the bytes of a zip, is aborted, and fails; an export is zipped; a language pack and a DB patch are applied. The messages, the
 * progress and the files must be the recorded ones in each browser. The wire against a real HTTP origin is ticket 26's.
 *
 * @spec HOST-270 HOST-271 HOST-272 HOST-273
 */

// the dependency cache outlives a helper (EXP-619), and each case was recorded by a process of its own
beforeEach(() => packageCaches.dependsOn.clear());

// ---------------------------------------------------------------------------------------------------------------- recordings

/** A recorded transcript with its blobs put back, read through the restricted fixture commands. */
async function transcriptOf(dir: string, engine: Engine, operation: FixtureOperation, blobDir?: string): Promise<TranscriptCall[]> {
  const lines = (await readFixtureText(`${dir}/transcript.jsonl`)).split("\n").filter((line) => line !== "");
  return Promise.all(
    lines.map(async (line) => {
      const call = JSON.parse(line) as TranscriptCall;
      if (call.responseBlob === undefined) return call;
      const { responseBlob, ...rest } = call;
      const path = blobDir === undefined ? fixtureBlobPath({ engine, operation }, responseBlob) : `${blobDir}/${responseBlob}.xml`;
      return { ...rest, response: await readFixtureText(path) };
    }),
  );
}

const osUserOf = (calls: readonly TranscriptCall[]): string => /<os_user>([^<]*)<\/os_user>/.exec(calls.map((call) => call.request).join("\n"))?.[1] ?? "";

/** A tree of the files of a fixture folder, at the root of the tree. */
async function treeOf(dir: string): Promise<MemoryVfs> {
  const vfs = new MemoryVfs();
  const files: Record<string, Uint8Array> = {};
  for (const file of await loadFixtureTree(dir)) files[`/${file.path}`] = file.bytes;
  vfs.mount(files);
  return vfs;
}

interface StepOptions {
  merge?: boolean;
  release?: string;
  description?: string;
  verbose?: boolean;
  languages?: string;
  amlBatch?: { maxSize?: number };
  collectErrors?: { maxCount?: number };
  cancelAfterStatus?: number;
}

async function importStep(engine: Engine, name: string, index = 1) {
  const base = `fixtures/${engine}/import/${name}`;
  const dir = `${base}/step-${index}`;
  const definition = JSON.parse(await readFixtureText(`${base}/case.json`)) as { steps: Array<{ options: StepOptions }> };
  const options = definition.steps[index - 1]?.options ?? {};
  const calls = await transcriptOf(dir, engine, "import");
  const server = new RecordedServer(calls, engine);
  const transport = new FakeTransport(server.handler);
  const session = await connect({ ...LOGIN, engine, transport });
  const source = await treeOf(`${dir}/input`);
  const recorded = recordedMessages(await readFixtureText(`${dir}/messages.jsonl`));
  const run = JSON.parse(await readFixtureText(`${dir}/run.json`)) as { host: { result: string | null } };
  const returned = Number(/^ImportSolutions returned (\d+)$/.exec(run.host.result ?? "")?.[1] ?? "NaN");
  const settings = {
    osUser: osUserOf(calls),
    ...(options.merge === true ? { merge: true } : {}),
    ...(options.verbose === true ? { verbose: true } : {}),
    ...(options.release === undefined ? {} : { release: options.release }),
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.languages === undefined ? {} : { languages: options.languages }),
    ...(options.amlBatch === undefined ? {} : { batch: { maxSize: options.amlBatch.maxSize ?? 0 } }),
    ...(options.collectErrors === undefined ? {} : { collectErrors: { maxCount: options.collectErrors.maxCount ?? 0 } }),
  };
  return { server, transport, session, source, recorded, returned, settings, options };
}

// ---------------------------------------------------------------------------------------------------------------- connect

describe("connect, in the browsers (HOST-270)", () => {
  it.for([
    [12, 0, "12.0"],
    [14, 0, "14.0.7"],
    [14, 35, "14.35"],
  ] as const)("follows a %i.%i server to engine %s", async ([major, minor, engine]) => {
    const transport = serverOf(major, minor);
    const session = await connect({ ...LOGIN, transport });
    expect(session.engine).toBe(engine);
    expect(session.serverVersion.major).toBe(major);
    await session.close();
    expect(header(transport.requests.at(-1) as never, "SOAPAction")).toBe("Logoff");
    // the password grant of 14.35 sends the password as given, to the token endpoint only (WIRE-012); no other request carries it
    expect(transport.requests.filter((request) => !request.url.endsWith("/connect/token")).map(bodyText).join("\n")).not.toContain("secret-pw");
    await expect(exportPackages(session, { packages: ["x"] })).rejects.toBeInstanceOf(SessionClosedError);
  });

  it("takes the bearer token from the caller's provider and makes no password grant (HOST-271)", async () => {
    const transport = serverOf(14, 0);
    const session = await connect({
      url: LOGIN.url,
      database: LOGIN.database,
      timeZoneName: "UTC",
      tokenProvider: { getAccessToken: () => Promise.resolve("from-the-client") },
      transport,
    });
    expect(session.engine).toBe("14.0.7");
    expect(transport.requests.some((request) => request.url.endsWith("/connect/token"))).toBe(false);
    for (const request of transport.requests.filter((r) => header(r, "SOAPAction") !== undefined)) {
      expect(header(request, "Authorization")).toBe("Bearer from-the-client");
    }
  });

  it("refuses options before it sends anything", async () => {
    const transport = serverOf(14, 0);
    await expect(connect({ ...LOGIN, password: "", transport })).rejects.toBeInstanceOf(OptionError);
    expect(transport.requests).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------------------------------------------- import

describe("importPackages, in the browsers (HOST-272, HOST-273)", () => {
  it.for([["14.0.7"], ["14.35"]] as const)("replays s0-mini-defaults on %s from a tree, in the order the progress is promised", async ([engine]) => {
    const { server, session, source, recorded, settings } = await importStep(engine, "s0-mini-defaults");
    const events: ProgressEvent[] = [];
    const lines: ApiMessage[] = [];
    const result = await importPackages(session, { source, onProgress: (event) => events.push(event), onMessage: (line) => lines.push(line), ...settings });
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(engineMessages(result.messages)).toEqual(recorded);
    expect(result.summary).toMatchObject({ operation: "import", engine, result: "success", returnCode: 0 });
    const phases = events.map((event) => event.phase);
    expect(phases[0]).toBe("package");
    expect(events.filter((event) => event.phase === "item").map((event) => event.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(phases.indexOf("references")).toBeGreaterThan(phases.lastIndexOf("item"));
    expect(phases.at(-1)).toBe("completed");
    expect(lines).toEqual(result.messages);
  });

  it("imports from the bytes of a zip with the same requests and messages", async () => {
    const { server, session, source, recorded, settings } = await importStep("14.0.7", "s0-mini-defaults");
    const zip = vfsToZip(source, "/");
    const result = await importPackages(session, { source: { zip }, ...settings });
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(engineMessages(result.messages)).toEqual(recorded);
  });

  it("is cancelled by its signal as the recorded cancel is", async () => {
    const { server, session, source, recorded, settings, options } = await importStep("14.0.7", "s0-mini-cancel");
    const controller = new AbortController();
    let statuses = 0;
    const result = await importPackages(session, {
      source,
      signal: controller.signal,
      onMessage: (message) => {
        if (message.channel === "status" && (statuses += 1) === options.cancelAfterStatus) controller.abort();
      },
      ...settings,
    });
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(engineMessages(result.messages)).toEqual(recorded);
    expect(result.summary).toMatchObject({ aborted: true, result: "cancelled" });
  });

  it("reports the errors it collected, as the recorded run did", async () => {
    const { server, session, source, recorded, settings, returned } = await importStep("14.35", "collect-two-errors-max2");
    const result = await importPackages(session, { source, ...settings });
    expect(server.mismatches).toEqual([]);
    expect(engineMessages(result.messages)).toEqual(recorded);
    expect(result.summary.returnCode).toBe(returned);
    expect(result.summary.messages.errors).toBeGreaterThan(0);
    expect(result.summary.result).not.toBe("success");
  });

  it("replays 12.0", async () => {
    const { server, session, source, recorded, settings } = await importStep("12.0", "s3-unres-delayed");
    const result = await importPackages(session, { source, ...settings });
    expect(server.mismatches).toEqual([]);
    expect(engineMessages(result.messages)).toEqual(recorded);
    expect(result.summary.engine).toBe("12.0");
  });
});

// ----------------------------------------------------------------------------------------------------------------- export

describe("exportPackages, in the browsers (HOST-272)", () => {
  it("replays e27-permission and zips the export to the files the recording holds", async () => {
    const base = "fixtures/14.0.7/export/e27-permission";
    const input = JSON.parse(await readFixtureText(`${base}/case.json`)) as {
      packages: Array<{ name: string; items: Array<{ type: string; id: string; keyedName: string }> }>;
    };
    const calls = await transcriptOf(base, "14.0.7", "export");
    const server = new RecordedServer(calls);
    const items: ServerItem[] = input.packages.flatMap((entry) =>
      entry.items.map((item) => ({ type: item.type, id: item.id, keyedName: item.keyedName, packageName: entry.name })),
    );
    const membership = new MembershipServer(items, server.handler);
    membership.answersPackageList = true;
    const session = await connect({ ...LOGIN, engine: "14.0.7", transport: new FakeTransport(membership.handler) });
    const recordedLog = await readFixtureText(`${base}/engine.log`);
    const level = /^Export level: (.*)\r$/m.exec(recordedLog)?.[1] ?? "";
    const events: ProgressEvent[] = [];
    const result = await exportPackages(session, {
      packages: input.packages.map((entry) => entry.name),
      ...(level === "" ? {} : { level }),
      onProgress: (event) => events.push(event),
    });
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(await readFixtureText(`${base}/messages.jsonl`)));
    expect(events.map((event) => event.phase)).toEqual(["package", "item", "completed"]);

    const wanted = new Map((await loadFixtureTree(`${base}/output`)).map((file) => [file.path, file.bytes] as const));
    expect([...result.files.keys()].sort()).toEqual([...wanted.keys()].sort());
    const zip = vfsToZip(result.vfs, "/export");
    expect(vfsToZip(result.vfs, "/export")).toEqual(zip);
    const unzipped = vfsFromZip(zip).snapshot("/");
    for (const [path, bytes] of wanted) {
      expect(result.files.get(path), `${path} from the run`).toEqual(bytes);
      expect(unzipped.get(path), `${path} from the zip`).toEqual(bytes);
    }
  });
});

// ------------------------------------------------------------------------------------------------ language pack, DB patches

describe("importLanguagePack and applyDbPatches, in the browsers (HOST-272)", () => {
  it("replays lp01 on 14.0.7 and logs the session off", async () => {
    const base = "fixtures/14.0.7/language-pack/lp01";
    const definition = JSON.parse(await readFixtureText(`${base}/case.json`)) as { lpPackage: string; lpDebug: boolean };
    const calls = await transcriptOf(base, "14.0.7", "language-pack");
    const server = new RecordedServer(calls);
    const transport = new FakeTransport(server.handler);
    const session = await connect({ ...LOGIN, engine: "14.0.7", transport });
    const result = await importLanguagePack(session, {
      source: await treeOf(`${base}/lp`),
      lpPackage: definition.lpPackage,
      lpDebug: definition.lpDebug,
      osUser: osUserOf(calls),
    });
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(engineMessages(result.messages)).toEqual(recordedMessages(await readFixtureText(`${base}/messages.jsonl`)));
    expect(transport.requests.filter((request) => header(request, "SOAPAction") === "Logoff")).toHaveLength(1);
    expect(session.closed).toBe(true);
  });

  it("applies the no-op DB patch of the recording as root on 14.35", async () => {
    const base = "fixtures/14.35/dbpatch/apply/step-1";
    const calls = await transcriptOf(base, "14.35", "dbpatch", `${base}/_blobs`);
    const server = new RecordedDbPatchServer(calls);
    const session = await connect({ ...LOGIN, userName: "root", engine: "14.35", transport: new FakeTransport(server.handler) });
    const result = await applyDbPatches(session, { source: await treeOf(`${base}/input`), manifestPath: "/manifest.xml", osUser: osUserOf(calls) });
    expect(server.mismatches).toEqual([]);
    expect(server.consumed).toBe(server.total);
    expect(result.summary).toMatchObject({ operation: "db-patches", engine: "14.35", result: "success" });
  });
});
