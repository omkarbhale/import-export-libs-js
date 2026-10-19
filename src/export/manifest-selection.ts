import { ExportItem } from "./export-item.js";
import type { SelectionTable } from "./import-export-manager.js";
import type { Engine } from "../engines.js";
import { fileExists, normalizeLongPath, pathEnvironmentFor } from "../io/host-path.js";
import type { PathEnvironment } from "../io/host-path.js";
import { NullReferenceException } from "../io/errors.js";
import { NetfxHashtable } from "../manifest/index.js";
import { innerText, selectNodes, selectSingleNode, xmlDocumentLoad, xmlDocumentLoadFile } from "../xml/index.js";
import type { XmlDocument, XmlElement } from "../xml/index.js";

/**
 * The table of packages to items that `GenerateHashtableFromManifest` returns, and that the console tool's all-packages loop
 * builds in the same way from the same document (spec/export-modes.md, EXP-700 to EXP-799 and HOST-121). Names go into the XPath
 * unescaped, as the engine writes them.
 */

/**
 * `IOWrapper.FileExists(path)` (`File.Exists(path)` in 12.0). 14.0.7 and 14.35 take the path through `NormalizeLongPath` first,
 * which throws for a path .NET cannot name, so `|` in the path is an `ArgumentException` there; 12.0's `File.Exists` answers
 * false. The normalisation is the Windows host's: elsewhere the path is used as given (MAN-033).
 *
 * @spec EXP-701
 */
export function manifestFileExists(path: string | null, engine: Engine, environment: PathEnvironment): boolean {
  const env = pathEnvironmentFor(environment, engine);
  if (engine !== "12.0" && (env.platform ?? process.platform) === "win32") normalizeLongPath(path, env);
  return fileExists(path, env);
}

/**
 * The manifest as the engine reads it: `IOWrapper.XmlDocumentLoad` (`File.ReadAllText` and `LoadXml` after the path rules) in
 * 14.0.7 and 14.35, `XmlDocument.Load(path)` on the path as given in 12.0 (MAN-003).
 *
 * @spec EXP-701
 */
export function loadManifestDocument(path: string, engine: Engine, environment: PathEnvironment): XmlDocument {
  const env = pathEnvironmentFor(environment, engine);
  return engine === "12.0" ? xmlDocumentLoadFile(path, env) : xmlDocumentLoad(path, env);
}

/** `//package[@name='{name}']` on the manifest, with the name as it is: an apostrophe in it is an XPath syntax error. */
export function manifestSelects(manifest: XmlDocument): (packageName: string) => boolean {
  return (packageName) => selectSingleNode(`//package[@name='${packageName}']`, manifest) !== null;
}

/**
 * Walks the `PackageDefinition` names of the database document in document order and adds each to the outer table with the
 * elements of its definition, or with an empty table when `selected` says no. The outer key is added after its inner table is
 * complete, so a repeated package name fails after the second definition's elements were read. Every failure leaves nothing:
 * the table is built in the call and handed out only when whole.
 *
 * @spec EXP-702 EXP-703 EXP-704 HOST-121
 */
export function packageTableFromSolutions(solutions: XmlDocument | null, selected: (packageName: string) => boolean): SelectionTable {
  if (solutions === null) throw new NullReferenceException();
  const table: SelectionTable = new NetfxHashtable("the selected packages");
  for (const nameNode of selectNodes("//Item[@type='PackageDefinition']/name", solutions)) {
    const packageName = innerText(nameNode);
    const inner = new NetfxHashtable<ExportItem>(`the selected items of package ${JSON.stringify(packageName)}`);
    if (selected(packageName)) {
      const elements = selectNodes(
        `.//Item[@type='PackageDefinition' and name='${packageName}']/Relationships/Item[@type='PackageGroup']/Relationships/Item[@type='PackageElement']`,
        solutions,
      );
      for (const element of elements) {
        const childText = (child: string): string => {
          const node = selectSingleNode(child, element as XmlElement);
          if (node === null) throw new NullReferenceException();
          return innerText(node);
        };
        const id = childText("element_id");
        const name = childText("name");
        const type = childText("element_type");
        inner.add(id, new ExportItem(name, id, type));
      }
    }
    table.add(packageName, inner);
  }
  return table;
}
