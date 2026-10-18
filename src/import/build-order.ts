import type { Engine } from "../engines.js";
import { ELEMENT_NODE, documentElementOf, innerText } from "../xml/dom.js";
import type { XmlDocument, XmlElement, XmlNode } from "../xml/dom.js";
import { NotSupportedException } from "../xml/errors.js";
import { sortByTypeName } from "./nls-word-sort.js";

/**
 * `build.xsl` of the engine, re-expressed as ordering rules (IMP-020 to IMP-029). The input is the wrapper document of
 * IMP-010: a root `AML` whose children are the root `AML` elements of the package files in read order. The groups below pick
 * the *file items* (the `Item` children of those roots) one group after the other; what no group picks is dropped.
 *
 * The stylesheet is not embedded and not run. The plan this file builds is also what `plan import` reports (IMP-033), so the
 * plan cannot disagree with the order the import uses.
 */

/** The `|`-joined names of the stylesheet's two type lists, which its groups test with a substring search (IMP-022). */
const EDIT_LIST_HEAD =
  "|List|Sequence|Revision|Variable|Identity|Member|User|Permission|Method|EMail Message|Action|Report|Form|Life Cycle Map|Workflow Map|Grid|xPropertyDefinition|Permission_ItemClassification|Permission_PropertyValue|PresentationConfiguration|";
const EDIT_LIST_MIDDLE = "Morphae|RelationshipType|";
const LIST_TAIL = "Metric|Chart|Dashboard|ac_PolicyAccessItemAttribute|mp_PolicyAccessEnvAttribute|mp_MacPolicy|qry_QueryDefinition|dr_RelationshipFamily|dac_DomainDefinition|";

/** The eleven command bar types of G20 to G30, in the order of their groups. */
const COMMAND_BAR_TYPES = [
  "CommandBarShortcut",
  "CommandBarSeparator",
  "CommandBarMenuSeparator",
  "CommandBarDropDown",
  "CommandBarCheckbox",
  "CommandBarMenuCheckbox",
  "CommandBarEdit",
  "CommandBarButton",
  "CommandBarMenu",
  "CommandBarMenuButton",
  "CommandBarSection",
] as const;

const COMMAND_BAR_LIST = `${COMMAND_BAR_TYPES.join("|")}|`;

interface EngineRules {
  /** The types that have an add group before G12, in order (G01 to G12). */
  readonly editList: string;
  readonly unlistedList: string;
}

const RULES_14_0_7: EngineRules = {
  editList: `${EDIT_LIST_HEAD}${EDIT_LIST_MIDDLE}${LIST_TAIL}${COMMAND_BAR_LIST}`,
  unlistedList: `${EDIT_LIST_HEAD}ItemType|${EDIT_LIST_MIDDLE}Field|Property|View|SQL|${LIST_TAIL}${COMMAND_BAR_LIST}`,
};

function rulesOf(engine: Engine): EngineRules {
  if (engine === "14.0.7") return RULES_14_0_7;
  throw new NotSupportedException(`The build.xsl ordering of engine ${engine} is not built yet (IMP-020 names its groups); only 14.0.7 is.`);
}

/** The `contains(list, concat('|', @type, '|'))` test of G52 and G53. */
function listContains(list: string, type: string | null): boolean {
  return list.includes(`|${type ?? ""}|`);
}

/** `@name` of an element: null when the attribute is absent. */
function attributeOf(element: XmlElement, name: string): string | null {
  return element.hasAttribute(name) ? element.getAttribute(name) : null;
}

/** An element of no namespace with the given name: how the stylesheet's name tests match. */
export function isPlainElement(node: XmlNode, name: string): node is XmlElement {
  return node.nodeType === ELEMENT_NODE && node.nodeName === name && !(node as XmlElement).namespaceURI;
}

/** The children of an element that are plain elements of the given name, in document order. */
export function plainChildren(parent: XmlNode, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (isPlainElement(child, name)) found.push(child);
  }
  return found;
}

/** A file item with the facts the groups test. */
export interface FileItem {
  element: XmlElement;
  /** Index of the file among the files read, from 0. */
  fileIndex: number;
  /** Position among the file's items, from 1. */
  itemIndex: number;
  type: string | null;
  action: string | null;
  /** Items of the same file, earlier and later, for the sibling tests. */
  siblings: FileItem[];
}

