# Token Meter Local · 0.2.0

**Codex CLI · Claude Code · Gemini CLI의 로컬 기록과 명시적으로 연동한 API 사용량을 집계하는 VS Code 상태바 / 로컬 대시보드입니다.**

입력·출력·캐시·추론 토큰, 입력 비용·출력 비용·합계를 표시합니다. 외부 실행 의존성은 없습니다. Node.js 20+ 또는 VS Code 1.95+가 필요합니다. 표시 금액은 **텍스트 모델 토큰의 API 환산/추정액이며 실제 결제액이 아닙니다.**

![합성 로그 화면. 실제 사용자 사용량이 아닙니다.](docs/preview.png)

## 이번 버전의 변화

| 구분 | 0.2.0 |
|---|---|
| 기본 단가 | 공급자·모델 조합 20개 → **42개**. 공급자가 다르면 별도 가격으로 취급 |
| 추가 모델 | models.dev / OpenRouter 공개 카탈로그 가져오기, 검색, 출처·성공 시각·오류 표시 |
| 측정 경로 | 기존 3개 CLI 자동 수집 + OpenAI 호환·Anthropic·Gemini·로컬 Ollama 사용량 가져오기 |
| 가격표 자동 갱신 | 사용자 동의 후 기본 24시간 주기. 실패 시 직전 정상 자료 유지 |
| 프로그램 업데이트 | 별도로 신뢰한 Ed25519 키와 HTTPS 배포처를 설정한 뒤 확인·검증·다운로드. VS Code에서 선택적으로 자동 설치 |
| 정확도 보완 | 공급자 구분, Gemini 하위 에이전트/체크포인트 누락·세션 간 ID 혼동, 같은 합계의 캐시 보정, 일부 과거 단가 보존 |
| 이전 데이터 | v1 ledger를 백업하고 v2로 이관. Gemini 원본 재조회. 구형 수집기 교체 |

**모델 가격표 지원과 앱 자동 수집 지원은 다릅니다.** Qwen·GLM·DeepSeek 등의 가격을 불러와도 해당 웹사이트나 앱의 트래픽을 자동 감시하는 기능이 생기지 않습니다. 해당 API의 `usage`를 연동해야 합니다. 과거 모델 가격 지원은 그 모델이 지금 서비스 중이거나 각 CLI에서 선택 가능하다는 보장이 아닙니다.

## 1. 설치와 기존 버전 교체

### VS Code

Extensions → `…` → **Install from VSIX…**에서 `token-meter-local-0.2.0.vsix`를 선택한 뒤 필요하면 창을 다시 로드합니다. 기존 확장과 동일한 식별자이므로 별도 앱으로 만들지 않았습니다.

```sh
code --install-extension token-meter-local-0.2.0.vsix
```

VS Code 상태바를 클릭하면 대시보드가 열립니다. 명령 팔레트의 `Token Meter`에서 설정, 도구/기간 선택, 수집기 중지/재시작, 가격표 갱신, 프로그램 업데이트 확인/설치를 실행합니다. 실제 VS Code 설치는 이 개발 환경에서 시험하지 않았으며 확장 API 모의 테스트만 수행했습니다.

기존 수집기 버전이 낮으면 인증된 종료 요청을 보낸 뒤 새 수집기를 시작합니다. 현재 확장보다 새 수집기가 실행 중이면 자동으로 내리지 않습니다. 업데이트 설치 후에는 작업을 저장하고 창을 다시 로드하세요. 수집기는 원래처럼 VS Code 종료 뒤에도 다른 표시기를 위해 계속 실행됩니다. 종료 명령은 **Token Meter: Stop Collector**입니다.

### 터미널 / 독립 실행

ZIP을 풀고 `token-meter` 폴더에서:

```sh
node bin/cli.js serve --open
# 실제 로그와 분리된 합성 데이터
node bin/cli.js demo --open
# 다른 터미널에서
node bin/cli.js status --scope all
node bin/cli.js watch --scope today
node bin/cli.js stop
```

`npm install`이나 빌드가 필요하지 않습니다. 기존 독립 실행 버전을 교체할 때는 먼저 기존 수집기를 종료하세요. 이 버전은 독립 실행 소스 폴더를 원격 ZIP으로 자동 덮어쓰지 않습니다.

기본 저장소 `~/.token-meter`는 유지합니다. 변경은 `TOKEN_METER_HOME`, `--data-dir`, VS Code의 `tokenMeter.dataDirectory`로 합니다. 0.1.0 ledger는 최초 이관 전 `ledger.pre-0.2.0.json`에 보존합니다. **v2 ledger를 0.1.0으로 다시 열 수는 없습니다.** 백업 복원은 업그레이드 이후 사용량을 되돌릴 수 있으므로 별도 보관 후 판단해야 합니다.

