/**
 * Whether `text` holds `prefix` at `index`: what `text.startsWith(prefix, index)` answers, without calling it.
 *
 * A page may replace `String.prototype.startsWith`; the Aras 12 client's MicrosoftAjax replaces it with one that ignores the position,
 * so a call with a position is wrong in that page's realm. The XML readers ask this at every `<`, and ask it here instead.
 *
 * @spec HOST-283
 */
export function startsWithAt(text: string, prefix: string, index: number): boolean {
  // the native clamps the position into the text
  const start = Math.min(Math.max(Math.trunc(index) || 0, 0), text.length);
  if (start + prefix.length > text.length) return false;
  for (let k = 0; k < prefix.length; k += 1) {
    if (text.charCodeAt(start + k) !== prefix.charCodeAt(k)) return false;
  }
  return true;
}
