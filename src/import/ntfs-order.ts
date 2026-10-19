import { NTFS_UPPER_RUNS } from "./ntfs-upper-data.js";

/**
 * NTFS directory order, which `Directory.GetDirectories` and `Directory.GetFiles` return and the engine never sorts
 * (IMP-004): the ordinal order of the upper-cased name. The upper-casing is .NET Framework 4.8's `ToUpperInvariant` on each
 * UTF-16 unit on its own, not the host's `toUpperCase`.
 */

let upperTable: Map<number, number> | undefined;

function upperOf(unit: number): number {
  if (!upperTable) {
    upperTable = new Map();
    for (const [first, last, stride, delta] of NTFS_UPPER_RUNS) {
      for (let at = first; at <= last; at += stride) upperTable.set(at, at + delta);
    }
  }
  return upperTable.get(unit) ?? unit;
}

/** The comparison key of a file or directory name: every UTF-16 unit upper-cased on its own, surrogates untouched. */
export function ntfsOrderKey(name: string): string {
  let key = "";
  for (let i = 0; i < name.length; i += 1) key += String.fromCharCode(upperOf(name.charCodeAt(i)));
  return key;
}

/**
 * Compares two names in one directory as NTFS lists them. Two names with the same key can only exist on a case-sensitive
 * file system, and then the code units of the names decide, so that the result is deterministic.
 * @spec IMP-004
 */
export function compareNtfsNames(a: string, b: string): number {
  const keyA = ntfsOrderKey(a);
  const keyB = ntfsOrderKey(b);
  if (keyA !== keyB) return keyA < keyB ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * The names of one directory in NTFS order.
 * @spec IMP-004 IMP-031
 */
export function sortNtfsNames(names: readonly string[]): string[] {
  const keyed = names.map((name) => ({ name, key: ntfsOrderKey(name) }));
  keyed.sort((a, b) => (a.key !== b.key ? (a.key < b.key ? -1 : 1) : a.name === b.name ? 0 : a.name < b.name ? -1 : 1));
  return keyed.map((entry) => entry.name);
}

/** What an 8.3 name may not hold: a control character, a space, and the characters `" * + , / : ; < = > ? [ \ ] |`. */
const ILLEGAL_IN_SHORT_NAME = /[\u0000- "*+,/:;<=>?[\\\]|\u007f]/;

/** Whether a name is an 8.3 name as it stands (up to case): ASCII only, a base of 1 to 8 characters, at most one dot, an extension of at most 3. */
function fitsEightDotThree(name: string): boolean {
  if (/[^\u0000-\u007f]/.test(name) || ILLEGAL_IN_SHORT_NAME.test(name)) return false;
  const parts = name.split(".");
  return parts.length <= 2 && parts[0]!.length >= 1 && parts[0]!.length <= 8 && (parts[1]?.length ?? 0) <= 3;
}

/**
 * The short name stem NTFS builds for a long name that does not fit 8.3: the leading dots and the spaces removed, the dots
 * but the last removed, the characters an 8.3 name may not hold replaced by `_`, upper-cased, the base cut to 6 characters and
 * the extension to 3. Returns the base and the extension; the extension is empty when the name has no dot after the leading dots.
 */
function shortNameStem(name: string): { base: string; extension: string } {
  const rest = name.replace(/^\.+/, "").replace(/ /g, "");
  const dot = rest.lastIndexOf(".");
  const clean = (text: string): string => text.replace(/[\u0000-\u001f"*+,/:;<=>?[\\\]|\u007f]/g, "_").replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const base = clean((dot < 0 ? rest : rest.slice(0, dot)).replace(/\./g, ""));
  return { base: base.slice(0, 6), extension: dot < 0 ? "" : clean(rest.slice(dot + 1)).slice(0, 3) };
}

/**
 * The short (8.3) names of the entries of one directory, for those that have one that differs from the long name. A name that
 * fits 8.3 has its upper-cased self as short name and is left out (it sorts at its long name's place). A name that does not fit
 * gets `BASE~N.EXT`; `N` counts from 1 among the names that share `BASE` and `EXT`, in NTFS order of the long names.
 * @spec IMP-004
 */
export function shortNamesOf(names: readonly string[]): Map<string, string> {
  const shortNames = new Map<string, string>();
  const taken = new Map<string, number>();
  for (const name of sortNtfsNames(names.filter((entry) => !fitsEightDotThree(entry)))) {
    const { base, extension } = shortNameStem(name);
    const group = `${base}.${extension}`;
    const counter = (taken.get(group) ?? 0) + 1;
    taken.set(group, counter);
    shortNames.set(name, `${base}~${counter}${extension === "" ? "" : `.${extension}`}`);
  }
  return shortNames;
}