## 2. 모델·가격표 자동 갱신

**대시보드 → 설정 → “모델·가격표를 하루 한 번 자동 갱신” → 설정 저장.**

기본은 꺼짐입니다. 켜면 수집기가 실행되는 동안 갱신 시점에 선택한 서버로 HTTPS 요청을 보냅니다. 가격표·ETag 외에 프롬프트, 코드, 사용량, API 키를 보내지 않습니다. 서버는 접속 IP와 User-Agent를 볼 수 있습니다. 꺼도 이미 내려받은 가격표는 계속 쓸 수 있습니다.

- `models-dev`: 커뮤니티 관리 참고 가격입니다. 공급자 ID를 보존하며 정확성을 공급자 청구서와 동일시하지 않습니다.
- `openrouter`: OpenRouter 모델 API에 게시된 **OpenRouter 경로의** 가격입니다. OpenAI/Anthropic 직접 API 가격으로 적용하지 않습니다.

수동 확인:

```sh
node bin/cli.js catalog
node bin/cli.js refresh-prices
```

대시보드의 **가격표 지금 갱신**, **지원 모델 검색**도 사용할 수 있습니다. 수동 갱신은 자동 옵션이 꺼져 있어도 외부에 접속합니다. 성공·실패·마지막 성공 시각은 출처별로 표시합니다. 스키마 오류, 빈 목록, 음수 단가, 과도한 목록 축소, 미지원 조건은 보수적으로 제외/거부합니다. 이미지·음성 생성 전용 모델을 텍스트 가격으로 억지 변환하지 않습니다.

`config.json`의 옵션:

```json
"catalogUpdates": {
  "enabled": true,
  "intervalHours": 24,
  "sources": ["models-dev", "openrouter"]
}
```

확인은 백그라운드에서 약 1분마다 예정 시점을 검사하므로 토큰 로그 수집을 네트워크 응답으로 막지 않습니다. 재시작해도 마지막 시도를 저장해 불필요한 반복 요청을 줄입니다. 꺼져 있던 프로그램의 예약 시점까지 보장하는 OS 서비스/스케줄러는 아닙니다.

**과거에 단가가 저장된 요청은 일부 금액이 미정이어도 그 스냅샷을 유지합니다.** 단가가 전혀 없던 요청만 자동 재평가합니다. 현재 가격표로 과거 청구 당시 가격을 복원하는 기능은 아닙니다. 과거 기록의 모델/토큰 세부값이 보정되면 같은 요청의 저장된 단가로 금액을 다시 산출할 수 있습니다.

## 3. 프로그램 자동 업데이트 — 가격표와 별개

**공개 배포 서버와 Marketplace 등록은 아직 없습니다. 따라서 처음 설치한 상태에서 미래 코드를 자동으로 받아오는 서비스는 연결되어 있지 않습니다.** 업데이트 코드는 구현했으며 배포자가 운영하는 HTTPS 호스트와, 그 호스트와 별개 경로로 신뢰한 Ed25519 공개키가 필요합니다.

로컬 `config.json`에 다음을 설정합니다. 아래 주소/키는 구조 설명용 자리표시자이며 작동하는 배포처가 아닙니다.

```json
"appUpdates": {
  "enabled": true,
  "intervalHours": 24,
  "manifestUrl": "https://YOUR-RELEASE-HOST/latest.json",
  "publicKey": "-----BEGIN PUBLIC KEY-----\nYOUR_ED25519_PUBLIC_KEY\n-----END PUBLIC KEY-----\n",
  "allowedHosts": ["YOUR-RELEASE-HOST"],
  "autoDownload": true
}
```

실제 `allowedHosts`에는 소문자 실제 호스트를 사용하세요. 자리표시자 그대로는 설정 검증을 통과하지 않습니다. 이 항목은 대시보드에서 임의 변경하지 못하게 했습니다. 키를 manifest와 함께 자동 내려받아 신뢰하지 않습니다.

기본 흐름은 **버전 확인 → Ed25519 서명·만료·이전 최고 버전 확인 → 다운로드 → SHA-256·크기·VSIX 식별자 확인 → 설치 직전 재검증**입니다. HTTPS 기본 포트·허용 호스트만 쓰며 리다이렉트와 사설 IP 연결을 거부합니다. `curl | sh`나 원격 스크립트 실행은 사용하지 않습니다.

