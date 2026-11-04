import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CItemException } from "../client/fault.js";
import type { Engine } from "../engines.js";
import { REMOVAL_MODES, exportFolderCaseNames } from "../export/export-folders.cases.js";
import { createOutputDir } from "../export/output-folder.js";
import { REPLAYED_ENGINES, replayCase } from "../export/replay-cases.js";
import { type Capability, type HostFsFactory, type HostFsFixture, probeCapabilities } from "../host/fs-conformance.js";
import { MemoryVfs } from "../host/memory-fs.js";
import { nodeFs } from "../host/node-fs.js";
import type { HostFs } from "../host/types.js";
import { getItemsFromPackageDom } from "../import/items.js";
import { EXTRA_LOAD_CASES, FAILURE_TREES, LISTING_TREES, LOAD_CASES, ODD_FILE_FIXTURES, SKIP_AND_STAMP_TREES, WINDOWS_ONLY } from "../import/load-package-dom.cases.js";
import type { LoadCase, PackageTree } from "../import/load-package-dom.cases.js";
import { loadPackage, loadPackageDom } from "../import/load-package-dom.js";
import { directoryGetDirectories, directoryGetXmlFiles, directoryGetXmlFilesRecursive } from "../import/package-files.js";
import { outerXml } from "../xml/writer-legacy.js";
import { COLON_FORMAT_PATHS, DRIVE_AND_SHARE_PATHS, ILLEGAL_FULL_PATHS } from "./host-path.cases.js";
import { directoryGetParentFullName, normalizeLongPath, readFileBytes, toHostPath, writeFileBytes } from "./host-path.js";
import type { PathEnvironment } from "./host-path.js";
import { DIRECTORY_NAME_CASES } from "./language-pack-io.cases.js";
import { getDirectoryName } from "./win-path.js";
import { DEVICE_FOLDER_NAMES, FIRST_SPELLING_WRITES, FOLD_CASES, ILLEGAL_PATH_NAMES, ODD_FILE_NAMES, TRAILING_FILE_NAMES } from "./windows-fs.cases.js";
import { directoryCreateDirectory, directoryDelete, directoryExists, fileWriteAllText, writeVolumeFile } from "./windows-fs.js";

/**
 * The file layer gives the same answer on every `HostFs` (HOST-217). The case tables of the unit tests of the NTFS emulation, the
 * host path, the language-pack file primitives, the package loader and the export's output folder (each now a `*.cases.ts` beside
 * its test) and the odd-name tables beside them are each run twice: on `nodeFs` in a temporary folder, and on `MemoryVfs` under the
 * very same path. A case records what each step returns or throws (the type and the message) and the tree the case leaves behind,
 * file for file and byte for byte; the two records must be equal.
 *
 * The paths are the same strings on both sides on purpose, so that a message that names a path needs no scrubbing and a limit that
 * depends on the length of a path (`\\?\` from 255 characters) is met at the same place.
 *
 * @spec HOST-217 HOST-214 HOST-215
 */

// ------------------------------------------------------------------------------------------------------------- outcomes

type Outcome = { ok: true; value: unknown } | { ok: false; error: string };

/** A value as a plain structure the two runs can be compared as: bytes as a digest, and text and structure as they are. */
function plain(value: unknown): unknown {
  if (value instanceof Uint8Array) return `bytes(${value.length}):${hash(value)}${value.length <= 48 ? `:${JSON.stringify(Buffer.from(value).toString("latin1"))}` : ""}`;
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, plain(member)]));
  return value;
}

const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

/** What a call returned, or the type, message and errno of what it threw. */
function observe(action: () => unknown): Outcome {
  try {
    return { ok: true, value: plain(action()) };
  } catch (thrown) {
    const error = thrown as Error & { code?: string };
    return { ok: false, error: `${error.name} (${error.constructor.name}): ${error.message}${error.code === undefined ? "" : ` [${error.code}]`}` };
  }
}

/** The tree below a folder, as `HostFs` shows it: every folder with a trailing `/`, every file with its size and digest. */
function walk(fs: HostFs, folder: string, prefix = ""): string[] {
  const lines: string[] = [];
  for (const entry of fs.readdir(folder).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const path = `${prefix}${entry.name}`;
    const full = `${folder}/${entry.name}`;
    if (entry.isSymbolicLink) lines.push(`${path} -> ${fs.stat(full).isDirectory ? "folder" : "file"}`);
    else if (entry.isDirectory) lines.push(`${path}/`, ...walk(fs, full, `${path}/`));
    else {
      const bytes = fs.readFile(full);
      lines.push(`${path} = ${bytes.length} bytes ${hash(bytes)}${bytes.length <= 48 ? ` ${JSON.stringify(Buffer.from(bytes).toString("latin1"))}` : ""}`);
    }
  }
  return lines;
}

// ------------------------------------------------------------------------------------------------------------- sandboxes

/** A file system, an empty folder in it, and how to link and to clean up. */
interface Sandbox {
  fs: HostFs;
  root: string;
  symlink?(target: string, path: string): void;
  dispose(): void;
}

const processCwd = process.cwd();

const diskSandbox = (): Sandbox => {
  const root = mkdtempSync(join(tmpdir(), "libsjs-matrix-"));
  return { fs: nodeFs, root, symlink: (target, path) => symlinkSync(target, path), dispose: () => rmSync(root, { recursive: true, force: true }) };
};

/** The tree in memory, with the same folder under the same name as `root` and the process's current directory as its own. */
const memorySandbox = (root: string): Sandbox => {
  const fs = new MemoryVfs(undefined, { cwd: processCwd });
  fs.mount({ [`${root}/`]: "" });
  return { fs, root, dispose: () => undefined };
};

/** What a case works with: the file system, paths under the folder, and the record of the steps. */
class Run {
  readonly steps: Array<{ label: string; outcome: Outcome }> = [];
  /** The environment of the Windows layer: the folder is the current directory, so a relative engine path lands in it. */
  readonly env: PathEnvironment;
  /** The environment of the host-path layer: host paths are absolute here or relative to the process's current directory. */
  readonly host: PathEnvironment;
  readonly fs: HostFs;
  readonly root: string;
  readonly symlinkTo: Sandbox["symlink"];

