# Output / Thinking data contract — 0.6.0

## Meaning and conservation

The internal `output` counter retains its pre-0.6 meaning: normalized output including thinking exactly once. `total = input + output`. The new UI calls this **BILLABLE OUT**; its label is not evidence of an actual subscription charge.

`responseOutput` means **non-thinking output**, not literally visible text. It can include tool calls and formatting tokens. `thinkingOutput` is a numeric partition, never the thought text, summary, signature, or an estimate from wall-clock time.

For a supported known split, `responseOutput + thinkingOutput = output`. Missing parts are null, not zero. For mixed groups, public part totals are null, with `knownResponseOutput`, `knownThinkingOutput` and `unclassifiedOutput` accounting for the full observed output. The displayed known parts are labeled partial. An explicitly zero total can be split into two zeros unless contradictory nonzero details are supplied.

## Normalization sources

- OpenAI Responses: output_tokens already includes output_tokens_details.reasoning_tokens. Codex cumulative reasoning_output_tokens is differenced only when both endpoints have valid reasoning metadata. Optional details disappearing must not erase input/output deltas.
- Anthropic: output_tokens is used as total. Optional named thinking_tokens / reasoning_tokens detail is accepted when provided by a log/integration. Availability is not guaranteed across all CLI versions. No retokenizing of summary/text content.
- Gemini generateContent: candidatesTokenCount is combined with thoughtsTokenCount once. If thoughts are absent, the adapter does not manufacture them. An independently matching total can validate overall output but the absent split stays unknown.
- Gemini Interactions: **explicit format `gemini-interactions`**, total_output_tokens plus total_thought_tokens; cached tokens are part of input. The current importer requires a thought counter (including explicit zero), rather than assuming a missing one is zero. Tool-use accounting outside the known input/output total is warned about, not silently merged as thinking.
- Ollama: eval_count is retained as output; no guaranteed separate thinking counter is inferred.
- Normalized imports: output already includes thinkingOutput (or legacy reasoning). Contradictory aliases/invalid values are rejected.

## Antigravity is a reference, not an official schema

The supported reader retains field 3 as total output. The existing reference profile uses field 9 for thinking and field 10 for non-thinking output. **Public reverse-engineered implementations disagree about the names of fields 9/10.** Therefore even a valid numeric partition is `reference`, not `complete`. Sum equality cannot distinguish swapped field semantics.

With conflicting or absent details, the reader retains the total and records a split warning. A field-3 output count of 15 is not inflated merely because the input count was 235,000 or the model seemed to think for a long time. If the total is absent and only part of the output is available, outputTotalKnown is false, the value is marked partial, and the whole-output price is not confirmed.

Numeric original fields, split source/status/note are retained in the safe ledger and revision log. Duplicate generation/step records with incompatible split values are not accepted as an exact partition. The reader never substitutes a final session model or context-window size for unknown thinking.

Reference implementations already used by this project (not official Google contracts):
- https://github.com/ccusage/ccusage/blob/7e3a180c075192e49053b4ce9de52b3299c6abe2/rust/adapters/antigravity/src/parser.rs — 9 reasoning / 10 visible reference profile.
- https://github.com/getagentseal/codeburn/blob/34db32361d3b794bf6aadf9d2b51867113307aba/src/providers/antigravity.ts — differing detail interpretation. A sum test alone does not adjudicate it.

## Prices

No new charge is created. Whole-output pricing is computed once with the request's stored rate and context/fast-mode rules. `responsePico` and `thinkingPico` partition the already-resolved integer-pico output charge. Where this partition is defined, their sum equals outputPico exactly. These breakdowns are **non-additive** relative to the parent output cost.

A missing split is not automatically missing output cost: if total output and its unit rate are available, the total output charge remains usable. If a rate is unavailable, split tokens can still be shown while money stays null. Internal integer addition precedes display rounding. Rounded amounts can differ in their last shown digit.

## Persistence, migration and measurements

New safe fields: outputBreakdownVersion, responseOutput, thinkingOutput, outputSplitStatus, outputSplitSource, outputSplitNote, outputTotalKnown, rawThinkingTokens, rawResponseTokens, reasoningKnown. Historical `reasoning` is a legacy numeric field; do not interpret its 0 as verified without reasoningKnown/new split metadata.

Backup ledger.pre-0.6.0.json is created before a saved legacy ledger is upgraded. Old safe records are journaled before enrichment. The one-time checkpoint invalidation reparses retained source logs to distinguish explicit zeros from old defaults. Same-request detail enrichment is a revision, not a new bill. Deleted source logs cannot be reconstructed. Monthly revision logs are never summed directly; use latest record per ID.

Measurements capture split evidence at the baseline. Both endpoints must be known and their nonnegative deltas must sum to the output delta before they are split. Metadata-only enrichment cannot create new spend. Ended measurements remain immutable. A mixed/unknown old baseline cannot be magically completed by a new endpoint's thinking metadata.

JSON/CSV `output` remains normalized total for compatibility. New UI OUT is responseOutput. `billableOutput` is an explicit alias of output, not another additive quantity. Export consumers must not sum output + thinkingOutput or output + billableOutput.

## Validation is limited

Verified here: synthetic counters, actual temporary SQLite files with synthetic protobuf, actual local HTTP, migration/journal persistence, mocked VS Code API and browser app-render bridge. NOT verified: user's original DB, Google app version, account billing, installed Extension Host, Windows/macOS, OS PiP topmost behavior. More passing synthetic tests cannot resolve private field semantics.

Official accounting references checked 2026-09-25:
- https://developers.openai.com/api/docs/guides/reasoning — total output includes reasoning; non-visible formatting also exists.
- https://ai.google.dev/gemini-api/docs/thinking — output and thoughts reporting, full thinking rather than summary length.
- https://ai.google.dev/api/generate-content — legacy usage metadata fields.
- https://ai.google.dev/api/interactions-api — separate output/thought/cache counters and examples.
- https://platform.claude.com/docs/en/build-with-claude/thinking — thinking/summary distinction and output accounting. The presence of a separate numeric field in a particular CLI remains a runtime observation, not assumed universal availability.
