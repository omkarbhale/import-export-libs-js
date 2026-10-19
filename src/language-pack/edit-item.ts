import { ArgumentException } from "../io/errors.js";
import { appendChild, attributesOf, createElement, createXmlDocument, selectNodes } from "../xml/index.js";
import type { XmlDocument, XmlElement } from "../xml/index.js";
import { displayCharacter, hexValue, isNameChar } from "../xml/chars.js";
import { XmlException } from "../xml/errors.js";
import { getAttribute } from "./config.js";

/** The namespace IOM puts a translated value in. */
export const I18N_NAMESPACE = "http://www.aras.com/I18N";

/** One property's translations: the language codes of the server in its order, each with the attribute's text. */
export type Translations = Map<string, string>;

/**
 * `GetUpdateParameters(itemNode, requestedProps, supportedLanguages)`: the item's translated properties, keyed by `__name`
 * (the empty string when the property has none), in document order. Only direct `property` children are read. With a
 * non-empty property list a property is skipped unless the list holds its name exactly. Its translations are the supported
 * languages, in their order, for which the property has an attribute of exactly that name, leaving out `en` in any case; a
 * property with none is left out, and a second one of the same name that has some throws.
 * @spec LP-015 LP-023
 */
export function getUpdateParameters(
  itemNode: XmlElement,
  requestedProps: readonly string[],
  supportedLanguages: ReadonlyMap<string, string>,
): Map<string, Translations> {
  const parameters = new Map<string, Translations>();
  for (const node of selectNodes("property", itemNode)) {
    const property = node as XmlElement;
    const name = getAttribute(property, "__name");
    if (requestedProps.length > 0 && !requestedProps.includes(name)) continue;
    const translations: Translations = new Map();
    for (const code of supportedLanguages.keys()) {
      const attribute = property.getAttributeNode(code);
      if (attribute !== null && code.toLowerCase() !== "en") translations.set(code, attribute.value);
    }
    if (translations.size === 0) continue;
    if (parameters.has(name)) throw new ArgumentException("An item with the same key has already been added.");
    parameters.set(name, translations);
  }
  return parameters;
}

/**
 * `GetWhereParameters(itemNode)`: every attribute of the item in document order, namespace declarations included, except
 * `keyed_name` and `type` (exact names), as qualified name and text.
 * @spec LP-015 LP-025
 */
export function getWhereParameters(itemNode: XmlElement): Map<string, string> {
  const parameters = new Map<string, string>();
  for (const attribute of attributesOf(itemNode)) {
    if (attribute.name === "keyed_name" || attribute.name === "type") continue;
    if (parameters.has(attribute.name)) throw new ArgumentException("An item with the same key has already been added.");
    parameters.set(attribute.name, attribute.value);
  }
  return parameters;
}

/**
 * The `where` clause: one `[{table}].{name}='{value}'` per parameter, joined with ` AND `, where the table is the item type with
 * every space replaced by `_`. Names and values go in as they are, without escaping (`AGENTS.md` rule 7).
 * @spec LP-025
 */
export function whereClause(itemType: string, whereParameters: ReadonlyMap<string, string>): string {
  const table = itemType.replace(/ /g, "_");
  return [...whereParameters].map(([name, value]) => `[${table}].${name}='${value}'`).join(" AND ");
}

/**
 * The element IOM's `setProperty(name, value, lang)` makes: `i18n:{name}` in the I18N namespace with `xml:lang`, holding the
 * value as text. The DOM refuses an empty name, and a name with a character that cannot be in a name (a space, `:`, `<`, `/`);
 * a digit, `.` and `-` are accepted anywhere. The character classes are the XML core's, which treat a character outside the
 * Basic Multilingual Plane as no name character (no real property has one).
 */
function i18nElement(doc: XmlDocument, name: string, value: string, code: string): XmlElement {
  if (name === "") throw new ArgumentException("The local name for elements or attributes cannot be null or an empty string.");
  for (const character of name) {
    if (!isNameChar(character)) {
      const codePoint = character.codePointAt(0) as number;
      throw new XmlException(`The '${displayCharacter(character)}' character, hexadecimal value ${hexValue(codePoint)}, cannot be included in a name.`);
    }
  }
  // xmldom refuses a name that starts with a digit, which .NET's DOM takes, so the name is set on an element made with a valid one
  const element = createElement(doc, "i18n:property", I18N_NAMESPACE);
  const properties = element as { nodeName: string; tagName: string; localName: string };
  properties.nodeName = `i18n:${name}`;
  properties.tagName = `i18n:${name}`;
  properties.localName = name;
  element.setAttribute("xml:lang", code);
  appendChild(element, doc.createTextNode(value));
  return element;
}

/**
 * What 14.35 puts on the `edit` item of a `Property` row before its translations (LP-041): the attribute `context_action="lpimport"`,
 * which the import looks for, and the system values the server has for the property, each as a plain element, in this order.
 */
export interface SystemValues {
  readonly values: ReadonlyArray<readonly [name: string, value: string]>;
}

/**
 * The `edit` item of one row, as IOM's `newItem(type, "edit")` with `doGetItem` `0` and the translated values set, before its
 * `where` is known: `<Item isNew="1" isTemp="1" type="{type}" action="edit" doGetItem="0">` and, for each property of the table
 * in its order and each language in the property's order, a value that is not the empty string as an `i18n` element. An empty
 * type gives an item without `type` and `action`. Returns null when no value was set, which drops the item. The system values of
 * 14.35's `Property` rows come first and do not count as a value (LP-041).
 * @spec LP-024 LP-041
 */
export function createEditItem(itemType: string, parameters: ReadonlyMap<string, Translations>, system?: SystemValues): XmlElement | null {
  const doc = createXmlDocument();
  const item = createElement(doc, "Item");
  item.setAttribute("isNew", "1");
  item.setAttribute("isTemp", "1");
  if (itemType !== "") {
    item.setAttribute("type", itemType);
    item.setAttribute("action", "edit");
  }
  item.setAttribute("doGetItem", "0");
  if (system !== undefined) {
    item.setAttribute("context_action", "lpimport");
    for (const [name, value] of system.values) {
      const element = createElement(doc, name);
      appendChild(element, doc.createTextNode(value));
      appendChild(item, element);
    }
  }
  let any = false;
  for (const [name, translations] of parameters) {
    for (const [code, value] of translations) {
      if (value === "") continue;
      appendChild(item, i18nElement(doc, name, value, code));
      any = true;
    }
  }
  return any ? item : null;
}
