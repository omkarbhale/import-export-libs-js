/**
 * The three Libs.dll builds this library reproduces. Each engine is one
 * distinct observable behaviour; spec rules carry a variant per engine.
 */
export const ENGINES = ["12.0", "14.0.7", "14.35"] as const;

export type Engine = (typeof ENGINES)[number];

/** Release 23's toolset, the one Aras hosts use today. */
export const DEFAULT_ENGINE: Engine = "14.0.7";

/** Full assembly version of each engine's Libs.dll. */
export const ENGINE_ASSEMBLY_VERSIONS: Readonly<Record<Engine, string>> = {
  "12.0": "12.0.0.13341",
  "14.0.7": "14.0.7.35492",
  "14.35": "14.35.0.43890",
};

/**
 * Engines whose slice is complete: every reachable method of their build in
 * spec/source-map.json is mapped or not-ported, and the build may not carry
 * `inProgress`. An engine's final slice adds it here and clears the flag.
 */
export const COMPLETE_ENGINES: readonly Engine[] = ["12.0", "14.0.7", "14.35"];

export function isEngine(value: string): value is Engine {
  return (ENGINES as readonly string[]).includes(value);
}
