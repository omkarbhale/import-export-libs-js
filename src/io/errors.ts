/**
 * The .NET exception types that the manifest, path and file-system rules raise. The message of each is the .NET
 * Framework text, because the engine lets these exceptions reach its log unchanged (MAN-003, MAN-032).
 * `ArgumentException` and `NotSupportedException` are the XML core's classes.
 */
import { ArgumentException, NotSupportedException } from "../xml/errors.js";

export { ArgumentException, NotSupportedException };

/** `System.ArgumentNullException`: `Value cannot be null.` with the parameter name on a second line. */
export class ArgumentNullException extends Error {
  override name = "ArgumentNullException";

  constructor(
    readonly paramName: string,
    summary = "Value cannot be null.",
  ) {
    super(`${summary}\r\nParameter name: ${paramName}`);
  }
}

/** `System.NullReferenceException`, the engine's answer to a null it does not check. */
export class NullReferenceException extends Error {
  override name = "NullReferenceException";

  constructor() {
    super("Object reference not set to an instance of an object.");
  }
}

/** `System.IO.FileNotFoundException`. */
export class FileNotFoundException extends Error {
  override name = "FileNotFoundException";

  constructor(readonly fileName: string) {
    super(`Could not find file '${fileName}'.`);
  }
}

/** `System.IO.DirectoryNotFoundException`. */
export class DirectoryNotFoundException extends Error {
  override name = "DirectoryNotFoundException";

  constructor(readonly path: string) {
    super(`Could not find a part of the path '${path}'.`);
  }
}

/** `System.UnauthorizedAccessException` for a path. */
export class UnauthorizedAccessException extends Error {
  override name = "UnauthorizedAccessException";

  constructor(readonly path: string) {
    super(`Access to the path '${path}' is denied.`);
  }
}

/**
 * A plain `System.Exception`, the type the engine wraps other failures in (MAN-032). `innerException` is the original.
 */
export class Exception extends Error {
  override name = "Exception";

  constructor(
    message: string,
    readonly innerException?: Error,
  ) {
    super(message);
  }
}

/** The manifest's platform limit: a Windows path that the host cannot open (MAN-033). */
export class PathNotUsableError extends Error {
  override name = "PathNotUsableError";

  constructor(readonly path: string) {
    super(`The path '${path}' names a drive or a network share, and cannot be used on this platform.`);
  }
}
