import type { ProviderSet } from '@family/ai-providers';
import type { MonthlyInsight } from '@family/contracts';
import { schema } from '@family/database';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import type { AnalyticsService } from '../analytics/analytics.service';
import { FinanceAiService } from './finance-ai.service';

const HOUSEHOLD = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const CARD_A = '00000000-0000-4000-8000-000000000003';
const CARD_B = '00000000-0000-4000-8000-000000000004';
const SHARED_CARD = '00000000-0000-4000-8000-000000000005';
const BUDGET = '00000000-0000-4000-8000-000000000006';

interface Internals {
  buildBudgetFact(userId: string, householdId: string, month: string, totalNet: number, categoryItems: readonly { categoryId: string | null; net: number }[]): Promise<MonthlyInsight | null>;
}
interface Query { sql: string; params: unknown[] }

/** 권한 적용된 카드별 집계와 SQL 결과만 대체하며 LLM은 호출할 수 없게 둔다. */
function setup(options: { scopeType?: schema.Budget['scopeType']; scopeRefId?: string | null; cardIds?: string[]; failure?: boolean } = {}) {
  const queries: Query[] = [];
  const driver = {
    options: { parsers: {}, serializers: {} },
    unsafe(query: string, params: unknown[]) {
      queries.push({ sql: query, params });
      return {
        async values(): Promise<unknown[][]> {
          return [[BUDGET, '본인 용돈', options.scopeType ?? 'card_group', options.scopeRefId ?? null, options.cardIds ?? [CARD_A, CARD_B], 100000]];
        },
      };
    },
  };
  const cards = vi.fn(async () => {
    if (options.failure) throw new Error('합성 카드 집계 실패');
    return { items: [{ cardId: CARD_A, net: 60000 }, { cardId: CARD_B, net: 50000 }, { cardId: SHARED_CARD, net: 900000 }, { cardId: null, net: 900000 }] };
  });
  const members = vi.fn(async () => ({ items: [] }));
  const generate = vi.fn(async () => { throw new Error('외부 AI 호출 금지'); });
  const service = new FinanceAiService(
    { cards, members } as unknown as AnalyticsService,
    drizzle(driver as unknown as postgres.Sql, { schema }),
    { llm: { generate } } as unknown as ProviderSet,
  );
  const run = () => (service as unknown as Internals).buildBudgetFact(USER, HOUSEHOLD, '2026-01', 1900000, []);
  return { run, queries, cards, members, generate };
}

describe('카드 묶음 예산 인사이트의 결정적 집계', () => {
  it('선택한 두 카드만 더하고 다른 공용 카드·미연결 거래를 포함하지 않는다', async () => {
    const { run, queries, cards, members, generate } = setup();
    const result = await run();
    expect(result?.message).toContain('110,000원');
    expect(result?.message).toContain('110%');
    expect(result?.message).not.toContain('900,000원');
    expect(cards).toHaveBeenCalledWith(USER, HOUSEHOLD, { month: '2026-01' });
    expect(members).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(queries[0]?.sql).toContain('"budgets"."effective_month" =');
    expect(queries[0]?.sql).toContain('"budgets"."currency" =');
    expect(queries[0]?.params).toEqual([HOUSEHOLD, '2026-01-01', 'KRW']);
  });

  it('빈 집합은 전체 지출로 대체하지 않고 예측에서 제외한다', async () => {
    const { run, cards } = setup({ cardIds: [] });
    expect(await run()).toBeNull();
    expect(cards).not.toHaveBeenCalled();
  });

  it('비정상 중복 카드 ID가 있어도 같은 카드 지출을 두 번 더하지 않는다', async () => {
    const { run } = setup({ cardIds: [CARD_A, CARD_A, CARD_B] });
    expect((await run())?.message).toContain('110,000원');
  });

  it('단일 카드 예산은 기존대로 해당 카드 하나만 사용한다', async () => {
    const { run, cards } = setup({ scopeType: 'card', scopeRefId: CARD_A, cardIds: [] });
    expect(await run()).toBeNull();
    expect(cards).toHaveBeenCalledTimes(1);
  });

  it('권한 적용된 집계가 실패하면 0원이나 정상 예측을 만들어 내지 않는다', async () => {
    const { run, generate } = setup({ failure: true });
    await expect(run()).rejects.toThrow('합성 카드 집계 실패');
    expect(generate).not.toHaveBeenCalled();
  });
});
