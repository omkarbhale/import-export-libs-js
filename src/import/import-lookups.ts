import { CItemException } from "../client/fault.js";
import type { CItemHelper } from "../client/item-helper.js";
import { type XmlDocument, type XmlElement, setInnerText } from "../xml/dom.js";
import { selectNodes } from "../xml/xpath.js";
import { ImportItems, type MergeHelper } from "./import-items.js";

/** What the merge side of the helper needs of it: its requests and the lookups with their cache. */
export type MergeHost = Pick<CItemHelper, "applyAML" | "lookups">;

const ITEM_MUST_HAVE_ID_AND_TYPE = ["Item with action \"add\" must have 'id' and 'type' set", "Error - empty 'id' or 'type'"] as const;
const ITEM_TYPE_IS_NOT_VERSIONABLE = ["Item type is not versionable", "Error - item type is not versionable"] as const;

/** `XmlElement.GetAttribute(name)`: the value, or the empty string for a missing attribute. */
const getAttribute = (element: XmlElement, name: string): string => element.getAttributeNode(name)?.value ?? "";

/** Gives every `source_id` of the item's own relationships the new id (IMP-320, IMP-351). */
function moveRelationshipsTo(item: XmlElement, id: string): void {
  for (const sourceId of selectNodes("Relationships/Item/source_id", item)) setInnerText(sourceId as XmlElement, id);
}

/**
 * The lookups of the engine's `CItemHelper` that the import's merge and skip decisions use: the move of a versionable add to
 * its latest generation, the existence tests, the unlock and the relationship test. They share the helper's request cache
 * and its metadata lookups (IMP-102, IMP-170). Values are interpolated into the requests as they are (AGENTS.md rule 7).
 *
 * @spec IMP-300 IMP-311 IMP-313 IMP-320 IMP-322 IMP-334 IMP-350 IMP-351 IMP-352
 */
export class ImportLookups implements MergeHelper {
  constructor(private readonly host: MergeHost) {}

  applyAML(aml: string): ReturnType<MergeHost["applyAML"]> {
    return this.host.applyAML(aml);
  }

  /** `IsVersionable` (IMP-170). */
  isVersionable(typeName: string): Promise<boolean> {
    return this.host.lookups.isVersionable(typeName);
  }

  /**
   * `doImport`: runs `CImportItems.Import` on the item document with the run's merge flag (IMP-300).
   *
   * @spec IMP-300
   */
  doImport(itemInXml: XmlDocument, mergeMode: boolean): Promise<void> {
    return new ImportItems(this).import(itemInXml, mergeMode);
  }

  /**
   * `SetItemIdToLastGeneration`: gives a versionable add the id of the current generation of its item, and its
   * relationships' `source_id` with it. The current id comes from `GetCurrentIdOfVersion`, and from the unique key when that
   * fails with a `CItemException`; a lookup that finds nothing leaves the item as it is (IMP-320).
   *
   * @spec IMP-311 IMP-320
   */
  async setItemIdToLastGeneration(item: XmlElement): Promise<void> {
    const id = getAttribute(item, "id");
    const type = getAttribute(item, "type");
    if (id === "" || type === "") {
      throw new CItemException(-1, ITEM_MUST_HAVE_ID_AND_TYPE[0], ITEM_MUST_HAVE_ID_AND_TYPE[1], null);
    }
    if (!(await this.host.lookups.isVersionable(type))) {
      throw new CItemException(-1, ITEM_TYPE_IS_NOT_VERSIONABLE[0], ITEM_TYPE_IS_NOT_VERSIONABLE[1], null);
    }
    let currentId: string | null;
    try {
      currentId = await this.host.lookups.getCurrentIdOfVersion(id, type);
    } catch (error) {
      if (!(error instanceof CItemException)) throw error;
      currentId = await this.host.lookups.getCurrentIdByUniqueKey(item, true);
    }
    if (currentId === null || currentId === "" || currentId === id) return;
    item.setAttribute("id", currentId);
    moveRelationshipsTo(item, currentId);
  }

  /**
   * `Unlock`: one unlock request. Every fault is thrown, faultcode 0 included (IMP-322).
   *
   * @spec IMP-313 IMP-322
   */
  async unlock(id: string, type: string): Promise<void> {
    await this.host.applyAML(`<Item type='${type}' id='${id}' action='unlock' doGetItem='0' />`);
  }

  /**
   * `ExistRelItemInCurVer`: whether a relationship of that type exists between the two ends. A "no items" fault is false;
   * every other fault is thrown (IMP-334).
   *
   * @spec IMP-332 IMP-334
   */
  async existRelItemInCurVer(type: string, sourceId: string, relatedId: string): Promise<boolean> {
    try {
      await this.host.applyAML(`<Item type='${type}' action='get' select='id'><source_id>${sourceId}</source_id><related_id>${relatedId}</related_id></Item>`);
    } catch (error) {
      if (error instanceof CItemException && error.faultcode === 0) return false;
      throw error;
    }
    return true;
  }

  /**
   * `ItemExistById`: whether a get by id answers. A `CItemException` of any faultcode is "does not exist" (IMP-352).
   *
   * @spec IMP-352
   */
  async itemExistById(id: string, type: string): Promise<boolean> {
    try {
      await this.host.applyAML(`<Item type='${type}' action='get' select='id'><id>${id}</id></Item>`);
    } catch (error) {
      if (error instanceof CItemException) return false;
      throw error;
    }
    return true;
  }

  /**
   * `DoesItemAlreadyExist(item, null)`: asks by id for a plain item and by version for a versionable one. For a versionable
   * item that exists in another generation, the item's `id` and its relationships' `source_id` become the current
   * generation's (IMP-351). The overload with an `IdTypePair` is not reachable and is not offered.
   *
   * @spec IMP-351
   */
  async doesItemAlreadyExist(item: XmlElement): Promise<boolean> {
    let id = getAttribute(item, "id");
    const type = getAttribute(item, "type");
    if (id === "" || type === "") {
      throw new CItemException(-1, ITEM_MUST_HAVE_ID_AND_TYPE[0], ITEM_MUST_HAVE_ID_AND_TYPE[1], null);
    }
    if (!(await this.host.lookups.isVersionable(type))) return this.itemExistById(id, type);

    const original = id;
    let exists = false;
    try {
      id = await this.host.lookups.getCurrentIdOfVersion(id, type);
      exists = true;
    } catch (error) {
      if (!(error instanceof CItemException)) throw error;
      const found = await this.host.lookups.getCurrentIdByUniqueKey(item, true);
      if (found === null) id = original;
      else {
        id = found;
        exists = true;
      }
    }
    if (id !== original) {
      item.setAttribute("id", id);
      moveRelationshipsTo(item, id);
    }
    return exists;
  }

  /**
   * The test of the import loop for the skip path: with merge off, an `add` of an item that already exists is not sent. With
   * merge on, or for any other action, the helper is not asked (IMP-350).
   *
   * @spec IMP-350
   */
  async skipsExistingAdd(item: XmlElement, mergeMode: boolean): Promise<boolean> {
    return !mergeMode && getAttribute(item, "action") === "add" && (await this.doesItemAlreadyExist(item));
  }
}
