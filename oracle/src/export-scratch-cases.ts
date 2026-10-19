import type { ExportCase, ExportCaseOptions } from "./export-cases.js";
import type { ImportStep } from "./import-cases.js";
import { collDistinct, collId, refId, refPair } from "./import-packages.js";
import { AC, CMF, DR, LANG, SPECIAL, XPROP, implementationQuery, lang, langId, langInstances, langItemTypeId, special, specialIds, specialStepTwo, xprop, xpropId, xpropInstances } from "./seed-packages.js";
import type { ItemRef } from "./record.js";

/**
 * The 14.0.7 export fixture cases that need scratch state on dev (ticket 67,
 * ticket 05's "24b" pass): the types dev has no rows of (cmf_ContentType,
 * cmf_TabularView, dac_DomainDefinition, ac_PolicyAccessItemAttribute, xp-*
 * values, dr `event_data` and a non-empty `implementation_query`, two or more
 * `filter_xml`), referenced elements, and the last-segment folder collision.
 *
 * The recipe, run by `npm run oracle:export-scratch-cases`, for one seed group:
 * 1. **Import** the group's `LIBSJS-SCRATCH-*` packages with the oracle, step by
 *    step, each step keeping what it created (`KeepCreated`). A step the case
 *    list says must succeed and does not ends the run, and step 3 runs.
 * 2. **Export** each case of the group with the oracle: a read-only export of
 *    the seeded items, one oracle run per case, recorded like any export case.
 * 3. **Clean up**: one oracle `cleanup` run deletes everything the steps created,
 *    newest first, and the recorder insists that nothing is kept or unverified.
 *    Step 3 also runs when step 1 or 2 fails.
 * Ticket 48 ran the same three steps for 12.0 (`--engine 12.0`); 14.35 (ticket
 * 57) repeats them with its own `--engine`. The group definitions below are
 * engine-neutral except where a case says otherwise.
 */

/**
 * An item to export. `id` is the id the package file gives the item. A
 * versionable item gets a new id on import, so it names the item the engine
 * created instead: `created` is the zero-based position among the items of this
 * `type` that the seed created, in creation order.
 */
export interface SeededItem {
  type: string;
  keyedName: string;
  id: string | { created: number };
}

export interface SeededPackage {
  /** The PackageDefinition name; the seed imports it, so it exists when the case exports. */
  name: string;
  /** In `Hashtable` insertion order. */
  items: SeededItem[];
}

export interface ScratchExportCase extends Pick<ExportCase, "expectsError"> {
  /** The folder under fixtures/<engine>/export/. */
  id: string;
  catalogue: string[];
  title: string;
  exercises: string;
  packages: SeededPackage[];
  options?: ExportCaseOptions;
  note?: string;
  /** The spec rules that pin the case (14.35 cases name them). */
  rules?: readonly string[];
}

/** Packages to seed, as a list of import steps, and the cases that export from the result. */
export interface SeedGroup {
  id: string;
  /** Every step must end as its `expect` says; all of them keep what they created. */
  steps: ImportStep[];
  cases: ScratchExportCase[];
}

/** What one seed step created, as the case record keeps it. */
export interface SeedStepRecord {
  name: string;
  packages: string[];
  options: NonNullable<ImportStep["options"]>;
  created: ItemRef[];
}

/** `case.json`'s account of the seed a case ran against. */
export interface SeedRecord {
  group: string;
  steps: SeedStepRecord[];
  /** What the group's cleanup deleted after the last export: everything the steps created, newest first. */
  deleted: ItemRef[];
}

/** A case with its items resolved to ids, in the shape the stock recorder writes. */
export type ResolvedCase = Pick<ExportCase, "id" | "catalogue" | "title" | "exercises" | "packages" | "options" | "note" | "rules" | "expectsError">;

const ok = (name: string, packages: ImportStep["packages"], options?: ImportStep["options"]): ImportStep => ({ name, packages, expect: "success", ...(options === undefined ? {} : { options }) });

const REF_VAR = "LIBSJS-SCRATCH-REF-Var_1";
const REF_LIST = "LIBSJS-SCRATCH-REFDEP-List_1";
const refVar: SeededItem = { type: "Variable", keyedName: REF_VAR, id: refId(REF_VAR) };
const refList: SeededItem = { type: "List", keyedName: REF_LIST, id: refId(REF_LIST) };
const collA: SeededItem = { type: "Variable", keyedName: "LIBSJS-SCRATCH-Coll_A", id: collId("a") };
const collB: SeededItem = { type: "Variable", keyedName: "LIBSJS-SCRATCH-Coll_B", id: collId("b") };

