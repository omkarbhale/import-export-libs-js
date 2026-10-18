import { writeFileSync } from "node:fs";
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
 * `IOWrapper.XmlDocumentSaveWithSettings(doc, path)` without the path normalisation: creates or truncates the file and
 * writes the item file. A document that cannot be written leaves the byte-order mark and the text before the failing
 * node in the file, and the exception goes on to the caller. The caller applies the engine's path rules first (EXP-421).
 * The source-map entry stays unmapped until the path ticket (the build ticket that implements NormalizeLongPath,
 * EXP-421; wayfinder tickets 28 and 33 call these wrappers) makes this wrapper apply the path rules.
 * @spec EXP-423 EXP-424 EXP-425 EXP-426 EXP-427 EXP-428
 */
export function xmlDocumentSaveWithSettings(doc: XmlDocument, path: string): void {
  try {
    writeFileSync(path, encodeItemFile(doc));
  } catch (error) {
    if (error instanceof ArgumentException && error.partialOutput !== undefined) {
      writeFileSync(path, Buffer.concat([BOM, Buffer.from(error.partialOutput, "utf8")]));
    }
    throw error;
  }
}

/**
 * `IOWrapper.XmlDocumentSave(doc, path)` without the path normalisation: `XmlDocument.Save(path)`, which is how the
 * manifest is written. The caller applies the engine's path rules first (MAN-004). The source-map entry stays
 * unmapped until the path ticket (the build ticket that implements NormalizeLongPath, EXP-421; wayfinder tickets 28
 * and 33 call these wrappers) makes this wrapper apply the path rules.
 * @spec MAN-006
 */
export function xmlDocumentSave(doc: XmlDocument, path: string): void {
  writeFileSync(path, saveBytes(doc));
}
