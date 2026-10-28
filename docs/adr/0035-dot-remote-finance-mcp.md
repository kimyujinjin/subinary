# ADR-0035: Dot의 원격 금융 MCP 연결

- 날짜: 2026-10-28
- 상태: 구현·운영 배포·실제 API 조회 검증 완료, ChatGPT 설치 및 Dot 호출 대기
- 사용자 승인: 기존 금융 MCP를 Dot에서 원격 호출하도록 진행
- 관련: ADR-0033, ADR-0034

## 결정

Dot → 인증된 원격 MCP → 기존 가계부 HTTP API 경로를 사용한다. 금융 MCP의 기존 조회 9개를 재사용하며 별도 AI API 호출은 추가하지 않는다. 기존 로컬 stdio MCP와 품질 조회 명령은 유지한다.

독립 Node 서비스와 기존 Cloudflare HTTPS 도메인의 `/mcp` 경로를 사용한다. 가계부 API·PostgreSQL·웹을 교체하지 않고 프록시에 MCP 경로를 추가한다. 가계부가 Mac의 Docker에서 실행되므로 Mac이 꺼지면 원격 조회도 중단된다.

OAuth 인증 코드+S256 PKCE, 정확한 반환 주소 allowlist, resource·scope 검사를 구현한다. Dot에는 읽기 전용 opaque 토큰을 발급한다. 기존 가계부 JWT는 범용 API 세션이므로 Dot 토큰과 구분하고 외부에 전달하지 않는다. 사용자가 연결 화면에서 직접 로그인한 가계부 세션만 연결별로 암호화 저장하며 비밀번호는 보관하지 않는다. SQLite에는 opaque 토큰 해시와 AES-GCM 세션을 저장하고 암호화 키 파일은 별도로 둔다. 연결 해제·만료·refresh 재사용 시 해당 연결을 철회한다.

조회 요청은 연결별로 직렬화하고 사용자별 API client를 분리해 refresh 회전과 가구 캐시가 섞이지 않게 한다. 분류 미리보기는 조회 결과만 제공하며 실제 분류 수정 도구는 원격에 등록하지 않는다. 쓰기 기능을 추가하려면 별도 scope·사용자별 미리보기 영속화·승인 검증이 필요하다.

## 검증 경계

OAuth discovery, PKCE, 토큰 회전·재사용·철회, CSRF·Origin·Host·본문 크기, 사용자 격리, 실제 HTTP MCP initialize/list/call, 기존 로컬 테스트를 검증한다. 공개 HTTPS 도달, 실제 사용자 데이터 조회, ChatGPT 플러그인 등록, Dot 대화 호출은 각각 별도 단계로 기록한다. 사용자 대신 Dot에 메시지를 보내지 않는다.

Memory/context7/sequential-thinking MCP는 현재 제공되지 않아 기존 ADR의 학습을 읽고 이 문서에 결정을 기록한다. MCP SDK와 인증 요구사항은 공식 MCP·OpenAI 문서로 확인한다.

## 근거

- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization

## 반복 학습

로컬 설정 등록만으로 Dot 클라우드에 도구가 생기지 않는다. 설치·인증·실제 대화 호출을 분리해 검증하고, 서버 테스트 성공을 Dot 연결 완료로 보고하지 않는다.

105개 테스트와 Node 22 번들 실행, 공개 HTTPS OAuth 품질·두 카드 예산 조회를 검증했다. OAuth 폼의 callback CSP, 정확한 관리 경로, 사용자별 제한, upstream 만료의 401 전환과 실패 후 회전 세션 보존을 리뷰에서 수정했다. 결과·남은 사용자 연결·운영 복구 절차는 [운영 기록](../operations/finance-remote-mcp-2026-10-28.md)에 남긴다.
