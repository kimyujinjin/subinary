# 수자인 신축 조회 실행기 — 운영 활성화

공식 경로만 사용한다: `tools/sujain-web-runner` + Playwright `playwright-core@1.62.0` + 이미지에 넣은 전용 Chromium(headless shell). 신한 `bank-web-runner` / `BANK_WEB_*` 경로·실행 파일·공급자와 섞지 않는다. ego lite / ego-browser와 개인 브라우저 프로필·쿠키·비밀번호 저장소·인증서를 쓰지 않는다.

자격증명은 앱이 FinanceVault에 저장한 뒤 stdin으로만 runner에 전달한다. `SUJAIN_WEB_*` 환경 변수·compose·문서·이미지에 아이디·비밀번호·금고 키를 넣지 않는다.

관련(동일하지 않음): [bank-web-connections.md](./bank-web-connections.md), [finance-connections.md](./finance-connections.md).

## 이미지에 포함되는 것

`infrastructure/docker/Dockerfile.prod` 런타임 단계가 다음을 설치·검증한다.

| 경로 | 역할 |
| --- | --- |
| `/app/tools/sujain-web-runner/run.mjs` | 공식 runner 진입점 |
| `/app/tools/sujain-web-runner/node_modules/playwright-core` | 정확히 `1.62.0` (API 가용성 검사) |
| `/app/tools/sujain-web-runner/chromium` | 전용 headless Chromium 실행 파일로 가는 심볼릭 링크 |

전체 Chromium·ffmpeg는 넣지 않고 headless shell만 둔다(홈서버 디스크). 시스템 라이브러리는 이미지 빌드 시 `playwright-core install-deps chromium`으로 맞춘다.

`chromium` 심볼릭 링크 대상은 Playwright `playwright-core@1.62.0` 레지스트리 기준이다. `linux-x64`는 `chrome-headless-shell`, 홈 Mac 운영 빌드(`linux/arm64`)는 `chrome-linux/headless_shell`이다. Dockerfile은 두 이름을 모두 찾아 링크한다.

## Compose 연결

`docker-compose.prod.yml`의 **api** 서비스만 아래를 넣는다(worker/web과 공유 이미지는 빌드 산출물을 갖지만, 스위치·경로는 api에만 연결한다).

| 변수 | 운영 값 | 비고 |
| --- | --- | --- |
| `SUJAIN_WEB_CONNECTIONS_ENABLED` | 기본 `true` (`${SUJAIN_WEB_CONNECTIONS_ENABLED:-true}`) | 비밀 아님. 끄려면 호스트 `.env`에 `false` |
| `SUJAIN_WEB_RUNNER_PATH` | `/app/tools/sujain-web-runner/run.mjs` | 이미지 고정 경로 |
| `SUJAIN_WEB_BROWSER_EXECUTABLE` | `/app/tools/sujain-web-runner/chromium` | 이미지 고정 심볼릭 링크 |

금고 스위치(`FINANCE_CONNECTIONS_ENABLED`와 vault.env)는 기존 문서대로 유지한다. 수자인 조회는 금고가 켜져 있어야 자격증명을 읽고, 위 세 값이 런타임을 켠다.

## 운영자 활성화 절차

1. 이 변경이 포함된 커밋으로 운영 이미지를 **재빌드**한다(`pnpm ops:infra:bootstrap` / 공식 `deploy.sh`). 이전 이미지는 runner 소스는 있어도 `playwright-core`·Chromium이 없다.
2. api 컨테이너만 확인한다(값은 출력하지 않는다).

```bash
docker exec family-memory-ai-api-1 sh -c 'test -f "$SUJAIN_WEB_RUNNER_PATH" && test -x "$SUJAIN_WEB_BROWSER_EXECUTABLE" && test -f /app/tools/sujain-web-runner/node_modules/playwright-core/package.json && echo ok'
docker exec family-memory-ai-api-1 sh -c 'node -e "const p=require(\"/app/tools/sujain-web-runner/node_modules/playwright-core/package.json\"); if(p.version!==\"1.62.0\") process.exit(1); console.log(\"playwright-core ok\")"'
docker exec family-memory-ai-api-1 sh -c 'test "$SUJAIN_WEB_CONNECTIONS_ENABLED" = true && echo enabled'
```

3. 앱에서 수자인 자격증명이 금고에 저장된 뒤 「확인」을 누른다. 런타임/실행 파일/`playwright-core` 부재만으로 `runtime_unavailable`(「신축 조회 실행 환경이 준비되지 않았어요.」)에 바로 떨어지지 않아야 한다.
4. 실제 수자인 로그인·추가 인증 성공 여부는 반영 후 화면에서 확인한다. 이 문서는 로그인 성공을 보증하지 않는다.

