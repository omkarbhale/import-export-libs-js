import { utf8Bytes } from "../io/utf8.js";

/**
 * A synthetic package of a stated size, made from real fixture item files (HOST-277): the generator behind the size budget of the
 * browsers (ticket 31). It is test support: the library never imports it, and nothing of it is a rule of the engine.
 *
 * Every item is made from a recorded item file of an import case (`SYNTH_TEMPLATES`) by repeating and renaming it: a list with a
 * few hundred values, a form with a few hundred fields, a method with a long body, and the small items as they are. The name and
 * every id that the file defines are replaced by ones drawn from the seed and the item's number, so that the ids stay unique and a
 * package is the same bytes on every run; an id that the file only refers to (the World identity of a method) is kept. The only text
 * that is not from a recorded file is the filler lines of a method's body, which a real package has in plenty.
 *
 * The functions here are pure and browser-safe: the Node tool (`tools/synth-package.ts`) writes the package as a zip, and a browser test
 * serves the same items to the engine through a fake server (`synth-server.ts`).
 *
 * @spec HOST-277
 */

/** What a synthetic item is made of. Each kind is a type of the recorded import case `s1-base`. */
export type SynthKind = "List" | "Form" | "Method" | "Variable" | "Sequence" | "UserMessage";

/** The template files, repository-relative, as the fixture commands take them. */
const BASE = "fixtures/14.0.7/import/s1-base/step-1/input";
export const SYNTH_TEMPLATES: Readonly<Record<SynthKind, string>> = {
  List: `${BASE}/LIBSJS-SCRATCH-BASE/Import/List/LIBSJS-SCRATCH-List_1.xml`,
  Form: `${BASE}/LIBSJS-SCRATCH-BASE/Import/Form/LIBSJS-SCRATCH-Form_1.xml`,
  Method: `${BASE}/LIBSJS-SCRATCH-BASE/Import/Method/LIBSJS-SCRATCH-Method_1.xml`,
  Variable: `${BASE}/LIBSJS-SCRATCH-BASE/Import/Variable/LIBSJS-SCRATCH-Var_1.xml`,
  Sequence: `${BASE}/LIBSJS-SCRATCH-BASE/Import/Sequence/LIBSJS-SCRATCH-Seq_1.xml`,
  UserMessage: `${BASE}/LIBSJS-SCRATCH-BASE/Import/UserMessage/LIBSJS-SCRATCH-Msg_1.xml`,
};

/** The recorded item name each template carries, replaced in the copies. */
const TEMPLATE_NAMES: Readonly<Record<SynthKind, string>> = {
  List: "LIBSJS-SCRATCH-List_1",
  Form: "LIBSJS-SCRATCH-Form_1",
  Method: "LIBSJS-SCRATCH-Method_1",
  Variable: "LIBSJS-SCRATCH-Var_1",
  Sequence: "LIBSJS-SCRATCH-Seq_1",
  UserMessage: "LIBSJS-SCRATCH-Msg_1",
};

/** The text of the template files, by kind. A caller reads them from the disk or through the fixture commands. */
export type SynthTemplates = Readonly<Record<SynthKind, string>>;

/** The name of the package, and so the folder it is imported from: scratch by the rule of AGENTS.md. */
export const SYNTH_PACKAGE = "LIBSJS-SCRATCH-SYNTH";

/** The manifest the package has, the one of the recorded case with its package renamed. */
export const SYNTH_MANIFEST = `<imports>\n  <package name="${SYNTH_PACKAGE}" path="${SYNTH_PACKAGE}\\Import" />\n</imports>`;

/** The version of the generator: part of the file name of a written package, so that a change makes new files. */
export const SYNTH_VERSION = 1;

export interface SynthSpec {
  /** The seed of the draws. The same seed and the same templates make the same bytes. */
  seed: number;
}

/** The files of the package are at this path below its root. */
export const synthFilePath = (kind: SynthKind, name: string): string => `${SYNTH_PACKAGE}/Import/${kind}/${name}.xml`;

// -------------------------------------------------------------------------------------------------------------------- draws

