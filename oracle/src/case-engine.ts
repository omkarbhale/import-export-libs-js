import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The engines whose export and import fixture cases are recorded: 14.0.7 (ticket 24, 25, 67) and 12.0 (ticket 48). */
export const CASE_ENGINES = ["14.0.7", "12.0"] as const;
export type CaseEngine = (typeof CASE_ENGINES)[number];

/** The engine the case recorders use when `--engine` is not given. */
export const DEFAULT_CASE_ENGINE: CaseEngine = "14.0.7";

export const isCaseEngine = (value: string): value is CaseEngine => (CASE_ENGINES as readonly string[]).includes(value);

/** The Libs build each engine's fixtures are recorded from. */
export const ENGINE_BUILD: Record<CaseEngine, string> = { "12.0": "12.0.0.13341", "14.0.7": "14.0.7.35492" };

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Where an engine's cases are committed: `fixtures/<engine>/<kind>`. */
export const casesDir = (engine: CaseEngine, kind: "export" | "import"): string => join(ROOT, "fixtures", engine, kind);

/** Shared large responses of an engine's cases (see transcript.ts). */
export const blobsDir = (engine: CaseEngine, kind: "export" | "import"): string => join(casesDir(engine, kind), "_blobs");

/** A recorder's command line as the READMEs print it: `npm run <script> [-- --engine <engine>] [args]`; the default engine needs no flag. */
export const recorderCommand = (script: string, engine: CaseEngine, args = ""): string =>
  `npm run ${script}${engine === DEFAULT_CASE_ENGINE ? "" : ` -- --engine ${engine}`}${args === "" ? "" : `${engine === DEFAULT_CASE_ENGINE ? " --" : ""} ${args}`}`;
