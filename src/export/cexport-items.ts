import type { ResponseDocument } from "../client/fault.js";
import type { XmlDocument } from "../xml/dom.js";
import type { CItemHelper } from "../client/item-helper.js";
import { responseDom } from "../client/answer.js";
import { element } from "../client/request-text.js";
import { ArgumentNullException } from "../io/errors.js";
import type { PathEnvironment } from "../io/host-path.js";
import { guardExport } from "./export-errors.js";
import { type ExportItem, exportFileName } from "./export-item.js";
import { mainFetchRequest, serverMajorOf } from "./main-fetch.js";
import { itemFilePaths, writeItemFile } from "./output-folder.js";
import {
  applyXsl,
  cdataFilterXml,
  removeEmptyRelationships,
  removeNamespaceNodes,
  removePermissionIdWhenItMatchesToDefaultPermission,
  replaceReferencesToPolyLists,
} from "./post-xsl.js";
import { itemTypeBody } from "./request-bodies.js";
import { type RequestDictionary, requestTemplate } from "./request-template.js";
import { ExportRewrites, type PackageElementMap } from "./rewrites.js";

/** What the first three requests of an item's export (EXP-001 rows 1 to 3) found. */
export interface ItemFetch {
  /** The file the item is written to (EXP-002). */
  readonly fileName: string;
  /** 14.35 only: the path `Combine` made of the folder, the type name and the file name, before the first request (EXP-417). */
  readonly path?: string;
  /** Whether the item's type is versionable. */
  readonly versionable: boolean;
  /** The id the main fetch asked for: the current generation's for a versionable type, the requested id otherwise. */
  readonly id: string;
  /** The text of the main fetch, as handed to `applyAML`. */
  readonly request: string;
  /** The server's whole answer to the main fetch, envelope included. */
  readonly response: ResponseDocument;
}

/**
 * What 14.35's `Export` takes besides the item (EXP-002): the dictionary of request templates that `ExportSolutions` makes once per call
 * (EXP-060), and the map of the package elements of the whole database (EXP-550). Both must be given, or `Export` refuses the item
 * with an `ArgumentNullException` before it sends anything. 14.0.7 takes neither.
 */
export interface ExportRunState {
  readonly requestDictionary: RequestDictionary | null;
  readonly packageElementIdsByElementType: PackageElementMap | null;
}

/**
 * Step 5 of EXP-400, the removal of references to unknown packages, which the export run supplies when the host chose a removal
 * mode (`export-unknown-refs.md`). It works on the transformed document, after the poly-list step and before the clean-up.
 */
export type UnknownReferenceRemoval = (doc: XmlDocument) => Promise<void>;

/**
 * The requests of the engine's `CExportItems.Export`, in the order EXP-001 lists them. This class sends the fetches
 * of one item and builds the follow-up requests whose parameters the rewrites read out of the answers; the
 * lookups they trigger are the helper's (`helper.lookups`).
 *
 * @spec EXP-001
 */
export class CExportItems {
  /** Steps 5 to 12 of EXP-100, which {@link CExportItems.rewrite} runs. */
  readonly rewrites: ExportRewrites;

  /**
   * `environment` is the host the item files are written on: its current directory and platform (EXP-420). `run` is 14.35's template
   * dictionary and package-element map (EXP-002); an export made without them is refused on that engine.
   */
  constructor(
    private readonly helper: CItemHelper,
    private readonly environment: PathEnvironment = {},
    private readonly run: ExportRunState = { requestDictionary: null, packageElementIdsByElementType: null },
  ) {
    this.rewrites = new ExportRewrites(helper, this, run.packageElementIdsByElementType);
  }

