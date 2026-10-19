import { describe, expect, it } from "vitest";
import { loadProbe } from "../client/probe-fixture.js";
import type { ProbedException } from "../client/probe-fixture.js";
import { StubConnection, stubFault, stubResult } from "../client/stub-connection.js";
import { ExportItem } from "./export-item.js";
import { IomItem } from "./iom-item.js";
import {
  NO_SCHEMA,
  type Schema,
  TREE_SCHEMA,
  exportOnce,
  newElements,
  newHelper,
  runState,
  schemaResponse,
} from "./probe-1435.js";
import { type RequestDictionary, newRequestDictionary } from "./request-template.js";

/**
 * The request template of 14.35 (EXP-020 to EXP-025, EXP-060 to EXP-062, EXP-065), replayed from the 14.35 request probe: the real
 * engine's requests for each type, level, server version and schema, recorded once by `oracle/request-probe/probe-14.35.ps1`.
 */
const probe = loadProbe("14.35");
const ID = "A1B2C3D4E5F60718293A4B5C6D7E8F90";

interface ExportRun {
  type: string;
  level: string | null;
  versionable: boolean;
  serverMajor: number;
  serverServicePack: number;
  id: string;
  requests: string[];
  actions: string[];
  stoppedByStub: boolean;
  thrown: ProbedException | null;
}

/** `Run-Export` of the probe: answers the is_versionable and current-id lookups and the schema's tree lookups. */
async function runExport(run: ExportRun, schema: Schema) {
  const stub = new StubConnection((request) => {
    if (request.includes('select="is_versionable"')) {
      return stubResult(`<Item type="ItemType" id="X"><is_versionable>${run.versionable ? "1" : "0"}</is_versionable></Item>`);
    }
    if (request.includes('select="config_id, is_current"')) {
      return stubResult(`<Item type="${run.type}" id="${run.id}"><config_id>CFG</config_id><is_current>1</is_current></Item>`);
    }
    return schemaResponse(request, schema);
  });
  const helper = newHelper(stub, run.serverMajor, run.serverServicePack);
  return exportOnce(helper, stub, new ExportItem("k", run.id, run.type), run.level, runState());
}

const scenarios: Array<[name: string, schema: Schema]> = [
  ["A.typeTableNoSchema", NO_SCHEMA],
  ["A.typeTableTree", TREE_SCHEMA],
  ["B.levels", TREE_SCHEMA],
  ["C.serverVersion", NO_SCHEMA],
  ["D.versionable", TREE_SCHEMA],
];

describe.each(scenarios)("the main fetch of 14.35 against the probe's %s (EXP-020 to EXP-025, EXP-060 to EXP-065)", (name, schema) => {
  const runs = probe[name] as ExportRun[];

  it("has the probe's runs", () => {
    expect(runs.length).toBeGreaterThan(1);
  });

  it.each(runs.map((run, index) => [`${index} ${run.type} level=${JSON.stringify(run.level)} v${run.serverMajor}.${run.serverServicePack}`, run] as const))(
    "%s",
    async (_, run) => {
      const result = await runExport(run, schema);
      expect(result.requests).toEqual(run.requests);
      expect(result.actions).toEqual(run.actions);
      expect(result.stoppedByStub).toBe(run.stoppedByStub);
      expect(result.thrown).toEqual(run.thrown);
    },
  );
});

interface ItemsRun {
  type: string;
  level: string;
  requests: string[];
  stoppedByStub: boolean;
  thrown: ProbedException | null;
}

/** `Run-Items` of the probe: one helper and one dictionary make one `ExportSolutions` call; each step is an item of a type and level. */
async function runItems(
  steps: ReadonlyArray<readonly [type: string, level: string]>,
  options: { schema?: Schema; dictionary?: RequestDictionary; withVersion?: boolean; respond?: ((request: string) => string | undefined) | undefined } = {},
) {
  const stub = new StubConnection((request) => {
    if (request.includes('select="is_versionable"')) return stubResult('<Item type="ItemType" id="X"><is_versionable>0</is_versionable></Item>');
    return options.respond?.(request) ?? schemaResponse(request, options.schema ?? NO_SCHEMA);
  });
  const helper = newHelper(stub, options.withVersion === false ? null : 14, 9);
  const state = runState(options.dictionary ?? newRequestDictionary(), newElements());
  const out: ItemsRun[] = [];
  for (const [type, level] of steps) {
    const outcome = await exportOnce(helper, stub, new ExportItem("k", ID, type), level, state);
    out.push({ type, level, requests: outcome.requests, stoppedByStub: outcome.stoppedByStub, thrown: outcome.thrown });
  }
  return out;
}

