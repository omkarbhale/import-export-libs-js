/**
 * What the replays of the recorded `lpimport` runs share: the disk replay (`lp-import.replay.test.ts`) and the replay on the in-memory
 * file system (`src/browser/vfs-replay.*.test.ts`, HOST-218). These were private to the disk test and moved here unchanged.
 */

export const RANDOM = "abcdefgh.xyz";

const CLOCK = /\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d/g;

/** The log with what is the run's own replaced: the header's paths, the fixes file, and every date-time. */
export function comparable(log: string): string {
  return log
    .replace(/^(Manifest file: ).*(\r)$/m, "$1<manifest>$2")
    .replace(/^(Log file: ).*(\r)$/m, "$1<log>$2")
    .replace(/^(Working directory: ).*(\r)$/m, "$1<working>$2")
    .replace(/^(Language pack: ).*(\r)$/m, "$1<pack>$2")
    .replace(/^File full name '.*[\\/]([^\\/']+)'(\r?)$/gm, "File full name '<fixes>/$1'$2")
    .replace(CLOCK, "<time>");
}

/** What the oracle host wrote to the console: the lines of `host.log` between the engine banner and `HOST_EXIT`. */
export function recordedConsole(hostLog: string): string {
  const afterBanner = hostLog.slice(hostLog.indexOf("\r\n") + 2);
  return afterBanner.slice(0, afterBanner.lastIndexOf("HOST_EXIT"));
}
