import { resultItems, childText } from "../client/answer.js";
import { CItemException } from "../client/fault.js";
import type { ResponseDocument } from "../client/fault.js";
import { attributeOf, type XmlElement } from "../client/mini-xml.js";
import { ExportItem } from "../export/export-item.js";
import type { SelectionInsertions } from "../export/import-export-manager.js";
import { UsageError } from "./usage.js";

/**
 * The host half of `export`: the items the user names, the lookups that find the package of each, and the insertions the engine's
 * table is built from (spec/cli-export.md, `HOST-` rules). None of this is engine behaviour, so unlike the engine's own requests
 * every value put into AML here is escaped.
 */

/** An item as the user wrote it. */
export interface RequestedItem {
  type: string;
  id: string;
}

/** What the lookups need of the logged-in helper: `applyAML` (WIRE-006). */
export interface LookupHost {
  applyAML(aml: string): Promise<ResponseDocument>;
}

/** The most values one request of a pass carries (HOST-010). */
export const BATCH_SIZE = 200;

/** An id the `idlist` of an AML request can carry unchanged (HOST-002). */
const ID_ALPHABET = /^[A-Za-z0-9_-]+$/;
const TYPE_FORBIDDEN = /[\u0000-\u001f\u007f<>&"']/;

/**
 * `Type:id`, split at the first colon. The type may not be empty, start or end with white space or hold a control character or one
 * of `<>&"'`; the id is letters, digits, `_` and `-`.
 *
 * @spec HOST-002
 */
export function parseItem(text: string): RequestedItem {
  const colon = text.indexOf(":");
  if (colon < 0) throw new UsageError(`'${text}' is not Type:id`);
  const type = text.slice(0, colon);
  const id = text.slice(colon + 1);
  if (type === "") throw new UsageError(`'${text}' has no ItemType before the colon`);
  if (type !== type.trim() || TYPE_FORBIDDEN.test(type)) {
    throw new UsageError(`'${text}' names an ItemType with white space around it or a character that cannot be in a name`);
  }
  if (id === "") throw new UsageError(`'${text}' has no id after the colon`);
  if (!ID_ALPHABET.test(id)) throw new UsageError(`'${text}' has an id with a character other than letters, digits, '_' and '-'`);
  return { type, id };
}

/** The ids of the items name one ItemType each, because the engine's inner table is keyed by id (HOST-002, HOST-020). */
function checkIds(items: readonly RequestedItem[]): RequestedItem[] {
  const owner = new Map<string, RequestedItem>();
  for (const item of items) {
    const known = owner.get(item.id.toUpperCase());
    if (known !== undefined && known.type !== item.type) {
      throw new UsageError(`the id '${item.id}' is given for two ItemTypes, '${known.type}' and '${item.type}'`);
    }
    owner.set(item.id.toUpperCase(), item);
  }
  return [...items];
}

/**
 * The items given as arguments.
 *
 * @spec HOST-002
 */
export function parseItems(texts: readonly string[]): RequestedItem[] {
  return checkIds(texts.map(parseItem));
}

/**
 * The items on standard input, one per line. A line loses a trailing `\r` and its surrounding white space, and an empty line is
 * skipped; a line that is not an item is a usage error that names its number.
 *
 * @spec HOST-003
 */
export function parseItemLines(stdin: string): RequestedItem[] {
  const items: RequestedItem[] = [];
  for (const [index, raw] of stdin.split("\n").entries()) {
    const line = raw.replace(/\r$/, "").trim();
    if (line === "") continue;
    try {
      items.push(parseItem(line));
    } catch (error) {
      if (error instanceof UsageError) throw new UsageError(`standard input, line ${index + 1}: ${error.message}`);
      throw error;
    }
  }
  return checkIds(items);
}

/** The selection was refused: the engine is not started and nothing is exported (HOST-014, HOST-015, HOST-016). */
export class SelectionRefused extends Error {
  override name = "SelectionRefused";

  constructor(
    /** One `[ERROR]` line each. */
    readonly lines: readonly string[],
    readonly noPackage: readonly string[] = [],
    readonly notFound: readonly string[] = [],
    /** The `[WARN]` lines that came before the refusal. */
    readonly warnings: readonly string[] = [],
  ) {
    super(lines.join("\n"));
  }
}

/** What the table will hold, per package and in the order of insertion, for the summary. */
export interface SelectionOutcome {
  insertions: SelectionInsertions;
  packages: Array<{ name: string; items: number }>;
  warnings: string[];
}

function describePackages(insertions: SelectionInsertions): Array<{ name: string; items: number }> {
  return insertions.map(([name, entries]) => ({ name, items: new Set(entries.map(([key]) => key)).size }));
}

const escapeText = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (value: string): string => escapeText(value).replace(/"/g, "&quot;");
const sqlList = (values: readonly string[]): string => values.map((value) => `'${value.replace(/'/g, "''")}'`).join(",");

function batches<T>(values: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < values.length; at += BATCH_SIZE) out.push(values.slice(at, at + BATCH_SIZE));
  return out;
}

/** The values without repeats (ignoring case), in order of first appearance. */
function distinct(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value.toUpperCase())) continue;
    seen.add(value.toUpperCase());
    out.push(value);
  }
  return out;
}

