# 2026-10-28 Dot 원격 금융 MCP 운영 기록

## 결과와 남은 단계

09:09 KST 공개 HTTPS 경로에서 실제 계정 OAuth 연결, MCP 초기화, 도구 9개 발견, `finance_quality`와 `finance_overview` 조회에 성공했다. 파싱 실패 0건, 카드 소유자 불일치 0건, 2026-10월 두 카드 합산 예산을 확인했다. 검증용 연결은 즉시 철회했다. 거래·분류·예산 데이터를 변경하지 않았다.

Aside에서 ChatGPT 로그인을 완료했다. 첫 플러그인 생성은 Cloudflare Bot Fight 모드가 OAuth 등록 요청을 차단해 실패했지만, 사용자의 실행 승인을 받아 해당 모드만 끈 뒤 DCR 등록과 **‘가족 가계부’ 플러그인 생성에 성공했다.** ChatGPT의 설치된 플러그인 목록에 항목이 나타났고, 실제 OAuth 로그인·읽기 허용 화면으로 이동했다. **가계부 사용자 연결 승인 및 Dot 대화 호출은 아직 미검증**이다. 예약 자동화도 생성하지 않았다. 기존 Codex 오전 9시 자동화는 중지 상태를 유지한다.

## ChatGPT 등록 차단 진단

- ChatGPT 생성 요청 응답: `Dynamic client registration failed: registration endpoint returned 403`.
- Cloudflare 보안 이벤트의 2026-10-28 09:32:32 KST 요청은 `app.subinary.cloud`의 `POST /mcp/oauth/register`, 사용자 에이전트 `Python/3.14 aiohttp/3.14.4`였다. 적용 서비스는 **Bot Fight 모드**, 작업은 **관리 챌린지**로 확인됐다.
- 등록 UI의 반환 주소는 서버 허용 목록과 동일한 `https://chatgpt.com/connector_platform_oauth_redirect`다. 한국어 표시 이름이나 OAuth 반환 주소 문제로 추정해 수정하지 않았다.
- 무료 Bot Fight 모드는 경로별 예외 및 WAF Skip 규칙을 지원하지 않는다. IP/ASN 전체 허용은 다른 방어까지 우회하므로 적용하지 않았다. [Cloudflare 공식 문서](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/)
- 사용자가 도메인 전체의 Bot Fight 모드 해제를 승인했고 Aside의 해당 스위치를 `off`로 변경했다. 다른 Cloudflare 보안 설정은 변경하지 않았다. 변경 후 서버에 `ChatGPT` DCR 클라이언트가 등록됐고 ChatGPT 생성 절차가 OAuth 로그인 화면까지 진행됐다.
- 변경 후 독립 검사에서 `/mcp/health`는 200, 인증 없는 `/mcp` 초기화는 401이었다. 봇 챌린지를 해제해도 금융 도구의 OAuth 인증은 필수다.
- 별도 Python urllib GET에서 발생한 `error code: 1010`은 Browser Integrity Check 관련 현상이다. 실제 ChatGPT 등록을 차단한 Bot Fight 모드 이벤트와 구분한다.

- MCP: `https://app.subinary.cloud/mcp`
- 연결 안내: `https://app.subinary.cloud/mcp/connect`
- 본인 연결 관리·해제: `https://app.subinary.cloud/mcp/connections`
- resource metadata: `https://app.subinary.cloud/.well-known/oauth-protected-resource/mcp`
- authorization metadata: `https://app.subinary.cloud/.well-known/oauth-authorization-server`

## 사용자 연결 절차

1. ChatGPT 플러그인 페이지에 사용할 Pro 계정으로 로그인한다.
2. `+` → 사용자 지정 MCP 서버 추가에서 이름 `가족 가계부`, 위 MCP 주소, OAuth 인증으로 만든다.
3. 동적 클라이언트 등록(DCR)을 사용한다. 비밀번호나 API 키를 채팅에 붙여 넣지 않는다.
4. 플러그인을 설치·연결하고 가계부의 로그인 화면에서 본인 계정으로 읽기 연결을 허용한다.
5. Dot에 `가족 가계부 도구로 이번 달 삼성카드·네이버 현대카드 합산 용돈과 파싱 실패 건수, 카드 소유자 불일치 건수, 조회 시각을 알려줘.`라고 요청한다.

현재 정확한 반환 주소 allowlist는 `https://chatgpt.com/connector_platform_oauth_redirect` 한 개다. 서버는 모든 authorization 성공·취소 응답에 `iss`를 반환한다. 실제 ChatGPT 관리 화면에서 다른 callback이 나타나면 정확한 주소를 운영 설정에 추가한 뒤 재검증한다. 사용자 입력 주소를 자동으로 허용하거나 와일드카드로 확대하지 않는다.

## 배포 구조

`Dot → 원격 MCP OAuth 토큰 → 금융 MCP 서비스 → 해당 사용자의 FMA 세션 → 기존 API` 흐름이다. API·웹·worker·PostgreSQL·Redis·Cloudflare 터널은 교체하지 않았다. 독립 `family-memory-ai-finance-mcp-1`을 추가하고 Caddy 경로만 교체했다. 기존 데이터베이스 마이그레이션은 없다. 가계부가 Mac의 Docker에서 실행되므로 Mac 전원·네트워크 의존성은 남는다.

