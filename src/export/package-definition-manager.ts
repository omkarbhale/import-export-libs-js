import { descendantsNamed, childText, resultItems } from "../client/answer.js";
import { isNullOrWhiteSpace, nullReference } from "../client/dotnet.js";
import { CItemException, type ResponseDocument, stackText } from "../client/fault.js";
import type { CItemHelper } from "../client/item-helper.js";
import { attributeOf } from "../client/mini-xml.js";
import { ImportHelper } from "../import/import-helper.js";
import type { NetfxHashtable } from "../manifest/netfx-hashtable.js";
import { setInnerText } from "../xml/dom.js";
import type { XmlElement } from "../xml/dom.js";
import { loadXml } from "../xml/parser.js";
import { selectSingleNode } from "../xml/xpath.js";
import { outerXml } from "../xml/writer-legacy.js";
import { ExportItem } from "./export-item.js";
import { getMessage } from "./messages.js";

/**
 * The engine's `PackageDefinitionManager`. Export looks up the current definition of a package (`doCreate` is false, so a
 * package that does not exist is an error and nothing is added) and finds the elements a package's dependency references;
 * neither answer is cached. Import creates the definition when it is missing, records the package's dependencies and
 * referenced elements, and registers each imported item as an element of a group of the package (`IMP-440` to `IMP-445`).
 *
 * @spec EXP-052 EXP-053 IMP-440 IMP-441 IMP-442 IMP-443 IMP-444 IMP-445
 */
export class PackageDefinitionManager {
  private readonly importHelper: ImportHelper;

  private constructor(
    private readonly helper: CItemHelper,
    readonly name: string,
    /** The id of the package definition. */
    readonly id: string,
  ) {
    this.importHelper = new ImportHelper(helper);
  }

  /**
   * The constructor's `InitSolution(doCreate)`. With `create`, a definition that does not exist (faultcode 0) is added and the
   * id is read from the answer of the `add`. Every `CItemException` that leaves has ` Fails to init solution to
   * PackageDefinition: {name}` added to its detail, and any other exception becomes one with faultcode -1.
   *
   * @spec EXP-052 EXP-055 IMP-440
   */
  static async open(helper: CItemHelper, name: string, create = false): Promise<PackageDefinitionManager> {
    const failed = getMessage("FailsToInitSolutionToPackageDefinitionPackageName", name);
    try {
      let response: ResponseDocument;
      try {
        response = await helper.applyAML(
          `<Item type='PackageDefinition' select='id,name,generation' action='get'><name>${name}</name><is_current>1</is_current></Item>`,
        );
      } catch (error) {
        if (!(error instanceof CItemException && error.faultcode === 0 && create)) throw error;
        response = await helper.applyAML(`<Item type='PackageDefinition' action='add'><name>${name}</name></Item>`);
      }
      const id = descendantsNamed(response.document.root, "Item")
        .filter((item) => attributeOf(item, "type") === "PackageDefinition")
        .map((item) => childText(item, "id"))
        .find((text) => text !== undefined);
      if (id === undefined) throw nullReference();
      return new PackageDefinitionManager(helper, name, id);
    } catch (error) {
      if (error instanceof CItemException) {
        error.faultdetail = (error.faultdetail ?? "") + failed;
        throw error;
      }
      throw new CItemException(-1, stackText(error), (error as Error).message + failed, error);
    }
  }

  /**
   * `FindReferencedElements`: the `PackageReferencedElement`s of the dependency `packageName` of this package, as items
   * to export. "No items" is an empty list; any other failure has ` Failed to find referenced elements for package
   * '{name}'` added to its detail (this manager's package, not `packageName`).
   *
   * @spec EXP-053 EXP-055
   */
  async findReferencedElements(packageName: string): Promise<ExportItem[]> {
    const failed = `Failed to find referenced elements for package '${this.name}'`;
    try {
      const response = await this.helper.applyAML(
        `<Item type='PackageDependsOn' levels='1' configPath='.|PackageReferencedElement' select='id|element_id,element_type,element_description' action='get'>` +
          `<name>${packageName}</name><source_id>${this.id}</source_id></Item>`,
      );
      return descendantsNamed(response.document.root, "Item")
        .filter((item) => attributeOf(item, "type") === "PackageReferencedElement")
        .map((element) => {
          const idName = childText(element, "element_id");
          if (idName === undefined || isNullOrWhiteSpace(idName)) throw missing("element_id");
          const typeName = childText(element, "element_type");
          if (typeName === undefined || isNullOrWhiteSpace(typeName)) throw missing("element_type");
          const description = childText(element, "element_description");
          return new ExportItem(description === undefined || isNullOrWhiteSpace(description) ? "" : description, idName, typeName);
        });
    } catch (error) {
      if (error instanceof CItemException) {
        if (error.faultcode === 0) return [];
        error.faultdetail = `${error.faultdetail ?? ""} ${failed}`;
        throw error;
      }
      const message = `${(error as Error).message}; ${failed}`;
      throw new CItemException(-1, stackText(error), message);
    }
  }
  /**
   * `AddDependencyInfo`: for each dependency of the table, in its enumeration order, the dependency's row is found or added,
   * and its referenced elements are recorded when it has any. The warnings of the elements are collected in `warnings`
   * (IMP-441).
   *
   * @spec IMP-441
   */
  async addDependencyInfo(dependencies: NetfxHashtable<ExportItem[] | null>, warnings: string[]): Promise<void> {
    for (const [key, elements] of dependencies.entries()) {
      const dependencyId = await this.addDependsOn(key);
      if (elements !== null && elements.length > 0) await this.addReferencedElements(dependencyId, elements, warnings);
    }
  }

