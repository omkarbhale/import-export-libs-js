import { beforeEach, describe, expect, it } from "vitest";
import type { Engine } from "../engines.js";
import { CItemException, ResponseDocument } from "./fault.js";
import { PackageLookups, resetPackageCaches } from "./package-lookups.js";

/**
 * The cache of a package's element ids (R1 of EXP-608) as each engine keeps it (EXP-609, EXP-621): 12.0 and 14.0.7 ask again after a
 * failure; 14.35's `Lazy` keeps the exception, and shares one request among the workers that ask together.
 */

const ANSWER = `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><Result><Item type="PackageDefinition" id="P1"><Relationships><Item type="PackageGroup" id="G1"><Relationships><Item type="PackageElement" id="E1"><element_id>AAA</element_id></Item><Item type="PackageElement" id="E2"><element_id>BBB</element_id></Item></Relationships></Item></Relationships></Item></Result></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

/** A helper whose server fails the first `failures` requests with a transport-style fault and then answers. */
function lookupsFor(engine: Engine, failures: number): { lookups: PackageLookups; requests: string[] } {
  const requests: string[] = [];
  const host = {
    engine,
    applyAML: async (aml: string) => {
      requests.push(aml);
      await Promise.resolve();
      if (requests.length <= failures) throw new CItemException(-1, "", `connection lost (${requests.length})`);
      return ResponseDocument.parse(ANSWER);
    },
  };
  return { lookups: new PackageLookups(host), requests };
}

beforeEach(() => resetPackageCaches());

describe("PackageLookups.getPackageElementIds", () => {
  it.each(["12.0", "14.0.7"] as const)("%s asks again after a failure (EXP-609)", async (engine) => {
    const { lookups, requests } = lookupsFor(engine, 1);
    await expect(lookups.getPackageElementIds("pkg")).rejects.toThrow("connection lost (1)");
    expect([...(await lookups.getPackageElementIds("pkg"))]).toEqual(["AAA", "BBB"]);
    expect(requests).toHaveLength(2);
    await lookups.getPackageElementIds("pkg");
    expect(requests, "an answer is cached").toHaveLength(2);
  });

  it("14.35 keeps the failure for the run and throws the first exception again without a request (EXP-621)", async () => {
    const { lookups, requests } = lookupsFor("14.35", 1);
    const first = await lookups.getPackageElementIds("pkg").catch((error: unknown) => error);
    const second = await lookups.getPackageElementIds("pkg").catch((error: unknown) => error);
    expect(first).toBeInstanceOf(CItemException);
    expect(second).toBe(first);
    expect(requests).toHaveLength(1);
    // another package is not affected, and the next helper starts with empty caches
    expect([...(await lookups.getPackageElementIds("other"))]).toEqual(["AAA", "BBB"]);
    resetPackageCaches();
    expect([...(await lookups.getPackageElementIds("pkg"))]).toEqual(["AAA", "BBB"]);
  });

  it("14.35 sends one request for the workers that ask together (EXP-609)", async () => {
    const { lookups, requests } = lookupsFor("14.35", 0);
    const answers = await Promise.all([lookups.getPackageElementIds("pkg"), lookups.getPackageElementIds("pkg"), lookups.getPackageElementIds("pkg")]);
    expect(requests).toHaveLength(1);
    expect(answers.map((set) => [...set])).toEqual([["AAA", "BBB"], ["AAA", "BBB"], ["AAA", "BBB"]]);
  });
});
