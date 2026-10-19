import { hostname, userInfo } from "node:os";
import { descendantsNamed, resultItems } from "../client/answer.js";
import { isNullReference, isXPathException, isXmlException, nullReference } from "../client/dotnet.js";
import { CItemException, type ResponseDocument, stackText } from "../client/fault.js";
import type { CItemHelper } from "../client/item-helper.js";
import { type XmlElement as AnswerElement, attributeOf, childElements, innerText, localName, namespaceUri } from "../client/mini-xml.js";
import { getMessage } from "../export/messages.js";
import { ArgumentNullException } from "../io/errors.js";
import type { XmlElement } from "../xml/dom.js";
import { selectSingleNode } from "../xml/xpath.js";
import { outerXml } from "../xml/writer-legacy.js";
import { ImportLookups } from "./import-lookups.js";

/** The namespace of the multilingual elements the server answers a `language` request with (IMP-447). */
const I18N_NAMESPACE = "http://www.aras.com/I18N";

export interface ImportHelperOptions {
  /** The value of `os_user`, or a function that gives it at each write (IMP-452). The default is {@link defaultOsUser}. */
  osUser?: string | (() => string);
}

/**
 * `WindowsIdentity.GetCurrent().Name` for a process that is not on Windows: the engine writes `DOMAIN\user` on Windows and
 * `MACHINE\user` for a local account, and the port writes `<hostname>\<user>` on every other host (IMP-452).
 *
 * @spec IMP-452
 */
export function defaultOsUser(platform: NodeJS.Platform = process.platform): string {
  const user = userInfo().username;
  const domain = platform === "win32" ? process.env.USERDOMAIN : undefined;
  return `${domain === undefined || domain === "" ? hostname() : domain}\\${user}`;
}

/** The first element of the answer, in document order, that is an `Item` of that type (`.//Item[@type='…']`). */
function firstItemOfType(response: ResponseDocument, type: string): AnswerElement | undefined {
  return descendantsNamed(response.document.root, "Item").find((item) => attributeOf(item, "type") === type);
}

/** `((XmlNode)node).Attributes["id"].Value`: a missing node or attribute is a null reference. */
function requiredId(item: AnswerElement | undefined): string {
  const id = item === undefined ? undefined : attributeOf(item, "id");
  if (id === undefined) throw nullReference();
  return id;
}

/** `XmlElement.GetAttribute(name)`: the value, or the empty string for a missing attribute. */
const getAttribute = (element: XmlElement, name: string): string => element.getAttributeNode(name)?.value ?? "";

/** The `CItemException(-1, <stack>, <message> + suffix, <inner>)` the engine makes from another exception. */
function wrapped(error: unknown, suffix: string): CItemException {
  return new CItemException(-1, stackText(error), (error as Error).message + suffix, error);
}

/**
 * The import side of the engine's `CItemHelper`: the audit row (`WriteReleaseData`), the package groups, the label of an
 * ItemType and the deletion of SQL items. Values go into the requests unescaped (AGENTS.md rule 7). The lookups share the
 * helper's cache (IMP-102).
 *
 * @spec IMP-411 IMP-425 IMP-426 IMP-429 IMP-446 IMP-447 IMP-448 IMP-450 IMP-451 IMP-452 IMP-453 IMP-460 IMP-461
 */
export class ImportHelper {
  /** The existence tests, the unlock and the other lookups of the merge (IMP-448). */
  readonly lookups: ImportLookups;
  private readonly osUser: () => string;

  constructor(
    private readonly host: CItemHelper,
    options: ImportHelperOptions = {},
  ) {
    this.lookups = new ImportLookups(host);
    const osUser = options.osUser;
    this.osUser = typeof osUser === "string" ? () => osUser : (osUser ?? (() => defaultOsUser()));
  }

