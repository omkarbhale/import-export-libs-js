# Hold: client-certificate login from the Windows certificate store

**What it is.** `CertificateUtils` and `HttpConnectorExtension` let a host log in with an X.509 client certificate picked from the Windows certificate store (`CurrentUser\My`, found by subject name by default). `CertificateUtils` can also probe whether the server requires a certificate over a raw TLS socket. 14.35 changes how the certificate is selected.

**Why it is held.** Only a host that sets the certificate context properties uses it. The import and export hosts in use today log in with a password. The Windows certificate store has no cross-platform equivalent, and the library carries its own OAuth password-grant client (round 1, Q3).

**What would bring it in.** A captain decision that client-certificate login is needed, for example for a server that requires mutual TLS. It would come in as a cross-platform option (a PEM or PFX file passed to the HTTPS agent), with `WIRE-` rules for each engine's certificate selection, and it would need a server to test against.