export const SEED_GROUPS: SeedGroup[] = [
  {
    id: "s6-special",
    steps: [ok("mac policy, derived relationships, ItemType with content type", [special()]), ok("access control and tabular view", specialStepTwo()), ok("implementation query", [implementationQuery()])],
    cases: [
      {
        id: "s6-mac-two-filters",
        catalogue: ["E50", "S6", "R9"],
        title: "mp_MacPolicy whose condition holds two filter_xml blocks",
        exercises: "CdataFilterXml with two or more filter_xml elements in one condition_xml (the stock policy has exactly one): R9.",
        packages: [{ name: SPECIAL.name, items: [{ type: "mp_MacPolicy", keyedName: SPECIAL.macPolicy, id: { created: 0 } }] }],
      },
      {
        id: "s6-dr-family",
        catalogue: ["E47", "S6", "R6"],
        title: "dr_RelationshipFamily with a non-empty implementation_query and an event handler that has event_data",
        exercises:
          "EXP-117 and EXP-121 on a family with a dr_FamilyElement whose dr_Relationship is embedded and has a multi-line implementation_query (re-indented through XDocument, R10), and a dr_FamilyEventHandler whose event_data is written as CDATA (R6).",
        packages: [{ name: SPECIAL.name, items: [{ type: "dr_RelationshipFamily", keyedName: DR.family, id: specialIds.drFamily }] }],
      },
      {
        id: "s6-ac-attribute",
        catalogue: ["E46", "S6", "R11"],
        title: "ac_PolicyAccessItemAttribute with an attribute definition",
        exercises: "EXP-118: the second dr_RelationshipFamily call for an ac_PolicyAccessItemAttribute fires on the dr_relationship_id of its ac_PolicyAccessAttrDefinition, which embeds the dr_Relationship.",
        packages: [{ name: "LIBSJS-SCRATCH-ACCESS", items: [{ type: "ac_PolicyAccessItemAttribute", keyedName: AC.attribute, id: specialIds.acAttribute }] }],
      },
      {
        id: "s6-dac-domain",
        catalogue: ["E45", "S6", "R4"],
        title: "dac_DomainDefinition with a sub-domain permission whose condition holds non-ASCII text",
        exercises: "EXP-119: the condition_xml of a dac_SubdomainPermission is re-indented through HtmlDecode, XmlWriter and HtmlEncode; the condition holds an e with an acute accent and a no-break space.",
        packages: [{ name: "LIBSJS-SCRATCH-ACCESS", items: [{ type: "dac_DomainDefinition", keyedName: AC.domain, id: specialIds.dacDomain }] }],
      },
      {
        id: "s6-cmf-content-type",
        catalogue: ["E41", "S6"],
        title: "cmf_ContentType with an element type and a property type",
        exercises: "The cmf_ContentType export request and file, with its cmf_ElementType and cmf_PropertyType relationships.",
        packages: [{ name: SPECIAL.name, items: [{ type: "cmf_ContentType", keyedName: CMF.content, id: { created: 0 } }] }],
      },
      {
        id: "s6-cmf-itemtype",
        catalogue: ["E41", "S6"],
        title: "ItemType that has a cmf_ContentType linked to it",
        exercises: "EXP-104: the cmf lookup an ItemType export makes, here answered with exactly one content type (the stock ItemTypes have none), and the cmf_RecalculateContentViews Item Action.",
        packages: [{ name: SPECIAL.name, items: [{ type: "ItemType", keyedName: CMF.itemType, id: specialIds.cmfItemType }] }],
      },
      {
        id: "s6-cmf-tabular-view",
        catalogue: ["E42", "S6"],
        title: "cmf_TabularView with a column",
        exercises: "The cmf_TabularView export and the cmf_TabularViewColumn relationship that points at a cmf_PropertyType.",
        packages: [{ name: "LIBSJS-SCRATCH-CMFVIEW", items: [{ type: "cmf_TabularView", keyedName: CMF.view, id: { created: 0 } }] }],
      },
    ],
  },
  {
    id: "s2-ref",
    steps: [ok("import both", refPair())],
    cases: [
      {
        id: "p5-ref-off",
        catalogue: ["P5", "S2", "referenced items off"],
        title: "A package that depends on another with three referenced elements, referenced items off",
        exercises:
          "The manifest entry of a package with dependencies and referenced elements (PackageDependsOn, PackageReferencedElement), written with bExportReferencedItems off: one referenced element in the dependency, one stock List, and one id that exists nowhere.",
        packages: [{ name: "LIBSJS-SCRATCH-REF", items: [refVar] }],
      },
      {
        id: "p5-ref-on",
        catalogue: ["P5", "S2", "referenced items on"],
        title: "The same package with referenced items on",
        exercises:
          "FindReferencedElements for a package with referenced elements: the extra requests for the dependency's elements, the stock List, and the id that exists nowhere (its fault), and the extra items in the output.",
        packages: [{ name: "LIBSJS-SCRATCH-REF", items: [refVar] }],
        options: { exportReferencedItems: true },
      },
      {
        id: "p5-ref-both-on",
        catalogue: ["P5", "S2", "referenced items on"],
        title: "The package and its dependency exported together, referenced items on",
        exercises: "A dependency exported in the same run as the package that refers to its elements (the Hashtable lists the dependency first), with referenced items on.",
        packages: [
          { name: "LIBSJS-SCRATCH-REFDEP", items: [refList] },
          { name: "LIBSJS-SCRATCH-REF", items: [refVar] },
        ],
        options: { exportReferencedItems: true },
      },
    ],
  },
  {
    id: "s8-coll",
    steps: [ok("import both", collDistinct())],
    cases: [
      {
        id: "s8-coll-ab",
        catalogue: ["S8", "P4"],
        title: "Two packages whose names end in the same segment, A.Coll inserted first",
        exercises: "CreateOutputDir with two packages that share the last dot-segment (Coll): both map to Coll\\Import, so the folder the second one creates wipes the first one's. Which wins depends on the Hashtable's enumeration order.",
        packages: [
          { name: "LIBSJS-SCRATCH-A.Coll", items: [collA] },
          { name: "LIBSJS-SCRATCH-B.Coll", items: [collB] },
        ],
      },
      {
        id: "s8-coll-ba",
        catalogue: ["S8", "P4"],
        title: "The same two packages, B.Coll inserted first",
        exercises: "The same collision with the insertion order reversed: the manifest and the surviving folder show whether the enumeration order follows the insertion.",
        packages: [
          { name: "LIBSJS-SCRATCH-B.Coll", items: [collB] },
          { name: "LIBSJS-SCRATCH-A.Coll", items: [collA] },
        ],
      },
    ],
  },
  {
    id: "s7-xprop",
    steps: [ok("types and extended properties", [xprop()]), ok("instances", [xpropInstances()])],
    cases: [
      {
        id: "s7-xp-values",
        catalogue: ["E44", "S7", "xp-* values"],
        title: "Classified instance of an ItemType with two extended properties (xp-* elements)",
        exercises:
          "EXP-106: the xp-* property elements of an item get the set attribute and permission_id, here with is_null 1 (an unset value gives permission_id|value), through the fetch of an item whose class carries two extended properties.",
        note:
          "The values are unset (is_null 1, explicit 0). The server kept no value for an xp-* element sent in the add, nor in a later edit (with or without explicit=1), and the import cannot set them another way, so the branches with is_null 0 and explicit 1 have no live fixture.",
        packages: [{ name: XPROP.instancesName, items: [{ type: XPROP.itemType, keyedName: XPROP.withValues, id: xpropId(XPROP.withValues) }] }],
      },
      {
        id: "s7-xp-empty",
        catalogue: ["E44", "S7", "xp-* values"],
        title: "Unclassified instance of an ItemType whose class has extended properties",
        exercises: "EXP-106: an item of the same type that is in no class: its fetch returns no xp-* element, so the step has nothing to rewrite.",
        packages: [{ name: XPROP.instancesName, items: [{ type: XPROP.itemType, keyedName: XPROP.withoutValues, id: xpropId(XPROP.withoutValues) }] }],
      },
    ],
  },
];

