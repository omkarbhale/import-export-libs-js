import { afterAll, describe, expect, it } from "vitest";
import type { Engine } from "../engines.js";
import { FIXTURE_CASES, type FixtureCase } from "./fixture-set.js";
import { type LoadedExportCase, loadExportCase, replayExportCase } from "./export-replay-support.browser.js";

/**
 * The recorded export cases of `fixture-set.ts`, replayed in the browser (HOST-265): each case is run with the browser host over a
 * `MemoryVfs`, with the recorded answers of the server, and what it leaves is compared with the recording by the same functions as
 * the replays under Node (HOST-218): the output folder byte for byte, the log, the messages and the requests. Every case is read
 * through the restricted fixture commands (HOST-263), so a page never reads the disk. The wall time of each case is recorded, and a
 * case that takes more than {@link BUDGET_MS} fails: a regression alarm, not a budget.
 *
 * @spec HOST-265 HOST-263 HOST-218 EXP-500 EXP-505 EXP-551
 */

/** A case that takes longer than this in a browser fails (HOST-265). */
const BUDGET_MS = 30_000;

const ENGINES: readonly Engine[] = ["12.0", "14.0.7", "14.35"];

const exportCasesOf = (engine: Engine): FixtureCase[] => FIXTURE_CASES.filter((fixture) => fixture.engine === engine && fixture.operation === "export");

/** The 14.35 case that the disk replay runs with items in flight, run here with four (HOST-265). */
const PARALLEL = "x-par-two-packages-run1";
const PARALLELISM = 4;

interface Timing {
  label: string;
  ms: number;
}
const timings: Timing[] = [];
const ran = new Map<Engine, number>();

/** Runs a replay, records its wall time, and fails when it took longer than the alarm. */
async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await run();
  const ms = performance.now() - started;
  timings.push({ label, ms });
  expect(ms, `${label}: the wall time of the case in ms (the alarm is ${BUDGET_MS})`).toBeLessThanOrEqual(BUDGET_MS);
  return result;
}

describe.each(ENGINES)("HOST-265: the recorded %s export cases, in the browser", (engine) => {
  const cases = exportCasesOf(engine);

  it.each(cases.map((fixture) => fixture.name))("%s", async (name) => {
    const fixture = cases.find((candidate) => candidate.name === name) as FixtureCase;
    const loaded = await loadExportCase(fixture);
    await timed(`${engine} ${name}`, () => replayExportCase(loaded));
    ran.set(engine, (ran.get(engine) ?? 0) + 1);
    if (engine === "14.35" && name === PARALLEL) {
      await timed(`${engine} ${name} (${PARALLELISM} in flight)`, () => replayExportCase(loaded, { parallelism: PARALLELISM }));
    }
  });

  it("ran every case of the set, with none left out", () => {
    expect(ran.get(engine), `${engine}: the cases of the set`).toBe(cases.length);
  });
});

describe.each(["14.0.7", "14.35"] as const)("HOST-265: a recorded difference fails the %s browser run", (engine) => {
  // 14.0.7 and 12.0 compare the folder with one function and 14.35 with another (a run with a failed item is a prefix of the engine's), so each is held to it
  const fixture: FixtureCase = { engine, operation: "export", name: "e27-permission", covers: "a package with item files" };
  let loaded: LoadedExportCase;
  const itemFile = (output: ReadonlyMap<string, Uint8Array>): string => [...output.keys()].filter((path) => path.endsWith(".xml")).sort()[0] as string;

  it("passes with the recorded output, as the case above does", async () => {
    loaded = await loadExportCase(fixture);
    await replayExportCase(loaded);
  });

  it("fails when one byte of one expected output file is flipped, and names the file", async () => {
    const path = itemFile(loaded.expectedOutput);
    const flipped = new Map(loaded.expectedOutput);
    const bytes = new Uint8Array(flipped.get(path) as Uint8Array);
    const middle = Math.floor(bytes.length / 2);
    bytes[middle] = (bytes[middle] as number) ^ 0x01;
    flipped.set(path, bytes);
    await expect(replayExportCase(loaded, { expectedOutput: flipped })).rejects.toThrow(`${path} byte for byte`);
  });

  it("fails when an expected output file is missing, and when one more is expected", async () => {
    const path = itemFile(loaded.expectedOutput);
    const missing = new Map(loaded.expectedOutput);
    missing.delete(path);
    await expect(replayExportCase(loaded, { expectedOutput: missing })).rejects.toThrow(/the folders and files|the files/);
    const extra = new Map(loaded.expectedOutput);
    extra.set("extra/file.xml", new Uint8Array([1]));
    await expect(replayExportCase(loaded, { expectedOutput: extra })).rejects.toThrow(/the folders and files|the files/);
  });
});

afterAll(() => {
  const rows = [...timings].sort((a, b) => b.ms - a.ms).map(({ label, ms }) => `${ms.toFixed(0).padStart(6)} ms  ${label}`);
  console.info(`HOST-265 export replay in ${navigator.userAgent}\n${rows.join("\n")}\ncases run per engine: ${JSON.stringify(Object.fromEntries(ran))}`);
});