/** The ordinal order of UTF-16 code units, case-sensitive. */
const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The rows of a read; a fault with faultcode 0 (nothing found) is no rows, any other fault ends the command (HOST-010). */
async function read(host: LookupHost, aml: string): Promise<XmlElement[]> {
  try {
    return resultItems(await host.applyAML(aml));
  } catch (error) {
    if (error instanceof CItemException && error.faultcode === 0) return [];
    throw error;
  }
}

const idOf = (row: XmlElement): string | undefined => attributeOf(row, "id");

interface FoundItem {
  configId: string;
  keyedName: string;
}

/**
 * The package of each item, by the four passes of HOST-010, and the insertions of HOST-020. A found item with no package, and an
 * item that was not found, refuse the whole selection (HOST-014).
 *
 * @spec HOST-010 HOST-011 HOST-012 HOST-013 HOST-014 HOST-020 HOST-022
 */
export async function resolveItems(host: LookupHost, items: readonly RequestedItem[]): Promise<SelectionOutcome> {
  // 1. config ids and keyed names, per type in the order the types first appear
  const idsByType = new Map<string, string[]>();
  for (const { type, id } of items) idsByType.set(type, [...(idsByType.get(type) ?? []), id]);
  const found = new Map<string, FoundItem>();
  const foundKey = (type: string, id: string): string => `${type}\u0000${id.toUpperCase()}`;
  for (const [type, ids] of idsByType) {
    for (const batch of batches(distinct(ids))) {
      const aml = `<Item type="${escapeAttribute(type)}" action="get" select="config_id,keyed_name" idlist="${escapeAttribute(batch.join(","))}"/>`;
      for (const row of await read(host, aml)) {
        const id = idOf(row);
        const requested = id === undefined ? undefined : batch.find((candidate) => candidate.toUpperCase() === id.toUpperCase());
        if (requested === undefined) continue;
        const keyedName = childText(row, "keyed_name");
        found.set(foundKey(type, requested), {
          configId: childText(row, "config_id") ?? id ?? requested,
          keyedName: keyedName === undefined || keyedName.trim() === "" ? requested : keyedName,
        });
      }
    }
  }

  // 2. PackageElement -> PackageGroup
  const configIds = distinct(items.flatMap(({ type, id }) => found.get(foundKey(type, id))?.configId ?? []));
  const groupByElement = new Map<string, string>();
  for (const batch of batches(configIds)) {
    const aml = `<Item type="PackageElement" action="get" select="element_id,source_id"><element_id condition="in">${escapeText(sqlList(batch))}</element_id></Item>`;
    for (const row of await read(host, aml)) {
      const elementId = childText(row, "element_id");
      if (elementId === undefined || groupByElement.has(elementId.toUpperCase())) continue;
      groupByElement.set(elementId.toUpperCase(), childText(row, "source_id") ?? "");
    }
  }

  // 3. PackageGroup -> PackageDefinition
  const groupIds = distinct(configIds.flatMap((configId) => groupByElement.get(configId.toUpperCase()) || []));
  const definitionByGroup = new Map<string, string>();
  for (const batch of batches(groupIds)) {
    const aml = `<Item type="PackageGroup" action="get" select="source_id" idlist="${escapeAttribute(batch.join(","))}"/>`;
    for (const row of await read(host, aml)) {
      const id = idOf(row);
      if (id !== undefined) definitionByGroup.set(id.toUpperCase(), childText(row, "source_id") ?? "");
    }
  }

  // 4. PackageDefinition -> name
  const definitionIds = distinct(groupIds.flatMap((groupId) => definitionByGroup.get(groupId.toUpperCase()) || []));
  const nameByDefinition = new Map<string, string>();
  for (const batch of batches(definitionIds)) {
    const aml = `<Item type="PackageDefinition" action="get" select="name" idlist="${escapeAttribute(batch.join(","))}"/>`;
    for (const row of await read(host, aml)) {
      const id = idOf(row);
      if (id !== undefined) nameByDefinition.set(id.toUpperCase(), childText(row, "name") ?? "");
    }
  }

  const packageOf = (configId: string): string | undefined => {
    const group = groupByElement.get(configId.toUpperCase());
    const definition = group ? definitionByGroup.get(group.toUpperCase()) : undefined;
    return (definition ? nameByDefinition.get(definition.toUpperCase()) : undefined) || undefined;
  };

  const noPackage: string[] = [];
  const notFound: string[] = [];
  const entries = new Map<string, Array<readonly [string, ExportItem]>>();
  const listed = new Set<string>();
  for (const { type, id } of items) {
    const key = foundKey(type, id);
    const item = found.get(key);
    const first = !listed.has(key);
    listed.add(key);
    if (item === undefined) {
      if (first) notFound.push(`${type} ${id}`);
      continue;
    }
    const packageName = packageOf(item.configId);
    if (packageName === undefined) {
      if (first) noPackage.push(`${type} "${item.keyedName}" (${id})`);
      continue;
    }
    const list = entries.get(packageName) ?? [];
    list.push([id, new ExportItem(item.keyedName, id, type)]);
    entries.set(packageName, list);
  }
  refuseUnexportable(noPackage, notFound);
  const insertions: SelectionInsertions = [...entries];
  return { insertions, packages: describePackages(insertions), warnings: [] };
}

