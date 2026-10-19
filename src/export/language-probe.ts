import { attributeOf, childElements, innerText, parseXml } from "../client/mini-xml.js";
import { stubFault, stubResult } from "../client/stub-connection.js";

/**
 * The scripted answers of the language-export probe (`oracle/language-export-probe/LangStub.cs`) in TypeScript: the Language get, the
 * ml_string lookup, the two tree lookups and the `is_versionable` lookup. The tests compare the port's requests and exceptions with
 * the probe's recording (`fixtures/export-language/probe-14.35.txt`).
 */
export interface LangScript {
  /** Codes the Language get answers, in this order; null answers faultcode 0. */
  languageCodes?: string[] | null;
  /** When set, the Language get answers this fault code. */
  languageFaultCode?: string;
  /** Inner XML for the Language items, in place of the generated one. */
  languageXml?: string;
  /** Type name to the names of its ml_string properties. */
  ml?: Record<string, string[]>;
  /** What a type without ml_string properties gets: `rows` is the server's faultcode 0, `item` an ItemType with no Relationships, `fault1` faultcode 1. */
  mlNoRows?: "rows" | "item" | "fault1";
  /** The ml_string lookup answers this fault code for every type when set. */
  mlFaultCode?: string;
  /** Relationship types of a type, and the data source of its related_id. */
  rels?: Record<string, string[]>;
  related?: Record<string, string>;
}

const ELEMENT = (request: string, pattern: RegExp): RegExpExecArray | null => pattern.exec(request);

/** The answer of `LangConnection.Mine` to a request, or undefined when the script has none (the probe falls back to `ScriptedConnection`). */
export function langResponse(script: LangScript, request: string): string | undefined {
  if (/^<Item [^>]*type="Language"[^>]*action="get"/.test(request)) {
    if (script.languageFaultCode !== undefined) return stubFault(script.languageFaultCode, "scripted Language fault");
    if (script.languageXml !== undefined) return stubResult(script.languageXml);
    if (!script.languageCodes) return stubFault("0", "No items of type Language found.");
    return stubResult(script.languageCodes.map((code) => `<Item type="Language" id="LG-${code}"><code>${code}</code><name>Lang ${code}</name></Item>`).join(""));
  }
  const itemType = ELEMENT(request, /^<Item [^>]*type="ItemType"[^>]*action="get"[^>]*><name>([^<]*)<\/name><Relationships><Item [^>]*type="Property"[^>]*>(.*)<\/Item><\/Relationships><\/Item>$/);
  if (itemType) {
    const name = itemType[1] as string;
    if (itemType[2]?.includes("<data_type>ml_string</data_type>")) {
      if (script.mlFaultCode !== undefined) return stubFault(script.mlFaultCode, "scripted ml lookup fault");
      const names = script.ml?.[name];
      if (names && names.length > 0) {
        const rows = names.map((property) => `<Item type="Property" id="PR-${name}-${property}"><name>${property}</name></Item>`).join("");
        return stubResult(`<Item type="ItemType" id="IT-${name}"><Relationships>${rows}</Relationships></Item>`);
      }
      if (script.mlNoRows === "item") return stubResult(`<Item type="ItemType" id="IT-${name}"></Item>`);
      if (script.mlNoRows === "fault1") return stubFault("1", "scripted failure");
      return stubFault("0", "No items of type ItemType found.");
    }
    if (itemType[2]?.includes("<name>related_id</name>")) {
      const dataSource = script.related?.[name];
      if (dataSource === undefined) return stubFault("0", "No items of type ItemType found.");
      const xml = dataSource === "" ? "<data_source />" : `<data_source keyed_name="${dataSource}" type="ItemType" name="${dataSource}">DS-${dataSource}</data_source>`;
      return stubResult(`<Item type="ItemType" id="IT-${name}"><Relationships><Item type="Property" id="P-${name}">${xml}</Item></Relationships></Item>`);
    }
  }
  const relationships = ELEMENT(request, /^<Item [^>]*type="RelationshipType"[^>]*><source_id><Item [^>]*type="ItemType"[^>]*><name>([^<]*)<\/name><\/Item><\/source_id><\/Item>$/);
  if (relationships) {
    const names = script.rels?.[relationships[1] as string] ?? [];
    if (names.length === 0) return stubFault("0", "No items of type RelationshipType found.");
    return stubResult(names.map((name) => `<Item type="RelationshipType" id="RT-${name}"><name>${name}</name></Item>`).join(""));
  }
  if (/^<Item type="ItemType" select="is_versionable" action="get">/.test(request)) {
    return stubResult('<Item type="ItemType" id="IT"><is_versionable>0</is_versionable></Item>');
  }
  return undefined;
}

