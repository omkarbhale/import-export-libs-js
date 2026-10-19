import { DotNetException } from "../client/dotnet.js";
import { CItemException } from "../client/fault.js";

/** The .NET type names of the exceptions that can end the steps of an `lpimport` (LP-003). */
const TYPE_NAMES: Readonly<Record<string, string>> = {
  ArgumentException: "System.ArgumentException",
  ArgumentNullException: "System.ArgumentNullException",
  NullReferenceException: "System.NullReferenceException",
  FileNotFoundException: "System.IO.FileNotFoundException",
  DirectoryNotFoundException: "System.IO.DirectoryNotFoundException",
  IOException: "System.IO.IOException",
  PathTooLongException: "System.IO.PathTooLongException",
  UnauthorizedAccessException: "System.UnauthorizedAccessException",
  KeyNotFoundException: "System.Collections.Generic.KeyNotFoundException",
  XmlException: "System.Xml.XmlException",
  XPathException: "System.Xml.XPath.XPathException",
  NotSupportedException: "System.NotSupportedException",
  InvalidOperationException: "System.InvalidOperationException",
  Exception: "System.Exception",
  AggregateException: "System.AggregateException",
};

/** The full .NET type name of an exception, as `Exception.GetType().FullName` gives it. */
export function dotNetTypeName(error: unknown): string {
  if (error instanceof DotNetException) return error.typeName;
  if (error instanceof CItemException) return "Aras.Tools.SolutionUpgrade.CItemException";
  if (error instanceof Error) return TYPE_NAMES[error.name] ?? error.name;
  return "System.Object";
}

/** `Exception.ToString()` without the stack trace, which the port has no counterpart of: the type name and the message. */
export function exceptionText(error: unknown): string {
  return error instanceof Error ? `${dotNetTypeName(error)}: ${error.message}` : String(error);
}
