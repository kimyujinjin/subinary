# 금융 데이터 개선과 Dot 연결 — 2026-10-27 운영 기록

## 상태

이 문서는 구현과 검증을 운영 적용과 구분한다. 아래 상태는 작성 시점 기준이며 배포 담당자가 실제 실행 후 갱신한다.

| 항목 | 확인 상태 |
|---|---|
| 카드 식별·취소/중복 경계·문자 파서·UI 개선 | 구현 및 로컬 검증 |
| 운영 DB 백업 | 파일 생성, 격리 PostgreSQL 17 전체 복구 검증 |
| 0062/0063 migration과 카드 65건 정정 | 격리 복구 DB에서 검증 완료 |
| 운영 API/worker/web 신규 이미지 | 아직 배포 완료로 기록하지 않음 |
| 운영 DB 카드 정정·문자 재처리 | 운영 쓰기 미실행 |
| 사용자 로그인·인증 파일 | 완료, 파일 권한 600 확인 |
| 실제 로컬 stdio MCP | 금융 12개·기억 0개 등록, 기존 조회 4종 성공 |
| 신규 `finance_quality` 운영 호출 | 배포 후 검증 예정 |
| Codex MCP 등록 | `family-finance`, `finance-review`, 인증 파일 경로 방식으로 등록 완료 |
| Dot 앱 내부 실제 호출 | 미확인 |
| 등록 카드의 상품 별칭/카드사 구분 | 기존 삼성 문자 이력과 충돌하여 사용자 확인 대기 |

## 원인과 정정 계획

거래 구성원과 원본 SMS 구성원은 보존돼 있었다. 다른 구성원의 비공용 카드에 연결된 승인 64건·취소 1건이 정정 계획에 포함됐다. 전체 순지출 변화는 0이며 잘못된 카드 연결만 해제한다. 원래 금액·거래 상태·중복 정보·취소 부모·공개범위는 보존한다.

추가 조회에서 본인의 현대카드 상품 별칭과 삼성 카드사 설정이 다르게 등록된 점을 확인했다. 이 카드에는 삼성 카드사 SMS 73건과 수동 내역 1건이 연결돼 있다. 따라서 본인 카드 누락으로 단정하거나 카드사만 바로 현대으로 바꾸지 않는다. 실제로 여러 카드를 사용하는지 확인한 뒤 상품 별칭·카드사·등록 구분을 정리한다. 자동으로 새 카드를 만들지 않는다.

현재 검토 계획은 `.deploy-logs/card-ownership/plan-1793110373661.json`이다. 이 파일은 민감한 내부 식별·금액 스냅샷을 포함하므로 Git에 넣거나 채팅에 출력하지 않는다. 문서에는 집계만 남긴다.

```bash
# 기본은 읽기 전용 계획. 새 계획의 건수와 영향 범위를 먼저 확인한다.
node scripts/repair-card-ownership.mjs plan

# 아래는 검토된 계획의 명시적 적용 형식이며, 이 문서 작성으로 실행된 것은 아니다.
node scripts/repair-card-ownership.mjs apply <검토한-plan.json> --expected-count=65
```

CLI는 체크섬·건수·변경 전 스냅샷·원본 구성원·카드 소유자·취소 체인을 대조한다. 충돌 시 전체 롤백한다. 감사 파일은 `.apply.json.prepared`와 `.apply.json`으로 계획 옆에 남으며 디렉터리 700/파일 600을 사용한다. 응답 유실 시 DB와 감사 기록부터 대조하고, 이미 적용된 동일 계획은 재실행 안전성을 가진다.

## 실패 문자 6건

| 익명 유형 | 건수 | 변경 후 처리 |
|---|---:|---|
| 해외 승인 문자의 KRW 소수 표기 | 2 | 규칙 파싱 성공, 정상 거래 승격 가능 |
| 모임금고 저금 안내 | 2 | `ignored`, 원문 보존·거래 미생성 |
| 금액 없는 해외원화 차단 승인거절 | 2 | `parsed` + `declined`, 거래 미승격 |

