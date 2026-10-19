import { ELEMENT_NODE } from "../xml/dom.js";
import type { XmlElement, XmlNode } from "../xml/dom.js";

/** Whether `a` comes after `b` in document order. Nodes with no common ancestor are unordered, which is not "after". */
function isAfter(a: XmlNode, b: XmlNode): boolean {
  if (a === b) return false;
  const chain = (node: XmlNode): XmlNode[] => {
    const path: XmlNode[] = [];
    for (let current: XmlNode | null = node; current; current = current.parentNode) path.unshift(current);
    return path;
  };
  const left = chain(a);
  const right = chain(b);
  if (left[0] !== right[0]) return false;
  let depth = 0;
  while (depth < left.length && depth < right.length && left[depth] === right[depth]) depth += 1;
  const leftNode = left[depth];
  const rightNode = right[depth];
  // one is an ancestor of the other: a descendant comes after its ancestor
  if (!leftNode) return false;
  if (!rightNode) return true;
  for (let sibling = rightNode.nextSibling; sibling; sibling = sibling.nextSibling) if (sibling === leftNode) return true;
  return false;
}

/**
 * The matches of `.//name` (or, with `accept`, of `.//name[predicate]`) from a context node, found one at a time on the live
 * tree. One cursor and a depth do the walk, so a cursor that stands in a subtree a removal has detached cannot get back out of
 * it: the search ends there (EXP-615).
 *
 * @spec EXP-615
 */
export class DescendantSearch {
  private cursor: XmlNode;
  private level = 0;
  private finished = false;

  constructor(
    context: XmlNode,
    private readonly name: string,
    private readonly accept: (element: XmlElement) => boolean = () => true,
  ) {
    this.cursor = context;
  }

  /** The next match, or undefined when the search is over (and it stays over). */
  next(): XmlElement | undefined {
    while (!this.finished) {
      if (!this.step()) {
        this.finished = true;
        return undefined;
      }
      const node = this.cursor;
      if (node.nodeType === ELEMENT_NODE && this.matches(node as XmlElement)) return node as XmlElement;
    }
    return undefined;
  }

  private matches(element: XmlElement): boolean {
    return (element.namespaceURI ?? "") === "" && element.localName === this.name && this.accept(element);
  }

  private step(): boolean {
    const first = this.cursor.firstChild;
    if (first) {
      this.cursor = first;
      this.level += 1;
      return true;
    }
    if (this.level === 0) return false;
    for (;;) {
      const sibling = this.cursor.nextSibling;
      if (sibling) {
        this.cursor = sibling;
        return true;
      }
      this.level -= 1;
      if (this.level === 0) return false;
      const parent = this.cursor.parentNode;
      if (!parent) return false;
      this.cursor = parent;
    }
  }
}

/**
 * The matches of `.//Relationships/Item`, found by the two-stage query .NET builds for it: the search for `Relationships`
 * elements, and a children query that lists the `Item` children of each one and descends into the next `Relationships` element
 * when that comes before the current child in document order (EXP-615).
 *
 * @spec EXP-615
 */
export class RelationshipItemSearch {
  private readonly relationships: DescendantSearch;
  private readonly stack: XmlNode[] = [];
  private cur: XmlNode | null = null;
  private ahead: XmlNode | null = null;
  private needInput = true;
  private done = false;

  constructor(context: XmlNode) {
    this.relationships = new DescendantSearch(context, "Relationships");
  }

  private getNext(): XmlNode | null {
    if (this.ahead) {
      const taken = this.ahead;
      this.ahead = null;
      return taken;
    }
    return this.relationships.next() ?? null;
  }

  /** Reads the next `Relationships` element and, when the current child lies after it, descends into it. */
  private decide(): boolean {
    this.ahead = this.getNext();
    if (this.ahead && this.cur && isAfter(this.cur, this.ahead)) {
      this.stack.push(this.cur);
      this.cur = this.ahead;
      this.ahead = null;
      const first = this.cur.firstChild;
      if (!first) return false;
      this.cur = first;
      return true;
    }
    return true;
  }

  next(): XmlElement | undefined {
    while (!this.done) {
      if (this.needInput) {
        if (this.stack.length === 0) {
          this.cur = this.getNext();
          if (!this.cur) {
            this.done = true;
            return undefined;
          }
          const first = this.cur.firstChild;
          if (!first) continue;
          this.cur = first;
        } else {
          this.cur = this.stack.pop() ?? null;
          if (!this.decide()) continue;
        }
        this.needInput = false;
      } else {
        const sibling: XmlNode | null = this.cur?.nextSibling ?? null;
        if (!sibling) {
          this.needInput = true;
          continue;
        }
        this.cur = sibling;
        if (!this.decide()) {
          this.needInput = true;
          continue;
        }
      }
      const node = this.cur;
      if (node && node.nodeType === ELEMENT_NODE && (node as XmlElement).localName === "Item" && ((node as XmlElement).namespaceURI ?? "") === "") {
        return node as XmlElement;
      }
    }
    return undefined;
  }
}

/**
 * What `foreach` over the result of `SelectNodes` sees: a list that reads its matches on demand, one ahead of the loop. When the
 * loop is at element `i`, element `i + 1` has already been read, and whatever the body removes afterwards changes only what is
 * read later (EXP-615).
 *
 * @spec EXP-615
 */
export function* lazyNodeList<T>(read: () => T | undefined): Generator<T> {
  const list: T[] = [];
  let exhausted = false;
  for (let index = 0; ; index += 1) {
    while (!exhausted && list.length < index + 2) {
      const element = read();
      if (element === undefined) exhausted = true;
      else list.push(element);
    }
    if (index >= list.length) return;
    yield list[index] as T;
  }
}
