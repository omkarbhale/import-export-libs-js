import type { HostValue } from "./record.js";

/**
 * The 14.0.7 export fixture catalogue (ticket 05's cases E01 to E56 and P1 to
 * P5, plus its option matrix), as the input of `npm run oracle:export-cases`.
 * The items are dev's own, read-only. Cases that need scratch state on dev
 * (cmf_ContentType, cmf_TabularView, dac_DomainDefinition,
 * ac_PolicyAccessItemAttribute, xp-* values, dr `event_data`, several
 * `filter_xml`, referenced elements, the last-segment collision) are recorded
 * by ticket 67 after ticket 25, and are not here.
 */

export interface ExportCaseItem {
  type: string;
  id: string;
  /** What the host passes as the item's keyed name. For a packaged item this is the PackageElement name. */
  keyedName: string;
}

export interface ExportCasePackage {
  name: string;
  /** In `Hashtable` insertion order. */
  items: ExportCaseItem[];
}

/** The engine options a case sets; anything unset keeps the engine's default. */
export interface ExportCaseOptions {
  level?: string;
  exportReferencedItems?: true;
  refToUnknownPacks?: "DoNotRemove" | "RemoveSilently" | "RemoveWithWarning";
  useImport?: true;
  verbose?: true;
  timeout?: number;
  errorQuestionAnswer?: "yes" | "no" | "none";
  /** 14.35 only: the engine's `Context.Action` (the host's default is `Export`). */
  engineAction?: "Export" | "ExportLanguageResourcesOnly" | "ExportMetadataWithLanguageResources";
  /** 14.35 only: `Context.Languages` as the host sets it. */
  languages?: string[];
  /** 14.35 only: press `ImportExportManager.Cancel()` once this many status messages have been delivered. */
  cancelAfterStatus?: number;
}

export interface ExportCase {
  /** The folder under fixtures/14.0.7/export/. */
  id: string;
  /** Ticket 05's labels (E01, P1, an option-matrix row). */
  catalogue: string[];
  title: string;
  /** The spec areas the case exercises (ticket 05's "Exercises" column). */
  exercises: string;
  /**
   * Packages in `Hashtable` insertion order: the host inserts each item's
   * package on first sight, then the item under its id, in this order.
   */
  packages: ExportCasePackage[];
  options?: ExportCaseOptions;
  /** The engine is expected to end the run with an error (the case pins that path). */
  expectsError?: true;
  /** What the case needs from dev beyond a plain read, or what it does not cover. */
  note?: string;
  /** The spec rules that pin the case (14.35 cases name them; the 14.0.7 catalogue predates the rules). */
  rules?: readonly string[];
}

const P = "com.aras.innovator.";

const item = (type: string, id: string, keyedName: string): ExportCaseItem => ({ type, id, keyedName });
const pkg = (name: string, ...items: ExportCaseItem[]): ExportCasePackage => ({ name, items });

function single(
  id: string,
  catalogue: string,
  title: string,
  exercises: string,
  packageName: string,
  entry: ExportCaseItem,
  extra: Partial<Pick<ExportCase, "options" | "note" | "expectsError">> = {},
): ExportCase {
  return { id, catalogue: [catalogue], title, exercises, packages: [pkg(packageName, entry)], ...extra };
}

/** A small stock item per package, for the multi-package cases. */
const SMALL = {
  admin: pkg(`${P}admin`, item("Item Report", "128C30A645F04E5380F8B4709A3BD1A1", "128C30A645F04E5380F8B4709A3BD1A1")),
  core: pkg(`${P}core`, item("Form", "F288A3345225407EACBC936191097BCD", "Activity Template")),
  cui: pkg(`${P}cui`, item("ItemType", "58AECE23031E496FB04FFDEA6EDEF8A0", "PresentableItems")),
  history: pkg(`${P}history`, item("Grid", "4B9FF34674E34677B877FC8F71B5CDBE", "History_whereTemplateUsed")),
  es: pkg(`${P}es`, item("Variable", "18C614579E6D45468B90F5E9103AA153", "ES_SolrUrl")),
  conversion: pkg(`${P}conversion`, item("Identity", "694C8B27E5D940DAA8BD336E45EC3A63", "Conversion Manager")),
};

