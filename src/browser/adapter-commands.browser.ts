import { commands } from "vitest/browser";

/**
 * The commands that choose and drop files in a page and write the reference zip, as a test in a page calls them (HOST-267). The
 * Vitest server runs them (`adapterCommands` of `tools/browser-vitest.ts`); the page names an `<input type="file">` or a drop target by a
 * selector, and the files are the ones of `fixtures/` or a folder the command makes.
 *
 * @spec HOST-267
 */
declare module "vitest/browser" {
  interface BrowserCommands {
    chooseFixtureInput(selector: string, paths: string | string[]): Promise<void>;
    chooseManyFilesFolder(selector: string, count: number): Promise<void>;
    dropFixtureOn(selector: string, paths: string | string[]): Promise<void>;
    dropManyFilesFolderOn(selector: string, count: number): Promise<void>;
    zipFixtureFolder(dir: string, level: number): Promise<string>;
  }
}

/** Chooses a fixture folder (alone) or fixture files in the input that the selector names, as a user does in the dialog. */
export const chooseFixtureInput = (selector: string, paths: string | string[]): Promise<void> => commands.chooseFixtureInput(selector, paths);

/** Chooses a generated folder of `count` small files, and an empty folder, in the input that the selector names. */
export const chooseManyFilesFolder = (selector: string, count: number): Promise<void> => commands.chooseManyFilesFolder(selector, count);

/** Drops fixture files or a fixture folder on the element that the selector names, as the operating system does (Chromium only). */
export const dropFixtureOn = (selector: string, paths: string | string[]): Promise<void> => commands.dropFixtureOn(selector, paths);

/** Drops a generated folder of `count` small files, and an empty folder, on the element (Chromium only). */
export const dropManyFilesFolderOn = (selector: string, count: number): Promise<void> => commands.dropManyFilesFolderOn(selector, count);

/** The zip that the Node build writes of a fixture folder, as base64. */
export const zipFixtureFolder = (dir: string, level: 0 | 6): Promise<string> => commands.zipFixtureFolder(dir, level);
