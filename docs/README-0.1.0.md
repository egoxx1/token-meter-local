# Token Meter Local · 0.1.0

**Codex CLI · Claude Code · Gemini CLI의 이 기기 로그를 읽어, 모델·누적 입출력 토큰·입력/출력 비용을 상태바에 표시하는 로컬 도구입니다.**

VS Code 확장과 독립 브라우저 대시보드를 같은 수집기에 연결합니다. 외부 npm 의존성, 로그인, API 키, 유료 API 호출은 필요하지 않습니다. 첫 버전이며 각 CLI의 모든 릴리스와의 호환성을 보증하지 않습니다.

> **범위:** Gemini **CLI** 기록을 지원합니다. Antigravity 내부의 Gemini 사용량, ChatGPT/Claude/Gemini 웹 채팅, 전체 계정 사용량, 구독 한도 및 실제 청구액은 수집하지 않습니다. 표시 모델은 화면에서 실시간으로 읽어 낸 선택값이 아니라 **가장 최근 로컬 로그에 기록된 모델**입니다.

![합성 로그로 실행한 대시보드. 실제 사용자 사용량이 아닙니다.](docs/preview.png)

## 1. 설치 — 둘 중 하나만 선택

### A. VS Code 상태바

1. `token-meter-local-0.1.0.vsix` 파일을 받습니다. ZIP 소스를 별도로 풀 필요는 없습니다.
2. VS Code의 **Extensions → … → Install from VSIX…**에서 이 파일을 선택합니다.
3. 필요하면 창을 다시 로드합니다. 아래쪽에 `TM` 상태바가 나타납니다.
4. 상태바를 클릭하면 상세 대시보드가 열립니다.

명령으로 설치할 수도 있습니다.

```sh
code --install-extension token-meter-local-0.1.0.vsix
```

이 확장은 VS Code의 Node 런타임으로 수집기를 시작합니다. 확장 설치 경로에서는 별도 `npm install`이나 Node 설치를 요구하지 않습니다. VS Code 1.95 이상을 대상으로 작성했으며 **실제 VS Code Extension Host 설치 검증은 하지 못했습니다.** 확장 어댑터의 활성화·상태바·명령 동작은 VS Code API 모의 객체와 실제 로컬 HTTP 수집기로 테스트했습니다.

이 파일은 개인용 로컬 설치 패키지입니다. Marketplace에 등록되거나 게시자 서명을 받은 확장이 아닙니다. 소스는 함께 제공됩니다.

**명령 팔레트**에서 `Token Meter`를 검색하면 대시보드, 상태바 범위/도구 선택, 설정/단가 파일, 재시작, 중지 명령을 찾을 수 있습니다. 상태바의 기본 범위는 오늘이며 `today`, `month`, `all`, `session`을 선택할 수 있습니다. `session`은 가장 최근에 관측한 세션입니다.

수집기는 VS Code를 닫아도 다른 표시기에 사용될 수 있도록 계속 실행됩니다. 종료하려면 **Token Meter: Stop Collector**를 실행하세요. 상태바를 숨기는 설정은 수집기 종료와 다릅니다. VS Code를 다시 켜면 활성화 시 수집기가 다시 시작될 수 있습니다.

### B. 터미널 + 브라우저 — VS Code 없이 실행

Node.js **20 이상**이 필요합니다. 소스 ZIP을 풀고 `token-meter` 폴더에서 실행합니다.

```sh
node bin/cli.js serve --open
```

`npm install`이나 빌드 단계는 없습니다. Windows에서는 `start.cmd`, macOS/Linux에서는 `sh start.sh`도 같은 명령을 실행합니다. 브라우저가 자동으로 열리지 않으면 터미널에 표시된 대시보드 주소를 직접 엽니다.

```sh
# 실행 중인 수집기의 상태를 다른 터미널에서 확인
node bin/cli.js status --scope today --provider codex
node bin/cli.js status --scope month --json
node bin/cli.js watch --scope today

# 대시보드 다시 열기 / 수집기 종료
node bin/cli.js dashboard
node bin/cli.js stop
```

`serve`를 실행한 터미널은 유지합니다. `Ctrl+C`로 종료할 수 있습니다. 수집기는 한 데이터 폴더에 하나만 실행됩니다. VS Code 확장이 이미 수집기를 실행 중이라면 `serve`를 다시 시작하지 말고 `dashboard` 또는 `status`로 연결하세요.

