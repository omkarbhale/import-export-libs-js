import { commands, server } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { type EngineWorker, createEngineWorker } from "../browser.js";
import { LOGIN } from "./api-test-support.js";
import { SYNTH_TEMPLATES, type SynthKind, type SynthTemplates, synthItemText } from "./synth-package.js";
import { synthExportServer, synthImportServer } from "./synth-server.js";
import { readFixtureText } from "./test-support.browser.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    workerBundle(): Promise<string>;
    synthSizes(): Promise<number[]>;
    synthOps(): Promise<string[]>;
    synthInfo(mb: number): Promise<{ mb: number; seed: number; count: number; bytes: number; zipBytes: number; zip: string }>;
    memoryNow(): Promise<{ processes: number; rssBytes: number; peakBytes: number }>;
    memoryResetPeak(): Promise<{ reset: boolean; processes: number; rssBytes: number; peakBytes: number }>;
    recordSizeRow(row: Record<string, unknown>): Promise<void>;
  }
}

/**
 * The size, memory and time limits of the engine in a browser (HOST-278): a synthetic package of a stated size (HOST-277), imported and
 * exported through the Worker against a server that answers success to every request. The package is a zip that the Vitest server
 * serves from `.synth/` (`npm run synth-package`); the run is the one a caller makes: the page fetches the zip and hands its bytes to the Worker, which unzips
 * them into its tree, imports them, and for an export builds the output tree and its zip. The sizes come from `LIBSJS_SIZE_MB` (default 10) and the operations from
 * `LIBSJS_SIZE_OPS` (default `import,export`); one size and one operation to an invocation give a peak that earlier runs of the same
 * page have not touched. Firefox and WebKit run the sizes up to `BROWSER_MAX_MB`.
 *
 * Asserted: the run completes (the limit is an import of 50 MB in Chromium; larger packages go through the Node CLI); in Chromium the
 * browser's peak memory above its idle level stays under a ceiling that follows the measured peak (a regression alarm, not a budget); the page's
 * thread is never held for longer than 100 ms. The time per MB is recorded, not asserted. The earlier targets of 3 times the package
 * and 500 MB are retired; `roadmap/browser-limits.md` keeps what was measured.
 *
 * @spec HOST-278
 */

/** The largest import that is known to complete in a browser, in MB (HOST-278): the size the budget names. */
const LIMIT_MB = 50;
/**
 * The ceilings of peak memory above idle, in Chromium, as a fixed part and a multiple of the package's bytes. They sit about 20 to 30 %
 * above what was measured (import 2874 MB at 50 MB, 1030 MB at 25, 730 MB at 10; export 668, 518 and 379 MB), so a change that makes the
 * engine hold more fails here.
 */
const CEILING: Record<"import" | "export", { fixedBytes: number; factor: number }> = {
  import: { fixedBytes: 400_000_000, factor: 60 },
  export: { fixedBytes: 700_000_000, factor: 10 },
};
/** The longest the page's thread may be held while the engine runs in the Worker, in ms. */
const MAX_GAP_MS = 100;
/** The largest size, in MB, each browser runs: Firefox and WebKit are measured to 50 MB at most. */
const BROWSER_MAX_MB: Record<string, number> = { chromium: Number.POSITIVE_INFINITY, firefox: LIMIT_MB, webkit: LIMIT_MB };

const MB = 1_000_000;
const browserName = server.browser;
const maxMb = BROWSER_MAX_MB[browserName] ?? LIMIT_MB;

// ------------------------------------------------------------------------------------------------------------------- the Worker

let bundleUrl: string | undefined;
const started: EngineWorker[] = [];

/** A Worker running the shipped bundle, as the replays of the Worker start it (HOST-276). */
async function startWorker(): Promise<EngineWorker> {
  bundleUrl ??= URL.createObjectURL(new Blob([await commands.workerBundle()], { type: "text/javascript" }));
  const worker = createEngineWorker({ worker: bundleUrl });
  started.push(worker);
  return worker;
}

