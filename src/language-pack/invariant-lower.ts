import { INVARIANT_LOWER_ASTRAL_RUNS, INVARIANT_LOWER_BMP_RUNS } from "./invariant-lower-data.js";

let bmp: Map<number, number> | undefined;
let astral: Map<number, number> | undefined;

function expand(runs: readonly (readonly [number, number, number, number])[]): Map<number, number> {
  const table = new Map<number, number>();
  for (const [first, last, stride, delta] of runs) {
    for (let at = first; at <= last; at += stride) table.set(at, at + delta);
  }
  return table;
}

/**
 * `ToLower(CultureInfo.InvariantCulture)` of .NET Framework 4.8: each code point mapped on its own by the simple case table,
 * with no context rule and no special casing. A final sigma becomes `σ`, `İ` stays, and the text keeps its length. A lone
 * surrogate is left as it is. JavaScript's `toLowerCase` differs on exactly those cases.
 * @spec LP-013
 */
export function toLowerInvariant(text: string): string {
  bmp ??= expand(INVARIANT_LOWER_BMP_RUNS);
  astral ??= expand(INVARIANT_LOWER_ASTRAL_RUNS);
  let lowered = "";
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    const next = text.charCodeAt(i + 1);
    if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      const codePoint = text.codePointAt(i) as number;
      lowered += String.fromCodePoint(astral.get(codePoint) ?? codePoint);
      i += 1;
    } else {
      lowered += String.fromCharCode(bmp.get(unit) ?? unit);
    }
  }
  return lowered;
}
