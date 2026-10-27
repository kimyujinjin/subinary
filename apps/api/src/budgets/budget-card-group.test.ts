import { describe, expect, it } from 'vitest';
import { budgetCreateRequestSchema, budgetUpdateRequestSchema } from '@family/contracts';

const householdId = '00000000-0000-4000-8000-000000000001';
const cardA = '00000000-0000-4000-8000-000000000011';
const cardB = '00000000-0000-4000-8000-000000000012';

describe('카드 묶음 요청 계약', () => {
  it('서로 다른 두 카드와 기존 단일 카드 요청을 허용한다', () => {
    expect(budgetCreateRequestSchema.parse({ householdId, scopeType: 'card_group', cardIds: [cardA, cardB], amount: 100_000 }).cardIds).toEqual([cardA, cardB]);
    expect(budgetCreateRequestSchema.parse({ householdId, scopeType: 'card', scopeRefId: cardA, amount: 100_000 }).scopeType).toBe('card');
  });

  it.each([{ cardIds: [] }, { cardIds: [cardA] }, { cardIds: [cardA, cardA] }])('빈 목록·한 장·중복 카드는 거절한다: $cardIds', ({ cardIds }) => {
    expect(budgetCreateRequestSchema.safeParse({ householdId, scopeType: 'card_group', cardIds, amount: 100_000 }).success).toBe(false);
  });

  it('카드 묶음과 단일 참조를 혼용하거나 일반 예산에 카드 목록을 보내면 거절한다', () => {
    expect(budgetCreateRequestSchema.safeParse({ householdId, scopeType: 'card_group', scopeRefId: cardA, cardIds: [cardA, cardB], amount: 100_000 }).success).toBe(false);
    expect(budgetCreateRequestSchema.safeParse({ householdId, scopeType: 'member', scopeRefId: cardA, cardIds: [cardA, cardB], amount: 100_000 }).success).toBe(false);
  });

  it('범위 정정은 변경 전 카드 목록을 요구한다', () => {
    expect(budgetUpdateRequestSchema.safeParse({ scopeType: 'card_group', cardIds: [cardA, cardB] }).success).toBe(false);
    expect(budgetUpdateRequestSchema.safeParse({ scopeType: 'card_group', cardIds: [cardA, cardB], expectedCardIds: [cardA] }).success).toBe(true);
    expect(budgetUpdateRequestSchema.safeParse({ amount: 200_000 }).success).toBe(true);
  });
});
