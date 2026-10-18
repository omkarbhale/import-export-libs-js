/**
 * The path of `Result` below the envelope that every read of an answer starts with: `Envelope`, `Body` and `Result` are
 * matched by local name, in the SOAP namespace or in none (IMP-130, IMP-313).
 */
export const RESULT_PATH =
  "*[local-name()='Envelope' and (namespace-uri()='http://schemas.xmlsoap.org/soap/envelope/' or namespace-uri()='')]" +
  "/*[local-name()='Body' and (namespace-uri()='http://schemas.xmlsoap.org/soap/envelope/' or namespace-uri()='')]" +
  "/*[local-name()='Result' and (namespace-uri()='http://schemas.xmlsoap.org/soap/envelope/' or namespace-uri()='')]";
