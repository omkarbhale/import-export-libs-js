# Hold: `GenerateHashtableFromManifest`

**What it is.** A public helper that reads an `imports.mf` manifest and returns a .NET `Hashtable` of packages and their items. A host can use it to build the export request.

**Why it is held.** Libs never calls it on import or export. The CLI's `export --package` resolves package membership from the server instead (round 2, Q4). The manifest reading and ordering that import does use is in scope, under `MAN-` rules.

**What would bring it in.** A host-facing need to re-export exactly what an existing manifest lists, for example an `export --from-manifest` option. It would reuse the `MAN-` reader and the `Hashtable` order emulation.