/** Waits for the browser's memory to stop moving, so that the next run starts from what the browser keeps and not from what it is about to give back. */
async function settle(): Promise<void> {
  let previous = (await commands.memoryNow()).rssBytes;
  for (let poll = 0; poll < 30; poll += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const now = (await commands.memoryNow()).rssBytes;
    if (Math.abs(now - previous) <= 0.02 * previous) return;
    previous = now;
  }
}

afterEach(async () => {
  await Promise.all(started.splice(0).map((worker) => worker.dispose({ force: true })));
  await settle();
});

/**
 * The first second of a run is not counted against the thread: the page is then handing the Worker its first messages and Vitest's own
 * reporting shares the thread (a 242 ms task was seen 130 ms into a 10 MB export, with the engine in the Worker doing nothing yet). It is
 * recorded as `startupHoldMs`.
 */
const STARTUP_MS = 1000;

/**
 * The longest task of the page's thread that the browser reports as long (more than 50 ms), where it reports them (Chromium): the thread's
 * own busy time, which a timer's lateness on a loaded machine overstates.
 */
function longTasks(): { stop(): number | null; startup(): number } {
  const settled = performance.now() + STARTUP_MS;
  let longest = 0;
  let startup = 0;
  const take = (entry: PerformanceEntry): void => {
    if (entry.startTime < settled) startup = Math.max(startup, entry.duration);
    else longest = Math.max(longest, entry.duration);
  };
  let observer: PerformanceObserver | undefined;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) take(entry);
    });
    observer.observe({ type: "longtask" });
  } catch {
    observer = undefined;
  }
  return {
    stop() {
      if (observer === undefined) return null;
      for (const entry of observer.takeRecords()) take(entry);
      observer.disconnect();
      return longest;
    },
    startup: () => startup,
  };
}

/** The longest time between two ticks of a timer: the longest the page's thread was held, and how long after the start it ended. */
function ticker(intervalMs: number): { stop(): { longest: number; at: number } } {
  const start = performance.now();
  let last = start;
  let longest = 0;
  let at = 0;
  const id = setInterval(() => {
    const now = performance.now();
    if (now - start > STARTUP_MS && now - last > longest) {
      longest = now - last;
      at = now - start;
    }
    last = now;
  }, intervalMs);
  return {
    stop() {
      clearInterval(id);
      const end = performance.now();
      return end - last > longest ? { longest: end - last, at: end - start } : { longest, at };
    },
  };
}

/** Why `agentMemory` gave no number, for the row of the run. */
let agentNote = "not asked";

/** What the page can say about its own memory, where the browser says it: the isolated page's agent cluster, the Worker included. */
async function agentMemory(): Promise<number | null> {
  const measured = performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> };
  if (typeof measured.measureUserAgentSpecificMemory !== "function") {
    agentNote = "the browser has no measureUserAgentSpecificMemory";
    return null;
  }
  if (globalThis.crossOriginIsolated !== true) {
    agentNote = "the page is not cross-origin isolated";
    return null;
  }
  try {
    const bytes = await Promise.race([
      measured.measureUserAgentSpecificMemory().then((result) => result.bytes),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 60_000)),
    ]);
    agentNote = bytes === null ? "no answer in 60 s" : "measured";
    return bytes;
  } catch (error) {
    agentNote = `${(error as Error)?.name ?? "error"}: ${String((error as Error)?.message ?? error).slice(0, 120)}`;
    return null;
  }
}

async function templates(): Promise<SynthTemplates> {
  const entries = await Promise.all((Object.entries(SYNTH_TEMPLATES) as Array<[SynthKind, string]>).map(async ([kind, file]) => [kind, await readFixtureText(file)] as const));
  return Object.fromEntries(entries) as SynthTemplates;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);

// ---------------------------------------------------------------------------------------------------------------------- runs

interface Measured {
  wallMs: number;
  gapMs: number;
  gapAtMs: number;
  longTaskMs: number | null;
  startupHoldMs: number;
  failure?: string;
  peakAboveIdleBytes: number | null;
  peakRssBytes: number | null;
  idleRssBytes: number | null;
  processes: number;
  agentBefore: number | null;
  agentAfter: number | null;
  agentNote: string;
  isolated: boolean;
}