- 이미지: `family-memory-ai/mcp:20261028` / `family-memory-ai/mcp:local`
- 이미지 ID: `sha256:3fb570020d6000ebdf310bb65a849dd9d8ccc45a2fdc7aaf0ca5ec2ae46addb8`
- Node: `v22.23.1`
- 데이터 볼륨: `family-memory-ai_finance-mcp-data` (0700, 서비스 UID 501/GID 20)
- 암호화 키: `~/.config/family-memory-ai/remote-mcp/encryption.key` (32바이트, 0600)
- 실행 설정: `~/.config/family-memory-ai/remote-mcp/runtime.env` (0600)
- 설치한 compose/Caddy: `~/.local/share/family-memory-ai/remote-mcp/`

작업 디렉터리가 이동해도 운영 마운트가 끊기지 않도록 설정 파일을 위 고정 디렉터리에 설치했다. 저장소에는 예제·원본만 있고 암호화키·세션 DB·비밀번호는 없다. 가계부 세션만 연결별 AES-GCM으로 암호화하며 Dot에는 별도의 opaque 토큰을 발급한다. OAuth 토큰 원문은 DB에 저장하지 않는다. 사용자 로그인 비밀번호는 저장하지 않는다.

## 재시작과 롤백

새 배포에서는 기존 prod compose에 `docker-compose.mcp.yml`을 함께 적용해야 MCP 경로가 유지된다. 현재 설치된 설정으로 두 서비스만 갱신하는 명령은 다음과 같다.

```bash
docker compose -p family-memory-ai \
  --project-directory /Users/soobeen/Desktop/Project/subinary \
  --env-file /Users/soobeen/Desktop/Project/subinary/.env \
  --env-file /Users/soobeen/Desktop/Project/subinary/.env.production \
  --env-file /Users/soobeen/.config/family-memory-ai/remote-mcp/runtime.env \
  -f /Users/soobeen/Desktop/Project/subinary/docker-compose.prod.yml \
  -f /Users/soobeen/.local/share/family-memory-ai/remote-mcp/compose.yml \
  up -d --no-deps finance-mcp caddy
```

MCP를 되돌릴 때는 원본 prod compose만 사용하여 `up -d --no-deps caddy`로 원래 프록시 마운트를 복원하고, 금융 MCP 컨테이너만 중지한다. 데이터 볼륨과 키는 삭제하지 않는다. DB·전체 compose를 내리지 않는다. 키를 잃으면 저장된 연결은 복호화할 수 없으므로 각 사용자가 다시 로그인해야 한다. 재해 복구에서는 DB와 키를 별도로 보호해야 한다. 기존 백업 작업에는 이 새 OAuth 볼륨이 포함되지 않는다.

## 검증

- MCP 전체 105개 테스트, 타입 검사, 번들 빌드 통과.
- OAuth 31개: PKCE·redirect·resource·scope·CSRF·만료, 코드/refresh 재사용, 사용자/클라이언트 분리, 트랜잭션 롤백, 해시·암호화 저장.
- 실제 HTTP: initialize/list/call, 사용자 격리, 수정 도구 미노출, API 실패·timeout·민감정보 비노출.
- 관리 화면: 본인 연결만 표시·철회, 타인 연결 철회 거절, CSRF/Origin, 로그인 실패 후 재입력, 관리 로그아웃 시 Dot 연결 유지.
- refresh 성공 뒤 `me` 503에서도 새 세션 저장, 동일 연결의 동시 요청 직렬화.
- Node 22.23.1 컨테이너에서 외부 네트워크 없이 DCR→로그인→PKCE→9개 도구→품질→철회 통과.
- 읽기 전용 파일시스템·capabilities 제거·비root UID의 후보 컨테이너 기동 및 health 200.
- 공개 HTTPS 실제 OAuth 연결로 품질·합산 예산 조회 통과. 증거는 `.deploy-logs/remote-mcp-20261028/live-verification.json`에 값 최소화로 보관한다.
- 공개 연결 안내 화면을 브라우저로 확인했다. ChatGPT 실제 callback 완료는 아직 미검증이다.

Python urllib 요청은 Cloudflare에서 403이었지만 브라우저·curl·Node 요청은 통과했다. 이를 API 장애로 처리하지 않는다. ChatGPT 서버의 실제 접속은 플러그인 연결 단계에서 별도 확인해야 하며 Cloudflare 보안 설정은 낮추지 않았다.

## 리뷰와 반복 학습

1. OAuth 폼의 CSP에 정확한 ChatGPT callback을 허용해 POST 후 redirect 차단을 방지했다.
2. 관리 경로는 정확한 문자열로만 처리하고 알려진 작업에만 속도 제한 버킷을 만든다. Caddy가 Cloudflare IP로 덮어쓴 전용 헤더만 명시 설정에서 신뢰한다.
3. upstream 세션 만료는 원격 grant 철회와 HTTP 401 discovery challenge로 재연결할 수 있게 한다. 실패를 0건으로 만들지 않는다.
4. refresh가 성공하고 후속 조회가 실패하더라도 갱신한 세션을 저장해야 한다. 같은 grant의 조회·갱신·저장을 직렬화한다.
5. tsup 기본 설정이 `node:sqlite`를 `sqlite`로 바꾸어 실제 런타임에서 실패했다. `removeNodeProtocol:false`로 수정하고 Node 22 번들을 다시 실행해 확인했다. 타입검사만으로 런타임 성공을 판단하지 않는다.
