# 업데이트 배포 운영

현재 공개 배포처는 없습니다. 이 문서는 배포자가 직접 운영할 경우의 절차입니다. 원격 실행 서버나 비밀키를 사용자에게 대신 만들거나 게시하지 않습니다.

## 배포 준비

개인키는 프로젝트 밖의 안전한 경로에서 생성·보관합니다. 유출되면 공격자가 유효한 업데이트에 서명할 수 있습니다. 개인키를 Git/ZIP/VSIX/가격표 서버에 넣지 마세요. 아래는 OpenSSL이 있는 개발 PC의 예입니다.

```sh
openssl genpkey -algorithm ED25519 -out /secure/token-meter-release-private.pem
openssl pkey -in /secure/token-meter-release-private.pem -pubout -out /secure/token-meter-release-public.pem
```

개인키 파일/상위 디렉터리 권한을 제한하세요. 공개키는 독립적으로 신뢰한 경로로 배포하며 프로그램의 `appUpdates.publicKey`에 고정합니다. 서버에서 받은 새 키로 자동 교체하지 않습니다.

## 새 정식 릴리스

1. `package.json` 버전과 변경 내역을 갱신하고 테스트를 실행합니다.
2. `npm run package`로 VSIX를 생성합니다.
3. 아래 명령으로 manifest를 서명합니다. 명령의 URL은 실제 업로드할 최종 VSIX URL이어야 합니다.

```sh
node scripts/sign-release.js \
  --vsix dist/token-meter-local-0.2.1.vsix \
  --version 0.2.1 \
  --url https://YOUR-RELEASE-HOST/token-meter-local-0.2.1.vsix \
  --key /secure/token-meter-release-private.pem \
  --out latest.json \
  --days 30
```

정식 `x.y.z` 버전만 지원하며 사전 릴리스 채널은 없습니다. 이 명령은 미래 0.2.1이 이미 존재한다는 뜻이 아니라 다음 릴리스의 예시입니다.

HTTPS 정적 호스트에 **VSIX를 먼저**, 검증된 `latest.json`을 나중에 올립니다. 업로드는 이 프로젝트의 기능이 아닙니다. 다운로드 URL은 리다이렉트 없이 HTTP 200으로 최종 바이트를 반환해야 합니다. 기본 GitHub Releases 다운로드 URL처럼 리다이렉트를 요구하는 경로는 이 버전에서 직접 사용할 수 없습니다. 허용 호스트를 별도 설정하고 실제 배포 환경에서 시험하세요.

Manifest는 최대 90일 유효기간만 허용합니다. 신규 릴리스가 없어도 운영 중인 피드를 계속 제공하려면 만료 전에 같은 버전의 manifest를 다시 서명·게시해야 합니다. 클라이언트가 마지막으로 검증한 최고 버전보다 낮은 릴리스를 게시하지 마세요.

## 설치 모델

가격표 갱신은 실행 코드를 받지 않습니다. 프로그램 갱신은 별도 Ed25519 서명을 검증합니다. HTTPS·서명은 신뢰한 배포자가 악성 코드를 서명하는 것까지 막지 않습니다.

수집기에서 자동 다운로드를 켜고, VS Code에서 `tokenMeter.autoInstallUpdates`를 별도로 켜야 무인 설치 요청이 동작합니다. 기본은 사용자 확인 설치입니다. 업데이트를 적용하는 실제 호스트는 VS Code이며, 수집기가 직접 받은 코드를 실행하지 않습니다. 설치 후 창 다시 로드가 필요할 수 있습니다. 독립 실행판은 소스 자동 교체를 하지 않습니다.

실제 Marketplace 등록을 추후 선택하면 VS Code의 기본 배포/업데이트 체계를 사용하는 방향도 있습니다. 현재 로컬 publisher 이름은 Marketplace 소유권을 뜻하지 않으며 공개 배포 전 게시자 ID 결정과 서명 신뢰 배포가 필요합니다.
