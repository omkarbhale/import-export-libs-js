import { DotNetException, parseInt32 } from "../client/dotnet.js";
import type { XmlDocument, XmlElement } from "../xml/dom.js";
import { ELEMENT_NODE, innerText } from "../xml/dom.js";
import { selectNodes, selectSingleNode } from "../xml/xpath.js";

/** The `ToolName` a `DBUpdateConfig` has before a host sets it: the description of the "Applied Updates" row a run creates (DBP-002). */
export const DEFAULT_TOOL_NAME = "Libs";

/**
 * The engine's `DBUpdateConfig`: three plain properties with no validation of their own (DBP-002). The run checks the two paths
 * when it starts (DBP-003).
 *
 * @spec DBP-002
 */
export class DBUpdateConfig {
  /** The manifest that lists the patches (DBP-020). */
  dbUpdatedManifestFilePath: string | null = null;
  /** The folder that holds one `<name>.xml` file per patch (DBP-040). */
  dbPatchesFolderPath: string | null = null;
  /** Stored as the `description` of a newly created "Applied Updates" `DatabaseUpgrade` row (DBP-030). */
  toolName: string | null = DEFAULT_TOOL_NAME;
}

/**
 * One `updates/update` entry of the manifest: the engine's `UpdateNode` (DBP-022). Only `order` has a default, `-1`; the other
 * strings are null when the manifest has no such child.
 *
 * @spec DBP-022
 */
export class UpdateNode {
  upNumber: string | null = null;
  name: string | null = null;
  order = -1;
  generation: string | null = null;
  /** Read and never used, as in the engine; `00` when the entry has none. */
  softwareVersion = "00";
}

/** The text of the first child element called `name` (matched exactly), or null when there is none. */
function childText(element: XmlElement, name: string): string | null {
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === ELEMENT_NODE && child.nodeName === name) return innerText(child);
  }
  return null;
}

/**
 * Every `update` whose parent is an `updates`, at any depth, in document order. A missing child gives null (`order` -1, and `00`
 * for `software_version`). `order` is parsed with `int.Parse`, so white space and a sign are accepted and anything else is a
 * `FormatException` or `OverflowException`, raised before the run has applied anything.
 *
 * @spec DBP-022
 */
export function readUpdateNodes(manifest: XmlDocument): UpdateNode[] {
  return selectNodes("//updates/update", manifest).map((node) => {
    const element = node as XmlElement;
    const update = new UpdateNode();
    update.upNumber = childText(element, "up_number");
    update.name = childText(element, "name");
    const order = childText(element, "order");
    update.order = order === null ? -1 : parseInt32(order);
    update.generation = childText(element, "generation");
    update.softwareVersion = childText(element, "software_version") ?? "00";
    return update;
  });
}

/** The entries in the order the run applies them: ascending `order`, and manifest order among equal ones (LINQ's `OrderBy` is stable). */
export function inRunOrder(updates: readonly UpdateNode[]): UpdateNode[] {
  return updates.map((update, index) => ({ update, index })).sort((a, b) => a.update.order - b.update.order || a.index - b.index).map(({ update }) => update);
}

/**
 * The release a manifest upgrades to: the inner text of the first `software_version` element anywhere in the document, or `00`
 * when there is none, as its first two characters, a `.` and the rest (`3501` is `35.01`, a missing element is `00.`). A text of
 * fewer than two characters is the `ArgumentOutOfRangeException` of `Substring(0, 2)` (bug DBP-091).
 *
 * @spec DBP-021 DBP-091
 */
export function targetRelease(manifest: XmlDocument): string {
  const element = selectSingleNode("//software_version", manifest);
  const version = element === null ? "00" : innerText(element);
  if (version.length < 2) {
    throw new DotNetException("System.ArgumentOutOfRangeException", "Index and length must refer to a location within the string.\r\nParameter name: length");
  }
  return `${version.slice(0, 2)}.${version.slice(2)}`;
}