const E53 = item("CommandBarSection", "0212985C3E90930D618120D9625E4BB8", "Language_TOC_Content");
const E14 = item("List", "01B506E02528434DB36D562A3FAB826D", "cmf_DocumentPropertyDataType");
const E06 = item("ItemType", "A22EC0C6A1B940FB94654AB060F21459", "ScopeCacheDependency");
const E02 = item("ItemType", "4F1AC04A2B484F3ABA4E20DB63808A88", "Part");
const E24 = item("Grid", "4B9FF34674E34677B877FC8F71B5CDBE", "History_whereTemplateUsed");
const DUMMY = item("Workflow Promotion", "00000000000000000000000000000001", "Nope Promotion");

export const EXPORT_CASES: readonly ExportCase[] = [
  // ---- 2.1 ItemType and RelationshipType ----
  single(
    "e01-change-controlled-item",
    "E01",
    "ItemType: polymorphic and versionable (Change Controlled Item)",
    "Polymorphic and versionable ItemType: the base-ItemType request body, the cmf probe, the Morphae re-emitted as an ItemType edit, the poly-list data_source rewrite, the effective/release/superseded_date Property drop when versionable, and the mode=fix ItemType edit.",
    `${P}solution.PLM`,
    item("ItemType", "198BF0BCCC364EE29F56434D803D5F1E", "Change Controlled Item"),
  ),
  single(
    "e02-part-itemtype",
    "E02",
    "ItemType: Part (versionable table, Grid Event on a system Property)",
    "Versionable table ItemType. A Grid Event on the system Property major_rev, so the Grid Event source_id becomes a get subquery. DiscussionTemplate and FeedTemplate relationships. RelationshipType relationships dropped. Permission default-match removal.",
    `${P}solution.PLM`,
    E02,
  ),
  single(
    "e03-cad-itemtype",
    "E03",
    "ItemType: CAD (reference holding XML markup)",
    "A FileSelectorTemplate reference that holds XML markup becomes CDATA through disable-output-escaping. Also plain references.",
    `${P}solution.PLM`,
    item("ItemType", "CCF205347C814DD1AF056875E0A880AC", "CAD"),
  ),
  single(
    "e04-design-to-goal",
    "E04",
    "ItemType: no View (Design To Goal)",
    "An ItemType with no View, so the View and Form delete fix items. The element name's case differs from the ItemType name 'Design to Goal'.",
    `${P}solution.PLM`,
    item("ItemType", "8E3CFB68CF2B42A39ABBE2A8B31D006B", "Design To Goal"),
  ),
  single(
    "e05-affected-item",
    "E05",
    "ItemType: foreign Properties (Affected Item)",
    "The foreign Properties affected_rev and new_item_rev become data_source and foreign_property subqueries.",
    `${P}solution.PLM`,
    item("ItemType", "BFAAB0F6838D4F80BF12CB328FF5B097", "Affected Item"),
  ),
  single(
    "e06-scopecachedependency-donotremove",
    "E06",
    "ItemType: reference to an unknown package, DoNotRemove (ScopeCacheDependency)",
    "The only dev case for RefToUnknownPacks removal: two Server Events relate to Method effs_scopeCacheInvalidOnAddItem in solution.PlmEffectivity, a package that configurator does not depend on. DoNotRemove is the engine default; the request group for unknown packages is still sent.",
    `${P}configurator`,
    E06,
    { options: { refToUnknownPacks: "DoNotRemove" } },
  ),
  single(
    "e06-scopecachedependency-removesilently",
    "E06",
    "ItemType: reference to an unknown package, RemoveSilently (ScopeCacheDependency)",
    "The same item as e06-scopecachedependency-donotremove: the references to the unknown package are removed with no warning.",
    `${P}configurator`,
    E06,
    { options: { refToUnknownPacks: "RemoveSilently" } },
  ),
  single(
    "e06-scopecachedependency-removewithwarning",
    "E06",
    "ItemType: reference to an unknown package, RemoveWithWarning (ScopeCacheDependency)",
    "The same item as e06-scopecachedependency-donotremove: the references are removed, the REMOVED REFERENCE log block is written and the warning is sent.",
    `${P}configurator`,
    E06,
    { options: { refToUnknownPacks: "RemoveWithWarning" } },
  ),
  single(
    "e02-part-removewithwarning",
    "E02",
    "ItemType: RemoveWithWarning control (Part)",
    "The control for the removal modes: nothing is removed from Part, the unknown-package request group is still sent.",
    `${P}solution.PLM`,
    E02,
    { options: { refToUnknownPacks: "RemoveWithWarning" } },
  ),
  single(
    "e07-form-itemtype",
    "E07",
    "Form: ItemType (Form Event that is a package element elsewhere)",
    "The Form's Form Event EF8E8BAFF7804E26AB1750B76344B481 is a package element of ssvc, the 14.35 RemoveSeparatelyExportedRelationships case; this records what 14.0.7 does with it.",
    `${P}core`,
    item("Form", "47B8630E2B4C40C1B23C6EE9962F7681", "ItemType"),
  ),
  single(
    "e08-change-controlled-relationship",
    "E08",
    "ItemType: Change Controlled Relationship",
    "R8, the Change Controlled Relationship fix-mode Property arm. It fires only if its related_id, sort_order and source_id Properties differ from stock.",
    `${P}solution.PLM`,
    item("ItemType", "2A5BB1A93BDC436B824B9FFE6DB89553", "Change Controlled Relationship"),
  ),
  single(
    "e09-presentableitems",
    "E09",
    "ItemType: polymorphic with a Morphae that is a package element (PresentableItems)",
    "Polymorphic, with Morphae 43C805F1681149FEABD670482A4A3470 that is itself a package element in tgv.configuration. Morphae wrapping.",
    `${P}cui`,
    item("ItemType", "58AECE23031E496FB04FFDEA6EDEF8A0", "PresentableItems"),
  ),
  single(
    "e10-activity-assignment",
    "E10",
    "RelationshipType: dependency level 0 (Activity Assignment)",
    "dependencyLevel 0: the source Activity is not a relationship. ProcessRelationshipType; getDepencyLevel stops at once.",
    `${P}core`,
    item("RelationshipType", "C92F589A534241B09EBD4FE0ECD903E2", "Activity Assignment"),
  ),
  single(
    "e11-cmf-elementbinding",
    "E11",
    "RelationshipType: dependency level 1 (cmf_ElementBinding)",
    "dependencyLevel 1.",
    `${P}cmf`,
    item("RelationshipType", "ED1D38253F4C41A1BD1CA45FE30F691B", "cmf_ElementBinding"),
  ),
  single(
    "e12-field-event",
    "E12",
    "RelationshipType: dependency level 2 (Field Event)",
    "dependencyLevel 2: Field Event, Field, Body.",
    `${P}core`,
    item("RelationshipType", "D55863B80B9048C18523E1C70C3320E1", "Field Event"),
  ),
  single(
    "e13-cmf-computedpropertydependency",
    "E13",
    "RelationshipType: dependency level 3 (cmf_ComputedPropertyDependency)",
    "dependencyLevel 3, the deepest on dev: cmf_ComputedProperty, cmf_PropertyType, cmf_ElementType. On import it also pins build.xsl's numeric dependencyLevel sort.",
    `${P}cmf`,
    item("RelationshipType", "0BB2EF414FA442589BCC46BD56B5FAFD", "cmf_ComputedPropertyDependency"),
  ),

  // ---- 2.2 Fixed-depth types ----
  single(
    "e14-list",
    "E14",
    "List: levels 1 (cmf_DocumentPropertyDataType)",
    "A fixed-depth type: levels 1.",
    `${P}cmf`,
    E14,
  ),
  single(
    "e15-sequence",
    "E15",
    "Sequence: Default Part",
    "Levels 1; current_value is removed (ProcessSequence).",
    `${P}solution.PLM`,
    item("Sequence", "1A5FABE557C74B20AAB9E3394B180507", "Default Part"),
  ),
  single(
    "e16-method-by-config-id",
    "E16",
    "Method: exported by its config_id, not the current generation (Add Alias Identity)",
    "A versionable Method exported by element id = config_id, which is generation 1 and not current; the current generation is 8400D20E29F3443BA6074A0E01AB4BEB. Exercises GetCurrentIdOfVersion's second query and ReplaceIdWithConfigId.",
    `${P}core`,
    item("Method", "61346634B3DC4D51964CD7AD988051D7", "Add Alias Identity"),
  ),
  single(
    "e17-method-middle-generation",
    "E17",
    "Method: exported by a middle generation (onChange Action)",
    "A versionable Method exported by a middle generation (gen 2 of 3). The config is EC0D87C174814CB7BA574593456113F7 and the current id is 319C9E8D8526410594970EAFB3138485.",
    `${P}core`,
    item("Method", "9C4E2E1AB17F48699B9BC8F8789D173C", "onChange Action"),
  ),
  single(
    "e18-form-system-fields",
    "E18",
    "Form: Fields on six system properties (Part)",
    "Levels 3. Fields on the system properties state, owned_by_id, managed_by_id, major_rev, classification and effective_date: ProcessForm, the propertytype_id drop and the Field action=edit fix items with the comment.",
    `${P}solution.PLM`,
    item("Form", "CAF99D0A8E6E44E9A681C38015FACE91", "Part"),
  ),
  single(
    "e19-form-one-system-field",
    "E19",
    "Form: one Field on a system property (Activity Template)",
    "The minimal system-property case: one Field on managed_by_id.",
    `${P}core`,
    item("Form", "F288A3345225407EACBC936191097BCD", "Activity Template"),
  ),
  single(
    "e20-workflow-map-ecn",
    "E20",
    "Workflow Map: non-system process_owner (ECN)",
    "Versionable, levels 3. process_owner is a non-system identity (Change Specialist II), so it becomes a bare id. The request transcript shows the nested float-property lookups.",
    `${P}solution.PLM`,
    item("Workflow Map", "48B8C3644AA34B7A9A310DB09815003D", "ECN"),
  ),
  single(
    "e21-workflow-map-system-owner",
    "E21",
    "Workflow Map: system process_owner (PE_Deviation)",
    "process_owner is Creator, a system identity, so it becomes an Item type=Identity action=get by name.",
    `${P}solution.PLM`,
    item("Workflow Map", "3473F755D9D74B33BFF93D32164FABB7", "PE_Deviation"),
  ),
  single(
    "e22-life-cycle-map-creator",
    "E22",
    "Life Cycle Map: role Creator, pre_action Method (FileExchangePackageUpload)",
    "Levels 3. A transition role = Creator (system); the pre_action Method becomes a get by @keyed_name.",
    `${P}exchange`,
    item("Life Cycle Map", "2C51AD67B5904C2F88A5F0D53EE0459A", "FileExchangePackageUpload"),
  ),
  single(
    "e23-life-cycle-map-owner",
    "E23",
    "Life Cycle Map: role Owner with a pre_action (Part)",
    "role = Owner (system), with a pre_action.",
    `${P}solution.PLM`,
    item("Life Cycle Map", "E337EBF706FA4172B2CD1A6487E00875", "Part"),
  ),
  single(
    "e24-grid",
    "E24",
    "Grid: History_whereTemplateUsed",
    "Levels 2. The only Grid that is a package element on dev.",
    `${P}history`,
    E24,
  ),
  single(
    "e25-identity-non-system",
    "E25",
    "Identity: non-system Identity as the root (Conversion Manager)",
    "Levels 1. The Member rows are dropped in place and re-emitted.",
    `${P}conversion`,
    item("Identity", "694C8B27E5D940DAA8BD336E45EC3A63", "Conversion Manager"),
  ),
  single(
    "e26-identity-system-no-package",
    "E26",
    "Identity: system Identity in no package, under core (World)",
    "A system Identity as the root. It is in no package, so it is also an items-in-no-package engine case: ExportSolutions never checks membership and only needs the package to exist.",
    `${P}core`,
    item("Identity", "A73B655731924CD0B027E4F4D5FCC0A9", "World"),
  ),
  single(
    "e27-permission",
    "E27",
    "Permission: rb_TreeGridView",
    "Levels 1. The Access rows follow the nested Identity rule.",
    `${P}tgv.configuration`,
    item("Permission", "012233DFCF4F434484D720F8598FF2D4", "rb_TreeGridView"),
  ),
  single(
    "e28-action",
    "E28",
    "Action: method and on_complete (PE_AddToChange)",
    "Levels 1. Both method and on_complete are set, so both become gets by keyed_name.",
    `${P}solution.PLM`,
    item("Action", "83FB72FC3E4D42B8B51BCD7F4194E527", "PE_AddToChange"),
  ),
  single(
    "e29-action-colon-keyed-name",
    "E29",
    "Action: keyed name with a colon (PE: rollup all parts in DB)",
    "The keyed name contains ':', which is not allowed in a file name, so the file is named by the id. The package element's name is 'PE rollup all parts in DB'; this case passes the item's real keyed name.",
    `${P}solution.PLM`,
    item("Action", "3313FB477B9A4982A30EA157ED896247", "PE: rollup all parts in DB"),
  ),
  single(
    "e30-report-method",
    "E30",
    "Report: method (BOM Costing Report)",
    "The Report method becomes a get by keyed_name.",
    `${P}solution.PLM`,
    item("Report", "B932166880F84F30BB02C62E0C29CBEF", "BOM Costing Report"),
  ),
  single(
    "e31-report-cdata",
    "E31",
    "Report: report_query and xsl_stylesheet as CDATA (ECN Report)",
    "report_query and xsl_stylesheet are written as CDATA; no method.",
    `${P}solution.PLM`,
    item("Report", "70007FC2534243EEBC63B0F988F4AE6B", "ECN Report"),
  ),
  single(
    "e32-item-report",
    "E32",
    "Item Report: levels 0, related_expand 0, element name = id",
    "Levels 0 and related_expand=0 (14.35 drops levels). The package element's name is the id, so the case passes the id as the keyed name.",
    `${P}admin`,
    item("Item Report", "128C30A645F04E5380F8B4709A3BD1A1", "128C30A645F04E5380F8B4709A3BD1A1"),
  ),
  single(
    "e33-user",
    "E33",
    "User: levels 2 (ES Admin)",
    "The User ItemType has pwd_is_set_on (R7), so the bytes show it.",
    `${P}es`,
    item("User", "1B88CFE00D91445E97FF345C3DF14BE4", "ES Admin"),
  ),
  single(
    "e34-preference",
    "E34",
    "Preference: levels 2, element name = id",
    "Levels 2; the file is named by the id.",
    `${P}preferences`,
    item("Preference", "507A16AA36F94513AD7EC1F948B5B48F", "507A16AA36F94513AD7EC1F948B5B48F"),
  ),
  single(
    "e35-variable-value-equals-default",
    "E35",
    "Variable: value equals default_value (CAD Angular Units)",
    "value and default_value are both 'RAD', so value is dropped.",
    `${P}solution.PLM`,
    item("Variable", "968471EC23804034A3B7B2B5C78601E7", "CAD Angular Units"),
  ),
  single(
    "e36-variable-both-empty",
    "E36",
    "Variable: both values empty (ES_SolrUrl)",
    "Both empty, so both are dropped.",
    `${P}es`,
    item("Variable", "18C614579E6D45468B90F5E9103AA153", "ES_SolrUrl"),
  ),
  single(
    "e37-variable-differ",
    "E37",
    "Variable: values differ (Application Core)",
    "The values differ ('12.0R1' and empty), so only the empty default_value is dropped.",
    `${P}solution.ApplicationCore`,
    item("Variable", "57F04471419F40D3946801E7FB8295DC", "Application Core"),
  ),
  single(
    "e38-variable-empty-value",
    "E38",
    "Variable: empty value, non-empty default (sg_powerplay_repo_url)",
    "An empty value with a non-empty default.",
    "com.steepgraph.powerplay",
    item("Variable", "44C4B025909E4F83897BAA5084B7B03F", "sg_powerplay_repo_url"),
  ),
  single(
    "e39-usermessage",
    "E39",
    "UserMessage: levels 1 (effs_ItemTypeWithOtherName)",
    "Levels 1.",
    `${P}effectivityservices`,
    item("UserMessage", "04BBDF47D751496490568B771E204F4B", "effs_ItemTypeWithOtherName"),
  ),
  {
    id: "e40-workflow-promotion-error-no",
    catalogue: ["E40", "ErrorQuestion"],
    title: "Workflow Promotion (absent on 12 SP9): server fault, ErrorQuestion answered no",
    exercises:
      "12 SP9 has no Workflow Promotion ItemType, so a dummy id pins the levels-1 request shape and the failure path: the type lookup finds no ItemType, the engine reports 'Error of exporting Item' and asks the ErrorQuestion, answered no (abort the package). A second package is in the run. The success branch stays covered by the spec and a unit test.",
    packages: [pkg(`${P}core`, DUMMY), SMALL.history],
    options: { errorQuestionAnswer: "no" },
  },
  {
    id: "e40-workflow-promotion-error-yes",
    catalogue: ["E40", "ErrorQuestion"],
    title: "Workflow Promotion (absent on 12 SP9): server fault, ErrorQuestion answered yes",
    exercises:
      "The same two-package run as e40-workflow-promotion-error-no, with the ErrorQuestion answered yes (continue), and a second, valid item in the failing package.",
    packages: [pkg(`${P}core`, DUMMY, item("Form", "F288A3345225407EACBC936191097BCD", "Activity Template")), SMALL.history],
    options: { errorQuestionAnswer: "yes" },
  },

  // ---- 2.3 Special types ----
  single(
    "e43-xclassificationtree",
    "E43",
    "xClassificationTree: ES_ComponentClassification",
    "Levels 2; RemoveSystemRelationshipsFromXTree.",
    `${P}es`,
    item("xClassificationTree", "42E9E9A77CF1478BB70CCBD2F74704CA", "ES_ComponentClassification"),
  ),
  single(
    "e44-xpropertydefinition",
    "E44",
    "xPropertyDefinition: xp-es_batch_size (default-type branch)",
    "The default-type branch (sLevel plus the xp select). The xp-* values on items (ProcessXProperties, the set= attribute) cannot be exercised on dev; ticket 67 records them.",
    `${P}es`,
    item("xPropertyDefinition", "46C0E4FFB0A94E379DFAE0C69B32F3A0", "xp-es_batch_size"),
    { note: "xp-* values on items need scratch package S7; ticket 67." },
  ),
  single(
    "e47-dr-relationshipfamily",
    "E47",
    "dr_RelationshipFamily: User Identities (empty implementation_query)",
    "Levels 2; IncludeDrRelationshipAsValue embeds dr_Relationship D54BFC482F8C4FC89E2C44C35479D789. Its implementation_query is empty, so this pins what R10's XDocument.Parse does with empty text. It has no dr_FamilyEventHandler; event_data (R6) needs scratch state.",
    `${P}derivedrelationships_default`,
    item("dr_RelationshipFamily", "CB35C14E66EC407F984CD37BF8CF38A0", "DerivedRelationshipFamily"),
    { note: "event_data CDATA and a non-empty implementation_query need scratch package S6; ticket 67." },
  ),
  single(
    "e48-qry-querydefinition",
    "E48",
    "qry_QueryDefinition: UserIdentities",
    "Levels 2.",
    `${P}derivedrelationships_default`,
    item("qry_QueryDefinition", "7F26808935574EF2A81876F9FD7658AC", "UserIdentities"),
  ),
  single(
    "e49-rb-treegridviewdefinition",
    "E49",
    "rb_TreeGridViewDefinition: PE_BomStructure",
    "Levels 2.",
    `${P}solution.PLM`,
    item("rb_TreeGridViewDefinition", "005102D88C68467C9378686CCF08AC3D", "PE_BomStructure"),
  ),
  single(
    "e50-mp-macpolicy",
    "E50",
    "mp_MacPolicy: one filter_xml (User Visibility Policy)",
    "Versionable. Condition A4A96F3303CD4288A1C2ABFB590C8598 has condition_xml with exactly one filter_xml CDATA, so CdataFilterXml runs. The two-or-more case (R9) needs scratch state.",
    `${P}access.uservisibilitypolicy`,
    item("mp_MacPolicy", "28DF1660D422498D89E5DA5D9A5BBA8A", "User Visibility Policy"),
    { note: "Two or more filter_xml (R9) need scratch package S6; ticket 67." },
  ),
  single(
    "e51-sql",
    "E51",
    "SQL: ConvertFromLocal",
    "Default type; the execution_count drop; sqlserver_body as CDATA.",
    `${P}core`,
    item("SQL", "4D6F8EE6179645F99BAE94036C9E94EF", "ConvertFromLocal"),
  ),

  // ---- 2.4 Content cases ----
  single(
    "e52-float-item-property",
    "E52",
    "CommandBarButton: float item property to a re-generated Method (sg_powerplay_relationshipgrid)",
    "A float item property with a visible effect: on_click_handler points to Method sg_powerplay_relgrid_click, whose generation is above 1. GetCustomFloatPropertiesOfTypeItem and GetConfigId rewrite it to the config_id.",
    "com.steepgraph.powerplay",
    item("CommandBarButton", "4B51486994E740E383BA33D46250AAFA", "sg_powerplay_relationshipgrid"),
  ),
  single(
    "e53-level-default",
    "E53",
    "CommandBarSection: sLevel not set (Language_TOC_Content)",
    "The default type, for the sLevel matrix. sLevel unset reads as the engine default of 1.",
    `${P}i18n`,
    E53,
  ),
  single(
    "e53-level-empty",
    "E53",
    "CommandBarSection: sLevel empty string",
    "sLevel = '' is the same as 1.",
    `${P}i18n`,
    E53,
    { options: { level: "" } },
  ),
  single("e53-level-1", "E53", "CommandBarSection: sLevel 1", "sLevel 1 explicitly.", `${P}i18n`, E53, {
    options: { level: "1" },
  }),
  single("e53-level-2", "E53", "CommandBarSection: sLevel 2", "sLevel 2.", `${P}i18n`, E53, {
    options: { level: "2" },
  }),
  single("e53-level-3", "E53", "CommandBarSection: sLevel 3", "sLevel 3.", `${P}i18n`, E53, {
    options: { level: "3" },
  }),
  single(
    "e14-level-2-ignored",
    "E14",
    "List: sLevel 2 is ignored by a fixed-depth type",
    "A fixed-depth type ignores sLevel; compare with e14-list.",
    `${P}cmf`,
    E14,
    { options: { level: "2" } },
  ),
  single(
    "e54-list-no-package",
    "E54",
    "List: item in no package, keyed name that is not a file name (True/False)",
    "The keyed name has '/', so the file is named by the id. The item is in no package; the engine accepts it under any existing package key (core here). The CLI's refusal is a ticket 43 unit test.",
    `${P}core`,
    item("List", "F8CDB96400C445879DA9E6FCA53889A2", "True/False"),
  ),
  {
    id: "e55-lists-no-package-pair",
    catalogue: ["E54", "E55"],
    title: "Lists: two items in no package under one package (True/False, Yes/No)",
    exercises: "The same pair of cases as e54-list-no-package, with a second item to show item ordering within one package.",
    packages: [
      pkg(
        `${P}core`,
        item("List", "F8CDB96400C445879DA9E6FCA53889A2", "True/False"),
        item("List", "9FEC936F59F14FECAA3621F726FBAAF2", "Yes/No"),
      ),
    ],
  },
  single(
    "e56-tp-xmlschemaelement",
    "E56",
    "tp_XmlSchemaElement: content_generator Method, element name = id",
    "The content_generator Method becomes a get by keyed_name.",
    `${P}tdf`,
    item("tp_XmlSchemaElement", "37BE25ACED9B46BEA12D66F69703C105", "37BE25ACED9B46BEA12D66F69703C105"),
  ),

  // ---- 2.5 Package and manifest cases ----
  {
    id: "p1-order-admin-core-cui",
    catalogue: ["P1"],
    title: "Three packages, inserted admin, core, cui",
    exercises:
      "The manifest's package order follows Hashtable enumeration, not insertion order. dependson is written with no referenced elements (dev has none).",
    packages: [SMALL.admin, SMALL.core, SMALL.cui],
  },
  {
    id: "p1-order-cui-core-admin",
    catalogue: ["P1"],
    title: "Three packages, inserted cui, core, admin",
    exercises: "The same packages as p1-order-admin-core-cui in the reverse insertion order.",
    packages: [SMALL.cui, SMALL.core, SMALL.admin],
  },
  {
    id: "p1-order-six-forward",
    catalogue: ["P1"],
    title: "Six packages, inserted admin, core, cui, history, es, conversion",
    exercises: "Hashtable bucket order with more than three string keys: the enumeration order is not the insertion order.",
    packages: [SMALL.admin, SMALL.core, SMALL.cui, SMALL.history, SMALL.es, SMALL.conversion],
  },
  {
    id: "p1-order-six-reverse",
    catalogue: ["P1"],
    title: "Six packages, inserted conversion, es, history, cui, core, admin",
    exercises: "The six packages of p1-order-six-forward in the reverse insertion order.",
    packages: [SMALL.conversion, SMALL.es, SMALL.history, SMALL.cui, SMALL.core, SMALL.admin],
  },
  {
    id: "p2-cui-default-missing-dependencies",
    catalogue: ["P2"],
    title: "Package whose dependencies are not on dev (cui_default), referenced items off",
    exercises:
      "cui_default depends on com.steepgraph.solution.contextualHelp and com.steepgraph.addon.imageviewer, neither present as a PackageDefinition. With referenced items off the dependency lookups are not made.",
    packages: [pkg(`${P}cui_default`, item("Method", "2BBAC312DCCB481CB0B16E651A73EE1E", "CadToPdfMenuInitHandler"))],
  },
  {
    id: "p2-cui-default-referenced-items",
    catalogue: ["P2", "ReferencedItems"],
    title: "Package whose dependencies are not on dev (cui_default), referenced items on",
    exercises:
      "The same item as p2-cui-default-missing-dependencies with bExportReferencedItems on: the FindReferencedElements faultcode-0 path. PackageReferencedElement has no rows on dev, so no referenced item is exported; the S2-backed case is ticket 67.",
    packages: [pkg(`${P}cui_default`, item("Method", "2BBAC312DCCB481CB0B16E651A73EE1E", "CadToPdfMenuInitHandler"))],
    options: { exportReferencedItems: true },
    note: "Referenced elements (P5) need scratch package S2; ticket 67.",
  },
  {
    id: "p2-part-referenced-items",
    catalogue: ["ReferencedItems"],
    title: "Package with dependencies, referenced items on (Part)",
    exercises:
      "bExportReferencedItems on for a package that depends on others. Compare with e02-part-itemtype, which has it off.",
    packages: [pkg(`${P}solution.PLM`, E02)],
    options: { exportReferencedItems: true },
    note: "Referenced elements (P5) need scratch package S2; ticket 67.",
  },
  {
    id: "p3-absent-package",
    catalogue: ["P3"],
    title: "A Hashtable key naming a package absent from the DB",
    exercises:
      "InitSolution's CItemException escapes ExportSolutions, and the manifest is still saved in the finally block.",
    packages: [pkg("LIBSJS-SCRATCH-ABSENT", E24)],
    expectsError: true,
  },
  {
    id: "p4-folder-mapping",
    catalogue: ["P4"],
    title: "Standard and non-standard package folder mapping",
    exercises:
      "CreateOutputDir rules: com.aras.innovator.core (com\\aras\\innovator\\core), com.aras.defaults.filerepresentations, com.aras.innovator.solution.PLM (PLM\\Import) and com.steepgraph.pagex (pagex\\Import). No last-segment collision exists on dev; the wipe-collision case needs scratch S8 (ticket 67).",
    packages: [
      SMALL.core,
      pkg("com.aras.defaults.filerepresentations", item("fr_RepresentationType", "16039DDADB33459A9F6B344B9DD8C735", "CATIA Assembly SCS Representation")),
      pkg(`${P}solution.PLM`, item("Variable", "968471EC23804034A3B7B2B5C78601E7", "CAD Angular Units")),
      pkg("com.steepgraph.pagex", item("CommandBarButton", "0DD3CB20F7224E3FB3D5CA87E100A04A", "com.steepgraph.pagex.builder.button")),
    ],
    note: "The last-segment folder collision needs scratch package S8; ticket 67.",
  },

  // ---- 3.1 Option matrix (14.0.7) ----
  single(
    "opt-use-import",
    "UseImport",
    "Option: UseImport on",
    "UseImport on; the catalogue expects it to be logged only, and one case pins that.",
    `${P}history`,
    E24,
    { options: { useImport: true } },
  ),
  single(
    "opt-timeout-default",
    "Timeout",
    "Option: Timeout at the host default",
    "The host's own default of 600000 ms; the catalogue expects the timeout to be recorded only.",
    `${P}history`,
    E24,
    { options: { timeout: 600000 } },
  ),
  single(
    "opt-timeout-minus-1",
    "Timeout",
    "Option: Timeout -1",
    "Timeout -1, recorded only.",
    `${P}history`,
    E24,
    { options: { timeout: -1 } },
  ),
  single(
    "opt-timeout-30000",
    "Timeout",
    "Option: Timeout 30000",
    "A positive timeout, recorded only.",
    `${P}history`,
    E24,
    { options: { timeout: 30000 } },
  ),
  single(
    "opt-verbose",
    "Verbose",
    "Option: Verbose (SolutionUpgradeContext.Verbose) on",
    "SolutionUpgradeContext.Verbose on; one case shows whether it changes the log or the requests.",
    `${P}history`,
    E24,
    { options: { verbose: true } },
  ),
];

