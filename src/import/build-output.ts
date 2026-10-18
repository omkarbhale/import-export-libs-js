import { CItemException } from "../client/fault.js";
import type { Engine } from "../engines.js";
import { OutputWriter } from "../export/output.js";
import { COMMENT_NODE, ELEMENT_NODE, PROCESSING_INSTRUCTION_NODE, attributesOf } from "../xml/dom.js";
import type { XmlDocument, XmlElement, XmlNode } from "../xml/dom.js";
import { loadXml } from "../xml/parser.js";
import { isCarriedSibling, isCarryingAdd, isPlainElement, planBuildOrder } from "./build-order.js";
import type { BuildPlan, PlanEntry } from "./build-order.js";

/**
 * What `build.xsl` writes and what `ApplyXsl` does with it (IMP-012 to IMP-014, IMP-032): the plan of IMP-020 to IMP-029 is
 * written as the text the stylesheet's output would be, the exact string of IMP-013 is removed from it, and the text is loaded
 * as the new document.
 */

/** The `cdata-section-elements` of `build.xsl` (IMP-014). `export.xsl` has more. */
const BUILD_CDATA_SECTION_ELEMENTS: readonly string[] = [
  "html_code",
  "method_code",
  "sqlserver_body",
  "stylesheet",
  "query",
  "class_structure",
  "report_query",
  "xsl_stylesheet",
];

const SOAP_ENV_DECLARATION = 'xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"';

/** A nested `ItemType` or `RelationshipType` add followed by a copy of a later sibling inside an emitted item (IMP-026). */
export interface NestedRepeat {
  /** Position of the plan entry whose content holds both. */
  entry: number;
  add: XmlElement;
  copy: XmlElement;
}

export interface RenderedBuild {
  text: string;
  nestedRepeats: NestedRepeat[];
}

function isDeclaration(name: string): boolean {
  return name === "xmlns" || name.startsWith("xmlns:");
}

/**
 * The namespace bindings in scope at an element, outermost first, as `xsl:copy` copies them (IMP-014): the parent's, and then the
 * element's own declarations, each moved behind the others when it redeclares a prefix. A declaration of the empty default
 * namespace removes the default.
 */
function scopeAt(element: XmlElement, parent: ReadonlyMap<string, string>): Map<string, string> {
  const scope = new Map(parent);
  for (const attribute of attributesOf(element)) {
    if (!isDeclaration(attribute.name)) continue;
    const prefix = attribute.name === "xmlns" ? "" : attribute.name.slice(6);
    scope.delete(prefix);
    if (!(prefix === "" && attribute.value === "")) scope.set(prefix, attribute.value);
  }
  return scope;
}

/** The scope in force at the file root that holds an item: the root's own declarations, as the wrapper declares none. */
function scopeOfParent(element: XmlElement): Map<string, string> {
  const parent = element.parentNode;
  return parent && parent.nodeType === ELEMENT_NODE ? scopeAt(parent as XmlElement, scopeOfParent(parent as XmlElement)) : new Map();
}

class Renderer {
  readonly nestedRepeats: NestedRepeat[] = [];
  readonly writer = new OutputWriter(BUILD_CDATA_SECTION_ELEMENTS);
  private current = 0;

  /** An entry of the plan: the item copied by the `*` template into the root `AML`. */
  renderEntry(entry: PlanEntry): void {
    this.current = entry.position;
    const element = entry.item.element;
    this.copy(element, scopeOfParent(element));
  }

  /** The `*` template: the element, its attributes, the namespace declarations, then the results for its children. */
  private copy(element: XmlElement, parentScope: ReadonlyMap<string, string>): void {
    const scope = scopeAt(element, parentScope);
    this.writer.startElement(element.nodeName, element.namespaceURI || null, scope);
    for (const attribute of attributesOf(element)) {
      if (!isDeclaration(attribute.name)) this.writer.attribute(attribute.name, attribute.value);
    }
    for (let child: XmlNode | null = element.firstChild; child; child = child.nextSibling) {
      switch (child.nodeType) {
        case ELEMENT_NODE:
          this.child(child as XmlElement, scope);
          break;
        case COMMENT_NODE:
        case PROCESSING_INSTRUCTION_NODE:
          break;
        default:
          this.writer.text((child as unknown as { data: string }).data ?? "");
      }
    }
    this.writer.endElement();
  }

  /** A child element: copied, and for an `ItemType` or `RelationshipType` add followed by the copies of IMP-026. */
  private child(child: XmlElement, parentScope: ReadonlyMap<string, string>): void {
    this.copy(child, parentScope);
    if (!isPlainElement(child, "Item") || !isCarryingAdd(typeOf(child), actionOf(child))) return;
    for (let sibling = child.nextSibling; sibling; sibling = sibling.nextSibling) {
      if (!isPlainElement(sibling, "Item") || !isCarriedSibling(typeOf(sibling), actionOf(sibling))) continue;
      this.nestedRepeats.push({ entry: this.current, add: child, copy: sibling });
      this.copy(sibling, parentScope);
    }
  }
}

function typeOf(element: XmlElement): string | null {
  return element.hasAttribute("type") ? element.getAttribute("type") : null;
}

function actionOf(element: XmlElement): string | null {
  return element.hasAttribute("action") ? element.getAttribute("action") : null;
}

/**
 * The text the `build.xsl` transform writes for a plan (IMP-014, IMP-032), before ApplyXsl removes the SOAP-ENV declaration.
 * A character XML forbids makes it throw `ArgumentException`, as the output writer does.
 * @spec IMP-014 IMP-026 IMP-032
 */
export function renderBuildOutput(plan: BuildPlan): RenderedBuild {
  const renderer = new Renderer();
  renderer.writer.startElement("AML");
  for (const entry of plan.entries) renderer.renderEntry(entry);
  renderer.writer.endElement();
  return { text: renderer.writer.finish(), nestedRepeats: renderer.nestedRepeats };
}

/** The message `ApplyXsl` adds to an error of the transform. It names `export.xsl` and has two spaces: the engine's wording. */
const APPLY_XSL_FAILURE = " Error of  applying export.xsl.";

export interface AppliedBuild {
  document: XmlDocument;
  plan: BuildPlan;
  nestedRepeats: NestedRepeat[];
  /** The text that was loaded, after the removal of IMP-013. */
  text: string;
}

/**
 * `CItemHelper.ApplyXsl(doc, "build.xsl")`: the transform, the removal of every `xmlns:SOAP-ENV="…"` from the text, and the
 * load of the text. An error of the transform is wrapped as a `CItemException` (the engine's message names the wrong
 * stylesheet); a `XmlException` of the load is not.
 * @spec IMP-012 IMP-013
 */
export function applyBuildXsl(source: XmlDocument, engine: Engine): AppliedBuild {
  const plan = planBuildOrder(source, engine);
  let rendered: RenderedBuild;
  try {
    rendered = renderBuildOutput(plan);
  } catch (error) {
    const original = error as Error;
    throw new CItemException(-1, original.stack ?? null, original.message + APPLY_XSL_FAILURE, original);
  }
  const text = rendered.text.split(SOAP_ENV_DECLARATION).join("");
  const document = loadXml(text, { preserveWhitespace: false });
  return { document, plan, nestedRepeats: rendered.nestedRepeats, text };
}