/** XPath 1.0 `number()` of an attribute: NaN unless the text is an optionally signed decimal with optional white space around. */
export function xpathNumber(text: string | null): number {
  if (text === null || !/^[ \t\r\n]*-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)[ \t\r\n]*$/.test(text)) return Number.NaN;
  return Number.parseFloat(text);
}

/** `xsl:sort data-type="number"`: ascending, NaN before every number, NaNs and equal numbers in document order. */
function compareNumbers(a: number, b: number): number {
  if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : -1;
  if (Number.isNaN(b)) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** One output item of the plan: a file item the transform writes, or a copy of a later sibling after an add (IMP-026). */
export interface PlanEntry {
  /** Place in the output, from 1. */
  position: number;
  item: FileItem;
  /** `G01` to `G53` (`G12a` and `G12b` in 14.35), or `copy of <position>`. */
  group: string;
  /** The position of the add that carries this copy; absent for an entry a group selected. */
  copyOf?: number;
}

/** A file item that no group wrote and no add carried (IMP-029). */
export interface DroppedItem {
  item: FileItem;
  reason: string;
}

export interface BuildPlan {
  engine: Engine;
  entries: PlanEntry[];
  dropped: DroppedItem[];
  /** Every file item, in document order. */
  fileItems: FileItem[];
}

/** The file items of a wrapper document: the `Item` children of each `AML` child of the root. */
export function collectFileItems(wrapper: XmlDocument): FileItem[] {
  const root = documentElementOf(wrapper);
  const all: FileItem[] = [];
  if (!root) return all;
  plainChildren(root, "AML").forEach((fileRoot, fileIndex) => {
    const siblings: FileItem[] = plainChildren(fileRoot, "Item").map((element, index) => ({
      element,
      fileIndex,
      itemIndex: index + 1,
      type: attributeOf(element, "type"),
      action: attributeOf(element, "action"),
      siblings: [],
    }));
    for (const item of siblings) item.siblings = siblings;
    all.push(...siblings);
  });
  return all;
}

/** The `ItemType` and `RelationshipType` adds that open the template of IMP-026. */
export function isCarryingAdd(type: string | null, action: string | null): boolean {
  return (type === "ItemType" || type === "RelationshipType") && action === "add";
}

/** The `following-sibling::Item[@type='ItemType'][@action!='add']` of the template of IMP-026. */
export function isCarriedSibling(type: string | null, action: string | null): boolean {
  return type === "ItemType" && action !== null && action !== "add";
}

/**
 * The groups of `build.xsl`, in order, with what each selects (IMP-021). `select` gets all file items and returns the
 * ones the group takes, in the order the group emits them.
 */
interface Group {
  id: string;
  select: (items: readonly FileItem[], rules: EngineRules) => FileItem[];
}

const where = (test: (item: FileItem) => boolean) => (items: readonly FileItem[]) => items.filter(test);
const addOf = (type: string): Group["select"] => where((item) => item.type === type && item.action === "add");

/** `string(implementation_type)` of the first such child, empty when there is none (IMP-024). */
function implementationType(item: FileItem): string {
  const first = plainChildren(item.element, "implementation_type")[0];
  return first ? innerText(first) : "";
}

function hasEarlierAdd(item: FileItem): boolean {
  const index = item.siblings.indexOf(item);
  return item.siblings.slice(0, index).some((other) => isCarryingAdd(other.type, other.action));
}

function groupTable(): Group[] {
  const adds = (id: string, type: string): Group => ({ id, select: addOf(type) });
  const group = (id: string, select: Group["select"]): Group => ({ id, select });
  const commandBarGroups = COMMAND_BAR_TYPES.map((type, index) => adds(`G${String(20 + index)}`, type));
  return [
    adds("G01", "List"),
    adds("G02", "Sequence"),
    adds("G03", "Revision"),
    adds("G04", "Variable"),
    adds("G05", "Identity"),
    adds("G06", "Member"),
    adds("G07", "User"),
    adds("G08", "Permission"),
    adds("G09", "Method"),
    adds("G10", "EMail Message"),
    adds("G11", "Action"),
    adds("G12", "Report"),
    adds("G13", "Form"),
    adds("G14", "Workflow Map"),
    adds("G15", "Life Cycle Map"),
    adds("G16", "Grid"),
    adds("G17", "xPropertyDefinition"),
    adds("G18", "Permission_ItemClassification"),
    adds("G19", "Permission_PropertyValue"),
    ...commandBarGroups,
    adds("G31", "PresentationConfiguration"),
    group("G32", where((item) => item.type === "ItemType" && item.action === "add" && implementationType(item) !== "polymorphic")),
    group("G33", where((item) => item.type === "ItemType" && item.action === "add" && implementationType(item) === "polymorphic")),
    group("G34", (items) => {
      const relationshipTypes = items.filter((item) => item.type === "RelationshipType" && item.action === "add");
      const keyed = relationshipTypes.map((item, index) => ({ item, index, level: xpathNumber(attributeOf(item.element, "dependencyLevel")) }));
      keyed.sort((a, b) => compareNumbers(a.level, b.level) || a.index - b.index);
      return keyed.map((entry) => entry.item);
    }),
    group("G35", where((item) => item.type === "ItemType" && item.action === "edit" && !hasEarlierAdd(item))),
    adds("G36", "Morphae"),
    group("G37", where((item) => item.type === "Field")),
    group("G38", where((item) => item.type === "Property")),
    group("G39", where((item) => item.type === "View")),
    group("G40", where((item) => item.type === "SQL")),
    group("G41", where((item) => item.type === "Form" && item.action === "delete")),
    adds("G42", "Metric"),
    adds("G43", "Chart"),
    adds("G44", "Dashboard"),
    adds("G45", "ac_PolicyAccessItemAttribute"),
    adds("G46", "mp_PolicyAccessEnvAttribute"),
    adds("G47", "mp_MacPolicy"),
    group("G48", where((item) => item.type === "mp_MacPolicy" && item.action === "mp_PromoteItem")),
    adds("G49", "qry_QueryDefinition"),
    adds("G50", "dr_RelationshipFamily"),
    adds("G51", "dac_DomainDefinition"),
    group("G52", (items, rules) => items.filter((item) => item.action === "edit" && listContains(rules.editList, item.type))),
    group("G53", (items, rules) =>
      sortByTypeName(
        items.filter((item) => !listContains(rules.unlistedList, item.type)),
        (item) => item.type ?? "",
      ),
    ),
  ];
}

/**
 * Runs the groups over the file items and returns the plan: the output sequence (with the copies of IMP-026) and the items
 * dropped.
 * @spec IMP-020 IMP-021 IMP-022 IMP-023 IMP-024 IMP-025 IMP-026 IMP-027 IMP-028 IMP-029
 */
export function planBuildOrder(wrapper: XmlDocument, engine: Engine): BuildPlan {
  const rules = rulesOf(engine);
  const fileItems = collectFileItems(wrapper);
  const entries: PlanEntry[] = [];
  const written = new Set<FileItem>();

  const emit = (item: FileItem, group: string): void => {
    const entry: PlanEntry = { position: entries.length + 1, item, group };
    entries.push(entry);
    written.add(item);
    if (!isCarryingAdd(item.type, item.action)) return;
    const index = item.siblings.indexOf(item);
    for (const later of item.siblings.slice(index + 1)) {
      if (!isCarriedSibling(later.type, later.action)) continue;
      entries.push({ position: entries.length + 1, item: later, group: `copy of ${entry.position}`, copyOf: entry.position });
      written.add(later);
    }
  };

  for (const group of groupTable()) {
    for (const item of group.select(fileItems, rules)) emit(item, group.id);
  }

  const dropped: DroppedItem[] = fileItems
    .filter((item) => !written.has(item))
    .map((item) => ({ item, reason: dropReason(item, rules) }));
  return { engine, entries, dropped, fileItems };
}

/**
 * Why a file item no group selected is lost, for the plan (IMP-033).
 * @spec IMP-029 IMP-033
 */
function dropReason(item: FileItem, rules: EngineRules): string {
  if (item.type === "ItemType") return "ItemType has no action or the action is not edit or add";
  if (listContains(rules.unlistedList, item.type)) return "action not selected for this type";
  return "no group selects this type and action";
}