/** A 32-bit mix of two integers (murmur3's finalizer over their combination). */
function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32: a generator of numbers in [0, 1) from a 32-bit seed. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The 32 upper-case hexadecimal characters of an id that follows from the seed, the item's number and a counter. */
export function synthId(seed: number, index: number, counter: number): string {
  let id = "";
  for (let part = 0; part < 4; part += 1) id += mix(mix(seed, index), mix(counter, part + 1)).toString(16).toUpperCase().padStart(8, "0");
  return id;
}

/** The mix of the kinds: lists and methods carry most of the bytes, as the long items of a real package do. */
const KIND_WEIGHTS: ReadonlyArray<readonly [SynthKind, number]> = [
  ["List", 30],
  ["Method", 25],
  ["Form", 15],
  ["Variable", 15],
  ["Sequence", 8],
  ["UserMessage", 7],
];

/** What the number of an item decides before any text is made: its kind and its name. It is cheap, so that a server can list a package without making its files. */
export interface SynthItemInfo {
  index: number;
  kind: SynthKind;
  /** The item's name, which is the name of its file. */
  name: string;
  /** The item's id. */
  id: string;
}

export function synthItemInfo(spec: SynthSpec, index: number): SynthItemInfo {
  const draw = generator(mix(spec.seed, index))();
  let at = draw * 100;
  let kind: SynthKind = "Variable";
  for (const [candidate, weight] of KIND_WEIGHTS) {
    kind = candidate;
    if (at < weight) break;
    at -= weight;
  }
  return { index, kind, name: `${SYNTH_PACKAGE}-${kind}-${String(index).padStart(6, "0")}`, id: synthId(spec.seed, index, 0) };
}

// ----------------------------------------------------------------------------------------------------------------------- text

const BOM = "﻿";

