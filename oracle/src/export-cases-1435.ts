import { EXPORT_CASES, type ExportCase, type ExportCaseItem, type ExportCasePackage } from "./export-cases.js";

/**
 * The 14.35 export fixture cases (ticket 57), the input of
 * `npm run oracle:export-cases -- --engine 14.35`. They are ticket 05's
 * catalogue and option matrix, the same items as 14.0.7's, plus the cases of
 * every `[14.35]` export rule that a server run can show: the request tree and
 * its level, the first-failure stop, the cancel, parallel runs, and the
 * language-resource modes that need no translated data. Cases that need
 * scratch state on dev (S2, S6 to S8, and the translated values of the
 * language modes) are in `export-scratch-cases.ts` (`SEED_GROUPS_1435`).
 *
 * 14.35 exports the items of a package in parallel (EXP-551), so the cases
 * whose outcome depends on timing are recorded three times (`-run1` to
 * `-run3`). Their logs, messages and the files of the items in flight compare
 * as sets (EXP-558).
 */

const P = "com.aras.innovator.";

const item = (type: string, id: string, keyedName: string): ExportCaseItem => ({ type, id, keyedName });
const pkg = (name: string, ...items: ExportCaseItem[]): ExportCasePackage => ({ name, items });

/** The 14.0.7 catalogue, unchanged but for the notes that point at scratch state ticket 57 records as well. */
const CATALOGUE: ExportCase[] = EXPORT_CASES.map((c) => {
  const { note: _note, ...rest } = c;
  return rest;
});

/** Eighteen small Lists of `com.aras.innovator.core`, the items of the parallel, abort and cancel cases. */
export const CORE_LISTS: readonly ExportCaseItem[] = [
  item("List", "EAB29654E2CD4D30B376957788198B40", "Categories"),
  item("List", "51D8F6076D2E41AAA7D72D6F1B2184D1", "Configurable Grid Events"),
  item("List", "858DCAAD7FF94EDC969A1C3CFA57FA93", "Data Types"),
  item("List", "972269F295174215AEB67FB24262468D", "DBUpgadeStatus"),
  item("List", "F90729D18482477CBB61311F108A3379", "DBUpgradeType"),
  item("List", "6056059D6CCB4E65A6465E1C36D2055D", "Field Length Unit"),
  item("List", "AEE9D6567EDB45A4A50A669F5B385BD5", "Field Positioning"),
  item("List", "DA63CDCCBB654870B291EBA9A5FFBBA9", "Field Types"),
  item("List", "4E7C6E40D16145D399C9E7D468E5E28E", "Form Events"),
  item("List", "61C1853DD1A44AAF85A519A6FACF8203", "Form View Types"),
  item("List", "61E86B1378F64F67B729F9EA0FAB9BED", "Grid Events"),
  item("List", "B65DA95B86694210BBD6490C894C0DA0", "ItemType Implementation"),
  item("List", "9369CAC90D9942D5B9260EC502593BBE", "Method Types"),
  item("List", "242AA7A17BC14718AA7302912CDE8910", "RelationshipType Hide In"),
  item("List", "5AD0FB60496647E2862A4323BBAD2F6C", "Report Types"),
  item("List", "0F4DD6406FFB4CAFBB244FA7A4D06D0F", "Server Events Version"),
  item("List", "B6DD3DDC3BD9494185913C6CB274E141", "Server Events"),
  item("List", "80A7E494F7294BCF9AF46A4D980862E4", "SQL Item Execution Flags"),
];

/** Two Lists that exist nowhere: the type's lookup finds no item, so the export of each one fails. */
const NOPE_ONE = item("List", "00000000000000000000000000000001", "Nope One");
const NOPE_TWO = item("List", "00000000000000000000000000000002", "Nope Two");

