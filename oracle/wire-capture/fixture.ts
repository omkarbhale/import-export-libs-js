/**
 * Turns a proxy.mjs recording into a committed wire fixture (ticket 09):
 * every credential position scrubbed (oracle/src/scrub.ts, plus the run
 * password's MD5 and SHA-256 forms wherever they occur; the plain password is
 * never replaced as a word, since it can also occur in AML), the ASP.NET session id masked, and response bodies above
 * 16 KiB replaced by their length and sha256 (their content is export data,
 * which the transcript fixtures carry; this fixture is about the bytes below
 * the AML). Request bodies are always kept whole.
 *
 * Usage: ARAS_PASSWORD=… tsx oracle/wire-capture/fixture.ts <raw.jsonl> <out.jsonl>
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { findSecrets, scrub, secretForms, SCRUBBED } from "../src/scrub.js";

const MAX_BODY = 16 * 1024;
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: tsx oracle/wire-capture/fixture.ts <raw.jsonl> <out.jsonl>");
const password = process.env.ARAS_PASSWORD ?? "";
if (password === "") throw new Error("ARAS_PASSWORD is not set; it is needed to scrub the password's hash forms");
const secrets = secretForms(password);

function pairs(raw: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < raw.length; i += 2) out.push([raw[i]!, raw[i + 1]!]);
  return out;
}

function body(text: string | null): string | { length: number; sha256: string } | null {
  if (text === null || Buffer.byteLength(text, "utf8") <= MAX_BODY) return text;
  return { length: Buffer.byteLength(text, "utf8"), sha256: createHash("sha256").update(text, "utf8").digest("hex") };
}

const lines: string[] = [];
for (const line of readFileSync(input, "utf8").split("\n")) {
  if (line.trim() === "") continue;
  const r = JSON.parse(line);
  const record = {
    seq: r.seq,
    request: { ...r.request, rawHeaders: undefined, headers: pairs(r.request.rawHeaders) },
    response: {
      status: r.response.status,
      headers: pairs(r.response.rawHeaders),
      body: body(r.response.body),
      ...(r.response.clientBody !== undefined ? { clientBody: r.response.clientBody } : {}),
    },
  };
  let text = JSON.stringify(record);
  text = text.replace(/(ASP\.NET_SessionId=)[a-z0-9]+/gi, `$1${SCRUBBED}`);
  text = scrub(text, secrets).text;
  lines.push(text);
}
const out = lines.join("\n") + "\n";
const hits = findSecrets(out);
if (hits.length > 0) throw new Error(`credential-shaped text survived scrubbing: ${JSON.stringify(hits)}`);
writeFileSync(output, out);
console.log(`wrote ${lines.length} exchanges to ${output}`);
