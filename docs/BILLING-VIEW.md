# Four-item display contract — 0.9.0

This is a projection, not a new price engine. `src/billing-view.js` is shared by Node and the browser. The displayed IN means `normalInput`, not legacy `input`.

## Conservation

```
legacy input = normalInput + cacheRead + cacheWrite
cacheWrite = cacheWrite5m + cacheWrite1h + cacheWriteUnknown
output = entire normalized output, including thinking exactly once
total = normalInput + cacheRead + cacheWrite + output
```

Cache write subcomponents retain their already-calculated integer pico-USD costs. The grouped write cost is their sum. The output cost is preserved, not recomputed from displayed thinking. Missing costs remain null; a known subtotal is not promoted to a complete price. Display rounding occurs after addition.

The four-item projection is immutable and never selects rates. Rates are from saved applied request/model groups, not the latest catalog. Multiple prices remain multiple prices; there is no average tariff. With zero consumption the relevant stored model group can still provide its unit tariff. Zero spend with a missing rate does not make that rate free. Active write amounts use only the relevant TTL's cost; unused zero-token unknown buckets do not invalidate known write charges.

## Presentation

Main statement: four rows plus TOTAL, each with tokens / USD per million / cost. IN explicitly excludes cache; OUT includes thinking. Default thinking and TTL subdivisions are collapsed. All provider/model/history/measurement/comparison/status/PiP displays use the same disjoint order. Multiple model/provider/mode/date/length conditions are grouped and linked to provenance. The current selected UI model is never used to reprice historical totals.

Saved measurement groups must retain their inputBreakdown when merged for reset-row presentation. Missing legacy component evidence produces unknown component values, not fake zero/ordinary amounts; known total/output remains readable. Ended snapshots are not repriced. Unknown optional cache fields remain annotated reference classifications.

## Export compatibility

Existing `input` remains cache-inclusive, `normalInput` is the new display IN. `output` remains normalized entire output. Requests add `billingView`, `cacheWriteUsd`, `inputFieldMeaning` and `displayINField`. Scalar measurement exports add the component counts/costs. None changes the raw provider counter meaning. Aggregate UI rate units may switch to 1,000, while stored/exported prices remain per 1,000,000.

## Scope

No new prices, parser field guesses, account access, native overlay, live invoice or schema migration. Existing epochs, deletion confirmations, journals and privacy boundaries are retained. Synthetic arithmetic and UI tests do not validate actual user logs or private Antigravity field meanings. Production-scheme compatibility remains a separate concern.
