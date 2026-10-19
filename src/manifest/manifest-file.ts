import { EngineNotSupportedError } from "../client/item-helper.js";
import { DEFAULT_ENGINE, type Engine } from "../engines.js";
import { RECURSION_LIMIT, StackOverflowException } from "../recursion-limit.js";
import { ExportItem } from "../export/export-item.js";
import { formatMessage, isNullOrWhiteSpace } from "../io/dotnet-text.js";
import type { PathEnvironment } from "../io/host-path.js";
import { ArgumentException, ArgumentNullException, NullReferenceException } from "../io/errors.js";
import {
  appendChild,
  createElement,
  documentElementOf,
  loadXml,
  selectNodes,
  selectSingleNode,
  xmlDocumentLoad,
  xmlDocumentSave,
} from "../xml/index.js";
import type { XmlDocument, XmlElement } from "../xml/index.js";
import { DuplicateKeyError, NetfxHashtable } from "./netfx-hashtable.js";
import { isStandardPackage } from "./package-path.js";

/**
 * The engines whose manifest behaviour is implemented; the rest wait for their variant slices. The manifest rules have no 14.35
 * variant but `GetPackagePath` (MAN-030, the import's package folder), so 14.35 shares the code of 14.0.7; the import slice of 14.35 adds
 * that one.
 */
export const MANIFEST_ENGINES: readonly Engine[] = ["14.0.7", "14.35"];

export interface ManifestOptions extends PathEnvironment {
  engine?: Engine;
}

/** The two warnings of the ordering, in the engine's message table (MAN-023). */
const CIRCULAR_DEPENDENCY = "There is a circular dependency on package '{0}'";
const MISSING_DEPENDENCY =
  "One of imported packages depends on the package '{0}' that neither imported in this session nor exists in the database";

/** `MoveToOrderedList` recurses without bound on some cycles; the port stops at this nesting depth instead (MAN-025). */
export const MOVE_TO_ORDERED_LIST_MAX_DEPTH = RECURSION_LIMIT;

export { StackOverflowException };

function requireName(name: string | null): void {
  if (isNullOrWhiteSpace(name)) {
    throw new ArgumentException("Name of 'dependson' package can't be 'null' or empty");
  }
}

/** The name attribute of an element, as `Attributes["name"].Value` reads it: a missing one is a null reference. */
function requiredName(element: XmlElement): string {
  const attribute = element.getAttributeNode("name");
  if (!attribute) throw new NullReferenceException();
  return attribute.value;
}

/**
 * The engine's `ManifestFile`: `imports.mf`, the XML document that export writes and import reads (MAN-001). Names go
 * into XPath unescaped (MAN-014), so the lookups evaluate the expression the engine would.
 *
 * @spec MAN-001 MAN-002 MAN-003 MAN-006 MAN-010 MAN-011 MAN-012 MAN-013 MAN-014 MAN-015 MAN-016 MAN-020 MAN-021 MAN-022
 * @spec MAN-023 MAN-024 MAN-025
 */
export class ManifestFile {
  /** The document. A new manifest is `<imports/>` without declaration, and white space is not preserved. */
  readonly document: XmlDocument;
  private readonly options: ManifestOptions;

  /**
   * `new ManifestFile()` when no path is given: an empty `imports` document (MAN-002). `new ManifestFile(path)` reads the
   * file with `File.ReadAllText` and `LoadXml` after the path rules (MAN-003); a null or empty path fails as .NET does.
   */
  constructor(path?: string | null, options: ManifestOptions = {}) {
    const engine = options.engine ?? DEFAULT_ENGINE;
    if (!MANIFEST_ENGINES.includes(engine)) throw new EngineNotSupportedError(engine);
    this.options = options;
    this.document = path === undefined ? loadXml("<imports/>", { preserveWhitespace: false }) : xmlDocumentLoad(path, options);
  }

  /**
   * `Save(path)`: `XmlDocument.Save` after the path rules (MAN-004, MAN-006).
   */
  save(path: string | null): void {
    xmlDocumentSave(this.document, path, this.options);
  }

