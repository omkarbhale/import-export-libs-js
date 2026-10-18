import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The `LIBSJS-SCRATCH-*` import packages of ticket 05's design (S1 to S9 and
 * the manifest and file-system cases), as code, so every fixture can be
 * rebuilt byte for byte. Item files are written the way the engine's export
 * writes them (BOM, CRLF, no trailing newline), because the import reads
 * exactly that shape.
 *
 * Rules every package keeps (AGENTS.md, "Live Aras"):
 * - packages are named `LIBSJS-SCRATCH-<X>`, item files `LIBSJS-SCRATCH-<...>.xml`;
 * - a top-level item is named `LIBSJS-SCRATCH-<...>`, or `LIBSJS_SCRATCH_<...>`
 *   for an ItemType, whose name Aras restricts to word characters;
 * - nothing refers to a non-scratch item except read-only lookups (World,
 *   Administrators, stock ItemTypes);
 * - an item that is deleted is addressed by its own id, never by `where`.
 */

/** Aras id of the World identity, and of Administrators (stock; read-only lookups). */
export const WORLD_ID = "A73B655731924CD0B027E4F4D5FCC0A9";
export const ADMINISTRATORS_ID = "2618D6F5A90949BAA7E920D1B04C7EE1";

/** A stable 32-hex Aras id for a scratch item: the same name always gives the same id. */
export function sid(name: string): string {
  return createHash("sha1").update(`libsjs-scratch:${name}`).digest("hex").slice(0, 32).toUpperCase();
}

/** XML text/attribute escaping for names that go into the files. */
export const esc = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface PackageFile {
  /** The type folder directly under the package folder; `null` puts the file in the package folder itself. */
  dir: string | null;
  /** File name with its extension. The PackageElement name is this name without the extension. */
  file: string;
  /** LF text; written with a BOM and CRLF, like the export. Or raw bytes, written as given. */
  content: string | Buffer;
}

export interface Dependency {
  name: string;
  referenced?: { id: string; type: string; descr: string }[];
}

export interface ScratchPackage {
  /** The manifest `name`. */
  name: string;
  /** The manifest `path`, in Windows form. Default `<name>\Import`. */
  path?: string;
  dependsOn?: Dependency[];
  files: PackageFile[];
}

export const packagePath = (p: ScratchPackage): string => p.path ?? `${p.name}\\Import`;

/** The export's byte format for a text file: BOM, CRLF, no trailing newline. */
export function exportBytes(text: string): Buffer {
  return Buffer.from("﻿" + text.replace(/\r?\n/g, "\r\n").replace(/(\r\n)+$/, ""), "utf8");
}

/** `imports.mf` in the layout the export writes. */
export function manifestText(packages: readonly ScratchPackage[]): string {
  const lines = ["<imports>"];
  for (const p of packages) {
    const deps = p.dependsOn ?? [];
    if (deps.length === 0) {
      lines.push(`  <package name="${esc(p.name)}" path="${esc(packagePath(p))}" />`);
      continue;
    }
    lines.push(`  <package name="${esc(p.name)}" path="${esc(packagePath(p))}">`);
    for (const d of deps) {
      if ((d.referenced ?? []).length === 0) {
        lines.push(`    <dependson name="${esc(d.name)}" />`);
      } else {
        lines.push(`    <dependson name="${esc(d.name)}">`);
        for (const r of d.referenced!) {
          lines.push(`      <referenced_element id="${r.id}" type="${esc(r.type)}" descr="${esc(r.descr)}" />`);
        }
        lines.push("    </dependson>");
      }
    }
    lines.push("  </package>");
  }
  lines.push("</imports>");
  return lines.join("\n");
}

/** Writes `imports.mf` and every package's files under `dir`, in the order given. */
export function writePackages(dir: string, packages: readonly ScratchPackage[], manifestName = "imports.mf"): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, manifestName), manifestText(packages));
  for (const p of packages) {
    const root = join(dir, ...packagePath(p).split("\\").filter((s) => s !== "" && s !== "."));
    for (const f of p.files) {
      const target = join(root, ...(f.dir === null ? [] : [f.dir]), f.file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, typeof f.content === "string" ? exportBytes(f.content) : f.content);
    }
  }
}

/** A type folder's file for one `AML` document holding the given top-level items. */
export function aml(dir: string | null, file: string, ...items: string[]): PackageFile {
  return { dir, file, content: `<AML>\n${items.join("\n")}\n</AML>` };
}

/** Indents each line of an item by one space, the way the export nests under `AML`. */
const ind = (text: string, by = 1): string => text.split("\n").map((l) => " ".repeat(by) + l).join("\n");

/** `<Item type id action>` with a body of child lines (LF, one level in). */
export function item(type: string, id: string | null, action: string, body: string[], attrs = ""): string {
  const idAttr = id === null ? "" : ` id="${id}"`;
  const head = `<Item type="${esc(type)}"${idAttr} action="${action}"${attrs === "" ? "" : ` ${attrs}`}>`;
  return ind([head, ...body.map((l) => ind(l)), "</Item>"].join("\n"));
}

export const src = (type: string, name: string, id: string): string =>
  `<source_id keyed_name="${esc(name)}" type="${esc(type)}">${id}</source_id>`;

// ---------------------------------------------------------------------------
// S0 MINI: a small package for the option cases (release/description, locked
// row, fast/vault, cancel, error paths). Not in ticket 05's list; S1 is too
// large to import a dozen times, and these options do not depend on content.
// ---------------------------------------------------------------------------

export function mini(): ScratchPackage {
  const n = "LIBSJS-SCRATCH-MINI";
  const list = (i: number) => {
    const name = `${n}-List_${i}`;
    const id = sid(`MINI:${name}`);
    return aml(
      "List",
      `${name}.xml`,
      item("List", id, "add", [
        `<name>${name}</name>`,
        "<Relationships>",
        item("Value", sid(`MINI:${name}:v1`), "add", [
          `<label xml:lang="en">Scratch ${i}</label>`,
          "<sort_order>128</sort_order>",
          src("List", name, id),
          `<value>scratch${i}</value>`,
        ]),
        "</Relationships>",
      ]),
    );
  };
  const variable = (i: number) => {
    const name = `${n}-Var_${i}`;
    return aml("Variable", `${name}.xml`, item("Variable", sid(`MINI:${name}`), "add", [`<default_value>${i}</default_value>`, `<name>${name}</name>`]));
  };
  const sequence = (i: number) => {
    const name = `${n}-Seq_${i}`;
    return aml(
      "Sequence",
      `${name}.xml`,
      item("Sequence", sid(`MINI:${name}`), "add", ["<initial_value>1000</initial_value>", "<step>1</step>", "<suffix>-S</suffix>", `<name>${name}</name>`]),
    );
  };
  return { name: n, files: [list(1), list(2), sequence(1), variable(1), variable(2), variable(3)] };
}

