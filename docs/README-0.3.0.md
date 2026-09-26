# Token Meter Local 0.3.0

**Codex · Claude Code · Antigravity의 로컬 기록을 읽어 IN 토큰/비용, OUT 토큰/비용, TOTAL 토큰/비용을 표시하는 VS Code 확장과 독립 대시보드입니다.**

0.3.0에서 **Antigravity 전용 SQLite 수집기**를 추가했습니다. Gemini CLI 기록의 이름만 바꾸거나 화면 텍스트를 토큰으로 추정하지 않습니다. 기존 Gemini CLI 기록은 별도 항목으로 유지됩니다.

**지원 조건:** Antigravity가 `conversations/*.db`에 `gen_metadata` 구조를 저장하는 버전. 공개 구현을 참고한 **비공개 데이터 형식** 해석이며, 실제 사용자 Antigravity 계정/바이너리와의 실기 검증은 하지 않았습니다. 구형 `.pb`만 있는 설치는 이 수집기로 측정하지 못합니다.

![합성 SQLite 데이터로 실행한 Antigravity 화면](docs/antigravity.png)

## 1. VS Code 설치 / 0.2.1 교체

1. `token-meter-local-0.3.0.vsix`를 받습니다.
2. VS Code 확장 탭의 `…` → **Install from VSIX…** → 해당 파일 선택.
3. 작업을 저장하고 **Developer: Reload Window**를 실행합니다.
4. 하단 `TM`을 클릭해 대시보드를 열고 도구를 **Antigravity**로 선택합니다.
5. Antigravity에서 응답을 완료한 뒤 수집 상태를 확인합니다. 기본 갱신 간격은 5초입니다. 실제 기록이 기록/커밋되기 전까지 숫자는 바뀌지 않습니다.

기존 `~/.token-meter`를 지우지 마세요. 0.2.1의 v2 ledger를 그대로 읽으며, 원본 DB와 기존 사용 내역을 삭제하지 않습니다. 이전 수집기가 계속 실행 중이면 새 확장이 버전을 확인하여 교체합니다. 교체 실패 시 **Token Meter: Restart Collector**를 실행합니다.

VS Code 명령 팔레트에서 **Token Meter: Antigravity Diagnostics**를 실행하면 발견한 DB 개수, SQLite 런타임, 읽기/파싱 오류, 수집 상태를 확인할 수 있습니다. 이 진단에는 프롬프트와 인증키를 넣지 않습니다.

VS Code는 확장 표시기일 뿐입니다. Antigravity Desktop을 VS Code 안에서 실행할 필요는 없지만, **수집기는 해당 데이터가 있는 같은 컴퓨터/사용자 환경에서 실행**되어야 합니다. Antigravity IDE 자체의 VSIX 호환 설치는 검증하지 않았습니다.

### 실행 환경

| 실행 경로 | 조건 |
|---|---|
| VS Code 확장 | VS Code 1.95+. 확장의 Node 런타임 사용 |
| 독립 실행 | Node.js 20+ |
| Antigravity DB 읽기 | 위 Node 런타임에 `node:sqlite`가 있거나, PATH에 SQLite 모듈을 포함한 **Python 3** 필요 |

`node:sqlite`를 기본 제공하는 Node 22.13+가 이 수집 경로의 기준입니다. VS Code 내부 Node에 이 모듈이 없으면 Python 3 표준 라이브러리로 자동 전환합니다. 별도 Node를 설치했다고 VS Code 내부 Node가 바뀌지는 않습니다. 둘 다 없으면 `SQLite 런타임 없음`을 표시하며 임의로 0토큰을 만들지 않습니다.

**외부 npm 패키지는 필요하지 않습니다.** Python fallback은 macOS/Linux에서 `python3`, `python`, Windows에서 `py -3`, `python3`, `python`을 순서대로 시도합니다. Windows/macOS에서 이 경로를 직접 실행해 본 것은 아닙니다.

### 토큰 원 단위 표시

```json
{
  "tokenMeter.provider": "antigravity",
  "tokenMeter.tokenDisplay": "exact"
}
```

상태바는 `IN 15,000 tok / $0.007875 · OUT 2,000 tok / $0.0075 · TOTAL 17,000 tok / $0.015375`처럼 표시합니다. 위 값은 설명용 합성 예시입니다. 기본 상태바는 토큰을 K/M으로 축약하며, 대시보드 상단·툴팁·미니바는 원 단위 토큰을 보여줍니다. VS Code가 좁으면 자체적으로 상태바 항목을 숨기거나 자를 수 있습니다.

## 2. VS Code 없이 실행

소스 ZIP을 풀어 `token-meter` 폴더에서:

```sh
node bin/cli.js serve --open
```

이 터미널은 유지합니다. 다른 터미널에서:

```sh
node bin/cli.js status --scope all --provider antigravity --exact
node bin/cli.js diagnose-antigravity
node bin/cli.js dashboard
node bin/cli.js stop
```

