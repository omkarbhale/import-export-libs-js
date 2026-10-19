import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ResponseDocument } from "../../../src/client/fault.js";
import type { Innovator } from "../../../src/client/innovator.js";
import { attributeOf, childElements, innerText, parseXml, type XmlElement } from "../../../src/client/mini-xml.js";
import type { CleanupReport, ItemRef } from "../record.js";

/**
 * The port's side of what the oracle host does around an import (`oracle/host/OracleHost.cs`: `Scratch`, `CreatedItems`,
 * `Cleanup` and `PreRun`), so that a live import of the port touches exactly what the oracle's does: `LIBSJS-SCRATCH-*` packages
 * and items, deleted again when the run is over (AGENTS.md, "Live Aras").
 */

export const SCRATCH_PREFIX = "LIBSJS-SCRATCH-";
/** ItemType names must match `^[a-zA-Z](\w*| +\w+)*$`, so they cannot hold the dashes of the prefix. */
export const ITEM_TYPE_PREFIX = "LIBSJS_SCRATCH_";
/** An xPropertyDefinition's name starts with `xp-`; the server keeps it in lower case, so the prefix is compared without regard to case. */
export const XPROPERTY_PREFIX = "xp-LIBSJS_SCRATCH_";

/** A package name or file name: it starts with the prefix. */
export const isScratch = (name: string | null | undefined): boolean => name != null && name.startsWith(SCRATCH_PREFIX);

/** An item's name or keyed name: the prefix, the word-character form of it, or an extended property's. */
export const isScratchItemName = (name: string | null | undefined): boolean =>
  isScratch(name) || (name != null && (name.startsWith(ITEM_TYPE_PREFIX) || name.toLowerCase().startsWith(XPROPERTY_PREFIX.toLowerCase())));

/** Every `*.xml` file below a folder, deepest folders included. */
function xmlFilesBelow(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return xmlFilesBelow(full);
    return name.toLowerCase().endsWith(".xml") ? [full] : [];
  });
}

function loadOrNull(file: string): XmlElement | null {
  try {
    return parseXml(readFileSync(file, "utf8").replace(/^﻿/, "")).root;
  } catch {
    return null;
  }
}

/**
 * What a live import of the port may be given: every package named is a scratch package, and every item file below the package
 * folder is named for a scratch item and holds scratch names only. It reads the files itself, so it does not depend on the code
 * under test to find them. A language pack is checked by the `keyed_name` of every `export/Item` of its `xml` folder.
 */
export function assertScratchImport(packages: readonly string[], inputDir: string, languagePackDir?: string): void {
  if (packages.length === 0) throw new Error("refusing to import: no packages to import");
  const bad: string[] = [];
  for (const name of packages) if (!isScratch(name)) bad.push(`package '${name}'`);
  if (languagePackDir === undefined) {
    for (const file of existsSync(inputDir) ? xmlFilesBelow(inputDir) : []) {
      const root = loadOrNull(file);
      if (root === null || root.name !== "AML") continue;
      const items = childElements(root, "Item");
      if (items.length === 0) continue;
      const base = file.slice(file.lastIndexOf("/") + 1).replace(/\.xml$/i, "");
      if (!isScratch(base)) bad.push(`item file '${file}'`);
      for (const item of items) {
        for (const name of childElements(item, "name")) {
          if (!isScratchItemName(innerText(name))) bad.push(`item '${innerText(name)}' in ${file}`);
        }
      }
    }
  } else {
    const xml = join(languagePackDir, "xml");
    for (const file of existsSync(xml) ? readdirSync(xml).filter((f) => f.toLowerCase().endsWith(".xml")) : []) {
      const root = loadOrNull(join(xml, file));
      if (root === null || root.name !== "export") continue;
      for (const item of childElements(root, "Item")) {
        const keyedName = attributeOf(item, "keyed_name") ?? "";
        if (!isScratch(keyedName)) bad.push(`language pack item '${keyedName}' in ${file}`);
      }
    }
  }
  if (bad.length === 0) return;
  const shown = bad.slice(0, 10).join(", ") + (bad.length > 10 ? ` and ${bad.length - 10} more` : "");
  throw new Error(`refusing to import non-scratch ${shown}`);
}

