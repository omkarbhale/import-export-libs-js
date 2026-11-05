import { readFileSync } from "node:fs";
import { unescapeProbe } from "../manifest/probe-output.js";

/**
 * The case tables of `windows-fs.test.ts` (EXP-419, EXP-420), kept here as data so that `fs-matrix.test.ts` runs the same rows on
 * both file systems (HOST-217). `windows-fs.test.ts` imports them; no assertion of it depends on where they live.
 * @spec HOST-217
 */

/** A pair of names that the volume folds together, with the file names the engine's own run left in the folder. */
export interface FoldCase {
  first: string;
  second: string;
  files: string[];
}

/** The recorded cases of probe 14.0.7: two names that differ in one UTF-16 unit, written to one folder, and what was listed (EXP-419, EXP-420). */
export const FOLD_CASES: FoldCase[] = readFileSync(new URL("../../fixtures/export-write/probe-14.0.7.txt", import.meta.url), "utf8")
  .split(/\r?\n/)
  .flatMap((line) => {
    const match = /^CASE .* \(U\+([0-9A-F]{4}) \/ U\+([0-9A-F]{4})\) -> files: (.*)$/.exec(line);
    return match ? [{ first: String.fromCharCode(Number.parseInt(match[1] as string, 16)), second: String.fromCharCode(Number.parseInt(match[2] as string, 16)), files: unescapeProbe(match[3] as string).split(" | ") }] : [];
  });

/** Three spellings of one name, written in turn: the folder keeps the first spelling and the last content (T1). */
export const FIRST_SPELLING_WRITES = [
  ["y.XML", "first"],
  ["y.Xml", "second"],
  ["Y.xml", "third"],
] as const;

/** File names with dots and spaces at the end or inside, which the volume drops at the end only (EXP-420). */
export const TRAILING_FILE_NAMES = ["tr.xml ", "tr.xml.", "tr2.xml   ", "tr3 .xml", "dot.."];

/** Names with a character that .NET refuses in a path (EXP-420). */
export const ILLEGAL_PATH_NAMES = ["a*b", "a?b", 'a"b', "a<b", "a|b"];

/** Device names that are ordinary folders, unlike `NUL` (EXP-417, EXP-420). */
export const DEVICE_FOLDER_NAMES = ["CON", "aux", "LPT1"];

/**
 * Names that the unit tests do not write, for `fs-matrix.test.ts` only: a name in two Unicode normalisations, names with spaces and
 * dots inside, a name of 255 code units, astral characters, folds that differ from a plain upper-casing, a short-name look-alike and a
 * device name with an extension. Every one is a legal name on the volume the engine ran on (EXP-420).
 */
export const ODD_FILE_NAMES = [
  "é.xml",
  "é.xml",
  "a b.xml",
  "a  b.xml",
  ".xml",
  "..a.xml",
  "a..b.xml",
  `${"x".repeat(251)}.xml`,
  "\u{1f600}.xml",
  "\u{10400}.xml",
  "ǅ.xml",
  "İ.xml",
  "ß.xml",
  "a%20b.xml",
  "a#b'c.xml",
  "PROGRA~1.xml",
  "con.txt",
  "COM1.xml",
];
