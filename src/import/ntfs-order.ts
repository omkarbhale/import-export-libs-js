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
