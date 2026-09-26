# Token Meter Local 0.6.0

**IN · OUT(비추론) · THINKING · BILLABLE OUT(전체 출력) · TOTAL의 토큰과 비용을 각각 표시합니다.** Codex·Claude Code·Antigravity 로컬 기록 수집, 비파괴 재측정, 가격 근거와 월별 사용 로그를 유지했습니다.

## 설치 — VSIX 파일 하나

1. `token-meter-local-0.6.0.vsix`를 받습니다.
2. VS Code → 확장 → `…` → **Install from VSIX…** → 파일 선택.
3. 작업을 저장하고 **Developer: Reload Window**를 실행합니다. 기존 대시보드 탭은 닫습니다.
4. VS Code 하단 TM을 눌러 새로 열고 **LOCAL / 0.6.0**을 확인합니다. 구버전이면 **Token Meter: Restart Collector** 후 다시 엽니다.
5. 최초 실행은 기존 사용량을 보존하면서 원본 기록을 다시 읽어 출력 세부값을 보완합니다. Antigravity는 **Antigravity 기록 재분석** 버튼으로 다시 읽을 수도 있습니다.

**기존 `~/.token-meter`를 삭제하지 마세요.** VSIX에는 실행 코드가 들어 있어 소스를 별도로 복사하거나 npm 패키지를 설치하지 않습니다. 데이터가 많으면 최초 재수집에 시간이 걸릴 수 있습니다.

이 파일은 개인 설치용입니다. Marketplace/운영 업데이트 서버는 연결되어 있지 않습니다. 이번 버전은 수동 설치합니다. 실제 VS Code·Windows/macOS 실기 검증은 하지 못했으며 합성 데이터와 모의 Extension API로 검증했습니다.

## 1. 바뀐 출력 표시

| 표시 | 토큰 의미 | 비용 의미 |
|---|---|---|
| IN | 일반 입력 + 캐시 입력 | 입력/캐시 단가로 계산 |
| OUT · 비추론 | 전체 출력에서 확인된 THINKING을 제외한 부분 | 전체 출력 비용 중 비추론 부분 |
| THINKING | 원본이 별도로 보고한 추론 토큰 또는 명시된 참고 해석 | 전체 출력 비용 중 추론 부분 |
| BILLABLE OUT | 추론을 한 번 포함한 전체 출력 | 전체 출력 비용 |
| TOTAL | IN + BILLABLE OUT | 입력 비용 + 전체 출력 비용 |

**0.5.0의 OUT은 이미 ‘전체 출력’이었습니다. 그 값은 새 화면의 BILLABLE OUT에 해당합니다.** 이번 변경은 단순히 과거 OUT에 추정 THINKING을 더하는 것이 아닙니다. IN이 크고 OUT이 작다는 사실만으로 누락을 판정하지 않습니다.

세부값을 분리할 수 있는 경우:

```text
OUT(비추론) + THINKING = BILLABLE OUT
TOTAL = IN + BILLABLE OUT
총비용 = IN 비용 + BILLABLE OUT 비용
```

**OUT 비용 + THINKING 비용은 BILLABLE OUT 비용의 분해입니다. 세 항목을 모두 더하면 중복입니다.** OUT은 도구 호출·포맷 토큰을 포함할 수 있어 화면에 보이는 답변 글자 수와 동일한 개념이 아닙니다.

![합성 사용량으로 실행한 0.6.0 화면. 실제 사용자 소비량 아님](docs/thinking-dashboard.png)

## 2. 0, 미확인, 참고를 구분

| 상태 | 동작 |
|---|---|
| 원본 세부값 있음 | 정수 카운터와 전체 출력의 포함 관계를 검증해 분리 |
| 명시적 THINKING 0 | 0으로 표시. 필드가 없다는 것과 다름 |
| 세부값 미기록 | THINKING·비추론은 **분해 미확인**. 알려진 전체 출력·비용은 유지 |
| 세부값 불일치 | 세부값을 억지로 더하지 않고 분해 미확인으로 표시. 확인 가능한 전체 출력은 유지 |
| 참고 해석 | 비공개 DB/이전 기록의 해석. 숫자 옆 **참고**와 상세 근거 표시 |
| 일부 기록만 분리됨 | 알려진 THINKING은 **관측분**, 비용은 **계산분**. 분해되지 않은 출력량/건수도 함께 표시 |

단순히 분해가 안 되는 것과 전체 출력 자체를 모르는 것도 다릅니다. 전체 출력 자체가 불명확하면 전체 토큰도 관측분으로 표시하고 그 출력 비용은 확정하지 않습니다. 부족한 정보를 추론 시간, 입력량, 글자 수로 채워 넣지 않습니다.

상단·도구별·모델별·사용 기록·재측정·비교·고정 하단바·PiP·VS Code 상태바에 다섯 지표를 연결했습니다. 상태바 폭이 좁으면 VS Code가 항목을 숨길 수 있으므로 대시보드/툴팁도 제공합니다.

## 3. 도구별 처리

**Codex/OpenAI:** 전체 output에서 reasoning 세부 카운터를 분리합니다. reasoning은 이미 전체 출력에 들어 있으므로 다시 더하지 않습니다. 누적 스냅샷에서는 토큰 증가분을 사용합니다. 선택적인 reasoning 필드가 사라졌다는 이유로 입력·출력 증가분까지 버리던 경로를 보완했습니다.