VS Code에서 `Token Meter: Check Application Updates`, 이어서 `Install Verified Update`를 사용합니다. 기본 설치는 확인 창을 요구합니다. **자동 설치**까지 원하는 경우 VS Code 사용자 설정에서 다음을 켜고, 위의 `enabled`와 `autoDownload`도 켭니다.

```json
"tokenMeter.autoInstallUpdates": true
```

이 설정은 머신 범위이며 신뢰되지 않은 워크스페이스에서는 자동 설치를 하지 않습니다. 검증한 로컬 VSIX를 VS Code 기본 설치 명령에 넘깁니다. 파일이 바뀌었거나 서명 검증에 실패하면 설치하지 않습니다. 같은 OS 사용자 권한을 이미 장악한 악성 프로그램까지 격리하는 보안 샌드박스는 아닙니다.

CLI:

```sh
node bin/cli.js check-update
node bin/cli.js download-update
```

독립 실행 CLI에서는 확인·VSIX 준비까지만 합니다. 소스 실행 환경의 자동 교체나 재시작은 하지 않습니다. 배포 운영/서명 방법은 [UPDATES.md](docs/UPDATES.md)를 참고하세요.

## 4. 더 많은 API / 로컬 모델 측정

### 기존 3개 CLI

기본 읽기 경로는 Codex의 `$CODEX_HOME/sessions`, `archived_sessions`; Claude의 `$CLAUDE_CONFIG_DIR/projects`; Gemini의 `~/.gemini/tmp`입니다. `chats/<부모 세션>/<에이전트>.jsonl` 형태의 하위 에이전트 기록과 `$set.messages` 체크포인트도 읽습니다. 미설정 시 Codex/Claude 홈은 `~/.codex`, `~/.claude`입니다. CLI가 남긴 모델·토큰을 읽으므로 새 모델도 사용량 스키마가 같으면 집계하며 가격이 없을 때만 미정으로 표시합니다.

선택한 모델은 **최근 로그 관측값**입니다. 모델을 바꾸고 아무 요청도 하지 않은 경우 UI의 선택값을 바로 읽는 기능이 아닙니다. 임시/삭제/미기록 세션은 수집할 수 없습니다.

### API 사용량 연동

`examples/`에는 OpenRouter와 로컬 Ollama의 합성 사용량 JSON, OpenAI 호환 응답을 프로젝트 코드에서 등록하는 `record-openai-compatible.mjs`가 있습니다. 예시 JSON을 실제 기록에 넣지 마세요. 먼저 별도 데모/테스트 데이터 폴더에서 확인하세요.

```sh
node bin/cli.js record --file /path/to/actual-usage.json
```

등록 형식은 `schema: token-meter.usage.v1`이며 `format`은 `openai`, `anthropic`, `gemini`, `ollama`, `normalized` 중 하나입니다. **modelProvider, 실제 model, 고유 requestId, timestamp, usage**를 명시해야 합니다. 텍스트 비용에는 `modality: "text"`도 명시합니다. 같은 요청 ID를 재전송해도 중복 합산하지 않으므로 요청 ID를 요청마다 유일하게 유지해야 합니다.

OpenRouter에서 Qwen·GLM·Cohere 등을 사용하면 `modelProvider: "openrouter"`와 전체 모델 ID를 그대로 전달합니다. DeepSeek 등 직접 API는 실제 과금 공급자 ID를 지정하고, 그 공급자의 가격표 또는 사용자 단가가 있어야 비용이 계산됩니다. 모델 이름이 비슷하다는 이유로 다른 공급자의 가격을 대신 붙이지 않습니다.

지원 데이터는 다음 의미로 정규화합니다.

| format | 사용량 |
|---|---|
| openai | `input_tokens`/`prompt_tokens`, `output_tokens`/`completion_tokens`, 캐시·추론 세부값. 추론은 출력에 포함 |
| anthropic | 일반 입력과 캐시 읽기·쓰기 별도. 쓰기 TTL이 없으면 임의로 싼 값을 선택하지 않음 |
| gemini | `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`, 캐시. thoughts는 출력에 한 번 합산 |
| ollama | `prompt_eval_count`, `eval_count`, **local:true**. 로컬 API 토큰 요금만 0; 전기·장비 비용 제외 |
| normalized | `input`은 캐시 포함, `output`은 추론 포함. 캐시·추론 필드는 합계의 세부 항목 |

JSONL 자동 추가를 쓸 경우 이 도구의 `config.json`에 `roots.generic` 경로 배열을 넣습니다. 기본은 빈 배열입니다. 대시보드에서 **사용량 연동** 필터로 볼 수 있습니다.

