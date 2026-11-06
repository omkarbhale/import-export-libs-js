import { inject } from "vitest";
import type { ScenarioCreated, SeenRequest, WireScenarioSpec } from "./wire-spec.js";

/**
 * What a page needs to use the HTTP test server of the wire tests (HOST-234): it asks the server for a scenario with `fetch`, gets the
 * URL to log in to, and reads back what the server received. The server's origin is provided by the global setup of the browser
 * project (`tools/browser-wire-setup.ts`).
 *
 * @spec HOST-234 HOST-269
 */

/** A scenario of the server: where it is, and the calls on it. */
export interface Scenario extends ScenarioCreated {
  /** What the server received so far, and the requests it could not match to a recording. */
  log(): Promise<{ seen: SeenRequest[]; mismatches: string[] }>;
  /** Closes the scenario's own listener (a scenario made with `ownListener`), so that a later request is refused. */
  stop(): Promise<void>;
  /** Forgets the scenario. */
  release(): Promise<void>;
}

const control = (path: string): string => `${inject("wireServerOrigin")}/__control/${path}`;

/** Makes a scenario on the server. */
export async function wireScenario(spec: WireScenarioSpec): Promise<Scenario> {
  const response = await fetch(control("scenarios"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) });
  if (!response.ok) throw new Error(`the wire server refused the scenario: ${response.status} ${await response.text()}`);
  const created = (await response.json()) as ScenarioCreated;
  return {
    ...created,
    log: async () => (await (await fetch(control(`scenarios/${created.id}/seen`))).json()) as { seen: SeenRequest[]; mismatches: string[] },
    stop: async () => void (await fetch(control(`scenarios/${created.id}/stop`), { method: "POST" })),
    release: async () => void (await fetch(control(`scenarios/${created.id}`), { method: "DELETE" })),
  };
}

/** The value of a request header, by name without regard to case. */
export function headerOf(request: SeenRequest, name: string): string | undefined {
  return request.headers.find(([candidate]) => candidate.toLowerCase() === name.toLowerCase())?.[1];
}

/** The requests of a log that are not preflights, in the order the server received them. */
export const requestsOf = (seen: readonly SeenRequest[]): SeenRequest[] => seen.filter((request) => !request.preflight);

/** The preflights of a log. */
export const preflightsOf = (seen: readonly SeenRequest[]): SeenRequest[] => seen.filter((request) => request.preflight);

/** The SOAP requests of a log, those to the endpoint `InnovatorServer.aspx`. */
export const soapOf = (seen: readonly SeenRequest[]): SeenRequest[] => requestsOf(seen).filter((request) => request.path.endsWith("/InnovatorServer.aspx"));

/** The SOAP action of each SOAP request of a log. */
export const actionsOf = (seen: readonly SeenRequest[]): string[] => soapOf(seen).map((request) => headerOf(request, "SOAPAction") ?? "");
