import { commands } from "vitest/browser";
import { afterAll, describe, expect, it } from "vitest";
import * as library from "../browser.js";
import { MemoryVfs, type EngineWorker, createEngineWorker, vfsFromZip, vfsToZip } from "../browser.js";
import { packageCaches } from "../client/package-lookups.js";
import { type ReadmeSnippet, readmeSnippets, runSnippet } from "./readme-snippets.js";
import { SYNTH_TEMPLATES, type SynthKind, type SynthTemplates, synthItems, synthManifestBytes } from "./synth-package.js";
import { readFixtureText } from "./test-support.browser.js";
import { type Scenario, actionsOf, wireScenario } from "./wire-support.browser.js";
import type { WireScenarioSpec } from "./wire-spec.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    readmeText(): Promise<string>;
    workerBundle(): Promise<string>;
  }
}

/**
 * The README's browser snippets, run as they are written (HOST-282). Each `ts` block of its `## Browser` section is taken from the
 * README itself and run in the page with the bundle's entry for its imports, against a server of the HTTP test server (HOST-234) in
 * another origin, so `connect` takes its default, the browser's `fetch` transport, as a caller's page does. The server is a synthetic
 * one (HOST-278): it says yes to an import and serves a small synthetic package to an export of any name, because the snippets name no
 * recorded case. What the test gives a snippet is its inputs (`url`, `database`, `userName`, `password`, `file`) and one stand-in:
 * `createEngineWorker` starts the Worker from the shipped bundle's text, because a test page does not serve `dist/browser-worker.js`
 * beside the module that asks for it.
 *
 * A snippet that this test does not know how to run fails it, so a new block in the README comes with its run here.
 *
 * @spec HOST-282
 */

const scenarios: Scenario[] = [];
const workers: EngineWorker[] = [];
afterAll(async () => {
  await Promise.all(workers.map((worker) => worker.dispose({ force: true })));
  await Promise.all(scenarios.map((scenario) => scenario.release()));
});

async function server(synth: NonNullable<WireScenarioSpec["synth"]>): Promise<Scenario> {
  const made = await wireScenario({ engine: "14.0.7", synth });
  scenarios.push(made);
  return made;
}

/** The inputs every snippet reads: the address of its own server and the test login (no real credential). */
const login = (made: Scenario) => ({ url: made.url, database: "12sp9", userName: "admin", password: "secret-pw" });

/** A `console` of the snippet's own, so that its progress lines are seen by the test and do not fill the report. */
function capturingConsole(): { console: { log: (...values: unknown[]) => void }; lines: unknown[][] } {
  const lines: unknown[][] = [];
  return { console: { log: (...values: unknown[]) => lines.push(values) }, lines };
}

let templates: SynthTemplates | undefined;
async function synthTemplates(): Promise<SynthTemplates> {
  if (templates !== undefined) return templates;
  const entries = await Promise.all((Object.entries(SYNTH_TEMPLATES) as Array<[SynthKind, string]>).map(async ([kind, file]) => [kind, await readFixtureText(file)] as const));
  templates = Object.fromEntries(entries) as SynthTemplates;
  return templates;
}

/** A zip of a small synthetic package (HOST-277), as the `File` a user chose. */
async function packageFile(): Promise<File> {
  const tree = new MemoryVfs();
  const files: Record<string, Uint8Array> = { "/imports.mf": synthManifestBytes() };
  for (const item of synthItems({ seed: 7 }, await synthTemplates(), 64 * 1024)) files[`/${item.path}`] = item.bytes;
  tree.mount(files);
  return new File([new Uint8Array(vfsToZip(tree, "/"))], "package.zip", { type: "application/zip" });
}

let bundleUrl: string | undefined;
/** `createEngineWorker` with the Worker of the shipped bundle, as `worker.browser.test.ts` starts it; the options are the snippet's. */
async function workerFactory(): Promise<(options?: Parameters<typeof createEngineWorker>[0]) => EngineWorker> {
  bundleUrl ??= URL.createObjectURL(new Blob([await commands.workerBundle()], { type: "text/javascript" }));
  const url = bundleUrl;
  return (options) => {
    const worker = createEngineWorker({ worker: url, ...options });
    workers.push(worker);
    return worker;
  };
}

type Kind = "export" | "import" | "worker-export";
function kindOf(snippet: ReadmeSnippet): Kind | undefined {
  if (snippet.imports.includes("createEngineWorker") && /\.exportPackages\(/.test(snippet.body)) return "worker-export";
  if (snippet.imports.includes("importPackages")) return "import";
  if (snippet.imports.includes("exportPackages")) return "export";
  return undefined;
}

/** The package the README's export snippets name, which the synthetic server is given as its own. */
const README_PACKAGE = "My Package";

const summaryOf = (made: Record<string, unknown>) => made.summary as { result: string; operation: string };

const readme = readmeSnippets(await commands.readmeText());

describe("HOST-282: the README's browser snippets run as they are written", () => {
  it("has the snippets of export, import and the Worker, each of a kind this test runs", () => {
    expect(readme.map((snippet) => [snippet.line, kindOf(snippet)])).toEqual(readme.map((snippet) => [snippet.line, expect.any(String)]));
    expect(new Set(readme.map(kindOf))).toEqual(new Set(["export", "import", "worker-export"]));
  });

  it.for(readme.map((snippet) => [`README line ${snippet.line}: ${kindOf(snippet) ?? "unknown"}`, snippet] as const))("%s", async ([, snippet]) => {
    // the dependency cache outlives a helper (EXP-619), and each snippet is a run of its own
    packageCaches.dependsOn.clear();
    const kind = kindOf(snippet);
    if (kind === "import") {
      const made = await server({ operation: "import" });
      const result = await runSnippet(snippet, library, { ...login(made), file: await packageFile() });
      expect(summaryOf(result)).toMatchObject({ operation: "import", result: "success" });
      const { seen } = await made.log();
      // the snippet reached the server over HTTP, logged in, added the package's items and logged off
      expect(actionsOf(seen)[0]).toBe("ValidateUser");
      expect(actionsOf(seen).filter((action) => action === "ApplyItem").length).toBeGreaterThan(10);
      expect(actionsOf(seen).at(-1)).toBe("Logoff");
      return;
    }
    if (kind === "export") {
      const made = await server({ operation: "export", seed: 7, count: 6, packageName: README_PACKAGE });
      const output = capturingConsole();
      const result = await runSnippet(snippet, library, { ...login(made), console: output.console });
      expect(summaryOf(result)).toMatchObject({ operation: "export", result: "success" });
      const files = vfsFromZip(result.zip as Uint8Array);
      expect(files.readdir("/").length, "the zip has the package's folder").toBeGreaterThan(0);
      expect(output.lines.length, "onProgress was called").toBeGreaterThan(0);
      expect(actionsOf((await made.log()).seen).at(-1)).toBe("Logoff");
      return;
    }
    if (kind === "worker-export") {
      const made = await server({ operation: "export", seed: 7, count: 6, packageName: README_PACKAGE });
      const result = await runSnippet(snippet, library, { ...login(made), createEngineWorker: await workerFactory() });
      expect(summaryOf(result)).toMatchObject({ operation: "export", result: "success" });
      expect((result.files as Map<string, Uint8Array>).size).toBeGreaterThan(0);
      expect((result.zip as Uint8Array).byteLength).toBeGreaterThan(0);
      return;
    }
    throw new Error(`README line ${snippet.line}: a browser snippet this test does not run; add its run here`);
  });
});
