import { getItemCount, singleItem } from "../client/answer.js";
import { CItemException, getProperty } from "../client/fault.js";
import type { ResponseDocument } from "../client/fault.js";
import { needToHandleNullPropertyValues } from "../client/null-values.js";
import { IomItem } from "../export/iom-item.js";
import type { XmlElement as ResponseItem } from "../client/mini-xml.js";
import { EngineNotSupportedError, type CItemHelper } from "../client/item-helper.js";
import type { Engine } from "../engines.js";
import { getMessage } from "../export/messages.js";
import { directoryGetXmlFiles } from "../import/package-files.js";
import { ArgumentException, ArgumentNullException, FileNotFoundException, KeyNotFoundException } from "../io/errors.js";
import { fileExists, toHostPath } from "../io/host-path.js";
import type { PathEnvironment } from "../io/host-path.js";
import { pathGetRandomFileName, pathGetTempPath } from "../io/temp-path.js";
import { getDirectoryName, pathCombineAll } from "../io/win-path.js";
import { directoryCreateDirectory, directoryDelete, directoryExists, fileWriteAllText } from "../io/windows-fs.js";
import type { ManifestFile } from "../manifest/index.js";
import {
  appendChild,
  documentElementOf,
  importNode,
  loadXml,
  outerXml,
  selectNodes,
  selectSingleNode,
  xmlDocumentLoad,
} from "../xml/index.js";
import type { XmlElement } from "../xml/index.js";
import { getItemTypes, getRequestedLanguages } from "./config.js";
import { type SystemValues, createEditItem, getUpdateParameters, getWhereParameters, whereClause } from "./edit-item.js";

/** The engines whose language-pack import is built. 12.0 has none (LP-001). */
export const LP_ENGINES: readonly Engine[] = ["14.0.7", "14.35"];

export { getItemCount };

const MANIFEST_FILE_NAME = "imports.mf";
const PACKAGE_PREFIX = "LanguagePack_";

/** The `Language` get of the preprocessor, as IOM writes it (LP-014). */
const LANGUAGE_GET = '<Item isNew="1" isTemp="1" type="Language" action="get" select="code,suffix" />';

/** The values 14.35 asks the server for, for each `Property` row (LP-041). */
const SYSTEM_PROPERTIES = ["default_value", "data_source", "data_type"] as const;

export interface LanguagePackOptions extends PathEnvironment {
  /** `Path.GetTempPath()`, a Windows path string ending in `\`; the default is the host's temp folder. */
  tempPath?: string;
  /** `Path.GetRandomFileName()`; the default draws `xxxxxxxx.xxx` at random (LP-030). */
  randomFileName?: () => string;
}

/** The temp folder a failed constructor left behind (LP-035), carried by the exception that ended it. */
const LEFT_BEHIND = Symbol("languagePackTempFolder");

/**
 * The temp folder (as a path on this host) that the language-pack preprocessor made and left on disk when `error` ended its
 * constructor (LP-035), or undefined. The exception is the one the engine throws, unwrapped; the folder is attached so that a user can find it.
 * @spec LP-035
 */
export function leftBehindTempFolder(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as Record<symbol, string | undefined>)[LEFT_BEHIND] : undefined;
}

/**
 * The engine's `LanguagePackPreprocessor`: turns a language pack (a configuration file and a folder `xml` of per-ItemType row
 * files) into a temporary package of `edit` items, `<temp>\LanguagePack_<random>\<package>\Import\Fixes\<ItemType>.xml`, and a
 * manifest `<temp>\LanguagePack_<random>\imports.mf` that names it. The engine does all of it in the constructor; the port has an
 * asynchronous server call in it, so {@link LanguagePackPreprocessor.create} stands for the constructor.
 *
 * 14.35 reads the server's version when it is built, and for a server below 14.0 SP22 asks the server for the values of each `Property`
 * row first (LP-040, LP-041).
 *
 * @spec LP-001 LP-003 LP-029 LP-035 LP-036 LP-040 LP-041
 */
export class LanguagePackPreprocessor {
  private lpDebug = false;
  /** 14.35: whether the server needs the null-value handling (LP-040); false for 14.0.7, which has none. */
  private handleNullPropertyValues = false;
  private tempManifestDirectoryPath = "";
  private readonly packages: string[] = [];

  private constructor(
    private readonly helper: CItemHelper,
    private readonly manifest: ManifestFile,
    private readonly options: LanguagePackOptions,
  ) {}