  /**
   * `Export` for one item, from the first request to the file: the fetches and rewrites of `export-prexsl.md`, then the seven steps
   * of EXP-400 (the transform, the permission, filter, poly-list, unknown-package, namespace and relationship steps, and the
   * write). Steps 1 to 6 run inside the one `try` of EXP-054, so an `XmlException`, a `NullReferenceException` or an
   * `XPathException` leaves as a `CItemException` and no file is written; whatever the write throws is not mapped. The file goes
   * into `helper.folder`. Returns the path it was written to.
   *
   * @spec EXP-400 EXP-417 EXP-418 EXP-419 EXP-423
   */
  async export(item: ExportItem, level: string | null | undefined, removeUnknownReferences?: UnknownReferenceRemoval): Promise<string> {
    const fetched = await this.fetch(item, level);
    const rewritten = await this.rewrite(item, fetched);
    const doc = await guardExport(async () => {
      const lookups = this.helper.lookups;
      const transformed = applyXsl(rewritten, this.helper.engine);
      await removePermissionIdWhenItMatchesToDefaultPermission(transformed, lookups);
      if (item.typeName === "mp_MacPolicy") cdataFilterXml(transformed, "condition_xml", this.helper.engine);
      if (item.typeName === "dr_RelationshipFamily" && this.helper.engine !== "12.0") cdataFilterXml(transformed, "implementation_query");
      await replaceReferencesToPolyLists(transformed, lookups);
      if (removeUnknownReferences) await removeUnknownReferences(transformed);
      removeNamespaceNodes(transformed, this.helper.engine);
      removeEmptyRelationships(transformed);
      return transformed;
    });
    return writeItemFile(this.helper.folder, item.typeName, fetched.fileName, doc, this.environment, this.helper.engine);
  }

  /**
   * 14.35's `Export` takes the template dictionary and the package-element map along, and refuses a null one before anything else
   * (EXP-002). The refusal is not wrapped by EXP-054.
   */
  private checkRun(): { requestDictionary: RequestDictionary } {
    if (this.run.requestDictionary === null) throw new ArgumentNullException("requestDictionary");
    if (this.run.packageElementIdsByElementType === null) throw new ArgumentNullException("packageElementIdsByElementType");
    return { requestDictionary: this.run.requestDictionary };
  }

  /**
   * Steps 5 to 12 of `Export` (EXP-100): the rewrites of the answer to the main fetch, on the answer's DOM, which the
   * transform reads next. They run inside the one `try` of EXP-054, so a failure that is an `XmlException`, a
   * `NullReferenceException` or an `XPathException` leaves as a `CItemException`.
   *
   * @spec EXP-100 EXP-101 EXP-054
   */
  rewrite(item: ExportItem, fetched: ItemFetch): Promise<XmlDocument> {
    return guardExport(async () => {
      const doc = responseDom(fetched.response);
      await this.rewrites.rewrite(doc, item.typeName ?? "", fetched.versionable);
      return doc;
    });
  }

  /**
   * Rows 1 to 3 of EXP-001: the is_versionable lookup, the current-id lookups for a versionable type, and the main
   * fetch, all inside the one `try` of EXP-054. A fault on the main fetch, faultcode 0 included, is the
   * `CItemException` of `applyAML`.
   *
   * @spec EXP-001 EXP-002 EXP-010 EXP-011 EXP-020 EXP-054
   */
  fetch(item: ExportItem, level: string | null | undefined): Promise<ItemFetch> {
    if (this.helper.engine === "14.35") return this.fetchFromTemplate(item, level);
    const fileName = exportFileName(item);
    return guardExport(async () => {
      const lookups = this.helper.lookups;
      const typeName = item.typeName ?? "";
      const idName = item.idName ?? "";
      const versionable = await lookups.isVersionable(typeName);
      const id = versionable ? await lookups.getCurrentIdOfVersion(idName, typeName) : idName;
      const request = mainFetchRequest(typeName, id, level, this.helper.innovatorVersion, this.helper.engine);
      return { fileName, versionable, id, request, response: await this.helper.applyAML(request) };
    });
  }

