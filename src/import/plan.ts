import type { Engine } from "../engines.js";
import type { XmlElement } from "../xml/dom.js";
import type { FileItem, PlanEntry } from "./build-order.js";
import { loadPackage, skippedFileWarning } from "./load-package-dom.js";
import type { LoadPackageOptions, LoadedPackage } from "./load-package-dom.js";

/**
 * The import plan of one package folder (IMP-033): what the load and `build.xsl` do with it, offline. It is made from the
 * same plan the import orders by, so the two cannot disagree. It does not call the server and checks no reference.
 */

/** Where an item came from: the package file and its place in it. */
export interface PlanSource {
  /** The file path as the listing gave it. */
  file: string;
  /** The item's position among the file's items, from 1. */
  itemIndex: number;
  /** The `tempKeyName` stamp the item carries: the file name without extension, for the first item of the file only. */
  tempKeyName: string | null;
}

/** An item as the plan names it: its attributes as written, null when absent. */
export interface PlanItem {
  type: string | null;
  action: string | null;
  id: string | null;
}

/** One item the transform writes, in output order. */
export interface PlanSequenceEntry extends PlanItem {
  /** Place in the output, from 1. */
  position: number;
  /** `G01` to `G53`, or `copy of <position>` for the copies of IMP-026. */
  group: string;
  source: PlanSource;
}

/** The add that carries a copy. Its position is in the sequence unless the add is itself nested in an emitted item. */
export interface PlanCarrier extends PlanItem {
  position?: number;
}

/** A later sibling of an `ItemType` or `RelationshipType` add that is written once more after it (IMP-026). */
export interface PlanRepeat extends PlanItem {
  carriedBy: PlanCarrier;
  /** The position of the copy in the sequence; absent for a copy nested in an emitted item. */
  position?: number;
  /** For a copy nested in an emitted item: the position of that item. */
  insideEntry?: number;
  source?: PlanSource;
}

/** A file item that is not written at all, with the check it failed. */
export interface PlanDropped extends PlanItem {
  reason: string;
  source: PlanSource;
}

/** A file without `AML/Item`, left out with a warning. */
export interface PlanSkippedFile {
  file: string;
  warning: string;
}

export interface ImportPlan {
  engine: Engine;
  /** The folder the plan was made for, as given. */
  packageFolder: string;
  sequence: PlanSequenceEntry[];
  repeats: PlanRepeat[];
  dropped: PlanDropped[];
  skipped: PlanSkippedFile[];
  /** What the load wrote to the log, in order. */
  warnings: string[];
}

function itemOf(element: XmlElement): PlanItem {
  const read = (name: string): string | null => (element.hasAttribute(name) ? element.getAttribute(name) : null);
  return { type: read("type"), action: read("action"), id: read("id") };
}

/**
 * The plan of a loaded package. The files are the ones the load read, so the first file item of each carries the stamp.
 * @spec IMP-033
 */
export function describeLoadedPackage(packageFolder: string, loaded: LoadedPackage, warnings: string[]): ImportPlan {
  const read = loaded.files.filter((file) => !file.skipped);
  const sourceOf = (item: FileItem): PlanSource => {
    const file = read[item.fileIndex];
    return { file: file?.path ?? "", itemIndex: item.itemIndex, tempKeyName: item.itemIndex === 1 ? (file?.tempKeyName ?? null) : null };
  };
  const sequence: PlanSequenceEntry[] = loaded.plan.entries.map((entry) => ({
    position: entry.position,
    ...itemOf(entry.item.element),
    group: entry.group,
    source: sourceOf(entry.item),
  }));
  const repeats: PlanRepeat[] = [];
  for (const entry of loaded.plan.entries) {
    if (entry.copyOf === undefined) continue;
    const add = loaded.plan.entries[entry.copyOf - 1] as PlanEntry;
    repeats.push({
      carriedBy: { position: add.position, ...itemOf(add.item.element) },
      position: entry.position,
      ...itemOf(entry.item.element),
      source: sourceOf(entry.item),
    });
  }
  for (const repeat of loaded.nestedRepeats) {
    repeats.push({ carriedBy: itemOf(repeat.add), insideEntry: repeat.entry, ...itemOf(repeat.copy) });
  }
  const dropped: PlanDropped[] = loaded.plan.dropped.map((drop) => ({
    ...itemOf(drop.item.element),
    reason: drop.reason,
    source: sourceOf(drop.item),
  }));
  const skipped: PlanSkippedFile[] = loaded.files
    .filter((file) => file.skipped)
    .map((file) => ({ file: file.path, warning: skippedFileWarning(file.path) }));
  return { engine: loaded.engine, packageFolder, sequence, repeats, dropped, skipped, warnings };
}

/**
 * `plan import` for one package folder: runs the load of IMP-001 to IMP-032 offline and reports the sequence, the repeats,
 * the dropped items and the warnings. It stops at the first load failure, by throwing it, as the import does.
 * @spec IMP-033
 */
export function planPackage(solutionPath: string, options: LoadPackageOptions = {}): ImportPlan {
  const warnings: string[] = [];
  const loaded = loadPackage(solutionPath, { writeLine: (text) => warnings.push(text) }, options);
  return describeLoadedPackage(solutionPath, loaded, warnings);
}
