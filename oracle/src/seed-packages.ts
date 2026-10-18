import { ADMINISTRATORS_ID, WORLD_ID, aml, baseId, defaultPermission, esc, item, itemTypeFile, keyedName, property, sid, src, worldAccess, type PackageFile, type ScratchPackage } from "./import-packages.js";

/**
 * The scratch packages that seed dev with the types it has no rows of, so
 * ticket 67 can export them: S6 `LIBSJS-SCRATCH-SPECIAL` and S7
 * `LIBSJS-SCRATCH-XPROP` of ticket 05's design (section 4). Built like
 * `import-packages.ts`: ids come from `sid`, files are written the way the
 * export writes them, and every top-level item is named `LIBSJS-SCRATCH-*`
 * (`LIBSJS_SCRATCH_*` for an ItemType, `xp-LIBSJS_SCRATCH_*` for an extended
 * property, whose name Aras requires to start with `xp-`).
 */

const m = (name: string) => sid(`SPECIAL:${name}`);

const NAME = "LIBSJS-SCRATCH-SPECIAL";

/** Stock ItemType ids the scratch queries refer to read-only: User and Identity. */
const USER_IT = "45E899CD2859442982EB22BB2DF683E5";
const IDENTITY_IT = "E582AB17663F4EF28460015B2BE9E094";

/** A `qry_QueryDefinition`'s query items and references as a mac condition holds them. */
function condition(filters: string[]): string {
  const ref = (n: number) => m(`ref${n}`);
  const items = filters.map(
    (f, n) =>
      `<Item type="qry_QueryItem"><item_type>${n % 2 === 0 ? USER_IT : IDENTITY_IT}</item_type><alias>Q${n}</alias><ref_id>${ref(n)}</ref_id>${f === "" ? "" : `<filter_xml>${f}</filter_xml>`}</Item>`,
  );
  const refs = filters.map((_, n) =>
    n === 0
      ? `<Item type="qry_QueryReference"><child_ref_id>${ref(0)}</child_ref_id></Item>`
      : `<Item type="qry_QueryReference"><child_ref_id>${ref(n)}</child_ref_id><parent_ref_id>${ref(0)}</parent_ref_id><ref_id>${m(`qr${n}`)}</ref_id></Item>`,
  );
  return `<Item type="qry_QueryDefinition"><Relationships>${items.join("")}${refs.join("")}</Relationships></Item>`;
}

