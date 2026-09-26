# Input / API rate data contract — 0.7.0

## Non-overlapping buckets

`input` retains its inclusive total meaning. `normalInput + cacheRead + cacheWrite = input` and `cacheWrite5m + cacheWrite1h + cacheWriteUnknown = cacheWrite`. `cacheWriteUnknown` is the generic write bucket (OpenAI rate) or an unknown-duration write bucket (Anthropic may require TTL). Pricing uses the supplier's separate rate, not a second charge on normal input.

Cost components are computed in integer pico-USD: `tokens * round(usdPerMillion * 1,000,000)`. A zero-token component has zero cost; a missing unit price remains null and is not presented as a free tariff. Inconsistent bucket totals invalidate input pricing independently of output pricing.

`cacheReadKnown`, `cacheWriteKnown`, `contextInputKnown` and `inputEvidence` preserve counter availability in the sanitized event/revision log. For cumulative Codex counters both endpoints must report optional cache fields to consider the delta's classification known. Missing cache-write details yield an explicit reference estimate: unreported tokens remain assigned to regular input; this does not claim that actual writes were zero. Negative or internally contradictory deltas remain incomplete instead of silently priced.

Claude general input is separate from cache buckets in the source and is added once. Optional counts cannot be derived from the prompt text. Google hourly cache storage is not a token-write tariff. Antigravity continues to use the prior unofficial database profile; this release adds visibility, not certification of private field semantics.

## Public fields

Summaries include `inputBreakdown` with rows for each disjoint component, exact counts, known/nullable full cost, applicable rates, and missing-counter/inconsistency counts. `apiRates` groups **stored applied** tariffs by model/provider/mode/source/conditions, with input components and output totals for each group. It is not the newest model catalog and not a blended average price.

Request views include `apiRate`, `inputBreakdown`, `priceUnitTokens: 1000000`, `priceCurrency: USD`, `rateInput`, `rateCachedInput`, `rateCacheWrite`, `rateCacheWrite5m`, `rateCacheWrite1h`, `rateOutput`, and separate component USD costs. These scalar fields are included in CSV; JSONL also carries structured evidence. The retained `output` field is billable output including thinking once. Public summary rate groups are derived on read, not copied to every ledger entry.

UI defaults to USD per **100만 / 1,000,000 tokens**. Selecting 1,000 tokens rescales displayed tariff only. Source calculations and exports remain per million. Never multiply a mixed-model total by one current model's tariff. The UI instead shows multiple groups. Zeroed measurements have no new applied tariff yet; a model row may explicitly show the cumulative history's tariff as a reference, not as new spend.

## Context-dependent GPT-6 prices

Official model pages checked 2026-09-25 describe >272,000 prompt tokens: input/cached/write x2, output x1.5 for the entire request. Equality to 272,000 is still the base band. This uses request `contextInput`, not period/session/measurement totals. An unknown request length or a cumulative delta exceeding the reported last request input is flagged, not inferred from aggregate tokens.

Standard per-million USD snapshots:
- gpt-6-astra: input10, cached1, writes12.5, output50.
- gpt-6-sol: input2, cached0.2, writes2.5, output10.
- gpt-6-luna: input0.1, cached0.01, writes0.125, output0.5.

Explicit Batch/Flex use one-half standard rates; explicit Fast uses twice standard rates. Reasoning effort is not a price tier. Regional charges, negotiated rates, non-token fees and actual subscription credits are outside this calculation; source tariffs and qualifiers remain visible.

Historical official short-context-reference snapshots are promoted to the verified context rule only when their baseline rates match. A user override, unknown older price, or incompatible source is not silently rewritten. Old ledger backup and journal revision preserve the previous calculation. Ended measurements remain unchanged; running measurement metadata-only changes do not create token deltas. Pricing engineVersion is 3; ledger schema remains 2 and journal remains token-meter.usage-log.v1 with additional allowlisted fields.

## Reproduction, not account verification

A test with 34 synthetic short Sol requests reproduces input3,257,447 = normal95,207 + cached3,162,240; output22,618 = response14,213 + thinking8,405. USD input0.822862 + output0.226180 = total1.049042. This is a mathematical explanation consistent with the screenshot under the stated tariff assumption. No original user source log or provider invoice was accessed.

## First-party sources checked 2026-09-25

- https://developers.openai.com/api/docs/models/gpt-6-sol — standard rates and per-request context condition.
- https://developers.openai.com/api/docs/models/gpt-6-astra — rates/conditions.
- https://developers.openai.com/api/docs/models/gpt-6-luna — rates/conditions.
- https://developers.openai.com/api/docs/guides/prompt-caching — cached vs written vs ordinary input; writes are not an additive ordinary-input surcharge.
- https://platform.claude.com/docs/en/about-claude/pricing — cache read and separate 5m/1h creation prices.
- https://ai.google.dev/gemini-api/docs/pricing — output includes thinking; cache storage has a separate hourly unit.

Web verification of these pages is not an end-to-end test of automatic catalog downloading. Antigravity's private schema remains an acknowledged limit. Actual provider usage/quota/credits need a separate supported source and cannot be derived with certainty from local tokens alone.
