import { readFileSync } from "node:fs";
import { CItemException } from "./fault.js";
import { DotNetException } from "./dotnet.js";

/** What the request probe records of an exception (`Desc` in `oracle/request-probe/probe-14.0.7.ps1`). */
export interface ProbedException {
  type: string;
  faultcode?: number;
  faultdetail?: string;
  message: string;
}

/** The request probe's scenarios for an engine, as recorded under `fixtures/export-requests/<engine>-probe/`. */
export function loadProbe(engine: "14.0.7" | "14.35"): Record<string, any> {
  const file = new URL(`../../fixtures/export-requests/${engine}-probe/requests.json`, import.meta.url);
  return (JSON.parse(readFileSync(file, "utf8")) as { scenarios: Record<string, any> }).scenarios;
}

const clip = (text: string): string => (text.length > 300 ? text.slice(0, 300) : text);

/** The probe's description of a thrown exception, so a test can compare it with what the port threw. */
export function describeException(error: unknown): ProbedException {
  if (error instanceof CItemException) {
    return {
      type: "Aras.Tools.SolutionUpgrade.CItemException",
      faultcode: error.faultcode,
      faultdetail: clip(error.faultdetail ?? ""),
      message: clip(error.message),
    };
  }
  if (error instanceof DotNetException) return { type: error.typeName, message: clip(error.message) };
  throw error;
}
