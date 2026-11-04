import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The adapter's handle types are a part of the DOM's (HOST-252, HOST-253), so a real `FileSystemDirectoryHandle` must be accepted as
 * it is. This compiles `fsa-dom.check.ts`, which assigns the DOM handles to them, and `fsa.ts` with it, with the options of
 * `tsconfig.browser.json` (the DOM library, `types: []`: no Node types) and the async-iterable DOM library that `values()` is in.
 * Zero diagnostics means the adapter is typed for the browser and accepts the real handles.
 */
describe("the File System Access adapter against the DOM types", () => {
  it("compiles in the browser project with the DOM handles assigned to its handle types", () => {
    const configPath = path.join(root, "tsconfig.browser.json");
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, configPath);
    const options: ts.CompilerOptions = { ...parsed.options, lib: [...(parsed.options.lib ?? []), "lib.dom.asynciterable.d.ts"] };
    const program = ts.createProgram({ rootNames: [path.join(root, "src/browser/fsa-dom.check.ts")], options });
    const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    expect(diagnostics).toEqual([]);
    const compiled = program.getSourceFiles().map((file) => path.relative(root, file.fileName).split(path.sep).join("/"));
    expect(compiled).toContain("src/browser/fsa.ts");
  }, 60_000);
});
