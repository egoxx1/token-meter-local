> **0.6.0 update:** [THINKING.md](THINKING.md) defines inclusive output, nullable split fields, reference-only private DB semantics, and measurement/export compatibility. Earlier examples below use OUT to mean total output (new BILLABLE OUT).

# Antigravity collector contract — 0.5.0

## Boundary

This is an independently written, read-only decoder for a **private local database layout**. It is not a Google-supported token accounting API. The implementation does not rename Gemini CLI records, estimate tokens from transcript text, scrape the UI, extract auth tokens or call an internal cloud API.

Default roots are `~/.gemini/{antigravity,antigravity-cli,antigravity-ide}/conversations`. `.db` files are supported; `.pb`-only history is detected but not decoded. Database filenames supply the session ID, so a copy retaining that filename and invocation IDs is recognized as the same session.

## Evidence used

Primary implementation references inspected on 2026-09-25:

- ccusage adapter README and parser, pinned commit `7e3a180c075192e49053b4ce9de52b3299c6abe2`:
  - https://github.com/ccusage/ccusage/blob/7e3a180c075192e49053b4ce9de52b3299c6abe2/rust/adapters/antigravity/README.md
  - https://github.com/ccusage/ccusage/blob/7e3a180c075192e49053b4ce9de52b3299c6abe2/rust/adapters/antigravity/src/parser.rs
- CodeBurn SQLite implementation (also independently treats field 3 as total; its 9/10 naming differs): https://github.com/getagentseal/codeburn/blob/34db32361d3b794bf6aadf9d2b51867113307aba/src/providers/antigravity.ts
- CodeBurn storage notes, pinned commit `34db32361d3b794bf6aadf9d2b51867113307aba`:
  - https://github.com/getagentseal/codeburn/blob/34db32361d3b794bf6aadf9d2b51867113307aba/docs/providers/antigravity.md
- Google developer prices (reference cost, not Antigravity charge): https://ai.google.dev/gemini-api/docs/pricing
- Native SQLite runtime contract: https://nodejs.org/api/sqlite.html

These projects are original implementers documenting what they read, **not an official promise by Google that the schema is stable**. Earlier public reverse-engineered token-field interpretations differ. This build uses the ccusage field interpretation below, checks total/breakdown consistency and identifies the source as a private schema. Synthetic fixtures validate our interpretation, not the provider's undocumented implementation.

Official Antigravity docs for https://antigravity.google/docs/cli/statusline/ describe context fields; https://antigravity.google/docs/cli/headless/ describes per-step versus session cumulative outputs. Those are **not** the data source of this collector. Context-window occupancy must not be summed as billed use. The transcript path documented for hooks is not proof of token-bearing transcript content.

## Selected field contract

Only the following metadata is decoded; unrelated payload fields are skipped without interpreting conversation text.

| Container | Field | Interpretation |
|---|---|---|
| `gen_metadata.data` root | 1 | ChatModel metadata |
| root | 4 | Optional generation identity |
| ChatModel | 4 | ModelUsage |
| ChatModel | 17 repeated, nested 2 | Retry usage |
| ChatModel | 19 / 21 | Recorded model string/display name |
| ChatModel | 3 | Numeric model enum; unknown enums are not assigned guessed names |
| ChatModel | 9 → 4 | Generation timestamp |
| `steps.metadata` | 9 | ModelUsage alternative observation |
| step | 28 repeated, nested 2 | Retry usage |
| step | 24 → 12 / 8 | Model string |
| step | 8, otherwise 1 | Timestamp |
| ModelUsage | 2 | Ordinary input, excluding caches |
| ModelUsage | 3 | Total output |
| ModelUsage | 4 / 5 | Cache creation / cache read |
| ModelUsage | 9 / 10 | Reasoning / visible output |
| ModelUsage | 7 / 11 / 12 | Message / response / provider-assigned identifiers |

IN = ordinary input + cache read + cache creation. OUT = recorded total, checked against reasoning + visible output. When field 3 is present, it remains the output total even when the 9/10 breakdown differs; the raw three fields and a detail-mismatch warning are retained. If field 3 is absent, the explicit breakdown is used. The old maximum-of-totals rule is no longer used. An unreparsed legacy conflict remains unpriced until evidence is available. Cache creation without TTL does not invent a TTL. All token types are metadata observations; modality-specific and non-token charges are outside the calculation.

Canonical strings or narrow family/version spellings can resolve reference prices. Versioned mappings explicitly cover 1318/1319/1320 (3.8 Flash High/Medium/Low), 1298/1299/1300 (3.7 Flash), and 1071/1072/1073 (3.6 Flash), plus corresponding placeholder_m IDs. Mapping evidence is pinned to ccusage above and is labeled reference-map, not an official stable enum. Other internal enums without a usable name show `antigravity-model-id-N`. ChatModel repeated field 20 is read only for the model_enum attribute; other attribute values are not stored. Recorded model selection is not a hook into the live model picker. No per-project or agent-parent relation is inferred in this build; roles are `unknown`.

## Identity, dates, privacy

Within a session, response/provider/message identity aliases merge generation/step observations. Repeated scans and copied DBs do not create new spend for an already observed ID. A generation lacking these IDs uses its generation ID or session/row index fallback; an identity-less step is not added because it may duplicate a generation. This is reported as partial coverage, not a measured missing-token percentage. History across completely renamed sessions without preserved IDs cannot be reconciled globally.

Timestamp-less events remain timestamp-less: all-time includes them; calendar and task buckets exclude them. We do not use a file's modification time as the request time. Existing known event timestamps and identity aliases survive subsequent scans. Source deletion does not erase the ledger.

Only normalized metadata crosses from the worker into the parent. A Python fallback may carry raw metadata BLOBs through a private pipe before decoding; nothing copies these BLOBs into the ledger or exports. Stored identifiers/paths are still potentially sensitive metadata. Source DB reads are read-only, with SQLite query-only mode and no extension loading. WAL is read as part of the live SQLite snapshot; `immutable=1` is intentionally not used because it can ignore current WAL state.

## Runtime and resource bounds

Native `node:sqlite` runs in a worker to avoid synchronous SQL blocking the dashboard's main event loop. If unavailable, the worker invokes a packaged Python 3 script using only stdlib sqlite3. BLOBs are length-bounded in SQL before transfer. Each complete DB scan is capped at 50,000 selected rows, 128 MiB aggregate selected metadata and 8 MiB per BLOB; a worker has a roughly 20-second deadline. Read failure discards the new snapshot and preserves previously observed records. Partial row decoding preserves identified valid rows with diagnostic counters.

Main DB + WAL size/mtime/ctime/inode detect change. SHM is checked for unsafe file types but its mutable read coordination timestamp is not used for change detection. No stored byte stream contains prompt text. Large DBs are re-read after changes rather than incrementally SQL-paged; long-running scale benchmarks are not part of this release.

## Not tested on actual installations

The code was tested on real temporary SQLite databases populated with synthetic protobuf fixtures and a synthetic demo, **not real Antigravity account traces or binaries**. Native SQLite and Python produce equal fixture results, but this does not establish compatibility with every desktop/CLI/IDE release. Windows/macOS, actual VS Code extension installation and OS PiP z-order remain untested.