### 실제 기록 없이 화면 먼저 보기

```sh
node bin/cli.js demo --open
```

임시 폴더에 **합성 로그**를 만들고 실제 기록·기본 데이터 폴더와 분리해서 실행합니다. 화면에 데모 표시가 나타납니다. 데모 숫자는 실제 사용량이 아닙니다. 반복 실행 시 새로운 임시 폴더를 만들며 종료 뒤 자동 삭제하지 않습니다. 출력된 데이터 경로를 확인하여 필요 없을 때 지울 수 있습니다.

## 2. 항상 보이는 표시

| 표시기 | 동작 |
|---|---|
| VS Code 상태바 | 편집기 하단에 모델, 입력 토큰/비용, 출력 토큰/비용, 합계 표시 |
| 대시보드 하단바 | 페이지를 스크롤해도 고정 표시 |
| 항상 위 미니바 | 지원하는 데스크톱 브라우저의 Document Picture-in-Picture 사용. 버튼을 눌러 열고 부모 대시보드 탭은 유지 |
| 터미널 `watch` | 별도 터미널에서 5초마다 표시. OS 최상위 고정 기능 자체는 제공하지 않음 |

미니바 기능이 없는 브라우저나 허용되지 않는 환경에서는 안내를 표시합니다. 일반 팝업을 띄우고 ‘항상 위’라고 가장하지 않습니다. **OS 최상위 유지 및 사용자 브라우저의 PiP 허용 여부는 이 빌드에서 실기 검증되지 않았습니다.** 미니바 렌더링만 별도 문서로 시험했습니다.

상태바 예시의 형태:

```text
TM 오늘 | codex [최근 기록 모델] high
입력 1.20M $… · 출력 80.0K $… | Σ 1.28M API 환산 $…
```

## 3. 구현된 기능

| 기능 | 동작 |
|---|---|
| 모델 감지 | Codex turn context, Claude assistant message, Gemini 기록의 모델 ID 사용 |
| 누적 토큰 | 입력·출력·합계, 캐시 읽기/쓰기, 기록된 추론 토큰 세부 표시 |
| 기간·작업 필터 | 오늘·이번 달·전체·세션·수동 작업 구간, 도구·프로젝트 선택 |
| 비용 | 일반 입력·캐시 입력·출력을 각각 계산하고 입력 비용 + 출력 비용 표시 |
| 하위 에이전트 | 로그의 하위 에이전트 메타데이터/경로가 있을 때 메인과 분리 |
| 작업 측정 | 시작/종료 구간 및 선택 프로젝트에 해당하는 로그 시각의 사용량 합산 |
| 예산·원화 | 하루 설정 금액 초과 경고. 원화 환율은 직접 입력 |
| 내보내기 | 선택 범위의 CSV / JSON. CSV 수식 주입 방지 처리 |
| 진단 | 경로 없음, 일부 파싱 오류, 가격 미정, 미기록 시각, 검색 제한 등 표시 |
| 로컬 저장 | 원본 CLI 로그는 읽기만 하고 별도 ledger에 메타데이터만 저장 |

일반적으로 5초마다 새 기록을 확인합니다. 응답 도중 CLI가 아직 usage를 기록하지 않았으면 토큰이 즉시 증가하지 않을 수 있습니다. 미수집 기록은 확인된 0회 사용과 같지 않습니다. 실행된 세션의 로그가 없거나 삭제된 기록은 복구하지 못합니다.

## 4. 비용의 의미 — 반드시 확인

기본 표시는 **API 환산액**입니다. 구독으로 소비한 토큰을 공개 API의 참고 단가로 환산한 금액이지 추가 결제액이 아닙니다. 설정에서 **API 비용 추정액**으로 이름을 바꿀 수 있지만, API/구독 과금 경로를 자동 인증·확인하는 기능이 생기는 것은 아닙니다.