// ---------------------------------------------------------------------------
// S1 BASE: one item per build.xsl bucket (ticket 05, section 4).
// ---------------------------------------------------------------------------

export const BASE = {
  name: "LIBSJS-SCRATCH-BASE",
  list: "LIBSJS-SCRATCH-List_1",
  method: "LIBSJS-SCRATCH-Method_1",
  itA: "LIBSJS_SCRATCH_IT_A",
  relA: "LIBSJS_SCRATCH_REL_A",
  relB: "LIBSJS_SCRATCH_REL_B",
  itP: "LIBSJS_SCRATCH_IT_P",
  itV: "LIBSJS_SCRATCH_IT_V",
  relV: "LIBSJS_SCRATCH_REL_V",
} as const;

const b = (name: string) => sid(`BASE:${name}`);

/** An ItemType add in export shape, followed by the View and Form deletes the export writes after it. */
export function itemTypeFile(
  name: string,
  opts: { implementation?: string; relationship?: boolean; versionable?: boolean; body?: string[]; label?: string } = {},
): PackageFile {
  const id = b(name);
  const { implementation = "table", relationship = false, versionable = false, body = [], label = name } = opts;
  const add = item("ItemType", id, "add", [
    "<allow_private_permission>1</allow_private_permission>",
    "<auto_search>1</auto_search>",
    "<enforce_discovery>1</enforce_discovery>",
    "<hide_where_used>0</hide_where_used>",
    `<implementation_type>${implementation}</implementation_type>`,
    ...(implementation === "table" ? [`<instance_data>${name.toUpperCase()}</instance_data>`] : []),
    "<is_dependent>0</is_dependent>",
    `<is_relationship>${relationship ? 1 : 0}</is_relationship>`,
    `<is_versionable>${versionable ? 1 : 0}</is_versionable>`,
    `<label xml:lang="en">${esc(label)}</label>`,
    "<show_parameters_tab>1</show_parameters_tab>",
    "<structure_view>tabs off</structure_view>",
    "<unlock_on_logout>0</unlock_on_logout>",
    "<use_src_access>0</use_src_access>",
    `<name>${name}</name>`,
    ...(body.length === 0 ? [] : ["<Relationships>", ...body, "</Relationships>"]),
  ]);
  return aml("ItemType", `${name.replace("LIBSJS_SCRATCH_", "LIBSJS-SCRATCH-")}.xml`, add, item("View", null, "delete", [], `where="source_id='${id}'"`), item("Form", null, "delete", [], `where="name='${name}'"`));
}

export function property(itName: string, name: string, order: number, extra: string[] = [], type = "string", keyed = false, idOf: (name: string) => string = b): string {
  return item("Property", idOf(`${itName}.${name}`), "add", [
    "<column_alignment>left</column_alignment>",
    `<data_type>${type}</data_type>`,
    "<is_hidden>0</is_hidden>",
    "<is_hidden2>0</is_hidden2>",
    "<is_indexed>0</is_indexed>",
    `<is_keyed>${keyed ? 1 : 0}</is_keyed>`,
    "<is_multi_valued>0</is_multi_valued>",
    "<is_required>0</is_required>",
    `<label xml:lang="en">${esc(name)}</label>`,
    "<range_inclusive>0</range_inclusive>",
    "<readonly>0</readonly>",
    `<sort_order>${order}</sort_order>`,
    src("ItemType", itName, idOf(itName)),
    ...(type === "string" ? ["<stored_length>64</stored_length>"] : []),
    "<track_history>0</track_history>",
    ...extra,
    `<name>${name}</name>`,
  ]);
}

/** The default permission instances of a scratch ItemType need before any can be added: S1's Permission, or `permission` (a name in the BASE id space). */
export const defaultPermission = (itName: string, permission = "Perm_1"): string =>
  item("Allowed Permission", b(`${itName}.allowed1`), "add", [
    "<is_default>1</is_default>",
    `<related_id keyed_name="LIBSJS-SCRATCH-${permission}" type="Permission">` + b(permission) + "</related_id>",
    "<sort_order>128</sort_order>",
    src("ItemType", itName, b(itName)),
  ]);

/** The keyed `name` property the instance items of a scratch ItemType use, so their keyed_name is scratch-named. */
export const keyedName = (itName: string) => property(itName, "name", 64, [], "string", true);

