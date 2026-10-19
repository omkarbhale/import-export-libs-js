import type { CItemHelper } from "../client/item-helper.js";
import { nullReference } from "../client/dotnet.js";
import { CItemException } from "../client/fault.js";
import { resultPath } from "../client/package-lookups.js";
import { isCorePackage } from "../manifest/package-path.js";
import type { NetfxHashtable } from "../manifest/netfx-hashtable.js";
import { innerText, loadXml, outerXml, removeChild, selectSingleNode } from "../xml/index.js";
import type { XmlDocument, XmlElement, XmlNode } from "../xml/index.js";
import { innerText as responseText } from "../client/mini-xml.js";
import type { ExportItem } from "./export-item.js";
import { DescendantSearch, RelationshipItemSearch, lazyNodeList } from "./live-node-list.js";
import { getMessage } from "./messages.js";
import { RemovedReference, type RemovedRefReason } from "./removed-reference.js";

/** Adds an entry to the table of removed references unless its key, `from` followed by `to`, is already there (EXP-611). */
function addReference(excluded: NetfxHashtable<RemovedReference>, from: string, to: string, kind: RemovedRefReason): void {
  const key = from + to;
  if (!excluded.has(key)) excluded.add(key, new RemovedReference(from, to, kind));
}

/**
 * `RemoveRelationshipItem`: takes the item out of its parent, and the parent out of its own parent when nothing is left in it. A
 * missing parent is a `NullReferenceException`.
 *
 * @spec EXP-610
 */
export function removeRelationshipItem(relationshipItem: XmlNode): void {
  const parent = relationshipItem.parentNode;
  if (!parent) throw nullReference();
  removeChild(parent, relationshipItem);
  if (!parent.hasChildNodes()) {
    const grandparent = parent.parentNode;
    if (!grandparent) throw nullReference();
    removeChild(grandparent, parent);
  }
}

/**
 * `getItemID`: the `id` attribute of a relationship item, or when that is empty or missing, the text of its `id` child, or when
 * there is none, the empty string.
 *
 * @spec EXP-604
 */
export function getItemId(itemNode: XmlElement): string {
  let text = itemNode.getAttribute("id") ?? "";
  if (text === "") {
    const child = selectSingleNode("./id", itemNode);
    if (child) text = innerText(child);
  }
  return text;
}

/**
 * `RemoveReferencesToAnotherPackages`: takes out of the transformed document every reference to an unknown package, and records
 * each in `excluded` (EXP-600 to EXP-606). The first pass visits the relationship items (`.//Relationships/Item`) and removes one
 * whose type, own id (in a core package only) or related item belongs to an unknown package. The second pass visits the Method
 * stubs and removes the property element of one whose Method does. Both walk a live, lazily built node list, so what a removal
 * detaches changes what is visited next (EXP-615).
 *
 * @spec EXP-600 EXP-601 EXP-602 EXP-603 EXP-604 EXP-605 EXP-606 EXP-611 EXP-612 EXP-615 EXP-617
 */
export async function removeReferencesToAnotherPackages(
  helper: CItemHelper,
  item: ExportItem,
  doc: XmlDocument,
  packageName: string,
  excluded: NetfxHashtable<RemovedReference>,
): Promise<void> {
  const packages = helper.packages;
  const packageElementIds = await packages.getPackageElementIds(packageName);
  const belongsToUnknownPackage = async (id: string): Promise<boolean> => !packageElementIds.has(id) && (await packages.isInNonCorePackages(id, packageName));
  const origin = `[${packageName}].[${item.typeName ?? ""}].${item.keyedName ?? ""}`;

  const relationshipItems = new RelationshipItemSearch(doc);
  for (const relationship of lazyNodeList(() => relationshipItems.next())) {
    const typeAttribute = relationship.getAttributeNode("type");
    if (!typeAttribute) throw nullReference();
    const type = typeAttribute.value;
    if (type === "") {
      throw new CItemException(
        -1,
        getMessage("TypeOfRelationshipIsNotDefined"),
        getMessage("TypeOfRelationshipIsNotDefinedInTheAMLPortion", outerXml(relationship)),
      );
    }

    if (await belongsToUnknownPackage(await packages.getRelationshipTypeId(type))) {
      removeRelationshipItem(relationship);
      addReference(excluded, origin, getMessage("AllItemsOfTypeType", type), "type");
      continue;
    }

    if (isCorePackage(packageName)) {
      const itemId = getItemId(relationship);
      if (await belongsToUnknownPackage(itemId)) {
        removeRelationshipItem(relationship);
        addReference(excluded, origin, `[${type}].${itemId}`, "relationship");
        continue;
      }
    }

    const relatedId = selectSingleNode("./related_id", relationship) as XmlElement | null;
    if (!relatedId) continue;
    const relatedItemId = await helper.references.getRelatedItemConfigId(relatedId);
    if (await belongsToUnknownPackage(relatedItemId)) {
      removeRelationshipItem(relationship);
      const relatedType = relatedId.getAttributeNode("type")?.value ?? null;
      addReference(
        excluded,
        `${origin} (ID='${item.idName ?? ""}')`,
        relatedType !== null ? `[${relatedType}].${relatedItemId}` : `ID='${relatedItemId}'`,
        "item",
      );
    }
  }

  const methodStubs = new DescendantSearch(
    doc,
    "Item",
    (element) => element.getAttributeNode("type")?.value === "Method" && element.getAttributeNode("action")?.value === "get",
  );
  for (const stub of lazyNodeList(() => methodStubs.next())) {
    const request = loadXml(outerXml(stub), { preserveWhitespace: false });
    (request.documentElement as XmlElement).setAttribute("select", "config_id");
    const response = await helper.applyAML(outerXml(request));
    const configIdElement = resultPath(response, ["Item", "config_id"])[0];
    if (!configIdElement) throw nullReference();
    const configId = responseText(configIdElement);
    if (packageElementIds.has(configId) || !(await packages.isInNonCorePackages(configId, packageName))) continue;

    const property = stub.parentNode;
    if (!property) throw nullReference();
    const owner = property.parentNode;
    if (!owner) continue;
    const keyedName = (property as XmlElement).getAttribute("keyed_name") ?? "";
    removeChild(owner, property);
    addReference(excluded, origin, ` [Method].[${keyedName}(ID=${configId})]`, "item");
  }
}