실제 사용자 데이터와 분리된 합성 데모:

```sh
node bin/cli.js demo --open
```

SQLite 런타임을 사용할 수 있는 데모에는 Codex 36개, Claude 20개, 이전 Gemini 16개, **Antigravity SQLite 8개**, 총 80개 사용량 기록이 들어갑니다. 데이터는 별도 임시 폴더에 생성됩니다. 데모는 실제 기본 로그 경로를 읽지 않습니다. 종료 후 해당 임시 폴더를 자동 삭제하지 않습니다.

## 3. Antigravity 자동 탐색 경로

```text
~/.gemini/antigravity/conversations
~/.gemini/antigravity-cli/conversations
~/.gemini/antigravity-ide/conversations
```

하위 폴더의 `.db`를 검색합니다. `ANTIGRAVITY_DATA_DIR` 환경변수(쉼표로 여러 경로 구분) 또는 이 도구의 `config.json`에서 `roots.antigravity`를 지정할 수 있습니다. 기존 `roots`의 다른 항목은 유지한 채 아래 키를 추가합니다.

```json
"antigravity": ["/absolute/path/to/Antigravity/conversations"]
```

경로 대신 파일 하나를 넣는 방식은 지원하지 않습니다. 빈 배열은 해당 수집을 끕니다. WSL/SSH/컨테이너 데이터는 해당 환경 안에서 수집해야 합니다. 로컬과 원격 PC의 사용량을 자동 합치지 않습니다.

### 진단 상태

| 화면 | 의미 |
|---|---|
| N개 DB · N개 관측 | 지원 구조에서 읽은 기록이 있음. 계정 전체 수집을 보증하는 문구는 아님 |
| 일부 수집 | 오류/비지원 행/불명확한 중복 등이 있음. 알려진 값만 유지 |
| DB 발견 · 사용량 필드 미확인 | DB는 있으나 지원하는 사용량을 찾지 못함 |
| 과거 기록만 있음 · 원본 DB 없음 | 원본이 없어져도 기존 누적값은 보존됨 |
| 구형 PB 기록만 발견 | `.pb`는 발견했지만 이 버전의 SQLite 수집 대상이 아님 |
| SQLite 런타임 없음 | 내부 Node의 SQLite와 Python fallback을 모두 사용하지 못함 |
| DB 경로 없음 | 기본 경로에 파일이 없거나 다른 컴퓨터/사용자 폴더에 있음 |

## 4. 실제 계산 범위

입력은 일반 입력 + 캐시 읽기 + 캐시 쓰기로 정규화합니다. 출력은 기록된 출력 합계와 추론/가시 출력 세부값을 대조하며 **추론을 합계에 중복 가산하지 않습니다**. 실행 세대와 단계 테이블의 동일 요청, 관측된 재시도, 복제된 동일 세션 DB를 요청 식별자로 구분합니다.

Antigravity는 **공개 API 단가로 환산한 텍스트 토큰 비용**입니다. API 구독 크레딧 차감액, 월 구독료, 실제 추가 결제액 또는 계정 한도가 아닙니다. 전역 표시 설정이 API 추정이어도 Antigravity를 포함한 합계는 API 환산으로 표시합니다.

새로 포함한 Gemini 3.6/3.7/3.8 Flash의 API 참고 단가는 2026-09-25 공식 가격표 기준입니다. 2026년 말까지의 가격과 2027년 이후 가격을 분리했으며 **UTC 날짜 경계는 이 도구의 참고 계산 관례**입니다. 이를 실제 청구 시간대의 검증으로 해석하지 마세요. 시각이 없으면 해당 날짜 조건부 기본 단가를 선택하지 않습니다. 기존 모델 단가 전체를 이번 변경에서 새로 검증한 것은 아닙니다.

**단가 미확인은 `미정`, 일부 미확인은 `확인분 + ?`, 기록 없음은 `—`입니다.** 출력·입력별 가격을 별도로 유지합니다. 캐시 쓰기 TTL이나 모델 이름을 모르는데 가장 싼 단가를 임의 적용하지 않습니다. 원화 환율은 수동 입력입니다. 토큰 외 도구 호출료, 저장료, 이미지/오디오 등 별도 요금, 세금·환전 수수료는 제외합니다.

## 5. 중요한 제한

**비공개 DB 구조:** Antigravity의 공식 안정 API가 아닙니다. `.db` 확장자가 같아도 내부 구조가 달라지면 파서 수정이 필요합니다. 바뀐 필드 의미를 자동으로 완벽하게 감지할 수는 없습니다. 알려진 오류는 부분 수집으로 표시합니다.

**모델:** 현재 선택 화면을 실시간으로 읽는 것이 아니라 DB에 기록된 모델입니다. 이름 또는 알려진 표기 변형만 API 모델과 연결합니다. 내부 숫자 모델 ID만 있으면 `antigravity-model-id-N`으로 표시하고 단가는 미정입니다. 추론 강도 표기가 기록돼 있을 때만 강도를 표시합니다.

