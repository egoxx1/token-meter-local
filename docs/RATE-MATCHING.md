# Model–tariff binding contract · 0.7.1

## Identity before reuse

`checkRateBinding(event, snapshot)` compares the actual `baseRule.models` (or legacy models array) against the observed model, not only `resolvedModel`. Supported normalization remains exact model IDs, explicitly permitted YYYYMMDD / YYYY-MM-DD suffixes and Google's `models/` prefix. `exactOnly` disallows date fallback. There is no fuzzy, substring or nearest-model tariff selection.

The check also covers explicit billing provider, tool scope, Standard/Fast/Batch/Flex compatibility, effective timestamp boundaries and an explicitly local Ollama free tariff. A reference rule matching a numeric Antigravity ID is still based on the earlier unofficial mapping; this check does not certify that mapping itself.

Tool-scoped user rules do not implicitly become cross-tool rules. Explicit wildcard rules need a billing provider. A tool-specific custom rule that omits modelProvider retains the existing intentional custom-override semantics within that tool, and is labeled user-supplied rather than a first-party price guarantee. Newly resolved snapshots retain the observed supplier for later reuse checks.

`priceEvent` rejects incompatible snapshots and selects a rule for the observed request. If none is available it retains unpriced state rather than a previous model's money. Valid historical same-model rules continue to be used. Context bands use the whole request input, and timestamp/context-only updates no longer skip repricing solely because cumulative token numbers did not change.

## Evidence and persistence

Pricing engine version is 4; ledger schema remains 2. Snapshots retain `matchedModel`, `resolvedProvider` and `resolvedTool`; price objects carry `binding` with status, observed identity, tariff identity, normalization kind and typed reasons. A rejected prior binding is retained as `rejected`. The journal copies only allowlisted metadata. Startup backs up `ledger.pre-0.7.1.json` once and journals corrected snapshots before updating the ledger checkpoint.

The audit is not an invoice reconciliation, a signed catalog attestation or a correction of every possible bad price number. A model's own rule can contain a stale or user-entered number while passing identity validation. Matching tariff numerics against today's catalog is a separate `differentFromCatalog` indication, not automatic evidence of corruption.

## UI units and modes

Applied rate panel: user-selectable per million or per thousand, no change to spend. Search catalog: all columns always per million (including writes), as stated in the header. Search results display and search tariff mode/long-context availability. Batch/Flex entries no longer look like unexplained duplicate prices. Observed and applied model labels are separate, with provider, mode, source and validity information.

Frozen ended measurements are not silently rewritten. Their stored summaries can therefore retain old calculations; current latest-request audit does not claim to re-audit every frozen snapshot. This is intentional preservation rather than erasing historical experimental results.

## Read-only audit

`GET /api/pricing/audit` uses the existing loopback bearer + Host/Origin protections. No external endpoint is called; POST has no write implementation. It reports the latest observed events, max 50,000 scanned and 1,000 prioritized detail records, with completeness/returned limits explicit. The current dashboard uses all-time/all-tools. The report includes request IDs, timestamps, model/provider/tier, tariff models, applied/candidate rates, source and correction evidence. It excludes prompts, responses, code bodies, auth tokens and source DB BLOBs. Source labels/metadata may still be sensitive.

## Verification scope

New regression tests exercise deliberate inconsistent saved snapshots (including a false resolved label), provider/mode/date mismatch, tool-scope isolation, local-vs-remote, missing-model refusal, aliases, historical rule preservation, migrations/revisions, equal-count context/time corrections, API auth/read-only behavior and export allowlists. They prove those code paths, not that the user's specific symptom took those paths.

Tests do not prove correctness of undocumented Antigravity protobuf field meanings or all external catalog rates. Official pricing pages were reviewed for the previously used core examples, but no new model prices are introduced in this patch. No actual user ledger or account billing data was available.
