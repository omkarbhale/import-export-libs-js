import type { Engine } from "../engines.js";

const SERVER_PAGE = "InnovatorServer.aspx";

/**
 * The server URL IOM derives from the one it is given, as its base (ending in
 * `/`) and the SOAP endpoint. IOM 12 (the 12.0 engine) tests for the suffix `Server/InnovatorServer.aspx` and removes the file
 * name with a case-insensitive expression whose `.` matches any character, wherever the name occurs.
 *
 * @spec WIRE-003
 */
export function serverUrls(url: string, engine?: Engine): { base: string; soap: string; discovery: string } {
  let base: string;
  if (engine === "12.0") {
    base = url.toLowerCase().endsWith(`Server/${SERVER_PAGE}`.toLowerCase())
      ? url.replace(/InnovatorServer.aspx/gi, "")
      : `${url}${url.endsWith("/") ? "" : "/"}Server/`;
  } else if (url.toLowerCase().endsWith(SERVER_PAGE.toLowerCase())) {
    base = url.slice(0, url.length - SERVER_PAGE.length);
  } else {
    base = `${url}${url.endsWith("/") ? "" : "/"}Server/`;
  }
  return { base, soap: `${base}${SERVER_PAGE}`, discovery: `${base}OAuthServerDiscovery.aspx` };
}