  constructor(sandbox: Sandbox) {
    this.fs = sandbox.fs;
    this.root = sandbox.root;
    this.symlinkTo = sandbox.symlink;
    this.env = { platform: "linux", cwd: this.root, fs: this.fs };
    this.host = { platform: "linux", cwd: processCwd, fs: this.fs };
  }

  step(label: string, action: () => unknown): void {
    this.steps.push({ label, outcome: observe(action) });
  }

  /** A path of the engine's form under the folder: Windows separators after it. */
  win(...parts: string[]): string {
    return [this.root, ...parts].join("\\");
  }

  /** A host path under the folder. */
  abs(rel: string): string {
    return `${this.root}/${rel}`;
  }

  put(rel: string, content: string | Uint8Array = ""): void {
    this.fs.writeFile(this.abs(rel), typeof content === "string" ? Buffer.from(content, "utf8") : content);
  }

  /** `mkdir -p` below the folder, one `mkdir` at a time. */
  mkdirp(rel: string): void {
    let current = this.root;
    for (const name of rel.split("/").filter((part) => part !== "")) {
      current = `${current}/${name}`;
      if (!this.fs.exists(current)) this.fs.mkdir(current);
    }
  }

  /** The tree of files: folders made and files written. */
  tree(files: PackageTree): void {
    for (const [path, text] of Object.entries(files)) {
      this.mkdirp(dirname(path) === "." ? "" : dirname(path));
      this.put(path, text);
    }
  }

  /** The sorted names in a folder below the folder (the folder itself for an empty `rel`). */
  names(rel = ""): string[] {
    return this.fs
      .readdir(rel === "" ? this.root : this.abs(rel))
      .map((entry) => entry.name)
      .sort();
  }

  exists(rel: string): boolean {
    return this.fs.exists(this.abs(rel));
  }

  text(rel: string): string {
    return Buffer.from(this.fs.readFile(this.abs(rel))).toString("utf8");
  }
}

interface Result {
  steps: Array<{ label: string; outcome: Outcome }>;
  tree: string[];
}

async function execute(matrixCase: MatrixCase, sandbox: Sandbox): Promise<Result> {
  const run = new Run(sandbox);
  await matrixCase.run(run);
  return { steps: run.steps, tree: walk(run.fs, run.root) };
}

/** Runs a case on the disk and, after the folder is gone, on a tree in memory under the same path. */
async function bothWays(matrixCase: MatrixCase, memory: (root: string) => Sandbox = memorySandbox): Promise<{ disk: Result; memory: Result }> {
  const disk = diskSandbox();
  let onDisk: Result;
  try {
    onDisk = await execute(matrixCase, disk);
  } finally {
    disk.dispose();
  }
  return { disk: onDisk, memory: await execute(matrixCase, memory(disk.root)) };
}

// ------------------------------------------------------------------------------------------------------------- cases

/** What the disk may lack and the tree has no more of, besides the capabilities of the suite of HOST-214. */
type Needs = Capability | "wellFormedNames" | "unboundedNames";

interface MatrixCase {
  name: string;
  /** The capability the case needs of both file systems; it is skipped, with the reason, on a host that lacks it. */
  needs?: Needs;
  /** A case that cannot run on either file system, and why. */
  skip?: string;
  run(run: Run): void | Promise<void>;
}

interface MatrixTable {
  /** The table of the data, as `file: CONSTANT`. */
  id: string;
  /** The unit test that holds the assertions on the same data. */
  test: string;
  /** The rows of the data table(s), counting each constant's length; `0` for a table of scenarios without a constant. */
  rows: number;
  cases: MatrixCase[];
}

const quiet = { writeLine: () => undefined };

const FOLD_NAME = (first: string, second: string): string => `c_${first.charCodeAt(0).toString(16)}_${second.charCodeAt(0).toString(16)}`;

// ---- io/windows-fs

const windowsFoldTable: MatrixTable = {
  id: "io/windows-fs.cases.ts: FOLD_CASES, FIRST_SPELLING_WRITES",
  test: "io/windows-fs.test.ts",
  rows: FOLD_CASES.length + FIRST_SPELLING_WRITES.length,
  cases: [
    ...FOLD_CASES.map(
      (fold): MatrixCase => ({
        name: `U+${fold.first.charCodeAt(0).toString(16)} and U+${fold.second.charCodeAt(0).toString(16)}`,
        run: (t) => {
          const folder = t.win(FOLD_NAME(fold.first, fold.second));
          t.step("create the folder", () => directoryCreateDirectory(`${folder}\\`, t.env));
          t.step("write the first name", () => writeVolumeFile(`${folder}\\${fold.first}.xml`, Buffer.from("one"), t.env));
          t.step("write the second name", () => writeVolumeFile(`${folder}\\${fold.second}.xml`, Buffer.from("two"), t.env));
          t.step("the names", () => t.names(FOLD_NAME(fold.first, fold.second)));
        },
      }),
    ),
    {
      name: "keeps the spelling of the first creation and the content of the last write (T1)",
      run: (t) => {
        t.step("create", () => directoryCreateDirectory(`${t.win("t1")}\\`, t.env));
        for (const [name, text] of FIRST_SPELLING_WRITES) t.step(`write ${name}`, () => writeVolumeFile(t.win("t1", name), Buffer.from(text), t.env));
        t.step("the names", () => t.names("t1"));
        t.step("the content", () => t.text("t1/y.XML"));
      },
    },
  ],
};

