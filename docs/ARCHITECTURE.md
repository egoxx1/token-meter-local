> **0.6.0 update:** [THINKING.md](THINKING.md) defines inclusive output, nullable split fields, reference-only private DB semantics, and measurement/export compatibility. Earlier examples below use OUT to mean total output (new BILLABLE OUT).

# Architecture · 0.5.0

## Auditable usage persistence and pricing

`src/usage-log.js` writes a monthly JSONL metadata journal. A unique ID has monotonically versioned observations; the journal is not a spend table to be summed. Safe whitelisted events and rate components are fingerprinted. An identical scan appends nothing. fsync precedes atomic ledger replacement with the journal sequence. On restart, journal revisions beyond that checkpoint replay into the latest view. Existing ledger data is imported before repair; the original ledger is backed up once. A torn final line is preserved before truncating this application's own journal, whereas complete malformed lines fail visibly.

`src/history.js` serves independent history filters, descending keyset cursors and latest-only exports. Search and paging still sort/filter the in-memory event map; this is not a SQLite analytics migration. The browser (`web/history.js`) keeps independent query state and does not jump from historical pages on live updates. It renders price components, reference/missing reasons and source links using DOM text APIs.

`src/pricing.js` v2 separates validity of input/output/categories, avoids counting disputed amounts as known cost, and distinguishes calculated/reference/partial/unavailable status. Model mapping evidence and pricing provenance remain distinct. Official checked snapshots outrank remote catalogs, while explicit user overrides stay labeled as such.

New protected endpoints:

```
GET  /api/history?from=YYYY-MM-DD&to=YYYY-MM-DD&provider=...&search=...&priceStatus=...&limit=50&cursor=...
GET  /api/history/detail?id=...
GET  /api/history/export.csv
GET  /api/history/export.jsonl
POST /api/antigravity/reanalyse
```

File schemas, failure behavior and privacy: [PRICING-HISTORY.md](PRICING-HISTORY.md).

## Prior architecture retained

### Measurements from 0.4.0

## Independent observation meters

`src/measurements.js` owns a version-1 `measurements.json` alongside the existing v2 ledger. It snapshots per-request counters, calculates positive usage deltas, applies exact source/model/effort/role/project filters, serializes atomic state changes with a previous-state backup, and freezes finished result events. It never deletes/rebases source events in the collector.

The collector’s existing read/scan path is reused before starting, resetting, stopping and undoing. New late-old or undated IDs are excluded; pre-existing IDs can contribute later positive deltas. Repricing/cache-only corrections cannot create new usage. Delta pricing uses the original full request context for tier selection; ambiguous cache reclassification yields unknown input cost.

`src/summary.js` shares aggregation with meters. `scope=measurement` uses a chosen/pinned meter rather than unrelated global time filters. Explicit measured zero is distinguished from no observed source records. Model group identity is a JSON tuple of source, billing provider, model, effort and role.

`web/measurements.js` adds baseline row inheritance, dialogs/history/comparison, clipboard fallback and export controls. Broader tool/global baselines can supply the newest applicable row baseline without deleting independent runs. `src/extension.js` adds six command-palette commands and pinned-status following. The terminal exposes corresponding `measure-*` commands.

All new endpoints are behind existing loopback authorization/Host/Origin checks:

```text
GET  /api/measurements
POST /api/measurements/start
POST /api/measurements/reset
POST /api/measurements/stop
POST /api/measurements/undo
POST /api/measurements/update
POST /api/measurements/pin
GET  /api/measurements/export.csv?ids=...
GET  /api/measurements/export.json?ids=...
POST /api/scan
GET  /api/status?scope=measurement&measurement=...
GET  /api/status?followPinned=1
```

Exported JSON omits baseline counters and raw per-event source paths; summaries still include scope/project IDs and user notes. User text is rendered with textContent and CSV fields use the existing formula-injection mitigation. Running meter computation is O(events) per meter: hard limits are guardrails, not performance benchmarks. No SQLite storage migration was performed.

## Existing collection architecture (retained from 0.3.0)

 — Token Meter 0.3.0

`src/collector.js` owns the v2 JSON ledger, scanning, stable normalized events and immutable pricing snapshots. Existing `src/parsers.js` handles Codex/Claude/legacy Gemini; `src/generic.js` handles explicit external usage.

Antigravity goes through `src/antigravity-db.js` in a worker. It opens supported SQLite DBs read-only and passes selected BLOBs into `src/antigravity-proto.js`. If Node lacks SQLite, `src/antigravity-sqlite.py` reads the same snapshot through a bounded private pipe. Neither reader persists conversation bodies. The worker returns only sanitized events and health. `docs/ANTIGRAVITY.md` defines evidence, field semantics and unsupported cases.

`src/pricing.js` normalizes USD-per-million rules, resolves recorded model/reference-provider identity, date bounds, cache costs and output prices, and stores integer pico-USD amounts. Existing requests retain their saved price snapshot; unknown-price requests can be filled after catalog updates. Antigravity costs are reference API equivalents, not charges.

`src/summary.js` applies period/tool/project/task filters and builds six-value IN/OUT/TOTAL counts and costs. `src/server.js` exposes the authenticated loopback HTTP API; `src/extension.js` and `web/app.js` are clients. `bin/cli.js` also provides status, watch and Antigravity diagnostics. VS Code runtime status does not establish that Antigravity's live model picker was read.

Catalog and signed program update engines are unchanged in purpose from 0.2.0. The public release feed and Marketplace are not configured. `scripts/package.py` packages the Python bridge with the JS worker, existing UI and documentation; no native SQLite binary or npm runtime dependency is bundled.

`test/antigravity-fixtures.js` and `src/demo-antigravity.js` generate explicitly synthetic data. Tests use temporary roots and demo setup does not fall through into the user's real logs.