  /**
   * `AddPackage(name)`: the `package` element of that name, created with its derived path (MAN-010) when the manifest has
   * none. A null name fails with a null reference after the lookup, as in the engine.
   */
  addPackage(name: string | null): XmlElement {
    const existing = selectSingleNode(`imports/package[@name='${name ?? ""}']`, this.document);
    if (existing) return existing as XmlElement;
    if (name === null) throw new NullReferenceException();
    const path = isStandardPackage(name) ? ".\\" : `${/([^.]+)$/.exec(name)?.[1] ?? ""}\\Import`;
    const element = createElement(this.document, "package");
    element.setAttribute("name", name);
    element.setAttribute("path", path);
    appendChild(documentElementOf(this.document) as XmlElement, element);
    return element;
  }

  /** `AddDependsOn(packageNode, name)`: the `dependson` element of that name below the package, created when missing. */
  addDependsOn(packageNode: XmlElement | null, name: string | null): XmlElement {
    if (packageNode === null) throw new ArgumentNullException("packageNode");
    requireName(name);
    const existing = selectSingleNode(`dependson[@name='${name}']`, packageNode);
    if (existing) return existing as XmlElement;
    const element = createElement(this.document, "dependson");
    element.setAttribute("name", name as string);
    appendChild(packageNode, element);
    return element;
  }

  /** `AddReferencedElement(dependsOnNode, item)`: the `referenced_element` of the item's id, created when missing. */
  addReferencedElement(dependsOnNode: XmlElement | null, item: ExportItem | null): XmlElement {
    if (dependsOnNode === null) throw new ArgumentNullException("dependsOnNode");
    if (item === null) throw new ArgumentNullException("referencedElement");
    const existing = selectSingleNode(`referenced_element[@id='${item.idName ?? ""}']`, dependsOnNode);
    if (existing) return existing as XmlElement;
    const element = createElement(this.document, "referenced_element");
    element.setAttribute("id", item.idName ?? "");
    element.setAttribute("type", item.typeName ?? "");
    element.setAttribute("descr", item.keyedName ?? "");
    appendChild(dependsOnNode, element);
    return element;
  }

  /** `GetPackageNode(name)`: the first `package` element of that name, or null; a null or blank name gives null. */
  getPackageNode(name: string | null): XmlElement | null {
    if (isNullOrWhiteSpace(name)) return null;
    return selectSingleNode(`imports/package[@name='${name}']`, this.document) as XmlElement | null;
  }

  /** `GetAllPackageNames()`: the `name` of every `package`, in document order, duplicates included. */
  getAllPackageNames(): string[] {
    return selectNodes("imports/package", this.document).map((node) => requiredName(node as XmlElement));
  }

  /** `GetDependsOn(packageNode, name)`: the first `dependson` element of that name below the package, or null. */
  getDependsOn(packageNode: XmlElement | null, name: string | null): XmlElement | null {
    if (packageNode === null) throw new ArgumentNullException("packageNode");
    requireName(name);
    return selectSingleNode(`dependson[@name='${name}']`, packageNode) as XmlElement | null;
  }

  /** `GetAllDependsOnNames(packageNode)`: the `name` of every direct `dependson` child, in document order. */
  getAllDependsOnNames(packageNode: XmlElement | null): string[] {
    if (packageNode === null) throw new ArgumentNullException("packageNode");
    return selectNodes("dependson", packageNode).map((node) => requiredName(node as XmlElement));
  }

  /** `GetPackageDependencies(name)`: the dependency names of the package, `""` for a `dependson` without a name. */
  getPackageDependencies(name: string | null): string[] {
    const node = this.getPackageNode(name);
    if (node === null) return [];
    return selectNodes("dependson", node).map((dependency) => (dependency as XmlElement).getAttribute("name") || "");
  }

  /** `GetReferencedElements(dependsOnNode)`: one item per direct `referenced_element` child, in document order. */
  getReferencedElements(dependsOnNode: XmlElement | null): ExportItem[] {
    if (dependsOnNode === null) throw new ArgumentNullException("dependsOnNode");
    return selectNodes("referenced_element", dependsOnNode).map((node) => {
      const element = node as XmlElement;
      return new ExportItem(
        element.getAttribute("descr") || "",
        element.getAttribute("id") || "",
        element.getAttribute("type") || "",
      );
    });
  }

  /**
   * `GetDependsOnInfo(packageName)`: a table of each dependency name to its referenced elements, built with one `Add` per
   * `dependson` child in document order, which fixes its enumeration order (MAN-016, MAN-017).
   */
  getDependsOnInfo(packageName: string | null): NetfxHashtable<ExportItem[]> {
    const table = new NetfxHashtable<ExportItem[]>(`the dependency table of package ${JSON.stringify(packageName)}`);
    const packageNode = this.getPackageNode(packageName);
    if (packageNode === null) return table;
    for (const name of this.getAllDependsOnNames(packageNode)) {
      table.add(name, this.getReferencedElements(this.getDependsOn(packageNode, name)));
    }
    return table;
  }

