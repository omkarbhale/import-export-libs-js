import { describe, expect, it } from "vitest";
import { MESSAGE_TEMPLATES, createMessagesFactory, getMessage, type SentMessage } from "./messages.js";

describe("the message catalogue (EXP-504)", () => {
  it("formats a template with its arguments, a null argument as nothing", () => {
    expect(getMessage("ItemIndexOfCountTypeNameKeyedName", "1", "3", "List", "Report Format Types")).toBe("Item 1 of 3: List - Report Format Types");
    expect(getMessage("ExportingPackagePackageName", null)).toBe("Exporting package ");
    expect(getMessage("From", "a")).toBe("From:\ta");
  });

  it("gives the empty string for a key with no template, and the template as it is without arguments", () => {
    expect(getMessage("NoSuchKey", "x")).toBe("");
    expect(getMessage("ExportingPackagePackageName")).toBe("Exporting package {0}");
  });

  it("does not format twice: braces in an argument stay", () => {
    expect(getMessage("ErrorMessageFailedToFindReferencedElementsForPackageName", "{1}", "p")).toBe("{1}; Failed to find referenced elements for package 'p'");
  });

  it("holds the spacing of the texts the log and the host see", () => {
    expect(getMessage("ErrorOfExportingItemIdKeyedNameType", "I", "K", "T")).toBe("Error of exporting Item id :I  keyed_name : K    type : T");
    expect(getMessage("ItemIdKeyedNameTypeSuccessfullyExported", "I", "K", "T")).toBe("Item id :I  keyed_name : K   type : T successfully exported");
    expect(getMessage("ExportSolutionName", "pkg")).toBe("         ****Export pkg****");
    expect(getMessage("ErrorMessageMessage", "m")).toBe("          ****ErrorMessage****\r\n       m");
    expect(getMessage("ErrorMessageStringDetailCode", "s", "d", "0")).toBe("      ******Error message******\r\nfaultstring: s\r\nfaultdetail: d\r\nfaultcode:   0\r\n     **********************");
  });
});

describe("the library's messages factory (EXP-503)", () => {
  const run = async (onItemError?: "continue" | "abort-package") => {
    const sent: SentMessage[] = [];
    const factory = createMessagesFactory({ onMessage: (message) => void sent.push(message), ...(onItemError ? { onItemError } : {}) });
    const answers = [
      await send(factory.getCurrentPackageMessage(), "one"),
      await send(factory.getStatusMessage(), "two"),
      await send(factory.getErrorMessageQuestion(), "three"),
      await send(factory.getWarningMessage(), "four"),
      await send(factory.getErrorMessage(), "five"),
    ];
    return { sent, answers };
  };
  const send = async (message: { text: string; execute(): Promise<boolean | null | undefined> }, text: string) => {
    message.text = text;
    return message.execute();
  };

  it("sends each message on its channel and answers only the error question", async () => {
    const { sent, answers } = await run();
    expect(sent.map(({ channel, text }) => `${channel}|${text}`)).toEqual(["currentPackage|one", "status|two", "errorQuestion|three", "warning|four", "error|five"]);
    expect(answers).toEqual([null, null, false, null, null]);
  });

  it("answers true to the error question for abort-package", async () => {
    expect((await run("abort-package")).answers[2]).toBe(true);
    expect((await run("continue")).answers[2]).toBe(false);
  });

  it("reuses a message object: each use sends its current text", async () => {
    const sent: string[] = [];
    const status = createMessagesFactory({ onMessage: (message) => void sent.push(message.text) }).getStatusMessage();
    for (const text of ["a", "b"]) {
      status.text = text;
      await status.execute();
    }
    expect(sent).toEqual(["a", "b"]);
  });
});
