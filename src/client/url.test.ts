import { describe, expect, it } from "vitest";
import { serverUrls } from "./url.js";

describe("serverUrls (WIRE-003)", () => {
  it.each([
    ["http://h/Innovator", "http://h/Innovator/Server/"],
    ["http://h/Innovator/", "http://h/Innovator/Server/"],
    ["http://h/Innovator/Server/InnovatorServer.aspx", "http://h/Innovator/Server/"],
    ["http://h/Innovator/Server/INNOVATORSERVER.ASPX", "http://h/Innovator/Server/"],
    ["http://h/Innovator/Server", "http://h/Innovator/Server/Server/"],
    ["http://h/Innovator/Server/InnovatorServer.aspx/", "http://h/Innovator/Server/InnovatorServer.aspx/Server/"],
    ["http://h/Innovator/Server/InnovatorServer.aspx?x=1", "http://h/Innovator/Server/InnovatorServer.aspx?x=1/Server/"],
  ])("%s has base %s", (url, base) => {
    expect(serverUrls(url)).toEqual({
      base,
      soap: `${base}InnovatorServer.aspx`,
      discovery: `${base}OAuthServerDiscovery.aspx`,
    });
  });
});
