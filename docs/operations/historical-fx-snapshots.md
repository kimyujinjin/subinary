# 거래일 역사 환율 스냅샷

ADR-0027 v2의 API·worker 금액 쓰기는 먼저 기존 스냅샷을 조회한다. 해당 키가 없을 때만
`AcquiringFxSnapshotResolver`가 공식 ECB 일일 기준값을 조회하고
`DrizzleFxSnapshotStore.fixate()`로 최초 값을 고정한다. shadow·읽기 전용 관측은 기존 조회
저장소를 그대로 사용한다. 새 스케줄러나 과거 거래 재계산 작업은 추가하지 않는다.

## 적용 기준과 지원 범위

- 자연키: `(원통화, 서울 기준 거래일, money_contract_version=2)`, 환산 대상은 KRW.
- 거래일: `occurredAt`의 `Asia/Seoul` 날짜. 거래시각이 없으면 `receivedAt`의 서울 날짜.
- 공급자: ECB의 일별 `EXR/D.{통화}+KRW.EUR.SP00.A`. `startPeriod`와 `endPeriod`는 같은
  날짜이며 `format=csvdata&detail=full`로 관측·속성을 함께 받는다.
- 자동 취득 통화: **EUR, USD, JPY, GBP, CNY, HKD, AUD, CAD, SGD, CHF, THB, PHP,
  MYR, NZD, IDR**. EUR는 원통화/EUR 값 1과 KRW/EUR 관측 하나를 사용한다. KRW는 환산하지 않는다.
- 앱의 다른 지원 통화인 **VND, TWD, MOP, BHD, KWD, OMR**에는 이 공급자를 적용하지 않는다.
  이 통화도 이미 운영자가 고정한 동일 키의 스냅샷이 있으면 기존 규약대로 사용할 수 있다.

이 값은 **해당 날짜의 정보용 일일 기준환율**이다. 서울 거래 순간의 실시간 환율이나 카드사
매입·정산·청구 환율을 뜻하지 않는다. 기존 v2의 추정 금액·불변 스냅샷 의미를 유지한다.
공급자 버전은 `ecb-sdmx-daily-eur-cross-half-up-12-v1`로 기록한다.

## 검증과 계산

CSV의 순서 대신 필드 이름을 사용한다. 각 통화에 정확히 한 관측이 있어야 하며 `FREQ=D`,
`CURRENCY_DENOM=EUR`, `EXR_TYPE=SP00`, `EXR_SUFFIX=A`, 요청한 날짜, `OBS_STATUS=A`,
`UNIT=CURRENCY`, `UNIT_MULT=0`을 모두 검증한다. 중복·다른 날짜·잘못된 속성·비양수 값은
스냅샷을 만들지 않는다. `DECIMALS`는 표시 메타데이터로만 검증하며 원 관측값을 잘라 쓰지 않는다.

원통화 1 major unit당 KRW는 `KRW/EUR ÷ 원통화/EUR`로 구한다. Decimal 문자열을 BigInt
분수로 계산해 결과만 소수 12자리 HALF_UP으로 반올림하고 `numeric(24,12)` 범위를 확인한다.
거래의 KRW 정수 산술은 기존 `TransactionMoneyService`·`convertToKrw()`를 사용한다.
worker v2의 중복 비교도 같은 스냅샷과 정수 산술을 사용한다. legacy/shadow의 기존 환산 경로는
유지하며 v2에서 최신 환율 클라이언트를 호출하지 않는다.

출처에는 정확한 요청 URL·관측 날짜·통화 방향·두 원 관측값·정상 상태·단위 배율·반올림
규칙·취득 시각을 남긴다. `fixate()`는 `ON CONFLICT DO NOTHING` 후 저장된 승자를 반환하므로
동시 API/worker 취득이나 운영자 보충이 기존 값을 덮어쓰지 않는다.