const windowsNameTables: MatrixTable[] = [
  {
    id: "io/windows-fs.cases.ts: TRAILING_FILE_NAMES",
    test: "io/windows-fs.test.ts",
    rows: TRAILING_FILE_NAMES.length,
    cases: TRAILING_FILE_NAMES.map(
      (name): MatrixCase => ({
        name: JSON.stringify(name),
        needs: "trailing",
        run: (t) => {
          t.step("create the folder", () => directoryCreateDirectory(`${t.win("w2")}\\`, t.env));
          t.step("write", () => writeVolumeFile(t.win("w2", name), Buffer.from(name), t.env));
          t.step("the names", () => t.names("w2"));
          t.step("the file exists", () => directoryExists(t.win("w2", name), t.env));
        },
      }),
    ),
  },
  {
    id: "io/windows-fs.cases.ts: ILLEGAL_PATH_NAMES",
    test: "io/windows-fs.test.ts",
    rows: ILLEGAL_PATH_NAMES.length,
    cases: ILLEGAL_PATH_NAMES.map(
      (bad): MatrixCase => ({
        name: JSON.stringify(bad),
        run: (t) => {
          t.step("create a folder", () => directoryCreateDirectory(`${t.win(bad)}\\`, t.env));
          t.step("write a file", () => writeVolumeFile(t.win(bad), Buffer.from("x"), t.env));
          t.step("exists", () => directoryExists(t.win(bad), t.env));
        },
      }),
    ),
  },
  {
    id: "io/windows-fs.cases.ts: DEVICE_FOLDER_NAMES",
    test: "io/windows-fs.test.ts",
    rows: DEVICE_FOLDER_NAMES.length,
    cases: DEVICE_FOLDER_NAMES.map(
      (device): MatrixCase => ({
        name: device,
        run: (t) => {
          t.step("create dev", () => directoryCreateDirectory(`${t.win("dev")}\\`, t.env));
          t.step("create the device folder", () => directoryCreateDirectory(`${t.win("dev", device)}\\`, t.env));
          t.step("write into it", () => writeVolumeFile(t.win("dev", device, "x.xml"), Buffer.from("x"), t.env));
          t.step("the names", () => t.names("dev"));
          t.step("the files", () => t.names(`dev/${device}`));
        },
      }),
    ),
  },
  {
    id: "io/windows-fs.cases.ts: ODD_FILE_NAMES (new, matrix only)",
    test: "(none)",
    rows: ODD_FILE_NAMES.length,
    cases: ODD_FILE_NAMES.map((name): MatrixCase => {
      const needs: Needs | undefined = /[\ud800-\udfff]/u.test(name.replace(/[\ud800-\udbff][\udc00-\udfff]/g, "")) ? "wellFormedNames" : name.length > 250 ? "longName" : name === "\u00e9.xml" || name === "e\u0301.xml" ? "normalization" : undefined;
      return {
        name: JSON.stringify(name.length > 40 ? `${name.slice(0, 8)}…(${name.length})` : name),
        ...(needs === undefined ? {} : { needs }),
        run: (t) => {
          t.step("create the folder", () => directoryCreateDirectory(`${t.win("odd")}\\`, t.env));
          t.step("write", () => writeVolumeFile(t.win("odd", name), Buffer.from(`content of ${name.length}`), t.env));
          t.step("write the same name again", () => writeVolumeFile(t.win("odd", name), Buffer.from("again"), t.env));
          t.step("exists as a folder", () => directoryExists(t.win("odd", name), t.env));
          t.step("the names", () => t.names("odd"));
          t.step("the host path reads it", () => readFileBytes(t.abs(`odd/${name}`), t.host));
          t.mkdirp("odd/sibling");
          t.step("the host path writes a sibling", () => writeFileBytes(t.abs(`odd/sibling/${name}`), Buffer.from("host"), t.host));
          t.step("the sibling reads back", () => readFileBytes(t.abs(`odd/sibling/${name}`), t.host));
          t.step("the names after", () => t.names("odd"));
          t.step("create it as a folder", () => directoryCreateDirectory(t.win("odd", name), t.env));
          t.step("create a folder of the name", () => directoryCreateDirectory(`${t.win("odd", `d-${name}`)}\\`, t.env));
          t.step("write below it", () => writeVolumeFile(t.win("odd", `d-${name}`, "inner.xml"), Buffer.from("inner"), t.env));
          t.step("delete it", () => directoryDelete(t.win("odd", `d-${name}`), true, t.env));
          t.step("the names at the end", () => t.names("odd"));
        },
      };
    }),
  },
];

