/**
 * 격리 검증 DB를 명시했을 때만 실제 SQL 집계를 검증한다.
 * 이 연결의 임시 테이블만 사용하며 기존 테이블의 데이터는 읽거나 쓰지 않는다.
 */
import { ForbiddenException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { schema } from '@family/database';

import { FinanceQualityService } from './finance-quality.service';

const DATABASE_URL = process.env.FINANCE_QUALITY_TEST_DATABASE_URL;
const HOUSEHOLD = '00000000-0000-4000-8000-000000000001';
const OTHER_HOUSEHOLD = '00000000-0000-4000-8000-000000000002';
const DELETED_HOUSEHOLD = '00000000-0000-4000-8000-000000000003';
const SELF = '00000000-0000-4000-8000-000000000011';
const OTHER = '00000000-0000-4000-8000-000000000012';
const INACTIVE = '00000000-0000-4000-8000-000000000013';
const USER = '00000000-0000-4000-8000-000000000021';
const OTHER_USER = '00000000-0000-4000-8000-000000000022';
const INACTIVE_USER = '00000000-0000-4000-8000-000000000023';
const OTHER_CARD = '00000000-0000-4000-8000-000000000031';
const SHARED_CARD = '00000000-0000-4000-8000-000000000032';
const CATEGORY = '00000000-0000-4000-8000-000000000041';

describe.skipIf(!DATABASE_URL)('금융 품질 — 격리 Postgres', () => {
  let client: postgres.Sql | undefined;
  let service: FinanceQualityService;

  beforeAll(async () => {
    if (!DATABASE_URL) throw new Error('격리 검증 DB가 필요합니다.');
    const databaseName = decodeURIComponent(new URL(DATABASE_URL).pathname.slice(1));
    if (process.env.NODE_ENV === 'production' || !/(?:^|[_-])(?:test|verify|verification)(?:[_-]|$)/iu.test(databaseName)) {
      throw new Error('test 또는 verify 이름을 가진 격리 DB에서만 실행할 수 있습니다.');
    }
    client = postgres(DATABASE_URL, { max: 1, prepare: false });
    service = new FinanceQualityService(drizzle(client, { schema }));
    // pg_temp가 기본 테이블보다 먼저 해석되므로 모든 조회가 이 합성 자료에 묶인다.
    await client`create temporary table households (id uuid, deleted_at timestamptz)`;
    await client`create temporary table household_members (id uuid, household_id uuid, user_id uuid, status text)`;
    await client`create temporary table payment_cards (id uuid, household_id uuid, owner_member_id uuid, is_shared boolean)`;
    await client`create temporary table card_transactions (
      household_id uuid, member_id uuid, card_id uuid, transaction_type text, status text,
      category_id uuid, parent_transaction_id uuid, visibility text, excluded_at timestamptz
    )`;
    await client`create temporary table card_sms_events (
      household_id uuid, member_id uuid, parse_status text, received_at timestamptz
    )`;
    await client`insert into households values
      (${HOUSEHOLD}, null), (${OTHER_HOUSEHOLD}, null), (${DELETED_HOUSEHOLD}, now())`;
    await client`insert into household_members values
      (${SELF}, ${HOUSEHOLD}, ${USER}, 'active'),
      (${OTHER}, ${HOUSEHOLD}, ${OTHER_USER}, 'active'),
      (${INACTIVE}, ${HOUSEHOLD}, ${INACTIVE_USER}, 'inactive'),
      (${SELF}, ${DELETED_HOUSEHOLD}, ${USER}, 'active')`;
    await client`insert into payment_cards values
      (${OTHER_CARD}, ${HOUSEHOLD}, ${OTHER}, false),
      (${SHARED_CARD}, ${HOUSEHOLD}, ${OTHER}, true)`;
    await client`insert into card_transactions values
      (${HOUSEHOLD}, ${SELF}, ${OTHER_CARD}, 'approval', 'approved', null, null, 'private', null),
      (${HOUSEHOLD}, ${OTHER}, null, 'approval', 'duplicate_suspected', null, null, 'household', null),
      (${HOUSEHOLD}, ${OTHER}, null, 'cancellation', 'unlinked_cancellation', null, null, 'summary_only', null),
      (${HOUSEHOLD}, ${OTHER}, null, 'approval', 'duplicate_suspected', null, null, 'private', null),
      (${HOUSEHOLD}, ${SELF}, ${OTHER_CARD}, 'approval', 'duplicate_suspected', null, null, 'household', now()),
      (${HOUSEHOLD}, ${SELF}, ${SHARED_CARD}, 'approval', 'approved', ${CATEGORY}, null, 'household', null),
      (${HOUSEHOLD}, ${SELF}, null, 'cancellation', 'cancelled', null, ${CATEGORY}, 'private', null),
      (${OTHER_HOUSEHOLD}, ${SELF}, ${OTHER_CARD}, 'approval', 'duplicate_suspected', null, null, 'household', null)`;
    await client`insert into card_sms_events values
      (${HOUSEHOLD}, ${SELF}, 'pending', '2026-10-01T00:00:00Z'),
      (${HOUSEHOLD}, ${SELF}, 'parse_failed', '2026-10-02T00:00:00Z'),
      (${HOUSEHOLD}, ${SELF}, 'pending_review', '2026-10-03T00:00:00Z'),
      (${HOUSEHOLD}, ${SELF}, 'quarantined', '2026-10-04T00:00:00Z'),
      (${HOUSEHOLD}, ${SELF}, 'ignored', '2026-10-05T00:00:00Z'),
      (${HOUSEHOLD}, ${SELF}, 'parsed', '2026-10-20T00:00:00Z'),
      (${HOUSEHOLD}, ${OTHER}, 'parse_failed', '2026-10-26T00:00:00Z'),
      (${OTHER_HOUSEHOLD}, ${SELF}, 'parse_failed', '2026-10-27T00:00:00Z')`;
  });

  afterAll(async () => {
    // 연결 종료와 함께 임시 테이블도 제거된다. 운영 테이블 삭제문은 사용하지 않는다.
    await client?.end({ timeout: 5 });
  });

  it('비공개·다른 가구·제외 거래와 다른 구성원 문자를 집계에서 제외한다', async () => {
    const result = await service.read(USER, HOUSEHOLD);
    expect(result.transactions).toEqual({
      uncategorized: 2, duplicateSuspected: 1, unlinkedCancellations: 1, cardOwnerMismatches: 1,
    });
    expect(result.sms).toEqual({
      pending: 1, parseFailed: 1, pendingReview: 1, quarantined: 1, ignored: 1,
      lastReceivedAt: '2026-10-20T00:00:00.000Z',
    });
  });

  it.each([
    [INACTIVE_USER, HOUSEHOLD],
    [USER, OTHER_HOUSEHOLD],
    [USER, DELETED_HOUSEHOLD],
  ])('비활성·다른 가구·삭제 가구 구성원은 거절한다 (%s)', async (userId, householdId) => {
    await expect(service.read(userId, householdId)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