동일 요청을 기존 CLI 로그와 generic 경로 **양쪽에 넣지 마세요.** 서로 다른 수집 경로 사이의 전역 중복 제거는 제공하지 않습니다. 웹 채팅, Antigravity, 다른 프로그램의 선택 UI나 네트워크 요청을 자동 훔쳐보는 기능은 아닙니다.

## 5. 계산·저장·개인정보 제한

입력 비용 = 일반 입력 + 캐시 읽기 + 캐시 쓰기. 출력 비용은 공급자의 추론 토큰 포함 관계를 정규화한 출력입니다. 미확인 항목은 `미정` 또는 `확인분 + ?`로 표시합니다. 텍스트 외 요금, 도구 호출료, 구독료, 캐시 시간당 저장료, 무료 크레딧, 세금, 지역 할증, 카드 환전 수수료는 포함하지 않습니다. 원화는 직접 입력한 환율의 참고값입니다.

GPT-6 직접 API 기본 단가는 short-context 참고값입니다. 직접 API의 장문 적용 경계를 확정하지 못했으므로 이를 자동 판정하지 않습니다. OpenRouter 모델 API에 따로 게시된 경계를 다른 과금 경로에 그대로 적용하지 않습니다. 알려진 장문 조건이 빠진 커뮤니티 규칙은 기존 복합 가격 규칙을 덮지 못하게 합니다.

원본 로그는 읽기만 합니다. 프롬프트·응답·코드 본문은 ledger/내보내기에 저장하지 않습니다. 모델, 시각, 사용량, 프로젝트 경로/이름, 요청/세션/에이전트 식별자, 단가 스냅샷은 저장됩니다. 가격표/앱 갱신을 끈 기본 상태에서는 외부 요청을 하지 않습니다.

| 로컬 파일 | 내용 |
|---|---|
| config.json / prices.user.json | 사용자 설정 / 단가 규칙 |
| ledger.json | v2 사용량·파일 위치·작업 구간 |
| ledger.pre-0.2.0.json | v1 이관 전 백업 |
| catalog.cache.json | 출처별 마지막 정상 가격표·갱신 시각 |
| updates.json / updates/ | 서명된 릴리스 정보 / 검증된 VSIX |
| runtime.json / collector.lock | 로컬 접근키·주소 / 실행 잠금 |

서버는 `127.0.0.1`에 바인딩하며 API 접근키와 Host/Origin을 검사합니다. `runtime.json` 및 주소의 `#key`를 공유하지 마세요. POSIX 생성 파일 권한을 제한하지만 Windows ACL은 사용자 환경에서 확인해야 합니다. WSL/SSH/컨테이너는 그 환경에서 수집기를 실행해야 하며 포트 전달은 실기 검증하지 않았습니다.

**여전히 남은 개선:** 장기 운영용 데이터베이스/보존 정책, 대규모 전체 로그 집계 최적화, 실제 CLI 버전별 호환성 검사, 현재 컨텍스트/계정 한도 연동, 실제 청구서 대조, 멀티모달 가격 엔진, 실제 Windows/macOS·VS Code·PiP 실기 검증. 현 버전은 ledger 전체 JSON 스냅샷을 저장하므로 데이터가 크게 쌓이면 I/O 비용이 커질 수 있습니다.

## 6. 개발·검증

```sh
npm test
npm run check
npm run package    # Python 3 표준 라이브러리
```

선택적 UI 테스트에는 Python Playwright/Chromium이 필요합니다. 제품 실행에는 필요하지 않습니다. 테스트 범위와 미검증 항목은 [검증 보고서](docs/TEST-REPORT.md)에 있습니다.

## 자료 / 라이선스

기준일 2026-09-25. 단가와 API 구조는 변할 수 있습니다. 각 단가 규칙에도 원본 URL·기준일을 보존합니다.

- OpenAI 가격: https://developers.openai.com/api/docs/pricing
- OpenAI 모델: https://developers.openai.com/api/docs/models/gpt-4.1-mini
- Anthropic 가격: https://platform.claude.com/docs/en/about-claude/pricing
- Gemini 가격: https://ai.google.dev/gemini-api/docs/pricing
- Gemini CLI 기록 구현: https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingService.ts
- OpenRouter 모델 API: https://openrouter.ai/api/v1/models
- models.dev: https://models.dev / https://github.com/anomalyco/models.dev
- VS Code 설치 명령: https://code.visualstudio.com/api/references/commands
- VS Code VSIX 및 업데이트: https://code.visualstudio.com/docs/configure/extensions/extension-marketplace

MIT. OpenAI, Anthropic, Google, Microsoft, OpenRouter의 공식 제품이나 인증된 확장이 아닙니다. Marketplace에 게시/서명된 제품이라고 주장하지 않습니다.
