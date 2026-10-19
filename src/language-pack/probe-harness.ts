import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { CItemHelper } from "../client/item-helper.js";
import { ManifestFile } from "../manifest/index.js";
import { dotNetTypeName } from "./exception-text.js";
import { LanguagePackPreprocessor } from "./preprocessor.js";

/**
 * Replays the probes of `fixtures/language-pack/14.0.7/probes/` (`*.ps1`), which ran the real 14.0.7 `LanguagePackPreprocessor` over
 * language-pack folders against a fake IOM connection, through the port. A {@link ProbeCase} is one `RunLP` call of the scripts; its
 * lines are what the script printed, in the script's `Esc` form, and the test compares them with the recorded `.out`. For the
 * tests only.
 */

export const PROBES = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/language-pack/14.0.7/probes");

/** The `Esc` function of the probes: a quoted string with `\`, `"`, CR, LF and tab escaped and every other control or non-ASCII character as `\uXXXX`. */
export function esc(text: string | null): string {
  if (text === null) return "null";
  let out = '"';
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    const c = text.charAt(i);
    if (c === "\\") out += "\\\\";
    else if (c === '"') out += '\\"';
    else if (unit === 13) out += "\\r";
    else if (unit === 10) out += "\\n";
    else if (unit === 9) out += "\\t";
    else if (unit < 32 || unit > 126) out += `\\u${unit.toString(16).toUpperCase().padStart(4, "0")}`;
    else out += c;
  }
  return `${out}"`;
}

/** The sections of a probe output: the lines after each `## label`, up to the next heading. */
export function sections(file: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of readFileSync(join(PROBES, file), "utf8").split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      current = [];
      result.set(line.slice(3), current);
    } else if (line.startsWith("#### ")) {
      current = undefined;
    } else if (current !== undefined && line !== "") {
      current.push(line);
    }
  }
  return result;
}

const NS = "http://schemas.xmlsoap.org/soap/envelope/";