- 내장 단가는 **2026-09-24 확인 스냅샷**입니다. 과거 요청을 가져올 때 그 당시 실제 가격을 복원하지 않습니다. `price.rate.asOf`·`source`·`referenceOnly`에 기준을 남깁니다.
- **GPT-6 내장 가격은 short-context 참고 단가입니다.** 공개표의 장문 단가는 확인했으나 API별 적용 경계를 확정하지 못해 임의의 경계를 적용하지 않았습니다. 장문 규칙이 필요하면 확인한 기준으로 사용자 단가의 `longContext`를 설정하세요. 해당 기본가격 기록에는 `short-context-reference-rate` 경고가 남습니다.
- 수집 가능한 요금 모드만 적용합니다. 추론 `high`/`xhigh`/`max`라는 이유로 임의의 배수를 붙이지 않습니다. 알려진 Fast 모드는 명시적 가격 규칙을 사용합니다. 모델/모드가 미지원이면 금액은 미정입니다.
- Claude의 일반 입력, 캐시 읽기, 쓰기는 중복 없이 더합니다. 쓰기 TTL이 빠져 있으면 싼 5분 단가를 임의로 선택하지 않습니다.
- OpenAI의 기록된 추론 토큰은 출력의 세부 항목으로 처리합니다. Gemini의 thoughts는 기록된 candidates 출력에 한 번 더해 표시합니다.
- 총금액은 **모델 토큰 비용**입니다. 구독료, 추가 크레딧, 무료 구간, 서버 도구 호출료, 캐시 시간당 저장료, 이미지 생성료, 오디오별 요금, 세금, 지역 할증, 환전 수수료는 포함하지 않습니다.
- 원화 표시는 수동 환율의 참고값입니다. 요금표를 자동 다운로드하거나 환율을 자동 조회하지 않습니다.
- `미정` 또는 `$확인분 + ?`는 미확인 부분이 있다는 뜻입니다. 실제 총액이라고 해석하지 마세요.

**내장 모델 ID:** `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.3-codex`; `claude-opus-5-5`, `claude-sonnet-5`, `claude-fable-5-1`, `claude-opus-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-opus-4-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-sonnet-4`, `claude-haiku-4-5`; `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-2.5-pro`.

미등록 모델도 로그 사용량은 집계할 수 있지만 가격은 미정입니다. 이름이 비슷한 모델에 임의로 단가를 붙이지 않습니다. 정확한 ID 또는 날짜가 붙은 버전 ID만 대응합니다. 기본적으로 최신 Gemini 모델 전체, 타사 게이트웨이, Vertex/Bedrock/Azure 가격을 망라하지 않습니다.

## 5. 저장 위치와 설정

기본 데이터 폴더는 `~/.token-meter`입니다. `TOKEN_METER_HOME` 환경변수 또는 CLI `--data-dir` 옵션으로 바꿀 수 있습니다. VS Code에서는 `tokenMeter.dataDirectory`를 설정합니다. 두 표시기가 같은 수집기를 쓰려면 같은 데이터 폴더를 지정하세요.

| 파일 | 내용 |
|---|---|
| `config.json` | 수집 경로, 갱신 간격, 시간대, 표시 모드, 예산, 환율 |
| `prices.user.json` | 사용자 단가 규칙 |
| `ledger.json` | 사용량 메타데이터, 가격 스냅샷, 읽은 파일 위치, 작업 구간 |
| `runtime.json` | 실행 중인 수집기의 주소·접근키. 공유 금지 |
| `collector.lock` | 같은 데이터 폴더에 대한 이중 실행 방지 |

기본으로 읽는 경로:

```text
Codex:      $CODEX_HOME/sessions, $CODEX_HOME/archived_sessions
            (CODEX_HOME 미설정 시 ~/.codex)
Claude:     $CLAUDE_CONFIG_DIR/projects
            (미설정 시 ~/.claude)
Gemini CLI: ~/.gemini/tmp/**/session-*.json 또는 session-*.jsonl
```

다른 경로를 쓴다면 **이 도구의** `config.json`에서 `roots`를 수정하세요. 각 CLI의 원본 설정, 인증 파일, 프롬프트 파일은 변경하지 않습니다.

```json
{
  "version": 1,
  "pollMs": 5000,
  "timeZone": "Asia/Seoul",
  "billingMode": "equivalent",
  "dailyBudgetUsd": null,
  "usdToKrw": null,
  "fxAsOf": null,
  "roots": {
    "codex": ["~/.codex/sessions", "~/.codex/archived_sessions"],
    "claude": ["~/.claude/projects"],
    "gemini": ["~/.gemini/tmp"]
  }
}
```

`roots`에 빈 배열을 넣으면 해당 도구를 읽지 않습니다. `pollMs`는 1000~60000ms입니다. 심볼릭 링크는 따라가지 않으며 읽기 깊이·파일 수 제한을 넘으면 부분 집계로 표시합니다. JSON 스냅샷 64MiB, JSONL 한 행 16MiB를 넘으면 제외됩니다.

