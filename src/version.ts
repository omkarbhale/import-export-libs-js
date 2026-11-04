/**
 * The version of this package, `version` in `package.json`, which `src/version.test.ts` holds equal to it. The browser entry
 * exports it (HOST-260), so that a page or a Worker can say which build it loaded; it is written here and not read from
 * `package.json` so that the bundle carries one string and not the whole manifest.
 */
export const LIBRARY_VERSION = "0.0.0";
