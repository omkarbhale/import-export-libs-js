import { aml, esc, item, property, sid, src, type PackageFile, type ScratchPackage } from "./import-packages.js";

/**
 * The `LIBSJS-SCRATCH-*` import packages of ticket 75: the ones that exercise
 * what only 14.35 does (the AML batch mode, the collected errors, the language
 * selection and the `build.xsl` groups of `cui_` items), as code, so every
 * fixture can be rebuilt byte for byte. The same rules as `import-packages.ts`
 * hold: scratch names, nothing refers to a non-scratch item except read-only
 * lookups, and what is deleted is addressed by its own id.
 */

// ---------------------------------------------------------------------------
// S9 for the batch and collected-errors cases: seven Variables, as many as
// ticket 05's S9 packages.
// ---------------------------------------------------------------------------

const bt = (name: string) => sid(`BATCH35:${name}`);

const var35 = (n: number, tag: string, extra: string[] = [], nameOverride?: string): PackageFile => {
  const own = `LIBSJS-SCRATCH-${tag}_${n}`;
  return aml("Variable", `${own}.xml`, item("Variable", bt(`${tag}${n}`), "add", [`<default_value>${n}</default_value>`, `<name>${nameOverride ?? own}</name>`, ...extra]));
};

/** Seven Variables that all import. */
export function batchGood(tag = "BatchOk", name = "LIBSJS-SCRATCH-BATCHOK"): ScratchPackage {
  return { name, files: [1, 2, 3, 4, 5, 6, 7].map((n) => var35(n, tag)) };
}

/** Seven Variables, two of which (3 and 5) repeat the name of the first, so the server refuses them. */
export function batchTwoServerFailures(): ScratchPackage {
  const tag = "BatchTwo";
  const first = `LIBSJS-SCRATCH-${tag}_1`;
  return {
    name: "LIBSJS-SCRATCH-BATCHTWO",
    files: [var35(1, tag), var35(2, tag), var35(3, tag, [], first), var35(4, tag), var35(5, tag, [], first), var35(6, tag), var35(7, tag)],
  };
}

/** A second package with one failing item (the fourth repeats the first's name), for two packages in a run. */
export function batchOneServerFailure(tag: string, name: string): ScratchPackage {
  return { name, files: [var35(1, tag), var35(2, tag), var35(3, tag), var35(4, tag, [], `LIBSJS-SCRATCH-${tag}_1`), var35(5, tag), var35(6, tag), var35(7, tag)] };
}

/** The S9 shape of ticket 05 under other names: the fourth of seven items fails the engine's own check. */
export function batchBadCheck(): ScratchPackage {
  const tag = "BatchChk";
  const bad = var35(4, tag, ["<Relationships>", item("Property", bt("badrel"), "add", ["<name>nope</name>"]), "</Relationships>"]);
  return { name: "LIBSJS-SCRATCH-BATCHCHK", files: [var35(1, tag), var35(2, tag), var35(3, tag), bad, var35(5, tag), var35(6, tag), var35(7, tag)] };
}

// ---------------------------------------------------------------------------
// Delayed resolution: the duplicate entry (IMP-251) and the Property edit
// addressed by `where` (IMP-220).
// ---------------------------------------------------------------------------

const du = (name: string) => sid(`DELAY35:${name}`);

const identity35 = (letter: string, file: string, members: string[]): PackageFile => {
  const name = `LIBSJS-SCRATCH-DelayId_${letter}`;
  return aml(
    "Identity",
    `${file}.xml`,
    item("Identity", du(name), "add", ["<description />", "<is_alias>0</is_alias>", `<name>${name}</name>`, ...(members.length === 0 ? [] : ["<Relationships>", ...members, "</Relationships>"])]),
  );
};

const member35 = (owner: string, relatedName: string): string =>
  item("Member", du(`${owner}.member`), "add", [
    `<related_id keyed_name="${relatedName}" type="Identity">${du(relatedName)}</related_id>`,
    "<sort_order>128</sort_order>",
    src("Identity", owner, du(owner)),
  ]);

