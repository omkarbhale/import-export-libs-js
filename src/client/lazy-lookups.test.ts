import { describe, expect, it } from "vitest";
import { CItemException } from "./fault.js";
import { CItemHelper } from "./item-helper.js";
import { StubConnection, stubFault, stubResult } from "./stub-connection.js";
import { ArasVersion } from "./version.js";

/**
 * 14.35's cache of `Lazy` values as the lookups use it (IMP-102, IMP-132, IMP-170, IMP-182, IMP-183, IMP-321): the cases of the
 * probes `n03` and `n09` of `fixtures/import-run/probe-14.35.txt`, run against the port with a stub that answers like the probe's.
 */
const helperOver = (respond: (request: string) => string | undefined, engine: "14.0.7" | "14.35" = "14.35") => {
  const stub = new StubConnection(respond);
  const helper = new CItemHelper(stub, { engine });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  return { stub, helper, lookups: helper.lookups };
};

const DEFINITION = (relationshipTypes: string[]): string =>
  stubResult(
    `<Item type="ItemType" id="T1"><Relationships>${relationshipTypes.map((name) => `<Item type="RelationshipType"><name>${name}</name></Item>`).join("")}</Relationships></Item>`,
  );
const AML = "<Item type='ItemType' action='get' select='id'><name>Part</name><Relationships><Item type='Property' action='get' select='name'/><Item type='RelationshipType' action='get' select='name'/></Relationships></Item>";

const caught = async (work: () => Promise<unknown>): Promise<unknown> => {
  try {
    await work();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe("GetTypeAmlInner in 14.35 (IMP-132, IMP-182)", () => {
  it("writes the text, then 'from server' after the answer, and 'from cache' for a hit", async () => {
    const { stub, lookups } = helperOver(() => DEFINITION([]));
    const log: string[] = [];
    const writer = { writeLine: (text: string) => void log.push(text) };
    await lookups.getTypeAmlInner(AML, writer);
    await lookups.getTypeAmlInner(AML, writer);
    expect(log).toEqual([AML, "  was obtained from server", AML, "  was obtained from cache"]);
    expect(stub.requests).toHaveLength(1);
  });

  it("does not replace the cached answer with a forced one, and gives the caller the forced answer (IMP-182, probe n03)", async () => {
    let call = 0;
    const { stub, lookups } = helperOver(() => {
      call += 1;
      return DEFINITION(call === 1 ? [] : ["Part BOM"]);
    });
    const first = await lookups.getTypeAmlInner(AML);
    const forced = await lookups.getTypeAmlInner(AML, undefined, true);
    expect(forced).not.toBe(first);
    expect(await lookups.getTypeAmlInner(AML)).toBe(first);
    expect(stub.requests).toHaveLength(2);
  });

  it("removes the entry of a request that threw a CItemException, so it is sent again, and sets the detail of fault 0 (IMP-132, IMP-180)", async () => {
    const { stub, lookups } = helperOver(() => stubFault("0", "none"));
    const first = (await caught(() => lookups.getTypeAmlInner(AML))) as CItemException;
    await caught(() => lookups.getTypeAmlInner(AML));
    expect(first).toBeInstanceOf(CItemException);
    expect(first.faultdetail).toBe("Unable to get definition of System.Xml.XmlAttribute: Part");
    expect(stub.requests).toHaveLength(2);
  });

  it("also removes an older successful entry when the forced request fails (IMP-132)", async () => {
    let call = 0;
    const { stub, lookups } = helperOver(() => (++call === 1 ? DEFINITION([]) : stubFault("999", "boom")));
    await lookups.getTypeAmlInner(AML);
    await caught(() => lookups.getTypeAmlInner(AML, undefined, true));
    await lookups.getTypeAmlInner(AML).catch(() => undefined);
    expect(stub.requests).toHaveLength(3);
  });

  it("is the 14.0.7 behaviour for 14.0.7: a forced answer replaces the cached one", async () => {
    let call = 0;
    const { lookups } = helperOver(() => DEFINITION(++call === 1 ? [] : ["Part BOM"]), "14.0.7");
    const first = await lookups.getTypeAmlInner(AML);
    const forced = await lookups.getTypeAmlInner(AML, undefined, true);
    expect(await lookups.getTypeAmlInner(AML)).toBe(forced);
    expect(forced).not.toBe(first);
  });
});

describe("IsVersionable in 14.35 (IMP-170, probe n09)", () => {
  it("asks again for a type that is missing: a fault is not remembered", async () => {
    const { stub, lookups } = helperOver(() => stubFault("0", "none"));
    await caught(() => lookups.isVersionable("Part"));
    await caught(() => lookups.isVersionable("Part"));
    expect(stub.requests).toHaveLength(2);
  });

  it("sends one request per type for the life of the helper", async () => {
    const { stub, lookups } = helperOver(() => stubResult('<Item type="ItemType" id="X"><is_versionable>1</is_versionable></Item>'));
    expect([await lookups.isVersionable("Part"), await lookups.isVersionable("Part"), await lookups.isVersionable("Part")]).toEqual([true, true, true]);
    expect(stub.requests).toHaveLength(1);
  });
});

describe("GetUniqueProperties in 14.35 remembers a failure (IMP-183, IMP-321, probe n09)", () => {

  it("sends the keyed-properties request once for two calls, whatever the fault", async () => {
    for (const [code, text] of [
      ["0", "none"],
      ["7", "bad"],
    ] as const) {
      const { stub, lookups } = helperOver(() => stubFault(code, text));
      const first = await caught(() => lookups.getUniqueProperties("Part"));
      const second = await caught(() => lookups.getUniqueProperties("Part"));
      expect(first).toBeInstanceOf(CItemException);
      expect(second).toBe(first);
      expect(stub.requests).toHaveLength(1);
    }
  });

  it("asks twice in 14.0.7, which stores no failure", async () => {
    const { stub, lookups } = helperOver(() => stubFault("7", "bad"), "14.0.7");
    await caught(() => lookups.getUniqueProperties("Part"));
    await caught(() => lookups.getUniqueProperties("Part"));
    expect(stub.requests).toHaveLength(2);
  });

  it("caches a success, as in 14.0.7", async () => {
    const { stub, lookups } = helperOver(() => stubResult('<Item type="ItemType" id="IT"/>'));
    const first = await lookups.getUniqueProperties("Part");
    expect(await lookups.getUniqueProperties("Part")).toBe(first);
    expect(stub.requests).toHaveLength(1);
  });
});