export const envelope = (inner: string): string =>
  `<SOAP-ENV:Envelope xmlns:SOAP-ENV="${NS}"><SOAP-ENV:Body>${inner}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;

/** `LangResponse`: the `Language` answer for `[code, suffix]` pairs, a null code or suffix leaving the element out. */
export function langResponse(languages: readonly (readonly [string | null, string | null])[]): string {
  let items = "";
  for (const [code, suffix] of languages) {
    items += `<Item type="Language" id="X${items.length}">`;
    if (code !== null) items += `<code>${code}</code>`;
    if (suffix !== null) items += `<suffix>${suffix}</suffix>`;
    items += "</Item>";
  }
  return envelope(`<Result>${items}</Result>`);
}

export const faultResponse = (code: string, text: string): string =>
  envelope(`<SOAP-ENV:Fault xmlns:af="http://www.aras.com/InnovatorFault"><faultcode>${code}</faultcode><faultstring>${text}</faultstring></SOAP-ENV:Fault>`);

export const DEFAULT_LANGUAGES = langResponse([
  ["en", ""],
  ["de", "_de"],
  ["fr", "_fr"],
]);

/** `Cfg`: the configuration file of the probes. */
export function cfg(languages: string, itemTypes: readonly string[]): string {
  return `<ImportConfig>${languages === "" ? "" : `<languages list="${languages}"/>`}${itemTypes.join("")}</ImportConfig>`;
}

export interface ProbeCase {
  label: string;
  /** The files of the case folder, by relative path with `\` separators. */
  files: Record<string, string>;
  /** The configuration file inside the case folder; the default is `ImportConfig.xml`. */
  configName?: string;
  /** Replaces the path the preprocessor is given (the probes' `path-*` cases). */
  configPath?: (caseFolder: string) => string | null;
  response?: string;
  pkg?: string | null;
  debug?: boolean;
  /** `-Full`: the manifest path, the package names, every request, the folders and the manifest in the listing. */
  full?: boolean;
}

class FakeConnection implements ServerConnection {
  readonly requests: string[] = [];

  constructor(private response: string) {}

  async callAction(action: string, request: string): Promise<ResponseDocument> {
    this.requests.push(`${action} ${request}`);
    return ResponseDocument.parse(this.response);
  }
}

function listing(base: string): string[] {
  const entries: { relative: string; directory: boolean }[] = [];
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder)) {
      const full = join(folder, name);
      const directory = statSync(full).isDirectory();
      entries.push({ relative: relative(base, full).split(sep).join("\\"), directory });
      if (directory) walk(full);
    }
  };
  walk(base);
  return entries
    .sort((a, b) => (a.relative.toLowerCase() < b.relative.toLowerCase() ? -1 : a.relative.toLowerCase() > b.relative.toLowerCase() ? 1 : 0))
    .map((entry) => `${entry.directory ? "dir " : "file"} ${entry.relative}`);
}

/** Runs the case in a folder of its own and returns the lines the probe printed. */
export async function runProbeCase(probe: ProbeCase): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), "libsjs-lp-"));
  try {
    const caseFolder = join(root, "cases", probe.label.replace(/[^A-Za-z0-9_.-]/g, "_"));
    const tempRoot = join(root, "tmp");
    mkdirSync(tempRoot, { recursive: true });
    mkdirSync(caseFolder, { recursive: true });
    for (const [name, text] of Object.entries(probe.files)) {
      const path = join(caseFolder, ...name.split("\\"));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, "utf8");
    }
    const configPath = probe.configPath ? probe.configPath(caseFolder) : join(caseFolder, probe.configName ?? "ImportConfig.xml");
    const connection = new FakeConnection(probe.response ?? DEFAULT_LANGUAGES);
    const helper = new CItemHelper(connection);
    const manifest = new ManifestFile(undefined, { engine: "14.0.7" });
    const scrub = (text: string): string => {
      let out = text.split(`${tempRoot}/`).join("%TEMP%\\\\").split(`${tempRoot.replace(/\//g, "\\")}\\`).join("%TEMP%\\\\").split(`${tempRoot}\\`).join("%TEMP%\\\\");
      out = out.replace(/LanguagePack_[a-z0-9]{8}\.[a-z0-9]{3}/g, "LanguagePack_<random>");
      out = out.split(caseFolder).join("%CASE%");
      return out.replace(/%CASE%[^"']*/g, (path) => path.replace(/\//g, "\\\\"));
    };
    const lines: string[] = [];
    const say = (label: string, text: string): number => lines.push(`${label} => ${text}`);
    const before = new Set(readdirSync(tempRoot));
    const created = (): string[] => readdirSync(tempRoot).filter((name) => !before.has(name));

    let preprocessor: LanguagePackPreprocessor | undefined;
    try {
      preprocessor = await LanguagePackPreprocessor.create(helper, manifest, configPath, probe.pkg === undefined ? "PKG" : probe.pkg, probe.debug === true, {
        tempPath: `${tempRoot}/`,
        randomFileName: () => "abcdefgh.xyz",
      });
      say("ctor", "ok");
      if (probe.full) {
        say("TempManifestFilePath", scrub(esc(preprocessor.tempManifestFilePath)));
        say("TempPackagesNames", scrub(preprocessor.tempPackagesNames.map(esc).join(", ")));
      }
    } catch (error) {
      say("ctor", scrub(`${dotNetTypeName(error)}: ${esc((error as Error).message)}`));
    }
    const standard = 'ApplyItem <Item isNew="1" isTemp="1" type="Language" action="get" select="code,suffix" />';
    for (const request of connection.requests) if (probe.full || request !== standard) say("request", scrub(esc(request)));
    const folders = created();
    say("temp dirs created", String(folders.length));
    for (const folder of folders) {
      const base = join(tempRoot, folder);
      for (const entry of listing(base)) {
        const kind = entry.slice(0, 4).trim();
        const name = entry.slice(5);
        if (kind === "dir") {
          if (probe.full) say(`  dir  ${esc(name)}`, "");
        } else if (name === "imports.mf" && !probe.full) {
          // the probes leave the manifest out of the listing unless -Full
        } else {
          const text = readFileSync(join(base, ...name.split("\\")), "utf8");
          say(`  file ${esc(name)}`, scrub(esc(text)));
        }
      }
    }
    if (preprocessor) {
      try {
        preprocessor.dispose();
        say("Dispose", "ok");
      } catch (error) {
        say("Dispose", `${dotNetTypeName(error)}: ${esc((error as Error).message)}`);
      }
      say("temp dirs after Dispose", String(created().length));
    }
    return lines;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