const E14 = item("List", "01B506E02528434DB36D562A3FAB826D", "cmf_DocumentPropertyDataType");
const E24 = item("Grid", "4B9FF34674E34677B877FC8F71B5CDBE", "History_whereTemplateUsed");
const E53 = item("CommandBarSection", "0212985C3E90930D618120D9625E4BB8", "Language_TOC_Content");
const LOCALE_TOC = item("CommandBarSection", "35C6304FF739C77F618120D9625E4BB8", "Locale_TOC_Content");
const PLM_VARIABLES = [
  item("Variable", "968471EC23804034A3B7B2B5C78601E7", "CAD Angular Units"),
  item("Variable", "A41D0BAAF61B4427BAE59D3879DB5FF6", "CAD Length Units"),
  item("Variable", "ED8C1F0C5721435A9CA1D8FADB30A168", "CAD Transformation Matrix Format"),
  item("Variable", "049573909D3D49FD81E0C2AEA1CDD62C", "PE_Impact_Matrix_expand"),
  item("Variable", "679408C1EFE845AFA526D3897B42DBFF", "Product Engineering"),
];

const PARALLEL = ["EXP-551", "EXP-552", "EXP-553", "EXP-554", "EXP-558"] as const;
const FIRST_FAILURE = ["EXP-516", "EXP-555", "EXP-570", "EXP-571", "EXP-572", "EXP-558"] as const;
const CANCEL = ["EXP-518", "EXP-557", "EXP-570", "EXP-572", "EXP-558"] as const;
const TREE = ["EXP-021", "EXP-022", "EXP-060", "EXP-061"] as const;

/** A case recorded three times: the engine's runs differ from each other in the parts EXP-558 lists, and the fixtures keep each. */
function threeRuns(base: ExportCase): ExportCase[] {
  return [1, 2, 3].map((n) => ({ ...base, id: `${base.id}-run${n}`, title: `${base.title} (run ${n} of 3)` }));
}

const ONLY = "ExportLanguageResourcesOnly";
const META = "ExportMetadataWithLanguageResources";
const LANGUAGE_RULES = (...more: string[]) => ["LP-100", ...more];
const EN_ONLY_NOTE = "Recorded while dev had the Language `en` only. With a second Language the `*` expands to its code and the same item is exported with translations: see the `lang-*` cases (seeded and cleaned up by `oracle:export-scratch-cases`).";

const DE_FR_NOTE = "Recorded while dev had the Languages `en`, `de` and `fr` (added for the recording and deleted again afterwards). Stock items carry no `de` or `fr` values, so every translated slot of the answer is empty.";
const PART = item("ItemType", "4F1AC04A2B484F3ABA4E20DB63808A88", "Part");

