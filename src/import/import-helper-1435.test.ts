import { describe, expect, it } from "vitest";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { StubConnection, stubFault, stubResult } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import { ImportHelper } from "./import-helper.js";

/**
 * The package group and the label of an ItemType in 14.35 (IMP-446, IMP-447, IMP-183, probe n09): the answers are cached under
 * the request text as `Lazy` values, a failed `add` of the group stays and is rethrown without a request, and the label lookup
 * removes its entry for each failure it handles.
 */
function setup(respond: (wire: string) => string, engine: "14.0.7" | "14.35" = "14.35") {
  const stub = new StubConnection(respond);
  const helper = new CItemHelper(stub, { engine });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  return { stub, importHelper: new ImportHelper(helper, { osUser: "u" }) };
}

const caught = async (work: () => Promise<unknown>): Promise<CItemException> => {
  try {
    await work();
  } catch (error) {
    return error as CItemException;
  }
  throw new Error("expected a failure");
};

describe("GetPackageGroupIdOrCreateIfNotExists in 14.35 (IMP-446, IMP-183)", () => {
  const addFails = (wire: string): string => (wire.includes('action="add"') ? stubFault("7", "bad") : stubFault("0", "none"));

  it("rethrows a failed add on the second call with no request, and asks again on the third (the handler removes the entry)", async () => {
    const { stub, importHelper } = setup(addFails);
    const first = await caught(() => importHelper.getPackageGroupIdOrCreateIfNotExists("PD1", "G"));
    expect(first.faultcode).toBe(7);
    expect(stub.requests).toHaveLength(2);
    const second = await caught(() => importHelper.getPackageGroupIdOrCreateIfNotExists("PD1", "G"));
    expect(second).toBe(first);
    expect(stub.requests).toHaveLength(2);
    // the suffix is added to the same exception on each call
    expect(second.faultdetail?.match(/ Can init group in PackageDefinition\./g)).toHaveLength(2);
    // the second call's handler removed the entry, so the third sends the get and the add again
    await caught(() => importHelper.getPackageGroupIdOrCreateIfNotExists("PD1", "G"));
    expect(stub.requests).toHaveLength(4);
  });

  it("14.0.7 sends the get and the add again", async () => {
    const { stub, importHelper } = setup(addFails, "14.0.7");
    await caught(() => importHelper.getPackageGroupIdOrCreateIfNotExists("PD1", "G"));
    await caught(() => importHelper.getPackageGroupIdOrCreateIfNotExists("PD1", "G"));
    expect(stub.requests).toHaveLength(4);
  });

  it("caches the answer of the get, or of the add, under the text of the get", async () => {
    const { stub, importHelper } = setup((wire) =>
      wire.includes('action="add"') ? stubResult('<Item type="PackageGroup" id="NEW"/>') : stubFault("0", "none"),
    );
    expect(await importHelper.getPackageGroupIdOrCreateIfNotExists("PD1", "G")).toBe("NEW");
    expect(await importHelper.getPackageGroupIdOrCreateIfNotExists("PD1", "G")).toBe("NEW");
    expect(stub.requests).toHaveLength(2);
  });
});

describe("GetLabelOfItemType in 14.35 (IMP-447)", () => {
  const label = (text: string): string =>
    `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="http://www.aras.com/I18N"><SOAP-ENV:Body><Result><Item type="ItemType"><i18n:label xml:lang="en">${text}</i18n:label></Item></Result></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

  it("sends one request for a type and caches the answer", async () => {
    const { stub, importHelper } = setup(() => label("Part"));
    expect(await importHelper.getLabelOfItemType("Part")).toBe("Part");
    expect(await importHelper.getLabelOfItemType("Part")).toBe("Part");
    expect(stub.requests).toHaveLength(1);
  });

  it("removes the entry for a CItemException and for a null reference, so the lookup is sent again", async () => {
    const refused = setup(() => stubFault("5", "no"));
    await caught(() => refused.importHelper.getLabelOfItemType("Part"));
    await caught(() => refused.importHelper.getLabelOfItemType("Part"));
    expect(refused.stub.requests).toHaveLength(2);

    const empty = setup(() => stubResult(""));
    await caught(() => empty.importHelper.getLabelOfItemType("Part"));
    await caught(() => empty.importHelper.getLabelOfItemType("Part"));
    expect(empty.stub.requests).toHaveLength(2);
  });
});
