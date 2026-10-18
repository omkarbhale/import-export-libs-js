/**
 * The dictionary that `CImportItems.Import` builds in merge mode from the add items of a document (IMP-040): type name to the
 * ids of the adds of that type. An entry is created by the first add of a type that has an id, and nothing is ever removed, so
 * the engine's `Dictionary` enumerates the types in the order of those first adds and each type's ids in document order. A `Map`
 * keeps the same order, and the library does not emulate a hash order.
 *
 * `adds` are the `.//Item[@action='add']` elements in document order, as `{ type, id }`: both are the attribute values, empty when
 * the attribute is missing. An add with no id adds nothing, not even an entry for its type.
 * @spec IMP-040
 */
export function groupAddedIdsByType(adds: Iterable<{ type: string; id: string }>): Map<string, string[]> {
  const idsByType = new Map<string, string[]>();
  for (const { type, id } of adds) {
    if (id === "") continue;
    const ids = idsByType.get(type);
    if (ids) ids.push(id);
    else idsByType.set(type, [id]);
  }
  return idsByType;
}
