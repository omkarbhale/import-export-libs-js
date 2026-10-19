import { getItemCount } from "../client/answer.js";
import { CItemException, type ResponseDocument, getProperty } from "../client/fault.js";
import type { CItemHelper } from "../client/item-helper.js";
import { needToHandleNullPropertyValues } from "../client/null-values.js";
import { IomItem } from "../export/iom-item.js";
import { ArgumentException, ArgumentNullException } from "../io/errors.js";
import { type XmlDocument, type XmlElement, setInnerText } from "../xml/dom.js";
import { selectNodes } from "../xml/xpath.js";
import type { SUImportContext } from "./import-context.js";
import { ImportItems, type LanguagePackHelper, type MergeHelper } from "./import-items.js";

/** What the merge side of the helper needs of it: its requests and the lookups with their cache. */
export type MergeHost = Pick<CItemHelper, "applyAML" | "lookups" | "engine" | "inn" | "innovatorVersion">;

const ITEM_MUST_HAVE_ID_AND_TYPE = ["Item with action \"add\" must have 'id' and 'type' set", "Error - empty 'id' or 'type'"] as const;
const ITEM_TYPE_IS_NOT_VERSIONABLE = ["Item type is not versionable", "Error - item type is not versionable"] as const;

type XmlElementOfAnswer = Parameters<typeof getProperty>[0];

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
export class ImportLookups implements MergeHelper, LanguagePackHelper {
  constructor(private readonly host: MergeHost) {}

  applyAML(aml: string): ReturnType<MergeHost["applyAML"]> {
    return this.host.applyAML(aml);
  }

  /** `IsVersionable` (IMP-170). */
  isVersionable(typeName: string): Promise<boolean> {
    return this.host.lookups.isVersionable(typeName);
  }

  /**
   * `doImport(item, mergeMode)`: runs `CImportItems.Import` on the item document with the run's merge flag, which sends the item
   * (IMP-300). A null document is an `ArgumentNullException` for `itemInXml`. 14.35 reads the server's version when it makes the
   * `CImportItems`, and takes the language-pack branch on a server that needs it (LP-040, LP-042); a helper with no version is a null
   * reference there, outside the exception handler of `Import`.
   *
   * @spec IMP-300 LP-040 LP-042
   */
  doImport(itemInXml: XmlDocument | null, mergeMode: boolean, amlBatchMode = false): Promise<void> {
    if (itemInXml === null) throw new ArgumentNullException("itemInXml");
    return this.importItems().import(itemInXml, mergeMode, amlBatchMode);
  }

  /**
   * `doImport(item, importContext)`: the overload of 14.35 that the batch flush calls. With the context's `AmlBatchMode` on, the item is
   * prepared and not sent (IMP-512). A null document is an `ArgumentNullException` for `itemInXml`, then a null context for
   * `importContext`.
   *
   * @spec IMP-512
   */
  doImportInContext(itemInXml: XmlDocument | null, importContext: SUImportContext | null): Promise<void> {
    if (itemInXml === null) throw new ArgumentNullException("itemInXml");
    if (importContext === null) throw new ArgumentNullException("importContext");
    return this.importItems().import(itemInXml, importContext.merge, importContext.amlBatchMode);
  }

  /** The `CImportItems` of a `doImport`, with the language-pack helper on a 14.35 server that needs it (LP-040). */
  private importItems(): ImportItems {
    const handleNullValues = this.host.engine === "14.35" && needToHandleNullPropertyValues(this.host.innovatorVersion);
    return new ImportItems(this, this.host.engine, handleNullValues ? this : undefined);
  }

  /**
   * `GetPropertyItemWithRequiredProps(where)`: the `Property` with that `where`, asked for its `id` and `keyed_name`. A fault other than
   * "no items" is thrown as the engine's `CItemException` made from the answer alone; that one is swallowed and the error item is what
   * the caller reads (LP-042, bug LP-041).
   *
   * @spec LP-042
   */
  async getPropertyItemWithRequiredProps(where: string): Promise<ResponseDocument> {
    const request = IomItem.newItem("Property", "get");
    request.setAttribute("select", "id[is_not_null()], keyed_name[is_not_null()]");
    request.setAttribute("where", where);
    return this.swallowNoItems(await this.host.inn.applyItem(request.toXml()));
  }

  /**
   * `GetLanguagesWithSuffixes()`: the `Language` get with `code, suffix`, as a dictionary from code to suffix. "No items" gives an empty
   * one, another fault is thrown. A `Language` with no `code` is an `ArgumentNullException` and a code twice is an `ArgumentException`;
   * a missing suffix is null (LP-043). The request is made for every update.
   *
   * @spec LP-043
   */
  async getLanguagesWithSuffixes(): Promise<Map<string, string | null>> {
    const request = IomItem.newItem("Language", "get");
    request.setAttribute("select", "code, suffix");
    const response = this.swallowNoItems(await this.host.inn.applyItem(request.toXml()));
    const suffixes = new Map<string, string | null>();
    const count = getItemCount(response);
    for (let i = 0; i < count; i += 1) {
      const item = response.items[i] as XmlElementOfAnswer;
      const code = getProperty(item, "code");
      if (code === null) throw new ArgumentNullException("key");
      if (suffixes.has(code)) throw new ArgumentException("An item with the same key has already been added.");
      suffixes.set(code, getProperty(item, "suffix"));
    }
    return suffixes;
  }

  /**
   * `CItemHelper.applySQL(sql)`: one `ApplySQL` request. A fault is thrown as a `CItemException` made from the SQL text taken as the
   * request, which the engine first loads as XML to indent it: the text is not XML, so what is thrown is the parser's `XmlException`
   * (`Data at the root level is invalid. Line 2, position 5.` for the statement of LP-043), and `Import` wraps that as it wraps any
   * (IMP-304). Probed (`06-null-values`, `sql-fault`, bug LP-045).
   *
   * @spec LP-043 LP-045
   */
  async applySql(sql: string): Promise<void> {
    const response = await this.host.inn.applySql(sql);
    if (response.isError) throw CItemException.fromRequest(sql, response, "14.35");
  }

  /** The `try`/`catch` of the two lookups: an error answer is thrown as a `CItemException` unless its faultcode is 0, which is swallowed. */
  private swallowNoItems(response: ResponseDocument): ResponseDocument {
    if (response.isError) {
      const error = CItemException.fromResponse(response, "14.35");
      if (error.faultcode !== 0) throw error;
    }
    return response;
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