**시각·역할·프로젝트:** 요청 시각이 없으면 전체 누적에는 포함하되 오늘/월간/작업 구간에서는 제외합니다. DB 수정 시각을 요청 시각으로 꾸미지 않습니다. 현재 Antigravity의 프로젝트명·부모/하위 에이전트 관계는 자동 복원하지 않으므로 미분류로 표시합니다. 기존 Codex/Claude의 해당 집계 기능은 유지됩니다.

**중복·누락:** 요청 ID가 없을 때 생성 테이블은 세션+행 번호로 식별합니다. 식별자가 없는 단계 사용량은 생성 테이블과 중복일 수 있어 별도 합산하지 않고 부분 수집으로 표시합니다. 프로바이더 간 또는 generic 연동과의 전역 중복 제거는 없습니다. 같은 요청을 수동 연동 경로로도 넣지 마세요. 파싱하지 못한 원본을 삭제하면 복구할 수 없습니다.

**크기·실시간성:** DB 한 번 읽기에 50,000행, 메타데이터 128MiB, 개별 BLOB 8MiB, worker 약 20초 제한입니다. 제한 초과 시 그 스캔을 버리고 이전 누적과 오류를 유지합니다. 변경된 DB를 다시 읽는 방식이므로 대형 세션은 비용이 큽니다. WAL 커밋도 검사하지만 DB에 아직 남지 않은 진행 중 사용량을 즉시 알지는 못합니다. 기록 저장소는 여전히 전체 JSON ledger이므로 장기 대량 성능 검증은 남아 있습니다.

**미지원:** 구형 `.pb` RPC 복호화/조회, 웹 ChatGPT/Claude/Gemini, 계정 전체 잔여량, 실제 결제액, 여러 기기 동기화, OS 네이티브 최상위 창. 항상 위 미니바는 지원 브라우저의 Document PiP에 의존하며 부모 대시보드를 유지해야 합니다.

## 6. 자동 업데이트와 기존 기능

모델별·기간별·작업 구간별 집계, CSV/JSON 내보내기, 예산 알림, 사용자 가격표, 수동 환율은 유지했습니다. Antigravity 필터도 여기에 연결됩니다.

**가격표:** 설정에서 하루 한 번 자동 갱신을 켜거나 수동 버튼을 누릅니다. `models.dev`는 커뮤니티 참고 자료, OpenRouter는 해당 경로의 가격입니다. 기본 외부 갱신은 꺼져 있습니다. 실패하면 마지막 정상 자료를 유지하고 기존에 가격이 저장된 요청은 새 단가로 덮어쓰지 않습니다. 갱신 시 IP/User-Agent는 서버에 보이지만 코드/사용량/인증키를 업로드하지 않습니다.

**프로그램:** 서명 검증 updater는 유지되지만 **운영 중인 배포 서버/Marketplace는 연결되지 않았습니다.** 이번 파일은 수동 VSIX 설치본입니다. 사용자 설정만 켜면 존재하지 않는 서버에서 자동 갱신되는 상태가 아닙니다. 배포 설정은 [UPDATES.md](docs/UPDATES.md)를 참고하세요. 독립 실행 소스 ZIP을 자동 교체하지 않습니다.

## 7. 저장·개인정보

원본 DB는 읽기 전용으로 열고 `gen_metadata.data`, `steps.metadata`의 필요한 메타데이터만 해석합니다. 원본 프롬프트/코드/응답 바이트가 메모리나 Python의 비공개 IPC 파이프를 통과할 수는 있지만 **ledger와 내보내기에 대화 본문, 인증키를 저장하지 않습니다**. 시각·모델·토큰·단가·세션/요청 ID·파일 경로와 체크포인트는 저장됩니다.

수집기는 `127.0.0.1`에만 연결하며 접근키와 Host/Origin을 검사합니다. `runtime.json`과 `#key=`가 있는 대시보드 URL은 공유하지 마세요. 같은 사용자 권한을 가진 악성 프로그램으로부터의 격리를 제공하는 제품은 아닙니다. 로컬 저장 경로는 기본 `~/.token-meter`이며 `--data-dir` 또는 `TOKEN_METER_HOME`으로 바꿉니다.

## 8. 검증과 소스

```sh
npm test
npm run check
npm run package
```

테스트는 Node 22.16의 실제 SQLite 파일과 Python 3 fallback, 합성 protobuf, 로컬 HTTP, 모의 VS Code API 및 제한된 브라우저 렌더링으로 수행했습니다. **실제 Antigravity 앱/계정, VS Code 설치, macOS/Windows, 실청구액 대조 검증과는 다릅니다.**

[검증 보고서](docs/TEST-REPORT.md) · [Antigravity 데이터 구조/출처](docs/ANTIGRAVITY.md) · [개발 구조](docs/ARCHITECTURE.md)

MIT. OpenAI, Anthropic, Google, Microsoft의 공식/인증 확장이 아닙니다.
