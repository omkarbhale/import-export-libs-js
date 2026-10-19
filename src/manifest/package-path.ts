import { DEFAULT_ENGINE, type Engine } from "../engines.js";
import { isNullOrWhiteSpace } from "../io/dotnet-text.js";
import { NullReferenceException } from "../io/errors.js";
import { isPathRooted, pathCombine } from "../io/win-path.js";
import type { CodePointRanges } from "./nls-startswith-data.js";
import { NLS_AFTER_PREFIX_BREAKS, NLS_EQUALS_DOT, NLS_EQUALS_N_AFTER_N, NLS_IGNORABLE } from "./nls-startswith-data.js";
import type { XmlElement } from "../xml/dom.js";

const DEFAULT_PREFIX = "com.aras.defaults.";
const CORE_PREFIX = "com.aras.innovator.";
const SOLUTION_PREFIX = "com.aras.innovator.solution.";
/** Where the second `n` of `innovator` stands in the two core prefixes. */
const SECOND_N_INDEX = 11;

function inRanges(ranges: CodePointRanges, codePoint: number): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [first, last] = ranges[middle] as readonly [number, number];
    if (codePoint < first) high = middle - 1;
    else if (codePoint > last) low = middle + 1;
    else return true;
  }
  return false;
}

/** `text.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)` for an ASCII prefix: no other character folds to a letter of it. */
function startsWithIgnoreCase(text: string, prefix: string): boolean {
  if (text.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    const a = text.charCodeAt(i);
    const b = prefix.charCodeAt(i);
    if (a === b) continue;
    const isLetter = b >= 0x61 && b <= 0x7a;
    if (!isLetter || a !== b - 0x20) return false;
  }
  return true;
}

/**
 * `text.StartsWith(prefix)` with the current culture and no comparison argument, for the two prefixes of the engine, as
 * far as the oracle host showed it to differ from an ordinal comparison (MAN-031).
 */
function cultureStartsWith(text: string, prefix: string): boolean {
  let at = 0;
  const next = (): number => {
    while (at < text.length) {
      const codePoint = text.codePointAt(at) as number;
      if (!inRanges(NLS_IGNORABLE, codePoint)) return codePoint;
      at += codePoint > 0xffff ? 2 : 1;
    }
    return -1;
  };
  for (let i = 0; i < prefix.length; i += 1) {
    const codePoint = next();
    const expected = prefix.charCodeAt(i);
    const matches =
      codePoint === expected ||
      (expected === 0x2e && inRanges(NLS_EQUALS_DOT, codePoint)) ||
      (i === SECOND_N_INDEX && inRanges(NLS_EQUALS_N_AFTER_N, codePoint));
    if (!matches) return false;
    at += codePoint > 0xffff ? 2 : 1;
  }
  const after = next();
  return after < 0 || !inRanges(NLS_AFTER_PREFIX_BREAKS, after);
}

/**
 * `ExportImportBase.IsDefaultPackage`: the name starts with `com.aras.defaults.`, ignoring case.
 * @spec MAN-031
 */
export function isDefaultPackage(name: string | null): boolean {
  if (name === null) throw new NullReferenceException();
  return startsWithIgnoreCase(name, DEFAULT_PREFIX);
}

/**
 * `ExportImportBase.IsCorePackage`: the name starts with `com.aras.innovator.` and not with `com.aras.innovator.solution.`,
 * both compared with the current culture, case-sensitively.
 * @spec MAN-031
 */
export function isCorePackage(name: string | null): boolean {
  if (name === null) throw new NullReferenceException();
  return cultureStartsWith(name, CORE_PREFIX) && !cultureStartsWith(name, SOLUTION_PREFIX);
}

/**
 * `ExportImportBase.IsStandardPackage`: a default package or a core package.
 * @spec MAN-031
 */
export function isStandardPackage(name: string | null): boolean {
  return isDefaultPackage(name) || isCorePackage(name);
}

/**
 * `ExportImportBase.GetPackagePath(packageNode, manifestFolder)`: the folder of a package, as a Windows path string. The
 * `path` attribute (`.\` when blank) is joined to the manifest folder unless it is rooted, and a standard package adds
 * its dotted name as folders. Nothing is normalised.
 *
 * 14.35 uses `.` for a blank path and adds the name of a standard package with `Path.Combine`, so no doubled separator
 * follows a path that ends in one, and an illegal character in the name is refused.
 *
 * @spec MAN-030 MAN-033
 */
export function getPackagePath(packageNode: XmlElement | null, manifestFolder: string | null, engine: Engine = DEFAULT_ENGINE): string {
  if (packageNode === null) throw new NullReferenceException();
  const name = packageNode.getAttribute("name") || "";
  let path = packageNode.getAttribute("path") || "";
  const is1435 = engine === "14.35";
  if (isNullOrWhiteSpace(path)) path = is1435 ? "." : ".\\";
  if (!isPathRooted(path)) path = pathCombine(manifestFolder, path);
  if (isStandardPackage(name)) {
    const folders = name.replace(/\./g, "\\");
    path = is1435 ? pathCombine(path, folders) : `${path}\\${folders}`;
  }
  return path;
}
