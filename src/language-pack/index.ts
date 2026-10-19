/**
 * Language-pack import (`LP-001` to `LP-099`): the preprocessor that turns a language pack into a temporary package of `edit`
 * items, and the host sequence of `lpimport` that imports it.
 */
export { getItemTypes, getRequestedLanguages } from "./config.js";
export { I18N_NAMESPACE, createEditItem, getUpdateParameters, getWhereParameters, whereClause } from "./edit-item.js";
export type { Translations } from "./edit-item.js";
export { toLowerInvariant } from "./invariant-lower.js";
export { languagePackImport } from "./lp-import.js";
export type { LanguagePackImportOptions } from "./lp-import.js";
export { LP_ENGINES, LanguagePackPreprocessor, getItemCount, itemTypeName, itemTypeNameWithoutExtension, leftBehindTempFolder } from "./preprocessor.js";
export type { LanguagePackOptions } from "./preprocessor.js";
