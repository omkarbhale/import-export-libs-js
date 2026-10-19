import type { CItemHelper } from "../client/item-helper.js";
import type { NetfxHashtable } from "../manifest/netfx-hashtable.js";
import type { PathEnvironment } from "../io/host-path.js";
import { CExportItems, type UnknownReferenceRemoval } from "./cexport-items.js";
import type { ExportItem } from "./export-item.js";

/** A reference that was taken out of an exported item because it points at an unknown package (`export-unknown-refs.md`). */
export interface RemovedReference {
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}

/** The references removed during the export of one package, by key; `null` when the context says `DoNotRemove` (EXP-514). */
export type ExcludedReferences = NetfxHashtable<RemovedReference> | null;

/**
 * Supplies step 5 of EXP-400 for one item: the removal of references to packages the export does not cover, which collects what it
 * removed in `excludedRefs`. The rules for it are `EXP-600` to `EXP-699`, built apart from the run; the run only hands it the package
 * and the table. It is asked for only when the context's mode is not `DoNotRemove`.
 */
export type UnknownReferenceRemovalProvider = (
  helper: CItemHelper,
  packageName: string,
  excludedRefs: NetfxHashtable<RemovedReference>,
) => UnknownReferenceRemoval;

/** The mode asks for a removal and the run was given none to ask. */
export class UnknownReferenceRemovalMissing extends Error {
  override name = "UnknownReferenceRemovalMissing";

  constructor() {
    super(
      "The export removes references to unknown packages (RemoveSilently or RemoveWithWarning), and no removal was supplied; " +
        "it is built with the rules EXP-600 to EXP-699. Use DoNotRemove until then.",
    );
  }
}

/**
 * `CItemHelper.PackageItem(item, packageName, level, excludedRefs)`: exports one item with `CExportItems` into the helper's current
 * folder. The run logs the success line when this returns (EXP-515), and a `CItemException` from it is the item's failure
 * (EXP-516).
 *
 * @spec EXP-001 EXP-515
 */
export async function packageItem(
  helper: CItemHelper,
  item: ExportItem,
  packageName: string,
  level: string | null,
  excludedRefs: ExcludedReferences,
  removal: UnknownReferenceRemovalProvider | undefined,
  environment: PathEnvironment = {},
): Promise<string> {
  let removeUnknownReferences: UnknownReferenceRemoval | undefined;
  if (excludedRefs !== null) {
    if (removal === undefined) throw new UnknownReferenceRemovalMissing();
    removeUnknownReferences = removal(helper, packageName, excludedRefs);
  }
  return new CExportItems(helper, environment).export(item, level, removeUnknownReferences);
}
