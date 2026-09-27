# 0.10.2 — Bounded memory and unchanged accounting / 2026-09-27

- Start from the user's 0.10.1 upload; preserve mirrored primary/retry accounting, 16 MiB SQLite blobs, source identity repair and reset boundaries.
- Stream existing ledger JSON on read/write; serialize saves at execution time instead of eagerly cloning the full ledger.
- Keep a compact journal index, replay only newer revisions, and share exact immutable pricing/provenance under a bounded pool.
- Preserve accountingVersion/usageSourceKind/usageObservedAt through journal and reset; do not turn correct records into legacy warnings.
- Skip unchanged reset input and completed DB snapshots without suppressing warnings or needed repairs. Preserve WAL/manual-reanalysis invalidation.
- Batch worker results with backpressure; assemble long Python IPC lines without repeated whole-prefix concatenation; await process/worker exit.
- Add tiny authenticated version probes and lean, bounded cached statusbar queries with live health overlays.
- Stream complete HTTP exports; use browser file streaming when supported and explicitly permitted, otherwise retain Blob fallback.
- Coalesce UI refreshes, pause hidden-tab display requests without stopping collection, and expose collector RAM/save queue.
- Keep prices and provider parser semantics; no history purge, downsampling, forced GC, heap-limit workaround or SQLite-ledger migration.
- Document controlled 20,000-call before/after RSS and runtime tradeoffs, 431 Node tests and bounded browser-harness verification.

# 0.10.1 — Antigravity mirrored usage repair / 2026-09-26

- Treat an identical primary/retry observation with the same strong request identity as one call; keep distinct retries and generation rows separate.
- Prefer an explicit generation-to-step index when repeated response IDs would otherwise make a step ambiguous.
- Read supported SQLite metadata blobs up to 16 MiB, while retaining the per-DB row and byte limits.
- Reanalyse prior v4 accounting through a durable repair plan, retire duplicate revisions, and preserve the active epoch boundary.

# 0.10.0 — Invocation identity repair and same-session reconciliation / 2026-09-26

- Reproduce the shared root-field-4 collapse: 559 distinct synthetic calls previously produced only 25 events.
- Use generation row/retry identities, two-phase step matching and explicit ambiguity diagnostics; never merge generations by a batch/group ID.
- Repair existing Antigravity sessions with ledger backups, durable repair plans and journal retirement revisions. Preserve the reset epoch and expose irrecoverable historic boundary uncertainty.
- Leave the Codex parser and pricing files byte-identical; add the reported 95-call/five-counter Codex regression.
- Add full-source versus active-session views, inclusive-input explanations, local DB reconciliation, manual rounded CLI comparison, safe diagnostic export and a separate Python primary counter oracle.
- Add one-click session measurement/pinning, warnings for frozen legacy results and bounded adaptive polling for expensive scan/save cycles.
- Do not claim user-DB, installed VS Code, private-schema or invoice certification. Keep existing pricing/caching, history, reset/deletion, update and PiP limitations explicit.

# 0.9.1 — Refined preview and cache evidence / 2026-09-26

- Rework the real dashboard into a restrained billing statement with cost/token/cache-share overview, responsive typography and consistent mini-bar styling.
- Distinguish unreported cache counters from explicitly reported zero on all primary billing surfaces and status text.
- Preserve applied tariff visibility, reference aggregate arithmetic, partial-coverage labels and input/output token conservation.
- Add a cache-write help dialog with official references; explain server prompt caching vs local file edits.
- Add 10 data-contract and 16 UI tests; re-run 351 Node tests and 68 UI checks.
- No new pricing catalog, source-parser schema certification, cloud publishing, or migration/deletion of user data.

# 0.9.0 — Four billing items, one total

- Replace overlapping main cards with IN (ordinary), CACHE READ, CACHE WRITE, OUT (thinking included).
- Show tokens, saved applied per-1M tariff and cost on each main row.
- Preserve all usage/pricing totals and raw input field semantics.
- Move thinking and cache-write TTL into optional details.
- Align tool/model/history/measurement/comparison/status/PiP surfaces.
- Preserve input component prices when combining reset measurement groups.
- Add four-item projection and export metadata; keep delete/reset epoch contracts.
- Retain zero-use write tariff, mixed-tariff groups and missing-counter warnings.

# 0.8.0 — 측정 삭제·전체 초기화 / 2026-09-25

