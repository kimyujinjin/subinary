/**
 * 질문이 이름을 댄 대상(가맹점·카테고리)에 그 대상의 금액으로 답하는지 — 서비스 경계.
 *
 * 버그(P1): "이번 달 스타벅스 얼마 썼어?"가 의도 해석에서 `total`로 떨어져 **월 총지출**이
 * 스타벅스 금액처럼 나갔다. 여기서는 권한이 적용된 집계(analytics)와 DB 조회를 대역으로
 * 두고 집계 단계(aggregate)와 결정적 답변(templateAnswer)을 함께 확인한다.
 */
import type { ProviderSet } from '@family/ai-providers';
import type { CategoryBreakdown, FinanceQueryData } from '@family/contracts';
import { schema } from '@family/database';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import type { AnalyticsService } from '../analytics/analytics.service';
import { FinanceAiService } from './finance-ai.service';
import type { SupportedFinanceIntent } from './finance-intent';
import type { MerchantSpend } from './finance-subject';

const HOUSEHOLD = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const MEMBER = '00000000-0000-4000-8000-000000000003';
const MONTH = '2026-11';

interface Internals {
  aggregate(
    userId: string,
    householdId: string,
    actorMemberId: string,
    intent: SupportedFinanceIntent,
    question: string,
  ): Promise<FinanceQueryData>;
  templateAnswer(data: FinanceQueryData): string;
  merchantSpend(
    userId: string,
    householdId: string,
    from: Date,
    to: Date,
  ): Promise<MerchantSpend[]>;
  listCategoryCatalogue(householdId: string): Promise<{ slug: string; name: string }[]>;
}

const CATEGORY_ITEMS: CategoryBreakdown['items'] = [
  { categoryId: 'c-food', categorySlug: 'food', categoryName: '식비', net: 300_000, ratio: 0.6, count: 20 },
  { categoryId: 'c-kid', categorySlug: 'custom-1a2b3c4d', categoryName: '아이 용품', net: 52_000, ratio: 0.1, count: 3 },
  { categoryId: 'c-cafe', categorySlug: 'cafe', categoryName: '카페', net: 40_000, ratio: 0.08, count: 8 },
];

const CURRENT: MerchantSpend[] = [
  { label: '쿠팡', net: 120_000, count: 4 },
  { label: '스타벅스강남R점', net: 9_000, count: 2 },
  { label: 'STARBUCKS 여의도', net: 3_300, count: 1 },
  { label: '(비공개)', net: 77_000, count: 2 },
];

function setup(options: { current?: MerchantSpend[]; recent?: MerchantSpend[]; catalogue?: { slug: string; name: string }[] } = {}) {
  const monthly = vi.fn(async () => ({ totalNet: 1_234_000, transactionCount: 80 }));
  const categories = vi.fn(async () => ({ items: CATEGORY_ITEMS }));
  const merchants = vi.fn(async () => ({ items: [] }));
  const generate = vi.fn(async () => {
    throw new Error('외부 AI 호출 금지');
  });
  const service = new FinanceAiService(
    { monthly, categories, merchants } as unknown as AnalyticsService,
    {} as never,
    { llm: { generate } } as unknown as ProviderSet,
  );
  const internals = service as unknown as Internals;
  const merchantSpend = vi
    .spyOn(internals, 'merchantSpend')
    .mockImplementation(async (_hh, _member, from) =>
      // 이번 달 창은 11월 1일(KST)에서 시작하고, 직전 창은 그 전에 시작한다.
      from.toISOString() === '2026-10-31T15:00:00.000Z'
        ? (options.current ?? CURRENT)
        : (options.recent ?? []),
    );
  const catalogue = vi
    .spyOn(internals, 'listCategoryCatalogue')
    .mockResolvedValue(
      options.catalogue ?? [
        { slug: 'food', name: '식비' },
        { slug: 'cafe', name: '카페' },
        { slug: 'custom-1a2b3c4d', name: '아이 용품' },
      ],
    );
  const ask = async (question: string, intent: Partial<SupportedFinanceIntent> = {}) => {
    const data = await internals.aggregate(USER, HOUSEHOLD, MEMBER, {
      month: MONTH,
      categorySlug: null,
      aggregate: 'total',
      ...intent,
    }, question);
    return { data, answer: internals.templateAnswer(data) };
  };
  return { ask, monthly, categories, merchants, merchantSpend, catalogue, generate };
}

