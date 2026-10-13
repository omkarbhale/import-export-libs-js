import { inflateRawSync } from "node:zlib";
import { BlobReader, type Metadata, T } from "./metadata.js";

/** Line ranges ILSpy's portable PDB assigns to each MethodDef of its output. */

export interface MethodLines {
  /** MethodDef rid. */
  rid: number;
  /** Document path relative to the project, with forward slashes. */
  document: string;
  /** 1-based, inclusive, in the PDB's document text. */
  startLine: number;
  endLine: number;
}

const EMBEDDED_SOURCE = "0e8a571b-6926-466e-b4ad-8ab04611f5fe";

export function documentNames(pdb: Metadata): string[] {
  return pdb.rows(T.Document).map((row) => {
    const reader = new BlobReader(pdb.blob(row[0] ?? 0));
    const separator = String.fromCharCode(reader.byte());
    const parts: string[] = [];
    while (!reader.done) parts.push(new TextDecoder().decode(pdb.blob(reader.uint())));
    return parts.join(separator).replace(/\\/g, "/");
  });
}

/** The source text ILSpy embedded for each document, keyed by document path. */
export function embeddedSources(pdb: Metadata): Map<string, string> {
  const names = documentNames(pdb);
  const sources = new Map<string, string>();
  for (const row of pdb.rows(T.CustomDebugInformation)) {
    const [table, rid] = pdb.decode("HasCustomDebugInformation", row[0] ?? 0);
    if (table !== T.Document || pdb.guid(row[1] ?? 0) !== EMBEDDED_SOURCE) continue;
    const value = pdb.blob(row[2] ?? 0);
    const format = new DataView(value.buffer, value.byteOffset, value.byteLength).getInt32(0, true);
    const payload = format === 0 ? value.subarray(4) : inflateRawSync(value.subarray(4));
    sources.set(names[rid - 1] ?? "", new TextDecoder().decode(payload));
  }
  return sources;
}

/** Decodes each method's sequence points into one line span. */
export function methodLines(pdb: Metadata): MethodLines[] {
  const names = documentNames(pdb);
  const spans: MethodLines[] = [];
  pdb.rows(T.MethodDebugInformation).forEach((row, index) => {
    const span = sequencePointSpan(pdb.blob(row[1] ?? 0), row[0] ?? 0);
    if (span) spans.push({ rid: index + 1, document: names[span.document - 1] ?? "", startLine: span.startLine, endLine: span.endLine });
  });
  return spans;
}

/**
 * The lines a sequence-points blob (portable PDB format) covers in the
 * document of its first visible point; hidden points are skipped.
 */
export function sequencePointSpan(
  blob: Uint8Array,
  initialDocument: number,
): { document: number; startLine: number; endLine: number } | undefined {
  if (blob.length === 0) return undefined;
  const r = new BlobReader(blob);
  r.uint(); // local signature
  let document = initialDocument === 0 ? r.uint() : initialDocument;

  let first = true;
  let sawVisible = false;
  let line = 0;
  let column = 0;
  let span: { document: number; startLine: number; endLine: number } | undefined;
  while (!r.done) {
    const deltaIl = r.uint();
    if (deltaIl === 0 && !first) {
      document = r.uint();
      continue;
    }
    first = false;
    const deltaLines = r.uint();
    const deltaColumns = deltaLines === 0 ? r.uint() : r.int();
    if (deltaLines === 0 && deltaColumns === 0) continue; // hidden
    line = sawVisible ? line + r.int() : r.uint();
    column = sawVisible ? column + r.int() : r.uint();
    sawVisible = true;
    const end = line + deltaLines;
    if (!span) span = { document, startLine: line, endLine: end };
    else if (span.document === document) {
      span.startLine = Math.min(span.startLine, line);
      span.endLine = Math.max(span.endLine, end);
    }
  }
  return span;
}