  /**
   * `new LanguagePackPreprocessor(iOWrapper, cItemHelper, manifestFile, LPPath, LPPackage, LPDebug)`. A null helper, then a null
   * manifest, throws `ArgumentNullException`. An empty `lpPath` does nothing more (LP-036). Otherwise it makes the temp package
   * (LP-029); a failure after the temp folder was made leaves the folder, and {@link leftBehindTempFolder} names it (LP-035).
   */
  static async create(
    helper: CItemHelper | null,
    manifestFile: ManifestFile | null,
    lpPath: string | null,
    lpPackage: string | null,
    lpDebug: boolean,
    options: LanguagePackOptions = {},
  ): Promise<LanguagePackPreprocessor> {
    if (helper === null) throw new ArgumentNullException("cItemHelper");
    if (manifestFile === null) throw new ArgumentNullException("manifestFile");
    if (!LP_ENGINES.includes(helper.engine)) throw new EngineNotSupportedError(helper.engine);
    const preprocessor = new LanguagePackPreprocessor(helper, manifestFile, options);
    // 14.35 reads the version before it looks at the path, so an unread version fails an empty path too (LP-029, LP-036)
    if (helper.engine === "14.35") preprocessor.handleNullPropertyValues = needToHandleNullPropertyValues(helper.innovatorVersion);
    if (lpPath !== null && lpPath !== "") {
      preprocessor.lpDebug = lpDebug;
      try {
        await preprocessor.copyToTempDirectory(lpPath, lpPackage);
      } catch (error) {
        const folder = preprocessor.tempManifestDirectoryPath;
        if (folder !== "" && typeof error === "object" && error !== null) {
          Object.defineProperty(error, LEFT_BEHIND, { value: toHostPath(folder, options), configurable: true });
        }
        throw error;
      }
    }
    return preprocessor;
  }

  /** `TempManifestFilePath`: `imports.mf` in the temp folder, or the bare file name when nothing was made (LP-036). */
  get tempManifestFilePath(): string {
    return pathCombineAll(this.tempManifestDirectoryPath, MANIFEST_FILE_NAME);
  }

  /** `TempManifestFile`: the manifest object the caller passed in, holding the package once the constructor has run (LP-032). */
  get tempManifestFile(): ManifestFile {
    return this.manifest;
  }

  /** `TempPackagesNames`: the one package the language pack was written to, or none (LP-032, LP-036). */
  get tempPackagesNames(): readonly string[] {
    return this.packages;
  }

  /**
   * `Dispose()`: deletes the temp folder and all below it unless `lpdebug` was set, when the folder exists. It can be called
   * again, and after someone else removed the folder. A folder the fixes were written outside of (a rooted package name, `..`)
   * is not touched (LP-031). A failure to delete throws and leaves the folder partly deleted.
   * @spec LP-034
   */
  dispose(): void {
    if (!this.lpDebug && directoryExists(this.tempManifestDirectoryPath, this.options)) {
      directoryDelete(this.tempManifestDirectoryPath, true, this.options);
    }
  }

  /**
   * `GetTemporaryDirectory()`: `<temp>\LanguagePack_<random>`, drawn again until no such folder exists, then created through
   * `NormalizeLongPath` (EXP-421). The random name has the form `xxxxxxxx.xxx`.
   * @spec LP-030
   */
  private getTemporaryDirectory(): string {
    const tempPath = this.options.tempPath ?? pathGetTempPath(this.options);
    const randomFileName = this.options.randomFileName ?? pathGetRandomFileName;
    let folder: string;
    do {
      folder = pathCombineAll(tempPath, PACKAGE_PREFIX + randomFileName());
    } while (directoryExists(folder, this.options));
    directoryCreateDirectory(folder, this.options);
    return folder;
  }

  /**
   * `CopyToTempDirectory(lpPath, lpPackage)`: the temp folder, the `Fixes` folder `<temp>\<package>\Import\Fixes` made with
   * `Path.Combine` (the package name is a folder name, not a validated name: LP-031), the fixes, the package name in the list,
   * and the package in the manifest, saved as `<temp>\imports.mf` (LP-032). An exception stops the sequence where it is and
   * leaves what the steps before it made.
   * @spec LP-029 LP-030 LP-031 LP-032 LP-033 LP-035
   */
  private async copyToTempDirectory(lpPath: string, lpPackage: string | null): Promise<void> {
    this.tempManifestDirectoryPath = this.getTemporaryDirectory();
    const fixesFolder = pathCombineAll(this.tempManifestDirectoryPath, lpPackage, "Import", "Fixes");
    directoryCreateDirectory(fixesFolder, this.options);
    await this.copyLanguagePack(fixesFolder, lpPath);
    this.packages.push(lpPackage as string);
    this.manifest.addPackage(lpPackage);
    this.manifest.save(this.tempManifestFilePath);
  }

  /**
   * `GetSupportedLanguages(requestedLanguages)`: one `Language` get, then each answered item whose `code` is requested, or all
   * of them when none is, as code and suffix, in the order of the answer. An item without a `code` throws
   * `ArgumentNullException` (the lookup of a null key), two qualifying items of one code throw `ArgumentException`. A fault
   * other than "no items", an empty answer and an answer that is not an envelope give no language and no error (bug LP-014).
   * @spec LP-014 LP-015
   */
  private async getSupportedLanguages(requestedLanguages: ReadonlySet<string>): Promise<Map<string, string>> {
    const supported = new Map<string, string>();
    const response = await this.helper.inn.applyItem(LANGUAGE_GET);
    const count = getItemCount(response);
    for (let i = 0; i < count; i += 1) {
      const item = response.items[i] as ResponseItem;
      const code = getProperty(item, "code");
      if (code === null) throw new ArgumentNullException("key", "Key cannot be null.");
      if (requestedLanguages.has(code) || requestedLanguages.size === 0) {
        if (supported.has(code)) throw new ArgumentException("An item with the same key has already been added.");
        supported.set(code, getProperty(item, "suffix") ?? "");
      }
    }
    return supported;
  }

