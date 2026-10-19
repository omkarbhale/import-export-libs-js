import type { Engine } from "../../../src/engines.js";
import { EXPORT_CASES, type ExportCase } from "../export-cases.js";
import { EXPORT_CASES_1435 } from "../export-cases-1435.js";
import { SEED_GROUPS, SEED_GROUPS_1435, type SeedGroup } from "../export-scratch-cases.js";
import { casesFor, type ImportCase, type ImportStep } from "../import-cases.js";
import { mini } from "../import-packages.js";
import { LP_CASES, type LpCase } from "../language-pack-cases.js";
import type { ConsoleModeCase } from "./runners.js";

/**
 * The engines the script compares. 14.35 is listed with its export side (wayfinder ticket 76, part A: export, parallel export,
 * language-resource export, the scratch-seeded exports and the console modes); its import side joins with part B.
 */
export const PARITY_ENGINES: readonly Engine[] = ["12.0", "14.0.7", "14.35"];

export type ParityKind = "export" | "scratch-export" | "import" | "language-pack" | "console-mode";

/** One case of the catalogue, whatever runs it. */
export interface CatalogueEntry {
  id: string;
  kind: ParityKind;
  title: string;
  /** Left out of a run without `--case`, because it takes very long. */
  slow?: true;
}

const miniSeed: ImportStep[] = [{ name: "import the small package", packages: [mini()], expect: "success" }];

/**
 * The console export modes (wayfinder ticket 66) on dev. `--from-manifest` and `--use-import` read a manifest and export only the
 * packages it names, so they run on a few stock packages and on a scratch package the run seeds. `--all-packages` exports every
 * package of dev, about ten thousand items, and runs only when named.
 */
export const CONSOLE_MODE_CASES: readonly ConsoleModeCase[] = [
  {
    id: "mode-from-manifest-stock",
    mode: "from-manifest",
    title: "--from-manifest naming two small stock packages",
    manifest: { kind: "stock", packages: ["DatabaseIdentifier", "com.aras.innovator.derivedrelationships_default"] },
  },
  {
    id: "mode-from-manifest-unknown-package",
    mode: "from-manifest",
    title: "--from-manifest naming a stock package and one the database does not have",
    manifest: { kind: "stock", packages: ["com.aras.innovator.conflictdetection", "LIBSJS-SCRATCH-ABSENT"] },
  },
  {
    id: "mode-from-manifest-scratch",
    mode: "from-manifest",
    title: "--from-manifest naming a scratch package the run imported",
    manifest: { kind: "scratch", packages: () => [mini()] },
    seed: miniSeed,
  },
  {
    id: "mode-use-import-scratch",
    mode: "use-import",
    title: "--use-import over the scratch package the run imported",
    manifest: { kind: "scratch", packages: () => [mini()] },
    seed: miniSeed,
  },
  {
    id: "mode-use-import-absent-items",
    mode: "use-import",
    title: "--use-import over a scratch package whose items are not on the server",
    manifest: { kind: "scratch", packages: () => [mini()] },
  },
  { id: "mode-all-packages", mode: "all-packages", title: "--all-packages: every package of dev", manifest: { kind: "none" }, slow: true },
];

/** The language-pack cases the 14.0.7 engine has (ticket 45): the others are 14.35's, and 12.0 has none (no `LanguagePackPreprocessor`). */
export const languagePackCases = (engine: Engine): readonly LpCase[] => (engine === "14.0.7" ? LP_CASES.filter((c) => /^lp0[1-5]$/.test(c.id)) : []);

/** The export cases of an engine that need no seed: 12.0 and 14.0.7 share ticket 05's catalogue, 14.35 has it and the cases of its own export rules (ticket 57). */
export const exportCasesOf = (engine: Engine): readonly ExportCase[] => (engine === "14.35" ? EXPORT_CASES_1435 : EXPORT_CASES);

/** The seed groups of an engine: 14.35 repeats 14.0.7's and adds the language-resource group; 12.0's are 14.0.7's. */
export const seedGroupsOf = (engine: Engine): readonly SeedGroup[] => (engine === "14.35" ? SEED_GROUPS_1435 : SEED_GROUPS);

/** The catalogue of an engine, in the order the script runs it. */
export function catalogue(engine: Engine): CatalogueEntry[] {
  const imports: readonly ImportCase[] = engine === "12.0" || engine === "14.0.7" ? casesFor(engine) : [];
  return [
    ...exportCasesOf(engine).map((c): CatalogueEntry => ({ id: c.id, kind: "export", title: c.title })),
    ...seedGroupsOf(engine).flatMap((g) => g.cases.map((c): CatalogueEntry => ({ id: c.id, kind: "scratch-export", title: c.title }))),
    ...imports.map((c): CatalogueEntry => ({ id: c.id, kind: "import", title: c.title })),
    ...languagePackCases(engine).map((c): CatalogueEntry => ({ id: c.id, kind: "language-pack", title: c.title })),
    ...CONSOLE_MODE_CASES.map((c): CatalogueEntry => ({ id: c.id, kind: "console-mode", title: c.title, ...(c.slow === true ? { slow: true as const } : {}) })),
  ];
}

/** Ids that name more than one catalogue entry, which `--case` could not tell apart. */
export function duplicateIds(entries: readonly CatalogueEntry[]): string[] {
  const seen = new Set<string>();
  return entries.flatMap((entry) => (seen.size === seen.add(entry.id).size ? [entry.id] : []));
}

