import type { XmlElement } from "../xml/index.js";
import { attributeText, childElements, childText } from "./source.js";

/**
 * The stock values of the system properties of an ItemType, the table the ItemType edit compares a Property against (EXP-323).
 * A Property that differs in any compared field is one the user modified, and the edit carries it.
 *
 * @spec EXP-322 EXP-323 EXP-391
 */

export interface StockRow {
  /** The stock label, or null when the property has a null label. */
  label: string | null;
  dataType: string;
  storedLength: string;
  readonly: "0" | "1";
  /** The stock `is_hidden` and `is_hidden2` when they are not the common `1`. */
  hidden?: "0";
  hidden2?: "0";
  /** Whether `order_by` is compared; `is_current` is the one row that does not (EXP-391). */
  orderBy?: false;
  /** The dates are system properties only of a versionable ItemType. */
  versionable?: true;
}

const row = (
  label: string | null,
  dataType: string,
  storedLength: string,
  readonly: "0" | "1",
  extra: Partial<StockRow> = {},
): StockRow => ({ label, dataType, storedLength, readonly, ...extra });

/** The table of EXP-323, in the order of `export.xsl`'s comparison. */
export const STOCK_ROWS: Readonly<Record<string, StockRow>> = {
  behavior: row(null, "list", "64", "0"),
  classification: row("Classification", "string", "512", "0"),
  config_id: row(null, "item", "", "1"),
  created_by_id: row(null, "item", "", "1"),
  created_on: row(null, "date", "", "1"),
  css: row(null, "text", "", "0"),
  current_state: row(null, "item", "", "1"),
  generation: row(null, "integer", "", "1"),
  history_id: row("History Id", "item", "", "0"),
  id: row(null, "item", "", "1"),
  is_current: row(null, "boolean", "", "1", { orderBy: false }),
  is_released: row("Released", "boolean", "", "1"),
  keyed_name: row(null, "string", "128", "0"),
  locked_by_id: row(null, "item", "", "1"),
  major_rev: row(null, "string", "8", "0"),
  managed_by_id: row(null, "item", "", "0"),
  minor_rev: row(null, "string", "8", "0"),
  modified_by_id: row(null, "item", "", "1"),
  modified_on: row(null, "date", "", "1"),
  new_version: row(null, "boolean", "", "1"),
  not_lockable: row("Not Lockable", "boolean", "", "1"),
  owned_by_id: row(null, "item", "", "0"),
  permission_id: row(null, "item", "", "1"),
  related_id: row(null, "item", "", "0", { hidden: "0" }),
  sort_order: row(null, "integer", "", "0"),
  source_id: row(null, "item", "", "0"),
  state: row(null, "string", "32", "1"),
  effective_date: row("Effective Date", "date", "", "0", { versionable: true }),
  release_date: row("Release Date", "date", "", "1", { versionable: true }),
  superseded_date: row("Superseded Date", "date", "", "1", { hidden: "0", hidden2: "0", versionable: true }),
  itemtype: row("ItemType", "list", "", "0"),
  team_id: row("Team", "item", "", "0"),
};

/** `string(child)`: the string-value of the first child element called `name`. */
const valueOf = childText;

/** `child[string(@is_null)!='1']`: some child of that name whose `is_null` is not exactly `1`. */
function hasChildNotNull(property: XmlElement, name: string): boolean {
  return childElements(property, name).some((child) => attributeText(child, "is_null") !== "1");
}

/**
 * Whether a Property deviates from the stock row: any of the eleven compared fields differs. An absent child has the empty
 * string-value, so it deviates exactly where the stock value is not empty.
 *
 * @spec EXP-322 EXP-323
 */
export function deviatesFromStock(property: XmlElement, stock: StockRow): boolean {
  const labelDeviates =
    stock.label === null ? hasChildNotNull(property, "label") : valueOf(property, "label") !== stock.label;
  return (
    labelDeviates ||
    valueOf(property, "data_type") !== stock.dataType ||
    valueOf(property, "stored_length") !== stock.storedLength ||
    valueOf(property, "column_alignment") !== "left" ||
    valueOf(property, "is_hidden") !== (stock.hidden ?? "1") ||
    valueOf(property, "is_hidden2") !== (stock.hidden2 ?? "1") ||
    valueOf(property, "column_width") !== "" ||
    valueOf(property, "readonly") !== stock.readonly ||
    valueOf(property, "is_keyed") !== "0" ||
    (stock.orderBy !== false && valueOf(property, "order_by") !== "") ||
    hasChildNotNull(property, "default_value")
  );
}
