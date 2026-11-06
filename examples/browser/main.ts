import { mountApp } from "./app.js";

/**
 * The entry of the reference page (HOST-280). It reads no query and no fragment, and writes nothing to storage (HOST-281).
 *
 * @spec HOST-280 HOST-281
 */
const root = document.getElementById("app");
if (root === null) throw new Error("index.html has no #app element");
mountApp(root);
