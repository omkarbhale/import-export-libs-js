/**
 * The generator of the synthetic packages of the size measurements (HOST-277): `npm run synth-package -- --mb 10 --mb 50` writes each as a zip
 * into `.synth/` (git-ignored, never committed) with a `.json` beside it that names its item count and bytes. The items are made by
 * `src/browser/synth-package.ts` from real fixture item files; this file reads the templates and writes the zip, one item at a
 * time, so that a large package is never in memory whole.
 *
 * Node-only tooling: nothing under `src/` imports it.
 *
 * @spec HOST-277
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Zip, ZipDeflate } from "fflate";
import {
  SYNTH_TEMPLATES,
  SYNTH_VERSION,
  type SynthKind,
  type SynthTemplates,
  synthItems,
  synthManifestBytes,
} from "../src/browser/synth-package.js";
import { repoRoot } from "./browser-bundle.js";

/** The sizes written when none is asked for, in megabytes: the default of a run and the limit (HOST-278). */
export const SYNTH_SIZES_MB: readonly number[] = [10, 50];

/** The seed a package is made with unless another is asked for. */
export const DEFAULT_SEED = 1;

/** Where the packages are written, below the repository root and ignored by git. */
export const SYNTH_DIR = ".synth";

/** What the sidecar of a written package says. */
export interface SynthPackageInfo {
  mb: number;
  seed: number;
  generator: number;
  /** The number of items, which is also the number of item files. */
  count: number;
  /** The bytes of the item files, which is at least `mb` megabytes. */
  bytes: number;
  /** The bytes of the zip. */
  zipBytes: number;
  zip: string;
}

/** The name of the zip of a package: everything that decides its bytes is in it. */
export const synthZipName = (mb: number, seed: number): string => `synth-${mb}mb-s${seed}-v${SYNTH_VERSION}.zip`;

/** The text of the template files, read from the repository's fixtures. */
export function readSynthTemplates(root: string = repoRoot): SynthTemplates {
  const entries = (Object.entries(SYNTH_TEMPLATES) as Array<[SynthKind, string]>).map(([kind, file]) => [kind, readFileSync(path.join(root, file), "utf8")] as const);
  return Object.fromEntries(entries) as SynthTemplates;
}

/**
 * Writes the package of `mb` megabytes of item files as a zip in `dir`, and its sidecar; a package that is there is not made again.
 * The zip is the same bytes on every run (fixed modification time, fixed order).
 */
export function writeSynthPackage(mb: number, seed: number = DEFAULT_SEED, dir: string = path.join(repoRoot, SYNTH_DIR), root: string = repoRoot): SynthPackageInfo {
  if (!Number.isFinite(mb) || mb <= 0) throw new Error(`a package size is a positive number of megabytes, not ${String(mb)}`);
  mkdirSync(dir, { recursive: true });
  const zipPath = path.join(dir, synthZipName(mb, seed));
  const infoPath = zipPath.replace(/\.zip$/, ".json");
  if (existsSync(zipPath) && existsSync(infoPath)) return JSON.parse(readFileSync(infoPath, "utf8")) as SynthPackageInfo;

  const templates = readSynthTemplates(root);
  const partial = `${zipPath}.partial`;
  const fd = openSync(partial, "w");
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error !== null) failure = error;
    else writeSync(fd, chunk);
  });
  const mtime = new Date(Date.UTC(2020, 0, 1));
  const add = (name: string, bytes: Uint8Array): void => {
    const file = new ZipDeflate(name, { level: 6 });
    file.mtime = mtime;
    zip.add(file);
    file.push(bytes, true);
  };
  let count = 0;
  let bytes = 0;
  try {
    add("imports.mf", synthManifestBytes());
    for (const item of synthItems({ seed }, templates, mb * 1_000_000)) {
      add(item.path, item.bytes);
      count += 1;
      bytes += item.bytes.byteLength;
    }
    zip.end();
  } finally {
    closeSync(fd);
  }
  if (failure !== null) throw failure;
  renameSync(partial, zipPath);
  const info: SynthPackageInfo = { mb, seed, generator: SYNTH_VERSION, count, bytes, zipBytes: statSync(zipPath).size, zip: path.basename(zipPath) };
  writeFileSync(infoPath, `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

/** `npm run synth-package -- [--mb N]...`: with no `--mb`, every size of the list above. */
function main(argv: readonly string[]): void {
  const sizes: number[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--mb" && value !== undefined) sizes.push(Number(value));
    else throw new Error(`unknown argument '${String(flag)}': use --mb N (repeatable)`);
    i += 1;
  }
  for (const mb of sizes.length === 0 ? SYNTH_SIZES_MB : sizes) {
    const started = Date.now();
    const info = writeSynthPackage(mb);
    console.log(`${info.zip}: ${info.count} items, ${(info.bytes / 1e6).toFixed(1)} MB of item files, ${(info.zipBytes / 1e6).toFixed(1)} MB zipped, ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
