const SERVER_PAGE = "InnovatorServer.aspx";

/**
 * The server URL IOM derives from the one it is given, as its base (ending in
 * `/`) and the SOAP endpoint.
 *
 * @spec WIRE-003
 */
export function serverUrls(url: string): { base: string; soap: string; discovery: string } {
  let base: string;
  if (url.toLowerCase().endsWith(SERVER_PAGE.toLowerCase())) {
    base = url.slice(0, url.length - SERVER_PAGE.length);
  } else {
    base = `${url}${url.endsWith("/") ? "" : "/"}Server/`;
  }
  return { base, soap: `${base}${SERVER_PAGE}`, discovery: `${base}OAuthServerDiscovery.aspx` };
}
