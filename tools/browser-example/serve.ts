/**
 * Serves the reference page (HOST-280): builds `examples/browser/dist/`, then serves it with a static server of `node:http` that has
 * no dependency. With `--replay <case>` it also starts the replay server (`replay-server.ts`) for a recorded case and prints what to
 * type into the page to run it, which is the manual test harness.
 *
 *   npm run example:browser
 *   npm run example:browser -- --port 8080 --host 127.0.0.1 --no-build
 *   npm run example:browser -- --replay 14.0.7/export/e27-permission
 *   npm run example:browser -- --replay 14.0.7/import/s0-mini-defaults
 *
 * Build and manual-test tooling: nothing under `src/` imports it.
 *
 * @spec HOST-280
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryVfs, vfsToZip } from "../../src/browser.js";
import { EXAMPLE_DIST, buildExample } from "./build.js";
import { type ReplayCase, loadReplayCase, startReplayServer } from "./replay-server.js";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".json": "application/json",
};

/**
 * What the page is served with: it loads nothing but its own files and talks to any server the person names (HOST-281).
 * `blob:` is for the downloads the page makes, and nothing else.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": "default-src 'self'; connect-src *; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
};

/** A static server of one folder. A path that leaves the folder is a 404. */
export async function serveFolder(folder: string, options: { port?: number; host?: string } = {}): Promise<{ server: Server; url: string }> {
  const root = path.resolve(folder);
  const server = createServer((request, response) => {
    let file = root;
    let body: Buffer | undefined;
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      // a path that does not decode (`/%E0`) is as missing as any other
      file = path.resolve(root, decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html");
      if ((file === root || file.startsWith(root + path.sep)) && statSync(file).isFile()) body = readFileSync(file);
    } catch {
      body = undefined;
    }
    if (body === undefined || (request.method !== "GET" && request.method !== "HEAD")) {
      response.writeHead(404, { "Content-Type": "text/plain", ...SECURITY_HEADERS }).end("not found");
      return;
    }
    response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Content-Length": body.length, ...SECURITY_HEADERS });
    response.end(request.method === "HEAD" ? undefined : body);
  });
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, host, resolve));
  return { server, url: `http://${host}:${(server.address() as AddressInfo).port}/` };
}

/** Every file under a folder, written into a tree in memory at the root, for the zip of a case's package. */
function treeOf(dir: string): MemoryVfs {
  const vfs = new MemoryVfs();
  const files: Record<string, Uint8Array> = {};
  const walk = (folder: string, prefix: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(folder, entry.name), `${prefix}/${entry.name}`);
      else if (entry.isFile()) files[`${prefix}/${entry.name}`] = new Uint8Array(readFileSync(path.join(folder, entry.name)));
    }
  };
  walk(dir, "");
  vfs.mount(files);
  return vfs;
}

/** What to type into the page to run a recorded case, and where its package is as a zip. */
function printRecipe(replay: ReplayCase, url: string): void {
  const { recipe } = replay;
  const lines = [`recorded case ${replay.id}`, `  URL        ${url}`, `  Database   12sp9 (any)`, `  User       ${recipe.userName}`, `  Password   anything`, `  Engine     ${recipe.engine} (choose it: this server answers the login as a 12 SP9 server)`];
  if (recipe.operation === "export") {
    lines.push(`  Mode       Export, "Packages, by name": ${(recipe.packages ?? []).join(", ")}`);
    if (recipe.level !== undefined) lines.push(`  Level      ${recipe.level}`);
  } else if (recipe.inputDir !== undefined) {
    const folder = path.join(os.tmpdir(), "aras-pkg-replay", replay.id.replaceAll("/", "_"));
    mkdirSync(folder, { recursive: true });
    const zip = path.join(folder, "package.zip");
    writeFileSync(zip, vfsToZip(treeOf(recipe.inputDir), "/"));
    lines.push(`  Mode       ${recipe.operation === "import" ? "Import" : recipe.operation === "language-pack" ? "Language pack" : "DB patches"}`);
    lines.push(`  Package    the zip ${zip}, or the folder ${recipe.inputDir}`);
    if (recipe.osUser) lines.push(`  OS user    ${recipe.osUser}`);
    if (recipe.lpPackage !== undefined) lines.push(`  Package name ${recipe.lpPackage}`);
    if (recipe.manifestPath !== undefined) lines.push(`  Manifest   ${recipe.manifestPath}`);
    if (recipe.options !== undefined && Object.keys(recipe.options).length > 0) lines.push(`  Options    ${JSON.stringify(recipe.options)}`);
  }
  console.log(lines.join("\n"));
}

function argOf(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
}

async function main(args: string[]): Promise<void> {
  if (!args.includes("--no-build")) await buildExample();
  const host = argOf(args, "--host") ?? "127.0.0.1";
  const id = argOf(args, "--replay");
  const replay = id === undefined ? undefined : loadReplayCase(id);
  const replayServer = replay === undefined ? undefined : await startReplayServer(replay, { port: Number(argOf(args, "--replay-port") ?? 8081), host, log: (line) => console.log(`  ${line}`) });
  if (replay !== undefined && replayServer !== undefined) printRecipe(replay, replayServer.url);
  const { url } = await serveFolder(EXAMPLE_DIST, { port: Number(argOf(args, "--port") ?? 8080), host });
  console.log(`the page: ${url}`);
  if (replayServer !== undefined) {
    process.on("SIGINT", () => {
      const report = replayServer.report();
      console.log(`\nthe recording answered ${report.consumed} requests over ${Math.max(report.runs - 1, 0)} finished run(s), ${report.total} per run; ${report.mismatches.length} did not match`);
      process.exit(0);
    });
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
