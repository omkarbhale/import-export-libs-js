import { isNullReference, isXPathException, isXmlException } from "../client/dotnet.js";
import { CItemException, stackText } from "../client/fault.js";

/**
 * What `CExportItems.Export` does with a failure (EXP-054): of everything that can go wrong in it, only an
 * `XmlException`, a `NullReferenceException` and an `XPathException` are caught, and each becomes a
 * `CItemException` with faultcode -1, the original's stack text and `{message} Can't export item.`. A
 * `CItemException` that is already thrown and every other exception pass through as they are.
 *
 * @spec EXP-054 EXP-055
 */
export function exportFailure(error: unknown): unknown {
  if (!(isXmlException(error) || isNullReference(error) || isXPathException(error))) return error;
  return new CItemException(-1, stackText(error), `${error.message} Can't export item.`, error);
}

/** Runs the steps of one item's export and applies {@link exportFailure} to whatever they throw. */
export async function guardExport<T>(steps: () => Promise<T>): Promise<T> {
  try {
    return await steps();
  } catch (error) {
    throw exportFailure(error);
  }
}
