# @family/mcp — Dot에서 가족 가계부 사용하기

Dot이 대화와 판단을 맡고, family-memory-ai는 카드 문자 수집·거래 기록·집계와 권한을 맡습니다. 이 MCP 서버는 기존 HTTP API를 호출하는 **로컬 stdio 프로세스**이며 DB에 직접 접근하지 않습니다.

2026-10-27 구현 기준입니다. 사용자 로그인, 권한 600 인증 파일, 실제 stdio 서버의 금융 12개 등록과 기존 API 조회 4종은 검증했습니다. **Dot 앱 내부의 실제 도구 호출과 신규 API의 운영 배포는 아직 완료로 확인하지 않았습니다.** 최신 상태는 [운영 기록](../../docs/operations/finance-dot-2026-10-27.md)을 확인하세요.

## 사용할 수 있는 범위

| `FAMILY_TOOL_MODE` | 노출 도구 | 용도 |
|---|---|---|
| `finance-readonly` — 기본 | 금융 조회 9개 | 지출·예산·품질·정기지출·거래 검색과 분류 미리보기 |
| `finance-review` | 금융 12개: 조회 9개 + 쓰기 3개 | 사용자가 지정한 거래 분류, 과거 거래 일괄 분류, 일괄 변경 되돌리기 |
| `all` | 금융 조회 9개 + 기억 5개 | 기존 기억 검색·저장·삭제를 포함한 호환 모드. 금융 쓰기는 포함하지 않음 |

전체 도구와 인자는 [MCP API 명세](../../docs/api/mcp.md)에 있습니다. 금융 모드는 별도 생성 모델·임베딩 API를 호출하지 않습니다. Dot 자체 사용에는 가입한 서비스의 이용 조건이 적용됩니다. `all`의 기억 검색·읽기는 기존 AI/RAG 경로를 사용하므로 외부 모델·임베딩 비용이 발생할 수 있습니다. 구독제 사용권을 별도 API 크레딧으로 간주하지 않습니다.

## 빌드

모노레포 루트에서 실행합니다. 패키지 산출물이 없는 환경은 의존 패키지도 먼저 빌드합니다.

```bash
pnpm install --frozen-lockfile
pnpm -r --workspace-concurrency=2 --filter "./packages/*" build
pnpm --filter @family/mcp build
```

빌드 실행 파일은 `apps/mcp/dist/main.js`입니다. 이 PC의 고정 설치본은 `~/.local/share/family-memory-ai/mcp/main.cjs`에 있으며, 연결 설정에는 이동·삭제될 수 있는 작업 디렉터리 대신 이 설치본을 사용합니다. MCP 클라이언트가 프로세스를 시작하며 Docker compose 서비스는 아닙니다. stdout은 프로토콜 전용이고 서버 로그는 stderr로 보냅니다.

## 1. 이 PC에 로그인 정보 저장

```bash
node scripts/setup-family-mcp.mjs
```

터미널의 `FAMILY_MCP_SETUP_URL`을 같은 PC의 브라우저에서 열고 기존 계정으로 로그인합니다. 비밀번호를 채팅이나 명령줄 인자에 넣지 않습니다. 설정 스크립트의 기본 API는 `https://app.subinary.cloud`입니다.

성공하면 `~/.config/family-memory-ai/mcp-credentials.json`에 저장합니다. **암호화 저장소가 아니라 권한 600의 로컬 JSON**이므로 Git·공유 폴더·로그에 넣지 않습니다. MCP는 그룹/다른 사용자 권한이 열려 있거나 파일을 읽을 수 없으면 시작하지 않습니다.

폼은 `127.0.0.1`에서만 열리고 30분 후 종료됩니다. Host와 일회용 CSRF 토큰을 검사합니다. 앱 내 브라우저의 `Origin: null`도 올바른 토큰이 있을 때만 허용하고, 다른 명시적 Origin은 거절합니다. 성공하면 서버가 종료되므로 다시 설정할 때 명령을 재실행합니다.

## 2. Dot에 stdio 서버 등록

Dot의 MCP 서버 등록 기능에 아래 실행 설정을 사용합니다. 화면 메뉴명과 실제 연결 성공 여부는 별도로 확인해야 합니다. GUI 앱에서 `node`를 찾지 못하면 `command -v node`의 결과를 `command`에 넣습니다. 모든 경로를 실제 절대경로로 바꾸세요. JSON의 `~`는 자동 확장되지 않습니다.

