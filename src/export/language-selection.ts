import { CItemException } from "../client/fault.js";
import type { CItemHelper } from "../client/item-helper.js";
import { getLanguagesFromInnovator } from "../client/language-lookups.js";
import { ArgumentNullException } from "../io/errors.js";
import { type SolutionUpgradeContext, isLanguageMode } from "./export-context.js";

/** The missing-language text (LP-114); `Environment.NewLine` is CRLF on Windows and the port writes it on every platform. */
const NOT_INSTALLED =
  "Some of the selected languages are not installed for current Aras Innovator: {0}.\r\nPlease, install missing languages or remove them from import package before proceeding.";

/** The codes of the server's languages (`GetLanguagesFromInnovator().Select(l => l.Code)`), one request per call. */
async function installedCodes(helper: CItemHelper): Promise<string[]> {
  return (await getLanguagesFromInnovator(helper.inn)).map((language) => language.code);
}

/**
 * `languages.Except(second)`: the entries of the list that are not among the codes, each once, in the order of the list, compared
 * as ordinal strings.
 */
function except(languages: readonly string[], codes: readonly string[]): string[] {
  const installed = new Set(codes);
  return [...new Set(languages)].filter((language) => !installed.has(language));
}

/**
 * `ThrowIfNoSelectedLanguagesInDatabase(languages)` (LP-114): does nothing for a null or empty list. Otherwise it asks the server
 * for its languages and throws a `CItemException` (faultcode 0, the text as the message) naming the entries it does not have. The
 * engine's `Except` is lazy and enumerated twice, by `Any()` and by `string.Join`, so a failing check sends the Language request twice
 * and names the codes the second answer lacks (LP-187). Selected codes are compared as they are, the server's are lower-cased
 * (LP-180).
 *
 * @spec LP-114 LP-180 LP-187
 */
export async function throwIfNoSelectedLanguagesInDatabase(helper: CItemHelper, languages: readonly string[] | null): Promise<void> {
  if (languages === null || languages.length === 0) return;
  if (except(languages, await installedCodes(helper)).length === 0) return;
  const missing = except(languages, await installedCodes(helper));
  throw new CItemException(0, "", NOT_INSTALLED.replace("{0}", missing.join(",")));
}

/**
 * The language work of `ImportExportManager`'s constructor for a context (LP-110), after the checks, the manifest handling and, for an
 * import, the scan of the manifest's packages (IMP-610):
 *
 * 1. A list that is exactly `["*"]` becomes the codes of the server's languages in a language mode (LP-111), and the codes the
 *    packages use in an import (IMP-620, `usedByImport`).
 * 2. In a language mode the list becomes the entries other than `en`, compared exactly (LP-112). A null list throws
 *    `ArgumentNullException` (LP-113).
 * 3. The installed-language check runs on the list (LP-114, IMP-621), for every action.
 *
 * The list is assigned to the context the caller passed, not to a copy, so a constructor that throws leaves it as it stood when it
 * threw.
 *
 * @spec LP-110 LP-111 LP-112 LP-113 LP-181 IMP-620 IMP-621
 */
export async function resolveLanguages(
  context: SolutionUpgradeContext,
  helper: CItemHelper,
  usedByImport?: () => string[],
): Promise<void> {
  const languageMode = isLanguageMode(context.action);
  const languages = context.languages;
  if (languages !== null && languages.length === 1 && languages[0] === "*") {
    if (languageMode) context.languages = await installedCodes(helper);
    else if (context.action === "Import" && usedByImport !== undefined) context.languages = usedByImport();
  }
  if (languageMode) {
    if (context.languages === null) throw new ArgumentNullException("source");
    context.languages = context.languages.filter((language) => language !== "en");
  }
  await throwIfNoSelectedLanguagesInDatabase(helper, context.languages);
}
