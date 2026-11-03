import { toLowerInvariant } from "../language-pack/invariant-lower.js";
import { AggregateException } from "../export/parallel-for-each.js";
import type { PathEnvironment } from "../io/host-path.js";
import { readAllText } from "../xml/read-text.js";
import { loadXml } from "../xml/parser.js";
import { selectNodes } from "../xml/xpath.js";
import type { XmlAttribute } from "../xml/dom.js";
import { directoryGetXmlFilesRecursive, readListedFile } from "./package-files.js";

/** The engine's `Package`: a name and the folder its files are in (IMP-610). */
export interface Package {
  name: string;
  folderPath: string;
}

/** The attribute nodes the scan selects from a file: an `xml:lang` of an element that is a direct child of an `Item` (IMP-611). */
const LANGUAGE_ATTRIBUTES = "//Item/*/@xml:lang";

const NON_COMBINING = /[̀-ͯ]/g;

/**
 * The order of `Comparer<string>.Default` under en-US for the language codes (IMP-615): the codes with every `-` removed and their
 * accents dropped are compared ordinally; when those are equal an unaccented code comes before an accented one, and one without a
 * hyphen before one with. For the codes of ASCII letters, digits and `-` this is the probed order, and so are the accented letters of
 * the probe (`a`, `ä`, `e`, `é`). Other characters are not reproduced.
 */
function compareCodes(a: string, b: string): number {
  const bare = (code: string): string => code.normalize("NFD").replace(NON_COMBINING, "").replaceAll("-", "");
  const ordinal = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
  const accented = (code: string): string => code.replaceAll("-", "");
  return ordinal(bare(a), bare(b)) || ordinal(accented(a), accented(b)) || a.length - b.length || ordinal(a, b);
}

/**
 * The engine's `LanguageCodesExtractor`: the scan of the packages of a manifest for the languages their files use, and the cache it
 * fills (IMP-610 to IMP-615). The engine holds one instance in a static property, shared by every manager of the process; the port
 * gives each manager its own, which differs only for a caller that runs a manager after another manager rebuilt the cache (IMP-613).
 *
 * @spec IMP-610 IMP-611 IMP-612 IMP-613 IMP-614 IMP-615
 */
export class LanguageCodesExtractor {
  private readonly cache = new Map<string, readonly string[]>();

  constructor(private readonly environment: PathEnvironment = {}) {}

  /** `GetUsedLanguagesByPackage(name)`: the codes the package's files use, or none for a name the scan did not add (IMP-613). */
  getUsedLanguagesByPackage(packageName: string): readonly string[] {
    return this.cache.get(packageName) ?? [];
  }

  /**
   * `GetUsedLanguagesByPackages(names)`: the codes of all the named packages without duplicates, in the order of the default string
   * comparer (IMP-615). A name that is not in the cache contributes nothing.
   */
  getUsedLanguagesByPackages(packageNames: Iterable<string>): string[] {
    const codes = new Set<string>();
    for (const name of packageNames) for (const code of this.getUsedLanguagesByPackage(name)) codes.add(code);
    return [...codes].sort(compareCodes);
  }

  /**
   * `ExtractLanguageCodesFromPackages(packages)`: clears the cache, then scans the packages in order and adds each one's codes under
   * its name. The packages are taken from the sequence one at a time, so one that cannot be built (its folder cannot be resolved)
   * stops the scan with the packages before it in the cache. A package whose name is already in the cache is scanned and its codes
   * dropped. Any failure ends the scan with that exception (IMP-612): the listing's, or an `AggregateException` of those of the files.
   *
   * @spec IMP-610 IMP-611 IMP-612 IMP-613
   */
  extractLanguageCodesFromPackages(packages: Iterable<Package>): void {
    this.cache.clear();
    for (const { name, folderPath } of packages) {
      const used = this.scanPackage(folderPath);
      if (!this.cache.has(name)) this.cache.set(name, used);
    }
  }

  /** The codes of one package folder: every `*.xml` file below it, read and searched (IMP-611). */
  private scanPackage(folderPath: string): string[] {
    const paths = directoryGetXmlFilesRecursive(folderPath, this.environment);
    const codes = new Set<string>();
    const failures: unknown[] = [];
    // `Parallel.ForEach` runs every file and gathers the failures of those that fail; the number of them is not defined (IMP-612)
    for (const path of paths) {
      try {
        const document = loadXml(readAllText(readListedFile(path, this.environment)), { preserveWhitespace: false });
        // every value is stored lower-cased; the nodes are matched later by the text as written (IMP-614)
        for (const node of selectNodes(LANGUAGE_ATTRIBUTES, document) as XmlAttribute[]) codes.add(toLowerInvariant(node.value));
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateException(failures);
    return [...codes];
  }
}