/**
 * Runs `prepare` and then `run` and measures them: the browser's peak memory above what it held before `prepare`, and for `run` alone the
 * wall time and the page's longest gap. `prepare` is what a caller does before it starts the engine (the Worker's start, the fetch of
 * the zip) and holds the page's thread for reasons that are not the engine's.
 */
async function measure<A, T>(prepare: () => Promise<A>, run: (prepared: A) => Promise<T>): Promise<{ value: T | undefined; error: unknown; measured: Measured }> {
  const agentBefore = await agentMemory();
  const idle = await commands.memoryResetPeak();
  const prepared = await prepare();
  const watch = ticker(10);
  const tasks = longTasks();
  const start = performance.now();
  let value: T | undefined;
  let error: unknown;
  try {
    value = await run(prepared);
  } catch (caught) {
    error = caught;
  }
  const wallMs = performance.now() - start;
  const gap = watch.stop();
  const longTaskMs = tasks.stop();
  const startupHoldMs = tasks.startup();
  const after = await commands.memoryNow();
  const agentAfter = await agentMemory();
  const known = idle.processes > 0 && after.peakBytes > 0;
  const isolated = globalThis.crossOriginIsolated === true;
  return {
    value,
    error,
    measured: {
      wallMs,
      gapMs: gap.longest,
      gapAtMs: gap.at,
      longTaskMs,
      startupHoldMs,
      ...(error === undefined ? {} : { failure: `${(error as Error)?.name ?? "error"}: ${String((error as Error)?.message ?? error).slice(0, 200)}` }),
      peakAboveIdleBytes: known ? Math.max(0, after.peakBytes - idle.rssBytes) : null,
      peakRssBytes: known ? after.peakBytes : null,
      idleRssBytes: known ? idle.rssBytes : null,
      processes: after.processes,
      agentBefore,
      agentAfter,
      agentNote,
      isolated,
    },
  };
}

async function record(row: Record<string, unknown>): Promise<void> {
  await commands.recordSizeRow({ browser: browserName, ...row });
  console.info(`SIZE-BUDGET ${JSON.stringify({ browser: browserName, ...row })}`);
}

/**
 * The assertions of a run: for the page's thread always, and for memory in Chromium, where the processes are the page's own. The thread is
 * held for as long as its longest long task where the browser reports tasks (Chromium), which is the thread's own busy time, and for the
 * longest gap of the timer in the others; the timer's gap is also recorded in Chromium, where on a loaded machine it counts the
 * scheduler's delay as well.
 */
function assertBudgets(operation: "import" | "export", measured: Measured, packageBytes: number): void {
  const held = measured.longTaskMs ?? measured.gapMs;
  expect(held, `the page's thread was held for ${held.toFixed(0)} ms (timer gap ${measured.gapMs.toFixed(0)} ms)`).toBeLessThanOrEqual(MAX_GAP_MS);
  if (browserName === "chromium" && measured.peakAboveIdleBytes !== null) {
    const ceiling = CEILING[operation].fixedBytes + CEILING[operation].factor * packageBytes;
    expect(
      measured.peakAboveIdleBytes,
      `peak memory above idle is ${(measured.peakAboveIdleBytes / MB).toFixed(0)} MB for a package of ${(packageBytes / MB).toFixed(0)} MB; the ceiling is ${(ceiling / MB).toFixed(0)} MB`,
    ).toBeLessThanOrEqual(ceiling);
  }
}

const sizes = await commands.synthSizes();
const operations = await commands.synthOps();

