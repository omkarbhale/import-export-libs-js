/**
 * What the `browser-size` project of `vitest.config.ts` is made of on the Node side (HOST-278): the packages of the size measurements, which a
 * page fetches from the Vitest server and does not carry in a command, the sizes the run is asked for, and the memory of the
 * browser's processes, which only the machine can tell. Test-only tooling: nothing under `src/` imports it.
 *
 * @spec HOST-278
 */
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vitest/config";
import type { BrowserCommand } from "vitest/node";
import { repoRoot } from "./browser-bundle.js";
import { DEFAULT_SEED, SYNTH_DIR, type SynthPackageInfo, synthZipName, writeSynthPackage } from "./synth-package.js";

/** The sizes of the run, in megabytes: `LIBSJS_SIZE_MB`, a comma-separated list, and 10 when it is not set. */
export function requestedSizes(env: NodeJS.ProcessEnv = process.env): number[] {
  const text = env.LIBSJS_SIZE_MB ?? "10";
  const sizes = text.split(",").map((part) => Number(part.trim()));
  if (sizes.some((size) => !Number.isFinite(size) || size <= 0)) throw new Error(`LIBSJS_SIZE_MB is a comma-separated list of megabytes, not '${text}'`);
  return sizes;
}

const synthDir = (root: string): string => path.join(root, SYNTH_DIR);

/** The route a page fetches a package from; the name is one the generator writes and nothing else. */
const ROUTE = /^\/__synth__\/(synth-[0-9.]+mb-s\d+-v\d+\.(?:zip|json))$/;

/**
 * Serves the files of `.synth/` under `/__synth__/`, to the pages of the project. Only the names the generator writes are served, so
 * the route reads nothing else of the disk; the file is streamed, so that a package of 500 MB is not read into the server.
 */
export function serveSynthPackages(root: string = repoRoot): Plugin {
  return {
    name: "libsjs-serve-synth-packages",
    configureServer(server) {
      server.middlewares.use((request: IncomingMessage, response: ServerResponse, next: () => void) => {
        const name = ROUTE.exec((request.url ?? "").split("?")[0] ?? "")?.[1];
        if (name === undefined) return next();
        const file = path.join(synthDir(root), name);
        if (!existsSync(file)) {
          response.statusCode = 404;
          response.end(`${name} is not generated: npm run synth-package -- --mb <size>`);
          return undefined;
        }
        response.setHeader("Content-Type", name.endsWith(".json") ? "application/json" : "application/zip");
        response.setHeader("Content-Length", String(statSync(file).size));
        response.setHeader("Cache-Control", "no-store");
        createReadStream(file).pipe(response);
        return undefined;
      });
    },
  };
}

/** The headers that make a page cross-origin isolated, so that `measureUserAgentSpecificMemory()` is allowed (HOST-278). */
export const ISOLATION_HEADERS = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } as const;

/** The packages of the run, written if they are not there (a global setup of the project). */
export function ensureSynthPackages(sizes: readonly number[] = requestedSizes(), root: string = repoRoot): SynthPackageInfo[] {
  return sizes.map((mb) => writeSynthPackage(mb, DEFAULT_SEED, synthDir(root), root));
}

// ----------------------------------------------------------------------------------------------------------------------- memory

/** The ids of the processes below `root` (children, their children, …), read from `/proc`; empty where there is no `/proc`. */
export function descendants(root: number): number[] {
  let pids: string[];
  try {
    pids = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  } catch {
    return [];
  }
  const parents = new Map<number, number>();
  for (const name of pids) {
    try {
      // the fields after the command name, which is in parentheses and may hold spaces: state, ppid, …
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      parents.set(Number(name), Number(rest[1]));
    } catch {
      // the process ended while the list was read
    }
  }
  const found = new Set<number>([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, parent] of parents) {
      if (!found.has(pid) && found.has(parent)) {
        found.add(pid);
        grew = true;
      }
    }
  }
  found.delete(root);
  return [...found];
}

/** The numbers of `/proc/<pid>/status` that are in kilobytes, as bytes. */
function statusBytes(pid: number): { rss: number; peak: number; name: string } | null {
  try {
    const text = readFileSync(`/proc/${pid}/status`, "utf8");
    const field = (key: string): number => Number(new RegExp(`^${key}:\\s+(\\d+) kB`, "m").exec(text)?.[1] ?? 0) * 1024;
    return { rss: field("VmRSS"), peak: field("VmHWM"), name: /^Name:\s+(\S+)/m.exec(text)?.[1] ?? "" };
  } catch {
    return null;
  }
}

/**
 * The memory of the browser the run started: the sum over the processes below this one, the Playwright driver left out (it is Node,
 * and not the browser's). `peak` is each process's high-water mark, so a reset before a run and a read after it give the run's peak.
 */
export function browserMemory(pid: number = process.pid): { processes: number; rssBytes: number; peakBytes: number } {
  let rss = 0;
  let peak = 0;
  let processes = 0;
  for (const child of descendants(pid)) {
    const status = statusBytes(child);
    if (status === null || /^(node|MainThread)$/.test(status.name)) continue;
    rss += status.rss;
    peak += status.peak;
    processes += 1;
  }
  return { processes, rssBytes: rss, peakBytes: peak };
}

/** Sets each browser process's high-water mark to what it holds now (`clear_refs` 5, Linux 4.0 and later); true when every process took it. */
export function resetPeak(pid: number = process.pid): boolean {
  let all = true;
  for (const child of descendants(pid)) {
    if (/^(node|MainThread)$/.test(statusBytes(child)?.name ?? "")) continue;
    try {
      writeFileSync(`/proc/${child}/clear_refs`, "5");
    } catch {
      all = false;
    }
  }
  return all;
}

// --------------------------------------------------------------------------------------------------------------------- commands

/** A row of the table of `roadmap/browser-limits.md`: what a run measured. Free-form, so that the page decides what it records. */
export type SizeRow = Record<string, unknown>;

/** Where the rows are kept, one JSON object per line. */
export const resultsFile = (root: string = repoRoot): string => path.join(synthDir(root), "results.jsonl");

/** The commands the `browser-size` project registers; the page calls them through `vitest/browser`. */
export const sizeCommands = {
  synthSizes: (() => requestedSizes()) as BrowserCommand<[]>,
  synthOps: (() => (process.env.LIBSJS_SIZE_OPS ?? "import,export").split(",").map((part) => part.trim())) as BrowserCommand<[]>,
  synthInfo: ((_context, mb: number) => {
    const info = path.join(synthDir(repoRoot), synthZipName(mb, DEFAULT_SEED).replace(/\.zip$/, ".json"));
    if (!existsSync(info)) throw new Error(`the package of ${mb} MB is not generated: npm run synth-package -- --mb ${mb}`);
    return JSON.parse(readFileSync(info, "utf8")) as SynthPackageInfo;
  }) as BrowserCommand<[number]>,
  memoryNow: (() => browserMemory()) as BrowserCommand<[]>,
  memoryResetPeak: (() => ({ reset: resetPeak(), ...browserMemory() })) as BrowserCommand<[]>,
  recordSizeRow: ((_context, row: SizeRow) => {
    mkdirSync(synthDir(repoRoot), { recursive: true });
    appendFileSync(resultsFile(), `${JSON.stringify(row)}\n`);
  }) as BrowserCommand<[SizeRow]>,
};

/** The commands, as the page sees them (for `declare module "vitest/browser"`). */
export type SizeCommandNames = keyof typeof sizeCommands;
