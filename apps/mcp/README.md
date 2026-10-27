# @family/mcp — Dot에서 가족 가계부 사용하기

Dot이 대화와 판단을 맡고, family-memory-ai는 카드 문자 수집·거래 기록·집계와 권한을 맡습니다. 이 MCP 서버는 기존 HTTP API를 호출하는 **로컬 stdio 프로세스**이며 DB에 직접 접근하지 않습니다.

2026-10-28 기준입니다. 사용자 로그인, 권한 600 인증 파일, 금융 도구 12개 등록, 조회 도구 9종의 실제 호출과 신규 API 운영 배포를 검증했습니다. **Dot 클라우드 대화에는 이 로컬 MCP가 직접 보이지 않았습니다.** 연결된 PC에서의 명령 실행은 확인했지만 API 로그인 전 DNS 조회가 `ENOTFOUND`로 실패했습니다. Dot 환경의 네트워크 접근·DNS 점검이 남아 있습니다. 카드 구분과 합산 예산은 [10/28 운영 기록](../../docs/operations/finance-dot-2026-10-28.md), 파싱 복구는 [10/27 기록](../../docs/operations/finance-dot-2026-10-27.md)을 확인하세요.

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

## 2. 연결된 PC의 도구를 Dot에서 사용

이 PC에는 `family-finance`가 Codex MCP 설정에 `finance-review`로 등록되어 있습니다. 다시 등록하거나 비밀번호를 복사할 필요가 없습니다. [공식 안내](https://learn.chatgpt.com/docs/extend/mcp)는 ChatGPT 데스크톱과 Codex의 로컬 MCP 설정 공유를 설명합니다. 이것이 클라우드 Dot 대화의 직접 호출 성공을 뜻하지는 않습니다.

Dot 프로필의 **Computers → Your computer → Allow access**에서 이 PC 연결을 확인하고, PC와 ChatGPT 데스크톱 앱을 켜 둡니다. 아래 지시문으로 연결된 컴퓨터의 도구를 사용하도록 요청하세요. 도구가 없다고 나오면 연결 컴퓨터에서의 실행 여부와 MCP 로딩 상태를 확인해야 합니다. [Dot 컴퓨터 연결 안내](https://learn.chatgpt.com/docs/dots/computers-and-apps)를 참고하세요.

### Dot에서 도구가 보이지 않을 때

로컬 MCP 설정과 Dot 클라우드의 플러그인 도구 목록은 같지 않습니다. 이 PC에는 품질 조회만 하는 독립 명령도 설치했습니다. Dot이 연결된 PC의 로컬 작업으로 실행하게 요청할 수 있습니다. 이것은 HTTP API 조회이며 MCP 연결 성공을 뜻하지 않습니다.

```text
연결된 내 PC에서 로컬 작업을 실행해 줘.
/usr/local/bin/node /Users/soobeen/.local/share/family-memory-ai/mcp/check.cjs
반환 JSON의 파싱 실패·카드 소유자 불일치 건수와 조회 시각을 알려줘.
인증 파일은 열거나 출력하지 말고, 클라우드에서 실행하거나 파일을 복사하지 마.
실패하면 결과를 0건으로 표시하지 말고 오류 코드와 실패 단계를 알려줘.
```

명령은 고정된 운영 API에서 로그인 계정의 품질 집계만 읽고 종료합니다. 거래 원문·금액·인증 값을 출력하지 않고, 쓰기나 임의 API 호출도 받지 않습니다. `check.cjs`는 `pnpm --filter @family/mcp build`의 `dist/check.js`를 독립 설치한 파일입니다. PC의 일반 실행 성공과 Dot 실행 성공을 각각 확인해야 합니다.

실패 시 `stage`, `attemptedAt`, `proxyConfigured`, 허용된 `networkCode`로 구분합니다. 실제 Dot 재실행에서는 `stage=login`, `networkCode=ENOTFOUND`, `proxyConfigured=false`였습니다. 일반 PC 실행은 성공했으므로 Dot 작업의 네트워크 허용 여부·이름 해석을 먼저 확인합니다. 이 결과만으로 권한 차단이라고 확정하지 않습니다. 필요한 허용 절차가 있으면 대상 `app.subinary.cloud:443`에 한해 요청하며, IP 고정·보호 해제·다른 실행 환경으로 우회하지 않습니다.

다음은 다른 로컬 MCP 클라이언트에 수동으로 등록할 때 사용하는 예시입니다. Dot에 같은 JSON 입력 화면이 있다고 가정하지 않습니다. GUI 앱에서 `node`를 찾지 못하면 `command -v node`의 결과를 `command`에 넣습니다. 모든 경로를 실제 절대경로로 바꾸세요. JSON의 `~`는 자동 확장되지 않습니다.

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

API가 먼저 실행돼 있어야 합니다. 시작 시 로그인하고 401에는 한 번 토큰을 갱신합니다. 위 예시는 조회부터 시작할 때의 기본 모드입니다. 이 PC의 `finance-review` 설정에는 조회 9개와 분류 쓰기 3개가 등록되어 있고, 인증 파일 경로만 전달합니다. Codex 등록이나 로컬 stdio 검증만으로 Dot 앱의 연결 성공까지 확인했다고 보지 않습니다.

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