  /**
   * Rows 0 to 3 of EXP-001 for 14.35. Before the first request the engine refuses a missing argument and joins the folder, the type
   * name and the file name with `Path.Combine`, which refuses a type name or file name with an illegal character (EXP-002, EXP-417);
   * none of that is wrapped (EXP-054). Then, inside the one `try`, the type's template (EXP-060) with its lookups, the is_versionable
   * and current-id lookups, and the main fetch from a copy of the template, whose `<id>` comes last (EXP-020). `levels` is never sent.
   *
   * @spec EXP-001 EXP-002 EXP-010 EXP-011 EXP-020 EXP-054 EXP-060 EXP-417
   */
  private fetchFromTemplate(item: ExportItem, level: string | null | undefined): Promise<ItemFetch> {
    const { requestDictionary } = this.checkRun();
    const fileName = exportFileName(item);
    const path = itemFilePaths(this.helper.folder, item.typeName, fileName).path;
    return guardExport(async () => {
      const lookups = this.helper.lookups;
      const typeName = item.typeName ?? "";
      const idName = item.idName;
      const request = (await requestTemplate(requestDictionary, this.helper, typeName, level)).clone();
      request.setProperty("id", idName);
      const versionable = await lookups.isVersionable(typeName);
      const id = versionable ? await lookups.getCurrentIdOfVersion(idName ?? "", typeName) : (idName ?? "");
      if (versionable) request.setProperty("id", id);
      const text = request.toXml();
      return { fileName, path, versionable, id, request: text, response: await this.helper.applyAML(text) };
    });
  }

  /**
   * Row 4: the query for the generated types of an ItemType, sent as `ApplyAML` after the main fetch when the answer holds an
   * item. An error answer is returned, not thrown, and ends the step without effect.
   *
   * @spec EXP-048
   */
  queryAutoGeneratedRelationships(itemTypeId: string): Promise<ResponseDocument> {
    const tab = "\t";
    return this.helper.inn.applyAML(
      `<AML>${tab}<Item type="cmf_ContentType" action="get" select="id">${tab}${tab}<linked_item_type>${itemTypeId}</linked_item_type>` +
        `${tab}${tab}<Relationships>${tab}${tab}${tab}<Item type="cmf_ElementType" select="generated_type" >` +
        `${tab}${tab}${tab}${tab}<Relationships>${tab}${tab}${tab}${tab}${tab}<Item type="cmf_PropertyType" select="generated_type" />` +
        `${tab}${tab}${tab}${tab}</Relationships>${tab}${tab}${tab}</Item>${tab}${tab}</Relationships>${tab}</Item></AML>`,
    );
  }

  /**
   * Row 5: the ItemType fetch for a relationship type, by `relationship_id`, with the ItemType body. There is no
   * `levels`, `select` or `<id>` child. The dependency-level chain (`helper.lookups.getDepencyLevel`) follows.
   *
   * @spec EXP-003 EXP-049
   */
  fetchRelationshipItemType(relationshipId: string): Promise<ResponseDocument> {
    const request = element(
      "Item",
      [
        ["type", "ItemType"],
        ["action", "get"],
        ["id", relationshipId],
      ],
      itemTypeBody(serverMajorOf(this.helper.innovatorVersion)),
    );
    return this.helper.applyAML(request);
  }

  /**
   * Row 6: the Property a Form's Field points at, by `propertytype_id`.
   *
   * @spec EXP-003 EXP-050
   */
  fetchFieldProperty(propertyTypeId: string): Promise<ResponseDocument> {
    return this.helper.applyAML(
      element("Item", [
        ["type", "Property"],
        ["action", "get"],
        ["id", propertyTypeId],
        ["select", "name,source_id"],
        ["page", "1"],
        ["pagesize", "1"],
      ]),
    );
  }

  /**
   * Row 9: the `dr_Relationship` a `dr_relationship_id` names, for `dr_RelationshipFamily` and
   * `ac_PolicyAccessItemAttribute`.
   *
   * @spec EXP-003 EXP-051
   */
  fetchDrRelationship(drRelationshipId: string): Promise<ResponseDocument> {
    return this.helper.applyAML(
      element("Item", [
        ["type", "dr_Relationship"],
        ["action", "get"],
        ["id", drRelationshipId],
      ]),
    );
  }
}