/** A RelationshipType add in export shape, with its relationship ItemType nested as `relationship_id`. */
function relationshipTypeFile(name: string, sourceName: string, level: number, versionable = false, relatedName: string | null = null): PackageFile {
  const id = b(`RT:${name}`);
  const relIt = item("ItemType", b(name), "add", [
    "<allow_private_permission>1</allow_private_permission>",
    "<auto_search>1</auto_search>",
    "<enforce_discovery>0</enforce_discovery>",
    "<hide_where_used>0</hide_where_used>",
    "<implementation_type>table</implementation_type>",
    `<instance_data>${name.toUpperCase()}</instance_data>`,
    "<is_dependent>0</is_dependent>",
    "<is_relationship>1</is_relationship>",
    `<is_versionable>${versionable ? 1 : 0}</is_versionable>`,
    `<label xml:lang="en">${name}</label>`,
    "<show_parameters_tab>1</show_parameters_tab>",
    "<structure_view>tabs on</structure_view>",
    "<unlock_on_logout>0</unlock_on_logout>",
    "<use_src_access>1</use_src_access>",
    `<name>${name}</name>`,
  ]);
  const rt = item(
    "RelationshipType",
    id,
    "add",
    [
      "<auto_search>1</auto_search>",
      "<behavior>float</behavior>",
      "<copy_permissions>0</copy_permissions>",
      "<create_related>0</create_related>",
      "<hide_in_all>0</hide_in_all>",
      "<inc_rel_key_name>1</inc_rel_key_name>",
      "<inc_related_key_name>1</inc_related_key_name>",
      "<is_list_type>0</is_list_type>",
      `<label xml:lang="en">${name}</label>`,
      "<new_show_related>0</new_show_related>",
      ...(relatedName === null ? [] : [`<related_id keyed_name="${relatedName}" type="ItemType">${b(relatedName)}</related_id>`]),
      "<related_notnull>0</related_notnull>",
      "<related_option>0</related_option>",
      `<relationship_id keyed_name="${name}" type="ItemType">`,
      relIt,
      "</relationship_id>",
      "<sort_order>128</sort_order>",
      `<source_id keyed_name="${sourceName}" type="ItemType">${b(sourceName)}</source_id>`,
      `<name>${name}</name>`,
    ],
    `dependencyLevel="${level}"`,
  );
  return aml("RelationshipType", `${name.replace("LIBSJS_SCRATCH_", "LIBSJS-SCRATCH-")}.xml`, rt, item("View", null, "delete", [], `where="source_id='${b(name)}'"`), item("Form", null, "delete", [], `where="name='${name}'"`));
}

export const worldAccess = (permName: string, permId: string, order: number, canChange: boolean): string =>
  item("Access", b(`${permName}.access${order}`), "add", [
    `<can_change_access>${canChange ? 1 : 0}</can_change_access>`,
    `<can_delete>${canChange ? 1 : 0}</can_delete>`,
    "<can_discover>1</can_discover>",
    "<can_get>1</can_get>",
    `<can_update>${canChange ? 1 : 0}</can_update>`,
    `<related_id keyed_name="${canChange ? "Administrators" : "World"}" type="Identity">${canChange ? ADMINISTRATORS_ID : WORLD_ID}</related_id>`,
    "<show_permissions_warning>1</show_permissions_warning>",
    `<sort_order>${order}</sort_order>`,
    src("Permission", permName, permId),
  ]);

