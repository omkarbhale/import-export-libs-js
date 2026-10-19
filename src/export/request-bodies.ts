import { element } from "../client/request-text.js";

/**
 * One `Item` of a request body: its type, what the item holds as `related_id`, its own relationships, and
 * `related_expand="0"` where the body asks for it. Each is written `<Item type="T" action="get" />` unless it has
 * content.
 */
interface BodyItem {
  readonly type: string;
  readonly noRelatedExpand?: true;
  readonly relatedId?: BodyItem;
  readonly relationships?: readonly BodyItem[];
}

const leaf = (type: string): BodyItem => ({ type });
const withRelationships = (type: string, ...relationships: BodyItem[]): BodyItem => ({ type, relationships });
const withRelatedId = (type: string, relatedId: BodyItem): BodyItem => ({ type, relatedId });

/**
 * The `select` of each `Item` of a body, taken one by one in document order (LP-125). An item with no entry, or an undefined one,
 * keeps the attributes it has.
 */
type Selects = Iterator<string | undefined>;

function serialize(item: BodyItem, selects?: Selects): string {
  const attributes: Array<[string, string]> = [
    ["type", item.type],
    ["action", "get"],
  ];
  if (item.noRelatedExpand) attributes.push(["related_expand", "0"]);
  const select = selects?.next().value;
  if (select !== undefined) attributes.push(["select", select]);
  const related = item.relatedId ? element("related_id", [], serialize(item.relatedId, selects)) : "";
  const relationships = item.relationships ? element("Relationships", [], item.relationships.map((child) => serialize(child, selects)).join("")) : "";
  return element("Item", attributes, related === "" && relationships === "" ? undefined : related + relationships);
}

/** The types of the `Item` elements of a body in document order: an item, then its `related_id`, then its relationships. */
function typesInDocumentOrder(items: readonly BodyItem[]): string[] {
  return items.flatMap((item) => [item.type, ...typesInDocumentOrder(item.relatedId ? [item.relatedId] : []), ...typesInDocumentOrder(item.relationships ?? [])]);
}

const memberOfIdentity = withRelationships("Identity", leaf("Member"));

const DISCUSSION_TEMPLATE = withRelationships(
  "DiscussionTemplate",
  withRelationships("FeedTemplate", leaf("FileSelectorTemplate")),
  withRelatedId("DiscussionTemplateView", leaf("SSVCPresentationConfiguration")),
);
const IT_PRESENTATION_CONFIGURATION: BodyItem = { type: "ITPresentationConfiguration", noRelatedExpand: true };
/** The items both ItemType bodies share, after `ITPresentationConfiguration` and before `ItemType_xPropertyDefinition`. */
const ITEM_TYPE_BODY_HEAD: readonly BodyItem[] = [
  withRelationships("Property", leaf("Grid Event")),
  leaf("RelationshipType"),
  withRelatedId("View", withRelationships("Form", leaf("Body"))),
  leaf("Server Event"),
  leaf("Item Action"),
  leaf("ItemType Life Cycle"),
  leaf("Allowed Workflow"),
  withRelatedId("TOC Access", memberOfIdentity),
  leaf("TOC View"),
  leaf("Client Event"),
  withRelatedId("Can Add", memberOfIdentity),
  withRelatedId("Allowed Permission", withRelationships("Permission", leaf("Access"))),
  leaf("Item Report"),
  leaf("Morphae"),
];

const relationships = (items: readonly BodyItem[], selects?: Selects): string =>
  element("Relationships", [], items.map((item) => serialize(item, selects)).join(""));

/**
 * A body of request items together with what the language modes need to put a `select` on each of its `Item` elements (LP-125):
 * the types in the order the engine visits them, and the text once the selects are known.
 */
export interface Body {
  /** The `type` of every `Item` of the body, in document order. */
  readonly types: readonly string[];
  /** The `Relationships` element, with `selects[i]` set on the i-th `Item` when it is defined. */
  text(selects?: ReadonlyArray<string | undefined>): string;
}

const asBody = (items: readonly BodyItem[]): Body => ({
  types: typesInDocumentOrder(items),
  text: (selects) => relationships(items, selects?.values()),
});

/**
 * The `Relationships` element of an ItemType fetch (EXP-024). A server below major version 11 gets the older body,
 * which has no `DiscussionTemplate` subtree, `ITPresentationConfiguration` or `ItemType_xPropertyDefinition`.
 *
 * @spec EXP-024
 */
export function itemTypeBody(serverMajor: number): string {
  return itemTypeBodyOf(serverMajor).text();
}

/** {@link itemTypeBody} as a body whose items can take a `select` each (LP-125). */
export function itemTypeBodyOf(serverMajor: number): Body {
  if (serverMajor < 11) return asBody(ITEM_TYPE_BODY_HEAD);
  return asBody([DISCUSSION_TEMPLATE, IT_PRESENTATION_CONFIGURATION, ...ITEM_TYPE_BODY_HEAD, leaf("ItemType_xPropertyDefinition")]);
}

const CONTENT_TYPE_BODY: readonly BodyItem[] = [
  leaf("cmf_ContentTypeView"),
  withRelationships(
    "cmf_ElementType",
    leaf("cmf_ElementAllowedPermission"),
    withRelationships("cmf_ElementBinding", leaf("cmf_PropertyBinding")),
    withRelationships("cmf_PropertyType", leaf("cmf_ComputedProperty"), leaf("cmf_PropertyAllowedPermission")),
  ),
  leaf("cmf_ContentTypeExportRel"),
  leaf("cmf_DocumentLifeCycleState"),
];

const TABULAR_VIEW_BODY: readonly BodyItem[] = [
  withRelationships("cmf_TabularViewColumn", leaf("cmf_AdditionalPropertyType")),
  withRelatedId("cmf_TabularViewHeaderRows", withRelationships("cmf_TabularViewHeaderRow", leaf("cmf_TabularViewColumnGroups"))),
  leaf("cmf_TabularViewTree"),
];

/**
 * The `Relationships` element of a `cmf_ContentType` or `cmf_TabularView` fetch (EXP-025).
 *
 * @spec EXP-025
 */
export function cmfBody(typeName: "cmf_ContentType" | "cmf_TabularView"): string {
  return cmfBodyOf(typeName).text();
}

/** {@link cmfBody} as a body whose items can take a `select` each (LP-125). */
export function cmfBodyOf(typeName: "cmf_ContentType" | "cmf_TabularView"): Body {
  return asBody(typeName === "cmf_ContentType" ? CONTENT_TYPE_BODY : TABULAR_VIEW_BODY);
}
