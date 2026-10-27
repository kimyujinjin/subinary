import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { financeQualitySchema } from '@family/contracts';
import { schema } from '@family/database';

import { FinanceQualityService } from './finance-quality.service';

const HOUSEHOLD_ID = '00000000-0000-4000-8000-000000000001';
const MEMBER_ID = '00000000-0000-4000-8000-000000000002';
const USER_ID = '00000000-0000-4000-8000-000000000003';

interface CapturedQuery {
  sql: string;
  params: unknown[];
}

/** 네트워크 없이 실제 Drizzle SQL 생성과 결과 매핑까지 검증하는 드라이버 대역. */
function setup(results: Array<unknown[][] | Error>): {
  service: FinanceQualityService;
  queries: CapturedQuery[];
} {
  const queries: CapturedQuery[] = [];
  const queue = [...results];
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe(query: string, params: unknown[]) {
      queries.push({ sql: query, params });
      return {
        async values(): Promise<unknown[][]> {
          const result = queue.shift();
          if (result instanceof Error) throw result;
          if (result === undefined) throw new Error('예상하지 않은 DB 조회입니다.');
          return result;
        },
      };
    },
  };
  const db = drizzle(client as unknown as postgres.Sql, { schema });
  return { service: new FinanceQualityService(db), queries };
}

describe('금융 품질 조회', () => {
  it.each([undefined, '', 'not-a-household-id'])(
    '잘못된 가구 ID %s는 DB 조회 전에 400으로 거절한다',
    async (householdId) => {
      const { service, queries } = setup([]);
      await expect(service.read(USER_ID, householdId)).rejects.toBeInstanceOf(BadRequestException);
      expect(queries).toHaveLength(0);
    },
  );

  it('활성 구성원이 없으면 집계 조회 없이 403으로 거절한다', async () => {
    const { service, queries } = setup([[]]);
    await expect(service.read(USER_ID, HOUSEHOLD_ID)).rejects.toBeInstanceOf(ForbiddenException);
    expect(queries).toHaveLength(1);
    const membership = queries[0];
    expect(membership?.sql).toContain('"household_members"."status" =');
    expect(membership?.sql).toContain('"households"."deleted_at" is null');
    expect(membership?.params).toEqual([HOUSEHOLD_ID, USER_ID, 'active', 1]);
  });

  it('전 기간 건수와 본인 최종 수신시각만 명시한 계약으로 반환한다', async () => {
    const { service, queries } = setup([
      [[MEMBER_ID]],
      [['3', '2', '1', '4']],
      [['5', '6', '7', '8', '9', '2026-10-20 09:01:02+09']],
    ]);
    const result = await service.read(USER_ID, HOUSEHOLD_ID);
    expect(financeQualitySchema.safeParse(result).success).toBe(true);
    expect(result.scope).toEqual({
      period: 'all_time', transactions: 'visible_non_excluded', sms: 'own_member',
    });
    expect(result.transactions).toEqual({
      uncategorized: 3, duplicateSuspected: 2, unlinkedCancellations: 1, cardOwnerMismatches: 4,
    });
    expect(result.sms).toEqual({
      pending: 5, parseFailed: 6, pendingReview: 7, quarantined: 8, ignored: 9,
      lastReceivedAt: '2026-10-20T00:01:02.000Z',
    });
    expect(queries).toHaveLength(3);
    // 민감 필드는 SELECT 자체에 없어야 이후 직렬화 실수로도 새어나가지 않는다.
    for (const query of queries) {
      expect(query.sql).not.toMatch(/raw_content|merchant_raw|sender|phone/i);
    }
  });

  it('거래는 가구·공개범위·제외 상태, 문자는 본인 구성원으로 한정한다', async () => {
    const { service, queries } = setup([
      [[MEMBER_ID]], [['0', '0', '0', '0']], [['0', '0', '0', '0', '0', null]],
    ]);
    await service.read(USER_ID, HOUSEHOLD_ID);
    const transactionQuery = queries[1];
    expect(transactionQuery?.sql).toContain('"card_transactions"."excluded_at" is null');
    expect(transactionQuery?.sql).toContain('"card_transactions"."member_id" =');
    expect(transactionQuery?.sql).toContain('or "card_transactions"."visibility" in');
    expect(transactionQuery?.params).toEqual([
      HOUSEHOLD_ID, HOUSEHOLD_ID, MEMBER_ID, 'household', 'summary_only',
    ]);
    const smsQuery = queries[2];
    expect(smsQuery?.sql).toContain('"card_sms_events"."household_id" =');
    expect(smsQuery?.sql).toContain('and "card_sms_events"."member_id" =');
    expect(smsQuery?.params).toEqual([HOUSEHOLD_ID, MEMBER_ID]);
    expect(smsQuery?.sql).not.toContain('"household_members"');
  });

  it('거래·문자가 한 건도 없으면 0과 null을 유지한다', async () => {
    const { service } = setup([
      [[MEMBER_ID]], [['0', '0', '0', '0']], [['0', '0', '0', '0', '0', null]],
    ]);
    const result = await service.read(USER_ID, HOUSEHOLD_ID);
    expect(Object.values(result.transactions)).toEqual([0, 0, 0, 0]);
    expect(result.sms.lastReceivedAt).toBeNull();
    expect(result.sms.parseFailed).toBe(0);
  });

  it('집계 실패를 정상 0건으로 숨기지 않는다', async () => {
    const failure = new Error('집계 조회 실패');
    const { service } = setup([
      [[MEMBER_ID]], failure, [['0', '0', '0', '0', '0', null]],
    ]);
    await expect(service.read(USER_ID, HOUSEHOLD_ID)).rejects.toMatchObject({ cause: failure });
  });
});
