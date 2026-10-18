import { writeFileBytes } from "../io/host-path.js";
import type { PathEnvironment } from "../io/host-path.js";
import { writeVolumeFile } from "../io/windows-fs.js";
import type { XmlDocument } from "./dom.js";
import { ArgumentException } from "./errors.js";
import { ITEM_FILE_SETTINGS, writeDocument } from "./writer-xmlwriter.js";
import { saveBytes } from "./writer-legacy.js";

/** The UTF-8 byte-order mark `StreamWriter` writes for `new UTF8Encoding(true)`. */
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * The bytes of an item file: the byte-order mark, then the document written with the item-file settings (one space
 * per level, no declaration, no newline after the root).
 * @spec EXP-423 EXP-424 EXP-425 EXP-426 EXP-427
 */
export function encodeItemFile(doc: XmlDocument): Buffer {
  return Buffer.concat([BOM, Buffer.from(writeDocument(doc, ITEM_FILE_SETTINGS), "utf8")]);
}

/**
 * `IOWrapper.XmlDocumentSaveWithSettings(doc, path)`: the path goes through the engine's path rules (EXP-421) and is read as
 * a path on a Windows volume (EXP-420), and the file is created or truncated and the item file written. A document that cannot be written leaves the
 * byte-order mark and the text before the failing node in the file, and the exception goes on to the caller.
 * @spec EXP-423 EXP-424 EXP-425 EXP-426 EXP-427 EXP-428
 */
export function xmlDocumentSaveWithSettings(doc: XmlDocument, path: string | null, environment: PathEnvironment = {}): void {
  let bytes: Buffer;
  try {
    bytes = encodeItemFile(doc);
  } catch (error) {
    if (error instanceof ArgumentException && error.partialOutput !== undefined) {
      writeVolumeFile(path, Buffer.concat([BOM, Buffer.from(error.partialOutput, "utf8")]), environment);
    }
    throw error;
  }
  writeVolumeFile(path, bytes, environment);
}

/**
 * `IOWrapper.XmlDocumentSave(doc, path)`: the path goes through the engine's path rules (MAN-004, MAN-033), then
 * `XmlDocument.Save(path)` overwrites the file, which is how the manifest is written (MAN-006).
 * @spec MAN-004 MAN-006
 */
export function xmlDocumentSave(doc: XmlDocument, path: string | null, environment: PathEnvironment = {}): void {
  writeFileBytes(path, saveBytes(doc), environment);
}
