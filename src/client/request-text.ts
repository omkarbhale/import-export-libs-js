/**
 * The text of a request the engine builds through the DOM: the nodes it creates are written out with .NET's
 * `OuterXml`, so the text is fixed by these rules and not by how the engine happened to assemble it.
 *
 * @spec EXP-003
 */

const ATTRIBUTE_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "\r": "&#xD;",
  "\n": "&#xA;",
};

const TEXT_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

/** An attribute value: `&`, `<`, `>`, `"`, CR and LF are escaped, a tab and non-ASCII text are not. */
export function attributeValue(value: string): string {
  return value.replace(/[&<>"\r\n]/g, (c) => ATTRIBUTE_ESCAPES[c] ?? c);
}

/** Element text: `&`, `<` and `>` are escaped, quotes are not. */
export function elementText(value: string): string {
  return value.replace(/[&<>]/g, (c) => TEXT_ESCAPES[c] ?? c);
}

/**
 * An element with its attributes in the order the engine sets them. Without `content` it is written `<X />`; with
 * `content`, even an empty one, it is written `<X>…</X>`, which is what assigning `InnerText` gives.
 */
export function element(name: string, attributes: ReadonlyArray<readonly [string, string]>, content?: string): string {
  const open = `<${name}${attributes.map(([n, v]) => ` ${n}="${attributeValue(v)}"`).join("")}`;
  return content === undefined ? `${open} />` : `${open}>${content}</${name}>`;
}

/** An element holding text. */
export function textElement(name: string, value: string): string {
  return element(name, [], elementText(value));
}
