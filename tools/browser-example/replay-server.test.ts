import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryVfs, connect, createFetchTransport, exportPackages, importPackages } from "../../src/browser.js";
import { loadTreeIntoVfs } from "../../src/browser/test-support.js";
import { packageCaches } from "../../src/client/package-lookups.js";
import { type ReplayServer, loadReplayCase, startReplayServer } from "./replay-server.js";
import { SECURITY_HEADERS, serveFolder } from "./serve.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The replay server and the static server of the reference page (HOST-280), in Node: a recorded run served over HTTP is answered
 * to the library's own browser API through `fetch`, request for request, and the page's files are served with the headers of
 * HOST-281.
 *
 * @spec HOST-280 HOST-281
 */

let server: ReplayServer | undefined;

beforeEach(() => packageCaches.dependsOn.clear());
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("the replay server", () => {
  it("answers a recorded import over HTTP, as recorded, and starts again after the logoff", async () => {
    const replay = loadReplayCase("14.0.7/import/s0-mini-defaults");
    server = await startReplayServer(replay);
    for (const pass of [1, 2]) {
      const session = await connect({ url: server.url, database: "12sp9", userName: "admin", password: "x", engine: "14.0.7", timeZoneName: "UTC", transport: createFetchTransport() });
      const tree = new MemoryVfs();
      loadTreeIntoVfs(replay.recipe.inputDir as string, tree, "/");
      const result = await importPackages(session, { source: tree, osUser: replay.recipe.osUser as string });
      await session.close();
      expect(result.summary, `pass ${pass}`).toMatchObject({ result: "success", returnCode: 0 });
    }
    const report = server.report();
    expect(report.mismatches).toEqual([]);
    expect(report.runs).toBe(3); // one per login, and the one that is waiting
    expect(report.consumed).toBe(2 * report.total);
  });

  it("answers a recorded export of packages", async () => {
    const replay = loadReplayCase("14.0.7/export/e27-permission");
    server = await startReplayServer(replay);
    const session = await connect({ url: server.url, database: "12sp9", userName: "admin", password: "x", engine: "14.0.7", timeZoneName: "UTC", transport: createFetchTransport() });
    const result = await exportPackages(session, { packages: replay.recipe.packages as string[], ...(replay.recipe.level === undefined ? {} : { level: replay.recipe.level }) });
    await session.close();
    expect(result.files.size).toBeGreaterThan(0);
    expect(server.report().mismatches).toEqual([]);
    expect(server.report().consumed).toBe(server.report().total);
  });

  it("answers the preflight with the page's origin and the headers it asked for", async () => {
    server = await startReplayServer(loadReplayCase("14.0.7/import/s0-mini-defaults"));
    const response = await fetch(`${server.url}/Server/InnovatorServer.aspx`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:1234", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "locale,soapaction" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:1234");
    expect(response.headers.get("access-control-allow-headers")).toBe("locale,soapaction");
  });

  it("refuses a case that is not recorded", () => {
    expect(() => loadReplayCase("14.0.7/export/nope")).toThrow(/no recorded case/);
    expect(() => loadReplayCase("13/export/x")).toThrow(/engine/);
    expect(() => loadReplayCase("14.0.7/sing/x")).toThrow(/operation/);
  });
});

describe("the static server", () => {
  it("serves a folder with the security headers, and nothing outside it", async () => {
    const parent = mkdtempSync(path.join(os.tmpdir(), "aras-pkg-static-"));
    const folder = path.join(parent, "site");
    mkdirSync(folder);
    writeFileSync(path.join(folder, "index.html"), "<p>hi</p>");
    writeFileSync(path.join(parent, "outside.txt"), "secret");
    const { server: http, url } = await serveFolder(folder);
    try {
      const index = await fetch(url);
      expect(index.status).toBe(200);
      expect(await index.text()).toBe("<p>hi</p>");
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(index.headers.get(name), name).toBe(value);
      expect(index.headers.get("content-type")).toContain("text/html");
      expect((await fetch(`${url}missing.js`)).status).toBe(404);
      expect((await fetch(`${url}..%2Foutside.txt`)).status).toBe(404);
      expect((await fetch(url, { method: "POST" })).status).toBe(404);
    } finally {
      http.closeAllConnections();
      http.close();
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
