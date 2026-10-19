import { toLowerInvariant } from "../language-pack/invariant-lower.js";
import { nullReference } from "./dotnet.js";
import { getProperty } from "./fault.js";
import type { Innovator } from "./innovator.js";

/** The engine's `LanguageInfo`: the code of a language of the database, lower-cased, and its name. */
export interface LanguageInfo {
  readonly code: string;
  readonly name: string | null;
}

/** The request of `GetLanguagesFromInnovator`, as IOM writes it (LP-115). */
const LANGUAGE_GET = '<Item isNew="1" isTemp="1" type="Language" action="get" select="code,name" />';

/**
 * `CItemHelper.GetLanguagesFromInnovator()`: the languages the server has, in the order it answers, with each code lower-cased
 * (`ToLowerInvariant`). An answer that is a fault of any code, or has no items, gives none. The engine's iterator is lazy and sends a
 * new request every time it is enumerated; the port sends one when this is awaited, so a caller that enumerates twice awaits twice
 * (the manager's check does, LP-114). A Language without a `code` throws the unwrapped `NullReferenceException` (LP-181), after the
 * request, as the iterator does on reaching that item.
 *
 * @spec LP-115 LP-180 LP-181
 */
export async function getLanguagesFromInnovator(inn: Innovator): Promise<LanguageInfo[]> {
  const response = await inn.applyItem(LANGUAGE_GET);
  const languages: LanguageInfo[] = [];
  if (response.isError) return languages;
  for (const item of response.items) {
    const code = getProperty(item, "code");
    if (code === null) throw nullReference();
    languages.push({ code: toLowerInvariant(code), name: getProperty(item, "name") });
  }
  return languages;
}
