# Reset / deletion data contract — 0.8.0

## Measurement deletion

`POST /api/measurements/delete` accepts either `ids` (1–500, confirmation `삭제`) or `all:true` (confirmation `측정 전체 삭제`). The endpoint allows a bounded 64 KiB body for 500 generated UUIDs; other JSON mutation endpoints retain 16 KiB limits. All existing loopback bearer/Host/Origin checks apply. GET never mutates.

Delete removes active runs, including running, ended, archived and cancelled records, from `measurements.json`. It clears a deleted pin and the last-reset undo, preventing resurrection through undo. Usage ledger/journal/tasks remain unchanged. There is no automatic final result snapshot for a deleted running measurement, and no provider process is stopped. Existing mutation serialization, backup-before-replace and memory rollback on failed writes are retained. Deleting an unknown ID is idempotent. Backups may retain the previous contents; this is not secure erasure.

## Active data epochs

`POST /api/data/reset` requires confirmation `전체 초기화`, a UUIDv4 requestKey and the expectedEpochId (from epochId) read from authenticated `GET /api/data/state`. Repeating the same committed requestKey is idempotent; a stale different epoch is rejected. The API serializes collection, ingest, task, measurement and reset writes. Reads during reset return a retryable 503 rather than a half-replaced dataset.

The old dataset is NOT destroyed. Settings, user prices and runtime ownership remain rooted at the configured data directory. A new data-epochs/UUID directory receives empty active events/tasks/measurements and a new usage journal; source checkpoints, absolute source counters and reset baselines are retained for exclusion. Data files are flushed before atomic active-data.json pointer replacement. Directory fsync is best-effort where the OS supports it. A committed marker records the previous directory. Missing/corrupt pointers or active files fail closed rather than silently loading old cumulative data.

Preparation or pointer write failure leaves the old active dataset usable; incomplete preparation directories may remain as non-active files. The committed pointer is the commit point, not the HTTP response. A failure to write the advisory post-commit marker produces a warning but does not claim rollback. Do not delete active-data.json/data-epochs. Versions before 0.8.0 do not implement this storage contract and must not be used on a reset data directory.

## Counter boundary

Before reset the collector scans/saves once. The boundary captures every observed source ID up to 100,000. Subsequent snapshots of a captured ID use positive input/output deltas relative to its absolute baseline. Cache/thinking composition must reconcile with the delta or receives the existing ambiguity warnings. Prices use the full request context and stored matching rate, never the smaller delta as a context-band proxy. Repricing or enriching counters without extra input/output cannot create new use.

New IDs with timestamp before the reset boundary or no timestamp are excluded. Their raw counter metadata can still be retained to avoid later accidental replay. Source records and parser identifiers remain authoritative within the supported schema: renamed/changing identities in an unsupported schema are not guaranteed globally deduplicable. A request which started before reset but grows afterwards is an observed delta. It is placed at the reset boundary in active history and retains sourceTimestamp plus reset-boundary-observed-delta warning, not a fabricated actual request start time. In-flight logs committed late cannot be perfectly assigned to wall-clock execution.

Raw source snapshots are separate from exposed active events. An explicit source correction can change a delta to zero; the latest zero revision replaces the previous visible delta without re-adding historical consumption. Journal entries include resetEpochId/resetDelta/sourceTimestamp when applicable. The previous journal stays in its old dataset; only the active epoch journal is queried/exported. Stable history cursor hashes include the epoch, so previous-epoch cursors are rejected. Older root history is not imported when an active pointer exists.

## Display & export

The header reset is distinct from `전체 0부터 재측정`, which only creates a comparison baseline. Newly reset active totals show zero as an observed-since-boundary amount, not proof that the provider account used nothing. Source discovery/health and model selection metadata are not themselves usage. A source row with no new requests may still show no observations. Date-scoped or task-scoped views retain their own filtering.

A deleted selected view falls back to cumulative status with a visible notice. Exporting a deleted measurement fails instead of silently exporting cumulative unrelated data. Deletion cleans local comparison selections; another tab's deletion/reset is detected during normal refresh. Global reset clears pinned measurements and current tasks. Source requests already sent to the LLM keep running normally.

## Backup/recovery/privacy limits

Old active files remain local backups. The new baseline/raw source map also contains old usage metadata. This is neither secure wipe nor disk-reclamation, and there is no backup-purge/automatic restore UI. Copy the ENTIRE data folder for backup, not ledger.json alone. Restoring files manually can lose changes; stop the collector first, preserve all data and assess the active pointer deliberately. Original provider logs are never edited.

No prompt, response, thinking text, source-code body or auth token is newly copied into usage/measurement backups by these operations. Usage metadata and user notes may remain sensitive. Same-user OS compromise is outside this local tool's isolation guarantees. Existing private Antigravity schema, missing counters, pricing caveats, runtime support, JSON-scale limitations and absent live invoice integration remain unchanged.