export interface CreatedItem {
  type: string;
  id: string;
  /** The call failed in transport, so the server may or may not have committed the item. */
  unconfirmed: boolean;
}

/** The `Envelope/Body` children of a response by local name. */
function bodyChildren(response: ResponseDocument, name: string): XmlElement[] {
  const body = childElements(response.document.root).find((e) => e.name.endsWith("Body"));
  return body === undefined ? [] : childElements(body).filter((e) => e.name === name || e.name.endsWith(`:${name}`));
}

/**
 * The items one call created: each top-level request `Item` with `action="add"` (or `create`), unless the response is a fault.
 * An add with no id takes the id of the response's `Result` item of that type. A call that failed in transport (IOM wrote its own
 * `HttpServerConnection` fault) may still have been committed, so its add and create items count too, unconfirmed and with only
 * the ids the request names.
 */
export function createdItems(request: string, response: string): CreatedItem[] {
  let root: XmlElement;
  let answer: ResponseDocument;
  try {
    root = parseXml(request).root;
    answer = ResponseDocument.parse(response);
  } catch {
    return [];
  }
  const items = root.name === "Item" ? [root] : childElements(root, "Item");
  const adds = items.filter((item) => ["add", "create"].includes(attributeOf(item, "action") ?? ""));
  if (adds.length === 0) return [];
  let unconfirmed = false;
  const results: XmlElement[] = [];
  const fault = bodyChildren(answer, "Fault")[0];
  if (fault !== undefined) {
    const actor = childElements(fault).find((e) => e.name === "faultactor" || e.name.endsWith(":faultactor"));
    if (actor === undefined || innerText(actor) !== "HttpServerConnection") return [];
    unconfirmed = true;
  } else {
    for (const result of bodyChildren(answer, "Result")) results.push(...childElements(result, "Item"));
  }
  const created: CreatedItem[] = [];
  for (const item of adds) {
    if (!unconfirmed && attributeOf(item, "action") !== "add") continue;
    const type = attributeOf(item, "type") ?? "";
    let id = attributeOf(item, "id") ?? "";
    if (id === "") {
      const found = results.findIndex((r) => (attributeOf(r, "type") ?? "") === type);
      if (found >= 0) {
        id = attributeOf(results[found]!, "id") ?? "";
        results.splice(found, 1);
      }
    }
    created.push({ type, id, unconfirmed });
  }
  return created;
}

const refOf = (item: CreatedItem): ItemRef => ({ type: item.type, id: item.id, ...(item.unconfirmed ? { unconfirmed: true as const } : {}) });

const GONE = "\u0001gone";

async function applyOne(inn: Innovator, aml: string): Promise<ResponseDocument> {
  return inn.applyItem(aml);
}

/** The name an item belongs to, or null when it no longer exists: a relationship's source's, otherwise its own name or keyed name. */
async function ownerOf(inn: Innovator, type: string, id: string, depth: number): Promise<string | null> {
  const response = await applyOne(inn, `<Item type="${type}" id="${id}" action="get"/>`);
  if (response.isError) {
    if (response.errorCode === "0") return null;
    throw new Error(response.errorString);
  }
  const item = response.items[0];
  if (item === undefined) return null;
  const property = (name: string): XmlElement | undefined => childElements(item, name)[0];
  const text = (name: string): string => {
    const element = property(name);
    return element === undefined ? "" : innerText(element);
  };
  const sourceId = text("source_id");
  if (sourceId === "") {
    const name = text("name");
    return name !== "" ? name : text("keyed_name");
  }
  const sourceType = attributeOf(property("source_id")!, "type") ?? "";
  if (sourceType === "" || depth >= 3) throw new Error(`cannot resolve the source of ${type} ${id}`);
  const source = await ownerOf(inn, sourceType, sourceId, depth + 1);
  if (source === null) throw new Error(`source ${sourceType} ${sourceId} not found`);
  return source;
}

