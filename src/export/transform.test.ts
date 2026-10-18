import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES_DIR, loadXslFixture } from "../../oracle/src/xsl-fixtures.js";
import { CItemException } from "../client/fault.js";
import { ArgumentException, loadXml } from "../xml/index.js";
import { applyExportTransform, transformExport } from "./transform.js";

/**
 * The differential test: the transform against the runs of the real `export.xsl` recorded by `npm run oracle -- xsl`
 * (`fixtures/14.0.7/xsl/`). Each case's output is compared byte for byte.
 *
 * The stylesheet has a second half that is not built yet (the system-element drops, the ItemType edit, the View and Form deletes
 * and the follow-up items after the root Item). A recording that the second half changes is in one of two tables:
 *
 * - `SAME_APART_FROM_PART_2`: the output differs only by the View and Form delete items and the `id` elements the second half
 *   writes or drops, and is compared without them;
 * - `NEEDS_PART_2`: the second half changes more than that, so the case waits for it.
 *
 * The ticket that builds the second half empties both tables.
 */
const SAME_APART_FROM_PART_2: ReadonlySet<string> = new Set([
  "file-selector-cdata-end",
  "file-selector-reference",
  "c01_reference",
  "c02_reference_nobracket",
  "c03_reference_bracket",
  "c04_reference_wrong_place",
  "d06_reltype_drop",
  "d09_reltype_root_with_relationship_id",
  "e01_ref_empty",
  "f01_foreign",
  "f02_foreign_edge",
  "f03_foreign_root",
  "t02_reltype_places",
  "q11_foreign_lookup_first_match_without_name",
  "q12_foreign_lookup_two_data_sources",
  "q13_foreign_lookup_not_equal",
]);

const NEEDS_PART_2: Readonly<Record<string, string>> = {
  "method-cdata-split": "drops config_id and is_current (EXP-311)",
  "property-is-keyed": "drops a keyed Property and writes the ItemType edit (EXP-310, EXP-320)",
  "recorded-11": "drops the system elements of every item (EXP-311)",
  d01_member_morphae: "re-emits Members and Morphae at the end (EXP-350, EXP-351)",
  d02_only_dropped_children: "re-emits Members and drops an empty Relationships (EXP-316, EXP-350)",
  e04_item_in_result_named: "drops keyed_name (EXP-311)",
  e05_member_in_morphae_ctx: "re-emits Members and Morphae (EXP-350, EXP-351)",
  g01_grid_event: "drops system Properties and writes the ItemType edit (EXP-310, EXP-320)",
  i05_root_identity: "drops keyed_name and re-emits a Member (EXP-311, EXP-350)",
  p01_field: "writes the Field fix (EXP-340)",
  p02_field_edge: "writes the Field fix (EXP-340)",
  p04_field_root_system: "writes the Field fix (EXP-340)",
  x01_text_between_items: "re-emits a Member (EXP-350)",
};

const VIEW_FORM_DELETES = /<Item type="(?:View|Form)" action="delete" where="[^"]*" \/>/g;
const ID_ELEMENTS = /<id(?: [^>]*?)?(?:\/>|>[^<]*<\/id>)/g;
const withoutPart2 = (text: string): string => text.replace(VIEW_FORM_DELETES, "").replace(ID_ELEMENTS, "");

const SETS = ["export", "export-items"];

it("names only recorded cases in its tables", () => {
  const recorded = new Set(SETS.flatMap((set) => loadXslFixture(join(FIXTURES_DIR, "14.0.7", "xsl", set)).cases.map((c) => c.name)));
  for (const name of [...SAME_APART_FROM_PART_2, ...Object.keys(NEEDS_PART_2)]) expect(recorded.has(name), name).toBe(true);
  for (const name of SAME_APART_FROM_PART_2) expect(NEEDS_PART_2[name], name).toBeUndefined();
});

describe.each(SETS)("14.0.7 export.xsl recordings, set %s", (set) => {
  const fixture = loadXslFixture(join(FIXTURES_DIR, "14.0.7", "xsl", set));

  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (name, recorded) => {
    if (NEEDS_PART_2[name]) return;
    const doc = loadXml(recorded.input, { preserveWhitespace: fixture.preserveWhitespace });
    if (recorded.transform.ok) {
      const text = transformExport(doc);
      if (SAME_APART_FROM_PART_2.has(name)) expect(withoutPart2(text)).toBe(withoutPart2(recorded.transform.text));
      else expect(text).toBe(recorded.transform.text);
      return;
    }
    const failure = (run: () => unknown): Error => {
      try {
        run();
      } catch (error) {
        return error as Error;
      }
      throw new Error("expected the transform to fail");
    };
    const thrown = failure(() => transformExport(doc));
    expect(thrown).toBeInstanceOf(ArgumentException);
    expect(thrown.message).toBe(recorded.transform.error.message);
    // the same failure, as ApplyXsl reports it
    const applied = failure(() => applyExportTransform(doc));
    expect(applied).toBeInstanceOf(CItemException);
    expect(applied.message).toBe(recorded.applied.ok ? "" : recorded.applied.error.message);
    expect(applied.cause).toBeInstanceOf(ArgumentException);
    expect((applied.cause as Error).message).toBe(thrown.message);
  });
});
