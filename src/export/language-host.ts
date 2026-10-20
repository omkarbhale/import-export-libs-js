import { LANGUAGE_RESOURCES_ONLY, LANGUAGE_RESOURCES_WITH_METADATA, isLanguageMode } from "./export-context.js";

/**
 * The language list as `ConsoleUpgrade.exe` 14.35 builds it from `langs=<list>` (LP-101): the text split on `,`, empty entries dropped,
 * then `Distinct()` with an ordinal comparison, keeping the first of each and the order. Nothing is trimmed, so `en, de` has the entry
 * ` de`, and `de,DE` keeps both. The quotes of a value are the argument parser's to remove. With no `langs` the list is empty.
 *
 * @spec LP-101
 */
export function hostLanguageList(value: string | null): string[] {
  if (value === null) return [];
  return [...new Set(value.split(",").filter((entry) => entry !== ""))];
}

/**
 * The checks the host makes on the list before it starts a run (LP-101): the text it prints and ends the run with code 1 for, or null
 * when the list is accepted.
 *
 * - For either language mode an empty list ends the run (`\nParam error : 'langs' list can't be empty`).
 * - For any action a non-empty list whose first entry is not `*` must contain `en`, compared ignoring case (`OrdinalIgnoreCase`);
 *   otherwise `'en' language is required for 'langs' list`. A list that starts with `*` is never checked, so `*,de` passes.
 *
 * The engine does not look at these checks (LP-110): a library caller can hand it every list the host refuses.
 *
 * @spec LP-101
 */
export function hostLanguageProblem(action: string, languages: readonly string[]): string | null {
  if (isLanguageMode(action) && languages.length === 0) return "\nParam error : 'langs' list can't be empty";
  const [first] = languages;
  if (first !== undefined && first !== "*" && !languages.some((language) => language.toUpperCase() === "EN")) {
    return "'en' language is required for 'langs' list";
  }
  return null;
}

/**
 * The engine action a value of the CLI's `--language-resources` flag stands for: `only` is `ExportLanguageResourcesOnly` (the reference
 * host's `export-only-translations`) and `with-metadata` is `ExportMetadataWithLanguageResources` (`export-with-translations`). Any
 * other value gives undefined. The `export` command's `--language-resources` flag uses this table (HOST-031, LP-101).
 *
 * @spec LP-101
 */
export function languageResourcesAction(value: string): string | undefined {
  return value === "only" ? LANGUAGE_RESOURCES_ONLY : value === "with-metadata" ? LANGUAGE_RESOURCES_WITH_METADATA : undefined;
}
