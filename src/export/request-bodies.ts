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

function serialize(item: BodyItem): string {
  const attributes: Array<[string, string]> = [
    ["type", item.type],
    ["action", "get"],
  ];
  if (item.noRelatedExpand) attributes.push(["related_expand", "0"]);
  const related = item.relatedId ? element("related_id", [], serialize(item.relatedId)) : "";
  const relationships = item.relationships ? element("Relationships", [], item.relationships.map(serialize).join("")) : "";
  return element("Item", attributes, related === "" && relationships === "" ? undefined : related + relationships);
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

const relationships = (items: readonly BodyItem[]): string => element("Relationships", [], items.map(serialize).join(""));

/**
 * The `Relationships` element of an ItemType fetch (EXP-024). A server below major version 11 gets the older body,
 * which has no `DiscussionTemplate` subtree, `ITPresentationConfiguration` or `ItemType_xPropertyDefinition`.
 *
 * @spec EXP-024
 */
export function itemTypeBody(serverMajor: number): string {
  if (serverMajor < 11) return relationships(ITEM_TYPE_BODY_HEAD);
  return relationships([DISCUSSION_TEMPLATE, IT_PRESENTATION_CONFIGURATION, ...ITEM_TYPE_BODY_HEAD, leaf("ItemType_xPropertyDefinition")]);
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
  return relationships(typeName === "cmf_ContentType" ? CONTENT_TYPE_BODY : TABULAR_VIEW_BODY);
}
