/**
 * The case table of `language-pack-io.test.ts` (LP-010, LP-020), kept here as data so that `fs-matrix.test.ts` runs the same rows on
 * both file systems (HOST-217). `language-pack-io.test.ts` imports it.
 * @spec HOST-217
 */

/** `Path.GetDirectoryName(path)`: the path, and the directory it gives. */
export const DIRECTORY_NAME_CASES: ReadonlyArray<readonly [path: string, directory: string]> = [
  ["C:\\pack\\ImportConfig.xml", "C:\\pack"],
  ["C:/pack/ImportConfig.xml", "C:\\pack"],
  ["C:\\pack\\x\\..\\ImportConfig.xml", "C:\\pack"],
  ["C:\\pack\\.\\ImportConfig.xml", "C:\\pack"],
  ["C:\\pack\\\\ImportConfig.xml", "C:\\pack"],
  ["ImportConfig.xml", ""],
  ["pack\\ImportConfig.xml", "pack"],
  ["..\\pack\\ImportConfig.xml", "..\\pack"],
  ["\\ImportConfig.xml", "\\"],
  ["C:\\ImportConfig.xml", "C:\\"],
  ["/home/u/pack/ImportConfig.xml", "\\home\\u\\pack"],
  ["\\\\server\\share\\ImportConfig.xml", "\\\\server\\share"],
];
