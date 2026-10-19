import type { Engine } from "../../../src/engines.js";
import { EXPORT_CASES, type ExportCase } from "../export-cases.js";
import { SEED_GROUPS, type SeedGroup } from "../export-scratch-cases.js";
import { casesFor, type ImportCase, type ImportStep } from "../import-cases.js";
import { mini } from "../import-packages.js";
import { LP_CASES, type LpCase } from "../language-pack-cases.js";
import type { ConsoleModeCase } from "./runners.js";

/** The engines the script compares. The 12.0 and 14.35 slices add themselves (wayfinder tickets 50 and 76). */
export const PARITY_ENGINES: readonly Engine[] = ["14.0.7"];

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

/** The language-pack cases the 14.0.7 engine has (ticket 45): the others are 14.35's. */
export const languagePackCases = (engine: Engine): readonly LpCase[] => (engine === "14.0.7" ? LP_CASES.filter((c) => /^lp0[1-5]$/.test(c.id)) : []);

/** The catalogue of an engine, in the order the script runs it. */
export function catalogue(engine: Engine): CatalogueEntry[] {
  const exportCases: readonly ExportCase[] = engine === "14.0.7" ? EXPORT_CASES : [];
  const groups: readonly SeedGroup[] = engine === "14.0.7" ? SEED_GROUPS : [];
  const imports: readonly ImportCase[] = engine === "14.0.7" ? casesFor("14.0.7") : [];
  return [
    ...exportCases.map((c): CatalogueEntry => ({ id: c.id, kind: "export", title: c.title })),
    ...groups.flatMap((g) => g.cases.map((c): CatalogueEntry => ({ id: c.id, kind: "scratch-export", title: c.title }))),
    ...imports.map((c): CatalogueEntry => ({ id: c.id, kind: "import", title: c.title })),
    ...languagePackCases(engine).map((c): CatalogueEntry => ({ id: c.id, kind: "language-pack", title: c.title })),
    ...(engine === "14.0.7" ? CONSOLE_MODE_CASES : []).map((c): CatalogueEntry => ({ id: c.id, kind: "console-mode", title: c.title, ...(c.slow === true ? { slow: true as const } : {}) })),
  ];
}

/** Ids that name more than one catalogue entry, which `--case` could not tell apart. */
export function duplicateIds(entries: readonly CatalogueEntry[]): string[] {
  const seen = new Set<string>();
  return entries.flatMap((entry) => (seen.size === seen.add(entry.id).size ? [entry.id] : []));
}

