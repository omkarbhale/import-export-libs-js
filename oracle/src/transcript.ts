import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A recorded call's response at or above this size lives in a shared blob file
 * instead of the transcript. Every export asks for all current
 * PackageDefinitions first, a 2.7 MB answer that is the same in each case, so
 * the committed set would otherwise hold it once per case.
 */
export const BLOB_THRESHOLD = 64 * 1024;

/** One line of `transcript.jsonl`. Only the fields the helpers use are typed. */
export interface TranscriptCall {
  seq: number;
  action: string;
  request: string;
  response?: string;
  /** sha256 (hex) of the response text, which is stored in `<blobs>/<sha256>.xml`. */
  responseBlob?: string;
  error?: unknown;
  [key: string]: unknown;
}

const blobPath = (blobDir: string, sha256: string) => join(blobDir, `${sha256}.xml`);

/**
 * Moves each response of `BLOB_THRESHOLD` bytes or more out of a recorded
 * `transcript.jsonl` into the shared blob folder, leaving `responseBlob` in its
 * place. Other lines keep their exact bytes. Returns how many responses moved.
 */
export function externalizeLargeResponses(transcriptFile: string, blobDir: string): number {
  const text = readFileSync(transcriptFile, "utf8");
  let moved = 0;
  const lines = text.split("\n").map((line) => {
    if (line === "") return line;
    const call = JSON.parse(line) as TranscriptCall;
    if (typeof call.response !== "string" || Buffer.byteLength(call.response, "utf8") < BLOB_THRESHOLD) return line;
    const sha256 = createHash("sha256").update(call.response, "utf8").digest("hex");
    mkdirSync(blobDir, { recursive: true });
    const file = blobPath(blobDir, sha256);
    if (!existsSync(file)) writeFileSync(file, call.response, "utf8");
    const { response: _response, ...rest } = call;
    moved += 1;
    return JSON.stringify({ ...rest, responseBlob: sha256 });
  });
  writeFileSync(transcriptFile, lines.join("\n"));
  return moved;
}

/** Reads a fixture's `transcript.jsonl` with every `responseBlob` put back as `response`. */
export function readTranscript(transcriptFile: string, blobDir: string): TranscriptCall[] {
  return readFileSync(transcriptFile, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const call = JSON.parse(line) as TranscriptCall;
      if (call.responseBlob === undefined) return call;
      const { responseBlob, ...rest } = call;
      return { ...rest, response: readFileSync(blobPath(blobDir, responseBlob), "utf8") };
    });
}

/** Whether a blob's file name is its content's sha256. */
export function blobMatchesName(blobDir: string, sha256: string): boolean {
  const content = readFileSync(blobPath(blobDir, sha256), "utf8");
  return createHash("sha256").update(content, "utf8").digest("hex") === sha256;
}