const compare = (actual: ItemsRun[], recorded: ItemsRun[]) => {
  expect(actual.map(({ type, level, requests, stoppedByStub, thrown }) => ({ type, level, requests, stoppedByStub, thrown }))).toEqual(
    recorded.map(({ type, level, requests, stoppedByStub, thrown }) => ({ type, level, requests, stoppedByStub, thrown })),
  );
};

describe("the template dictionary (EXP-060, probe E.templateCache)", () => {
  const recorded = probe["E.templateCache"] as Record<string, ItemsRun[]>;

  it("builds one template per type, whatever the level of the later items", async () => {
    compare(
      await runItems(
        [
          ["TA", "1"],
          ["TA", "3"],
          ["TA", ""],
          ["TB", "1"],
          ["TB", "2"],
        ],
        { schema: TREE_SCHEMA },
      ),
      recorded.sameDictionary ?? [],
    );
  });

  it("asks again with a new dictionary", async () => {
    compare(await runItems([["TA", "1"]], { schema: TREE_SCHEMA }), recorded.ownDictionaryRun1 ?? []);
    compare(await runItems([["TA", "3"]], { schema: TREE_SCHEMA }), recorded.ownDictionaryRun2 ?? []);
  });

  it("does not ask again through a second helper over the same dictionary", async () => {
    const dictionary = newRequestDictionary();
    compare(await runItems([["TA", "2"]], { schema: TREE_SCHEMA, dictionary }), recorded.sharedDictionaryHelper1 ?? []);
    compare(await runItems([["TA", "3"]], { schema: TREE_SCHEMA, dictionary }), recorded.sharedDictionaryHelper2 ?? []);
    expect([...dictionary.keys()]).toEqual((recorded.dictionaryKeys as unknown as { keys: string[] }).keys);
  });
});

describe("a template that failed is remembered for the run (EXP-062, probe F.templateFaults)", () => {
  const recorded = probe["F.templateFaults"] as Record<string, ItemsRun[]>;

  it.each([
    ["badLevelThenGoodLevel", [["TA", "abc"], ["TA", "1"], ["TB", "1"]], true],
    ["goodLevelThenBadLevel", [["TA", "1"], ["TA", "abc"]], true],
    ["overflowThenOk", [["TA", "99999999999"], ["TA", "1"]], true],
    ["namedTypeIgnoresBadLevel", [["Form", "abc"]], true],
    ["noServerVersion", [["TA", "1"], ["TA", "1"], ["Form", "1"]], false],
    ["itemTypeNoServerVersion", [["ItemType", "1"], ["ItemType", "1"]], false],
  ] as const)("%s", async (name, steps, withVersion) => {
    compare(await runItems(steps, { schema: TREE_SCHEMA, withVersion }), recorded[name] ?? []);
  });
});

describe("the answers to the tree lookups (EXP-061, probe G.treeLookupAnswers)", () => {
  const recorded = probe["G.treeLookupAnswers"] as Record<string, ItemsRun[]>;

  const propertyRow = (dataSource: string) => `<Item type="ItemType" id="IT"><Relationships>${dataSource}</Relationships></Item>`;
  const responders: Record<string, (request: string) => string | undefined> = {
    itemTypeFault999: (request) => (request.includes("<name>related_id</name>") ? stubFault("999", "boom") : undefined),
    relTypeFault999: (request) => (request.includes('type="RelationshipType"') ? stubFault("999", "boom") : undefined),
    twoPropertyRows: (request) =>
      request.includes("<name>related_id</name>")
        ? stubResult(
            propertyRow(
              '<Item type="Property" id="P1"><data_source keyed_name="TB" type="ItemType" name="TB">X</data_source></Item>' +
                '<Item type="Property" id="P2"><data_source keyed_name="TB" type="ItemType" name="TB">X</data_source></Item>',
            ),
          )
        : undefined,
    noNameAttribute: (request) =>
      request.includes("<name>related_id</name>")
        ? stubResult(propertyRow('<Item type="Property" id="P1"><data_source keyed_name="TB" type="ItemType">X</data_source></Item>'))
        : undefined,
    listDataSource: (request) =>
      /<name>R1<\/name>.*<name>related_id<\/name>/.test(request)
        ? stubResult(propertyRow('<Item type="Property" id="P1"><data_source keyed_name="Colors" type="List" name="Colors">X</data_source></Item>'))
        : undefined,
    relTypeNoName: (request) =>
      request.includes('type="RelationshipType"')
        ? stubResult('<Item type="RelationshipType" id="RT1" /><Item type="RelationshipType" id="RT2"><name>R2</name></Item>')
        : undefined,
  };

  it.each(Object.keys(responders).flatMap((mode) => [`${mode}.level1`, `${mode}.level2`]))("%s", async (key) => {
    const mode = key.slice(0, key.indexOf("."));
    const level = key.endsWith("level1") ? "1" : "2";
    compare(await runItems([["TA", level]], { schema: TREE_SCHEMA, respond: responders[mode] }), recorded[key] ?? []);
  });
});