  /**
   * `GetSystemPropertiesValueIfHave(...)` and the reading of its answer (LP-041): the `Property` row is looked up by its attributes (the
   * where parameters, each as a property of the request), and `default_value`, `data_source` and `data_type` are taken from the one item it
   * answers, those that have a value. A fault other than "no items" is thrown as the engine's `CItemException`; "no items", an empty
   * answer and two answers leave `getProperty` with `Not a single item` (bug LP-041). An attribute with a prefix cannot be a property
   * name: IOM's XPath refuses it before anything is sent.
   *
   * @spec LP-041
   */
  private async getSystemValues(whereParameters: ReadonlyMap<string, string>): Promise<SystemValues> {
    const request = IomItem.newItem("Property", "get");
    request.setAttribute("select", SYSTEM_PROPERTIES.map((name) => `${name}[is_not_null()]`).join(", "));
    const probe = loadXml("<Item/>", { preserveWhitespace: false });
    for (const [name, value] of whereParameters) {
      selectSingleNode(name, probe);
      request.setProperty(name, value);
    }
    const response = await this.helper.inn.applyItem(request.toXml());
    if (response.isError) {
      const error = CItemException.fromResponse(response, "14.35");
      if (error.faultcode !== 0) throw error;
    }
    const values: Array<readonly [string, string]> = [];
    for (const name of SYSTEM_PROPERTIES) {
      const value = getProperty(singleItem(response), name);
      if (value !== null) values.push([name, value]);
    }
    return { values };
  }

  /**
   * `CopyLanguagePack(packageFolderPath, languageConfigPath)`: reads the configuration, asks the server for its languages, lists
   * the row files of the `xml` folder next to the configuration, and writes `<Fixes>\<ItemType>.xml` for every file that selects
   * a translated item. The files are handled one after the other, each whole before the next, and nothing is rolled back.
   * @spec LP-010 LP-011 LP-012 LP-014 LP-020 LP-021 LP-022 LP-023 LP-024 LP-025 LP-026 LP-027 LP-041
   */
  private async copyLanguagePack(packageFolderPath: string, languageConfigPath: string): Promise<void> {
    if (!fileExists(languageConfigPath, this.options)) {
      throw new FileNotFoundException(languageConfigPath, getMessage("FileNotFound", languageConfigPath));
    }
    const config = xmlDocumentLoad(languageConfigPath, this.options);
    const root = documentElementOf(config) as XmlElement;
    const itemTypes = getItemTypes(root);
    const requestedLanguages = getRequestedLanguages(root);
    const supportedLanguages = await this.getSupportedLanguages(requestedLanguages);
    const xmlFolder = pathCombineAll(getDirectoryName(languageConfigPath), "xml");
    for (const file of directoryGetXmlFiles(xmlFolder, this.options)) {
      const name = this.helper.engine === "14.35" ? itemTypeNameWithoutExtension(file) : itemTypeName(file);
      if (itemTypes.size > 0 && !itemTypes.has(name)) continue;
      const requestedProps = itemTypes.get(name);
      if (requestedProps === undefined) throw new KeyNotFoundException();
      const rows = xmlDocumentLoad(file, this.options);
      const output = loadXml("<AML></AML>", { preserveWhitespace: false });
      const aml = documentElementOf(output) as XmlElement;
      let count = 0;
      for (const node of selectNodes("export/Item", rows)) {
        const itemNode = node as XmlElement;
        const updateParameters = getUpdateParameters(itemNode, requestedProps, supportedLanguages);
        const whereParameters = getWhereParameters(itemNode);
        // the ask comes before the item is known to be empty, so a `Property` row without a translation still sends it (LP-041)
        const system = this.handleNullPropertyValues && name === "Property" ? await this.getSystemValues(whereParameters) : undefined;
        const item = createEditItem(name, updateParameters, system);
        if (item === null) continue;
        item.setAttribute("where", whereClause(name, whereParameters));
        appendChild(aml, importNode(output, item));
        count += 1;
      }
      if (count >= 1) {
        fileWriteAllText(pathCombineAll(packageFolderPath, `${name}.xml`), outerXml(output), this.options);
      }
    }
  }
}

/**
 * 14.35's item type of a row file, `Path.GetFileNameWithoutExtension`: the file name cut at its last dot, so `Foo.xmlbak` and `Foo.XML` are
 * `Foo`, and `Foo.xml.xml` is `Foo.xml` (LP-020).
 * @spec LP-020
 */
export function itemTypeNameWithoutExtension(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? name : name.slice(0, dot);
}

/**
 * The item type of a row file: the text after the last `\` of the path `GetFiles` returned, with every `.xml` removed
 * (ordinal, anywhere in the name, bug LP-020). `Foo.XML` stays `Foo.XML`, and `Foo.xmlbak` becomes `Foobak`.
 * @spec LP-020
 */
export function itemTypeName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1).split(".xml").join("");
}