/**
 * The same Identity (same id, same Member to an Identity a later file adds) in two files.
 * With merge on the second file's item is an edit, its check queues the same delayed entry, and 14.35 drops the duplicate.
 */
export function delayedDuplicate(): ScratchPackage {
  const a = "LIBSJS-SCRATCH-DelayId_A";
  const z = "LIBSJS-SCRATCH-DelayId_Z";
  return {
    name: "LIBSJS-SCRATCH-DELAYDUP",
    files: [identity35("A", "LIBSJS-SCRATCH-DelayId_A1", [member35(a, z)]), identity35("A", "LIBSJS-SCRATCH-DelayId_A2", [member35(a, z)]), identity35("Z", "LIBSJS-SCRATCH-DelayId_Z", [])],
  };
}

const itName = "LIBSJS_SCRATCH_DELAY_X";
const itRef = "LIBSJS_SCRATCH_DELAY_Y";
const dname = (n: string) => du(n);

const itemTypeShell = (name: string, relationships: string[]): PackageFile =>
  aml(
    "ItemType",
    `${name.replace("LIBSJS_SCRATCH_", "LIBSJS-SCRATCH-")}.xml`,
    item("ItemType", dname(name), "add", [
      "<allow_private_permission>1</allow_private_permission>",
      "<auto_search>1</auto_search>",
      "<enforce_discovery>1</enforce_discovery>",
      "<hide_where_used>0</hide_where_used>",
      "<implementation_type>table</implementation_type>",
      `<instance_data>${name.toUpperCase()}</instance_data>`,
      "<is_dependent>0</is_dependent>",
      "<is_relationship>0</is_relationship>",
      "<is_versionable>0</is_versionable>",
      `<label xml:lang="en">${name}</label>`,
      "<show_parameters_tab>1</show_parameters_tab>",
      "<structure_view>tabs off</structure_view>",
      "<unlock_on_logout>0</unlock_on_logout>",
      "<use_src_access>0</use_src_access>",
      `<name>${name}</name>`,
      ...(relationships.length === 0 ? [] : ["<Relationships>", ...relationships, "</Relationships>"]),
    ]),
  );

/** The `where` of the Property below: scoped to the scratch ItemType and the property's name, so the delayed edit it becomes can touch nothing else. */
export const PROPERTY_WHERE = `[Property].source_id='${dname(itName)}' AND [Property].name='ref'`;

/**
 * A scratch ItemType whose Property `ref` has no `id`, only a `where`, and a data_source naming an ItemType that a
 * later file adds. The reference cannot be resolved while the Property is checked, so 14.35 queues the delayed edit
 * addressed by that `where` (IMP-220), where 14.0.7 addressed it by an empty id.
 */
export function delayedPropertyWhere(): ScratchPackage {
  const withWhere = property(itName, "ref", 128, [`<data_source keyed_name="${itRef}" type="ItemType">${dname(itRef)}</data_source>`], "item", false, dname).replace(
    / id="[0-9A-F]{32}" action="add">/,
    ` action="add" where="${esc(PROPERTY_WHERE)}">`,
  );
  return { name: "LIBSJS-SCRATCH-DELAYPROP", files: [itemTypeShell(itName, [withWhere]), itemTypeShell(itRef, [])] };
}

// ---------------------------------------------------------------------------
// build.xsl: cui_Control and cui_WindowSection have groups of their own in 14.35.
// ---------------------------------------------------------------------------

const cu = (name: string) => sid(`CUI:${name}`);
/** The stock cui_Location "ItemView": only read by the scratch window sections. */
const ITEM_VIEW_LOCATION = "C18BD6E10E024EC786799C510D586143";

/**
 * Items of the two types between others, in an order that differs from the one build.xsl gives them:
 * 14.35 imports the cui_Controls, then the cui_WindowSections, right after the Report group and before the Forms.
 * The classification of a window section is a value the stock sections use.
 */
