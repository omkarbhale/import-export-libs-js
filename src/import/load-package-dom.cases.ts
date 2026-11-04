import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The case tables of `load-package-dom.test.ts` (IMP-001 to IMP-012), kept here as data so that `fs-matrix.test.ts` builds the same
 * package folders on both file systems (HOST-217). `load-package-dom.test.ts` imports them.
 * @spec HOST-217
 */

/** Where the catalogue of the engine's own `LoadPackageDom` run, and its recorded output, are. */
export const LOAD_FIXTURES = fileURLToPath(new URL("../../fixtures/import-load/", import.meta.url));

/** A package folder to build, and how to load it (`fixtures/import-load/load-package-dom.cases.json`). */
export interface LoadCase {
  name: string;
  solutionPath?: string;
  dirs?: string[];
  files: { path: string; text?: string; b64?: string }[];
  relative?: string;
  trailingSlash?: boolean;
  longCreate?: boolean;
  hidden?: string[];
  lock?: string[];
  unc?: boolean;
}

const read = (file: string): LoadCase[] => JSON.parse(readFileSync(LOAD_FIXTURES + file, "utf8")) as LoadCase[];

/** The catalogue of 35 cases the engine's `LoadPackageDom` ran on Windows. */
export const LOAD_CASES: LoadCase[] = read("load-package-dom.cases.json");

/** The cases that only 12.0's reader can tell apart (IMP-007). */
export const EXTRA_LOAD_CASES: LoadCase[] = read("load-package-dom.12.0-extra.cases.json");

/** The cases that need Windows itself (a hidden attribute, a file another process holds, a UNC share): the unit tests do not replay them. */
export const WINDOWS_ONLY: ReadonlySet<string> = new Set(["hidden", "locked", "unc"]);

/** A package tree as the tests build one: a file's path below the root, and its text. */
export type PackageTree = Record<string, string>;

/** The trees of the file-listing tests (IMP-002 to IMP-006). */
export const LISTING_TREES = {
  /** Folders and `*.xml` files of one level, a deeper file, a file called `.xml`, and a folder that ends in `.xml` (made apart). */
  mixed: { "loose.xml": "", "b/x.XML": "", "b/y.xmlbak": "", "b/z.txt": "", "b/t.xml.bak": "", "B2/q.xm": "", "a/deep/d.xml": "", "a/.xml": "" },
  /** A file that only its short name matches (IMP-003, IMP-004). */
  shortName: {
    "p/LIBSJS-SCRATCH-Fs_Backup.xmlbak": "",
    "p/LIBSJS-SCRATCH-Fs_Plain.xml": "",
    "p/LIBSJS-SCRATCH-Fs_NoItem.xml": "",
    "p/LIBSJS-SCRATCH-Fs_Notes.txt": "",
    "p/Zed.xml": "",
  },
  /** Clashing short names, numbered in the order of the long names (IMP-004). */
  shortNameClash: { "p/report-b.xmlz": "", "p/report-a.xmlz": "", "p/report-c.xml": "" },
  /** One folder, to list with a trailing separator. */
  oneFolder: { "d/a.xml": "" },
  /** A folder and a file, to link to. */
  linkTargets: { "real/a.xml": "<AML/>", "target.xml": "<AML/>" },
  /** Only a file, listed as if it were a folder. */
  onlyFile: { "f.xml": "" },
} satisfies Record<string, PackageTree>;

/** The trees of the tests of skipped files and stamps (IMP-008, IMP-009). */
export const SKIP_AND_STAMP_TREES = {
  skipped: { "d/a.xml": "<AML><Foo/></AML>", "d/b.xml": "<aml><Item/></aml>", "d/c.xml": "<AML><Item type='List' action='add' id='ok'/></AML>" },
  stampedFirst: { "d/c.xmlbak": "<AML><Item tempKeyName='old' type='List' tempFullName='oldf' action='add' id='x'/><Item type='List' action='add' id='y'/></AML>" },
  stampFromName: { "d/a.b.xml": "<AML><Item type='List' action='add' id='1'/></AML>", "d/.xml": "<AML><Item type='List' action='add' id='2'/></AML>" },
} satisfies Record<string, PackageTree>;

/** The trees of the tests of failures (IMP-011, IMP-016). */
export const FAILURE_TREES = {
  malformed: { "d/a.xml": "<AML><Item></AML>" },
  declarationInside: { "d/a.xml": '<?xml version="1.0"?><AML><Item type="List"/></AML>' },
  invalidCharacter: { "d/a.xml": "<AML><Item type='List' action='add' id='x'><name>a&#1;b</name></Item></AML>" },
  doctype: { "d/a.xml": '<!DOCTYPE AML [<!ENTITY e "x">]><AML><Item type="List" action="add" id="x"/></AML>' },
  plain: { "d/a.xml": "<AML><Item type='List' action='add' id='x'/></AML>" },
} satisfies Record<string, PackageTree>;

/** The recorded import cases whose input folder is a package with odd files (`fixtures/14.0.7/import/<name>/step-1/input`). */
export const ODD_FILE_FIXTURES = ["fs-odd-files", "fs-xml-declaration"] as const;
