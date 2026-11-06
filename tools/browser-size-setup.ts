import { ensureSynthPackages, requestedSizes } from "./browser-size.js";

/**
 * The global setup of the `size` project (HOST-278): the packages of the sizes asked for (`LIBSJS_SIZE_MB`) are written to
 * `.synth/` if they are not there, before any browser starts.
 *
 * @spec HOST-277 HOST-278
 */
export default function setup(): void {
  for (const info of ensureSynthPackages(requestedSizes())) {
    console.info(`${info.zip}: ${info.count} items, ${(info.bytes / 1e6).toFixed(1)} MB of item files, ${(info.zipBytes / 1e6).toFixed(1)} MB zipped`);
  }
}