합성 fixture로 재현했다. 파서 250개와 worker 47개 검증이 통과했다. 이 기록 시점에 운영 원문 재처리는 실행하지 않았다. `ignored` 사용 전 0062 migration이 필요하다. 재처리 후 성공·검토·무시·거절을 구분하고 거래 생성 여부를 확인한다.

## UI 검토

모바일과 데스크톱에서 합성 API 데이터로 검증했다. 운영 사용자 데이터나 실제 휴대폰에서의 최종 사용성 검증을 대신하지 않는다.

- 카드 화면: 소유자와 공용 여부를 명확히 표시하고 동일 상품 카드를 구분한다.
- 거래 화면: 거래 구성원 이름·색상을 사용하고 비공용 카드 소유자와 다르면 연결 확인 안내를 표시한다.
- 문자 검토: 통화와 금액 입력을 구분하고 가맹점·시각을 수정할 수 있도록 정리했다.
- 기기 화면: 마지막 연결과 실제 문자 수집 시각을 나눠 수집이 멈춘 상태를 파악한다.

스크린샷은 [검증 자료](../evidence/finance-dot-20261027/)에 합성 데이터로 보관했다. 실제 사용자 거래 화면으로 오해하지 않는다.

| 파일 | 검토 화면 |
|---|---|
| `cards-desktop.png` | 카드 관리 데스크톱 |
| `cards-mobile.png` | 카드 관리 모바일 |
| `devices-mobile.png` | 기기 수집 상태 모바일 |
| `review-form-mobile.png` | 문자 검토 입력 모바일 |
| `transaction-owner-warning-desktop.png` | 거래/카드 소유자 불일치 데스크톱 |
| `transaction-owner-warning-mobile.png` | 거래/카드 소유자 불일치 모바일 |

남은 UX 우선순위는 중앙 AI 버튼 중심의 탐색 구조, 낮은 보조문구 대비, 여러 편집 동작이 한 창에 모인 거래 상세다. 이번 수정은 잘못된 귀속 확인·문자 수정·수집 상태 확인을 개선한 범위이며 전체 화면 재설계를 완료했다는 뜻은 아니다. Dot은 일상 조회와 분류 지시를 맡고 앱은 원문 확인·예외 수정·기기 관리에 집중하는 방향이 적절하다.

문자 복구 도구는 `plan → apply --expected-count=N → verify` 순서다. 복구 잡은 L0 규칙 파서만 사용하고 카테고리 AI·결제/예산 알림을 생성하지 않는다. 부분 실패는 같은 계획의 `retry --expected-count=N`으로 원본이 그대로인 failed 잡만 재시도한다. 기존 시도 횟수는 감사 파일에 남기고 BullMQ 재시도 카운터를 초기화한다. 설치 BullMQ와 일회성 Redis에서 실패→재시도 성공을 검증했다.

## 백업과 격리 검증

백업은 작업 디렉터리의 `.deploy-logs/pre-finance-fix/20261027-231158.dump`에 보관했다(1,271,979 bytes). 비밀·개인정보를 포함한 DB 백업이므로 Git·대화에 올리지 않는다. 격리 PostgreSQL 17에 전체 복구한 뒤 0062/0063 migration과 카드 연결 65건 해제를 검증했다.

복구 DB는 정정 전후 모두 510거래이며 전체 순지출 합계와 금액 불변식이 유지됐다. 다른 구성원의 개인 카드 연결 불일치는 0이 됐다. 이 결과는 **격리 복구본**의 결과이며 운영 DB를 변경한 것이 아니다. 정정 스냅샷의 timestamptz JSON 비교는 DB TimeZone의 영향을 받으므로 복구본도 운영과 같은 `Asia/Seoul`로 맞췄다.

## 경량 이미지 배포안

호스트 swap 사용량 때문에 의존성 설치·전체 Docker 빌드를 반복하지 않는다. 현재 운영 Linux/arm64 이미지 `sha256:ed156228f1a34a06085243a9e293f5ff7e91dd7d444c2dd7c07c0777a95a7ce2`의 Linux 의존성을 재사용하고 검증된 JS 산출물만 덮는다. 런타임 package manifest, Next 16.2.10, React 19.2.7이 로컬과 동일함을 확인했다. lock 변경은 MCP 테스트용 devDependency다.