/** Wraps text in a CDATA section the way the export does, splitting any `]]>` inside it. */
const cdata = (text: string): string => `<![CDATA[${text.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

/** mp_MacPolicy whose one condition holds two `filter_xml` blocks (rule R9). */
export function macPolicy(): PackageFile {
  const name = `${NAME}-MacPolicy_1`;
  const id = m(name);
  const filters = [
    '<condition><eq><property name="keyed_name" /><constant>LIBSJS-SCRATCH-one</constant></eq></condition>',
    '<condition><eq><property name="keyed_name" /><constant>LIBSJS-SCRATCH-two</constant></eq></condition>',
  ];
  return aml(
    "mp_MacPolicy",
    `${name}.xml`,
    item("mp_MacPolicy", id, "add", [
      "<description>scratch</description>",
      `<name>${name}</name>`,
      "<Relationships>",
      item("mp_MacCondition", null, "add", [
        `<condition_xml>${cdata(condition(filters))}</condition_xml>`,
        `<name>${name} Rule</name>`,
        `<ref_id>${m(`${name}:cond`)}</ref_id>`,
        "<sort_order>128</sort_order>",
        `<source_id keyed_name="${name}" type="mp_MacPolicy">${id}</source_id>`,
      ]),
      "</Relationships>",
    ]),
  );
}

// ---------------------------------------------------------------------------
// S7 XPROP: extended properties on a scratch ItemType, with instances.
// ---------------------------------------------------------------------------

export const XPROP = {
  name: "LIBSJS-SCRATCH-XPROP",
  instancesName: "LIBSJS-SCRATCH-XPROPINST",
  perm: "XP_Perm",
  itemType: "LIBSJS_SCRATCH_XIT",
  xp1: "xp-libsjs_scratch_xp1",
  xp2: "xp-libsjs_scratch_xp2",
  withValues: "LIBSJS-SCRATCH-XIT_Values",
  withoutValues: "LIBSJS-SCRATCH-XIT_Empty",
} as const;

const x = (name: string) => sid(`XPROP:${name}`);

/** The id the S7 package files give an item. */
export const xpropId = x;

const xpDefinition = (name: string, dataType: string, label: string): PackageFile =>
  aml(
    "xPropertyDefinition",
    `${name.replace(/^xp-libsjs_scratch_/, "LIBSJS-SCRATCH-xp_")}.xml`,
    item("xPropertyDefinition", x(name), "add", [
      "<column_alignment>left</column_alignment>",
      `<data_type>${dataType}</data_type>`,
      "<is_indexed>0</is_indexed>",
      "<is_required>0</is_required>",
      `<label xml:lang="en">${esc(label)}</label>`,
      "<private_permission_behavior>None</private_permission_behavior>",
      "<readonly>0</readonly>",
      ...(dataType === "string" ? ["<stored_length>64</stored_length>"] : []),
      "<track_history>0</track_history>",
      `<name>${name}</name>`,
    ]),
  );

/** A classification or property-value permission: Administrators may classify, or read and change values. */
const permItem = (type: "Permission_ItemClassification" | "Permission_PropertyValue", name: string): PackageFile => {
  const id = x(name);
  const access =
    type === "Permission_ItemClassification"
      ? item("Access_ItemClassification", x(`${name}.access`), "add", ["<behavior>float</behavior>", "<can_classify>1</can_classify>", "<can_get_isclassified>1</can_get_isclassified>", "<can_unclassify>1</can_unclassify>", `<related_id keyed_name="Administrators" type="Identity">${ADMINISTRATORS_ID}</related_id>`, "<sort_order>128</sort_order>", src(type, name, id)])
      : item("Access_PropertyValue", x(`${name}.access`), "add", ["<behavior>float</behavior>", "<can_change_access>1</can_change_access>", "<can_get>1</can_get>", "<can_update>1</can_update>", `<related_id keyed_name="Administrators" type="Identity">${ADMINISTRATORS_ID}</related_id>`, "<sort_order>128</sort_order>", src(type, name, id)]);
  return aml(type, `${name}.xml`, item(type, id, "add", [`<name>${name}</name>`, "<Relationships>", access, "</Relationships>"]));
};

const XTREE = {
  tree: "LIBSJS_SCRATCH_XTree",
  leaf: "LIBSJS_SCRATCH_XClass_A",
  classPerm: "LIBSJS-SCRATCH-XP_ClassPerm",
  valuePerm: "LIBSJS-SCRATCH-XP_ValuePerm",
} as const;

/** The classification tree that makes the extended properties apply: a root class and a leaf class holding both, bound to the scratch ItemType. */
function classificationTree(): PackageFile {
  const tree = x(XTREE.tree);
  const leaf = x(XTREE.leaf);
  const perms = (cls: string, clsKeyed: string, n: string): string[] => [
    item("xClass_Classification_Perm", x(`${n}.classperm`), "add", [
      `<itemtype_id keyed_name="${XPROP.itemType}" type="ItemType" name="${XPROP.itemType}">${baseId(XPROP.itemType)}</itemtype_id>`,
      `<related_id keyed_name="${XTREE.classPerm}" type="Permission_ItemClassification">${x(XTREE.classPerm)}</related_id>`,
      "<sort_order>128</sort_order>",
      src("xClass", clsKeyed, cls),
    ]),
    item("xClass_xPropValue_Perm", x(`${n}.valueperm`), "add", [
      `<itemtype_id keyed_name="${XPROP.itemType}" type="ItemType" name="${XPROP.itemType}">${baseId(XPROP.itemType)}</itemtype_id>`,
      `<related_id keyed_name="${XTREE.valuePerm}" type="Permission_PropertyValue">${x(XTREE.valuePerm)}</related_id>`,
      "<sort_order>128</sort_order>",
      src("xClass", clsKeyed, cls),
    ]),
  ];
  const xpRel = (xpName: string, order: number): string =>
    item("xClass_xPropertyDefinition", x(`leaf.${xpName}`), "add", [
      "<inactive>0</inactive>",
      "<is_required>0</is_required>",
      "<override_default_value>0</override_default_value>",
      "<override_is_required>0</override_is_required>",
      "<override_label>0</override_label>",
      "<override_readonly>0</override_readonly>",
      "<readonly>0</readonly>",
      `<related_id keyed_name="${xpName}" type="xPropertyDefinition">${x(xpName)}</related_id>`,
      `<sort_order>${order}</sort_order>`,
      src("xClass", `/${XTREE.tree}/*/${XTREE.leaf}`, leaf),
    ]);
  return aml(
    "xClassificationTree",
    `${XTREE.tree.replace("LIBSJS_SCRATCH_", "LIBSJS-SCRATCH-")}.xml`,
    item("xClassificationTree", tree, "add", [
      `<classification_hierarchy>[{"toRefId":"${tree}"},{"fromRefId":"${tree}","toRefId":"${leaf}"}]</classification_hierarchy>`,
      "<description>Scratch classification tree</description>",
      '<label xml:lang="en">Scratch tree</label>',
      `<name>${XTREE.tree}</name>`,
      "<select_only_leaf_class>1</select_only_leaf_class>",
      "<select_only_single_class>1</select_only_single_class>",
      `<item_number>${XTREE.tree}</item_number>`,
      "<Relationships>",
      item("xClass", tree, "add", [
        '<label xml:lang="en">Scratch tree</label>',
        `<name>${XTREE.tree}</name>`,
        `<ref_id>${tree}</ref_id>`,
        "<sort_order>128</sort_order>",
        src("xClassificationTree", XTREE.tree, tree),
        "<xproperties_sort_order />",
        "<Relationships>",
        ...perms(tree, `/${XTREE.tree}`, "root"),
        "</Relationships>",
      ]),
      item("xClass", leaf, "add", [
        '<label xml:lang="en">Class A</label>',
        `<name>${XTREE.leaf}</name>`,
        `<ref_id>${leaf}</ref_id>`,
        "<sort_order>256</sort_order>",
        src("xClassificationTree", XTREE.tree, tree),
        `<xproperties_sort_order>${x(XPROP.xp1)},${x(XPROP.xp2)}</xproperties_sort_order>`,
        "<Relationships>",
        ...perms(leaf, `/${XTREE.tree}/*/${XTREE.leaf}`, "leaf"),
        xpRel(XPROP.xp1, 128),
        xpRel(XPROP.xp2, 256),
        "</Relationships>",
      ]),
      item("xClassificationTree_ItemType", x("tree.itemtype"), "add", [
        `<related_id keyed_name="${XPROP.itemType}" type="ItemType" name="${XPROP.itemType}">${baseId(XPROP.itemType)}</related_id>`,
        "<sort_order>128</sort_order>",
        src("xClassificationTree", XTREE.tree, tree),
      ]),
      "</Relationships>",
    ]),
  );
}

/** Who may add instances: a type bound to extended properties is checked against Can Add, unlike S1's. */
const canAdd = (itName: string): string =>
  item("Can Add", x(`${itName}.canadd`), "add", [
    "<can_add>1</can_add>",
    `<related_id keyed_name="World" type="Identity">${WORLD_ID}</related_id>`,
    "<sort_order>128</sort_order>",
    src("ItemType", itName, baseId(itName)),
  ]);

/** A scratch ItemType with two extended properties. */
export function xprop(): ScratchPackage {
  const permId = baseId(XPROP.perm);
  const permName = `LIBSJS-SCRATCH-${XPROP.perm}`;
  const files: PackageFile[] = [
    aml(
      "Permission",
      `${permName}.xml`,
      item("Permission", permId, "add", [
        "<is_private>0</is_private>",
        `<name>${permName}</name>`,
        "<Relationships>",
        worldAccess(XPROP.perm, permId, 256, false),
        worldAccess(XPROP.perm, permId, 128, true),
        "</Relationships>",
      ]),
    ),
    itemTypeFile(XPROP.itemType, {
      body: [defaultPermission(XPROP.itemType, XPROP.perm), canAdd(XPROP.itemType), keyedName(XPROP.itemType), property(XPROP.itemType, "title", 128)],
    }),
    xpDefinition(XPROP.xp1, "string", "Scratch text"),
    xpDefinition(XPROP.xp2, "integer", "Scratch number"),
    permItem("Permission_ItemClassification", XTREE.classPerm),
    permItem("Permission_PropertyValue", XTREE.valuePerm),
    classificationTree(),
  ];
  return { name: XPROP.name, files };
}

/** An instance joins the class through the relationship type the server generated when the tree was bound to the ItemType. */
const classification = (id: string): string =>
  [
    "<Relationships>",
    item(`${XPROP.itemType}_xClass`, x(`${id}.class`), "add", [`<related_id keyed_name="${XTREE.leaf}" type="xClass">${x(XTREE.leaf)}</related_id>`, "<sort_order>128</sort_order>", src(XPROP.itemType, id, x(id))]),
    "</Relationships>",
  ].join("\n");

/** The instances, imported in a second run: the server only lets a type be added to once it has been loaded by a later request. */
export function xpropInstances(): ScratchPackage {
  return {
    name: XPROP.instancesName,
    files: [
      aml(
        XPROP.itemType,
        `${XPROP.withValues}.xml`,
        item(XPROP.itemType, x(XPROP.withValues), "add", [`<name>${XPROP.withValues}</name>`, "<title>values</title>", classification(XPROP.withValues)]),
      ),
      aml(XPROP.itemType, `${XPROP.withoutValues}.xml`, item(XPROP.itemType, x(XPROP.withoutValues), "add", [`<name>${XPROP.withoutValues}</name>`, "<title>empty</title>"])),
    ],
  };
}

// ---------------------------------------------------------------------------
// S6 SPECIAL, derived relationships: a query definition, a relationship
// family built on it with a dr_Relationship, and an event handler with
// event_data. The server computes a dr_Relationship's implementation_query
// when its family is activated (promoted) and drops one sent with an add, so
// `implementationQuery()` sets it with a later edit.
// ---------------------------------------------------------------------------

const d = (name: string) => sid(`SPECIAL:dr:${name}`);

export const DR = {
  query: "LIBSJS-SCRATCH-DrQuery",
  family: "LIBSJS-SCRATCH-DrFamily",
  relationship: "LIBSJS-SCRATCH-DrRel",
  method: "LIBSJS-SCRATCH-DrHandler",
} as const;

/** The id of the dr_Relationship the family file creates inside its dr_FamilyElement (it is nested, so the import's cleanup does not know it). */
export const drRelationshipId = (): string => d(DR.relationship);

const QSRC = src("qry_QueryDefinition", DR.query, d(DR.query));
const FILTER = (inner: string): string => `<![CDATA[<condition>\n\t${inner}\n</condition>]]>`;

/** The stock "User Identities" query (User, Alias, Identity, Member) under scratch ids. */
function queryDefinition(): PackageFile {
  const qi = (name: string, itemType: string, itemTypeId: string, order: number, alias: string): string =>
    item("qry_QueryItem", d(`qi.${name}`), "add", [
      `<item_type keyed_name="${itemType}" type="ItemType" name="${itemType}">${itemTypeId}</item_type>`,
      `<ref_id>${d(`ref.${name}`)}</ref_id>`,
      `<sort_order>${order}</sort_order>`,
      QSRC,
      `<alias>${alias}</alias>`,
    ]);
  const qr = (name: string, child: string, parent: string | null, filter: string | null, order: number): string =>
    item("qry_QueryReference", d(`qr.${name}`), "add", [
      `<child_ref_id>${d(`ref.${child}`)}</child_ref_id>`,
      ...(filter === null ? [] : [`<filter_xml>${FILTER(filter)}</filter_xml>`]),
      ...(parent === null ? [] : [`<parent_ref_id>${d(`ref.${parent}`)}</parent_ref_id>`, `<ref_id>${d(`qrref.${name}`)}</ref_id>`]),
      `<sort_order>${order}</sort_order>`,
      QSRC,
    ]);
  const eq = (a: string, b: string, aXpath = false): string => `<eq>\n\t\t<property name="${a}"${aXpath ? ' query_items_xpath="parent::Item"' : ""} />\n\t\t<property name="${b}" />\n\t</eq>`;
  return aml(
    "qry_QueryDefinition",
    `${DR.query}.xml`,
    item("qry_QueryDefinition", d(DR.query), "add", [
      "<description>Scratch query definition for a derived relationship family.</description>",
      `<name>${DR.query}</name>`,
      "<Relationships>",
      qi("user", "User", USER_IT, 128, "User"),
      qi("alias", "Alias", "4E355E04444B4676AE723B43DECA37DC", 256, "Alias"),
      qi("identity", "Identity", IDENTITY_IT, 384, "Identity"),
      qi("member", "Member", "7348E620D27E40D1868C54247B5DE8D1", 512, "Member related_id"),
      qr("user", "user", null, null, 128),
      qr("alias", "alias", "user", eq("id", "source_id", true), 256),
      qr("identity", "identity", "alias", `<or>\n\t\t<eq>\n\t\t\t<property name="related_id" query_items_xpath="parent::Item" />\n\t\t\t<property name="id" />\n\t\t</eq>\n\t\t<eq>\n\t\t\t<property name="name" />\n\t\t\t<constant>World</constant>\n\t\t</eq>\n\t</or>`, 384),
      qr("member", "member", "identity", eq("id", "related_id", true), 512),
      qr("memberidentity", "identity", "member", eq("source_id", "id", true), 640),
      "</Relationships>",
    ]),
  );
}

export const EVENT_DATA = '{"scratch":true,\n  "note":"event data"}';

function handlerMethod(): PackageFile {
  return aml(
    "Method",
    `${DR.method}.xml`,
    item("Method", d(DR.method), "add", [
      `<execution_allowed_to keyed_name="World" type="Identity">${WORLD_ID}</execution_allowed_to>`,
      "<method_code><![CDATA[return this;]]></method_code>",
      "<method_type>JavaScript</method_type>",
      `<name>${DR.method}</name>`,
    ]),
  );
}

function relationshipFamily(): PackageFile {
  const fam = d(DR.family);
  const famSrc = src("dr_RelationshipFamily", DR.family, fam);
  const element = d("element");
  return aml(
    "dr_RelationshipFamily",
    `${DR.family}.xml`,
    item("dr_RelationshipFamily", fam, "add", [
      "<description>Scratch derived relationship family.</description>",
      "<drs_persistent_type>Persistent</drs_persistent_type>",
      "<prevent_default_event_handlers>1</prevent_default_event_handlers>",
      `<query_definition_id keyed_name="${DR.query}" type="qry_QueryDefinition">${d(DR.query)}</query_definition_id>`,
      `<name>${DR.family}</name>`,
      "<Relationships>",
      item("dr_FamilyElement", element, "add", [
        `<dr_relationship_id keyed_name="${DR.relationship}" type="dr_Relationship">`,
        item("dr_Relationship", d(DR.relationship), "add", [
          `<departure_itemtype_id keyed_name="User" type="ItemType" name="User">${USER_IT}</departure_itemtype_id>`,
          "<description>Scratch derived relationship.</description>",
          `<destination_itemtype_id keyed_name="Identity" type="ItemType" name="Identity">${IDENTITY_IT}</destination_itemtype_id>`,
          `<name>${DR.relationship}</name>`,
        ]),
        "</dr_relationship_id>",
        "<sort_order>128</sort_order>",
        famSrc,
        "<Relationships>",
        item("dr_FamilyElement qry_QueryItem", d("fe.qi1"), "add", [`<parent_query_reference_ref_id>${d("qrref.identity")}</parent_query_reference_ref_id>`, "<sort_order>128</sort_order>", src("dr_FamilyElement", element, element)]),
        item("dr_FamilyElement qry_QueryItem", d("fe.qi2"), "add", [`<parent_query_reference_ref_id>${d("qrref.memberidentity")}</parent_query_reference_ref_id>`, "<sort_order>256</sort_order>", src("dr_FamilyElement", element, element)]),
        "</Relationships>",
      ]),
      item("dr_FamilyEventHandler", d("handler"), "add", [
        `<event_data>${esc(EVENT_DATA)}</event_data>`,
        `<event_handler_id keyed_name="${DR.method}" type="Method">${d(DR.method)}</event_handler_id>`,
        "<event_type>OnAfterPersistRelationships</event_type>",
        "<sort_order>128</sort_order>",
        famSrc,
      ]),
      "</Relationships>",
    ]),
  );
}

export function derivedRelationships(): PackageFile[] {
  return [queryDefinition(), handlerMethod(), relationshipFamily()];
}

/**
 * The server computes a dr_Relationship's implementation_query when its family is
 * activated and drops one sent with an add, but it keeps one sent in an edit, after
 * checking that the query's leaf is the relationship's destination ItemType.
 */
export function implementationQuery(): ScratchPackage {
  const ref = (n: string) => sid(`SPECIAL:dr:impl.${n}`);
  const query = [
    '<Item type="qry_QueryDefinition">',
    "\t<Relationships>",
    '\t\t<Item type="qry_QueryItem">',
    `\t\t\t<item_type>${USER_IT}</item_type>`,
    "\t\t\t<alias>User</alias>",
    `\t\t\t<ref_id>${ref("user")}</ref_id>`,
    "\t\t</Item>",
    '\t\t<Item type="qry_QueryItem">',
    `\t\t\t<item_type>${IDENTITY_IT}</item_type>`,
    "\t\t\t<alias>Identity</alias>",
    `\t\t\t<ref_id>${ref("identity")}</ref_id>`,
    "\t\t</Item>",
    '\t\t<Item type="qry_QueryReference">',
    `\t\t\t<child_ref_id>${ref("user")}</child_ref_id>`,
    "\t\t</Item>",
    '\t\t<Item type="qry_QueryReference">',
    `\t\t\t<child_ref_id>${ref("identity")}</child_ref_id>`,
    '\t\t\t<filter_xml><![CDATA[<condition>\n\t<eq>\n\t\t<property name="id" query_items_xpath="parent::Item" />\n\t\t<property name="id" />\n\t</eq>\n</condition>]]></filter_xml>',
    `\t\t\t<parent_ref_id>${ref("user")}</parent_ref_id>`,
    `\t\t\t<ref_id>${ref("ref")}</ref_id>`,
    "\t\t</Item>",
    "\t</Relationships>",
    "</Item>",
  ].join("\n");
  return {
    name: "LIBSJS-SCRATCH-DRIMPL",
    files: [aml("dr_Relationship", `${DR.relationship}_Impl.xml`, item("dr_Relationship", drRelationshipId(), "edit", [`<implementation_query>${esc(query)}</implementation_query>`, `<name>${DR.relationship}</name>`]))],
  };
}

// ---------------------------------------------------------------------------
// S6 SPECIAL, access control: ac_PolicyAccessItemAttribute with a definition
// that points at the family's dr_Relationship, and a dac_DomainDefinition on
// the family with a sub-domain permission whose condition holds non-ASCII text.
// ---------------------------------------------------------------------------

export const AC = { attribute: "LIBSJS_SCRATCH_AcAttribute", domain: "LIBSJS_SCRATCH_DacDomain", permission: "LIBSJS-SCRATCH-DacPerm" } as const;

const ac = (name: string) => sid(`SPECIAL:ac:${name}`);

export function accessAttribute(): PackageFile {
  const id = ac(AC.attribute);
  return aml(
    "ac_PolicyAccessItemAttribute",
    `${AC.attribute.replace("LIBSJS_SCRATCH_", "LIBSJS-SCRATCH-")}.xml`,
    item("ac_PolicyAccessItemAttribute", id, "add", [
      "<description>Scratch item attribute.</description>",
      `<name>${AC.attribute}</name>`,
      "<type>string</type>",
      "<Relationships>",
      item("ac_PolicyAccessAttrDefinition", ac("definition"), "add", [
        `<defined_on_itemtype_id keyed_name="User" type="ItemType" name="User">${USER_IT}</defined_on_itemtype_id>`,
        `<dr_relationship_id keyed_name="${DR.relationship}" type="dr_Relationship">${drRelationshipId()}</dr_relationship_id>`,
        "<property_name>name</property_name>",
        "<sort_order>128</sort_order>",
        src("ac_PolicyAccessItemAttribute", AC.attribute, id),
      ]),
      "</Relationships>",
    ]),
  );
}

/** The permission a sub-domain grants. */
export function domainPermission(): PackageFile {
  const id = ac(AC.permission);
  return aml(
    "Permission",
    `${AC.permission}.xml`,
    item("Permission", id, "add", [
      "<is_private>0</is_private>",
      `<name>${AC.permission}</name>`,
      "<Relationships>",
      worldAccess(AC.permission, id, 128, true),
      "</Relationships>",
    ]),
  );
}

/** A condition with text a naive round trip would damage: an e with an acute accent and a no-break space. */
export const DOMAIN_CONDITION =
  '<condition><method_call><method_name>MacPolicy.CurrentItem.HasUserVisibilityPolicyAccess</method_name><params><param><constant>caf\u00e9\u00a0au lait</constant></param></params></method_call></condition>';

export function domainDefinition(): PackageFile {
  const id = ac(AC.domain);
  const policy = ac("policy");
  return aml(
    "dac_DomainDefinition",
    `${AC.domain.replace("LIBSJS_SCRATCH_", "LIBSJS-SCRATCH-")}.xml`,
    item("dac_DomainDefinition", id, "add", [
      "<description>Scratch domain definition.</description>",
      `<dr_relationshipfamily_id keyed_name="${DR.family}" type="dr_RelationshipFamily">${d(DR.family)}</dr_relationshipfamily_id>`,
      `<name>${AC.domain}</name>`,
      "<Relationships>",
      item("dac_SubdomainPolicy", policy, "add", [
        `<dr_relationship_id keyed_name="${DR.relationship}" type="dr_Relationship">${drRelationshipId()}</dr_relationship_id>`,
        "<sort_order>128</sort_order>",
        src("dac_DomainDefinition", AC.domain, id),
        "<Relationships>",
        item("dac_SubdomainPermission", ac("subperm"), "add", [
          `<condition_xml>${esc(DOMAIN_CONDITION)}</condition_xml>`,
          "<sort_order>128</sort_order>",
          src("dac_SubdomainPolicy", policy, policy),
          `<subdomain_permission_id keyed_name="${AC.permission}" type="Permission">${ac(AC.permission)}</subdomain_permission_id>`,
        ]),
        "</Relationships>",
      ]),
      "</Relationships>",
    ]),
  );
}

// ---------------------------------------------------------------------------
// S6 SPECIAL, content modelling: a scratch ItemType with a cmf_ContentType on
// it (one element type with one property type), and a cmf_TabularView.
// The server generates schema for a content type when it is added, so the
// cleanup deletes the content type before the ItemType it is linked to.
// ---------------------------------------------------------------------------

export const CMF = {
  itemType: "LIBSJS_SCRATCH_CMFIT",
  perm: "CMF_Perm",
  content: "LIBSJS_SCRATCH_CmfContent",
  element: "LIBSJS_SCRATCH_CmfElement",
  property: "LIBSJS_SCRATCH_CmfProp",
  view: "LIBSJS_SCRATCH_CmfView",
} as const;

const c = (name: string) => sid(`SPECIAL:cmf:${name}`);

/** The ItemType the content type is linked to. */
export function cmfItemType(): PackageFile[] {
  const permId = baseId(CMF.perm);
  const permName = `LIBSJS-SCRATCH-${CMF.perm}`;
  return [
    aml(
      "Permission",
      `${permName}.xml`,
      item("Permission", permId, "add", ["<is_private>0</is_private>", `<name>${permName}</name>`, "<Relationships>", worldAccess(CMF.perm, permId, 256, false), worldAccess(CMF.perm, permId, 128, true), "</Relationships>"]),
    ),
    itemTypeFile(CMF.itemType, { body: [defaultPermission(CMF.itemType, CMF.perm), keyedName(CMF.itemType), property(CMF.itemType, "title", 128)] }),
  ];
}

const flat = (name: string) => name.replace("LIBSJS_SCRATCH_", "LIBSJS-SCRATCH-");

export function contentType(): PackageFile {
  const id = c(CMF.content);
  const elem = c(CMF.element);
  return aml(
    "cmf_ContentType",
    `${flat(CMF.content)}.xml`,
    item("cmf_ContentType", id, "add", [
      `<linked_item_type keyed_name="${CMF.itemType}" type="ItemType" name="${CMF.itemType}">${baseId(CMF.itemType)}</linked_item_type>`,
      `<name>${CMF.content}</name>`,
      "<Relationships>",
      item("cmf_ElementType", elem, "add", [
        `<name>${CMF.element}</name>`,
        "<sort_order>128</sort_order>",
        src("cmf_ContentType", CMF.content, id),
        "<Relationships>",
        item("cmf_PropertyType", c(CMF.property), "add", [
          "<data_length>64</data_length>",
          "<data_type>string</data_type>",
          `<name>${CMF.property}</name>`,
          "<sort_order>128</sort_order>",
          src("cmf_ElementType", CMF.element, elem),
        ]),
        "</Relationships>",
      ]),
      "</Relationships>",
    ]),
  );
}

/** The id the content type file gives the property type nested in its element type. */
export const cmfPropertyId = (): string => c(CMF.property);

/** Imported after the content type: its column points at the content type's property type. */
export function tabularView(): ScratchPackage {
  const id = c(CMF.view);
  return {
    name: "LIBSJS-SCRATCH-CMFVIEW",
    files: [
      aml(
        "cmf_TabularView",
        `${flat(CMF.view)}.xml`,
        item("cmf_TabularView", id, "add", [
          `<name>${CMF.view}</name>`,
          "<Relationships>",
          item("cmf_TabularViewColumn", c(`${CMF.view}.col1`), "add", [
            "<col_order>1</col_order>",
            '<header xml:lang="en">Scratch column</header>',
            "<initial_width>120</initial_width>",
            `<property keyed_name="${CMF.property}" type="cmf_PropertyType">${cmfPropertyId()}</property>`,
            "<sort_order>128</sort_order>",
            src("cmf_TabularView", CMF.view, id),
          ]),
          "</Relationships>",
        ]),
      ),
    ],
  };
}

/** Imported after the family exists: both refer to its dr_Relationship, which the server looks up when they are added. */
export function access(): ScratchPackage {
  return { name: "LIBSJS-SCRATCH-ACCESS", files: [accessAttribute(), domainPermission(), domainDefinition()] };
}


// ---------------------------------------------------------------------------
// S6 SPECIAL, composed: two import steps, because the access-control and
// tabular-view items look up what the first step creates when they are added.
// ---------------------------------------------------------------------------

export const SPECIAL = { name: NAME, macPolicy: `${NAME}-MacPolicy_1` } as const;

/** Step 1: the mac policy, the derived relationship family, and the ItemType with its content type. */
export function special(): ScratchPackage {
  return { name: NAME, files: [macPolicy(), ...derivedRelationships(), ...cmfItemType(), contentType()] };
}

/** Step 2: the access control items, and the tabular view, in two packages. */
export const specialStepTwo = (): ScratchPackage[] => [access(), tabularView()];

export const specialIds = {
  drFamily: d(DR.family),
  acAttribute: ac(AC.attribute),
  dacDomain: ac(AC.domain),
  cmfItemType: baseId(CMF.itemType),
} as const;

