/**
 * The case tables of `host-path.test.ts` (MAN-004, MAN-033), kept here as data so that `fs-matrix.test.ts` runs the same rows on
 * both file systems (HOST-217). `host-path.test.ts` imports them.
 * @spec HOST-217
 */

/** Paths with a character `Path.GetFullPath` refuses: the exception is `Illegal characters in path.` (MAN-004). */
export const ILLEGAL_FULL_PATHS = ["a|b", "a<b", "a>b", 'a"b', "a\tb", "a?b", "a*b", "a\\*\\b"];

/** Paths with a colon where .NET's format check refuses it: `The given path's format is not supported.` (MAN-004). */
export const COLON_FORMAT_PATHS = ["C:\\x:y", ":x", "1:\\x", "ab:\\x", "C::", "C:\\a\\:b"];

/** A drive and a share, which have no meaning on a host that is not Windows (MAN-033, HOST-216). */
export const DRIVE_AND_SHARE_PATHS = ["C:\\abs\\x", "D:rel", "\\\\host\\share\\x"];