```json
{
  "mcpServers": {
    "family-finance": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/home/.local/share/family-memory-ai/mcp/main.cjs"],
      "env": {
        "FAMILY_API_URL": "https://app.subinary.cloud",
        "FAMILY_CREDENTIALS_FILE": "/absolute/path/to/home/.config/family-memory-ai/mcp-credentials.json",
        "FAMILY_TOOL_MODE": "finance-readonly"
      }
    }
  }
}
```

API가 먼저 실행돼 있어야 합니다. 시작 시 로그인하고 401에는 한 번 토큰을 갱신합니다. 등록 후 `tools/list`에서 금융 조회 9개가 보이는지 확인한 뒤 아래 지시문을 실행합니다. 이 PC에는 `family-finance`가 Codex MCP 설정에 `finance-review`로 등록돼 있습니다. 인증 파일 경로만 전달하며 비밀번호를 설정에 넣지 않았습니다. 위 예시는 조회부터 시작할 때의 기본 모드입니다. Codex 등록이나 로컬 stdio 검증만으로 Dot 앱의 연결 성공까지 확인했다고 보지 않습니다.

### Dot에 붙여넣을 첫 조회 지시문

```text
연결된 내 컴퓨터의 family-finance 도구로 이번 달 가계부를 확인해 줘.
먼저 finance_quality와 finance_overview를 조회하고, finance_recurring으로 마지막 계산 시각을 확인해.
1. 이번 달 카드 문자 기반 순지출과 예산 현황
2. 파싱 실패·카드 연결 확인·미분류 등 내가 확인할 중요한 항목 3개
3. 정기지출 계산 여부와 확정된 내역만 알려줘.
조회 시각과 집계 범위를 표시하고, 미계산·비활성·빈 결과를 구분해 줘.
카드 청구서나 통장 잔액으로 해석하지 말고, 검토 항목은 중복될 수 있으니 건수를 합산하지 마.
이번에는 조회만 하고 분류나 규칙은 바꾸지 마. 도구 호출이 실패하면 확인되지 않았다고 말해 줘.
```

## 3. 분류 정리가 필요할 때

사용자가 분류 수정을 요청하면 `finance-review`로 변경하고 연결을 재시작합니다. 카테고리 ID는 `finance_categories`, 거래는 `finance_transactions`로 조회합니다. 단일 수정은 직전 `expectedCategoryId`를 보내며 다른 사람이 이후 분류를 수정했다면 409로 중단합니다. `applyFutureRule`은 기본 `false`이고 앞으로의 규칙까지 요청한 경우에만 켭니다.

일괄 수정은 `finance_recategorize_preview`로 범위를 설명한 뒤 같은 세션의 `previewId`로 적용합니다. 미리보기는 10분간 유효합니다. 전송 후 응답을 잃으면 같은 ID를 재전송하지 않고 `finance_recategorize_history`로 확인합니다. 이 보호는 현재 프로세스 세션에 한정되므로 새 미리보기나 재연결로 우회 재실행하지 않습니다.

## 환경변수

| 변수 | 설명 |
|---|---|
| `FAMILY_API_URL` | MCP 기본값은 `http://localhost:3001`; 운영 주소를 명시 |
| `FAMILY_CREDENTIALS_FILE` | 권한 600 인증 JSON의 절대경로. 권장 인증 방식 |
| `FAMILY_EMAIL`, `FAMILY_PASSWORD` | 기존 환경변수 방식. 각각 인증 파일 값보다 우선 |
| `FAMILY_TOOL_MODE` | `finance-readonly` / `finance-review` / `all` |
| `FAMILY_HOUSEHOLD_ID` | 기본 가구. 미지정 시 `/v1/auth/me` 첫 membership |
| `FAMILY_WORKSPACE_ID` | 기억 도구의 `workspaces.id`. 미지정 시 첫 Slack workspace의 `workspaceId` |

서버는 API의 가구 구성원·소유권·공개범위를 그대로 따릅니다. 금융 도구는 문자 원문, 금액 수정, 카드 소유자 수정, 거래 삭제를 노출하지 않습니다.

## 검증

```bash
pnpm --filter @family/mcp test
pnpm --filter @family/mcp typecheck
node --test scripts/setup-family-mcp.test.mjs
```

로컬 합성 테스트는 실제 Dot 호출 검증을 대신하지 않습니다. [설계 결정](../../docs/adr/0033-finance-identity-and-dot-boundary.md)과 [배포·백업·정정 기록](../../docs/operations/finance-dot-2026-10-27.md)을 함께 참고하세요.