/** The scenarios of `io/windows-fs.test.ts` that are not tables: each `it` of the file, run on both file systems. */
const windowsScenarios: MatrixTable = {
  id: "io/windows-fs.test.ts: the scenarios (no table)",
  test: "io/windows-fs.test.ts",
  rows: 0,
  cases: [
    {
      name: "keeps a folder under the spelling it was made with, and finds it through another",
      run: (t) => {
        t.step("create Case", () => directoryCreateDirectory(`${t.win("Case")}\\`, t.env));
        t.step("exists as case", () => directoryExists(`${t.win("case")}\\`, t.env));
        t.step("create CASE\\sub", () => directoryCreateDirectory(`${t.win("CASE", "sub")}\\`, t.env));
        t.step("the names of Case", () => t.names("Case"));
        t.step("the names", () => t.names());
      },
    },
    {
      name: "makes a folder without trailing space and dots, and cannot reach it by the name with a space before a separator",
      needs: "trailing",
      run: (t) => {
        t.step("create 'Sp '", () => directoryCreateDirectory(`${t.win("Sp ")}\\`, t.env));
        t.step("Sp exists on the host", () => t.exists("Sp"));
        t.step("exists 'Sp\\'", () => directoryExists(`${t.win("Sp ")}\\`, t.env));
        t.step("exists Sp", () => directoryExists(t.win("Sp"), t.env));
        t.step("exists 'Sp '", () => directoryExists(t.win("Sp "), t.env));
        t.step("write below 'Sp '", () => writeVolumeFile(t.win("Sp ", "a.xml"), Buffer.from("x"), t.env));
        t.step("create Dotx.", () => directoryCreateDirectory(`${t.win("Dotx.")}\\`, t.env));
        t.step("exists Dotx..\\x", () => directoryExists(t.win("Dotx..", "x"), t.env));
        t.step("create doty..", () => directoryCreateDirectory(`${t.win("doty..")}\\`, t.env));
        t.step("the names", () => t.names());
      },
    },
    {
      name: "takes both separators, drops empty names and resolves . and ..",
      run: (t) => {
        t.step("create", () => directoryCreateDirectory(`${t.root}\\n1\\\\n2/n3\\.\\..\\n3\\`, t.env));
        t.step("the path exists", () => t.exists("n1/n2/n3"));
        t.step("exists with both separators", () => directoryExists(`${t.root}\\n1/n2\\n3`, t.env));
        t.step("write through dots", () => writeVolumeFile(`${t.root}\\n1\\n2\\..\\n2\\f.xml`, Buffer.from("x"), t.env));
        t.step("the names", () => t.names("n1/n2"));
      },
    },
    {
      name: "reads a relative path from the current directory",
      run: (t) => {
        t.step("create", () => directoryCreateDirectory("rel_dir\\inner\\", t.env));
        t.step("exists below", () => t.exists("rel_dir/inner"));
        t.step("write", () => writeVolumeFile(".\\rel_dir\\inner\\f.xml", Buffer.from("x"), t.env));
        t.step("exists", () => directoryExists("rel_dir\\inner", t.env));
      },
    },
    {
      name: "refuses a colon as .NET does",
      run: (t) => {
        t.step("create a:b", () => directoryCreateDirectory(`${t.win("a:b")}\\`, t.env));
      },
    },
    {
      name: "refuses a name of more than 255 code units, and a path of 258 or 259 characters or more",
      run: (t) => {
        t.step("a name of 256", () => directoryExists(t.win("x".repeat(256)), t.env));
        t.step("a relative path of 258", () => directoryExists("x".repeat(258), t.env));
        t.step("a rooted path of 259", () => directoryExists(`/${"x".repeat(258)}`, t.env));
        t.step("a relative name of 255", () => directoryExists("x".repeat(255), t.env));
      },
    },
    {
      name: "cannot write below a folder called NUL",
      run: (t) => {
        t.step("create dev", () => directoryCreateDirectory(`${t.win("dev")}\\`, t.env));
        t.step("write below NUL", () => writeVolumeFile(t.win("dev", "NUL", "x.xml"), Buffer.from("x"), t.env));
        t.step("write below nul", () => writeVolumeFile(t.win("dev", "nul", "x.xml"), Buffer.from("x"), t.env));
        t.step("the names", () => t.names("dev"));
      },
    },
    {
      name: "does not create a folder where a file has the name, and says so",
      run: (t) => {
        t.put("isfile", "x");
        t.step("exists", () => directoryExists(t.win("isfile"), t.env));
        t.step("create over the file", () => directoryCreateDirectory(t.win("isfile"), t.env));
        t.step("create below the file", () => directoryCreateDirectory(t.win("isfile", "below"), t.env));
        t.step("write below the file", () => writeVolumeFile(t.win("isfile", "below.xml"), Buffer.from("x"), t.env));
        t.step("delete the file as a folder", () => directoryDelete(t.win("isfile"), true, t.env));
      },
    },
    {
      name: "does not write a file where a folder has the name",
      run: (t) => {
        t.step("create", () => directoryCreateDirectory(`${t.win("isdir")}\\`, t.env));
        t.step("write over the folder", () => writeVolumeFile(t.win("isdir"), Buffer.from("x"), t.env));
      },
    },
    {
      name: "does not write into a folder that is missing",
      run: (t) => {
        t.step("write", () => writeVolumeFile(t.win("nothere", "f.xml"), Buffer.from("x"), t.env));
      },
    },
    {
      name: "makes the folder of a name that ends in a space before more path, then fails below it (COD)",
      needs: "trailing",
      run: (t) => {
        t.step("create", () => directoryCreateDirectory(t.win("b ", "Import"), t.env));
        t.step("b exists", () => t.exists("b"));
        t.step("b\\Import exists", () => t.exists("b/Import"));
      },
    },
    {
      name: "deletes a folder with everything in it, and refuses one that is missing",
      run: (t) => {
        t.step("create", () => directoryCreateDirectory(`${t.win("del", "sub")}\\`, t.env));
        t.step("write", () => writeVolumeFile(t.win("del", "keep.txt"), Buffer.from("x"), t.env));
        t.step("delete", () => directoryDelete(t.win("del"), true, t.env));
        t.step("exists", () => t.exists("del"));
        t.step("delete again", () => directoryDelete(t.win("del"), true, t.env));
      },
    },
    {
      name: "refuses a null or empty path as .NET does",
      run: (t) => {
        t.step("exists null", () => directoryExists(null, t.env));
        t.step("exists empty", () => directoryExists("", t.env));
        t.step("create null", () => directoryCreateDirectory(null, t.env));
        t.step("write null", () => writeVolumeFile(null, Buffer.from("x"), t.env));
        t.step("write empty", () => writeVolumeFile("", Buffer.from("x"), t.env));
        t.step("delete null", () => directoryDelete(null, true, t.env));
      },
    },
    {
      name: "writes through the prefix and sends a UNC path to a folder below the current directory (EXP-422)",
      run: (t) => {
        t.step("create unc", () => directoryCreateDirectory(`${t.win("unc")}\\`, t.env));
        t.step("write to the share", () => writeVolumeFile("\\\\server\\share\\f.xml", Buffer.from("x"), t.env));
        t.step("create the share folder", () => directoryCreateDirectory("server\\share\\", t.env));
        t.step("write to the share again", () => writeVolumeFile("\\\\server\\share\\f.xml", Buffer.from("x"), t.env));
        t.step("the content", () => t.text("server/share/f.xml"));
      },
    },
    {
      name: "writes a file and a folder with a name of 255 code units, through the prefix",
      needs: "longName",
      run: (t) => {
        const name = "n".repeat(255);
        t.step("create", () => directoryCreateDirectory(`${t.win(name)}\\`, t.env));
        t.step("write", () => writeVolumeFile(t.win(name, `${"f".repeat(255)}`), Buffer.from("long"), t.env));
        t.step("the names", () => t.names(name).map((entry) => entry.length));
        t.step("exists", () => directoryExists(t.win(name), t.env));
        t.step("delete", () => directoryDelete(t.win(name), true, t.env));
      },
    },
  ],
};

