# Identity, repair and reconciliation contract — 0.10.0

## Identity v4

Canonical Antigravity identity is `(session basename, source table, idx, retry position)` hashed into the public event ID. A generation's root field 4 is never an invocation identity. It is counted, hashed, only for repeated-group diagnostics. All generation candidates are indexed before steps.

Different primary rows are retained even if a response/provider/message identity is reused. Reuse is diagnosed. A step joins one unambiguous generation by its strongest available request identity, or its unique explicit root-field-2 step-index link. Ambiguous/unidentified standalone steps are excluded and reported. Known standalone steps are retained. Collector aliases contain canonical row keys only, never the parent/group or weak message ID. Late metadata may retain a previously observed step ID via its unique row alias without adding a second invocation.

This design assumes a generation row and its retry positions are stable within the supported session layout. Renumbered, rewritten, forked histories without stable identity evidence are not universally supported. Row count alone is not proof of a real provider request count. Configuration/zero-usage records are not charged calls.

Counters are not inflated using duration, context occupancy or text length. Existing private field3 whole-output and reference field9/10 split rules are preserved. Cache field presence is explicit. The Codex parser (`src/parsers.js`), pricing engine and price JSON are byte-identical to 0.9.1.

## Session repair

Only legacy Antigravity sessions (`identityVersion != 4`) are replaced. The active ledger is copied to `ledger.pre-0.10.0.json` before modification. Source errors or no usable new usage refuse destructive replacement. Source partiality from ambiguous steps remains visible in the repair report.

A durable `identity-repair-plans.json` records old IDs and provably one-to-one baseline transfers before retirement. Old records receive zero-valued `retired:true` journal revisions; new canonical records are appended. Latest-view journal replay excludes retired records, so old merged consumption is not reimported after a crash or missing non-epoch ledger. Old revisions remain available for audit. Never sum every line in the journal; use the latest revision per ID and exclude retired entries.

Failure after writing retirement records but before the ledger checkpoint is tested, both with and without an active reset epoch. A pending durable plan is resumed against the original DB; if no source exists, the pending state remains a warning rather than fabricated restored usage. No app can recover deleted source counters solely from a merged maximum.

## Reset and measurement boundaries

The reset epoch, configured roots and other providers are preserved. Safe one-to-one old baselines transfer. Where an old merged record represents many new rows, source request time is the conservative boundary: pre-reset calls get a reconstructed baseline, post-reset calls are included, undated calls are excluded/diagnosed.

The prior merged event did not preserve per-call counters at the reset instant. Exact split of an in-flight call across that historic instant is unrecoverable from such a baseline alone. Reports expose `timeReconstructedBaselines` and the limitation; they do not move the reset backward to make numbers larger.

Running measurements can transfer known old counters to their new IDs and otherwise use their existing timestamp boundary. Affected measurements receive a qualification. Frozen results remain unchanged. A frozen legacy Antigravity result gets a prominent warning in its view, not an overwritten historical value.

## Two views, one underlying history

`dataset=active` uses the current epoch. `dataset=source` is allowed only for `scope=session` and uses retained absolute source counters. Selecting source does not reset, import or charge the active epoch. Selected sessions outside the 500-entry summary menu are still kept selectable; the catalogue is separately available.

`IN` in the four-column UI means normal input. `scopeInfo.inputTotal` means inclusive input: normal + read + write. `OUT` includes thinking exactly once. `source` is local retained evidence, not an account-wide guaranteed complete history. Explicit scope labels prevent default all-provider totals being compared as if they were one CLI session.

## Local verification

`POST /api/reliability/verify` accepts a known Antigravity session ID, not an arbitrary path. The server scans, then opens configured/discovered DBs read-only and compares a fresh snapshot to the stored full-source view. Active-epoch totals are reported separately. Up to four discovered copies are read; a larger set is explicitly limited. Unstable snapshots/partial schemas cannot produce an unqualified match.

Known canonical row aliases support late generation/step linkage without false ID mismatch. Missing, different and retained-only counts are separate. A retained-only event may be legitimate history after the source was pruned. The local verifier reuses the supported reader; this is not independent proof that the private field semantics are correct.

`scripts/verify-antigravity.py` is a separate Python/SQLite/protobuf implementation, with no JS imports or alias map. It enumerates `gen_metadata` main/retry counters without deduplication. It excludes standalone steps and epoch filtering. It is an independent arithmetic/identity oracle for the primary rows, but intentionally not an official-schema or billing oracle. Both implementations can share an incorrect private-field assumption; the docs do not hide this.

`POST /api/reliability/compare` is read-only manual comparison of a selected session and explicitly chosen meanings. `K/M/B` values use half the last display unit as a rounding tolerance; truncation requires separate attention. It never changes ledger numbers to match a CLI badge.

## Privacy and durability

The normal usage log contains metadata only. Safe diagnostic export excludes source paths, prompts, code, keys and full session IDs; it includes session hashes, model names, times and counts. Metadata may still be sensitive. Same-user malicious file rewriting is outside this tool's threat boundary. All endpoints retain loopback binding and bearer/Host/Origin validation.

A pending save is reported until its queued disk write has finished. Heavy scan/save cycles adjust the next automatic idle interval up to 60 seconds; no overlapping scans are introduced. A manual scan remains possible. The underlying full JSON ledger has high memory costs for large histories; adaptive polling is not a replacement for a database migration.

## Verification versus guarantees

The release includes synthetic SQLite scenarios, a separately coded oracle, failure injection, epoch/restart regression and browser app/API checks. The user's referenced original DB, macOS VS Code and account were not accessible. Tests certify the exercised cases, not all application versions, all private schema layouts or real provider billing.