/** The ids that a template file defines: those of its `<Item … id="…">` tags, in order of appearance. */
function definedIds(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(/<Item\b[^>]*\bid="([0-9A-F]{32})"/g)) {
    const id = match[1] as string;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** The text with each id it defines replaced by one drawn for item `index`, numbered from `counter`; returns the next counter. One pass over the text. */
function renewIds(text: string, seed: number, index: number, counter: number, keep?: ReadonlyMap<string, string>): { text: string; counter: number } {
  let next = counter;
  const replacements = new Map<string, string>();
  for (const id of definedIds(text)) replacements.set(id, keep?.get(id) ?? synthId(seed, index, (next += 1)));
  return { text: text.replace(/[0-9A-F]{32}/g, (id) => replacements.get(id) ?? id), counter: next };
}

/** The block of text from the line that opens `<Item type="{type}"` to its closing tag at the same indentation, with the lines' breaks; the first in `text`. */
function firstBlock(text: string, type: string): { start: number; end: number; block: string } {
  const open = new RegExp(`^([ \\t]*)<Item type="${type}"`, "m").exec(text);
  if (open === null) throw new Error(`the template has no ${type} item`);
  const indent = open[1] as string;
  const close = new RegExp(`^${indent}</Item>[ \\t]*\\r?\\n`, "m");
  const rest = text.slice(open.index);
  const closing = close.exec(rest);
  if (closing === null) throw new Error(`the ${type} item of the template is not closed`);
  const end = open.index + closing.index + closing[0].length;
  return { start: open.index, end, block: text.slice(open.index, end) };
}

/** The text with the first `type` item repeated `count` times, each with new ids and with `vary(block, n)` applied. */
function repeatBlock(text: string, type: string, count: number, seed: number, index: number, vary: (block: string, n: number) => string): string {
  const { start, end, block } = firstBlock(text, type);
  // the ids of the first copy are the template's, renewed by the item as a whole; the other copies take draws of their own
  let counter = 1_000;
  const copies: string[] = [];
  for (let n = 0; n < count; n += 1) {
    const renewed = renewIds(block, seed, index, counter);
    counter = renewed.counter;
    copies.push(vary(renewed.text, n));
  }
  return text.slice(0, start) + copies.join("") + text.slice(end);
}

/** The filler lines of a method's body: comments of a plausible length, from the item's own draws. */
function fillerLines(rng: () => number, lines: number): string {
  const words = ["revision", "affected", "item", "relationship", "property", "status", "lifecycle", "release", "permission", "workflow", "change", "document", "part", "bom", "report"];
  let body = "";
  for (let n = 0; n < lines; n += 1) {
    const count = 4 + Math.floor(rng() * 9);
    const text: string[] = [];
    for (let w = 0; w < count; w += 1) text.push(words[Math.floor(rng() * words.length)] as string);
    body += `// ${text.join(" ")} ${Math.floor(rng() * 100000)}\r\n`;
  }
  return body;
}

/** A whole number from 1 to `max`, log-uniform: most items are small and a few are large, as in a real package. */
const spread = (rng: () => number, max: number): number => Math.max(1, Math.floor(Math.exp(rng() * Math.log(max))));

/** The text of item `index`, as an item file of the package: the template with the name and ids of the item, scaled by its draws. */
export function synthItemText(spec: SynthSpec, templates: SynthTemplates, index: number): { info: SynthItemInfo; text: string } {
  const info = synthItemInfo(spec, index);
  const rng = generator(mix(spec.seed, index ^ 0x5bd1e995));
  rng();
  let text = (templates[info.kind].startsWith(BOM) ? templates[info.kind].slice(1) : templates[info.kind]);
  const keepTop = new Map([[definedIds(text)[0] as string, info.id]]);
  switch (info.kind) {
    case "List": {
      const count = spread(rng, 600);
      text = repeatBlock(text, "Value", count, spec.seed, info.index, (block, n) =>
        block
          .replace(/(<label xml:lang="en">)[^<]*(<\/label>)/, `$1Value ${n + 1}$2`)
          .replace(/(<sort_order>)\d+(<\/sort_order>)/, `$1${128 * (n + 1)}$2`)
          .replace(/(<value>)[^<]*(<\/value>)/, `$1value-${n + 1}$2`),
      );
      break;
    }
    case "Form": {
      const count = spread(rng, 150);
      text = repeatBlock(text, "Field", count, spec.seed, info.index, (block, n) =>
        block
          .replace(/(<label xml:lang="en">)[^<]*(<\/label>)/, `$1Field ${n + 1}$2`)
          .replace(/(<sort_order>)\d+(<\/sort_order>)/, `$1${128 * (n + 1)}$2`)
          .replace(/(<y>)\d+(<\/y>)/, `$1${20 * n}$2`)
          .replace(/(<name>)[^<]*(<\/name>)/, `$1field_${n + 1}$2`),
      );
      break;
    }
    case "Method": {
      const lines = spread(rng, 1500);
      text = text.replace("<![CDATA[return this;]]>", `<![CDATA[${fillerLines(rng, lines)}return this;]]>`);
      break;
    }
    default:
      break;
  }
  // the item's own name and the ids it defines. The first id, the item's, is the one `synthItemInfo` gives; the ids that scaling made are of the item's draws.
  const renewed = renewIds(text, spec.seed, info.index, 0, keepTop);
  text = renewed.text.split(TEMPLATE_NAMES[info.kind]).join(info.name);
  return { info, text: BOM + text };
}

/** The bytes of the manifest of the package. */
export const synthManifestBytes = (): Uint8Array => utf8Bytes(SYNTH_MANIFEST);

/**
 * The items of a package of at least `targetBytes` of item files: item 0, 1, 2 … until their files hold that many bytes. Yields each
 * item's file; the caller writes it and lets it go, so that a package of 500 MB is never in memory whole here.
 */
export function* synthItems(spec: SynthSpec, templates: SynthTemplates, targetBytes: number): Generator<{ info: SynthItemInfo; path: string; bytes: Uint8Array }> {
  let total = 0;
  for (let index = 0; total < targetBytes; index += 1) {
    const { info, text } = synthItemText(spec, templates, index);
    const bytes = utf8Bytes(text);
    total += bytes.byteLength;
    yield { info, path: synthFilePath(info.kind, info.name), bytes };
  }
}