/** A name that passes the disk's own limit (255 bytes of UTF-8), which the layers above the host do not check. */
const beyondDiskLimit: MatrixTable = {
  id: "io/host-path.ts: a host name past the disk's limit (new, matrix only)",
  test: "(none)",
  rows: 0,
  cases: [
    {
      name: "a name of 300 characters, through the host path",
      needs: "unboundedNames",
      run: (t) => {
        const name = `${"n".repeat(296)}.xml`;
        t.step("write", () => writeFileBytes(t.abs(name), Buffer.from("long"), t.host));
        t.step("read", () => readFileBytes(t.abs(name), t.host));
        t.step("the name", () => t.names().map((entry) => entry.length));
        t.step("the Windows layer refuses it first", () => writeVolumeFile(t.win(name), Buffer.from("long"), t.env));
      },
    },
  ],
};

// ---- io/host-path

const hostPathScenarios: MatrixTable = {
  id: "io/host-path.test.ts: reading and writing files (no table)",
  test: "io/host-path.test.ts",
  rows: 0,
  cases: [
    {
      name: "writes and reads a file by an absolute host path",
      run: (t) => {
        t.step("write", () => writeFileBytes(t.abs("x.bin"), Buffer.from("abc"), t.host));
        t.step("read", () => readFileBytes(t.abs("x.bin"), t.host).toString());
        t.step("write by a Windows-looking path", () => writeFileBytes(`${t.root}\\y.bin`, Buffer.from("win"), t.host));
        t.step("the names", () => t.names());
      },
    },
    {
      name: "fails as .NET does for a null path, an empty path, a missing file, a missing folder and a folder",
      run: (t) => {
        t.step("read null", () => readFileBytes(null, t.host));
        t.step("write null", () => writeFileBytes(null, Buffer.alloc(0), t.host));
        t.step("read empty", () => readFileBytes("", t.host));
        t.step("write empty", () => writeFileBytes("", Buffer.alloc(0), t.host));
        t.step("read a missing file", () => readFileBytes(t.abs("missing"), t.host));
        t.step("read below a missing folder", () => readFileBytes(t.abs("missing/x"), t.host));
        t.step("write below a missing folder", () => writeFileBytes(t.abs("missing/x"), Buffer.alloc(0), t.host));
        t.step("read a folder", () => readFileBytes(t.root, t.host));
        t.step("write over a folder", () => writeFileBytes(t.root, Buffer.alloc(0), t.host));
        t.put("afile", "x");
        t.step("read below a file", () => readFileBytes(t.abs("afile/x"), t.host));
        t.step("write below a file", () => writeFileBytes(t.abs("afile/x"), Buffer.alloc(0), t.host));
      },
    },
    {
      name: "overwrites an existing file, and a shorter content leaves no tail",
      run: (t) => {
        t.put("over.bin", "long old content");
        t.step("write", () => writeFileBytes(t.abs("over.bin"), Buffer.from("new"), t.host));
        t.step("read", () => readFileBytes(t.abs("over.bin"), t.host).toString());
        t.step("write nothing", () => writeFileBytes(t.abs("over.bin"), Buffer.alloc(0), t.host));
        t.step("read", () => readFileBytes(t.abs("over.bin"), t.host).length);
      },
    },
    {
      name: "reads and writes bytes that are not text",
      run: (t) => {
        const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
        t.step("write", () => writeFileBytes(t.abs("all.bin"), all, t.host));
        t.step("read", () => readFileBytes(t.abs("all.bin"), t.host));
      },
    },
  ],
};

const hostPathTables: MatrixTable[] = [
  {
    id: "io/host-path.cases.ts: ILLEGAL_FULL_PATHS (no file is touched)",
    test: "io/host-path.test.ts",
    rows: ILLEGAL_FULL_PATHS.length,
    cases: ILLEGAL_FULL_PATHS.map(
      (bad): MatrixCase => ({
        name: JSON.stringify(bad),
        run: (t) => {
          t.step("normalizeLongPath", () => normalizeLongPath(bad, { platform: "win32", cwd: "C:\\work\\tmp5", fs: t.fs }));
          t.step("toHostPath on Windows", () => toHostPath(bad, { platform: "win32", cwd: "C:\\work\\tmp5", fs: t.fs }));
        },
      }),
    ),
  },
  {
    id: "io/host-path.cases.ts: COLON_FORMAT_PATHS (no file is touched)",
    test: "io/host-path.test.ts",
    rows: COLON_FORMAT_PATHS.length,
    cases: COLON_FORMAT_PATHS.map(
      (bad): MatrixCase => ({
        name: JSON.stringify(bad),
        run: (t) => {
          t.step("normalizeLongPath", () => normalizeLongPath(bad, { platform: "win32", cwd: "C:\\work\\tmp5", fs: t.fs }));
        },
      }),
    ),
  },
  {
    id: "io/host-path.cases.ts: DRIVE_AND_SHARE_PATHS",
    test: "io/host-path.test.ts",
    rows: DRIVE_AND_SHARE_PATHS.length,
    cases: DRIVE_AND_SHARE_PATHS.map(
      (path): MatrixCase => ({
        name: JSON.stringify(path),
        run: (t) => {
          t.step("toHostPath", () => toHostPath(path, { platform: "linux", fs: t.fs }));
          t.step("toHostPath on a browser", () => toHostPath(path, { platform: "browser", fs: t.fs }));
          t.step("read", () => readFileBytes(path, t.host));
          t.step("write", () => writeFileBytes(path, Buffer.alloc(0), t.host));
          t.step("create a folder", () => directoryCreateDirectory(path, t.env));
          t.step("list", () => directoryGetDirectories(path, t.host));
        },
      }),
    ),
  },
];

// ---- io/language-pack-io

