import { attributeValue, elementText } from "../client/request-text.js";

/** What an `Item` holds, in the order it was added. */
type Child =
  | { readonly kind: "property"; readonly name: string; text: string | null }
  | { readonly kind: "propertyItem"; readonly name: string; readonly item: IomItem }
  | { readonly kind: "relationships"; readonly items: IomItem[] }
  | { readonly kind: "raw"; readonly xml: string };

/**
 * An IOM `Item` as the 14.35 export builds requests with it (`newItem`, `setProperty`, `setAttribute`, `addRelationship`,
 * `setPropertyItem`): an element whose attributes and children are written in the order they were set, with no whitespace
 * between elements. Every `Item` made by `newItem` starts `isNew="1" isTemp="1"` (EXP-003).
 *
 * @spec EXP-003 EXP-020 EXP-060 EXP-061
 */
export class IomItem {
  private readonly attributes: Array<[string, string]> = [];
  private readonly children: Child[] = [];

  /**
   * `Innovator.newItem(type, action)`: IOM sets `isNew` and `isTemp` first, and `type` and `action` only when there is a type. A null
   * type gives `<Item isNew="1" isTemp="1" />`.
   */
  static newItem(type: string | null, action: string): IomItem {
    const item = new IomItem();
    item.attributes.push(["isNew", "1"], ["isTemp", "1"]);
    if (type !== null) item.attributes.push(["type", type], ["action", action]);
    return item;
  }

  /** `getAttribute(name)`: null when the item has none. */
  getAttribute(name: string): string | null {
    return this.attributes.find(([attribute]) => attribute === name)?.[1] ?? null;
  }

  /** `setAttribute(name, value)`: replaces the value of an attribute the item has, otherwise adds it last. */
  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find(([attribute]) => attribute === name);
    if (existing) existing[1] = value;
    else this.attributes.push([name, value]);
  }

  /**
   * `setProperty(name, value)`: the first element of that name takes the text, otherwise one is added last. A null value is
   * written `<name is_null="1"></name>` (the 14.35 probe's `relTypeNoName`).
   */
  setProperty(name: string, value: string | null): void {
    const existing = this.children.find((child): child is Extract<Child, { kind: "property" }> => child.kind === "property" && child.name === name);
    if (existing) existing.text = value;
    else this.children.push({ kind: "property", name, text: value });
  }

  /** `setPropertyItem(name, item)`: an element of that name that holds the item. */
  setPropertyItem(name: string, item: IomItem): void {
    this.children.push({ kind: "propertyItem", name, item });
  }

  /** `addRelationship(item)`: the item goes into the item's `Relationships` element, which is added when the item has none. */
  addRelationship(item: IomItem): void {
    const existing = this.children.find((child): child is Extract<Child, { kind: "relationships" }> => child.kind === "relationships");
    if (existing) existing.items.push(item);
    else this.children.push({ kind: "relationships", items: [item] });
  }

  /** Markup that is appended as it is: the request bodies of EXP-024 and EXP-025, which come from resources. */
  appendRaw(xml: string): void {
    this.children.push({ kind: "raw", xml });
  }

  /** A copy that shares nothing with the item, which is what writing the item out and loading the text into a new `Item` gives. */
  clone(): IomItem {
    const copy = new IomItem();
    for (const [name, value] of this.attributes) copy.attributes.push([name, value]);
    for (const child of this.children) {
      switch (child.kind) {
        case "property":
          copy.children.push({ kind: "property", name: child.name, text: child.text });
          break;
        case "propertyItem":
          copy.children.push({ kind: "propertyItem", name: child.name, item: child.item.clone() });
          break;
        case "relationships":
          copy.children.push({ kind: "relationships", items: child.items.map((item) => item.clone()) });
          break;
        case "raw":
          copy.children.push(child);
          break;
      }
    }
    return copy;
  }

  /** The item as XML text: the engine text and the wire text of the request alike. An item with no children is `<Item … />`. */
  toXml(): string {
    const open = `<Item${this.attributes.map(([name, value]) => ` ${name}="${attributeValue(value)}"`).join("")}`;
    if (this.children.length === 0) return `${open} />`;
    return `${open}>${this.children.map(writeChild).join("")}</Item>`;
  }
}

function writeChild(child: Child): string {
  switch (child.kind) {
    case "property":
      return child.text === null ? `<${child.name} is_null="1"></${child.name}>` : `<${child.name}>${elementText(child.text)}</${child.name}>`;
    case "propertyItem":
      return `<${child.name}>${child.item.toXml()}</${child.name}>`;
    case "relationships":
      return `<Relationships>${child.items.map((item) => item.toXml()).join("")}</Relationships>`;
    case "raw":
      return child.xml;
  }
}
