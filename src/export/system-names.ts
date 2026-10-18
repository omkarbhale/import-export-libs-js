/**
 * The names the stylesheet looks up inside one `|`-delimited string. The test is a substring test, so a name that itself contains
 * `|` can match as a run of several entries (EXP-271).
 *
 * @spec EXP-271 EXP-301
 */

/** The 32 system property names (`export.xsl:4`), delimited by `|`. */
export const SYSTEM_PROPERTIES = `|${[
  "behavior",
  "classification",
  "config_id",
  "created_by_id",
  "created_on",
  "css",
  "current_state",
  "generation",
  "history_id",
  "id",
  "is_current",
  "is_released",
  "keyed_name",
  "release_date",
  "effective_date",
  "locked_by_id",
  "major_rev",
  "managed_by_id",
  "minor_rev",
  "modified_by_id",
  "modified_on",
  "new_version",
  "not_lockable",
  "owned_by_id",
  "permission_id",
  "related_id",
  "sort_order",
  "source_id",
  "state",
  "itemtype",
  "superseded_date",
  "team_id",
].join("|")}|`;

/** The six Identities that exist in every database, delimited by `|`. */
export const SYSTEM_IDENTITIES = "|World|Creator|Owner|Manager|Innovator Admin|Super User|";

/** `contains(list, concat('|', name, '|'))`. */
export function containsEntry(list: string, name: string): boolean {
  return list.includes(`|${name}|`);
}