WSL/SSH/컨테이너의 로그는 그 환경 안에서 수집기를 실행해야 합니다. 로컬 Windows의 `~/.codex`와 WSL의 `~/.codex`는 서로 다릅니다. 원격 VS Code 포트 전달 및 브라우저 연결은 이 버전의 검증 범위에 포함되지 않습니다.

### 사용자 단가

대시보드 하단 **집계 범위 · 주의사항 → 사용자 단가 추가** 또는 `prices.user.json`에서 설정합니다. 아래 값은 **문법 설명용 가상 단가**입니다.

```json
{
  "version": 1,
  "rules": [{
    "provider": "codex",
    "models": ["your-exact-model-id"],
    "tier": "standard",
    "input": 1.0,
    "output": 5.0,
    "cacheRead": 0.1,
    "cacheWrite": 1.25,
    "source": "직접 확인한 요금표의 URL 또는 설명",
    "asOf": "2026-09-24",
    "effectiveFrom": null
  }]
}
```

단위는 **USD / 100만 토큰**입니다. `null`이나 생략은 미정이고, 명시적 `0`만 무료 단가입니다. Claude 쓰기는 `cacheWrite5m`, `cacheWrite1h`를 사용할 수 있습니다.

장문 기준을 직접 확인한 경우 `"longContext": {"above": 200000, "inputMultiplier": 2, "outputMultiplier": 1.5}`처럼 지정할 수 있습니다. 이 숫자도 모든 모델에 공통으로 적용되는 규칙이 아니라 **구조 예시**입니다. `fastMultiplier`, `effectiveFrom`도 지원합니다. 규칙은 사용자 파일의 뒤쪽 항목을 우선합니다.

이미 금액이 확정된 기록은 원래 단가 스냅샷을 유지합니다. 미정 기록은 단가 파일 변경 시 다시 계산합니다. 확정된 기록 전체를 새 가격으로 재평가하는 UI는 없습니다. 현재 세션의 미완성 응답이 갱신되면 같은 원래 규칙을 사용하되 최종 입력 길이로 장문 구간을 재판정합니다.

## 6. 집계·정확도 제한

Codex는 누적 스냅샷의 증가분을 사용합니다. 카운터가 감소하면 새 청구로 더하지 않고 기준을 재설정하며 경계 누락 가능성을 경고합니다. 초기 기록에 여러 모델의 과거 합계만 있으면 과거분 모델을 `unknown`으로 둡니다.

Claude는 `requestId`, 없으면 message ID를 사용합니다. 같은 요청의 스트리밍/복제 행은 더 큰 사용량 또는 더 완전한 세부값으로 갱신하며 여러 번 더하지 않습니다. 기록의 최종 여부가 확인되지 않으면 경고합니다. 나중에 더 작은 값으로 수정된 관측치로 과거 소비량을 자동 삭감하지는 않습니다.

Gemini CLI의 기존 JSON 스냅샷과 JSONL 메시지/메타데이터 형식을 처리합니다. 되감기나 대화 압축은 이미 관측한 소비를 환불하지 않습니다. 같은 메시지 ID는 한 번만 집계합니다.

작업별 집계는 사용량 기록의 타임스탬프를 기준으로 하며 실제 요청 시작·종료 구간을 추적하지 않습니다. 하위 에이전트에 부모 연결 정보가 없으면 부모 세션으로 강제 합산하지 않습니다. 전체 범위에서는 수집된 각 요청을 한 번씩 더합니다. 첫 버전에서 구현한 비교는 **토큰·비용·모델·역할** 비교이며 실행 품질 평가나 자동 테스트 점수 수집은 아닙니다.

중단된 요청의 usage가 로그에 없거나 Codex를 `--ephemeral`처럼 지속 기록이 남지 않는 방식으로 사용하면 수집할 수 없습니다. 실제 사용 환경의 로그 스키마가 다르면 파서 수정이 필요할 수 있습니다. 모든 미지원 스키마를 자동으로 식별하는 기능은 없으며, 경로를 발견했다는 사실만으로 완전한 수집을 보증하지 않습니다.

## 7. 개인정보·보안

