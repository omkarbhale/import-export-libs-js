/**
 * Builds the reference page (HOST-280): `examples/browser/main.ts` and what it loads, bundled by esbuild with the options of the
 * browser bundle (`tools/browser-bundle.ts`: the `Buffer` injection and the replaced default host, HOST-260), into the static
 * folder `examples/browser/dist/`, with `index.html`, `style.css` and the `README.md` the page links to beside it. Any static server serves that folder.
 *
 *   npm run example:browser:build
 *
 * Build tooling: nothing under `src/` imports it.
 *
 * @spec HOST-280
 */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORKER_ENTRY, browserBundleOptions, repoRoot } from "../browser-bundle.js";

export const EXAMPLE_DIR = path.join(repoRoot, "examples/browser");
export const EXAMPLE_DIST = path.join(EXAMPLE_DIR, "dist");

/** Writes `examples/browser/dist/`: `index.html`, `style.css`, `README.md`, `main.js` and `browser-worker.js`, with their source maps. */
export async function buildExample(outDir: string = EXAMPLE_DIST): Promise<void> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  await build({
    ...browserBundleOptions(),
    entryPoints: [path.join(EXAMPLE_DIR, "main.ts")],
    outfile: path.join(outDir, "main.js"),
    sourcemap: true,
    minify: false,
    logLevel: "warning",
  });
  // the engine's Worker, which the page starts from the file next to its own script (HOST-276)
  await build({ ...browserBundleOptions(repoRoot, WORKER_ENTRY), outfile: path.join(outDir, "browser-worker.js"), sourcemap: true, minify: false, logLevel: "warning" });
  for (const file of ["index.html", "style.css", "README.md"]) copyFileSync(path.join(EXAMPLE_DIR, file), path.join(outDir, file));
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildExample();
  console.log(`built ${path.relative(repoRoot, EXAMPLE_DIST)}/`);
}