export function base(): ScratchPackage {
  const files: PackageFile[] = [];
  // Alphabetical folder order (ItemType, List, Method, ...) differs from build.xsl's order on purpose.
  const listName = BASE.list;
  const listId = b(listName);
  files.push(
    aml(
      "List",
      `${listName}.xml`,
      item("List", listId, "add", [
        "<description>Scratch list</description>",
        `<name>${listName}</name>`,
        "<Relationships>",
        item("Value", b("List_1.v1"), "add", ["<inactive>0</inactive>", '<label xml:lang="en">First</label>', "<sort_order>128</sort_order>", src("List", listName, listId), "<value>first</value>"]),
        item("Value", b("List_1.v2"), "add", ["<inactive>0</inactive>", '<label xml:lang="en">Second</label>', "<sort_order>256</sort_order>", src("List", listName, listId), "<value>second</value>"]),
        "</Relationships>",
      ]),
    ),
  );
  files.push(
    aml("Sequence", "LIBSJS-SCRATCH-Seq_1.xml", item("Sequence", b("Seq_1"), "add", ["<initial_value>100</initial_value>", "<step>1</step>", "<suffix>-001</suffix>", "<name>LIBSJS-SCRATCH-Seq_1</name>"])),
  );
  files.push(aml("Variable", "LIBSJS-SCRATCH-Var_1.xml", item("Variable", b("Var_1"), "add", ["<default_value>x</default_value>", "<name>LIBSJS-SCRATCH-Var_1</name>"])));
  files.push(
    aml(
      "Identity",
      "LIBSJS-SCRATCH-Identity_1.xml",
      item("Identity", b("Identity_1"), "add", ["<description />", "<is_alias>0</is_alias>", "<name>LIBSJS-SCRATCH-Identity_1</name>"]),
      item("Member", b("Identity_1.member1"), "add", [
        `<related_id keyed_name="World" type="Identity">${WORLD_ID}</related_id>`,
        "<sort_order>128</sort_order>",
        src("Identity", "LIBSJS-SCRATCH-Identity_1", b("Identity_1")),
      ]),
    ),
  );
  const permId = b("Perm_1");
  files.push(
    aml(
      "Permission",
      "LIBSJS-SCRATCH-Perm_1.xml",
      item("Permission", permId, "add", [
        "<is_private>0</is_private>",
        "<name>LIBSJS-SCRATCH-Perm_1</name>",
        "<Relationships>",
        worldAccess("Perm_1", permId, 256, false),
        worldAccess("Perm_1", permId, 128, true),
        "</Relationships>",
      ]),
    ),
  );
  // Method: versionable. The id is the first generation's.
  files.push(
    aml(
      "Method",
      `${BASE.method}.xml`,
      item("Method", b("Method_1"), "add", [
        `<execution_allowed_to keyed_name="World" type="Identity">${WORLD_ID}</execution_allowed_to>`,
        "<method_code><![CDATA[return this;]]></method_code>",
        "<method_type>JavaScript</method_type>",
        `<name>${BASE.method}</name>`,
      ]),
    ),
  );
  files.push(
    aml(
      "Action",
      "LIBSJS-SCRATCH-Action_1.xml",
      item("Action", b("Action_1"), "add", [
        '<item_query>&lt;Item type="{@type}" id="{@id}" action="get" /&gt;</item_query>',
        '<label xml:lang="en">Scratch Action</label>',
        "<location>server</location>",
        `<method keyed_name="${BASE.method}" type="Method">`,
        ` <Item type="Method" action="get" select="id"><name>${BASE.method}</name></Item>`,
        "</method>",
        "<target>none</target>",
        "<type>item</type>",
        "<name>LIBSJS-SCRATCH-Action_1</name>",
      ]),
    ),
  );
  files.push(
    aml(
      "Report",
      "LIBSJS-SCRATCH-Report_1.xml",
      item("Report", b("Report_1"), "add", [
        "<description />",
        "<location>client</location>",
        "<report_query />",
        "<target>one window</target>",
        "<type>item</type>",
        '<xsl_stylesheet><![CDATA[<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:template match="/"><html /></xsl:template></xsl:stylesheet>]]></xsl_stylesheet>',
        "<name>LIBSJS-SCRATCH-Report_1</name>",
      ]),
    ),
  );
  files.push(
    aml(
      "Form",
      "LIBSJS-SCRATCH-Form_1.xml",
      item("Form", b("Form_1"), "add", [
        "<category_form>0</category_form>",
        "<height>200</height>",
        "<stylesheet><![CDATA[../styles/default.css]]></stylesheet>",
        "<width>400</width>",
        "<name>LIBSJS-SCRATCH-Form_1</name>",
        "<Relationships>",
        item("Body", b("Form_1.body"), "add", [
          "<bg_color>#ffffff</bg_color>",
          "<sort_order>128</sort_order>",
          src("Form", "LIBSJS-SCRATCH-Form_1", b("Form_1")),
          "<Relationships>",
          item("Field", b("Form_1.field1"), "add", [
            "<border_width>0</border_width>",
            "<display_length>114</display_length>",
            "<display_length_unit>px</display_length_unit>",
            "<field_type>text</field_type>",
            "<is_disabled>0</is_disabled>",
            "<is_visible>1</is_visible>",
            '<label xml:lang="en">Title</label>',
            "<label_position>top</label_position>",
            "<list_no_blank>0</list_no_blank>",
            "<sort_order>128</sort_order>",
            src("Body", b("Form_1.body"), b("Form_1.body")),
            "<tab_stop>0</tab_stop>",
            "<x>0</x>",
            "<y>0</y>",
            "<name>title</name>",
          ]),
          "</Relationships>",
        ]),
        "</Relationships>",
      ]),
    ),
  );
  const s1 = b("LCM_1.s1");
  const s2 = b("LCM_1.s2");
  const lcmSrc = src("Life Cycle Map", "LIBSJS-SCRATCH-LCM_1", b("LCM_1"));
  const state = (id: string, name: string, order: number, x: number) =>
    item("Life Cycle State", id, "add", [
      "<image>../images/LifeCycleState.svg</image>",
      `<label xml:lang="en">${name}</label>`,
      "<set_is_released>0</set_is_released>",
      "<set_not_lockable>0</set_not_lockable>",
      `<sort_order>${order}</sort_order>`,
      lcmSrc,
      `<x>${x}</x>`,
      "<y>62</y>",
      `<name>${name}</name>`,
    ]);
  files.push(
    aml(
      "Life Cycle Map",
      "LIBSJS-SCRATCH-LCM_1.xml",
      item("Life Cycle Map", b("LCM_1"), "add", [
        "<description>Scratch life cycle</description>",
        `<start_state keyed_name="Start" type="Life Cycle State">${s1}</start_state>`,
        "<name>LIBSJS-SCRATCH-LCM_1</name>",
        "<Relationships>",
        state(s2, "Done", 256, 331),
        state(s1, "Start", 128, 102),
        item("Life Cycle Transition", b("LCM_1.t1"), "add", [
          `<from_state keyed_name="Start" type="Life Cycle State">${s1}</from_state>`,
          "<get_comment>0</get_comment>",
          "<segments />",
          "<sort_order>128</sort_order>",
          lcmSrc,
          `<to_state keyed_name="Done" type="Life Cycle State">${s2}</to_state>`,
          "<x>-1</x>",
          "<y>-1</y>",
        ]),
        "</Relationships>",
      ]),
    ),
  );
  const wfSrc = src("Workflow Map", "LIBSJS-SCRATCH-WFM_1", b("WFM_1"));
  const template = (name: string, start: boolean, end: boolean, rel: string[] = []) =>
    item("Activity Template", b(`WFM_1.${name}`), "add", [
      "<can_delegate>0</can_delegate>",
      "<can_refuse>0</can_refuse>",
      "<consolidate_ondelegate>0</consolidate_ondelegate>",
      "<expected_duration>0</expected_duration>",
      `<is_auto>1</is_auto>`,
      `<is_end>${end ? 1 : 0}</is_end>`,
      `<is_start>${start ? 1 : 0}</is_start>`,
      `<message xml:lang="en">${name}</message>`,
      "<priority>1</priority>",
      "<reminder_count>0</reminder_count>",
      "<reminder_interval>0</reminder_interval>",
      "<timeout_duration>0</timeout_duration>",
      "<wait_for_all_inputs>0</wait_for_all_inputs>",
      "<wait_for_all_votes>0</wait_for_all_votes>",
      `<x>${start ? 29 : 300}</x>`,
      "<y>76</y>",
      `<name>${name}</name>`,
      ...(rel.length === 0 ? [] : ["<Relationships>", ...rel, "</Relationships>"]),
    ]);
  const activity = (name: string, order: number, tpl: string) =>
    item("Workflow Map Activity", b(`WFM_1.act.${name}`), "add", [
      `<related_id keyed_name="${name}" type="Activity Template">`,
      tpl,
      "</related_id>",
      `<sort_order>${order}</sort_order>`,
      wfSrc,
    ]);
  files.push(
    aml(
      "Workflow Map",
      "LIBSJS-SCRATCH-WFM_1.xml",
      item("Workflow Map", b("WFM_1"), "add", [
        "<description>Scratch workflow</description>",
        "<name>LIBSJS-SCRATCH-WFM_1</name>",
        "<Relationships>",
        activity(
          "Begin",
          128,
          template("Begin", true, false, [
            item("Workflow Map Path", b("WFM_1.path1"), "add", [
              "<authentication>none</authentication>",
              "<is_default>1</is_default>",
              "<is_override>0</is_override>",
              "<name>Go</name>",
              `<related_id>${b("WFM_1.Finish")}</related_id>`,
              "<segments />",
              "<sort_order>128</sort_order>",
              src("Activity Template", "Begin", b("WFM_1.Begin")),
            ]),
          ]),
        ),
        activity("Finish", 256, template("Finish", false, true)),
        "</Relationships>",
      ]),
    ),
  );
  const gridSrc = src("Grid", "LIBSJS-SCRATCH-Grid_1", b("Grid_1"));
  files.push(
    aml(
      "Grid",
      "LIBSJS-SCRATCH-Grid_1.xml",
      item("Grid", b("Grid_1"), "add", [
        "<query><![CDATA[<Item type=\"User\" action=\"get\" />]]></query>",
        "<name>LIBSJS-SCRATCH-Grid_1</name>",
        "<Relationships>",
        item("Grid Column", b("Grid_1.c1"), "add", [
          "<align>left</align>",
          "<datatype>default</datatype>",
          '<label xml:lang="en">Name</label>',
          "<property>keyed_name</property>",
          "<sort_order>100</sort_order>",
          gridSrc,
          "<starts_nested_row>0</starts_nested_row>",
          "<visible>1</visible>",
          "<width>200</width>",
          "<xpath>self::Item</xpath>",
        ]),
        "</Relationships>",
      ]),
    ),
  );
  files.push(
    aml("UserMessage", "LIBSJS-SCRATCH-Msg_1.xml", item("UserMessage", b("Msg_1"), "add", ["<custom>0</custom>", '<text xml:lang="en">Scratch message {0}</text>', "<name>LIBSJS-SCRATCH-Msg_1</name>"])),
  );

  // ItemTypes: a plain one with a list-valued property, relationship types at dependency levels 0 and 1,
  // a polymorphic one with a Morphae, and a versionable one with a relationship.
  files.push(
    itemTypeFile(BASE.itA, {
      body: [
        defaultPermission(BASE.itA),
        keyedName(BASE.itA),
        property(BASE.itA, "title", 128),
        property(BASE.itA, "kind", 256, [`<data_source keyed_name="${listName}" type="List">${listId}</data_source>`], "list"),
      ],
    }),
  );
  // The level 1 file sorts before the level 0 file on disk; build.xsl orders them by dependencyLevel.
  files.push(relationshipTypeFile(BASE.relA, BASE.itA, 0));
  files.push(relationshipTypeFile(BASE.relB, BASE.relA, 1));
  files.push(
    itemTypeFile(BASE.itP, {
      implementation: "polymorphic",
      body: [
        item("Morphae", b("IT_P.morphae1"), "add", [
          `<related_id keyed_name="${BASE.itA}" type="ItemType" name="${BASE.itA}">${b(BASE.itA)}</related_id>`,
          "<sort_order>128</sort_order>",
          src("ItemType", BASE.itP, b(BASE.itP)),
        ]),
      ],
    }),
  );
  files.push(itemTypeFile(BASE.itV, { versionable: true, body: [defaultPermission(BASE.itV), keyedName(BASE.itV), property(BASE.itV, "title", 128)] }));
  files.push(relationshipTypeFile(BASE.relV, BASE.itV, 0, true, BASE.itA));
  return { name: BASE.name, files };
}