const EXTRA: ExportCase[] = [
  // ---- the request tree and the level (EXP-021, EXP-022, EXP-060 to EXP-062) ----
  {
    id: "x-level-0",
    catalogue: ["14.35 request tree"],
    title: "CommandBarSection: sLevel 0",
    exercises:
      "A level of 0 gives the bare item with no tree: none of the relationship-type lookups of EXP-061 is sent, and the main fetch asks for the item alone. Compare e53-level-1 to e53-level-3.",
    packages: [pkg(`${P}i18n`, E53)],
    options: { level: "0" },
    rules: [...TREE],
  },
  {
    id: "x-level-not-a-number",
    catalogue: ["14.35 request tree"],
    title: "Two CommandBarSections with a level that is not a number",
    exercises:
      "The default row of EXP-021 parses the level: 'abc' makes the factory of the type's template throw a FormatException, the Lazy keeps it, and the second item of the type gets the same exception without a request (EXP-062). The exception is not a CItemException, so it ends the run through the aggregate handler of EXP-556 as a warning. No file is written.",
    packages: [pkg(`${P}i18n`, E53, LOCALE_TOC)],
    options: { level: "abc" },
    rules: [...TREE, "EXP-054", "EXP-062", "EXP-556"],
  },
  {
    id: "x-template-shared-across-packages",
    catalogue: ["14.35 request tree"],
    title: "Lists of two packages: one template per type for the whole call",
    exercises:
      "The dictionary of EXP-060 belongs to the ExportSolutions call, not to the package: the Lists of the second package send no template lookups, and the level they pass is ignored.",
    packages: [pkg(`${P}core`, CORE_LISTS[0]!, CORE_LISTS[1]!), pkg(`${P}cmf`, E14)],
    rules: [...TREE],
  },

  // ---- the first failed item stops the whole export (EXP-555) ----
  {
    id: "x-abort-middle-no",
    catalogue: ["14.35 abort"],
    title: "A failing List between healthy ones, ErrorQuestion answered no",
    exercises:
      "EXP-555: the failed item sends 'Error of exporting Item', the fault block and the abort question, then stops the whole export. Items already running finish and write their files, items not started never run, and the log holds none of their success lines (EXP-570). Compare e40-workflow-promotion-error-no, where 14.0.7 aborts the package only.",
    packages: [pkg(`${P}core`, ...CORE_LISTS.slice(0, 4), NOPE_TWO, ...CORE_LISTS.slice(4, 8))],
    options: { errorQuestionAnswer: "no" },
    rules: [...FIRST_FAILURE],
  },
  {
    id: "x-abort-middle-yes",
    catalogue: ["14.35 abort"],
    title: "The same run with ErrorQuestion answered yes",
    exercises:
      "The same items as x-abort-middle-no with the question answered yes. EXP-571: the answer is never read, so both answers stop the export the same way.",
    packages: [pkg(`${P}core`, ...CORE_LISTS.slice(0, 4), NOPE_TWO, ...CORE_LISTS.slice(4, 8))],
    options: { errorQuestionAnswer: "yes" },
    rules: [...FIRST_FAILURE],
  },
  {
    id: "x-abort-two-failures",
    catalogue: ["14.35 abort"],
    title: "Two failing Lists in one package",
    exercises:
      "EXP-572: only the first failure of a run is reported. The second finds the state already cancelled and is dropped without a message or a log line.",
    packages: [pkg(`${P}core`, NOPE_ONE, ...CORE_LISTS.slice(0, 3), NOPE_TWO)],
    rules: [...FIRST_FAILURE],
  },
  {
    id: "x-abort-skips-later-package",
    catalogue: ["14.35 abort"],
    title: "A failing item in a package that the manifest enumerates first, a healthy package after it",
    exercises:
      "EXP-555: the remaining packages are skipped, with no manifest entry, directory, definition lookup or message. The Hashtable of the host enumerates `core` before `history` here (EXP-508), although `history` was inserted first, so the failing package comes first and `history` is never exported. The pair with x-abort-after-healthy-package inserts them the other way round.",
    packages: [pkg(`${P}history`, E24), pkg(`${P}core`, NOPE_ONE, CORE_LISTS[0]!)],
    rules: [...FIRST_FAILURE, "EXP-508"],
  },
  {
    id: "x-abort-after-healthy-package",
    catalogue: ["14.35 abort"],
    title: "The same two packages inserted the other way round: the healthy package comes first",
    exercises:
      "The packages of x-abort-skips-later-package with `core` inserted first. The Hashtable then enumerates `history` first, so its item is exported and logged, and the failure in `core` ends the run after it. The manifest holds both packages.",
    packages: [pkg(`${P}core`, NOPE_ONE, CORE_LISTS[0]!), pkg(`${P}history`, E24)],
    rules: [...FIRST_FAILURE, "EXP-508"],
  },

  // ---- Cancel (EXP-557), three runs ----
  ...threeRuns({
    id: "x-cancel-after-5",
    catalogue: ["14.35 cancel"],
    title: "Cancel() pressed after the fifth status message, eighteen Lists",
    exercises:
      "EXP-557: every worker looks at the flag when its iteration starts; those that see it write 'Export was canceled by user' and 'end of execution', and stop the loop. Items already running write their files with no success line (EXP-570). The cancel pair can appear more than once. The package loop ends and the run finishes normally.",
    packages: [pkg(`${P}core`, ...CORE_LISTS)],
    options: { cancelAfterStatus: 5 },
    rules: [...CANCEL],
  }),

  // ---- Parallel runs (EXP-551 to EXP-554, EXP-558), three runs each ----
  ...threeRuns({
    id: "x-par-18-lists",
    catalogue: ["14.35 parallel"],
    title: "Eighteen Lists of one package",
    exercises:
      "EXP-551 to EXP-554: the items of a package run concurrently. The log's success lines, the 'Item {i} of 18' texts and the order of the finished items are not fixed; the manifest, the header and the files are.",
    packages: [pkg(`${P}core`, ...CORE_LISTS)],
    rules: [...PARALLEL],
  }),
  ...threeRuns({
    id: "x-par-two-packages",
    catalogue: ["14.35 parallel"],
    title: "Eight Lists and five Variables in two packages",
    exercises:
      "Packages are still exported one after another (EXP-551), each with its own parallel loop, so the package headers and 'start of execution' lines stay in order while the lines between them are a set.",
    packages: [pkg(`${P}core`, ...CORE_LISTS.slice(0, 8)), pkg(`${P}solution.PLM`, ...PLM_VARIABLES)],
    rules: [...PARALLEL, "EXP-508"],
  }),

  // ---- the language modes with only `en` installed (LP-100 to LP-114) ----
  {
    id: "l1-only-star",
    catalogue: ["14.35 language modes"],
    title: "ExportLanguageResourcesOnly with `*` on a server that has `en` only",
    exercises:
      "LP-111, LP-112: `*` becomes the server's codes, `en` is removed, so the list is empty and the engine sends no translated-value request; the reshaping steps of LP-140 to LP-145 still run on the plain answer.",
    packages: [pkg(`${P}cmf`, E14)],
    options: { engineAction: ONLY, languages: ["*"] },
    note: EN_ONLY_NOTE,
    rules: LANGUAGE_RULES("LP-110", "LP-111", "LP-112", "LP-115", "LP-124", "LP-140", "LP-150"),
  },
  {
    id: "l1-meta-star",
    catalogue: ["14.35 language modes"],
    title: "ExportMetadataWithLanguageResources with `*` on a server that has `en` only",
    exercises: "The same list as l1-only-star in the other mode: the metadata is exported and no translations are asked for.",
    packages: [pkg(`${P}cmf`, E14)],
    options: { engineAction: META, languages: ["*"] },
    note: EN_ONLY_NOTE,
    rules: LANGUAGE_RULES("LP-110", "LP-111", "LP-112", "LP-123", "LP-140", "LP-150"),
  },
  {
    id: "l1-only-en",
    catalogue: ["14.35 language modes"],
    title: "ExportLanguageResourcesOnly with the list `en`",
    exercises: "LP-112: `en` is removed by exact comparison, leaving an empty list: no Language request for the check (LP-114) and no translated-value request.",
    packages: [pkg(`${P}cmf`, E14)],
    options: { engineAction: ONLY, languages: ["en"] },
    note: EN_ONLY_NOTE,
    rules: LANGUAGE_RULES("LP-110", "LP-112", "LP-114"),
  },
  {
    id: "l1-only-not-installed",
    catalogue: ["14.35 language modes"],
    title: "ExportLanguageResourcesOnly with `de` on a server that lacks it",
    exercises: "LP-114: the constructor's installed-language check throws a CItemException that names the missing code; no package is touched.",
    packages: [pkg(`${P}cmf`, E14)],
    options: { engineAction: ONLY, languages: ["de"] },
    expectsError: true,
    note: EN_ONLY_NOTE,
    rules: LANGUAGE_RULES("LP-114", "LP-115"),
  },
  {
    id: "l1-meta-not-installed",
    catalogue: ["14.35 language modes"],
    title: "ExportMetadataWithLanguageResources with `de` on a server that lacks it",
    exercises: "LP-114 in the other mode: the same refusal.",
    packages: [pkg(`${P}cmf`, E14)],
    options: { engineAction: META, languages: ["de"] },
    expectsError: true,
    note: EN_ONLY_NOTE,
    rules: LANGUAGE_RULES("LP-114", "LP-115"),
  },
  {
    id: "l1-only-star-and-code",
    catalogue: ["14.35 language modes"],
    title: "ExportLanguageResourcesOnly with `*` and `de`",
    exercises: "LP-111: only the exact one-entry list `*` is expanded. In `*`, `de` the star is an ordinary code, which the installed-language check reports as missing.",
    packages: [pkg(`${P}cmf`, E14)],
    options: { engineAction: ONLY, languages: ["*", "de"] },
    expectsError: true,
    note: EN_ONLY_NOTE,
    rules: LANGUAGE_RULES("LP-111", "LP-114"),
  },
  {
    id: "l1-only-no-list",
    catalogue: ["14.35 language modes"],
    title: "ExportLanguageResourcesOnly with no language list at all",
    exercises: "LP-113: the context's `Languages` is null. Reaching the constructor with a null list in a language mode throws an ArgumentNullException before any request. (The reference host never passes null; a library caller can.)",
    packages: [pkg(`${P}cmf`, E14)],
    options: { engineAction: ONLY },
    expectsError: true,
    note: EN_ONLY_NOTE,
    rules: LANGUAGE_RULES("LP-113"),
  },
  {
    id: "l1-export-with-languages",
    catalogue: ["14.35 language modes"],
    title: "A plain Export with the list `en`",
    exercises: "LP-110: outside the language modes the constructor only runs the installed-language check, and `en` is checked like any other code. The export itself is the plain one.",
    packages: [pkg(`${P}cmf`, E14)],
    options: { languages: ["en"] },
    note: EN_ONLY_NOTE,
    rules: LANGUAGE_RULES("LP-110", "LP-114"),
  },
  {
    id: "l1-export-language-not-installed",
    catalogue: ["14.35 language modes"],
    title: "A plain Export with the list `fr` on a server that lacks it",
    exercises: "LP-114: the check runs for every action, so a plain Export with a language the server lacks is refused as well.",
    packages: [pkg(`${P}cmf`, E14)],
    options: { languages: ["fr"] },
    expectsError: true,
    note: EN_ONLY_NOTE,
    rules: LANGUAGE_RULES("LP-114"),
  },

  // ---- the language modes with `de` and `fr` installed, on stock items (no stored translations) ----
  {
    id: "l3-only-de-stock-list",
    catalogue: ["14.35 language modes"],
    title: "ExportLanguageResourcesOnly, `de`, a stock List",
    exercises:
      "LP-120 to LP-125, LP-142: a List and its Value relationships asked for `label_de`. Stock values have no translation, so the answer holds empty i18n elements and the reshaping keeps only what locates the item.",
    packages: [pkg(`${P}cmf`, E14)],
    options: { engineAction: ONLY, languages: ["de"] },
    note: DE_FR_NOTE,
    rules: LANGUAGE_RULES("LP-120", "LP-121", "LP-124", "LP-125", "LP-141", "LP-142", "LP-150"),
  },
  {
    id: "l3-only-star-stock-itemtype",
    catalogue: ["14.35 language modes"],
    title: "ExportLanguageResourcesOnly, `*`, the stock ItemType Part",
    exercises:
      "LP-111, LP-122, LP-126: `*` becomes `de`, `fr`; the ItemType body (EXP-024) with a select per node and the ml lookups repeated for the types it reaches. Many requests, no stored translation.",
    packages: [pkg(`${P}solution.PLM`, PART)],
    options: { engineAction: ONLY, languages: ["*"] },
    note: DE_FR_NOTE,
    rules: LANGUAGE_RULES("LP-111", "LP-120", "LP-122", "LP-126", "LP-142", "LP-184"),
  },
  {
    id: "l3-meta-de-stock-itemtype",
    catalogue: ["14.35 language modes"],
    title: "ExportMetadataWithLanguageResources, `de`, the stock ItemType Part",
    exercises: "LP-123: the metadata mode on a large ItemType, with the whole item kept and the empty `de` slots beside it.",
    packages: [pkg(`${P}solution.PLM`, PART)],
    options: { engineAction: META, languages: ["de"] },
    note: DE_FR_NOTE,
    rules: LANGUAGE_RULES("LP-123", "LP-124", "LP-125", "LP-141", "LP-143", "LP-144"),
  },
];

/** The cases of `fixtures/14.35/export/`, after the language cases that need translated values (`SCRATCH_EXPORT_CASES_1435`). */
export const EXPORT_CASES_1435: readonly ExportCase[] = [...CATALOGUE, ...EXTRA];

export { SCRATCH_EXPORT_CASES_1435 } from "./export-scratch-cases.js";
