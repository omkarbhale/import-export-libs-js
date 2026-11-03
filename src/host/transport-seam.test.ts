import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpServerConnection } from "../client/connection.js";
import type { ConnectionSettings } from "../client/connection.js";
import { FakeTransport, respond } from "../client/fake-transport.js";
import * as clientEntry from "../client/index.js";
import * as nodeEntry from "../index.js";
import { defaultTransport } from "./default-host.js";
import { nodeTransport } from "./node-transport.js";

/**
 * The transport seam (HOST-230): the types stay in `client/transport.ts`, Node's implementation is in `host/node-transport.ts`,
 * and a connection takes its transport from the settings or from the default host.
 * @spec HOST-230
 */
const settings: ConnectionSettings = {
  url: "http://aras.example/InnovatorServer/",
  database: "db",
  userName: "admin",
  password: "secret",
  locale: "en-US",
  timeZoneName: "UTC",
};

describe("HOST-230: the transport seam", () => {
  afterEach(() => {
    vi.doUnmock("./default-host.js");
    vi.resetModules();
  });

  it("answers nodeTransport as the default host's transport on Node", () => {
    expect(defaultTransport()).toBe(nodeTransport);
  });

  it("builds a connection from the settings' transport, or from the default host's when there is none", () => {
    expect(() => new HttpServerConnection({ ...settings, transport: new FakeTransport(() => respond("")) })).not.toThrow();
    expect(() => new HttpServerConnection(settings)).not.toThrow();
  });

  it("throws a clear error at construction when neither the settings nor the host has a transport", async () => {
    vi.resetModules();
    vi.doMock("./default-host.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./default-host.js")>()),
      defaultTransport: () => undefined,
    }));
    const { HttpServerConnection: Connection } = await import("../client/connection.js");
    expect(() => new Connection(settings)).toThrow(new Error("a transport is required in this environment"));
    expect(() => new Connection({ ...settings, transport: new FakeTransport(() => respond("")) })).not.toThrow();
  });

  it("keeps nodeTransport in the public Node API and out of the portable client", () => {
    expect(nodeEntry.nodeTransport).toBe(nodeTransport);
    expect("nodeTransport" in clientEntry).toBe(false);
  });

  it("has no file of src/ but the Node transport (and the tests that serve it) importing node:http or node:https", () => {
    const root = process.cwd();
    const walk = (folder: string): string[] =>
      readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(folder, entry.name)) : entry.name.endsWith(".ts") ? [join(folder, entry.name)] : [],
      );
    const importing = walk(join(root, "src"))
      .map((file) => relative(root, file).split("\\").join("/"))
      .filter((file) => !file.endsWith(".test.ts"))
      .filter((file) => /from\s+"node:https?"|import\("node:https?"\)/.test(readFileSync(join(root, file), "utf8")));
    expect(importing).toEqual(["src/host/node-transport.ts"]);
  });
});
