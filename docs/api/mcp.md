# MCP 서버 명세

2026-10-28 코드 기준. `apps/mcp`는 로컬 stdio 및 원격 Streamable HTTP 서버이며 기존 `/v1/*` HTTP API를 호출한다. 가계부 DB 직접 접근, 문자 원문 전달, 금융 금액·소유자 수정·삭제 도구는 없다. 원격 OAuth 연결 메타데이터와 암호화 세션은 별도 SQLite에 저장한다. [등록 안내](../../apps/mcp/README.md) · [원격 연결 결정](../adr/0035-dot-remote-finance-mcp.md) · [운영 상태](../operations/finance-remote-mcp-2026-10-28.md).

## 원격 전송과 인증

`POST https://app.subinary.cloud/mcp`는 stateless Streamable HTTP JSON 응답을 제공한다. `Authorization: Bearer`에는 해당 서비스의 `finance:read` OAuth 토큰만 허용한다. FMA API 세션·비밀번호는 클라이언트에서 전달하지 않는다. 익명·만료 요청은 401과 protected resource discovery challenge를 반환한다.

OAuth discovery는 `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`에 있다. 로그인·DCR·토큰 교환·철회는 `/mcp/oauth/{authorize,register,token,revoke}`를 사용한다. S256 PKCE, 정확한 resource와 redirect, 연결별 access/refresh 회전, 사용자 연결 해제를 적용한다. 원격은 항상 읽기 9개 도구만 노출하며 아래 모드 선택은 로컬 stdio에만 해당한다.

## 모드와 기존 명세의 관계

| 모드 | 수 | 범위 |
|---|---:|---|
| `finance-readonly` — 기본 | 9 | 금융 조회와 변경 미리보기 |
| `finance-review` | 12 | 금융 조회 9개 + 분류 쓰기 3개 |
| `all` | 14 | 금융 조회 9개 + 기억 5개. 금융 쓰기 없음 |

이전 Phase 10 문서의 **6개는 기억 5개와 `finance_summary` 1개인 legacy 묶음**이며 현재 `all`에서 포함한다. 기억 6개라는 뜻이 아니다. `all`은 금융 쓰기까지 여는 모드가 아니다. `scripts/verify-phase10.mjs`의 6개 가정은 legacy 검증이며 현재 기본 모드의 검증 기준이 아니다.

## 인증과 권한

- `FAMILY_CREDENTIALS_FILE`의 이메일·비밀번호 또는 기존 환경변수를 사용한다. `FAMILY_EMAIL`, `FAMILY_PASSWORD`가 각각 파일 값보다 우선한다.
- POSIX 인증 파일은 일반 파일이며 그룹/다른 사용자 권한이 없어야 한다. 설정 스크립트는 600으로 저장한다. 암호화 저장소는 아니다.
- 시작 시 `POST /v1/auth/login`으로 로그인한다. access token과 refresh 쿠키는 메모리에 보관하고 401에는 한 번 갱신·재시도한다.
- 가구는 명시 인자 → `FAMILY_HOUSEHOLD_ID` → `/v1/auth/me` 첫 membership 순서다. ID 선택이 권한을 부여하지는 않는다.
- 금융 조회는 API의 가구 구성원 자격과 거래 공개범위를 따른다. 품질 조회의 SMS는 본인 수집분만 집계한다. 기억은 기존 workspace·소유자 권한을 따른다.
- stdout은 프로토콜 전용이다. 인증 정보와 원시 API 오류를 도구 응답에 싣지 않는다.

로컬 설정 폼은 실제 로그인 성공을 확인한 뒤 파일을 저장한다. 동일 Host와 일회용 CSRF 토큰을 검사한다. 로컬 Origin 또는 앱 내 브라우저의 `Origin: null`을 받지만 null만으로 승인하지 않는다. 다른 명시적 Origin은 거절한다.

## 금융 도구 12개

`householdId?`는 UUID, `month?`는 `YYYY-MM`이다. 새로운 금융 도구는 텍스트 JSON과 `structuredContent.data`를 함께 반환한다. 기존 `finance_summary`는 사람이 읽는 텍스트를 반환한다.

| 도구 | 주요 인자 | API 매핑 | 모드 |
|---|---|---|---|
| `finance_summary` | `month?`, `householdId?` | `GET /v1/analytics/monthly` | 전체 |
| `finance_overview` | `month?`, `householdId?` | monthly + `GET /v1/analytics/categories`, `/v1/budgets`, `/v1/analytics/quality` | 전체 |
| `finance_quality` | `householdId?` | `GET /v1/analytics/quality` | 전체 |
| `finance_recurring` | `householdId?` | `GET /v1/recurring/series` | 전체 |
| `finance_upcoming` | `until`(ISO datetime), `householdId?` | `GET /v1/recurring/upcoming` | 전체 |
| `finance_transactions` | 아래 검색 조건 | `GET /v1/transactions` | 전체 |
| `finance_categories` | `householdId?` | `GET /v1/categories` | 전체 |
| `finance_recategorize_preview` | `merchant`, `categoryId`, `householdId?` | `GET /v1/transactions/recategorize/preview` | 전체 |
| `finance_recategorize_history` | `householdId?` | `GET /v1/transactions/recategorize/batches` | 전체 |
| `finance_classify_transaction` | `transactionId`, `categoryId`, `expectedCategoryId`, `applyFutureRule?` | 거래 GET → `PATCH /v1/transactions/:id` → 거래 GET | review만 |
| `finance_recategorize_apply` | `previewId` | 미리보기 재조회 → `POST /v1/transactions/recategorize` | review만 |
| `finance_recategorize_revert` | `batchId` | `POST /v1/transactions/recategorize/:batchId/revert` | review만 |