for (const mb of sizes) {
  describe.skipIf(mb > maxMb)(`HOST-278: a synthetic package of ${mb} MB in ${browserName}`, () => {
    it.skipIf(!operations.includes("import"))(
      "is imported through the Worker",
      async () => {
        const info = await commands.synthInfo(mb);
        const importServer = synthImportServer();
        const { value, error, measured } = await measure(
          async () => ({ zip: new Uint8Array(await (await fetch(`/__synth__/${info.zip}`)).arrayBuffer()), worker: await startWorker() }),
          async ({ zip, worker }) => {
            const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport: importServer.transport });
            return worker.importPackages(session, { source: { zip }, osUser: "size-budget" });
          },
        );
        await record({
          operation: "import",
          mb,
          items: info.count,
          packageBytes: info.bytes,
          zipBytes: info.zipBytes,
          logBytes: value?.log.length ?? null,
          requests: importServer.requests,
          msPerMb: Math.round(measured.wallMs / (info.bytes / MB)),
          ...measured,
        });
        // a run that fails is recorded above with the memory it reached, and then fails here
        if (error !== undefined) throw error;
        if (value === undefined) throw new Error("the import returned nothing");
        expect(value.summary.result, "the import completes").toBe("success");
        expect(value.summary.messages.errors).toBe(0);
        expect(importServer.adds, "every item was added").toBeGreaterThanOrEqual(info.count);
        assertBudgets("import", measured, info.bytes);
      },
      4 * 60 * 60_000,
    );

    it.skipIf(!operations.includes("export"))(
      "is exported through the Worker, as files and as a zip",
      async () => {
        const info = await commands.synthInfo(mb);
        const spec = { seed: info.seed };
        const made = await templates();
        const exportServer = synthExportServer(spec, made, info.count);
        exportServer.prepare();
        const { value, error, measured } = await measure(startWorker, async (worker) => {
          const session = await worker.connect({ ...LOGIN, engine: "14.0.7", transport: exportServer.transport });
          return worker.exportPackages(session, { packages: [exportServer.packageName], zip: true });
        });
        let outputBytes = 0;
        for (const bytes of value?.files.values() ?? []) outputBytes += bytes.byteLength;
        await record({
          operation: "export",
          mb,
          items: info.count,
          packageBytes: info.bytes,
          outputBytes,
          zipBytes: value?.zip?.byteLength ?? 0,
          logBytes: value?.log.length ?? null,
          requests: exportServer.requests,
          msPerMb: Math.round(measured.wallMs / (info.bytes / MB)),
          ...measured,
        });
        if (error !== undefined) throw error;
        if (value === undefined) throw new Error("the export returned nothing");
        expect(value.summary.result, "the export completes").toBe("success");
        expect(exportServer.itemsServed, "every item was fetched").toBe(info.count);
        // the files that come back are the files the package is made of: a sample of items, byte for byte
        const step = Math.max(1, Math.floor(info.count / 40));
        for (let index = 0; index < info.count; index += step) {
          const { info: item, text } = synthItemText(spec, made, index);
          const file = value.files.get(`LIBSJS-SCRATCH-SYNTH/Import/${item.kind}/${item.name}.xml`) ?? value.files.get(`/LIBSJS-SCRATCH-SYNTH/Import/${item.kind}/${item.name}.xml`);
          expect(file, `${item.name} is exported`).toBeDefined();
          expect(sameBytes(file as Uint8Array, new TextEncoder().encode(text)), `${item.name} is the file it was made as`).toBe(true);
        }
        expect(value.zip?.byteLength ?? 0, "the zip holds the output").toBeGreaterThan(0);
        assertBudgets("export", measured, info.bytes);
      },
      4 * 60 * 60_000,
    );
  });
}

describe("HOST-278: what the browser allows a Worker", () => {
  it("records the heap limit of a Worker, where the browser says it (Chromium's performance.memory)", async () => {
    const source = `postMessage(typeof performance.memory === "object" ? performance.memory.jsHeapSizeLimit : null)`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const limit = await new Promise<number | null>((resolve, reject) => {
      const worker = new Worker(url);
      worker.onmessage = (event: MessageEvent<number | null>) => {
        worker.terminate();
        resolve(event.data);
      };
      worker.onerror = (event) => reject(new Error(event.message));
    });
    URL.revokeObjectURL(url);
    await record({ operation: "worker-heap-limit", jsHeapSizeLimitBytes: limit, memoryOfThePage: (performance as unknown as { memory?: { jsHeapSizeLimit: number } }).memory?.jsHeapSizeLimit ?? null });
    expect(limit === null || limit > 0).toBe(true);
  });
});

describe("HOST-278: the limit's own numbers", () => {
  it("name the size of the limit and the thread's bound", () => {
    expect(LIMIT_MB).toBe(50);
    expect(MAX_GAP_MS).toBe(100);
    expect(CEILING.import.factor).toBeGreaterThan(CEILING.export.factor);
  });
});