const languagePackTables: MatrixTable[] = [
  {
    id: "io/language-pack-io.cases.ts: DIRECTORY_NAME_CASES (no file is touched)",
    test: "io/language-pack-io.test.ts",
    rows: DIRECTORY_NAME_CASES.length,
    cases: DIRECTORY_NAME_CASES.map(
      ([path]): MatrixCase => ({
        name: JSON.stringify(path),
        run: (t) => {
          t.step("getDirectoryName", () => getDirectoryName(path));
          t.step("directoryGetParentFullName", () => directoryGetParentFullName(path, { platform: "linux", cwd: "/work", fs: t.fs }));
        },
      }),
    ),
  },
  {
    id: "io/language-pack-io.test.ts: File.WriteAllText, the parent folder (no table)",
    test: "io/language-pack-io.test.ts",
    rows: 0,
    cases: [
      {
        name: "writes UTF-8 without a byte-order mark and overwrites",
        run: (t) => {
          t.step("write", () => fileWriteAllText(t.abs("Foo.xml"), "<AML>\u00fc\u{1f600}</AML>", t.host));
          t.step("the bytes", () => t.fs.readFile(t.abs("Foo.xml")));
          t.put("Foo.xml", "old and longer than the new text");
          t.step("overwrite", () => fileWriteAllText(t.abs("Foo.xml"), "new", t.host));
          t.step("the text", () => t.text("Foo.xml"));
          t.step("write a Windows path", () => fileWriteAllText(`${t.root}\\Bar.xml`, "bar", t.env));
          t.step("the names", () => t.names());
        },
      },
      {
        name: "fails as .NET does for a null path and a missing folder",
        run: (t) => {
          t.step("write null", () => fileWriteAllText(null, "x", t.host));
          t.step("write to a missing folder", () => fileWriteAllText(t.abs("missing/Foo.xml"), "x", t.host));
          t.step("write to a Windows path in a missing folder", () => fileWriteAllText(t.win("missing", "Foo.xml"), "x", t.env));
        },
      },
      {
        name: "the parent folder of a path the engine built with Combine",
        run: (t) => {
          const linux = { platform: "linux", cwd: "/work", fs: t.fs } as const;
          t.step("with a backslash", () => directoryGetParentFullName("/tmp/LanguagePack_x\\imports.mf", linux));
          t.step("without", () => directoryGetParentFullName("/tmp/LanguagePack_x/imports.mf", linux));
          t.step("a drive", () => directoryGetParentFullName("C:\\tmp\\LanguagePack_x\\imports.mf", linux));
        },
      },
    ],
  },
];

// ---- import/load-package-dom

/** The record of a load, as `observe` of `load-package-dom.test.ts` makes it, with the paths as they are. */
function loaded(t: Run, solutionPath: string, engine: Engine): unknown {
  const log: string[] = [];
  const logWriter = { writeLine: (text: string) => log.push(`${text}\r\n`) };
  try {
    const doc = loadPackageDom(solutionPath, logWriter, { engine, environment: t.host });
    return { xml: outerXml(doc), items: getItemsFromPackageDom(doc).length, log };
  } catch (error) {
    const caught = error as Error;
    const record: Record<string, unknown> = { exception: `${caught.name} (${caught.constructor.name})`, message: caught.message, log };
    if (caught instanceof CItemException) {
      record.faultcode = caught.faultcode;
      record.bInnError = caught.bInnError;
      const inner = caught.cause as Error | undefined;
      if (inner) record.inner = `${inner.name} (${inner.constructor.name}): ${inner.message}`;
    }
    return record;
  }
}

/** Builds a case of the catalogue in the folder and loads it as `replayLoads` of `load-package-dom.test.ts` does. */
function loadCase(testCase: LoadCase, engine: Engine): MatrixCase {
  return {
    name: `${engine}: ${testCase.name}`,
    ...(WINDOWS_ONLY.has(testCase.name) ? { skip: "needs Windows (a hidden attribute, a file another process holds, a UNC share); the unit test skips it too" } : {}),
    run: (t) => {
      for (const directory of testCase.dirs ?? []) t.mkdirp(directory);
      for (const file of testCase.files) {
        t.mkdirp(dirname(file.path) === "." ? "" : dirname(file.path));
        t.put(file.path, file.b64 !== undefined ? Buffer.from(file.b64, "base64") : Buffer.from(file.text ?? "", "utf8"));
      }
      let solutionPath = testCase.solutionPath === undefined ? t.root : t.abs(testCase.solutionPath);
      if (testCase.relative !== undefined) solutionPath = relative(processCwd, t.abs(testCase.relative));
      if (testCase.trailingSlash) solutionPath += "/";
      t.step("load", () => loaded(t, solutionPath, engine));
    },
  };
}

const catalogueRuns: Array<readonly [Engine, LoadCase[]]> = [
  ["12.0", LOAD_CASES],
  ["12.0", EXTRA_LOAD_CASES],
  ["14.0.7", LOAD_CASES],
  ["14.35", LOAD_CASES],
];

