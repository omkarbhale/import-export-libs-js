import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { StepOutcome } from "./import-cases.js";

/**
 * The language-pack import cases (`lpimport`) as code. Ticket 45 recorded five on 14.0.7 against two scratch `Forum`
 * items and the `de` and `fr` Languages it added to dev; ticket 75 records the same packs on 14.35 and adds the
 * language selection of 14.35 (`Languages` set to `de` or `*`) and the package name with a dot that the constructor's
 * scan rejects. The packs are built here, byte for byte as the 14.0.7 fixtures hold them.
 *
 * The dev state these cases need is not made by the recorder (the oracle has no way to add a `Language`): it is
 * `fixtures/14.0.7/language-pack/setup.aml`, applied by hand, and `teardown.aml` after the last run.
 */

/** The two scratch Forums the packs translate: ids and keyed names as in `setup.aml`. */
export const FORUMS = [
  { id: "11B5C0DE00000000000000000000D001", keyedName: "LIBSJS-SCRATCH-LP-Forum", en: "LIBSJS scratch forum" },
  { id: "11B5C0DE00000000000000000000D002", keyedName: "LIBSJS-SCRATCH-LP-Forum2", en: "LIBSJS scratch forum two" },
] as const;

export const LP_PACKAGE = "LIBSJS-SCRATCH-LP";

export interface LpCase {
  /** The folder under fixtures/14.35/language-pack/. */
  id: string;
  title: string;
  /** The `list` of the pack's `languages` element (`ImportConfig.xml`). */
  languagesList: string;
  /** 14.35: the `Languages` selection of the context (ConsoleUpgrade's `langs`). */
  languages?: string[];
  /** The `--lp-package` name; the temp package is named by it. */
  lpPackage?: string;
  lpDebug?: true;
  /** The tag the labels carry, to tell the runs apart on the server. */
  tag: string;
  expect: StepOutcome;
  /** What the case pins. */
  exercises: string;
  rules: string[];
}

export const LP_CASES: LpCase[] = [
  {
    id: "lp01",
    title: "no language list: every server language but `en`",
    languagesList: "",
    tag: "lp01",
    expect: "success",
    exercises:
      "An empty `languages list` asks for every language the server has but `en`. 14.35 scans the generated package in its constructor (IMP-640) and imports it; `Languages` is not set, so nothing is deleted.",
    rules: ["LP-011", "LP-014", "LP-024", "IMP-610", "IMP-640"],
  },
  {
    id: "lp02",
    title: "`languages list=\"de\"`",
    languagesList: "de",
    tag: "lp02",
    expect: "success",
    exercises: "Only `de` is requested: the generated `edit` items carry the `de` labels only.",
    rules: ["LP-011", "LP-014", "LP-024"],
  },
  {
    id: "lp03",
    title: "`languages list=\"de, fr\"`, and a property the `label` list drops",
    languagesList: "de, fr",
    tag: "lp03",
    expect: "success",
    exercises: "Both languages are generated (each part is trimmed). The `name` property in the pack is dropped by the `label` property list.",
    rules: ["LP-011", "LP-013", "LP-023"],
  },
  {
    id: "lp04",
    title: "`--lp-debug`: the temp package is kept",
    languagesList: "",
    tag: "lp04",
    lpDebug: true,
    expect: "success",
    exercises: "The same import as lp01 with `LPDebug`: the preprocessor keeps its temp package, which the host copies off the Windows temp folder into `temp-package/`.",
    rules: ["LP-030", "LP-031", "LP-032", "LP-034"],
  },
  {
    id: "lp05",
    title: "`languages list=\"xx\"`: no language qualifies, empty import",
    languagesList: "xx",
    tag: "lp05",
    expect: "success",
    exercises: "Nothing qualifies, so no row produces a translation and no Fixes file is written; the import runs on an empty package and succeeds. The `Language` get is still sent.",
    rules: ["LP-011", "LP-014", "LP-026"],
  },
  {
    id: "lp06",
    title: "`Languages` = `de` over a pack that translates `de` and `fr`",
    languagesList: "de, fr",
    languages: ["de"],
    tag: "lp06",
    expect: "success",
    exercises:
      "ConsoleUpgrade's `langs=de` (accepted for `lpimport` without `en`): the skip set is `fr`, so every generated `edit` item is sent without its `fr` elements (IMP-640).",
    rules: ["IMP-601", "IMP-630", "IMP-631", "IMP-640"],
  },
  {
    id: "lp07",
    title: "`Languages` = `*` over a pack that translates `de` and `fr`",
    languagesList: "de, fr",
    languages: ["*"],
    tag: "lp07",
    expect: "success",
    exercises: "`*` expands to the languages the generated package uses, `de` and `fr` (never `en`, which the preprocessor leaves out); both are installed, so nothing is deleted.",
    rules: ["IMP-620", "IMP-621", "IMP-640"],
  },
  {
    id: "lp08",
    title: "a package name with a dot",
    languagesList: "de",
    lpPackage: "LIBSJS-SCRATCH-LP.Dot",
    tag: "lp08",
    expect: "refused",
    exercises:
      "The preprocessor writes its fixes where LP-033 says, the manifest points elsewhere, and the folder the 14.35 scan lists does not exist: `DirectoryNotFoundException` ends the constructor, so the run ends with an exception and no return code (14.0.7 failed later, inside the import).",
    rules: ["LP-033", "IMP-612", "IMP-640"],
  },
];

/** `ImportConfig.xml` of a case. */
export function configXml(c: Pick<LpCase, "languagesList">): string {
  return `<import>\n  <languages list="${c.languagesList}" />\n  <itemtype name="Forum">\n    <properties list="label" />\n  </itemtype>\n</import>\n`;
}

/** `xml/Forum.xml` of a case: the two scratch Forums, `label` in `en`, `de` and `fr`, and a `name` with only `en` and `de` on the first. */
export function forumXml(c: Pick<LpCase, "tag">): string {
  const [a, b] = FORUMS;
  return [
    "<export>",
    `  <Item type="Forum" id="${a.id}" keyed_name="${a.keyedName}">`,
    `    <property __name="label" en="${a.en}" de="LIBSJS Test-Forum (${c.tag})" fr="Forum de test LIBSJS (${c.tag})" />`,
    `    <property __name="name" en="${a.keyedName}" de="${a.keyedName}-de" />`,
    "  </Item>",
    `  <Item type="Forum" id="${b.id}" keyed_name="${b.keyedName}">`,
    `    <property __name="label" en="${b.en}" de="LIBSJS Test-Forum zwei (${c.tag})" fr="Forum de test LIBSJS deux (${c.tag})" />`,
    "  </Item>",
    "</export>",
    "",
  ].join("\n");
}

/** Writes a case's language pack folder: `ImportConfig.xml` and `xml/Forum.xml`. */
export function writePack(dir: string, c: LpCase): void {
  for (const [file, text] of [
    ["ImportConfig.xml", configXml(c)],
    ["xml/Forum.xml", forumXml(c)],
  ] as const) {
    const target = join(dir, ...file.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}