  /**
   * `AddDependsOn`: the id of the `PackageDependsOn` row of a dependency, added when it does not exist. A failed lookup with a
   * faultcode other than 0 is swallowed and gives the empty id (IMP-442).
   *
   * @spec IMP-442
   */
  private async addDependsOn(packageName: string): Promise<string> {
    let response: ResponseDocument | null = null;
    try {
      response = await this.helper.applyAML(
        `<Item type='PackageDependsOn' select='id' action='get'><name>${packageName}</name><source_id>${this.id}</source_id></Item>`,
      );
    } catch (error) {
      if (!(error instanceof CItemException)) throw error;
      if (error.faultcode === 0) {
        response = await this.helper.applyAML(
          `<Item type='PackageDependsOn' action='add' doGetItem='0'><name>${packageName}</name><source_id>${this.id}</source_id></Item>`,
        );
      }
    }
    if (response === null) return "";
    const row = descendantsNamed(response.document.root, "Item").find((item) => attributeOf(item, "type") === "PackageDependsOn");
    const id = row === undefined ? undefined : attributeOf(row, "id");
    if (id === undefined) throw nullReference();
    return id;
  }

  /**
   * `AddReferencedElements`: each element whose item exists in the database is recorded under the dependency's row unless it is
   * found. The lookup is by the item's id, which never matches a row (bug IMP-444). An element whose item does not exist adds a
   * warning (IMP-443).
   *
   * @spec IMP-443 IMP-444
   */
  private async addReferencedElements(dependencyId: string, elements: readonly ExportItem[], warnings: string[]): Promise<void> {
    for (const element of elements) {
      const id = element.idName ?? "";
      const type = element.typeName ?? "";
      if (!(await this.importHelper.lookups.itemExistById(id, type))) {
        warnings.push(
          getMessage(
            "ItemOfTypeWithIdIsNotAddedAsAReferencedElementForPackageBecauseTheItemWasNotFoundInTheTargetDatabase",
            type,
            id,
            this.name,
          ),
        );
        continue;
      }
      try {
        await this.helper.applyAML(`<Item type='PackageReferencedElement' action='get' select='id'><id>${id}</id></Item>`);
      } catch (error) {
        if (!(error instanceof CItemException) || error.faultcode !== 0) throw error;
        await this.helper.applyAML(
          `<Item type='PackageReferencedElement' action='add' doGetItem='0'><element_id>${id}</element_id><element_type>${type}</element_type>` +
            `<element_description>${element.keyedName ?? ""}</element_description><source_id>${dependencyId}</source_id></Item>`,
        );
      }
    }
  }

  /**
   * `AddElement2Group`: registers an item as an element of the group named `packageGroupName`. The lookup of the element is
   * not limited to this package, so an element that is in another group or of another type fails with `Duplicate package
   * element`; an element found in this group is not added again and the result is false. The add is built through the DOM, so
   * its values are escaped (IMP-445).
   *
   * @spec IMP-445
   */
  async addElement2Group(keyedName: string | null, type: string, packageGroupName: string | null, id: string): Promise<boolean> {
    const groupId = await this.importHelper.getPackageGroupIdOrCreateIfNotExists(this.id, packageGroupName);
    try {
      const response = await this.helper.applyAML(
        `<Item type='PackageElement' select='id, source_id, element_type' action='get'><element_id>${id}</element_id></Item>`,
      );
      const item = resultItems(response)[0];
      const sourceId = item === undefined ? undefined : childText(item, "source_id");
      const elementType = item === undefined ? undefined : childText(item, "element_type");
      if (sourceId === undefined || elementType === undefined) throw nullReference();
      if (sourceId !== groupId || elementType !== type) {
        const message = getMessage(
          "ThePackageAlreadyContainsThePackageElementWithNameAndIdButOfDifferentTypeDBTypeGroupIdBeingImportedTypeGroupId",
          this.name,
          keyedName,
          id,
          elementType,
          sourceId,
          type,
          groupId,
        );
        throw new CItemException(-2, "Duplicate package element", message, null);
      }
      return false;
    } catch (error) {
      if (!(error instanceof CItemException) || error.faultcode !== 0) throw error;
    }
    const document = loadXml("<Item type='PackageElement' action='add' doGetItem='0'><source_id /><element_id /><element_type /><name /></Item>", {
      preserveWhitespace: false,
    });
    const element = selectSingleNode("/Item[@type='PackageElement']", document) as XmlElement;
    const set = (name: string, value: string): void => setInnerText(selectSingleNode(name, element) as XmlElement, value);
    set("source_id", groupId);
    set("element_id", id);
    set("element_type", type);
    set("name", keyedName ?? "");
    await this.helper.applyAML(outerXml(document));
    return true;
  }

}

function missing(property: string): CItemException {
  const message = `Referenced element doesn't have '${property}' set`;
  return new CItemException(-1, "", message);
}