  /**
   * `GetLabelOfItemType`: the English label of an ItemType, or its name when the answer has none. The answer is cached by the
   * request text. A `CItemException` is rethrown with the suffix on its detail; an XML, XPath or null-reference failure becomes
   * a `CItemException` with faultcode -1 (IMP-447).
   *
   * @spec IMP-429 IMP-447
   */
  async getLabelOfItemType(type: string): Promise<string> {
    const aml = `<Item action='get' select='label' type='ItemType' language='en'><name>${type}</name></Item>`;
    const suffix = getMessage("UnableToGetLabelOfTypeItemType", type);
    try {
      const cache = this.host.lookups.requestedItems;
      let answer = cache.get(aml);
      if (answer === undefined) {
        answer = await this.host.applyAML(aml);
        cache.set(aml, answer);
      }
      const item = descendantsNamed(answer.document.root, "Result").flatMap((result) => childElements(result, "Item"))[0];
      if (item === undefined) throw nullReference();
      return languageProperty(item, "label", "en") ?? type;
    } catch (error) {
      if (error instanceof CItemException) {
        error.faultdetail = (error.faultdetail ?? "") + suffix;
        throw error;
      }
      if (isXmlException(error) || isXPathException(error) || isNullReference(error)) throw wrapped(error, suffix);
      throw error;
    }
  }

  /**
   * `GetPackageGroupIdOrCreateIfNotExists`: the id of the group of a package definition, added when it does not exist. The
   * answer, of the `get` or of the `add`, is cached under the text of the `get` and never invalidated (IMP-446).
   *
   * @spec IMP-446
   */
  async getPackageGroupIdOrCreateIfNotExists(packageDefinitionId: string | null, packageGroupName: string | null): Promise<string> {
    const get = `<Item type='PackageGroup' select='id' action='get'><name>${packageGroupName ?? ""}</name><source_id>${packageDefinitionId ?? ""}</source_id></Item>`;
    const suffix = getMessage("CanInitGroupInPackageDefinition");
    try {
      const cache = this.host.lookups.requestedItems;
      let answer = cache.get(get);
      if (answer === undefined) {
        try {
          answer = await this.host.applyAML(get);
          cache.set(get, answer);
        } catch (error) {
          if (!(error instanceof CItemException) || error.faultcode !== 0) throw error;
          answer = await this.host.applyAML(
            `<Item type='PackageGroup' action='add' doGetItem='0'><name>${packageGroupName ?? ""}</name><source_id>${packageDefinitionId ?? ""}</source_id></Item>`,
          );
          cache.set(get, answer);
        }
      }
      const item = resultItems(answer)[0];
      if (item === undefined) throw nullReference();
      return attributeOf(item, "id") ?? "";
    } catch (error) {
      if (error instanceof CItemException) {
        error.faultdetail = (error.faultdetail ?? "") + suffix;
        throw error;
      }
      throw wrapped(error, suffix);
    }
  }

  /**
   * `Islocked`: whether the item has a non-empty `locked_by_id`. A fault propagates as it is, faultcode 0 included (IMP-448).
   *
   * @spec IMP-448
   */
  async islocked(id: string, type: string): Promise<boolean> {
    let answer: ResponseDocument;
    try {
      answer = await this.host.applyAML(`<Item type='${type}' action='get' levels='0' select='locked_by_id'><id>${id}</id></Item>`);
    } catch (error) {
      if (isXPathException(error) || isNullReference(error) || isXmlException(error)) {
        throw wrapped(error, getMessage("UnableToToCheckWhetheItemIsLocked"));
      }
      throw error;
    }
    return resultItems(answer).some((item) => childElements(item, "locked_by_id").some((locked) => innerText(locked) !== ""));
  }