describe("the arguments Export refuses before anything is sent (EXP-002, probe F.nullArguments)", () => {
  const recorded = probe["F.nullArguments"] as Array<{ type: string; nullArgument: string; thrown: ProbedException; requestCount: number }>;

  it.each(recorded.map((entry) => [`${entry.type} without ${entry.nullArgument}`, entry] as const))("%s", async (_, entry) => {
    const stub = new StubConnection(() => undefined);
    const helper = newHelper(stub, 14, 9);
    const state = runState(entry.nullArgument === "dict" ? null : newRequestDictionary(), entry.nullArgument === "elements" ? null : newElements());
    if (entry.nullArgument === "item") return; // the port's item is never null
    const outcome = await exportOnce(helper, stub, new ExportItem("k", "ID", entry.type), "1", state);
    expect(outcome.thrown).toEqual(entry.thrown);
    expect(stub.requests).toHaveLength(entry.requestCount);
  });
});

describe("the file name and folder are joined before the first request (EXP-002, EXP-417, probe I.fileNameAndFolder)", () => {
  const recorded = probe["I.fileNameAndFolder"] as Array<{
    typeName: string;
    keyedName: string;
    idName: string;
    requestCount: number;
    stoppedByStub: boolean;
    thrown: ProbedException | null;
  }>;

  it.each(recorded.map((entry, index) => [`${index} ${JSON.stringify([entry.typeName, entry.keyedName, entry.idName])}`, entry] as const))("%s", async (_, entry) => {
    const stub = new StubConnection((request) => {
      if (request.includes('select="is_versionable"')) return stubResult('<Item type="ItemType" id="X"><is_versionable>0</is_versionable></Item>');
      return schemaResponse(request, NO_SCHEMA);
    });
    const helper = newHelper(stub, 14, 9);
    const outcome = await exportOnce(helper, stub, new ExportItem(entry.keyedName, entry.idName, entry.typeName), "1", runState());
    expect({ requestCount: stub.requests.length, stoppedByStub: outcome.stoppedByStub, thrown: outcome.thrown }).toEqual({
      requestCount: entry.requestCount,
      stoppedByStub: entry.stoppedByStub,
      thrown: entry.thrown,
    });
  });
});

describe("an IOM item, as the template builds it (EXP-003)", () => {
  it("starts with isNew and isTemp and writes an empty item as <Item … />", () => {
    expect(IomItem.newItem("List", "get").toXml()).toBe('<Item isNew="1" isTemp="1" type="List" action="get" />');
  });

  it("has neither type nor action for a null type, and a null property is is_null", () => {
    const item = IomItem.newItem(null, "get");
    item.setProperty("name", null);
    expect(item.toXml()).toBe('<Item isNew="1" isTemp="1"><name is_null="1"></name></Item>');
  });

  it("puts the id after what the template holds and replaces it in place", () => {
    const item = IomItem.newItem("List", "get");
    item.addRelationship(IomItem.newItem("Value", "get"));
    item.setProperty("id", "A");
    item.setProperty("id", "B");
    expect(item.toXml()).toBe(
      '<Item isNew="1" isTemp="1" type="List" action="get"><Relationships><Item isNew="1" isTemp="1" type="Value" action="get" /></Relationships><id>B</id></Item>',
    );
  });

  it("escapes attribute values and text, and copies without sharing", () => {
    const item = IomItem.newItem('a"b', "get");
    item.setProperty("name", "Part & <Co>");
    const copy = item.clone();
    copy.setProperty("name", "other");
    expect(item.toXml()).toBe('<Item isNew="1" isTemp="1" type="a&quot;b" action="get"><name>Part &amp; &lt;Co&gt;</name></Item>');
    });
});