const loadTables: MatrixTable[] = [
  {
    id: "import/load-package-dom.cases.ts: LOAD_CASES, EXTRA_LOAD_CASES (12.0, 12.0 extra, 14.0.7, 14.35)",
    test: "import/load-package-dom.test.ts",
    rows: LOAD_CASES.length + EXTRA_LOAD_CASES.length,
    cases: catalogueRuns.flatMap(([engine, cases]) => cases.map((testCase) => loadCase(testCase, engine))),
  },
  {
    id: "import/load-package-dom.cases.ts: LISTING_TREES",
    test: "import/load-package-dom.test.ts",
    rows: Object.keys(LISTING_TREES).length,
    cases: [
      {
        name: "lists only the immediate subdirectories, in NTFS order, and the *.xml files of one folder",
        run: (t) => {
          t.tree(LISTING_TREES.mixed);
          t.mkdirp("c.xml");
          t.step("the folders", () => directoryGetDirectories(t.root, t.host));
          t.step("the files of b", () => directoryGetXmlFiles(t.abs("b"), t.host));
          t.step("the files of a", () => directoryGetXmlFiles(t.abs("a"), t.host));
          t.step("the files of the root", () => directoryGetXmlFiles(t.root, t.host));
          t.step("every file below", () => directoryGetXmlFilesRecursive(t.root, t.host));
        },
      },
      {
        name: "lists a file that only its short name matches at the short name's place (IMP-003, IMP-004)",
        run: (t) => {
          t.tree(LISTING_TREES.shortName);
          t.step("the files", () => directoryGetXmlFiles(t.abs("p"), t.host));
        },
      },
      {
        name: "numbers clashing short names in the order of the long names (IMP-004)",
        run: (t) => {
          t.tree(LISTING_TREES.shortNameClash);
          t.step("the files", () => directoryGetXmlFiles(t.abs("p"), t.host));
        },
      },
      {
        name: "does not double a trailing separator",
        run: (t) => {
          t.tree(LISTING_TREES.oneFolder);
          t.step("the folders", () => directoryGetDirectories(`${t.root}/`, t.host));
        },
      },
      {
        name: "follows a link to a directory and to a file",
        needs: "symlink",
        run: (t) => {
          t.tree(LISTING_TREES.linkTargets);
          t.symlinkTo?.(t.abs("real"), t.abs("linkdir"));
          t.symlinkTo?.(t.abs("target.xml"), t.abs("real/b.xml"));
          t.step("the folders", () => directoryGetDirectories(t.root, t.host));
          t.step("the files", () => directoryGetXmlFiles(t.abs("real"), t.host));
        },
      },
      {
        name: "raises DirectoryNotFoundException for a missing folder and IOException for a file",
        run: (t) => {
          t.tree(LISTING_TREES.onlyFile);
          t.step("a missing folder", () => directoryGetDirectories(t.abs("nope"), t.host));
          t.step("a file", () => directoryGetDirectories(t.abs("f.xml"), t.host));
          t.step("the files of a missing folder", () => directoryGetXmlFiles(t.abs("nope"), t.host));
          t.step("the files of a file", () => directoryGetXmlFiles(t.abs("f.xml"), t.host));
          t.step("every file below a missing folder", () => directoryGetXmlFilesRecursive(t.abs("nope"), t.host));
        },
      },
      {
        name: "removes a leading ? from the folder as the engine's path trim does, also off Windows (IMP-006)",
        run: (t) => {
          t.tree(LISTING_TREES.oneFolder);
          const folder = relative(processCwd, t.root);
          t.step("the folders", () => directoryGetDirectories(`??${folder}`, t.host));
        },
      },
      {
        name: "removes every leading backslash of a UNC path, which makes it relative (IMP-006)",
        run: (t) => {
          t.step("on Windows rules", () => directoryGetDirectories("\\\\server\\share\\pkg", { platform: "win32", cwd: "C:\\work", fs: t.fs }));
          t.step("on POSIX rules", () => directoryGetDirectories("\\\\server\\share\\pkg", t.host));
        },
      },
    ],
  },
  {
    id: "import/load-package-dom.cases.ts: SKIP_AND_STAMP_TREES, FAILURE_TREES",
    test: "import/load-package-dom.test.ts",
    rows: Object.keys(SKIP_AND_STAMP_TREES).length + Object.keys(FAILURE_TREES).length,
    cases: [
      ...Object.entries(SKIP_AND_STAMP_TREES).map(
        ([name, files]): MatrixCase => ({
          name: `skipped files and stamps: ${name}`,
          run: (t) => {
            t.tree(files);
            t.step("load", () => {
              const log: string[] = [];
              const result = loadPackage(t.root, { writeLine: (text) => log.push(text) }, { environment: t.host });
              return { log, files: result.files, items: getItemsFromPackageDom(result.document).map((doc) => outerXml(doc)) };
            });
          },
        }),
      ),
      ...Object.entries(FAILURE_TREES).flatMap(([name, files]) =>
        (["12.0", "14.0.7", "14.35"] as const).map(
          (engine): MatrixCase => ({
            name: `failures: ${name} (${engine})`,
            run: (t) => {
              t.tree(files);
              t.step("load", () => loaded(t, t.root, engine));
            },
          }),
        ),
      ),
      {
        name: "failures: names the package folder when it cannot be listed",
        run: (t) => {
          t.step("load", () => loaded(t, t.abs("nope"), "14.0.7"));
          t.put("afile.xml", "<AML/>");
          t.step("load a file", () => loaded(t, t.abs("afile.xml"), "14.0.7"));
        },
      },
    ],
  },
  {
    id: "import/load-package-dom.cases.ts: ODD_FILE_FIXTURES (fixtures/14.0.7/import/<name>/step-1/input)",
    test: "import/transcripts.test.ts, the import replays",
    rows: ODD_FILE_FIXTURES.length,
    cases: ODD_FILE_FIXTURES.map(
      (fixture): MatrixCase => ({
        name: fixture,
        run: (t) => {
          const input = new URL(`../../fixtures/14.0.7/import/${fixture}/step-1/input/`, import.meta.url).pathname;
          const copy = (from: string, to: string): void => {
            for (const entry of readdirSync(from, { withFileTypes: true })) {
              if (entry.isDirectory()) {
                t.mkdirp(`${to}/${entry.name}`);
                copy(join(from, entry.name), `${to}/${entry.name}`);
              } else t.put(`${to}/${entry.name}`, readFileSync(join(from, entry.name)));
            }
          };
          t.mkdirp("input");
          copy(input, "input");
          const packageFolder = readdirSync(input).find((name) => statSync(join(input, name)).isDirectory()) as string;
          for (const engine of ["12.0", "14.0.7", "14.35"] as const) t.step(`load as ${engine}`, () => loaded(t, t.abs(`input/${packageFolder}/Import`), engine));
        },
      }),
    ),
  },
];

// ---- export/export-folders

const exportTables: MatrixTable[] = REPLAYED_ENGINES.map((engine): MatrixTable => {
  const names = exportFolderCaseNames(engine);
  return {
    id: `export/export-folders.cases.ts: exportFolderCaseNames("${engine}") (cases with a removal mode, ${REMOVAL_MODES.join(" and ")}, are left to run-replay.test.ts)`,
    test: "export/export-folders.test.ts",
    rows: names.length,
    cases: names.map(
      (name): MatrixCase => ({
        name,
        run: async (t) => {
          const environment: PathEnvironment = { cwd: t.root, fs: t.fs };
          let failure: Outcome | undefined;
          try {
            await replayCase(
              name,
              {
                environment,
                beginPackage: (packageName, helper) => {
                  helper.folder = createOutputDir(t.root, packageName, environment, engine);
                },
                exportItem: async (exporter, item, level) => {
                  await exporter.export(item, level);
                  return undefined;
                },
              },
              engine,
            );
          } catch (thrown) {
            failure = observe(() => {
              throw thrown;
            });
          }
          t.step("the run", () => failure ?? "completed");
        },
      }),
    ),
  };
});