  /**
   * `WriteReleaseData`: the `DatabaseUpgrade` row of a package for a release, added when absent and edited otherwise, and
   * the id of the row (IMP-450, IMP-451). `os_user` is read at each write (IMP-452).
   *
   * @spec IMP-411 IMP-450 IMP-451 IMP-452 IMP-453
   */
  async writeReleaseData(packageName: string, status: number, targetRelease: string | null, description: string | null): Promise<string> {
    const release = targetRelease ?? "";
    const text = description ?? "";
    const isLatest = status > 0 ? "<is_latest>1</is_latest>" : status === 0 ? "<is_latest>0</is_latest>" : "";
    let answer: ResponseDocument;
    try {
      answer = await this.host.applyAML(
        `<Item action='get' type='DatabaseUpgrade'><target_release>${release}</target_release><name>${packageName}</name><type>1</type></Item>`,
      );
    } catch (error) {
      if (!(error instanceof CItemException) || error.faultcode !== 0) throw error;
      const add =
        `<Item type='DatabaseUpgrade' action='add' doGetItem='0'><upgrade_status>${status}</upgrade_status>${isLatest}` +
        `<name>${packageName}</name><os_user>${this.osUser()}</os_user><description>${text}</description>` +
        `<applied_on>__now()</applied_on><target_release>${release}</target_release><type>1</type></Item>`;
      try {
        answer = await this.host.applyAML(add);
      } catch (failed) {
        // the catalogue key of this text has a leading space in the engine, so the suffix is empty (IMP-453)
        if (failed instanceof CItemException) failed.faultdetail = (failed.faultdetail ?? "") + getMessage("CannotAddInstanceOfDatabaseUpgradeItemType");
        throw failed;
      }
      return requiredId(firstItemOfType(answer, "DatabaseUpgrade"));
    }

    const id = requiredId(firstItemOfType(answer, "DatabaseUpgrade"));
    const edit =
      `<Item type='DatabaseUpgrade' id='${id}' action='edit' doGetItem='0'><upgrade_status>${status}</upgrade_status>${isLatest}` +
      `<name>${packageName}</name><description>${text}</description><applied_on>__now()</applied_on>` +
      `<os_user>${this.osUser()}</os_user><target_release>${release}</target_release><type>1</type></Item>`;
    if (await this.islocked(id, "DatabaseUpgrade")) await this.lookups.unlock(id, "DatabaseUpgrade");
    await this.host.applyAML(edit);
    if (status !== 0) {
      await this.host.applyAML(
        `<Item type='DatabaseUpgrade' action='edit' doGetItem='0' where="type='1' and name='${packageName}' and not id='${id}'">\t<is_latest>0</is_latest></Item>`,
      );
    }
    return id;
  }

  /**
   * `DeleteSqlItems`: deletes every item of type `sql` (any case) among the nodes, one at a time, by the `id` attribute. An id
   * that is only a child element is accepted and deleted as the empty id (bug IMP-461).
   *
   * @spec IMP-460 IMP-461
   */
  async deleteSqlItems(allItems: readonly XmlElement[] | null): Promise<void> {
    if (allItems === null) throw new ArgumentNullException("allItems");
    for (const item of allItems) {
      const type = getAttribute(item, "type");
      if (type === "") {
        throw new CItemException(-1, getMessage("ItemHasNoType"), getMessage("TheFollowingItemHasNoType", outerXml(item)), null);
      }
      if (type.toLowerCase() !== "sql") continue;
      const id = getAttribute(item, "id");
      if (id === "" && selectSingleNode("id", item) === null) {
        throw new CItemException(-1, getMessage("ItemHasNoID"), getMessage("TheFollowingItemHaNoIdAndCannotBeDeleted", outerXml(item)), null);
      }
      await this.host.applyAML(`<Item type='${type}' id='${id}' action='delete' />`);
    }
  }
}

/**
 * IOM's `getProperty(name, null, lang)` on a single item: the property is the multilingual element `i18n:{name}` with
 * `xml:lang="{lang}"`. A plain element is not matched (IMP-447). The value is the id of a nested item, or the text, which is
 * null for a blank `is_null="1"` element.
 */
function languageProperty(item: AnswerElement, name: string, lang: string): string | null {
  const element = childElements(item).find(
    (child) => localName(child.name) === name && namespaceUri(child) === I18N_NAMESPACE && attributeOf(child, "xml:lang") === lang,
  );
  if (element === undefined) return null;
  const nested = childElements(element, "Item")[0];
  if (nested !== undefined) {
    const id = attributeOf(nested, "id");
    return id === undefined || id === "" ? null : id;
  }
  const text = innerText(element);
  return text === "" && attributeOf(element, "is_null")?.toLowerCase() === "1" ? null : text;
}