async function deleteOne(inn: Innovator, item: CreatedItem, unverified: ItemRef[]): Promise<string | null> {
  try {
    if (item.id === "") {
      return item.unconfirmed
        ? "its call failed in transport and the request names no id, so whether it was created is unknown"
        : "the server returned no id";
    }
    const owner = await ownerOf(inn, item.type, item.id, 0);
    if (owner === null) {
      if (item.unconfirmed) unverified.push(refOf(item));
      return GONE;
    }
    if (!isScratchItemName(owner)) return `belongs to '${owner}', not ${SCRATCH_PREFIX}* or ${ITEM_TYPE_PREFIX}*`;
    const deleted = await applyOne(inn, `<Item type="${item.type}" id="${item.id}" action="delete"/>`);
    return deleted.isError ? `delete failed: ${deleted.errorString}` : null;
  } catch (error) {
    return `cleanup failed: ${(error as Error).message}`;
  }
}

/**
 * Deletes every item in `created`, newest first, as the oracle host's cleanup does. The first `prior` of them were created by
 * earlier runs that kept theirs, so the report's `created` lists only the rest. A delete the server refuses (another scratch
 * item still refers to it) is tried again after the others for as long as a pass deletes something.
 */
export async function cleanup(inn: Innovator, created: readonly CreatedItem[], prior = 0): Promise<CleanupReport> {
  const deleted: ItemRef[] = [];
  const kept: CleanupReport["kept"] = [];
  const unverified: ItemRef[] = [];
  let pending = [...created].reverse();
  for (;;) {
    const again: CreatedItem[] = [];
    const reasons = new Map<CreatedItem, string>();
    let progress = 0;
    for (const item of pending) {
      const reason = await deleteOne(inn, item, unverified);
      if (reason === GONE) progress += 1;
      else if (reason === null) {
        deleted.push(refOf(item));
        progress += 1;
      } else if (reason.startsWith("delete failed")) {
        again.push(item);
        reasons.set(item, reason);
      } else kept.push({ ...refOf(item), reason });
    }
    if (again.length === 0) break;
    if (progress === 0) {
      for (const item of again) kept.push({ ...refOf(item), reason: reasons.get(item)! });
      break;
    }
    pending = again;
  }
  return { created: created.slice(prior).map(refOf), deleted, kept, unverified };
}

/**
 * Work done before a recorded run, through a connection of its own: lock the scratch `DatabaseUpgrade` rows of the packages about
 * to be imported (the engine's unlock path), and give scratch items a new generation (the merge's current-generation path). Both
 * refuse anything not named `LIBSJS-SCRATCH-*`. The new generations are returned: they are created items, and the cleanup deletes them.
 */
export async function preRun(
  inn: Innovator,
  options: { lockRowsOf?: readonly string[]; versionBefore?: readonly { type: string; id: string }[] },
): Promise<CreatedItem[]> {
  for (const name of options.lockRowsOf ?? []) {
    if (!isScratch(name)) throw new Error(`refusing to lock a non-scratch row: ${name}`);
    const rows = await applyOne(inn, `<Item type="DatabaseUpgrade" action="get" select="id"><name>${name}</name><type>1</type></Item>`);
    if (rows.isError) {
      if (rows.errorCode === "0") continue;
      throw new Error(rows.errorString);
    }
    for (const row of rows.items) {
      const locked = await applyOne(inn, `<Item type="DatabaseUpgrade" id="${attributeOf(row, "id")}" action="lock"/>`);
      if (locked.isError) throw new Error(`lock failed: ${locked.errorString}`);
    }
  }
  const made: CreatedItem[] = [];
  for (const { type, id } of options.versionBefore ?? []) {
    const found = await applyOne(inn, `<Item type="${type}" id="${id}" action="get" select="name,keyed_name"/>`);
    if (found.isError) throw new Error(`version: ${found.errorString}`);
    const item = found.items[0];
    const property = (name: string): string => {
      const element = item === undefined ? undefined : childElements(item, name)[0];
      return element === undefined ? "" : innerText(element);
    };
    const owner = property("name") !== "" ? property("name") : property("keyed_name");
    if (!isScratchItemName(owner)) throw new Error(`refusing to version a non-scratch item: ${type} ${id} '${owner}'`);
    const version = await applyOne(inn, `<Item type="${type}" id="${id}" action="version"/>`);
    if (version.isError) throw new Error(`version failed: ${version.errorString}`);
    const newId = version.items[0] === undefined ? "" : (attributeOf(version.items[0], "id") ?? "");
    made.push({ type, id: newId, unconfirmed: false });
  }
  return made;
}