export const SCRATCH_EXPORT_CASES: ScratchExportCase[] = SEED_GROUPS.flatMap((g) => g.cases);

/** 14.35 repeats the groups above with its own engine, and adds the groups of its own. */
const langType: SeededItem = { type: "ItemType", keyedName: LANG.itemType, id: langItemTypeId() };
const langItems: SeededItem[] = [LANG.all, LANG.german, LANG.plain].map((name) => ({ type: LANG.itemType, keyedName: name, id: langId(name) }));
const ONLY = "ExportLanguageResourcesOnly";
const META = "ExportMetadataWithLanguageResources";
const LANG_NOTE = "Recorded while dev had the Languages `en`, `de` and `fr` (added for the recording and deleted again afterwards, as ticket 45 did; `oracle/README.md` says how).";

/**
 * 14.35's language-resource export modes need translated values, and dev holds
 * none. The group needs the Languages `de` and `fr` on the server; the seed
 * imports a scratch ItemType whose labels and `ml_string` Properties are
 * translated, then its instances.
 */
const LANGUAGE_GROUPS: SeedGroup[] = [
  {
    id: "lang-ml",
    steps: [ok("scratch ItemType with translated labels", [lang()]), ok("instances with translated values", [langInstances()])],
    cases: [
      {
        id: "lang-only-star-itemtype",
        catalogue: ["14.35 language modes", "S10"],
        title: "ExportLanguageResourcesOnly, `*`, the translated scratch ItemType",
        exercises:
          "LP-111, LP-120 to LP-126, LP-140 to LP-145: `*` becomes `de`, `fr`; the ItemType body asks for `label_de`, `label_fr` and the like on the ItemType and on its Properties; only the language elements and what locates them are kept, the i18n elements go behind their default-language sibling, and the root Item gets xmlns:i18n.",
        packages: [{ name: LANG.name, items: [langType] }],
        options: { engineAction: ONLY, languages: ["*"] },
        note: LANG_NOTE,
        rules: ["LP-100", "LP-110", "LP-111", "LP-112", "LP-115", "LP-120", "LP-121", "LP-122", "LP-124", "LP-125", "LP-126", "LP-140", "LP-141", "LP-142", "LP-143", "LP-144", "LP-145", "LP-150"],
      },
      {
        id: "lang-meta-star-itemtype",
        catalogue: ["14.35 language modes", "S10"],
        title: "ExportMetadataWithLanguageResources, `*`, the translated scratch ItemType",
        exercises:
          "LP-123: the metadata mode selects every node's own properties together with the suffixed names, and keeps the whole item, flagging the properties whose translation differs from the default (LP-141).",
        packages: [{ name: LANG.name, items: [langType] }],
        options: { engineAction: META, languages: ["*"] },
        note: LANG_NOTE,
        rules: ["LP-100", "LP-110", "LP-111", "LP-120", "LP-121", "LP-123", "LP-124", "LP-125", "LP-126", "LP-140", "LP-141", "LP-143", "LP-144", "LP-145"],
      },
      {
        id: "lang-only-de-instances",
        catalogue: ["14.35 language modes", "S10"],
        title: "ExportLanguageResourcesOnly, `de`, three instances translated twice, once and not at all",
        exercises:
          "LP-120 to LP-126 and LP-141 to LP-143 on instances of a scratch type: the `title` and `summary` lookups, the suffixed select for `de` only (`fr` values are not asked for), and the instance with no translation, which has nothing to keep.",
        packages: [{ name: LANG.instancesName, items: langItems }],
        options: { engineAction: ONLY, languages: ["de"] },
        note: LANG_NOTE,
        rules: ["LP-100", "LP-110", "LP-114", "LP-120", "LP-121", "LP-122", "LP-124", "LP-125", "LP-126", "LP-141", "LP-142", "LP-143", "LP-144"],
      },
      {
        id: "lang-only-de-fr-instances",
        catalogue: ["14.35 language modes", "S10"],
        title: "ExportLanguageResourcesOnly, `de` and `fr`, the three instances",
        exercises: "LP-143 and LP-183: two languages per property; the order of the i18n elements of one property (the engine writes them in reverse).",
        packages: [{ name: LANG.instancesName, items: langItems }],
        options: { engineAction: ONLY, languages: ["de", "fr"] },
        note: LANG_NOTE,
        rules: ["LP-100", "LP-121", "LP-125", "LP-141", "LP-142", "LP-143", "LP-183"],
      },
      {
        id: "lang-only-en-de-instances",
        catalogue: ["14.35 language modes", "S10"],
        title: "ExportLanguageResourcesOnly, `en` and `de`",
        exercises: "LP-112: `en` is removed from the list, so the run is the one of `de` alone.",
        packages: [{ name: LANG.instancesName, items: langItems }],
        options: { engineAction: ONLY, languages: ["en", "de"] },
        note: LANG_NOTE,
        rules: ["LP-100", "LP-112"],
      },
      {
        id: "lang-meta-de-instances",
        catalogue: ["14.35 language modes", "S10"],
        title: "ExportMetadataWithLanguageResources, `de`, the three instances",
        exercises: "LP-123, LP-141, LP-186: the metadata mode keeps the whole item and the `de` values beside it.",
        packages: [{ name: LANG.instancesName, items: langItems }],
        options: { engineAction: META, languages: ["de"] },
        note: LANG_NOTE,
        rules: ["LP-100", "LP-123", "LP-124", "LP-125", "LP-141", "LP-143", "LP-144", "LP-186"],
      },
      {
        id: "lang-meta-star-instances",
        catalogue: ["14.35 language modes", "S10"],
        title: "ExportMetadataWithLanguageResources, `*`, the three instances",
        exercises: "LP-111 in the metadata mode: `*` is `de`, `fr`.",
        packages: [{ name: LANG.instancesName, items: langItems }],
        options: { engineAction: META, languages: ["*"] },
        note: LANG_NOTE,
        rules: ["LP-100", "LP-111", "LP-123", "LP-143"],
      },
      {
        id: "lang-both-packages-only-star",
        catalogue: ["14.35 language modes", "S10"],
        title: "ExportLanguageResourcesOnly, `*`, the ItemType and its instances in two packages",
        exercises: "LP-150, LP-184: a run over two packages, the ml lookups repeated for every visit, and the parallel loop of EXP-551 in a language mode.",
        packages: [
          { name: LANG.name, items: [langType] },
          { name: LANG.instancesName, items: langItems },
        ],
        options: { engineAction: ONLY, languages: ["*"] },
        note: LANG_NOTE,
        rules: ["LP-100", "LP-126", "LP-150", "LP-151", "LP-184", "EXP-551"],
      },
      {
        id: "lang-export-de-instances",
        catalogue: ["14.35 language modes", "S10"],
        title: "A plain Export of the instances with the list `de`",
        exercises: "LP-110: outside the language modes the list is only checked against the installed languages; the export asks for no translated values and the output is that of a plain export.",
        packages: [{ name: LANG.instancesName, items: langItems }],
        options: { languages: ["de"] },
        note: LANG_NOTE,
        rules: ["LP-110", "LP-114", "LP-100"],
      },
      {
        id: "lang-only-upper-case-code",
        catalogue: ["14.35 language modes", "S10"],
        title: "ExportLanguageResourcesOnly with `DE`",
        exercises: "LP-180: the check compares exactly while the server's codes are lower-cased, so `DE` is reported as not installed although `de` is.",
        packages: [{ name: LANG.instancesName, items: langItems }],
        options: { engineAction: ONLY, languages: ["DE"] },
        expectsError: true,
        note: LANG_NOTE,
        rules: ["LP-114", "LP-115", "LP-180"],
      },
    ],
  },
];

