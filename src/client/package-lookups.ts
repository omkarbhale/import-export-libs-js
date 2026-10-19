import { isCorePackage } from "../manifest/package-path.js";
import { nullReference } from "./dotnet.js";
import { CItemException, type ResponseDocument } from "./fault.js";
import { type XmlElement, childElements, descendantElements, innerText, localName } from "./mini-xml.js";

/** What the package lookups need of the helper that owns them. */
export interface PackageLookupHost {
  /** `CItemHelper.applyAML` (WIRE-006): throws a `CItemException` for any fault, faultcode 0 included. */
  applyAML(aml: string): Promise<ResponseDocument>;
}

/**
 * The caches of the unknown-package removal, which the engine keeps in static fields of `CItemHelper` (EXP-609). The static
 * constructor creates them; every constructor of the helper empties all but the dependency table, which no constructor
 * touches (EXP-619). They are shared by every helper of the process, so they sit at module level.
 *
 * @spec EXP-609 EXP-619
 */
export const packageCaches = {
  /** `m_pkgIDs`: the element ids of a package, by package name. */
  elementIds: new Map<string, ReadonlySet<string>>(),
  /** `_mNonCorePackageNames`: undefined until the first need, and then never undefined again, even after a failure (EXP-620). */
  nonCoreNames: undefined as string[] | undefined,
  /** `_relationshipTypeIDs`: the id of a RelationshipType, by name. */
  relationshipTypeIds: new Map<string, string>(),
  /** `MDependsOnPackages`: the dependency names of a package, by package name. Never emptied: this is the bug of EXP-619. */
  dependsOn: new Map<string, readonly string[]>(),
};

/**
 * What a `CItemHelper` constructor does to the caches: it empties the element ids, the non-core name list and the relationship type
 * ids, and leaves the dependency table as it is.
 *
 * @spec EXP-609 EXP-619
 */
export function resetPackageCaches(): void {
  packageCaches.elementIds = new Map();
  packageCaches.nonCoreNames = undefined;
  packageCaches.relationshipTypeIds = new Map();
}

/** `.//*[local-name(.)='Result']/` followed by the child steps: the matches in document order. */
export function resultPath(response: ResponseDocument, steps: readonly string[]): XmlElement[] {
  const root = response.document.root;
  let found = [root, ...descendantElements(root)].filter((element) => localName(element.name) === "Result");
  for (const step of steps) found = found.flatMap((element) => childElements(element, step));
  return found;
}

/**
 * The part of the engine's `CItemHelper` that tells whether an id belongs to an unknown package: the package element ids, the
 * non-core package names, the direct dependencies of a package and the id of a RelationshipType, with their caches
 * (`export-unknown-refs.md`). Every request goes through `applyAML`; names are interpolated as they are, unescaped (EXP-608).
 *
 * @spec EXP-607 EXP-608 EXP-609
 */
export class PackageLookups {
  constructor(private readonly host: PackageLookupHost) {}

  /**
   * `GetPackageElementIDs` and `GetPackageIDsFromServer`: the `element_id` of every element of every group of the package (R1).
   * An answer is cached by name; a failure is not.
   *
   * @spec EXP-607 EXP-608 EXP-609
   */
  async getPackageElementIds(packageName: string): Promise<ReadonlySet<string>> {
    const cached = packageCaches.elementIds.get(packageName);
    if (cached) return cached;
    const response = await this.host.applyAML(
      `<Item type='PackageDefinition' action='get' select='id'><name>${packageName}</name><Relationships>` +
        "<Item type='PackageGroup' action='get' select='id'><Relationships><Item type='PackageElement' action='get' select='element_id'/>" +
        "</Relationships></Item></Relationships></Item>",
    );
    const ids = new Set<string>();
    for (const element of resultPath(response, ["Item", "Relationships", "Item", "Relationships", "Item", "element_id"])) {
      ids.add(innerText(element));
    }
    packageCaches.elementIds.set(packageName, ids);
    return ids;
  }

  /**
   * `getRelationshipTypeID`: the id of the RelationshipType of that name (R2), cached by name. An answer without an id is a
   * `NullReferenceException`.
   *
   * @spec EXP-603 EXP-608 EXP-609
   */
  async getRelationshipTypeId(typeName: string): Promise<string> {
    const cached = packageCaches.relationshipTypeIds.get(typeName);
    if (cached !== undefined) return cached;
    const response = await this.host.applyAML(`<Item type='RelationshipType' action='get' select='id'><name>${typeName}</name></Item>`);
    const id = resultPath(response, ["Item", "id"])[0];
    if (!id) throw nullReference();
    const text = innerText(id);
    packageCaches.relationshipTypeIds.set(typeName, text);
    return text;
  }

  /**
   * `GetNonCorePackageNames`: the names of all the PackageDefinitions that are not core packages, in the server's order (R3). The
   * list exists before the request is sent, so a failed request leaves it empty for every later use (EXP-620).
   *
   * @spec EXP-607 EXP-608 EXP-609 EXP-616 EXP-620
   */
  async getNonCorePackageNames(): Promise<readonly string[]> {
    if (packageCaches.nonCoreNames !== undefined) return packageCaches.nonCoreNames;
    const names: string[] = [];
    packageCaches.nonCoreNames = names;
    const response = await this.host.applyAML("<Item type='PackageDefinition' action='get' select='name'/>");
    for (const element of resultPath(response, ["Item", "name"])) {
      const name = innerText(element);
      if (!isCorePackage(name)) names.push(name);
    }
    return names;
  }

  /**
   * `GetDependsOnPackageNames`: the names of the packages the package directly depends on (R4, then R5), cached by package name
   * for the life of the process (EXP-619). A faultcode 0 on R5 means no dependencies; any other fault throws and caches nothing.
   *
   * @spec EXP-607 EXP-608 EXP-609 EXP-619
   */
  async getDependsOnPackageNames(currentPackage: string): Promise<readonly string[]> {
    const cached = packageCaches.dependsOn.get(currentPackage);
    if (cached) return cached;
    const names: string[] = [];
    const definition = await this.host.applyAML(`<Item type='PackageDefinition' action='get' select='id'><name>${currentPackage}</name></Item>`);
    const idElement = resultPath(definition, ["Item", "id"])[0];
    if (!idElement) throw nullReference();
    let dependencies: ResponseDocument | undefined;
    try {
      dependencies = await this.host.applyAML(
        `<Item type='PackageDependsOn' action='get' select='name'><source_id>${innerText(idElement)}</source_id></Item>`,
      );
    } catch (error) {
      if (!(error instanceof CItemException) || error.faultcode !== 0) throw error;
    }
    if (dependencies) {
      for (const element of resultPath(dependencies, ["Item", "name"])) names.push(innerText(element));
    }
    packageCaches.dependsOn.set(currentPackage, names);
    return names;
  }

  /**
   * `isInNonCorePackages`: whether the id is an element of a package that is not core, not a direct dependency of the package
   * being exported, and not that package. The candidates are fetched in the server's order and the first that holds the id ends
   * the test.
   *
   * @spec EXP-607
   */
  async isInNonCorePackages(id: string, packageName: string): Promise<boolean> {
    const nonCore = await this.getNonCorePackageNames();
    const dependsOn = await this.getDependsOnPackageNames(packageName);
    const candidates = nonCore.filter((name) => !dependsOn.includes(name) && name !== packageName);
    for (const candidate of candidates) {
      if ((await this.getPackageElementIds(candidate)).has(id)) return true;
    }
    return false;
  }
}
