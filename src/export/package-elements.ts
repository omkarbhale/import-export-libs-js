import { ArgumentNullException } from "../io/errors.js";
import { innerText, selectNodes, selectSingleNode } from "../xml/index.js";
import type { XmlDocument, XmlElement } from "../xml/index.js";
import type { PackageElementMap } from "./rewrites.js";

/**
 * `GetPackageElementIdsByElementTypeMap(dom)`, which 14.35's `ExportSolutions` runs right after the package definitions are read
 * (EXP-550): for every `PackageElement` anywhere in the document, in document order, the text of its first `element_id` child goes
 * into the set of the text of its first `element_type` child. The keys and ids are compared exactly, untrimmed and case-sensitive;
 * duplicates collapse; a missing `element_id` adds a null. A missing `element_type` is a null key, and `Dictionary.ContainsKey(null)`
 * throws `ArgumentNullException` (parameter `key`). A null document throws it for `dom`. The map covers every package definition of
 * the database, not only the exported packages, and EXP-170 reads it.
 *
 * @spec EXP-550
 */
export function packageElementIdsByElementType(dom: XmlDocument | null): PackageElementMap {
  if (dom === null) throw new ArgumentNullException("dom");
  const map: PackageElementMap = new Map();
  for (const node of selectNodes("//Item[@type='PackageElement']", dom)) {
    const element = node as XmlElement;
    const type = selectSingleNode("element_type", element);
    if (type === null) throw new ArgumentNullException("key");
    const key = innerText(type);
    let ids = map.get(key);
    if (ids === undefined) {
      ids = new Set();
      map.set(key, ids);
    }
    const id = selectSingleNode("element_id", element);
    ids.add(id === null ? null : innerText(id));
  }
  return map;
}
