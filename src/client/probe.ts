import { DEFAULT_ENGINE, type Engine } from "../engines.js";
import { DotNetException, parseInt32, tryParseInt32 } from "./dotnet.js";
import { CItemException, ResponseDocument, getProperty } from "./fault.js";
import type { Innovator } from "./innovator.js";
import { childElements, innerText, localName, namespaceUri, type XmlElement } from "./mini-xml.js";
import { ArasVersion } from "./version.js";

const SOAP_ENVELOPE = "http://schemas.xmlsoap.org/soap/envelope/";

/** The probe's request: the literal's CRLF and tabs are part of the bytes (WIRE-007). Quotes are the engine's single ones. */
function variablesAml(names: string[]): string {
  const items = names
    .map((name) => `\t\t\t\t<Item type='Variable' action='get' select='name, value'>\r\n\t\t\t\t\t<name>${name}</name>\r\n\t\t\t\t</Item>`)
    .join("\r\n");
  return `\r\n\t\t\t<AML>\r\n${items}\r\n\t\t\t</AML>`;
}

function inSoapNamespace(element: XmlElement, name: string): boolean {
  const namespace = namespaceUri(element);
  return localName(element.name) === name && (namespace === SOAP_ENVELOPE || namespace === "");
}

/**
 * The `value` of the Variable called `name`, looked up from the envelope down.
 * When the response holds exactly one item, IOM has narrowed the result to it
 * and the lookup finds nothing, even for that Variable (WIRE-054).
 */
function variableValue(response: ResponseDocument, name: string): string {
  const root = response.document.root;
  const narrowed = response.items.length <= 1;
  const results = narrowed || !inSoapNamespace(root, "Envelope")
    ? []
    : childElements(root)
        .filter((body) => inSoapNamespace(body, "Body"))
        .flatMap((body) => childElements(body))
        .filter((result) => inSoapNamespace(result, "Result"));
  const hit = results
    .flatMap((result) => childElements(result, "Item"))
    .find((item) => item.attributes.some((a) => a.name === "type" && a.value === "Variable") &&
      childElements(item, "name").some((n) => innerText(n) === name));
  if (!hit) throw new DotNetException("System.IndexOutOfRangeException", "IndexOutOfRangeException");
  return getProperty(hit, "value") ?? "";
}

/** `getProperty` on a result that must be a single item. */
function singleItemValue(response: ResponseDocument): string {
  const [item] = response.items;
  if (response.items.length !== 1 || item === undefined) throw new DotNetException("System.Exception", "Not a single item");
  return getProperty(item, "value") ?? "";
}

/**
 * Reads the server version with four requests. A fault with faultcode `0` ("no
 * items") counts as 0 for the service pack, the build and the service update. A
 * Variable with no `value` element reads as an empty value, which fails the parse
 * of the major, minor, build and service update with a `FormatException` (WIRE-021).
 *
 * @spec WIRE-004 WIRE-007 WIRE-020 WIRE-021 WIRE-054
 */
export async function probeServerVersion(innovator: Innovator, engine: Engine = DEFAULT_ENGINE): Promise<ArasVersion> {
  const majorMinor = await innovator.applyAML(variablesAml(["VersionMajor", "VersionMinor"]));
  if (majorMinor.isError) throw CItemException.fromResponse(majorMinor, engine);
  const major = variableValue(majorMinor, "VersionMajor");
  const minor = variableValue(majorMinor, "VersionMinor");

  let servicePack = 0;
  const servicePackResponse = await innovator.applyAML(variablesAml(["VersionServicePack"]));
  if (servicePackResponse.isError) {
    if (servicePackResponse.errorCode !== "0") throw CItemException.fromResponse(servicePackResponse, engine);
  } else {
    const value = singleItemValue(servicePackResponse);
    servicePack = value === "" ? 0 : (tryParseInt32(value.replaceAll("SP", "")) ?? 0);
  }

  let build = 0;
  const buildResponse = await innovator.applyAML(variablesAml(["VersionBuild"]));
  if (buildResponse.isError) {
    if (buildResponse.errorCode !== "0") throw CItemException.fromResponse(buildResponse, engine);
  } else {
    build = parseInt32(singleItemValue(buildResponse));
  }

  let serviceUpdate = 0;
  const serviceUpdateResponse = await innovator.applyAML(variablesAml(["VersionServiceUpdate"]));
  if (serviceUpdateResponse.isError) {
    if (serviceUpdateResponse.errorCode !== "0") throw CItemException.fromResponse(serviceUpdateResponse, engine);
  } else {
    serviceUpdate = parseInt32(singleItemValue(serviceUpdateResponse));
  }

  return new ArasVersion(parseInt32(major), parseInt32(minor), servicePack, build, serviceUpdate);
}
