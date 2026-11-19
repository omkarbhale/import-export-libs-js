/**
 * The string methods the Aras 12 client page replaces (its MicrosoftAjax), for the tests that run the library in such a page (HOST-283).
 * The replacements are those seen in an Aras 12.0 SP9 client: `startsWith` and `endsWith` that take the text to look for and ignore a
 * position. A call without a position gets the native answer from them; a call with one does not (`"a</b".startsWith("</", 1)` is
 * `false`).
 *
 * @spec HOST-283
 */

type StringMethods = Pick<string, "startsWith" | "endsWith">;

/* The bodies are the page's, so they use `this` and `substr` as it does. */
const MICROSOFT_AJAX: StringMethods = {
  startsWith(this: string, a: string): boolean {
    return !a.length ? true : a.length > this.length ? false : this.substr(0, a.length) == a;
  },
  endsWith(this: string, a: string): boolean {
    return !a.length ? true : a.length > this.length ? false : this.substr(this.length - a.length) == a;
  },
};

/** Replaces `String.prototype.startsWith` and `endsWith` as the Aras 12 page does; the function returned puts the natives back. */
export function patchStringsAsMicrosoftAjax(): () => void {
  const prototype = String.prototype as StringMethods;
  const natives: StringMethods = { startsWith: prototype.startsWith, endsWith: prototype.endsWith };
  prototype.startsWith = MICROSOFT_AJAX.startsWith;
  prototype.endsWith = MICROSOFT_AJAX.endsWith;
  return () => {
    prototype.startsWith = natives.startsWith;
    prototype.endsWith = natives.endsWith;
  };
}

/** Runs `run` with the strings patched as {@link patchStringsAsMicrosoftAjax} does, and puts the natives back however it ends. */
export async function withMicrosoftAjaxStrings<T>(run: () => T | Promise<T>): Promise<T> {
  const restore = patchStringsAsMicrosoftAjax();
  try {
    return await run();
  } finally {
    restore();
  }
}
