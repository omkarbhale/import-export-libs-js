import type { CItemHelper } from "../client/item-helper.js";
import type { NetfxHashtable } from "../manifest/netfx-hashtable.js";
import type { PathEnvironment } from "../io/host-path.js";
import { CExportItems, type ExportRunState } from "./cexport-items.js";
import type { ExportItem } from "./export-item.js";
import type { RemovedReference } from "./removed-reference.js";
import { removeReferencesToAnotherPackages } from "./unknown-references.js";

/** The references removed during the export of one package, by key; `null` when the context says `DoNotRemove` (EXP-514). */
export type ExcludedReferences = NetfxHashtable<RemovedReference> | null;

/**
 * `CItemHelper.PackageItem(item, packageName, level, excludedRefs)`: exports one item with `CExportItems` into the helper's current
 * folder. When the table is not null the export removes the references to unknown packages and records them in it (EXP-600). The
 * run logs the success line when this returns (EXP-515), and a `CItemException` from it is the item's failure (EXP-516).
 * 14.35's call also takes the template dictionary and the package-element map of the run (`run`, EXP-002) and, in the language modes, the
 * action and the language list. It returns null when `ExportLanguageResourcesOnly` found nothing to write (LP-151).
 *
 * @spec EXP-001 EXP-515 EXP-600 LP-151
 */
export async function packageItem(
  helper: CItemHelper,
  item: ExportItem,
  packageName: string,
  level: string | null,
  excludedRefs: ExcludedReferences,
  environment: PathEnvironment = {},
  run?: ExportRunState,
): Promise<string | null> {
  const removeUnknownReferences =
    excludedRefs === null ? undefined : (doc: Parameters<typeof removeReferencesToAnotherPackages>[2]) => removeReferencesToAnotherPackages(helper, item, doc, packageName, excludedRefs);
  return new CExportItems(helper, environment, run).export(item, level, removeUnknownReferences);
}