### 검색·집계 해석

거래 검색 인자는 `householdId?`, `memberId?`, `cardId?`, `type?`(`approval`/`cancellation`), `status?`, `categoryId?`, `from?`, `to?`, `q?`(1–200자), `attribution?`(`shared`), `limit?`(1–100, 기본 20), `cursor?`다. 시각에는 ISO datetime offset을 포함한다. `nextCursor`가 있으면 전체 목록이라 말하지 않는다. `memberId`는 거래 구성원이며 카드 소유자와 같다고 가정하지 않는다.

`finance_overview`는 선택 월의 순지출·카테고리·예산과 **전 기간 품질 집계**를 함께 반환한다. 예산 잔액은 통장 잔액이 아니다. 카드 문자 집계는 카드 청구서·환불 입금 완료의 증거가 아니며 외화·제외·공개범위 조건을 유지한다.

품질 `scope`는 `period=all_time`, `transactions=visible_non_excluded`, `sms=own_member`다. 거래 미분류·중복 의심·미연결 취소·비공용 카드 소유자 불일치와 본인 SMS 상태별 건수·최근 수집 시각을 반환한다. 항목이 중복될 수 있으므로 합산한 값을 고유 오류 수로 설명하지 않는다. 검토 후보를 오류 확정으로 단정하지 않는다.

### 정기지출

- `enabled=false`: 기능 비활성. 빈 결과를 정기지출 없음으로 해석하지 않는다.
- `computedAt=null` 또는 `calculationStatus=not_computed`: 아직 계산하지 않음.
- `calculationStatus=computed`와 빈 `items`: 계산은 성공했지만 결과가 0개인 상태.
- 후보는 사용자가 확정한 구독이 아니다. 마지막 계산 시각을 함께 설명한다.
- 예정 조회는 사용자가 확정한 정기지출만 다룬다. 미확정 후보·예측 제외 항목을 총액에 더하지 않는다.

계산 상태 테이블은 후보가 0개인 성공에도 시각을 남긴다. 기능 플래그가 켜진 API는 시작 시와 30분마다 오래된 가구를 갱신한다. 가구별 상태 행 잠금과 트랜잭션으로 계산을 직렬화하며 실패는 성공 시각을 갱신하지 않는다. 별도 모델 API를 호출하지 않는 규칙 계산이다.

### 분류 변경

단일 수정은 직전 조회의 `expectedCategoryId`를 보낸다. 미분류였으면 `null`이다. API는 `UPDATE`의 조건에 기존 category 비교를 포함해 한 SQL에서 비교·갱신한다. 충돌은 409로 중단하고 같은 트랜잭션의 규칙·확정 라벨 변경도 남기지 않는다. `applyFutureRule=false`가 기본이며 앞으로의 규칙까지 사용자가 요청했을 때만 켠다. 수정 후 재조회 실패는 완료로 단정하지 않는다.

일괄 변경은 같은 프로세스의 10분 유효 `previewId`를 사용한다. 적용 직전 범위를 다시 조회하고 변경·0건·상한 초과·만료면 중단한다. 전송 전에 `unknown`으로 바꾸므로 응답 유실 시 동일 ID를 재전송하지 않는다. 성공한 동일 ID는 저장 결과를 `replay=true`로 반환한다. 이 상태는 메모리에 있으므로 프로세스 재시작을 넘는 영구 idempotency 보장은 아니다. 결과 불명은 이력을 먼저 확인하며 새 미리보기로 우회 재실행하지 않는다.

일괄 변경은 과거 거래만 변경하고 향후 규칙은 만들지 않는다. 되돌리기는 이후 직접 수정한 거래를 보존하므로 `skippedCount`도 설명한다.

## `all`의 기억 도구 — legacy

| 도구 | 인자 | API 매핑 |
|---|---|---|
| `memory_search` | `question`, `workspaceId?` | `POST /v1/ai/work-query` |
| `memory_read` | `query`, `topK?`(1–20), `workspaceId?` | `POST /v1/ai/retrieval` |
| `memory_remember` | `type`, `subject`, `content`, `workspaceId?` | `POST /v1/memory/memories` |
| `memory_forget` | `memoryId` | `DELETE /v1/memory/memories/:id` |
| `memory_timeline` | `entityId?`, `workspaceId?` | `GET /v1/graph/timeline` 또는 `GET /v1/memory/memories?current=true` |

`type`은 `event | fact | decision | preference | procedure | incident | task`다. `workspaceId`는 `workspaces.id`이며 `slack_workspaces.id`가 아니다. 검색·읽기는 기존 출처를 보존하고 근거 없음도 그대로 표시한다. 외부 생성 모델·임베딩 비용이 발생할 수 있어 기본 금융 모드에서는 등록하지 않는다. Dot 구독은 별도 API 비용을 포함한다는 보장이 아니다.

## 프로토콜 확인

MCP 초기화 이후 기본 모드의 `tools/list`에서 조회 9개를 확인한다.

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"finance_quality","arguments":{}}}
```

실제 Dot에서 인증된 사용자 범위로 호출돼야 앱 연결 완료로 기록한다. 로컬 테스트·등록 설정만으로 완료로 보지 않는다.