API·worker 쓰기 래퍼의 스냅샷 고정은 거래 원장의 호출자 트랜잭션과 별도로 커밋된다.
따라서 원장 쓰기가 나중에 실패·롤백돼도 검증된 공개 환율 스냅샷은 남아 재사용될 수 있다.
거래 행이 부분적으로 커밋된다는 뜻은 아니다. 스냅샷 저장소를 명시적으로 트랜잭션에 묶어
사용하는 경우에는 그 트랜잭션과 함께 롤백된다.

## 누락·장애·호출 제한

미지원 통화, 미래 서울 날짜, 휴일·미게시일의 관측 없음, 잘못된 응답, HTTP·통신 실패는
명시적으로 보류한다. 다른 날짜·이전 영업일·현재 환율·상수로 대체하지 않는다. 기존
`fx_snapshot_missing` 처리와 함께 `api:historical-fx` 또는 `worker:historical-fx` 경고에
통화·기준일·버전·고정 사유 코드만 기록한다. DB 오류는 호출자에게 전파한다.

프로세스별 동일 키 요청은 병합한다. 공급자 HTTP는 동시 2개·대기 16개, 대기 포함 최대
5초, 응답 최대 256KiB로 제한한다. 캐시는 최대 128키이며 성공 6시간·실패 5초다. 매번
DB를 먼저 확인하므로 수동 보충은 실패 캐시가 남아 있어도 즉시 보인다.
외부 조회가 실패한 요청도 DB를 한 번 재확인해 대기 중 다른 쓰기 주체가 고정한 값을
사용한다. 이 재조회 자체의 DB 오류는 공급자 누락으로 숨기지 않고 전파한다.

기존 큐 재시도·정체 복구가 미승격 이벤트를 다시 처리할 때 이 경로가 실행될 수 있다.
이미 승격된 거래를 재계산하거나 다른 예약 작업을 바꾸지는 않는다. 배포 전에 대기 건과
공급자 가용성을 검토하고 기존 배포·모드·쓰기 펜스 절차를 따른다. 별도 인증이나 유료 API는
필요하지 않다.

## 검증 범위와 배포 확인

공급자 테스트의 CSV는 공식 SDMX 개념에 맞춘 **합성 fixture**이며 실 응답 캡처가 아니다.
합성 HTTP·저장소에서 정상/누락/장애·동시 취득·첫 값 보존을 검증하고 실제 도메인 명령까지
연결해 검사한다. worker 테스트는 실제 v2 환산 메서드가 최신 환율을 호출하지 않는지 확인한다.

격리 PostgreSQL 검증은 기존 마이그레이션에서 추출한 두 테이블·enum·불변 트리거·유일키·
v2 CHECK/FK로 실제 Drizzle 저장소와 API·worker `MoneyWriteService.commands`를 연결한다.
독립 resolver의 동시 취득, 최초 값 보존, UPDATE·DELETE 거부, 저장 실패, 호출자 롤백,
서울 날짜와 출처 보존, 동일 원본의 중복 거래 방지를 합성 데이터로 검사한다.
이 fixture는 외부 사용자·가구·카드·문자·카테고리 FK를 포함하지 않으므로 귀속·권한,
전체 승격 흐름·Redis 펜스·큐·알림·전체 마이그레이션의 검증을 대체하지 않는다.

배포 전에는 공식 공개 endpoint의 실제 CSV 속성이 위 계약과 맞는지와 운영 환경의 HTTPS
접근을 별도로 확인해야 한다. 이 확인이 실패해도 응답 검증을 느슨하게 하거나 다른 날짜로
바꾸지 않는다. 보류 원인을 해결한 뒤 정상 재시도 경로로 처리한다.

공식 근거(2026-10-30 확인):

- [ECB 기준환율·통화 목록](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)
- [ECB SDMX API](https://data.ecb.europa.eu/help/api/data)
- [ECB API 예제](https://data.ecb.europa.eu/help/api/data-examples)
- [ECB SDMX 개념과 속성](https://www.ecb.europa.eu/stats/ecb_statistics/sdmx/html/tutorial.en.html)
