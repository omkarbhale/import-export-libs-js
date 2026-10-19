import type { XmlDocument } from "../xml/dom.js";
import { selectNodes } from "../xml/xpath.js";

/**
 * The languages an import leaves out of a package (IMP-630): the codes the package's files use that no entry of the selection equals,
 * each once, in the order the scan listed them. The comparison is exact (IMP-614). A null or empty selection leaves nothing out
 * (IMP-635).
 *
 * @spec IMP-630 IMP-635
 */
export function languagesToSkip(used: readonly string[], selection: readonly string[] | null): string[] {
  if (selection === null || selection.length === 0) return [];
  const selected = new Set(selection);
  return [...new Set(used)].filter((code) => !selected.has(code));
}

/**
 * The deletion at the end of `CheckWorkItem` (IMP-631): for each skipped code, in order, every node of the item document whose
 * `xml:lang` is that code is removed from its parent. `//` starts at the document, so it covers the whole item, at any depth, and
 * the `Item` element itself when it carries the attribute (IMP-634). The code goes into the XPath text unescaped, so an apostrophe
 * in it makes the expression invalid and the `XPathException` leaves (IMP-633).
 *
 * @spec IMP-631 IMP-633 IMP-634
 */
export function removeSkippedLanguageNodes(item: XmlDocument, skipped: readonly string[]): void {
  for (const code of skipped) {
    for (const node of selectNodes(`//node()[@xml:lang='${code}']`, item)) node.parentNode?.removeChild(node);
  }
}