/** The probe's `Esc`: CR, LF and tab as `\r`, `\n`, `\t`, anything else outside 32 to 126 as `\uXXXX`. */
export function escapeProbe(text: string | null): string {
  if (text === null) return "<null>";
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 13) out += "\\r";
    else if (code === 10) out += "\\n";
    else if (code === 9) out += "\\t";
    else if (code < 32 || code > 126) out += `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
    else out += text[i];
  }
  return out;
}

/** The reverse of {@link escapeProbe}, for the text the probe prints. */
export const unescapeProbe = (text: string): string =>
  text.replace(/\\(r|n|t|u[0-9A-F]{4})/g, (_, code: string) =>
    code === "r" ? "\r" : code === "n" ? "\n" : code === "t" ? "\t" : String.fromCharCode(Number.parseInt(code.slice(1), 16)),
  );

/** What the whole-export scenarios (`E`, `X`) of the probe script, on top of {@link LangScript} (`ScriptedConnection` of the export-output probe). */
export interface ExportScript extends LangScript {
  /** Inner XML written into every item answered for an id. */
  itemBody?: string;
  /** Extra inner XML for the item answered for an id. */
  bodyById?: Record<string, string>;
  /** The whole item (the Result's inner XML) answered for an id, for the types the generic answer does not serve (ItemType). */
  mainById?: Record<string, string>;
  /** Inner XML (Item elements with a name) answering the polymorphic ItemType lookup; undefined answers "no items". */
  polyNamesXml?: string;
  /** Inner XML for the getSolutions request; undefined answers "no items". */
  solutionsXml?: string;
}

const attributeOfRoot = (root: ReturnType<typeof parseXml>["root"], name: string): string | undefined => attributeOf(root, name);
const textOfChild = (root: ReturnType<typeof parseXml>["root"], name: string): string | undefined => {
  const child = childElements(root, name)[0];
  return child ? innerText(child) : undefined;
};

/** The probe's `Result()`: its envelope declares `xmlns:i18n`, which the transform copies onto each top-level Item (EXP-401). */
const result = (inner: string): string =>
  `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="http://www.aras.com/I18N"><SOAP-ENV:Body><Result>${inner}</Result></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

/** The answer of the probe's `LangConnection` over `ScriptedConnection` to a request: the language scripts first, then the generic ones. */
export function exportResponse(script: ExportScript, request: string): string {
  const language = langResponse(script, request);
  if (language !== undefined) return language;

  const root = parseXml(request).root;
  const type = attributeOfRoot(root, "type");
  const action = attributeOfRoot(root, "action");
  const select = attributeOfRoot(root, "select");
  const id = textOfChild(root, "id");
  const name = textOfChild(root, "name");

  if (action === "get" && id !== undefined && script.mainById?.[id] !== undefined) return result(script.mainById[id] as string);
  if (type === "PackageDefinition" && select === "name,generation") {
    return script.solutionsXml === undefined ? stubFault("0", "No items of type PackageDefinition found.") : result(script.solutionsXml);
  }
  if (type === "PackageDefinition" && select === "id,name,generation" && name !== undefined) {
    return result(`<Item type="PackageDefinition" id="PD-${name}"><id>PD-${name}</id><name>${name}</name><generation>1</generation></Item>`);
  }
  if (type === "PackageDependsOn") return stubFault("0", "No items of type PackageDependsOn found.");
  if (type === "ItemType" && select === "name" && childElements(root, "implementation_type").length > 0) {
    return script.polyNamesXml === undefined ? stubFault("0", "No items of type ItemType found.") : result(script.polyNamesXml);
  }
  if (type === "ItemType" && select === "id, is_relationship, use_src_access") {
    return result(
      '<Item type="ItemType" id="IT"><is_relationship>0</is_relationship><use_src_access>0</use_src_access><Relationships><Item type="Allowed Permission" id="AP"><related_id><Item type="Permission" id="PERM1"><id>PERM1</id></Item></related_id></Item></Relationships></Item>',
    );
  }
  if (type === "ItemType" && select === "is_versionable") return result('<Item type="ItemType" id="IT"><is_versionable>0</is_versionable></Item>');
  if (type === "ItemType" && childElements(root, "Relationships").length > 0 && select === "id") return stubFault("0", "No items of type ItemType found.");
  if (type === "RelationshipType" && select === "name") return stubFault("0", "No items of type RelationshipType found.");
  if (id !== undefined && action === "get" && type !== "ItemType" && type !== "PackageElement") {
    const body = script.bodyById?.[id] ?? "";
    return result(`<Item type="${type}" id="${id}" keyed_name="k-${id}"><id keyed_name="k-${id}" type="${type}">${id}</id><name>n-${id}</name>${script.itemBody ?? ""}${body}</Item>`);
  }
  return stubFault("0", `No items of type ${type} found.`);
}