- 진행 중/종료/숨김/취소 측정의 개별·선택·전체 삭제. 삭제 확인, 핀/비교/초기화 취소 참조 정리, 500개 한도 공간 회수.
- 누적·사용 이력·작업·측정 전체 초기화. 명시적 문구+동의, 설정/단가/원본 보존, 새 활성 데이터 구간과 로컬 이전 데이터 백업.
- 원본 ID별 절대 기준점, 이전/무시각 기록 제외, 스트리밍 증가분으로 재수집/재시작 시 이전 사용량 재합산 방지.
- 저장 후 활성 포인터 원자 교체, 실패/재시도/손상/동시 작업 안전장치. 삭제된 측정 export의 묵시적 전체 내보내기 방지.
- VS Code 삭제/초기화 명령 3개, 활성 로그 폴더 열기, 다중 탭 선택/페이지 정리, UI 버전 경고 갱신.
- Node 316개, UI 127개 (108 회귀 + 19 신규), JavaScript 58개. 합성 데이터·제한된 브라우저 하네스이며 실제 사용자 OS/계정/Extension Host 미검증.

# 0.7.1 — 모델/단가 연결 검증 / 2026-09-25

- 저장 단가 재사용 전 실제 가격표 모델·공급자·도구 범위·요금 모드·유효기간·로컬 조건 검사. 잘못된 단가 대신 올바른 규칙을 선택하거나 미확인 유지.
- 도구 전용 사용자 단가의 다른 도구 유출 방지. 명시적 wildcard 범위만 공통 적용.
- 같은 토큰 합계에서 요청 시각/컨텍스트만 바뀐 경우도 조건 재계산.
- 관측 모델과 실제 가격표 모델/별칭 근거 분리, 읽기 전용 매칭 진단 및 JSON 내보내기.
- 카탈로그 Standard/Batch/Flex 모드 열, 캐시 쓰기 열의 단위 혼동 수정.
- ledger.pre-0.7.1.json 백업과 교정 근거 revision. 정상 과거 단가·동결 측정 보존.
- 279 Node tests; 108 UI checks (restricted real-app rendering bridge). 사용자 실제 DB/OS/VS Code 설치는 미검증.

# 0.7.0 — 입력 구성과 API 단가 / 2026-09-25

- 일반 입력·캐시 읽기·캐시 쓰기 카드와 입력 합산식. 5m/1h/일반 쓰기 상세.
- 모델별/요청별 저장된 API 단가 및 근거. 100만 토큰 기본, 선택적 1,000토큰 표시. 혼합 단가를 그룹별 표시.
- GPT-6 공식 272K 요청 입력 경계와 입력/캐시 2x·출력 1.5x. 명시된 Fast/Batch/Flex만 적용. 길이 미기록/누적 묶음은 참고 환산.
- 캐시 카운터 존재 여부 보존. 미기록 쓰기를 ‘확인된 0’으로 오해하지 않게 표시.
- 비용 정밀도(6자리, 극소액12자리), 캐시 항목 비용과 단가의 CSV/JSONL, 상태바 툴팁.
- 기존 ledger 백업·원본 재수집·수정 로그 유지. 이미 종료된 측정 불변.
- 259 Node tests, 98 UI checks (restricted browser bridge; not actual user host/account validation).

# 0.6.0 — Output/THINKING breakdown

- IN / non-thinking OUT / THINKING / BILLABLE OUT / TOTAL token and cost pairs across dashboard, tables, status bar, PiP, exports and measurements.
- Preserve `output` as inclusive total; partition rather than double-charge thinking. Null detail differs from explicit zero.
- Provider-specific raw usage handling, explicit Gemini Interactions import, optional Claude detail handling, Codex missing optional detail no longer resets observed consumption.
- Private Antigravity split is qualified as reference; mismatched/absent parts and conflicting duplicate observations never inflate total output.
- Breakdown-only history filters and per-request conservation evidence. Safe monthly journals retain split metadata and revisions.
- Non-destructive legacy ledger backup and one-time source rescan. Ended measurements stay frozen.
- 237 Node tests and 82 UI checks passed on synthetic inputs; actual app/OS/VS Code installation and account billing not verified.

# 0.5.0 — 2026-09-25

- Add sourced Antigravity enum mapping including 1319 → Gemini 3.8 Flash Medium, numeric/name equivalence, model_enum metadata fallback, and parser-v2 reanalysis with original ledger backup.
- Use explicit output total without inflating it to a conflicting detail sum. Preserve raw counters and diagnostics. Scope pricing failures to the affected category/side.
- Replace vague partial-price punctuation with reasons, applied-rate evidence, official provenance and explicit reference conditions. Preserve user rate overrides and historical snapshots with audited targeted repairs.
- Add append-only monthly usage metadata journal, revision-aware persistence/recovery and latest-only full history with filters, keyset pagination, CSV/JSONL export and per-request calculation detail.
- Keep completed measurements frozen; retain existing reset/compare/Pin/PiP/CLI behavior.
- Publish completed scan health rather than temporarily empty Antigravity status during reads. Add log-folder/reanalysis commands and UI/collector version check.
- No promise of actual billing accuracy, public update infrastructure, .pb compatibility or real OS/VS Code integration verification.