/** The host parameters of a case's options. */
export function hostOptions(options: ExportCaseOptions | undefined): Record<string, HostValue> {
  const params: Record<string, HostValue> = {};
  if (options === undefined) return params;
  if (options.level !== undefined) params.Level = options.level;
  if (options.exportReferencedItems) params.ExportReferencedItems = true;
  if (options.refToUnknownPacks !== undefined) params.RefToUnknownPacks = options.refToUnknownPacks;
  if (options.useImport) params.UseImport = true;
  if (options.verbose) params.ContextVerbose = true;
  if (options.timeout !== undefined) params.Timeout = options.timeout;
  if (options.errorQuestionAnswer !== undefined) params.ErrorQuestionAnswer = options.errorQuestionAnswer;
  if (options.engineAction !== undefined) params.EngineAction = options.engineAction;
  if (options.languages !== undefined) params.Languages = options.languages;
  if (options.cancelAfterStatus !== undefined) params.CancelAfterStatus = options.cancelAfterStatus;
  return params;
}

/** The host's item specs, "package<TAB>type<TAB>id<TAB>keyed name", in insertion order. */
export function hostItems(packages: readonly ExportCasePackage[]): string[] {
  return packages.flatMap((p) => p.items.map((i) => [p.name, i.type, i.id, i.keyedName].join("\t")));
}