/** @spec HOST-014 */
function refuseUnexportable(noPackage: readonly string[], notFound: readonly string[]): void {
  const lines: string[] = [];
  if (noPackage.length > 0) {
    lines.push(`Export refused: ${noPackage.length} item(s) belong to no package: ${noPackage.join(", ")}. Add them to a PackageDefinition first.`);
  }
  if (notFound.length > 0) lines.push(`Export refused: ${notFound.length} item(s) were not found: ${notFound.join(", ")}`);
  if (lines.length > 0) throw new SelectionRefused(lines, noPackage, notFound);
}

/** The edit distance between two texts, ignoring case. */
function distance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let previous = Array.from({ length: y.length + 1 }, (_, index) => index);
  for (let i = 1; i <= x.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= y.length; j += 1) {
      row[j] = Math.min((row[j - 1] as number) + 1, (previous[j] as number) + 1, (previous[j - 1] as number) + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[y.length] as number;
}

/**
 * The known names near a mistyped one: within an edit distance of the larger of 2 and a tenth of its length (rounded up), or containing it or
 * contained by it (ignoring case); closest first, ties by ordinal name, at most three.
 *
 * @spec HOST-015
 */
export function suggestions(name: string, known: readonly string[]): string[] {
  const limit = Math.max(2, Math.ceil(name.length / 10));
  const lower = name.toLowerCase();
  return known
    .map((candidate) => ({ candidate, distance: distance(name, candidate) }))
    .filter(({ candidate, distance: far }) => {
      const other = candidate.toLowerCase();
      return far <= limit || other.includes(lower) || lower.includes(other);
    })
    .sort((a, b) => a.distance - b.distance || ordinal(a.candidate, b.candidate))
    .slice(0, 3)
    .map(({ candidate }) => candidate);
}

function didYouMean(names: readonly string[]): string {
  const quoted = names.map((name) => `'${name}'`);
  if (quoted.length === 0) return "";
  if (quoted.length === 1) return ` Did you mean ${quoted[0]}?`;
  return ` Did you mean ${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}?`;
}

/**
 * The elements of the named packages, as the items to export (HOST-015, HOST-016), and the insertions of HOST-021. A name the
 * database does not know refuses the selection with suggestions; a package with no element is warned about and left out.
 *
 * @spec HOST-015 HOST-016 HOST-021 HOST-022
 */
export async function resolvePackages(host: LookupHost, names: readonly string[]): Promise<SelectionOutcome> {
  const rows = await read(host, `<Item type="PackageDefinition" action="get" select="name"/>`);
  const definitions = new Map<string, string>();
  for (const row of rows) {
    const name = childText(row, "name");
    const id = idOf(row);
    if (name !== undefined && id !== undefined && !definitions.has(name)) definitions.set(name, id);
  }
  const known = [...definitions.keys()];
  const unknown = names.filter((name) => !definitions.has(name));
  if (unknown.length > 0) {
    throw new SelectionRefused(
      unknown.map((name) => `Export refused: there is no package '${name}'.${didYouMean(suggestions(name, known))}`),
    );
  }

  const insertions: Array<[string, Array<readonly [string, ExportItem]>]> = [];
  const warnings: string[] = [];
  for (const name of names) {
    const aml =
      `<Item type="PackageElement" action="get" select="name,element_id,element_type"><source_id>` +
      `<Item type="PackageGroup" action="get"><source_id>${escapeText(definitions.get(name) as string)}</source_id></Item></source_id></Item>`;
    const elements = (await read(host, aml)).flatMap((row) => {
      const id = childText(row, "element_id");
      const type = childText(row, "element_type");
      return id === undefined || id === "" || type === undefined || type === "" ? [] : [{ id, type, keyedName: childText(row, "name") ?? "" }];
    });
    if (elements.length === 0) {
      warnings.push(`package '${name}' has no elements`);
      continue;
    }
    elements.sort((a, b) => ordinal(a.type, b.type) || ordinal(a.id, b.id));
    insertions.push([name, elements.map(({ id, type, keyedName }) => [id, new ExportItem(keyedName, id, type)] as const)]);
  }
  if (insertions.length === 0) throw new SelectionRefused(["Export refused: the named packages have no elements."], [], [], warnings);
  return { insertions, packages: describePackages(insertions), warnings };
}