복사 대상은 `packages/*/dist`, `apps/api/dist`, `apps/worker/dist`, `apps/web/.next`, `packages/database/drizzle`이다. `next.config.ts`, public 파일은 이번 비교에서 동일했다. 실제 변경되면 함께 복사해야 한다. 기존 대상 디렉터리를 이미지 안에서 제거한 뒤 복사해 삭제된 청크·라우트를 남기지 않는다.

`.next` 약 451MB 중 dev가 약 426MB다. `dev`와 `cache`를 제외하고 배포 산출물을 복사하되 `.next/node_modules`의 pino 상대 심링크는 보존한다. 호스트의 실제 `node_modules`는 복사하지 않는다. 배포 context에는 `.env`, 인증 파일, DB 백업, 감사 JSON을 넣지 않는다.

모든 작업자의 최종 변경 후 packages → API/worker/web을 필요한 순서로 빌드하고 산출물을 고정한다. 로컬 Node 25와 이미지 Node 22가 달라 새 Linux 이미지에서 import·웹 기동·주요 페이지를 다시 확인한다. 정적/서버 번들에는 운영 도메인이 들어 있고 `localhost:3001`은 없음을 확인했다. `NEXT_PUBLIC_*`는 [빌드 시 고정](https://nextjs.org/docs/app/guides/environment-variables)되므로 런타임 env로 고칠 수 없다.

기존 이미지에 보존 태그를 먼저 붙이고 새 태그를 별도로 만든다. 작은 context로 `--pull=false --network=none` 빌드를 사용한다. 원본 repo의 compose/env와 기존 프로젝트명을 사용하며 `--no-build`로 migrate → API/worker/web만 교체한다. 기존 Linux 의존성·데이터 볼륨·네트워크를 유지한다.

0062는 enum `ignored` 추가, 0063은 계산 상태 테이블 추가다. 기존 migration SQL은 이미지와 동일함을 확인했다. SQL과 journal을 함께 배포하고 migration 성공·커밋 후 새 앱을 시작한다. [PostgreSQL은 새 enum 값을 커밋 전 사용할 수 없다](https://www.postgresql.org/docs/current/sql-altertype.html).

## 롤백과 완료 확인

- 이미지 이상은 보존한 이전 이미지 태그로 API/worker/web을 복귀시킨다. 이번 additive DB 변경은 유지한다. 이전 코드가 새 상태를 어떻게 표시하는지도 확인한다.
- 카드 연결 정정은 이미지 롤백으로 되돌아가지 않는다. 감사 JSON과 현재 스냅샷을 대조해 별도 복구하며 백업 전체 복원으로 이후 정상 기록을 덮지 않는다.
- 복구 검증된 백업·이전 이미지 태그·전후 감사 파일은 안정화 전 삭제하지 않는다.
- 운영 health, 문자 수집·승격, 카드 연결, 신규 quality API, 정기지출 계산 시각, 모바일 주요 화면을 확인한다.
- Dot에서는 도구 목록과 실제 조회 결과를 확인한다. 로컬 stdio 성공만으로 완료 처리하지 않는다.

등록 설정과 첫 지시문은 [MCP README](../../apps/mcp/README.md)에 있다. 작성 시점 실제 stdio 검증은 `finance-review`의 금융 12개·기억 0개와 `finance_summary`, `finance_transactions`, `finance_recurring`, `finance_categories` 4종 조회다. 신규 quality 호출과 Dot 앱 내부 실행은 남아 있다.

고정 MCP 설치본은 `~/.local/share/family-memory-ai/mcp/main.cjs`다. 기존 Codex 예약 자동화는 변경하지 않았다. 등록 사실이 Dot 앱에서의 실제 도구 호출을 보장하지 않으므로 마지막 검증은 별도로 남긴다.
