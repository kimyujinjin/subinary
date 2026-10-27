import { ConfigService } from '@nestjs/config';
import { schema } from '@family/database';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import type { Queue } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TransactionPromotionService } from './transaction-promotion.service';
import type { FxRateService } from './fx-rate.service';
import type { MoneyShadowService } from './money-shadow.service';
import type { MoneyWriteService } from './money-write.service';

const HOUSEHOLD = '00000000-0000-4000-8000-000000000001';
const MEMBER = '00000000-0000-4000-8000-000000000002';
const CARD_A = '00000000-0000-4000-8000-000000000003';
const CARD_B = '00000000-0000-4000-8000-000000000004';
const SHARED_CARD = '00000000-0000-4000-8000-000000000005';
const BUDGET = '00000000-0000-4000-8000-000000000006';
const from = new Date('2026-09-30T15:00:00.000Z');
const to = new Date('2026-10-31T15:00:00.000Z');

const budget: schema.Budget = {
  id: BUDGET, householdId: HOUSEHOLD, name: '본인 용돈', scopeType: 'card_group', scopeRefId: null,
  cardIds: [CARD_A, CARD_B], amount: 100000, effectiveMonth: '2026-10-01', period: 'monthly', currency: 'KRW',
  createdBy: MEMBER, createdAt: from, updatedAt: from,
};

interface Query { sql: string; params: unknown[] }
interface Internals {
  budgetScopeSpent(budget: schema.Budget, from: Date, to: Date): Promise<number>;
  checkBudgetAlerts(params: { householdId: string; memberId: string; cardId: string | null; categoryId: string | null }): Promise<void>;
}

/** 실제 SQL 생성·응답 매핑을 실행하고 DB와 알림 큐만 대체한다. */
function setup(results: Array<unknown[][] | Error>) {
  const queries: Query[] = [];
  const responses = [...results];
  const driver = {
    options: { parsers: {}, serializers: {} },
    unsafe(query: string, params: unknown[]) {
      queries.push({ sql: query, params });
      return {
        async values(): Promise<unknown[][]> {
          const result = responses.shift();
          if (result instanceof Error) throw result;
          if (result === undefined) throw new Error('예상하지 않은 DB 호출');
          return result;
        },
      };
    },
  };
  const notify = vi.fn(async () => undefined);
  const service = new TransactionPromotionService(
    drizzle(driver as unknown as postgres.Sql, { schema }),
    {} as Queue, { add: notify } as unknown as Queue,
    {} as FxRateService, {} as MoneyShadowService, {} as MoneyWriteService,
    new ConfigService({ app: { nodeEnv: 'production' } }),
  );
  return { service: service as unknown as Internals, queries, notify };
}

/** 전체 예산 조회의 실제 컬럼 순서로 합성 행을 만든다. */
function budgetRow(value: schema.Budget): unknown[] {
  return (Object.keys(getTableColumns(schema.budgets)) as Array<keyof schema.Budget>).map((key) => {
    const field = value[key];
    return field instanceof Date ? field.toISOString() : field;
  });
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('카드 묶음 예산 알림', () => {
  it('선택한 카드만 합산하면서 기간·통화·제외·자산이동 조건을 유지한다', async () => {
    const { service, queries } = setup([[['110000']]]);
    expect(await service.budgetScopeSpent(budget, from, to)).toBe(110000);
    const query = queries[0]!;
    expect(query.sql).toContain('"card_transactions"."card_id" in');
    expect(query.sql).toContain('"card_transactions"."excluded_at" is null');
    expect(query.sql).toContain('from expense_categories ec');
    expect(query.params).toEqual(expect.arrayContaining([HOUSEHOLD, 'approval', 'KRW', CARD_A, CARD_B]));
    expect(query.params).not.toContain(SHARED_CARD);
    expect(query.sql).not.toContain('"payment_cards"');
    expect(query.sql).not.toContain('"visibility"');
  });

  it('빈 카드 집합은 전체 가구 집계로 바뀌지 않는다', async () => {
    const { service, queries } = setup([[['0']]]);
    expect(await service.budgetScopeSpent({ ...budget, cardIds: [] }, from, to)).toBe(0);
    expect(queries[0]?.sql).toContain('and false');
  });

  it('단일 카드 예산의 기존 필터를 유지한다', async () => {
    const { service, queries } = setup([[['30000']]]);
    expect(await service.budgetScopeSpent({ ...budget, scopeType: 'card', scopeRefId: CARD_A, cardIds: [] }, from, to)).toBe(30000);
    expect(queries[0]?.sql).toContain('"card_transactions"."card_id" =');
    expect(queries[0]?.params).toContain(CARD_A);
    expect(queries[0]?.params).not.toContain(CARD_B);
  });

  it('카드 묶음 해당 월 예산을 찾아 최고 미발송 임계만 한 번 알린다', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T00:00:00.000Z'));
    const { service, queries, notify } = setup([[budgetRow(budget)], [['110000']], [[BUDGET]], [[BUDGET]]]);
    await service.checkBudgetAlerts({ householdId: HOUSEHOLD, memberId: MEMBER, cardId: CARD_B, categoryId: null });
    expect(queries[0]?.sql).toContain('::uuid = any("budgets"."card_ids")');
    expect(queries[0]?.params).toEqual(expect.arrayContaining(['card_group', CARD_B, '2026-10-01']));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('dispatch', expect.objectContaining({ kind: 'budget', budgetId: BUDGET, threshold: 100 }), expect.any(Object));
  });

  it('미연결 거래는 카드 묶음 예산 알림을 조회하지 않는다', async () => {
    const { service, queries, notify } = setup([[]]);
    await service.checkBudgetAlerts({ householdId: HOUSEHOLD, memberId: MEMBER, cardId: null, categoryId: null });
    expect(queries[0]?.params).not.toContain('card_group');
    expect(notify).not.toHaveBeenCalled();
  });

  it('집계 실패가 예산 초과 알림을 만들거나 거래 승격을 중단하지 않는다', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T00:00:00.000Z'));
    const { service, notify } = setup([[budgetRow(budget)], new Error('합성 집계 실패')]);
    await expect(service.checkBudgetAlerts({ householdId: HOUSEHOLD, memberId: MEMBER, cardId: CARD_A, categoryId: null })).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });
});
