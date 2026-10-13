# Hold: `applySQL` outside 14.35's lpimport path

**What it is.** `CItemHelper.applySQL`, a wrapper over IOM's `applySQL` that runs raw SQL on the server.

**Why it is held.** Neither 12.0 nor 14.0.7 reaches it on import or export. 14.35 does use ApplySQL, but only on the language-pack (`lpimport`) path, when it writes translations for servers below 14.0 SP22. That use is in scope, and its rules belong to the language-pack spec (`LP-`). Only the general-purpose wrapper is held.

**What would bring it in.** A reachability walk on a new build that finds `applySQL` on an in-scope path, or a captain request for a raw-SQL command. Raw SQL is destructive by nature, so either case needs a captain decision first.
