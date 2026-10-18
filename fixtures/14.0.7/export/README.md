# 14.0.7 export fixtures

Recorded from engine 14.0.7.35492 on the dev instance, read-only, from ticket 05's catalogue and option matrix. One folder per case; each README says what the case exercises, its input (the `Hashtable` insertion order included) and the spec rules that pin it.

- Cases are small: one item, or one small package, per branch, plus multi-package cases for ordering (`p1-*`).
- A response of 64 KB or more is stored once in `_blobs/` and named by `responseBlob` in the transcript; every case begins with the same 2.7 MB list of PackageDefinitions. `oracle/src/transcript.ts` puts them back.
- Cases that need scratch state on dev (cmf_ContentType, cmf_TabularView, dac_DomainDefinition, ac_PolicyAccessItemAttribute, xp-* values, dr `event_data`, several `filter_xml`, referenced elements, the last-segment collision) are recorded by `npm run oracle:export-scratch-cases` (ticket 67). Each imports `LIBSJS-SCRATCH-*` packages, exports, and deletes what it created; its README lists the ids created and deleted.
- The dev state a case ran against can change. `run.json` carries the time of the run.
- Re-record with `ARAS_PASSWORD=… npm run oracle:export-cases` (see `npm run oracle:export-cases -- --help`).