  /**
   * `GetPackageNamesInImportOrder(importedPackages, databasePackages, warnings)`: the names in the order import
   * processes them, dependencies first. Pass 1 takes the packages whose dependencies are already placed, pass 2 places the
   * rest by depth-first search; warnings are appended to `warnings`.
   */
  getPackageNamesInImportOrder(
    importedPackages: readonly (string | null)[] | null,
    databasePackages: XmlDocument | null,
    warnings: string[] | null,
  ): string[] {
    if (importedPackages === null) throw new NullReferenceException();
    const pending = new Map<string, string>();
    for (const name of importedPackages) {
      if (name === null) throw new ArgumentNullException("key", "Key cannot be null.");
      if (pending.has(name)) throw new DuplicateKeyError(name);
      pending.set(name, name);
    }

    const order = new PackageOrdering(this, pending, databasePackages, warnings);
    for (const name of pending.keys()) {
      const dependencies = this.getPackageDependencies(name);
      if (dependencies.length === 0 || dependencies.every((dependency) => order.placed.has(dependency))) order.place(name);
    }
    for (const name of order.result) pending.delete(name);
    for (const name of [...pending.keys()]) {
      if (order.placed.has(name)) continue;
      for (const dependency of order.dependencyNames(name)) order.moveToOrderedList(name, dependency);
      order.place(name);
    }
    return order.result;
  }
}

/**
 * The state of one `GetPackageNamesInImportOrder` call, and its `MoveToOrderedList`. The search is iterative so that the
 * nesting bound of MAN-025 can be 100,000; the manifest does not change meanwhile, so the dependency lists are read once.
 */
export class PackageOrdering {
  readonly result: string[] = [];
  readonly placed = new Set<string>();
  private readonly dependencies = new Map<string, string[]>();

  constructor(
    private readonly manifest: ManifestFile,
    private readonly pending: Map<string, string>,
    private readonly databasePackages: XmlDocument | null,
    private readonly warnings: string[] | null,
  ) {}

  place(name: string): void {
    this.result.push(name);
    this.placed.add(name);
  }

  /** The `name` of each `dependson` child of the package's node, in document order. */
  dependencyNames(name: string): string[] {
    let names = this.dependencies.get(name);
    if (!names) {
      names = this.manifest.getAllDependsOnNames(this.manifest.getPackageNode(name));
      this.dependencies.set(name, names);
    }
    return names;
  }

  private warn(template: string, name: string): void {
    if (this.warnings === null) throw new NullReferenceException();
    this.warnings.push(formatMessage(template, name));
  }

  /** The package-existence test against the database document (MAN-023). */
  private existsInDatabase(name: string): boolean {
    if (this.databasePackages === null) throw new NullReferenceException();
    return selectSingleNode(`//Item[@type='PackageDefinition' and name='${name}']`, this.databasePackages) !== null;
  }

  /**
   * `MoveToOrderedList(start, pkg)`: places the pending dependencies of `pkg` before `pkg`, warns about the starting
   * package and about dependencies that are neither imported nor in the database.
   * @spec MAN-022 MAN-023 MAN-025
   */
  moveToOrderedList(start: string, pkg: string): void {
    const stack: { name: string; dependencies: string[] | null; next: number }[] = [{ name: pkg, dependencies: null, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as (typeof stack)[number];
      if (frame.dependencies === null) {
        if (stack.length >= MOVE_TO_ORDERED_LIST_MAX_DEPTH) throw new StackOverflowException();
        if (this.placed.has(frame.name)) {
          stack.pop();
          continue;
        }
        if (frame.name === start) {
          this.warn(CIRCULAR_DEPENDENCY, frame.name);
          stack.pop();
          continue;
        }
        if (!this.pending.has(frame.name)) {
          if (!this.existsInDatabase(frame.name)) this.warn(MISSING_DEPENDENCY, frame.name);
          stack.pop();
          continue;
        }
        frame.dependencies = this.dependencyNames(frame.name);
      }
      if (frame.next < frame.dependencies.length) {
        stack.push({ name: frame.dependencies[frame.next] as string, dependencies: null, next: 0 });
        frame.next += 1;
        continue;
      }
      this.place(frame.name);
      stack.pop();
    }
  }
}
