> **0.6.0 update:** [THINKING.md](THINKING.md) defines inclusive output, nullable split fields, reference-only private DB semantics, and measurement/export compatibility. Earlier examples below use OUT to mean total output (new BILLABLE OUT).

# Pricing and history contract — 0.5.0

## Normalized pricing

Amounts are stored as integer pico-USD strings. A component costs `tokens * round(USD_per_million * 1_000_000)` pico-USD. Public outputs expose floating USD for display, but addition is performed on integer amounts first. Display rounding can change the final visible digit.

Components: normal input, cache read, cache write 5m, cache write 1h, cache write unknown TTL, output (includes reasoning only once). A missing component has null cost and a typed reason; a zero count is not a missing charged amount. Invalid input does not invalidate output; legacy invalid output does not invalidate input. Unknown total is never replaced by a known subtotal internally. UI explicitly labels the latter 계산분.

For Antigravity, field-3 output is authoritative within the supported private layout. Raw total/detail counters are retained. Prior-parser repairs may reduce overcounted output; normal stale streaming snapshots still cannot erase observed consumption. Manual reanalysis is an explicit correction path and appends revisions. Model mapping changes are not inferred from model names being similar.

Checked standard rate precedence: explicit custom > checked official builtins > community/provider catalog > other builtins. This does not verify undocumented token accounting or actual subscription charges. GPT-6 short-context rules remain reference-only because no supported threshold was confirmed. Pricing source and model-mapping source must be displayed separately.

## Journal: token-meter.usage-log.v1

Stored at `usage-log/YYYY-MM.jsonl`, by UTC observation month. Each line:

```
{schema, seq, revision, id, change, observedAt, fingerprint, event}
```

`change` is import/observed/revision. `event` is the complete whitelisted latest snapshot. `seq` is global within this data directory; `revision` is per request. `fingerprint` is SHA-256 of the canonical serialized safe event. Hashing detects unexpected changes; it is not authentication against the same OS user who can rewrite both data and hash.

A startup import records previously retained latest values only. Old revision history cannot be invented. Events are journaled before the ledger checkpoint is atomically replaced. On append failure the save fails and the next append first rereads the journal to discover any partially successful operation. A truncated final incomplete line is copied to `.torn-*` then truncated to the last completed newline. A corrupted complete line fails closed. Symlink journal directories/files are refused; OS-user compromise is outside the protection boundary.

The journal can restore latest usage if ledger.json is missing, but not source checkpoints, tasks or separate measurement state. Back up the entire data directory for complete recovery. There is no automatic age deletion. More history increases disk and in-memory costs. No multi-process writer is supported; collector.lock enforces a single writer per data directory.

## History API

API requires the current loopback bearer key and valid Host/Origin. All-time is the default; dates use configured timeZone and omit events without request timestamps. No-date search still shows undated events. `limit` is 1–200; cursor contains last sort key and query hash. A changed filter invalidates the cursor. Newer arrivals do not cause offset-pagination duplicates. A record whose timestamp is repaired may move; return to the first page for a new view. This is a live local query, not a server-wide snapshot-isolation cursor.

CSV/JSONL exports ignore the page limit and include all matching **latest requests**. JSONL export schema is token-meter.usage.latest.v1 and intentionally differs from the revision journal. CSV escapes spreadsheet-formula-like fields. Export construction and all-time sort currently use memory; not validated for millions of events.

## Privacy

Retained: model and raw model label, enum ID, request/session/project metadata, times, tokens, cost components, source URL, calculation and mapping provenance, sanitized warnings. Excluded: prompt/response/code text, tool arguments, source BLOBs, API keys/auth tokens. Readers may encounter body bytes in memory or the Python IPC pipeline before extracting metadata. Metadata still may be sensitive.

## Verification scope

Synthetic CLI/SQLite fixtures, real local HTTP, filesystem persistence, mocked VS Code API and restricted browser render bridge. No actual user's DB or provider billing account was accessed. Source-reference meanings and live account billing are not certified by synthetic tests.