// ---------------------------------------------------------------------------
// INST: instance items of S1's scratch ItemTypes (the versionable path of the
// merge needs instances: a versionable root with a relationship that has a
// related_id). Imported after BASE.
// ---------------------------------------------------------------------------

export const INST = {
  name: "LIBSJS-SCRATCH-INST",
  a1: "LIBSJS-SCRATCH-Inst_A1",
  v1: "LIBSJS-SCRATCH-Inst_V1",
} as const;

const inst = (name: string) => sid(`INST:${name}`);

export function instances(): ScratchPackage {
  const a1 = inst(INST.a1);
  const v1 = inst(INST.v1);
  return {
    name: INST.name,
    files: [
      aml(BASE.itA, `${INST.a1}.xml`, item(BASE.itA, a1, "add", [`<name>${INST.a1}</name>`, "<title>first</title>"])),
      aml(
        BASE.itV,
        `${INST.v1}.xml`,
        item(BASE.itV, v1, "add", [
          `<name>${INST.v1}</name>`,
          "<title>versioned</title>",
          "<Relationships>",
          item(BASE.relV, inst(`${INST.v1}.rel1`), "add", [
            `<related_id keyed_name="${INST.a1}" type="${BASE.itA}">${a1}</related_id>`,
            src(BASE.itV, INST.v1, v1),
          ]),
          "</Relationships>",
        ]),
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// S2 REF + REFDEP: package dependencies and referenced elements.
// ---------------------------------------------------------------------------

/** A stock List ("Report Format Types"), the existing non-scratch referenced element. */
export const STOCK_LIST = { id: "1854A8A75F5940A78369146966674FA6", descr: "Report Format Types" } as const;

export const refId = (name: string) => sid(`REF:${name}`);
const r = refId;

export function refDep(): ScratchPackage {
  const name = "LIBSJS-SCRATCH-REFDEP-List_1";
  const id = r(name);
  return {
    name: "LIBSJS-SCRATCH-REFDEP",
    files: [
      aml("List", `${name}.xml`, item("List", id, "add", [`<name>${name}</name>`, "<Relationships>", item("Value", r(`${name}.v1`), "add", ['<label xml:lang="en">Dep</label>', "<sort_order>128</sort_order>", src("List", name, id), "<value>dep</value>"]), "</Relationships>"])),
    ],
  };
}

/** REF depends on REFDEP; its referenced elements are (a) a scratch item of REFDEP, (b) a stock List, (c) an id that exists nowhere. */
export function ref(): ScratchPackage {
  const depName = "LIBSJS-SCRATCH-REFDEP-List_1";
  const own = "LIBSJS-SCRATCH-REF-Var_1";
  return {
    name: "LIBSJS-SCRATCH-REF",
    dependsOn: [
      {
        name: "LIBSJS-SCRATCH-REFDEP",
        referenced: [
          { id: r(depName), type: "List", descr: depName },
          { id: STOCK_LIST.id, type: "List", descr: STOCK_LIST.descr },
          { id: r("missing"), type: "List", descr: "LIBSJS-SCRATCH-REFDEP-Missing" },
        ],
      },
    ],
    files: [aml("Variable", `${own}.xml`, item("Variable", r(own), "add", ["<default_value>ref</default_value>", `<name>${own}</name>`]))],
  };
}

export const refPair = (): ScratchPackage[] => [ref(), refDep()];

// ---------------------------------------------------------------------------
// S3 UNRES: references that cannot be resolved when the item is checked.
// ---------------------------------------------------------------------------

const u = (name: string) => sid(`UNRES:${name}`);

/**
 * Both references resolve once the package is done: an ItemType property whose
 * data_source (an ItemType) is imported by a later file (10000), and a Member
 * whose related Identity is imported by a later file (10001).
 */
export function unresDelayed(): ScratchPackage {
  const x = "LIBSJS_SCRATCH_UNRES_X";
  const y = "LIBSJS_SCRATCH_UNRES_Y";
  const itemType = (name: string, body: string[]) =>
    aml(
      "ItemType",
      `${name.replace("LIBSJS_SCRATCH_", "LIBSJS-SCRATCH-")}.xml`,
      item("ItemType", u(name), "add", [
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
        ...(body.length === 0 ? [] : ["<Relationships>", ...body, "</Relationships>"]),
      ]),
    );
  const identity = (letter: string, members: string[]) => {
    const name = `LIBSJS-SCRATCH-Identity_${letter}`;
    return aml(
      "Identity",
      `${name}.xml`,
      item("Identity", u(name), "add", ["<description />", "<is_alias>0</is_alias>", `<name>${name}</name>`, ...(members.length === 0 ? [] : ["<Relationships>", ...members, "</Relationships>"])]),
    );
  };
  const member = (owner: string, relatedName: string) =>
    item("Member", u(`${owner}.member`), "add", [
      `<related_id keyed_name="${relatedName}" type="Identity">${u(relatedName)}</related_id>`,
      "<sort_order>128</sort_order>",
      src("Identity", owner, u(owner)),
    ]);
  return {
    name: "LIBSJS-SCRATCH-UNRES",
    files: [
      itemType(x, [property(x, "ref", 128, [`<data_source keyed_name="${y}" type="ItemType">${u(y)}</data_source>`], "item", false, u)]),
      itemType(y, []),
      identity("A", [member("LIBSJS-SCRATCH-Identity_A", "LIBSJS-SCRATCH-Identity_Z")]),
      identity("Z", []),
    ],
  };
}

/** An Action whose method is a nested get that finds nothing: code 0, logged only, and the server then decides. */
export function unresNestedGet(): ScratchPackage {
  const name = "LIBSJS-SCRATCH-UNRES-Action_1";
  return {
    name: "LIBSJS-SCRATCH-UNRES0",
    files: [
      aml(
        "Action",
        `${name}.xml`,
        item("Action", u(name), "add", [
          '<item_query>&lt;Item type="{@type}" id="{@id}" action="get" /&gt;</item_query>',
          '<label xml:lang="en">Unresolved</label>',
          "<location>server</location>",
          '<method keyed_name="LIBSJS-SCRATCH-Missing_Method" type="Method">',
          ' <Item type="Method" action="get" select="id"><name>LIBSJS-SCRATCH-Missing_Method</name></Item>',
          "</method>",
          "<target>none</target>",
          "<type>item</type>",
          `<name>${name}</name>`,
        ]),
      ),
    ],
  };
}

/** A RelationshipType whose source_id and related_id are nested gets that find nothing: codes 10002 and 10003. */
export function unresRelType(): ScratchPackage {
  const name = "LIBSJS_SCRATCH_UNRES_REL";
  const get = (what: string) => ` <Item type="ItemType" action="get" select="id"><name>LIBSJS_SCRATCH_NOPE_${what}</name></Item>`;
  return {
    name: "LIBSJS-SCRATCH-UNRESRT",
    files: [
      aml(
        "RelationshipType",
        "LIBSJS-SCRATCH-UNRES_REL.xml",
        item("RelationshipType", u(`RT:${name}`), "add", [
          "<auto_search>1</auto_search>",
          "<behavior>float</behavior>",
          "<copy_permissions>0</copy_permissions>",
          "<create_related>0</create_related>",
          "<hide_in_all>0</hide_in_all>",
          "<inc_rel_key_name>1</inc_rel_key_name>",
          "<inc_related_key_name>1</inc_related_key_name>",
          "<is_list_type>0</is_list_type>",
          `<label xml:lang="en">${name}</label>`,
          "<new_show_related>0</new_show_related>",
          '<related_id keyed_name="LIBSJS_SCRATCH_NOPE_related" type="ItemType">',
          get("related"),
          "</related_id>",
          "<related_notnull>0</related_notnull>",
          "<related_option>0</related_option>",
          "<sort_order>128</sort_order>",
          '<source_id keyed_name="LIBSJS_SCRATCH_NOPE_source" type="ItemType">',
          get("source"),
          "</source_id>",
          `<name>${name}</name>`,
        ]),
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// S4 DEL: delete actions against the items S1 created.
// ---------------------------------------------------------------------------

const del = (type: string, id: string): string => item(type, id, "delete", []);

/**
 * Listed types (List, ItemType, Identity) are dropped by build.xsl; Form, Field
 * and the unlisted Value are kept. Every target is an item of BASE, by id.
 */
export function delPackage(): ScratchPackage {
  const f = (type: string, name: string, id: string) => aml(type, `LIBSJS-SCRATCH-Del_${name}.xml`, del(type, id));
  return {
    name: "LIBSJS-SCRATCH-DEL",
    files: [
      f("Form", "Form_1", b("Form_1")),
      f("Field", "Field_1", b("Form_1.field1")),
      f("Identity", "Identity_1", b("Identity_1")),
      f("ItemType", "IT_V", b(BASE.itV)),
      f("List", "List_1", b("List_1")),
      f("Value", "Value_2", b("List_1.v2")),
    ],
  };
}

/** A delete of an item that does not exist: the delete-only retry path (a warning, a full check, then the same failure). */
export function delMissing(): ScratchPackage {
  return { name: "LIBSJS-SCRATCH-DELMISSING", files: [aml("Value", "LIBSJS-SCRATCH-DelMissing_Value.xml", del("Value", sid("DEL:missing-value")))] };
}

/** A delete the server refuses: the Done state of BASE's life cycle map is the to_state of its transition. */
export function delRefused(): ScratchPackage {
  return { name: "LIBSJS-SCRATCH-DELREFUSED", files: [aml("Life Cycle State", "LIBSJS-SCRATCH-DelRefused_State.xml", del("Life Cycle State", b("LCM_1.s2")))] };
}

/** The 14.x-only mp_PromoteItem action on an mp_MacPolicy that does not exist (12.0 drops it, 14.x sends it). */
export function delPromote(): ScratchPackage {
  const id = sid("DEL:missing-mac-policy");
  return { name: "LIBSJS-SCRATCH-DELPROMOTE", files: [aml("mp_MacPolicy", "LIBSJS-SCRATCH-Promote_Policy.xml", item("mp_MacPolicy", id, "mp_PromoteItem", []))] };
}

// ---------------------------------------------------------------------------
// S5 SQL: SQL items, delete-then-re-add, and the id-as-child bug.
// ---------------------------------------------------------------------------

const q = (name: string) => sid(`SQL:${name}`);

/**
 * A SQL item is named like the database object its body creates, and the name
 * must match ^[a-zA-Z][a-zA-Z0-9_]*$, so it takes the ItemType-safe scratch prefix.
 */
const sqlItem = (name: string, idAsAttribute: boolean): PackageFile => {
  const id = q(name);
  const view = name;
  return aml(
    "SQL",
    `${name.replace("LIBSJS_SCRATCH_", "LIBSJS-SCRATCH-")}.xml`,
    item(
      "SQL",
      idAsAttribute ? id : null,
      "add",
      [
        ...(idAsAttribute ? [] : [`<id>${id}</id>`]),
        "<execution_flag>immediate</execution_flag>",
        `<old_name>${name}</old_name>`,
        `<sqlserver_body><![CDATA[CREATE VIEW [${view}] AS SELECT 1 AS [one]]]></sqlserver_body>`,
        "<stale>0</stale>",
        "<transform_first>0</transform_first>",
        "<type>view</type>",
        `<name>${name}</name>`,
      ],
    ),
  );
};

/** (a) a SQL item whose id is an attribute. */
export function sqlAttr(): ScratchPackage {
  return { name: "LIBSJS-SCRATCH-SQL", files: [sqlItem("LIBSJS_SCRATCH_V1", true)] };
}

/** (b) a SQL item whose id is only a child element: DeleteSqlItems sends id=''. */
export function sqlChild(): ScratchPackage {
  return { name: "LIBSJS-SCRATCH-SQLCHILD", files: [sqlItem("LIBSJS_SCRATCH_V2", false)] };
}

// ---------------------------------------------------------------------------
// S8: two packages with the same last dot-segment.
// ---------------------------------------------------------------------------

export const collId = (name: string) => sid(`COLL:${name}`);
const k = collId;

const collVariable = (idKey: string, name: string): PackageFile =>
  aml("Variable", `${name}.xml`, item("Variable", k(idKey), "add", ["<default_value>coll</default_value>", `<name>${name}</name>`]));

/** One different item in each: both import. */
export function collDistinct(): ScratchPackage[] {
  return [
    { name: "LIBSJS-SCRATCH-A.Coll", path: "LIBSJS-SCRATCH-A\\Coll", files: [collVariable("a", "LIBSJS-SCRATCH-Coll_A")] },
    { name: "LIBSJS-SCRATCH-B.Coll", path: "LIBSJS-SCRATCH-B\\Coll", files: [collVariable("b", "LIBSJS-SCRATCH-Coll_B")] },
  ];
}

/** The same item (same id, same file name) in both: the second registration is a duplicate package element. */
export function collDuplicate(): ScratchPackage[] {
  return [
    { name: "LIBSJS-SCRATCH-A.Coll", path: "LIBSJS-SCRATCH-A\\Coll", files: [collVariable("same", "LIBSJS-SCRATCH-Coll_Same")] },
    { name: "LIBSJS-SCRATCH-B.Coll", path: "LIBSJS-SCRATCH-B\\Coll", files: [collVariable("same", "LIBSJS-SCRATCH-Coll_Same")] },
  ];
}

// ---------------------------------------------------------------------------
// S9 contrast: on 14.0.7 the first failing item stops the package.
// ---------------------------------------------------------------------------

const t = (name: string) => sid(`BATCH:${name}`);

const batchVar = (n: number, extra: string[] = [], nameOverride?: string): PackageFile => {
  const name = nameOverride ?? `LIBSJS-SCRATCH-Batch_${n}`;
  return aml("Variable", `LIBSJS-SCRATCH-Batch_${n}.xml`, item("Variable", t(`var${n}`), "add", [`<default_value>${n}</default_value>`, `<name>${name}</name>`, ...extra]));
};

/** Three good items, then one that fails the engine's own check (a relationship type its ItemType lacks), then three more. */
export function batchBadRelation(): ScratchPackage {
  const bad = batchVar(4, ["<Relationships>", item("Property", t("badrel"), "add", ["<name>nope</name>"]), "</Relationships>"]);
  return { name: "LIBSJS-SCRATCH-BATCH", files: [batchVar(1), batchVar(2), batchVar(3), bad, batchVar(5), batchVar(6), batchVar(7)] };
}

/** The same shape, but item 4 passes the checks and fails on the server (a second Variable of an existing name). */
export function batchServerFailure(): ScratchPackage {
  return { name: "LIBSJS-SCRATCH-BATCHSRV", files: [batchVar(1), batchVar(2), batchVar(3), batchVar(4, [], "LIBSJS-SCRATCH-Batch_1"), batchVar(5), batchVar(6), batchVar(7)] };
}

/** Items import, then a RelationshipType whose source ItemType does not exist is fatal (IMP-160). */
export function batchFatalRelType(): ScratchPackage {
  const name = "LIBSJS_SCRATCH_BATCH_REL";
  const rt = aml(
    "RelationshipType",
    "LIBSJS-SCRATCH-BATCH_REL.xml",
    item("RelationshipType", t("rt"), "add", [
      "<behavior>float</behavior>",
      `<label xml:lang="en">${name}</label>`,
      "<sort_order>128</sort_order>",
      `<source_id keyed_name="LIBSJS_SCRATCH_NOPE_source" type="ItemType">${t("nope")}</source_id>`,
      `<name>${name}</name>`,
    ]),
  );
  return { name: "LIBSJS-SCRATCH-BATCHREL", files: [batchVar(1), batchVar(2), rt] };
}

// ---------------------------------------------------------------------------
// Manifest cases.
// ---------------------------------------------------------------------------

const cyc = (n: number, other: number): ScratchPackage => ({
  name: `LIBSJS-SCRATCH-CYC${n}`,
  dependsOn: [{ name: `LIBSJS-SCRATCH-CYC${other}` }],
  files: [aml("Variable", `LIBSJS-SCRATCH-Cyc_${n}.xml`, item("Variable", sid(`CYC:${n}`), "add", [`<default_value>${n}</default_value>`, `<name>LIBSJS-SCRATCH-Cyc_${n}</name>`]))],
});

/** A dependency cycle between two packages that are both imported. */
export const cycle = (): ScratchPackage[] => [cyc(1, 2), cyc(2, 1)];

/** A package that depends on one that exists neither in the run nor on the server. */
export function absentDependency(): ScratchPackage {
  return {
    name: "LIBSJS-SCRATCH-ABSENTDEP",
    dependsOn: [{ name: "LIBSJS-SCRATCH-NOSUCHPACKAGE" }],
    files: [aml("Variable", "LIBSJS-SCRATCH-AbsentDep_Var_1.xml", item("Variable", sid("ABSENT:1"), "add", ["<default_value>1</default_value>", "<name>LIBSJS-SCRATCH-AbsentDep_Var_1</name>"]))],
  };
}

// ---------------------------------------------------------------------------
// File-system cases (ticket 05, section 4: "File-system cases, in S1's folder";
// kept in a package of their own so a failing file does not mask the rest).
// ---------------------------------------------------------------------------

const fsVar = (name: string, n: number): string =>
  `<AML>\n${item("Variable", sid(`FS:${name}`), "add", [`<default_value>${n}</default_value>`, `<name>${name}</name>`])}\n</AML>`;

/**
 * Files the loader treats specially: a `.xmlbak` file (matched by `*.xml`), a
 * file with no AML/Item (logged as skipped), a UTF-16 file with a BOM, a text
 * file, and a file one directory too deep (ignored).
 */
export function fsOdd(): ScratchPackage {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(fsVar("LIBSJS-SCRATCH-Fs_Utf16", 3).replace(/\n/g, "\r\n"), "utf16le")]);
  return {
    name: "LIBSJS-SCRATCH-FS",
    files: [
      { dir: "Variable", file: "LIBSJS-SCRATCH-Fs_Plain.xml", content: fsVar("LIBSJS-SCRATCH-Fs_Plain", 1) },
      { dir: "Variable", file: "LIBSJS-SCRATCH-Fs_Backup.xmlbak", content: fsVar("LIBSJS-SCRATCH-Fs_Backup", 2) },
      { dir: "Variable", file: "LIBSJS-SCRATCH-Fs_Utf16.xml", content: utf16 },
      { dir: "Variable", file: "LIBSJS-SCRATCH-Fs_NoItem.xml", content: "<AML>\n <Note>no items here</Note>\n</AML>" },
      { dir: "Variable", file: "LIBSJS-SCRATCH-Fs_Notes.txt", content: "not xml\n" },
      { dir: "Variable/Deeper", file: "LIBSJS-SCRATCH-Fs_TooDeep.xml", content: fsVar("LIBSJS-SCRATCH-Fs_TooDeep", 4) },
    ],
  };
}

/** An item file with an XML declaration: the concatenation breaks and the package fails at build.xsl. */
export function fsXmlDeclaration(): ScratchPackage {
  return {
    name: "LIBSJS-SCRATCH-FSDECL",
    files: [
      { dir: "Variable", file: "LIBSJS-SCRATCH-FsDecl_Var_1.xml", content: `<?xml version="1.0" encoding="utf-8"?>\n${fsVar("LIBSJS-SCRATCH-FsDecl_Var_1", 1)}` },
    ],
  };
}

/**
 * 12.0 only (R15, XmlDocument.Load honouring the file's encoding): a file in
 * Latin-1 with no declaration. 12.0's reader rejects the byte; 14.0.7 turns it
 * into U+FFFD and imports the item.
 */
export function fsLatin1(): ScratchPackage {
  const name = "LIBSJS-SCRATCH-FsLatin1_Var_1";
  const text = `<AML>\n${item("Variable", sid(`FS:${name}`), "add", ["<default_value>caf\u00e9</default_value>", `<name>${name}</name>`])}\n</AML>`;
  return { name: "LIBSJS-SCRATCH-FSLATIN1", files: [{ dir: "Variable", file: `${name}.xml`, content: Buffer.from(text, "latin1") }] };
}

/** 12.0 only (R15): a UTF-16LE file with no byte-order mark. 12.0's reader recognises it; 14.0.7 fails the load. */
export function fsUtf16NoBom(): ScratchPackage {
  const name = "LIBSJS-SCRATCH-FsU16Nb_Var_1";
  return { name: "LIBSJS-SCRATCH-FSUTF16NOBOM", files: [{ dir: "Variable", file: `${name}.xml`, content: Buffer.from(fsVar(name, 5), "utf16le") }] };
}

/**
 * 12.0 only (R11): `ac_PolicyAccessItemAttribute` is not in 12.0's build.xsl
 * lists, so every action of it lands in the last bucket. Two actions that 14.0.7
 * drops (delete and purge) on ids that exist nowhere, after a Variable add that
 * the earlier bucket imports first.
 */
export function acActions(): ScratchPackage {
  const var1 = "LIBSJS-SCRATCH-AcAct_Var_1";
  return {
    name: "LIBSJS-SCRATCH-ACACT",
    files: [
      aml(
        "Variable",
        `${var1}.xml`,
        item("Variable", sid("ACACT:var"), "add", ["<default_value>1</default_value>", `<name>${var1}</name>`]),
      ),
      aml(
        "ac_PolicyAccessItemAttribute",
        "LIBSJS-SCRATCH-AcAct_Attribute.xml",
        item("ac_PolicyAccessItemAttribute", sid("ACACT:missing-delete"), "delete", []),
        item("ac_PolicyAccessItemAttribute", sid("ACACT:missing-purge"), "purge", []),
      ),
    ],
  };
}

/** Ids of BASE's and INST's items, for the cases that version or delete them. */
export const baseId = (name: string): string => b(name);
export const instanceId = (name: string): string => inst(name);