describe('가맹점을 이름으로 물으면 그 가맹점의 금액으로 답한다', () => {
  it('"스타벅스 얼마 썼어?"는 월 총지출이 아니라 스타벅스 매장 합계다', async () => {
    const { ask, monthly, generate } = setup();
    const { data, answer } = await ask('이번 달 스타벅스 얼마 썼어?');
    expect(data).toEqual({
      month: MONTH,
      aggregate: 'byMerchant',
      categorySlug: null,
      categoryName: null,
      merchantName: '스타벅스',
      totalNet: 12_300,
      transactionCount: 3,
      items: [
        { label: '스타벅스강남R점', net: 9_000, count: 2 },
        { label: 'STARBUCKS 여의도', net: 3_300, count: 1 },
      ],
    });
    expect(answer).toBe('2026년 11월 스타벅스 결제는 12,300원이에요. (3건)');
    expect(answer).not.toContain('1,234,000원');
    // 월 총지출은 계산조차 하지 않는다 — 대상이 있으면 그 대상의 금액만 말한다.
    expect(monthly).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('LLM이 카테고리(cafe)로 읽었어도 질문에 나온 가맹점 이름이 이긴다', async () => {
    const { ask } = setup();
    const { data } = await ask('스타벅스 얼마 썼어?', {
      categorySlug: 'cafe',
      aggregate: 'byCategory',
    });
    expect(data).toMatchObject({ aggregate: 'byMerchant', merchantName: '스타벅스', totalNet: 12_300 });
  });

  it('이번 달 결제가 없고 직전 2개월에 본 가맹점이면 "결제가 없어요"다', async () => {
    const { ask, merchantSpend } = setup({
      recent: [{ label: '넷플릭스', net: 13_500, count: 2 }],
    });
    const { data, answer } = await ask('이번 달 넷플릭스 얼마 썼어?');
    expect(data).toMatchObject({
      aggregate: 'byMerchant',
      merchantName: '넷플릭스',
      totalNet: 0,
      transactionCount: 0,
    });
    expect(data.items).toBeUndefined();
    expect(answer).toBe('2026년 11월에는 넷플릭스 결제가 없어요.');
    // 이번 달 창 [11/1, 12/1) KST와 직전 2개월 창 [9/1, 11/1) KST, 공개범위는 질문한 사람 기준.
    expect(merchantSpend.mock.calls.map(([user, hh, from, to]) => [user, hh, from.toISOString(), to.toISOString()])).toEqual([
      [USER, HOUSEHOLD, '2026-10-31T15:00:00.000Z', '2026-11-30T15:00:00.000Z'],
      [USER, HOUSEHOLD, '2026-08-31T15:00:00.000Z', '2026-10-31T15:00:00.000Z'],
    ]);
  });
});

describe('카테고리를 이름으로 물으면 그 카테고리다(가족 카테고리 포함)', () => {
  it('가족이 만든 카테고리는 시스템 slug가 없어도 그 카테고리 금액으로 답한다', async () => {
    const { ask } = setup();
    const { data, answer } = await ask('이번 달 아이 용품 얼마 썼어?');
    expect(data).toMatchObject({
      aggregate: 'byCategory',
      categorySlug: 'custom-1a2b3c4d',
      categoryName: '아이 용품',
      totalNet: 52_000,
      transactionCount: 3,
    });
    expect(answer).toBe('2026년 11월 아이 용품 지출은 52,000원이에요. (3건)');
  });

  it('이번 달 지출이 없는 가족 카테고리는 "지출이 없어요"다', async () => {
    const { ask } = setup({
      catalogue: [
        { slug: 'food', name: '식비' },
        { slug: 'custom-77777777', name: '경조사' },
      ],
    });
    const { data, answer } = await ask('이번 달 경조사 얼마 썼어?');
    expect(data).toMatchObject({ categoryName: '경조사', totalNet: 0, transactionCount: 0 });
    expect(answer).toBe('2026년 11월에는 경조사 지출이 없어요.');
  });

  it('미분류는 slug가 없어도 이름으로 답한다', async () => {
    const { ask } = setup();
    const { data, answer } = await ask('미분류 얼마야?');
    expect(data).toMatchObject({ categorySlug: null, categoryName: '미분류', transactionCount: 0 });
    expect(answer).toBe('2026년 11월에는 미분류 지출이 없어요.');
  });
});

describe('대상이 없거나 전체를 물으면 예전처럼 답한다(회귀 방어)', () => {
  it('"총 지출"은 대상 조회 없이 월 총지출이다', async () => {
    const { ask, merchantSpend, categories } = setup();
    const { data, answer } = await ask('이번 달 총 지출 얼마야?');
    expect(data).toMatchObject({ aggregate: 'total', totalNet: 1_234_000, transactionCount: 80 });
    expect(answer).toBe('2026년 11월 총 지출은 1,234,000원이에요. (거래 80건)');
    expect(merchantSpend).not.toHaveBeenCalled();
    expect(categories).not.toHaveBeenCalled();
  });

  it('이름이 없는 질문은 월 총지출이다', async () => {
    const { ask } = setup();
    const { data } = await ask('이번 달 얼마 썼어?');
    expect(data).toMatchObject({ aggregate: 'total', totalNet: 1_234_000 });
  });

  it('카테고리별 질문은 카테고리 집계를 한 번만 돌린다', async () => {
    const { ask, categories } = setup();
    const { data } = await ask('카테고리별로 보여줘', { aggregate: 'byCategory' });
    expect(data).toMatchObject({ aggregate: 'byCategory', categoryName: null, totalNet: 1_234_000 });
    expect(data.items?.[0]).toEqual({ label: '식비', net: 300_000, count: 20 });
    expect(categories).toHaveBeenCalledTimes(1);
  });

  it('질문에 이름이 없을 때 의도 해석이 고른 카테고리는 그대로다', async () => {
    const { ask } = setup();
    const { data } = await ask('이번 달 밥값 얼마야?', { categorySlug: 'food', aggregate: 'byCategory' });
    expect(data).toMatchObject({ categorySlug: 'food', categoryName: '식비', totalNet: 300_000 });
  });
});

describe('가맹점 금액은 분석 집계 한 곳에서만 낸다(ADR-0026)', () => {
  it('analytics.merchants에 같은 기간을 넘기고 상위 20곳으로 자르지 않는다 — 공개범위·지출 정의는 그쪽 몫', async () => {
    const merchants = vi.fn(async () => ({
      items: [{ merchant: '빽다방', net: 4_500, ratio: 1, count: 2 }],
    }));
    const service = new FinanceAiService(
      { merchants } as unknown as AnalyticsService,
      {} as never,
      {} as ProviderSet,
    );
    const rows = await (service as unknown as Internals).merchantSpend(
      USER,
      HOUSEHOLD,
      new Date('2026-10-31T15:00:00.000Z'),
      new Date('2026-11-30T15:00:00.000Z'),
    );
    expect(rows).toEqual([{ label: '빽다방', net: 4_500, count: 2 }]);
    expect(merchants).toHaveBeenCalledWith(
      USER,
      HOUSEHOLD,
      { from: '2026-10-31T15:00:00.000Z', to: '2026-11-30T15:00:00.000Z' },
      { limit: 1000 },
    );
  });
});
