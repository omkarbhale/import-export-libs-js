import { FakeTransport, bodyText, devServer, header, respond, soapResult } from "../client/fake-transport.js";
import type { TransportRequest } from "../client/transport.js";
import {
  SYNTH_PACKAGE,
  type SynthItemInfo,
  type SynthKind,
  type SynthSpec,
  type SynthTemplates,
  synthId,
  synthItemInfo,
  synthItemText,
} from "./synth-package.js";

/**
 * The servers that the size budget runs the engine against (HOST-278): a replay-style connection that answers success for every
 * request. The engine is what is exercised; the server holds nothing but what it needs to say yes. One answers an import: every item is
 * new and every add succeeds. The other answers an export of a synthetic package: it lists the package's items and gives each as the
 * item file made for it, with the system properties of a real answer.
 *
 * @spec HOST-278
 */

const ENVELOPE = (inner: string): string =>
  `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body>${inner}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;

/** The answer to a `get` that finds nothing, as the server words it. */
function notFound(type: string, body: string): ReturnType<typeof respond> {
  return respond(
    ENVELOPE(
      `<SOAP-ENV:Fault xmlns:af="http://www.aras.com/InnovatorFault"><faultcode>0</faultcode><faultstring><![CDATA[No items of type ${type} found.]]></faultstring>` +
        `<detail><af:legacy_detail><![CDATA[No items of type ${type} found.]]></af:legacy_detail><af:legacy_faultstring><![CDATA[No items of type '${type}' found using the criteria: \n${body}\n]]></af:legacy_faultstring></detail></SOAP-ENV:Fault>`,
    ),
  );
}

/** The login, version and user answers of every server here: the versions of the engine's default build, 14.0.7 (35492). */
const VARIABLES = { VersionMajor: "14", VersionMinor: "0", VersionServicePack: "SP7", VersionBuild: "35492", VersionServiceUpdate: "0" };

interface Head {
  type: string;
  action: string;
  attributes: string;
}

/** The type and action of the first item of a request body. */
function headOf(body: string): Head {
  const tag = /<Item\b([^>]*)>/.exec(body)?.[1] ?? "";
  return {
    type: /\btype="([^"]*)"/.exec(tag)?.[1] ?? "",
    action: /\baction="([^"]*)"/.exec(tag)?.[1] ?? "",
    attributes: tag,
  };
}

/** The relationship types of the types of the synthetic items. */
const RELATIONSHIPS: Readonly<Record<string, readonly string[]>> = { List: ["Value"], Form: ["Body"], Body: ["Field"] };

const itemTypeId = (name: string): string => synthId(0x17e, [...name].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) >>> 0, 7), 1);

/**
 * The server of an import: everything the engine looks for is absent, so every item is added, and every add, edit and delete is
 * answered with the item it names. The count of the requests is `requests`.
 */
/** A package the database has, so that the first question of an import is answered. */
function existingDefinition(): string {
  const id = synthId(1, 2, 3);
  return `<Item type="PackageDefinition" typeId="${itemTypeId("PackageDefinition")}" id="${id}"><generation>1</generation><id keyed_name="com.example.existing" type="PackageDefinition">${id}</id><name>com.example.existing</name></Item>`;
}

export function synthImportServer(): { transport: FakeTransport; readonly requests: number; readonly adds: number } {
  let added = 0;
  let upgradeId: string | undefined;
  let generated = 0;
  const base = devServer({
    variables: VARIABLES,
    override: (request: TransportRequest) => {
      if (header(request, "SOAPAction") !== "ApplyItem") return undefined;
      const body = bodyText(request);
      const { type, action, attributes } = headOf(body);
      if (type === "User") return undefined;
      if (action === "get") {
        // the engine asks first for the packages the database already has, and wants at least one
        if (type === "PackageDefinition" && attributes.includes('select="name,generation"')) return respond(ENVELOPE(`<Result>${existingDefinition()}</Result>`));
        if (type === "ItemType") {
          const name = /<name>([^<]*)<\/name>/.exec(body)?.[1] ?? "";
          const id = itemTypeId(name);
          const typeId = itemTypeId("ItemType");
          if (attributes.includes('language="')) {
            return respond(
              ENVELOPE(
                `<Result><Item type="ItemType" typeId="${typeId}" id="${id}"><id keyed_name="${name}" type="ItemType">${id}</id><label xml:lang="en">${name}</label></Item></Result>`,
              ),
            );
          }
          const versionable = attributes.includes('select="is_versionable"') ? "<is_versionable>0</is_versionable>" : "";
          // the definition of a type names the relationship types it has, which the engine checks every relationship of an item against
          const relationships = (RELATIONSHIPS[name] ?? [])
            .map((related) => `<Item type="RelationshipType" typeId="${itemTypeId("RelationshipType")}" id="${itemTypeId(`${name}.${related}`)}"><id keyed_name="${related}" type="RelationshipType">${itemTypeId(`${name}.${related}`)}</id><name>${related}</name></Item>`)
            .join("");
          const nested = body.includes("RelationshipType") ? `<Relationships>${relationships}</Relationships>` : "";
          return respond(ENVELOPE(`<Result><Item type="ItemType" typeId="${typeId}" id="${id}"><id keyed_name="${name}" type="ItemType">${id}</id>${versionable}${nested}</Item></Result>`));
        }
        if (type === "DatabaseUpgrade" && upgradeId !== undefined && !attributes.includes('levels="0"')) {
          return respond(ENVELOPE(`<Result><Item type="DatabaseUpgrade" typeId="${itemTypeId("DatabaseUpgrade")}" id="${upgradeId}"><id keyed_name="x" type="DatabaseUpgrade">${upgradeId}</id></Item></Result>`));
        }
        if (type === "DatabaseUpgrade" && upgradeId !== undefined) {
          return respond(ENVELOPE(`<Result><Item type="DatabaseUpgrade" typeId="${itemTypeId("DatabaseUpgrade")}" id="${upgradeId}"><id keyed_name="${upgradeId}" type="DatabaseUpgrade">${upgradeId}</id><locked_by_id is_null="1" /></Item></Result>`));
        }
        return notFound(type, body.trim());
      }
      // an add, an edit, a merge, a delete: the item as the request names it
      const id = /\bid="([0-9A-Fa-f]{32})"/.exec(attributes)?.[1] ?? synthId(0x5eed, (generated += 1), 3);
      if (type === "DatabaseUpgrade" && action === "add") upgradeId = id;
      if (action === "add") added += 1;
      if (type === "PackageDefinition" && action === "add") {
        const name = /<name>([^<]*)<\/name>/.exec(body)?.[1] ?? "";
        return respond(ENVELOPE(`<Result><Item type="PackageDefinition" typeId="${itemTypeId("PackageDefinition")}" id="${id}"><id keyed_name="${name}" type="PackageDefinition">${id}</id><name>${name}</name></Item></Result>`));
      }
      return respond(ENVELOPE(`<Result><Item type="${type}" id="${id}" /></Result>`));
    },
  });
  const transport = new FakeTransport(base);
  return {
    transport,
    get requests() {
      return transport.requests.length;
    },
    get adds() {
      return added;
    },
  };
}

// ----------------------------------------------------------------------------------------------------------------------- export

/** The system properties a real server adds to an item, which the export drops. */
function systemProperties(type: string, id: string, keyed: string): string {
  const user = `<created_by_id keyed_name="Super User" type="User">AD30A6D8D3B642F5A2AFED1A4B02BEFA</created_by_id>`;
  return (
    `<config_id keyed_name="${keyed}" type="${type}">${id}</config_id>${user}<created_on>2020-07-24T12:52:22</created_on><generation>1</generation>` +
    `<id keyed_name="${keyed}" type="${type}">${id}</id><is_current>1</is_current><is_released>0</is_released><keyed_name>${keyed}</keyed_name><major_rev>A</major_rev>` +
    `<modified_by_id keyed_name="Super User" type="User">AD30A6D8D3B642F5A2AFED1A4B02BEFA</modified_by_id><modified_on>2020-07-24T12:52:22</modified_on><new_version>1</new_version><not_lockable>0</not_lockable>`
  );
}

/**
 * An item file as the server gives the item: the same item with its `add` taken off and the system properties put in. A `get` of
 * the engine's export answers with this, and the export writes back the file it started from.
 */
export function serverForm(kind: SynthKind, info: SynthItemInfo, fileText: string): string {
  const typeId = itemTypeId(kind);
  const text = fileText
    .replace(/^﻿/, "")
    .replace(/^<AML>\r?\n/, "")
    .replace(/\r?\n<\/AML>\s*$/, "")
    .replace(/ action="add"/g, "");
  return text.replace(/^(\s*<Item type="[^"]*")/, `$1 typeId="${typeId}"`).replace(/(<Item type="[^"]*" typeId="[^"]*" id="[0-9A-F]{32}">)/, `$1${systemProperties(kind, info.id, info.name)}`);
}

/** The export's view of a synthetic package: its items, in the order the package lists them. */
export interface SynthExport {
  transport: FakeTransport;
  /** The package's name on the server. */
  readonly packageName: string;
  readonly requests: number;
  /** The number of items the engine asked for. */
  readonly itemsServed: number;
  /** Makes the one large answer (the package's elements) now, so that the run does not spend its first request on it. */
  prepare(): void;
}

/**
 * The server of an export of the first `count` items of a synthetic package. It answers the package listing with every item as a
 * package element, each `get` of an item with the item, and the engine's other questions (the type's versionability, its
 * properties, its permissions) with a bare yes.
 */
export function synthExportServer(spec: SynthSpec, templates: SynthTemplates, count: number): SynthExport {
  const packageId = synthId(spec.seed, 0xfffffff, 9);
  const byId = new Map<string, SynthItemInfo>();
  const infos: SynthItemInfo[] = [];
  for (let index = 0; index < count; index += 1) {
    const info = synthItemInfo(spec, index);
    byId.set(info.id, info);
    infos.push(info);
  }
  // the elements of the package are listed once, when the selection asks: it is the one large answer
  let elements: string | undefined;
  const elementRows = (): string => {
    if (elements !== undefined) return elements;
    const groupId = synthId(spec.seed, 0xffffffe, 8);
    elements = ENVELOPE(
      `<Result>${infos
        .map(
          (info) =>
            `<Item type="PackageElement" typeId="${itemTypeId("PackageElement")}" id="${synthId(spec.seed, info.index, 7)}"><element_id>${info.id}</element_id><element_type>${info.kind}</element_type>` +
            `<id keyed_name="${info.name}" type="PackageElement">${synthId(spec.seed, info.index, 7)}</id><source_id keyed_name="${info.kind}" type="PackageGroup">${groupId}</source_id><name>${info.name}</name></Item>`,
        )
        .join("")}</Result>`,
    );
    return elements;
  };
  const definition = (): string =>
    `<Item type="PackageDefinition" typeId="${itemTypeId("PackageDefinition")}" id="${packageId}"><generation>1</generation><id keyed_name="${SYNTH_PACKAGE}" type="PackageDefinition">${packageId}</id><name>${SYNTH_PACKAGE}</name></Item>`;
  let served = 0;
  const base = devServer({
    variables: VARIABLES,
    override: (request: TransportRequest) => {
      if (header(request, "SOAPAction") !== "ApplyItem") return undefined;
      const body = bodyText(request);
      const { type, action, attributes } = headOf(body);
      if (type === "User") return undefined;
      if (type === "PackageDefinition" && action === "get") return respond(ENVELOPE(`<Result>${definition()}</Result>`));
      if (type === "PackageElement" && action === "get") return respond(elementRows());
      if (type === "PackageDependsOn") {
        return respond(ENVELOPE(`<Result><Item type="PackageDependsOn" typeId="${itemTypeId("PackageDependsOn")}" id="${synthId(1, 1, 1)}"><id keyed_name="x" type="PackageDependsOn">${synthId(1, 1, 1)}</id></Item></Result>`));
      }
      if (type === "ItemType" && action === "get") {
        const name = /<name>([^<]*)<\/name>/.exec(body)?.[1] ?? "";
        const id = itemTypeId(name);
        if (attributes.includes('select="is_versionable"')) {
          return respond(ENVELOPE(`<Result><Item type="ItemType" typeId="${itemTypeId("ItemType")}" id="${id}"><id keyed_name="${name}" type="ItemType">${id}</id><is_versionable>0</is_versionable></Item></Result>`));
        }
        if (attributes.includes('select="id, is_relationship, use_src_access"')) {
          return respond(ENVELOPE(`<Result><Item type="ItemType" typeId="${itemTypeId("ItemType")}" id="${id}"><id keyed_name="${name}" type="ItemType">${id}</id><is_relationship>0</is_relationship><use_src_access>0</use_src_access></Item></Result>`));
        }
        if (attributes.includes('select="name"')) {
          return respond(ENVELOPE(`<Result><Item type="ItemType" typeId="${itemTypeId("ItemType")}" id="${itemTypeId("Base")}"><id keyed_name="Base" type="ItemType">${itemTypeId("Base")}</id><name>Base</name></Item></Result>`));
        }
        return notFound("ItemType", body.trim());
      }
      if (action === "get") {
        const id = /<id>([0-9A-F]{32})<\/id>/.exec(body)?.[1];
        const info = id === undefined ? undefined : byId.get(id);
        if (info === undefined) return notFound(type, body.trim());
        served += 1;
        const { text } = synthItemText(spec, templates, info.index);
        return respond(ENVELOPE(`<Result>${serverForm(info.kind, info, text)}</Result>`));
      }
      return respond(soapResult(""));
    },
  });
  const transport = new FakeTransport(base);
  return {
    transport,
    packageName: SYNTH_PACKAGE,
    get requests() {
      return transport.requests.length;
    },
    get itemsServed() {
      return served;
    },
    prepare: () => void elementRows(),
  };
}

