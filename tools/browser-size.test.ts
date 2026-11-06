import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { browserMemory, descendants, requestedSizes, resultsFile, serveSynthPackages, sizeCommands } from "./browser-size.js";

/**
 * The Node side of the `size` project (HOST-278): the sizes of a run, the route that serves the packages and nothing else, and
 * the memory of the browser's processes read from `/proc`.
 *
 * @spec HOST-278
 */
const root = mkdtempSync(path.join(tmpdir(), "libsjs-browser-size-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("HOST-278: the sizes of a run", () => {
  it("are 10 MB unless LIBSJS_SIZE_MB says others", () => {
    expect(requestedSizes({})).toEqual([10]);
    expect(requestedSizes({ LIBSJS_SIZE_MB: "10, 50,500" })).toEqual([10, 50, 500]);
    expect(() => requestedSizes({ LIBSJS_SIZE_MB: "10,x" })).toThrow(/megabytes/);
    expect(() => requestedSizes({ LIBSJS_SIZE_MB: "0" })).toThrow(/megabytes/);
  });

  it("have commands for the page, and a place for the rows", () => {
    expect(Object.keys(sizeCommands).sort()).toEqual(["memoryNow", "memoryResetPeak", "recordSizeRow", "synthInfo", "synthOps", "synthSizes"]);
    expect(resultsFile(root)).toBe(path.join(root, ".synth", "results.jsonl"));
  });
});

describe("HOST-278: the route of the packages", () => {
  type Middleware = (request: { url?: string }, response: FakeResponse, next: () => void) => void;
  interface FakeResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: string | null;
    setHeader(name: string, value: string): void;
    end(text?: string): void;
    on(): void;
    once(): void;
    emit(): void;
    write(): boolean;
  }
  const route = (): Middleware => {
    let registered: Middleware | undefined;
    const plugin = serveSynthPackages(root);
    (plugin.configureServer as unknown as (server: unknown) => void)({ middlewares: { use: (middleware: Middleware) => (registered = middleware) } });
    return registered as Middleware;
  };
  const fake = (): FakeResponse => ({ statusCode: 200, headers: {}, body: null, setHeader(name, value) { this.headers[name] = value; }, end(text) { this.body = text ?? ""; }, on() {}, once() {}, emit() {}, write: () => true });

  it("serves a name the generator writes and refuses to look at any other", () => {
    mkdirSync(path.join(root, ".synth"), { recursive: true });
    writeFileSync(path.join(root, ".synth", "secret.txt"), "secret");
    const use = route();
    for (const url of ["/__synth__/secret.txt", "/__synth__/../package.json", "/__synth__/synth-10mb-s1-v1.zip/../x", "/other/synth-10mb-s1-v1.zip", "/__synth__/synth-x-s1-v1.zip"]) {
      let passed = false;
      use({ url }, fake(), () => (passed = true));
      expect(passed, `${url} is not the route's`).toBe(true);
    }
  });

  it("answers 404 for a package that is not generated, and says how to make it", () => {
    const response = fake();
    let passed = false;
    route()({ url: "/__synth__/synth-10mb-s1-v1.zip?t=1" }, response, () => (passed = true));
    expect(passed).toBe(false);
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain("npm run synth-package");
  });
});

describe.skipIf(process.platform !== "linux")("HOST-278: the memory of the processes below this one", () => {
  it("finds a child and a grandchild, reads their memory, and resets the peak", async () => {
    const child = spawn("sh", ["-c", "sleep 30 & wait"], { stdio: "ignore" });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const below = descendants(process.pid);
      expect(below).toContain(child.pid);
      expect(below.length, "the child's own child is below it").toBeGreaterThanOrEqual(2);
      const memory = browserMemory("", process.pid);
      expect(memory.processes).toBeGreaterThanOrEqual(2);
      expect(memory.rssBytes).toBeGreaterThan(0);
      expect(memory.peakBytes).toBeGreaterThanOrEqual(memory.rssBytes);
      expect(descendants(process.pid)).not.toContain(process.pid);
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("counts only the processes of the browser it is asked about", async () => {
    const other = spawn("sleep", ["30"], { stdio: "ignore" });
    const named = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(browserMemory(path.basename(process.execPath), process.pid).processes).toBe(1);
      expect(browserMemory("chromium", process.pid)).toEqual({ processes: 0, rssBytes: 0, peakBytes: 0 });
    } finally {
      other.kill("SIGKILL");
      named.kill("SIGKILL");
    }
  });
});