| Case | Catalogue | What | Calls |
|---|---|---|---|
| [e01-change-controlled-item](e01-change-controlled-item/README.md) | E01 | ItemType: polymorphic and versionable (Change Controlled Item) | 50 |
| [e02-part-itemtype](e02-part-itemtype/README.md) | E02 | ItemType: Part (versionable table, Grid Event on a system Property) | 97 |
| [e03-cad-itemtype](e03-cad-itemtype/README.md) | E03 | ItemType: CAD (reference holding XML markup) | 85 |
| [e04-design-to-goal](e04-design-to-goal/README.md) | E04 | ItemType: no View (Design To Goal) | 29 |
| [e05-affected-item](e05-affected-item/README.md) | E05 | ItemType: foreign Properties (Affected Item) | 63 |
| [e06-scopecachedependency-donotremove](e06-scopecachedependency-donotremove/README.md) | E06 | ItemType: reference to an unknown package, DoNotRemove (ScopeCacheDependency) | 51 |
| [e06-scopecachedependency-removesilently](e06-scopecachedependency-removesilently/README.md) | E06 | ItemType: reference to an unknown package, RemoveSilently (ScopeCacheDependency) | 94 |
| [e06-scopecachedependency-removewithwarning](e06-scopecachedependency-removewithwarning/README.md) | E06 | ItemType: reference to an unknown package, RemoveWithWarning (ScopeCacheDependency) | 94 |
| [e02-part-removewithwarning](e02-part-removewithwarning/README.md) | E02 | ItemType: RemoveWithWarning control (Part) | 150 |
| [e07-form-itemtype](e07-form-itemtype/README.md) | E07 | Form: ItemType (Form Event that is a package element elsewhere) | 55 |
| [e08-change-controlled-relationship](e08-change-controlled-relationship/README.md) | E08 | ItemType: Change Controlled Relationship | 45 |
| [e09-presentableitems](e09-presentableitems/README.md) | E09 | ItemType: polymorphic with a Morphae that is a package element (PresentableItems) | 48 |
| [e10-activity-assignment](e10-activity-assignment/README.md) | E10 | RelationshipType: dependency level 0 (Activity Assignment) | 76 |
| [e11-cmf-elementbinding](e11-cmf-elementbinding/README.md) | E11 | RelationshipType: dependency level 1 (cmf_ElementBinding) | 39 |
| [e12-field-event](e12-field-event/README.md) | E12 | RelationshipType: dependency level 2 (Field Event) | 63 |
| [e13-cmf-computedpropertydependency](e13-cmf-computedpropertydependency/README.md) | E13 | RelationshipType: dependency level 3 (cmf_ComputedPropertyDependency) | 46 |
| [e14-list](e14-list/README.md) | E14 | List: levels 1 (cmf_DocumentPropertyDataType) | 23 |
| [e15-sequence](e15-sequence/README.md) | E15 | Sequence: Default Part | 14 |
| [e16-method-by-config-id](e16-method-by-config-id/README.md) | E16 | Method: exported by its config_id, not the current generation (Add Alias Identity) | 17 |
| [e17-method-middle-generation](e17-method-middle-generation/README.md) | E17 | Method: exported by a middle generation (onChange Action) | 17 |
| [e18-form-system-fields](e18-form-system-fields/README.md) | E18 | Form: Fields on six system properties (Part) | 44 |
| [e19-form-one-system-field](e19-form-one-system-field/README.md) | E19 | Form: one Field on a system property (Activity Template) | 49 |
| [e20-workflow-map-ecn](e20-workflow-map-ecn/README.md) | E20 | Workflow Map: non-system process_owner (ECN) | 71 |
| [e21-workflow-map-system-owner](e21-workflow-map-system-owner/README.md) | E21 | Workflow Map: system process_owner (PE_Deviation) | 50 |
| [e22-life-cycle-map-creator](e22-life-cycle-map-creator/README.md) | E22 | Life Cycle Map: role Creator, pre_action Method (FileExchangePackageUpload) | 25 |
| [e23-life-cycle-map-owner](e23-life-cycle-map-owner/README.md) | E23 | Life Cycle Map: role Owner with a pre_action (Part) | 25 |
| [e24-grid](e24-grid/README.md) | E24 | Grid: History_whereTemplateUsed | 21 |
| [e25-identity-non-system](e25-identity-non-system/README.md) | E25 | Identity: non-system Identity as the root (Conversion Manager) | 19 |
| [e26-identity-system-no-package](e26-identity-system-no-package/README.md) | E26 | Identity: system Identity in no package, under core (World) | 14 |
| [e27-permission](e27-permission/README.md) | E27 | Permission: rb_TreeGridView | 19 |
| [e28-action](e28-action/README.md) | E28 | Action: method and on_complete (PE_AddToChange) | 17 |
| [e29-action-colon-keyed-name](e29-action-colon-keyed-name/README.md) | E29 | Action: keyed name with a colon (PE: rollup all parts in DB) | 16 |
| [e30-report-method](e30-report-method/README.md) | E30 | Report: method (BOM Costing Report) | 16 |
| [e31-report-cdata](e31-report-cdata/README.md) | E31 | Report: report_query and xsl_stylesheet as CDATA (ECN Report) | 15 |
| [e32-item-report](e32-item-report/README.md) | E32 | Item Report: levels 0, related_expand 0, element name = id | 13 |
| [e33-user](e33-user/README.md) | E33 | User: levels 2 (ES Admin) | 21 |
| [e34-preference](e34-preference/README.md) | E34 | Preference: levels 2, element name = id | 35 |
| [e35-variable-value-equals-default](e35-variable-value-equals-default/README.md) | E35 | Variable: value equals default_value (CAD Angular Units) | 14 |
| [e36-variable-both-empty](e36-variable-both-empty/README.md) | E36 | Variable: both values empty (ES_SolrUrl) | 17 |
| [e37-variable-differ](e37-variable-differ/README.md) | E37 | Variable: values differ (Application Core) | 13 |
| [e38-variable-empty-value](e38-variable-empty-value/README.md) | E38 | Variable: empty value, non-empty default (sg_powerplay_repo_url) | 13 |
| [e39-usermessage](e39-usermessage/README.md) | E39 | UserMessage: levels 1 (effs_ItemTypeWithOtherName) | 16 |
| [e40-workflow-promotion-error-no](e40-workflow-promotion-error-no/README.md) | E40, ErrorQuestion | Workflow Promotion (absent on 12 SP9): server fault, ErrorQuestion answered no | 24 |
| [e40-workflow-promotion-error-yes](e40-workflow-promotion-error-yes/README.md) | E40, ErrorQuestion | Workflow Promotion (absent on 12 SP9): server fault, ErrorQuestion answered yes | 62 |
| [e43-xclassificationtree](e43-xclassificationtree/README.md) | E43 | xClassificationTree: ES_ComponentClassification | 85 |
| [e44-xpropertydefinition](e44-xpropertydefinition/README.md) | E44 | xPropertyDefinition: xp-es_batch_size (default-type branch) | 18 |
| [e47-dr-relationshipfamily](e47-dr-relationshipfamily/README.md) | E47 | dr_RelationshipFamily: User Identities (empty implementation_query) | 24 |
| [e48-qry-querydefinition](e48-qry-querydefinition/README.md) | E48 | qry_QueryDefinition: UserIdentities | 34 |
| [e49-rb-treegridviewdefinition](e49-rb-treegridviewdefinition/README.md) | E49 | rb_TreeGridViewDefinition: PE_BomStructure | 58 |
| [e50-mp-macpolicy](e50-mp-macpolicy/README.md) | E50 | mp_MacPolicy: one filter_xml (User Visibility Policy) | 35 |
| [e51-sql](e51-sql/README.md) | E51 | SQL: ConvertFromLocal | 14 |
| [e52-float-item-property](e52-float-item-property/README.md) | E52 | CommandBarButton: float item property to a re-generated Method (sg_powerplay_relationshipgrid) | 15 |
| [e53-level-default](e53-level-default/README.md) | E53 | CommandBarSection: sLevel not set (Language_TOC_Content) | 24 |
| [e53-level-empty](e53-level-empty/README.md) | E53 | CommandBarSection: sLevel empty string | 24 |
| [e53-level-1](e53-level-1/README.md) | E53 | CommandBarSection: sLevel 1 | 24 |
| [e53-level-2](e53-level-2/README.md) | E53 | CommandBarSection: sLevel 2 | 24 |
| [e53-level-3](e53-level-3/README.md) | E53 | CommandBarSection: sLevel 3 | 24 |
| [e14-level-2-ignored](e14-level-2-ignored/README.md) | E14 | List: sLevel 2 is ignored by a fixed-depth type | 23 |
| [e54-list-no-package](e54-list-no-package/README.md) | E54 | List: item in no package, keyed name that is not a file name (True/False) | 17 |
| [e55-lists-no-package-pair](e55-lists-no-package-pair/README.md) | E54, E55 | Lists: two items in no package under one package (True/False, Yes/No) | 21 |
| [e56-tp-xmlschemaelement](e56-tp-xmlschemaelement/README.md) | E56 | tp_XmlSchemaElement: content_generator Method, element name = id | 18 |
| [p1-order-admin-core-cui](p1-order-admin-core-cui/README.md) | P1 | Three packages, inserted admin, core, cui | 88 |
| [p1-order-cui-core-admin](p1-order-cui-core-admin/README.md) | P1 | Three packages, inserted cui, core, admin | 88 |
| [p1-order-six-forward](p1-order-six-forward/README.md) | P1 | Six packages, inserted admin, core, cui, history, es, conversion | 118 |
| [p1-order-six-reverse](p1-order-six-reverse/README.md) | P1 | Six packages, inserted conversion, es, history, cui, core, admin | 118 |
| [p2-cui-default-missing-dependencies](p2-cui-default-missing-dependencies/README.md) | P2 | Package whose dependencies are not on dev (cui_default), referenced items off | 18 |
| [p2-cui-default-referenced-items](p2-cui-default-referenced-items/README.md) | P2, ReferencedItems | Package whose dependencies are not on dev (cui_default), referenced items on | 18 |
| [p2-part-referenced-items](p2-part-referenced-items/README.md) | ReferencedItems | Package with dependencies, referenced items on (Part) | 97 |
| [p3-absent-package](p3-absent-package/README.md) | P3 | A Hashtable key naming a package absent from the DB | 8 |
| [p4-folder-mapping](p4-folder-mapping/README.md) | P4 | Standard and non-standard package folder mapping | 76 |
| [opt-use-import](opt-use-import/README.md) | UseImport | Option: UseImport on | 21 |
| [opt-timeout-default](opt-timeout-default/README.md) | Timeout | Option: Timeout at the host default | 21 |
| [opt-timeout-minus-1](opt-timeout-minus-1/README.md) | Timeout | Option: Timeout -1 | 21 |
| [opt-timeout-30000](opt-timeout-30000/README.md) | Timeout | Option: Timeout 30000 | 21 |
| [opt-verbose](opt-verbose/README.md) | Verbose | Option: Verbose (SolutionUpgradeContext.Verbose) on | 21 |
| [s6-mac-two-filters](s6-mac-two-filters/README.md) | E50, S6, R9 | mp_MacPolicy whose condition holds two filter_xml blocks | 16 |
| [s6-dr-family](s6-dr-family/README.md) | E47, S6, R6 | dr_RelationshipFamily with a non-empty implementation_query and an event handler that has event_data | 27 |
| [s6-ac-attribute](s6-ac-attribute/README.md) | E46, S6, R11 | ac_PolicyAccessItemAttribute with an attribute definition | 19 |
| [s6-dac-domain](s6-dac-domain/README.md) | E45, S6, R4 | dac_DomainDefinition with a sub-domain permission whose condition holds non-ASCII text | 20 |
| [s6-cmf-content-type](s6-cmf-content-type/README.md) | E41, S6 | cmf_ContentType with an element type and a property type | 21 |
| [s6-cmf-itemtype](s6-cmf-itemtype/README.md) | E41, S6 | ItemType that has a cmf_ContentType linked to it | 31 |
| [s6-cmf-tabular-view](s6-cmf-tabular-view/README.md) | E42, S6 | cmf_TabularView with a column | 19 |
| [p5-ref-off](p5-ref-off/README.md) | P5, S2, referenced items off | A package that depends on another with three referenced elements, referenced items off | 14 |
| [p5-ref-on](p5-ref-on/README.md) | P5, S2, referenced items on | The same package with referenced items on | 23 |
| [p5-ref-both-on](p5-ref-both-on/README.md) | P5, S2, referenced items on | The package and its dependency exported together, referenced items on | 27 |
| [s8-coll-ab](s8-coll-ab/README.md) | S8, P4 | Two packages whose names end in the same segment, A.Coll inserted first | 16 |
| [s8-coll-ba](s8-coll-ba/README.md) | S8, P4 | The same two packages, B.Coll inserted first | 16 |
| [s7-xp-values](s7-xp-values/README.md) | E44, S7, xp-* values | Classified instance of an ItemType with two extended properties (xp-* elements) | 18 |
| [s7-xp-empty](s7-xp-empty/README.md) | E44, S7, xp-* values | Unclassified instance of an ItemType whose class has extended properties | 13 |
