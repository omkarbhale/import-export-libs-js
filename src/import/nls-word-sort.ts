import { NLS_WEIGHTS } from "./nls-weights-data.js";

/**
 * The NLS "word sort" of .NET Framework with no options and the invariant culture (the order of en-US, en-IN and de-DE too),
 * which `xsl:sort select="@type"` of `build.xsl` uses (IMP-028, IMP-030). It is not ICU, not `localeCompare` and not code-unit
 * order. The weights cover U+0020 to U+007E and U+00C0 to U+00FF without U+00D7 and U+00F7, which is every item type name Aras
 * ships; a name with another character is refused instead of guessed.
 */

/** A type name has a character whose NLS sort weight is not in the table of IMP-030. */
export class TypeNameOutsideRepertoireError extends Error {
  override name = "TypeNameOutsideRepertoireError";

  constructor(
    readonly typeName: string,
    readonly character: string,
  ) {
    super(
      `The item type name '${typeName}' has the character U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}, ` +
        "whose position in the NLS word sort is not recorded (IMP-030). The import order cannot be planned without it.",
    );
  }
}

function bytesOf(hex: string | undefined): number[] {
  return hex === undefined ? [] : (hex.match(/../g) ?? []).map((pair) => parseInt(pair, 16));
}

function trimNeutral(section: number[]): number[] {
  while (section.length > 0 && section[section.length - 1] === 2) section.pop();
  return section;
}

/**
 * The sort key of a type name: `P 01 D 01 C 01 X 01 S 00`, compared as unsigned bytes. The hyphen and the apostrophe are
 * specials, which sort after every weighted character in a section of their own.
 * @spec IMP-030
 */
export function nlsSortKey(text: string): number[] {
  const primary: number[] = [];
  const diacritic: number[] = [];
  const casing: number[] = [];
  const extra: number[] = [];
  const specials: number[] = [];
  let pairs = 0;
  for (const character of text) {
    const weights = NLS_WEIGHTS[character.codePointAt(0) ?? -1];
    if (!weights) throw new TypeNameOutsideRepertoireError(text, character);
    if (weights.special !== undefined) {
      specials.push(0xff, 0xff - pairs, ...bytesOf(weights.special));
      continue;
    }
    const weight = bytesOf(weights.p);
    const count = weight.length / 2;
    primary.push(...weight);
    for (const [target, section] of [
      [diacritic, weights.d],
      [casing, weights.c],
    ] as const) {
      const own = bytesOf(section);
      target.push(...own, ...Array<number>(count - own.length).fill(2));
    }
    extra.push(...bytesOf(weights.x));
    pairs += count;
  }
  return [...primary, 1, ...trimNeutral(diacritic), 1, ...trimNeutral(casing), 1, ...extra, 1, ...specials, 0];
}

/** Compares two sort keys as unsigned byte strings; a key that is a prefix of the other comes first. */
export function compareSortKeys(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const difference = (a[i] as number) - (b[i] as number);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

/**
 * Orders items by their type name as `xsl:sort select="@type"` does: ascending and stable. The key of a name is made once, so a
 * name outside the table is refused even when it stands alone.
 * @spec IMP-028 IMP-030 IMP-031
 */
export function sortByTypeName<T>(items: readonly T[], typeOf: (item: T) => string): T[] {
  const keyed = items.map((item, index) => ({ item, index, key: nlsSortKey(typeOf(item)) }));
  keyed.sort((a, b) => compareSortKeys(a.key, b.key) || a.index - b.index);
  return keyed.map((entry) => entry.item);
}