// ------------------------------------------------------------------------------------------------------------- the matrix

const TABLES: MatrixTable[] = [windowsFoldTable, ...windowsNameTables, windowsScenarios, beyondDiskLimit, hostPathScenarios, ...hostPathTables, ...languagePackTables, ...loadTables, ...exportTables];

const diskFixture: HostFsFactory = (): HostFsFixture => {
  const root = mkdtempSync(join(tmpdir(), "libsjs-matrix-probe-"));
  return { fs: nodeFs, root, symlink: (target, path) => symlinkSync(target, path), dispose: () => rmSync(root, { recursive: true, force: true }) };
};
const memoryFixture: HostFsFactory = (): HostFsFixture => {
  const fs = new MemoryVfs();
  fs.mkdir("/work");
  return { fs, root: "/work" };
};

/** Whether a folder keeps a name with a lone surrogate as it was given: a disk stores UTF-8, which has no such code point. */
function keepsLoneSurrogates(makeFs: HostFsFactory): boolean {
  const fixture = makeFs();
  try {
    const name = "\ud800lone.xml";
    fixture.fs.writeFile(`${fixture.root}/${name}`, new Uint8Array(0));
    return fixture.fs.readdir(fixture.root).some((entry) => entry.name === name);
  } catch {
    return false;
  } finally {
    fixture.dispose?.();
  }
}

/** Whether a name of 300 characters can be written: a disk stops at 255 bytes, `ENAMETOOLONG`, where the tree has no limit (HOST-215). */
function acceptsLongNames(makeFs: HostFsFactory): boolean {
  const fixture = makeFs();
  try {
    fixture.fs.writeFile(`${fixture.root}/${"n".repeat(300)}`, new Uint8Array(0));
    return true;
  } catch {
    return false;
  } finally {
    fixture.dispose?.();
  }
}

const capabilities = (makeFs: HostFsFactory): Record<Needs, boolean> => ({
  ...probeCapabilities(makeFs),
  wellFormedNames: keepsLoneSurrogates(makeFs),
  unboundedNames: acceptsLongNames(makeFs),
});
const onDisk = capabilities(diskFixture);
const inMemory = capabilities(memoryFixture);

/** Why a case is not run on this host, or undefined when it is. */
function skipReason(matrixCase: MatrixCase): string | undefined {
  if (matrixCase.skip !== undefined) return matrixCase.skip;
  const needs = matrixCase.needs;
  if (needs === undefined || (onDisk[needs] && inMemory[needs])) return undefined;
  return `capability "${needs}" (disk ${onDisk[needs] ? "has" : "lacks"} it, tree ${inMemory[needs] ? "has" : "lacks"} it)`;
}

const skipped: Array<{ table: string; name: string; reason: string }> = [];
let ran = 0;

describe.skipIf(process.platform === "win32")("HOST-217: the file layer gives the same answer on nodeFs and on MemoryVfs", () => {
  afterAll(() => {
    const lines = TABLES.map((table) => `  ${table.id}: ${table.rows} rows, ${table.cases.length} cases, ${table.cases.filter((c) => skipReason(c) !== undefined).length} skipped`);
    console.info(`fs-matrix: ${ran} cases ran on both file systems\n${lines.join("\n")}\n${skipped.map((s) => `  skipped [${s.table}] ${s.name}: ${s.reason}`).join("\n")}`);
  });

  for (const table of TABLES) {
    describe(`${table.id} (${table.rows} rows, ${table.cases.length} cases)`, () => {
      for (const matrixCase of table.cases) {
        const reason = skipReason(matrixCase);
        if (reason !== undefined) skipped.push({ table: table.id, name: matrixCase.name, reason });
        it.skipIf(reason !== undefined)(matrixCase.name, async () => {
          const { disk, memory } = await bothWays(matrixCase);
          ran += 1;
          expect(disk.steps.length, "the case recorded at least one step").toBeGreaterThan(0);
          expect(memory).toEqual(disk);
        });
      }
    });
  }

  describe("the matrix", () => {
    it("has the tables, each of a size", () => {
      expect(TABLES.length).toBeGreaterThanOrEqual(18);
      expect(FOLD_CASES.length).toBeGreaterThanOrEqual(12);
      expect(LOAD_CASES.length + EXTRA_LOAD_CASES.length).toBe(55);
      for (const engine of REPLAYED_ENGINES) expect(exportFolderCaseNames(engine).length, engine).toBeGreaterThan(70);
      for (const table of TABLES) expect(table.cases.length, table.id).toBeGreaterThan(0);
    });

    it("skips only for a stated capability or a case that needs Windows", () => {
      for (const entry of skipped) expect(entry.reason, `${entry.table}: ${entry.name}`).toMatch(/^capability "|^needs Windows/);
    });

    it("notices a file system that answers differently", async () => {
      // a tree that reads every file back with its first byte changed: a case that reads or lists a file must show it, so a pass above
      // means the two runs are equal and not that the comparison is blind
      class CorruptingVfs extends MemoryVfs {
        override readFile(path: string): Uint8Array {
          const bytes = super.readFile(path);
          if (bytes.length > 0) bytes[0] = (bytes[0] as number) ^ 1;
          return bytes;
        }
      }
      const corrupting = (root: string): Sandbox => {
        const fs = new CorruptingVfs(undefined, { cwd: processCwd });
        fs.mount({ [`${root}/`]: "" });
        return { fs, root, dispose: () => undefined };
      };
      const first = windowsFoldTable.cases.find((c) => c.name.startsWith("keeps the spelling")) as MatrixCase;
      const { disk, memory } = await bothWays(first, corrupting);
      expect(memory).not.toEqual(disk);
    });
  });
});