원본 로그를 읽는 과정에서 내용이 프로세스 메모리를 통과할 수는 있지만, **프롬프트·응답·코드·도구 인자·인증키를 ledger와 내보내기에 저장하지 않습니다.** 사용량, 모델, 시각, 세션/에이전트 ID, 프로젝트 폴더명, 파일 경로/오프셋 같은 메타데이터는 로컬에 남습니다. 작업 이름은 사용자가 직접 넣은 그대로 저장됩니다.

서버는 `127.0.0.1`에만 바인딩합니다. API는 실행마다 생성한 접근키를 요구하며 Host/Origin을 제한합니다. 외부 서버로 분석·텔레메트리·요금표 요청을 전송하지 않습니다. 페이지 자산에도 외부 CDN/폰트가 없습니다. API 키 입력은 받지 않습니다.

터미널에 표시되는 `#key=...`가 포함된 URL과 `runtime.json`은 공유하지 마세요. 주소의 키는 페이지 로드 후 지우고 탭의 sessionStorage로 이동시킵니다. 같은 OS 사용자 계정에 접근 가능한 프로그램에 대한 격리는 제공하지 않습니다. POSIX에서는 파일/폴더 권한을 제한해 생성하며 Windows에서는 사용자 프로필의 ACL도 확인해야 합니다.

기록은 사용자가 삭제할 때까지 유지됩니다. 종료 후 `~/.token-meter`를 삭제하면 이 도구의 기록/설정만 삭제됩니다. CLI 원본 로그는 남습니다. ledger만 삭제하면 다음 실행 때 남아 있는 원본 로그를 다시 가져옵니다.

## 8. 개발·검증

```sh
npm test             # Node 내장 test runner; 외부 패키지 없음
npm run check        # JavaScript 구문 / 패키지 진입점 검사
npm run package      # Python 3 표준 라이브러리로 ZIP + VSIX 생성
```

선택적 브라우저 테스트는 Python Playwright와 Chromium이 필요하지만 **제품 실행에는 필요하지 않습니다.** 데모를 먼저 실행한 뒤 출력된 데이터 경로를 넘깁니다.

```sh
python3 scripts/browser-smoke.py /path/to/token-meter-demo-xxx --output /tmp/token-meter-ui
```

이 환경은 Chromium의 모든 URL 탐색이 관리자 정책으로 막혀 있어 `--offline` 시험 하네스를 사용했습니다. HTML/CSS/JS를 빈 문서에 렌더링하고 fetch를 테스트 브리지로 실제 로컬 HTTP API에 연결했습니다. API 인증/Host/Origin은 별도 실제 HTTP 테스트로 검증했습니다. 이 방식은 사용자 브라우저의 실제 탐색·CSP·PiP 실기를 검증한 것과 같지 않습니다.

구체적인 통과 항목과 미검증 범위는 [검증 보고서](docs/TEST-REPORT.md), 내부 구조는 [개발 문서](docs/ARCHITECTURE.md)를 참고하세요. 원래 Codex·Claude·Gemini CLI 바이너리와 실제 계정으로 통합 실행한 결과가 아니라, 공개 스키마에 맞춘 합성 로그 기반 테스트입니다.

## 참고한 공식 자료

확인일: 2026-09-24. 공급자 코드를 그대로 재배포하지 않았습니다.

- Codex protocol types: https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs
- Codex App Server (이번 구현은 App Server 구독이 아니라 로컬 기록 수집): https://developers.openai.com/codex/app-server
- OpenAI API 가격: https://developers.openai.com/api/docs/pricing
- Claude Code usage monitoring: https://code.claude.com/docs/en/monitoring-usage
- Claude Code statusline: https://code.claude.com/docs/en/statusline
- Claude API 가격: https://platform.claude.com/docs/en/about-claude/pricing
- Gemini CLI session management: https://geminicli.com/docs/cli/session-management/
- Gemini CLI chat recording types: https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingTypes.ts
- Gemini CLI chat recording service: https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingService.ts
- Gemini API 가격: https://ai.google.dev/gemini-api/docs/pricing
- VS Code StatusBarItem: https://code.visualstudio.com/api/references/vscode-api#StatusBarItem
- Document Picture-in-Picture: https://developer.chrome.com/docs/web-platform/document-picture-in-picture

## 라이선스

MIT. OpenAI, Anthropic, Google, Microsoft의 공식 제품이나 인증된 확장이 아닙니다. 제품명은 연동 대상을 설명하기 위해 사용했습니다.
