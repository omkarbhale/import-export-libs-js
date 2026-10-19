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

/** `System.IO.IOException`: the base of the file-system failures the engine catches (IMP-011). */
export class IOException extends Error {
  override name = "IOException";
}

/** `System.IO.FileNotFoundException`. */
export class FileNotFoundException extends IOException {
  override name = "FileNotFoundException";

  /** `message` replaces the file system's own text for a caller that throws the exception with a message of its own (LP-010). */
  constructor(
    readonly fileName: string,
    message?: string,
  ) {
    super(message ?? `Could not find file '${fileName}'.`);
  }
}

/** `System.Collections.Generic.KeyNotFoundException`: the indexer of a `Dictionary` for a key it does not hold (LP-021, LP-043). */
export class KeyNotFoundException extends Error {
  override name = "KeyNotFoundException";

  constructor() {
    super("The given key was not present in the dictionary.");
  }
}

/** `System.IO.DirectoryNotFoundException`. */
export class DirectoryNotFoundException extends IOException {
  override name = "DirectoryNotFoundException";

  constructor(readonly path: string) {
    super(`Could not find a part of the path '${path}'.`);
  }
}

/** `System.IO.PathTooLongException`: a path or a path segment .NET Framework 4.8 refuses (EXP-420, EXP-421). */
export class PathTooLongException extends IOException {
  override name = "PathTooLongException";

  constructor() {
    super(
      "The specified path, file name, or both are too long. The fully qualified file name must be less than 260 characters, and the directory name must be less than 248 characters.",
    );
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

/** `System.InvalidOperationException`, which wraps the failure of a package in the import (IMP-407). */
export class InvalidOperationException extends Error {
  override name = "InvalidOperationException";

  constructor(
    message: string,
    readonly innerException?: unknown,
  ) {
    super(message, innerException === undefined ? undefined : { cause: innerException });
  }
}

/** `System.OperationCanceledException`: what 14.35's `ImportPackage` throws when a cancel ended the package (IMP-409). */
export class OperationCanceledException extends Error {
  override name = "OperationCanceledException";
}

/** The manifest's platform limit: a Windows path that the host cannot open (MAN-033). */
export class PathNotUsableError extends Error {
  override name = "PathNotUsableError";

  constructor(readonly path: string) {
    super(`The path '${path}' names a drive or a network share, and cannot be used on this platform.`);
  }
}