export function cuiOrder(): ScratchPackage {
  const control = (n: number) => {
    const name = `LIBSJS-SCRATCH-Cui_Control_${n}`;
    return aml("cui_Control", `${name}.xml`, item("cui_Control", cu(name), "add", ["<control_type>ToolbarControl</control_type>", `<name>${name}</name>`]));
  };
  const section = (n: number) => {
    const name = `LIBSJS-SCRATCH-Cui_WindowSection_${n}`;
    return aml(
      "cui_WindowSection",
      `${name}.xml`,
      item("cui_WindowSection", cu(name), "add", ["<classification>Data Model</classification>", `<location keyed_name="ItemView" type="cui_Location">${ITEM_VIEW_LOCATION}</location>`, `<name>${name}</name>`]),
    );
  };
  const variable = aml("Variable", "LIBSJS-SCRATCH-Cui_Var_1.xml", item("Variable", cu("var1"), "add", ["<default_value>1</default_value>", "<name>LIBSJS-SCRATCH-Cui_Var_1</name>"]));
  const list = aml("List", "LIBSJS-SCRATCH-Cui_List_1.xml", item("List", cu("list1"), "add", ["<name>LIBSJS-SCRATCH-Cui_List_1</name>"]));
  const form = aml("Form", "LIBSJS-SCRATCH-Cui_Form_1.xml", item("Form", cu("form1"), "add", ["<name>LIBSJS-SCRATCH-Cui_Form_1</name>"]));
  const report = aml("Report", "LIBSJS-SCRATCH-Cui_Report_1.xml", item("Report", cu("report1"), "add", ["<name>LIBSJS-SCRATCH-Cui_Report_1</name>", "<type>item</type>"]));
  return { name: "LIBSJS-SCRATCH-CUI", files: [form, section(1), control(1), variable, section(2), report, control(2), list] };
}

// ---------------------------------------------------------------------------
// Languages: a List with two Values whose labels exist in the given languages.
// ---------------------------------------------------------------------------

const lg = (name: string) => sid(`LANG35:${name}`);

/**
 * A List and two Values with a label in each of `codes`. Each label is a direct child of its `Item`, which is
 * where the scan of IMP-611 reads `xml:lang`. `tag` makes the names and ids of one case differ from another's.
 */
export function langPackage(codes: readonly string[], opts: { name?: string; tag?: string; extraFiles?: PackageFile[] } = {}): ScratchPackage {
  const tag = opts.tag ?? "Lang";
  const listName = `LIBSJS-SCRATCH-${tag}-List_1`;
  const listId = lg(`${tag}:${listName}`);
  const labels = (text: string) => codes.map((c) => `<label xml:lang="${esc(c)}">${esc(text)} (${esc(c)})</label>`);
  const value = (i: number) =>
    item("Value", lg(`${tag}:v${i}`), "add", [...labels(`Value ${i}`), "<sort_order>128</sort_order>", src("List", listName, listId), `<value>lang${i}</value>`]);
  return {
    name: opts.name ?? `LIBSJS-SCRATCH-${tag.toUpperCase()}`,
    files: [aml("List", `${listName}.xml`, item("List", listId, "add", [`<name>${listName}</name>`, "<Relationships>", value(1), value(2), "</Relationships>"])), ...(opts.extraFiles ?? [])],
  };
}

/** A file the import never reads (it sits in the package folder itself) and the 14.35 scan cannot parse (IMP-612). */
export const strayBrokenFile = (): PackageFile => ({ dir: null, file: "LIBSJS-SCRATCH-notes.xml", content: "this is not xml\n" });

/** A package whose item files carry `xml:lang` on the Item element itself and on a child, both in the same code (IMP-634). */
export function langOnItemElement(): ScratchPackage {
  const listName = "LIBSJS-SCRATCH-LangSelf-List_1";
  const id = lg(`self:${listName}`);
  return {
    name: "LIBSJS-SCRATCH-LANGSELF",
    files: [
      aml("List", `${listName}.xml`, item("List", id, "add", [`<name>${listName}</name>`, '<description xml:lang="fr">scratch fr</description>'], 'xml:lang="fr"')),
    ],
  };
}