# 0.4.0 — Non-destructive measurement meters (2026-09-25)

- Add per-tool and exact per-model/effort/role reset buttons with optional project scoping.
- Preserve the raw ledger; store per-request baselines, closed results and previous-state backups separately.
- Add last-reset undo, broad-baseline row inheritance and cumulative/meter display toggle.
- Add named parallel measurements, frozen end results, same-filter reruns, search, hide/restore, notes and manual outcomes.
- Add comparison of up to four runs, Markdown copy with selectable-text fallback and CSV/JSON exports.
- Add pinned VS Code status display, six command-palette actions and matching terminal commands.
- Add per-measurement known-cost thresholds, manual collection and remembered browser filter preferences.
- Handle streaming positive deltas, late old records, unknown timestamps, counter regressions and cache repricing without phantom new use; retain full request context for delta pricing.
- Fix stale Antigravity-unsupported text; the existing SQLite collector is retained, not replaced or newly live-validated.
- Keep old pricing and updater engines; no new price audit or hosted update feed.
- 178 Node tests and 48 offline-rendered UI checks passed with synthetic data and real local APIs. Real VSIX/OS/provider-account deployment remains unverified.

# 0.3.0 — Antigravity SQLite collector (2026-09-25)

- Add an independent read-only Antigravity DB adapter for Desktop/CLI/IDE conversation directories.
- Decode generation/step usage, retries, recorded models and timestamps; do not sum context-window tokens.
- Add invocation identity reconciliation, WAL change detection, worker resource limits and Python stdlib SQLite fallback.
- Surface missing runtime, unsupported PB history, partial schema support and history-only states; retain observed spend.
- Wire Antigravity into statusbar, dashboard, mini bar, filters, CSV/JSON and a diagnostics command.
- Add Gemini 3.6/3.7/3.8 Flash dated API reference rates; private internal model enums remain unpriced.
- Keep legacy Gemini records separate, and do not label Antigravity API equivalent as actual subscription charge.
- Smaller currency values use up to six decimals (up to twelve for very small values).
- Real SQLite synthetic fixtures and Python fallback tested; actual Antigravity account and VS Code installation untested.

# 0.2.1 · 2026-09-25

- IN tokens + input cost, OUT tokens + output cost, TOTAL tokens + total cost are consistently displayed in the VS Code/CLI status line, fixed dashboard bar, PiP component, model/provider/recent-request tables and project/role summaries.
- Exact token counts in cards, tables and PiP; optional `tokenMeter.tokenDisplay: exact` and CLI `--exact`. Tooltip always includes all six values.
- Label aggregation scope separately from the most recently observed model to avoid attributing multi-model totals to one model.
- Include input/output costs and their known subtotals in recent-record API responses.
- Preserve tiny positive costs down to the ledger's 1e-12 USD display precision, distinguish missing records from zero cost, and indicate partial unknown costs.
- Retain Gemini as legacy records. Antigravity collector remains unimplemented and is explicitly marked unsupported; no fabricated usage is added to totals.
- 118 Node tests and 27 browser-harness checks passed. Physical VS Code, production CLI and native PiP behavior remain unverified.

---

# Changelog

## 0.2.0 — 2026-09-25

- Expand built-in rates from 20 to 42 provider/model combinations; add provider namespaces and UI model catalog search.
- Add opt-in models.dev/OpenRouter catalog updates, last-good cache, ETag, bounded validation and source diagnostics.
- Add explicit OpenAI-compatible, Anthropic, Gemini, local Ollama and normalized usage ingestion via local authenticated API / JSONL / CLI.
- Include Gemini nested subagent JSONL files and `$set.messages` usage checkpoints.
- Fix Gemini cross-session message-ID collisions; back up and migrate v1 ledger; replay Gemini logs.
- Reconcile same-total cache breakdown updates; preserve partially known historical rates; resolve fully unknown rates on startup.
- Add separately configured Ed25519 signed application update check/download, SHA-256/size/VSIX identity verification and optional VS Code installation.
- Reject remote execution, unapproved hosts, private network destinations, redirects, invalid signatures, expiry and version rollback.
- Replace older collectors on extension activation; never intentionally downgrade a newer collector.
- Add release-signing tooling, import examples, new tests and explicit coverage limits.

## 0.1.0 — 2026-09-24

Initial local-only Codex / Claude Code / Gemini CLI collectors, frozen token rate snapshots, dashboard, mini bar and VS Code status bar. Historical documentation and test report retained under docs/ with versioned names.
