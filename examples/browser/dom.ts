/** A few helpers to build DOM with no framework (HOST-280). */

type Child = Node | string | null | undefined | false;

/** Makes an element: attributes as a record (`true` sets an empty attribute, `false` and `undefined` leave it out), then children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

let counter = 0;

/** An id that no other element of the page has. */
export function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** A labelled control: the label, the control, and its help text, wired with `for` and `aria-describedby`. */
export function field(label: string, control: HTMLElement, help?: string): HTMLElement {
  const id = uniqueId("f");
  control.id = id;
  const wrapper = h("div", { class: "field" });
  wrapper.append(h("label", { for: id }, label), control);
  if (help !== undefined) {
    const note = h("small", { id: `${id}-help`, class: "help" }, help);
    control.setAttribute("aria-describedby", note.id);
    wrapper.append(note);
  }
  return wrapper;
}

/** Bytes as `12.3 MB`. */
export function sizeText(bytes: number): string {
  if (bytes < 1e3) return `${bytes} B`;
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(1)} kB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}
