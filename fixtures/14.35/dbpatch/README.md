# 14.35 DB patch fixtures

Recorded from engine 14.35.0.43890 on the dev instance (Aras 12 SP9), by the oracle's `dbpatch` command. Every run applies the one committed no-op patch (`oracle/dbpatch/`, DBP-070) and deletes the three items it creates: a `DatabaseUpgrade` row for release `99.99`, an "Applied Updates" item numbered `LIBSJS-SCRATCH-001`, and the `DatabaseUpgradePatch` link. Each case README lists the ids created and deleted.

- The oracle runs no other patch (DBP-071): it checks both files against their committed digests, refuses another tool name, and needs release `99.99` and the number to be absent first.
- The engine accepts the login `root` only; the `non-root` case logs in as `admin`.
- Not here: a patch with an XML declaration (DBP-092), a failing patch or a malformed manifest. They would need a second, uncommitted patch, which the guard refuses; they stay rules inferred from the code.
- The dev state a case ran against can change. `run.json` carries the time of each run.
- Re-record with `ARAS_PASSWORD=… npm run oracle:dbpatch-cases` (see `--help`).

| Case | What | Steps | Calls | Created |
|---|---|---|---|---|
| [non-root](non-root/README.md) | The login is not root | 1 | 6 | 0 |
| [apply](apply/README.md) | The no-op test patch, applied and applied again | 2 | 31 | 3 |
