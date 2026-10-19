import { createHash } from "node:crypto";
import { bodyText, header, respond, soapFault, soapResult, type FakeHandler } from "../client/fake-transport.js";
import { attributeOf, childElements, documentOuterXml, innerText, parseXml, type XmlElement } from "../client/mini-xml.js";
import type { TransportRequest } from "../client/transport.js";

/** An item of a fake database, and the package it belongs to. */
export interface ServerItem {
  type: string;
  id: string;
  /** The `config_id` a versionable item has; none for the others. */
  configId?: string;
  keyedName: string;
  /** The package holding the item as an element; none when it is in no package. */
  packageName?: string;
}

const DECLARATION = /^<\?xml[^>]*\?>/;

const hex = (text: string): string => createHash("sha1").update(text).digest("hex").slice(0, 32).toUpperCase();
const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The package-membership side of a fake Aras server, for the tests of `export`: it answers the reads of HOST-010 to HOST-016 from
 * a list of items and packages, and hands every other request to `rest`. The requests it answered are kept as the engine's
 * transcripts keep them, so a test can pin their text.
 */
export class MembershipServer {
  /** The requests of the lookups, as the server received them. */
  readonly requests: string[] = [];
  /**
   * Whether the list of package names of HOST-015 is answered. Off by default, because the engine's own read of the non-core
   * package names (EXP-607) is the same request and belongs to the recorded transcript then.
   */
  answersPackageList = false;
  private readonly packages: string[];

  constructor(
    private readonly items: readonly ServerItem[],
    private readonly rest: FakeHandler,
    /** Packages that exist without elements, or are listed for suggestions. */
    extraPackages: readonly string[] = [],
  ) {
    this.packages = [...new Set([...items.flatMap((item) => item.packageName ?? []), ...extraPackages])];
  }

  definitionId = (name: string): string => hex(`definition:${name}`);
  groupId = (name: string): string => hex(`group:${name}`);

  readonly handler: FakeHandler = (request: TransportRequest, index: number) => {
    const action = header(request, "SOAPAction");
    if (action === "ApplyItem" || action === "ApplyAML") {
      const wire = documentOuterXml(parseXml(bodyText(request).replace(DECLARATION, "")));
      const answer = this.answer(parseXml(wire).root, wire);
      if (answer !== undefined) return answer;
    }
    return this.rest(request, index);
  };

  private rows(type: string, rows: readonly string[]) {
    return rows.length === 0 ? respond(soapFault("0", `No items of type ${type} found.`)) : respond(soapResult(rows.join("")));
  }

  private elementRow(item: ServerItem): string {
    return (
      `<Item type="PackageElement" id="${hex(`element:${item.id}`)}"><element_id>${item.configId ?? item.id}</element_id>` +
      `<source_id>${this.groupId(item.packageName as string)}</source_id><element_type>${escape(item.type)}</element_type>` +
      `<name>${escape(item.keyedName)}</name></Item>`
    );
  }

  private answer(item: XmlElement, wire: string) {
    if (item.name !== "Item" || attributeOf(item, "action") !== "get") return undefined;
    const type = attributeOf(item, "type") ?? "";
    const idlist = attributeOf(item, "idlist")?.split(",");
    // Only the shapes of HOST-010 to HOST-016 are lookups: the login, the version probe and the engine's own reads of the package
    // items (`GetSolutions2Xml`, the dependency lookups) go on to `rest`.
    const select = attributeOf(item, "select");
    const inList = childElements(item, "element_id").find((child) => attributeOf(child, "condition") === "in");
    const nested = childElements(item, "source_id")[0];
    const isLookup =
      idlist !== undefined ||
      (this.answersPackageList && type === "PackageDefinition" && select === "name" && item.children.length === 0) ||
      (type === "PackageElement" && (inList !== undefined || childElements(nested ?? item, "Item").length > 0));
    if (!isLookup) return undefined;
    this.requests.push(wire);

    if (type === "PackageDefinition") {
      const names = idlist === undefined ? this.packages : this.packages.filter((name) => idlist.includes(this.definitionId(name)));
      return this.rows(type, names.map((name) => `<Item type="PackageDefinition" id="${this.definitionId(name)}"><name>${escape(name)}</name></Item>`));
    }
    if (type === "PackageGroup") {
      const names = this.packages.filter((name) => idlist?.includes(this.groupId(name)));
      return this.rows(type, names.map((name) => `<Item type="PackageGroup" id="${this.groupId(name)}"><source_id>${this.definitionId(name)}</source_id></Item>`));
    }
    if (type === "PackageElement") {
      if (inList !== undefined) {
        const wanted = [...innerText(inList).matchAll(/'((?:[^']|'')*)'/g)].map((match) => (match[1] ?? "").replace(/''/g, "'").toUpperCase());
        return this.rows(
          type,
          this.items.filter((entry) => entry.packageName !== undefined && wanted.includes((entry.configId ?? entry.id).toUpperCase())).map((entry) => this.elementRow(entry)),
        );
      }
      const definition = nested === undefined ? undefined : innerText(childElements(nested, "Item")[0] as XmlElement);
      const name = this.packages.find((candidate) => this.definitionId(candidate) === definition);
      return this.rows(
        type,
        this.items.filter((entry) => entry.packageName === name).map((entry) => this.elementRow(entry)),
      );
    }
    // an ItemType of the items themselves
    const wanted = (idlist ?? []).map((id) => id.toUpperCase());
    return this.rows(
      type,
      this.items
        .filter((entry) => entry.type === type && wanted.includes(entry.id.toUpperCase()))
        .map(
          (entry) =>
            `<Item type="${escape(type)}" id="${entry.id}">${entry.configId === undefined ? "" : `<config_id>${entry.configId}</config_id>`}<keyed_name>${escape(entry.keyedName)}</keyed_name></Item>`,
        ),
    );
  }
}
