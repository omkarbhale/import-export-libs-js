import { descendantsNamed, childText } from "../client/answer.js";
import { isNullOrWhiteSpace, nullReference } from "../client/dotnet.js";
import { CItemException, stackText } from "../client/fault.js";
import type { CItemHelper } from "../client/item-helper.js";
import { attributeOf } from "../client/mini-xml.js";
import { ExportItem } from "./export-item.js";

/**
 * The export side of the engine's `PackageDefinitionManager`: it looks up the current definition of a package
 * (`doCreate` is false on export, so a package that does not exist is an error and nothing is added), and finds the
 * elements a package's dependency references. Neither answer is cached.
 *
 * @spec EXP-052 EXP-053
 */
export class PackageDefinitionManager {
  private constructor(
    private readonly helper: CItemHelper,
    readonly name: string,
    /** The id of the package definition. */
    readonly id: string,
  ) {}

  /**
   * The constructor's `InitSolution`. Every `CItemException` that leaves has ` Fails to init solution to
   * PackageDefinition: {name}` added to its detail, and any other exception becomes one with faultcode -1.
   *
   * @spec EXP-052 EXP-055
   */
  static async open(helper: CItemHelper, name: string): Promise<PackageDefinitionManager> {
    const failed = ` Fails to init solution to PackageDefinition: ${name}`;
    try {
      const response = await helper.applyAML(
        `<Item type='PackageDefinition' select='id,name,generation' action='get'><name>${name}</name><is_current>1</is_current></Item>`,
      );
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
      throw new CItemException(-1, stackText(error), (error as Error).message + failed);
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
}

function missing(property: string): CItemException {
  const message = `Referenced element doesn't have '${property}' set`;
  return new CItemException(-1, "", message);
}
