# Token Meter Local 0.6.0 — 검증 보고서

검증일: 2026-09-25. 실제 사용자 로그·계정·청구 명세서에 접근하지 않았습니다.

## 수행 결과

| 검사 | 결과 / 범위 |
|---|---|
| 수정 전 0.5.0 Node 기준 테스트 | 201 통과 |
| 수정 후 Node 테스트 | **237 통과, 실패 0, 건너뜀 0** |
| 추가 출력/THINKING 테스트 | 위 237개 중 **36개** |
| 기본 UI | 28 검사 통과 |
| 재측정 UI | 20 검사 통과 |
| 가격/보존 이력 UI | 17 검사 통과 |
| 새 THINKING UI | 17 검사 통과 |
| UI 합계 | **82 검사 통과, JavaScript 오류 0** |
| 실행 의존성 | 외부 npm runtime dependency 없음 |

Node 테스트는 Node 22.16.0 / Linux에서 수행했습니다. UI는 Chromium 144.0.7559.96 / Python Playwright를 사용했습니다. `node-tests.tap`, `*-report.json`에 실제 결과를 보존합니다.

## 새 회귀 검증

- 전체 출력 8,441 = 비추론 15 + THINKING 8,426이며 전체 비용/토큰에 THINKING을 두 번 더하지 않음.
- Claude의 명시적 thinking detail, OpenAI Responses/Chat Completions, Codex 누적 delta, Gemini generateContent/Interactions의 서로 다른 포함 관계.
- 필드 미기록/null과 명시적 0 구분. malformed/음수/문자열 optional 카운터 거부.
- Antigravity의 맞는 분해도 참고로 표시; 잘못된 합, 없는 세부값, 부분 전체 출력, 대체 관측 충돌 처리.
- 알려진 전체 출력 비용을 세부값 누락이 무효화하지 않음. 장문 배수 적용 후 정확한 pico 비용 분해.
- 300개의 결정적 입력 조합에 대한 토큰/정수 비용 보존식 검사.
- 부분 집계의 알려진 THINKING과 미분류 출력을 구분. 분해 필터와 CSV/JSONL null 보존.
- 업그레이드 전 백업, 보존된 원본 재수집, 재시작, 변화 없는 재스캔, 동일 요청 detail 보완을 revision으로 저장.
- 기준점 이후의 THINKING delta, 메타데이터 보완을 신규 소비로 세지 않음, 종료 결과 고정.
- 프롬프트/추론 본문 sentinel이 safeEvent/내보내기에 포함되지 않음.

## UI와 실기 범위

먼저 실제 루프백 URL로 탐색을 시도했으나 실행 환경의 관리자 정책 때문에 `ERR_BLOCKED_BY_ADMINISTRATOR`가 발생했습니다. 정책을 변경하지 않았습니다. 이어서 기존 `--offline` 하네스로 실제 앱 HTML/CSS/JS를 빈 문서에 렌더링하고 fetch를 실제 인증된 루프백 HTTP API에 연결했습니다. **실제 브라우저 탐색과 CSP까지 검증한 종단간 시험은 아닙니다.** API 인증/Origin/Host는 기존 Node HTTP 테스트로 확인합니다.

기본 데모 80개, 이력 시험 219개, THINKING 추가 시험 4개 요청 등은 모두 합성입니다. 375/430/768/1280/1440px에서 다섯 지표의 토큰·비용 10개 값과 페이지 가로 넘침을 검사했습니다. 스크린샷은 실제 앱 코드의 렌더링이며 사용자 실사용량이 아닙니다.

PiP는 같은 렌더러를 별도 문서에 적용한 검사입니다. OS 최상위 유지, 사용자 브라우저 권한, 실제 VS Code Extension Host 설치, macOS/Windows/WSL/SSH 동작은 확인하지 못했습니다.

## 배포 검증

Python 표준 라이브러리 패키징에서 ZIP CRC, VSIX XML/확장 식별자/진입점/자산을 검사합니다. 최종 소스 ZIP을 별도 폴더에 풀어 Node 테스트와 구문 검사를 다시 수행하며, 해당 결과는 배포 폴더의 `PACKAGE-VERIFICATION-0.6.0.json`으로 제공합니다. 이 문서의 코드/UI 결과와 설치 실기는 다른 범위입니다.

## 남는 불확실성

Antigravity 비공개 세부 필드의 의미는 테스트만으로 확정할 수 없습니다. 실제 사용자 버전의 원본 DB와 교차 확인하지 않았습니다. 작은 OUT값 자체는 THINKING 누락의 증거가 아닙니다. 실제 계정 청구액, 전체 단가 최신성, 장문 GPT-6 경계, 장기 대량 성능, 업데이트 서버 다운로드를 이번에 새로 검증한 것은 아닙니다.