export const SEED_GROUPS_1435: SeedGroup[] = [...SEED_GROUPS, ...LANGUAGE_GROUPS];
export const SCRATCH_EXPORT_CASES_1435: ScratchExportCase[] = SEED_GROUPS_1435.flatMap((g) => g.cases);

/** Finds the id of a seeded item in the created lists (see `SeededItem`). */
export function resolveItem(item: SeededItem, created: readonly ItemRef[]): string {
  if (typeof item.id === "string") return item.id;
  const ofType = created.filter((c) => c.type === item.type);
  const found = ofType[item.id.created];
  if (found === undefined) {
    throw new Error(`${item.type} "${item.keyedName}": the seed created ${ofType.length} ${item.type} item(s), so there is no number ${item.id.created}`);
  }
  return found.id;
}

export function resolveCase(c: ScratchExportCase, created: readonly ItemRef[]): ResolvedCase {
  return {
    id: c.id,
    catalogue: c.catalogue,
    title: c.title,
    exercises: c.exercises,
    packages: c.packages.map((p) => ({ name: p.name, items: p.items.map((i) => ({ type: i.type, keyedName: i.keyedName, id: resolveItem(i, created) })) })),
    ...(c.options === undefined ? {} : { options: c.options }),
    ...(c.note === undefined ? {} : { note: c.note }),
    ...(c.rules === undefined ? {} : { rules: c.rules }),
    ...(c.expectsError === undefined ? {} : { expectsError: c.expectsError }),
  };
}