**Claude Code/Anthropic:** output_tokens는 유지하고, 기록에 `output_tokens_details.thinking_tokens` 또는 `reasoning_tokens`가 실제로 존재할 때만 세부값을 읽습니다. 모든 CLI/모델이 이 필드를 반환한다고 보장하지 않습니다. thinking 블록 본문이나 요약의 길이를 토큰 수로 세지 않습니다.

**Gemini 명시적 API 연동:** 기존 generateContent 형식은 candidatesTokenCount와 thoughtsTokenCount를 한 번 합산합니다. 새 `format: "gemini-interactions"`는 별도 total_output_tokens와 total_thought_tokens를 한 번 합산합니다. 이 형식은 자동 앱 감지가 아니라 응답 usage를 명시적으로 넘기는 연동용입니다.

**Antigravity:** 기존 비공개 SQLite 수집 경로를 유지합니다. 지원 형식의 field 3을 전체 출력으로 취급합니다. field 9/10의 이름 해석은 공개 구현 간 차이가 있어 이번 버전은 기존 `9=THINKING, 10=비추론`을 **참고**로만 노출합니다. 합계가 맞더라도 그것만으로 필드 이름이 검증됐다고 하지 않습니다. 모순되는 관측·필드 누락이면 분해를 확정하지 않습니다. 실제 앱 버전의 DB와 대조하지 않은 한 확정된 THINKING 수치로 해석하지 마세요.

수집 대상은 알려진 `~/.gemini/{antigravity,antigravity-cli,antigravity-ide}/conversations/*.db`입니다. 구형 `.pb`, 웹 채팅, 계정 전체 구독 한도, 실제 청구액은 미지원입니다. 자세한 내용은 [출력 데이터 계약](docs/THINKING.md)을 참고하세요.

## 4. 사용 기록과 재측정

**사용 기록 · 자동 보존 → 출력 분해** 필터로 원본 세부값 있음/참고/미기록/불일치/미확인 전체를 조회할 수 있습니다. **계산 근거**에서는 전체 출력, 분해값, 출처·참고 조건, 원본 카운터를 확인합니다.

`usage-log/YYYY-MM.jsonl`에는 응답/추론 카운터·분해 상태·근거가 계속 추가됩니다. 동일 요청이 보완되면 새 revision을 남기고, 합계에는 최신 수정본만 사용합니다. 자동 삭제는 없습니다. 대화·추론 본문, 코드, 인증키를 저장하지 않습니다. 프로젝트명·요청 ID 등 메타데이터는 민감할 수 있습니다.

도구/모델별 **0부터 재측정**은 계속 비파괴 기준점 방식입니다. THINKING 증가분도 기준점의 세부값이 확인될 때만 계산합니다. 과거 요청에 THINKING 정보만 추가된 것은 새 소비량이 아닙니다. 종료한 결과는 당시 값으로 고정됩니다.

### 이전 데이터

최초 업그레이드 전 `ledger.pre-0.6.0.json`을 보존합니다. 원본 로그가 남아 있으면 재수집해 필드 존재 여부를 보완하며 요청을 중복 합산하지 않습니다. 삭제된 원본이나 과거에 기록되지 않은 THINKING을 복원할 수는 없습니다. 종료된 측정의 저장 값은 바꾸지 않습니다.

JSON/CSV 호환성을 위해 기존 `output`은 **전체 출력**으로 유지합니다. 새 `responseOutput`, `thinkingOutput`, `billableOutput`, `unclassifiedOutput`, `outputSplitStatus`, `responseUsd`, `thinkingUsd`를 추가했습니다. null은 미확인이고 0만 명시적 0입니다.

## 5. 실행 조건과 기존 기능

VS Code 1.95+ 또는 독립 실행 Node.js 20+가 필요합니다. Antigravity에는 실행 Node의 `node:sqlite` 또는 SQLite 모듈을 포함한 Python 3가 필요합니다. Node 22.13+의 내장 SQLite 경로를 기준으로 했으며 VS Code 내부 Node에 없으면 Python fallback을 시도합니다. 별도 Node 설치가 VS Code 내부 Node를 바꾸지는 않습니다.

VS Code 없이 소스 ZIP의 **token-meter** 폴더에서:

```sh
node bin/cli.js serve --open
# 합성 데이터만 사용
node bin/cli.js demo --open
# 검사
npm test
npm run check
```

전체 누적, 기간/도구/모델/프로젝트 필터, 측정 비교, 예산 알림, 수동 환율, 가격표 자동 갱신, 서명 검증 업데이트 엔진은 유지했습니다. **이 변경에서 단가 전체를 새로 검증하거나 실제 배포 서버를 연결하지 않았습니다.** 비용은 저장된 API 참고 단가의 환산/추정액이며 구독 실제 결제액·무료 크레딧·세금·서버 도구요금·캐시 저장료·멀티모달 요금은 제외합니다.

[이전 버전 설치/기능 상세](docs/README-0.5.0.md) · [출력 데이터 계약](docs/THINKING.md) · [재측정](docs/MEASUREMENTS.md) · [보존 로그](docs/PRICING-HISTORY.md) · [검증 보고서](docs/TEST-REPORT.md)

MIT. 공식/인증 확장이 아니며 모든 CLI 버전이나 실제 청구액과의 일치를 보장하지 않습니다.