## 읽는 화면과 흐름 (2026-11-08 확인)

로그인된 브라우저에서 구조만 확인했다(값은 보지 않았다). runner는 이 구조에만 기대고, 값이 아니라 개수·머리 글자만 진단에 남긴다.

1. 공식 로그인(`form#frm` → `a.btnLogin`) 뒤 `/mypage/payment`(분양대금조회)로 간다.
2. 처음에는 납부 표(`table.st1`)의 `tbody`가 비어 있다. 표 밖 단지 `select#preInsp`에서 값이 빈 자리표시(「선택」)를 뺀 첫 세대 option을 고른다.
   - 고를 세대가 없으면 `unit_not_registered`(「수자인 사이트의 My 분양단지에 등록된 세대가 없어요. 사이트에서 먼저 등록해 주세요.」).
   - 세대가 여러 개여도 지금은 **첫 번째만** 읽는다(개수는 진단 `units`로만 남긴다).
3. `onclick`에 `searchPayment`가 있는 조회 버튼을 누른다. 사이트는 동기 XHR(`/mypage/payment/getPaymentInfo`)로 표를 채운다. 조회 뒤 사이트 알림이 뜨면 글자는 남기지 않고 닫는다(로그인·세션 안내면 `authentication_required`, 그 밖은 `unsupported_layout`).
4. 보이는 `table.st1`의 `tbody`에 칸 있는 줄이 생길 때까지 표 대기 예산(기본 15초) 안에서 기다린 뒤 읽는다.
   - caption 「아파트 분양대금」: 머리(`thead th`) 8칸 `회차|약정일자|약정금액|납부일자|납부원금|연체료|할인료|실납부금`. 줄 첫 칸(`th`)이 회차 이름(계약금1차·중도금3차·잔금·계). 데이터 줄 사이 칸 없는 빈 `tr`은 건너뛴다.
   - caption 「별도 계약 품목」: 옵션 계약마다 표 하나, 바로 앞 `div.ect_item`의 품목 이름 목록을 함께 보낸다. 줄은 계약금·중도금·잔금·계.
   - 숨겨진 연락처 입력 표(`table.basic_table`)는 읽지 않는다.
5. API는 회차 이름으로 종류·회차를 정하고(계약금→계약금, 중도금N차→중도금 N회, 잔금), `계` 합계 줄은 건너뛴다. 별도 계약 품목 줄은 모두 옵션이며 이름은 `<첫 품목>[ 외 N] · <회차 이름>`이다. 금액=약정금액, 예정일=약정일자, 낸 금액=납부원금, 납부일=납부일자.

세대 내 설치 품목(`/mypage/unit-items`)은 입주 뒤에만 메뉴가 열리고(사이트 `showInstalled()`가 입주 정보에 설치 URL이 있을 때만 보인다) 입주 전 계정은 `/mypage/payment`로 되돌려진다. 옵션 대금은 위 별도 계약 품목 표에 있으므로 runner는 그 화면에 가지 않는다.

실패 경고 줄의 진단은 `stage=scrape_payment layout=payment:t=<표 수>;searched=<0|1>;units=<세대 option 수>;h=[머리…];…` 모양이다. `searched=0`이면 조회 버튼까지 가지 못했고, `units=0`이면 단지 option이 없었다.

## Chromium 샌드박스(루트 컨테이너)

운영 API 이미지는 `USER` 없이 uid 0으로 돈다. Chromium은 루트에서 샌드박스를 켠 채 시작하지 못하므로, `tools/sujain-web-runner`는 **uid 0일 때만** Playwright `chromiumSandbox`를 끈다. 비루트에서는 샌드박스를 유지한다. 신한 `bank-web-runner` 정책은 바꾸지 않는다.

Chromium 기동 실패는 `runtime_unavailable` + 고정 사유 `chromium_launch_failed`로 매핑한다(자격증명·원문 stderr는 응답/DB에 넣지 않는다). API는 stderr에서 Chromium/Playwright 신호만 짧게 골라 경고 로그에 남긴다. 화면의 「확인」 실패는 서버 `message`(및 갱신된 `connection.statusMessage`)를 보여 주며, 예전에 하드코딩했던 「추가 인증」 문구로 덮지 않는다.

## 끄기

호스트 `.env`(compose 보간용)에 `SUJAIN_WEB_CONNECTIONS_ENABLED=false`를 두고 api를 재생성한다. runner 바이너리는 이미지에 남아 있어도 API는 조회를 시작하지 않는다.

## 하지 않을 것

- `BANK_WEB_RUNNER_PATH` / `BANK_WEB_BROWSER_EXECUTABLE`를 수자인에 재사용
- 호스트 개인 Chrome/Chromium 프로필 마운트
- 자격증명·vault 키를 compose·이미지·문서·진단 로그에 기록
