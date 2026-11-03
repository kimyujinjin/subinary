/** 격리 PostgreSQL의 실제 예산 제약·잠금·정정 이력과 합성 거래 집계를 검증한다. */
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@family/database';
import { BudgetService } from './budget.service';
import { addBudgetMonths, currentBudgetMonth, toEffectiveMonth } from './budget-month';

const DATABASE_URL = process.env.BUDGET_GROUP_TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('카드 묶음 예산 — 격리 Postgres', () => {
  const userId = randomUUID();
  const memberUserId = randomUUID();
  const householdId = randomUUID();
  const otherHouseholdId = randomUUID();
  const memberId = randomUUID();
  const otherMemberId = randomUUID();
  const outsideMemberId = randomUUID();
  const cards = Array.from({ length: 7 }, () => randomUUID());
  const [cardA, cardB, sharedCard, otherOwnerCard, inactiveCard, outsideCard, cardC] = cards as [string, string, string, string, string, string, string];
  const period = currentBudgetMonth();
  const previousMonth = addBudgetMonths(period, -1);
  const oldBudgetId = randomUUID();
  const transferCategoryId = randomUUID();
  let client: postgres.Sql;
  let db: Db;
  let service: BudgetService;
  let groupBudgetId: string;

  beforeAll(async () => {
    if (!DATABASE_URL || process.env.NODE_ENV === 'production' || !/[_-](test|verify)([_-]|$)/i.test(new URL(DATABASE_URL).pathname)) {
      throw new Error('test 또는 verify 이름의 격리 DB가 필요합니다.');
    }
    client = postgres(DATABASE_URL, { max: 1, prepare: false });
    db = drizzle(client, { schema });
    service = new BudgetService(db);
    await db.insert(schema.users).values([
      { id: userId, email: `${userId}@test.invalid`, passwordHash: 'synthetic', name: '예산 소유자' },
      { id: memberUserId, email: `${memberUserId}@test.invalid`, passwordHash: 'synthetic', name: '다른 구성원' },
    ]);
    await db.insert(schema.households).values([
      { id: householdId, name: '합성 예산 가구', createdBy: userId },
      { id: otherHouseholdId, name: '별도 합성 가구', createdBy: userId },
    ]);
    await db.insert(schema.householdMembers).values([
      { id: memberId, householdId, userId, role: 'owner' },
      { id: otherMemberId, householdId, userId: memberUserId, role: 'member' },
      { id: outsideMemberId, householdId: otherHouseholdId, userId, role: 'owner' },
    ]);
    await db.insert(schema.paymentCards).values(cards.map((id, index) => ({
      id, householdId: id === outsideCard ? otherHouseholdId : householdId,
      ownerMemberId: id === outsideCard ? outsideMemberId : id === otherOwnerCard ? otherMemberId : memberId,
      issuer: `합성${index}`, alias: `카드${index}`, createdBy: userId,
      isShared: id === sharedCard, status: id === inactiveCard ? 'inactive' as const : 'active' as const,
    })));
    await db.insert(schema.expenseCategories).values({ id: transferCategoryId, householdId, name: '합성 자산이동', slug: 'synthetic-transfer', isTransfer: true });
    // 거래는 연결 전용 임시 테이블에 넣어 수집·원문·실제 장부에 영향을 주지 않는다.
    await client`create temporary table card_transactions (
      household_id uuid, member_id uuid, card_id uuid, transaction_type text,
      net_amount integer, currency text, approved_at timestamptz, created_at timestamptz,
      visibility text, excluded_at timestamptz, category_id uuid
    )`;
    const currentDate = `${period}-10T03:00:00Z`;
    const previousDate = `${previousMonth}-10T03:00:00Z`;
    await client`insert into card_transactions values
      (${householdId}, ${memberId}, ${cardA}, 'approval', 8000, 'KRW', ${currentDate}, ${currentDate}, 'private', null, null),
      (${householdId}, ${memberId}, ${cardB}, 'approval', 20000, 'KRW', ${currentDate}, ${currentDate}, 'household', null, null),
      (${householdId}, ${memberId}, ${cardB}, 'cancellation', 0, 'KRW', ${currentDate}, ${currentDate}, 'household', null, null),
      (${householdId}, ${memberId}, ${sharedCard}, 'approval', 90000, 'KRW', ${currentDate}, ${currentDate}, 'household', null, null),
      (${householdId}, ${memberId}, ${cardA}, 'approval', 50000, 'KRW', ${currentDate}, ${currentDate}, 'household', now(), null),
      (${householdId}, ${memberId}, ${cardA}, 'approval', 50000, 'KRW', ${currentDate}, ${currentDate}, 'household', null, ${transferCategoryId}),
      (${householdId}, ${memberId}, ${cardB}, 'approval', 10000, 'USD', ${currentDate}, ${currentDate}, 'household', null, null),
      (${householdId}, ${otherMemberId}, ${cardB}, 'approval', 70000, 'KRW', ${currentDate}, ${currentDate}, 'private', null, null),
      (${householdId}, ${memberId}, ${cardA}, 'approval', 2000, 'KRW', ${previousDate}, ${previousDate}, 'household', null, null),
      (${householdId}, ${memberId}, ${cardB}, 'approval', 4000, 'KRW', ${previousDate}, ${previousDate}, 'household', null, null)`;
    await db.insert(schema.budgets).values({ id: oldBudgetId, householdId, scopeType: 'card', scopeRefId: cardA, name: '기존 용돈', amount: 100_000, effectiveMonth: toEffectiveMonth(previousMonth), createdBy: userId });
  });

  afterAll(async () => {
    if (!client) return;
    await db.delete(schema.budgetCopyOperations).where(eq(schema.budgetCopyOperations.householdId, householdId));
    await db.delete(schema.budgets).where(eq(schema.budgets.householdId, householdId));
    await db.delete(schema.paymentCards).where(inArray(schema.paymentCards.id, cards));
    await db.delete(schema.expenseCategories).where(eq(schema.expenseCategories.id, transferCategoryId));
    await db.delete(schema.householdMembers).where(inArray(schema.householdMembers.id, [memberId, otherMemberId, outsideMemberId]));
    await db.delete(schema.households).where(inArray(schema.households.id, [householdId, otherHouseholdId]));
    await db.delete(schema.users).where(inArray(schema.users.id, [userId, memberUserId]));
    await client.end();
  });

  it('두 카드만 순지출을 합산하고 공용·제외·취소 중복·다른 통화·타인 비공개는 제외한다', async () => {
    const result = await service.create(userId, { householdId, scopeType: 'card_group', cardIds: [cardB, cardA], name: '합산 용돈', amount: 100_000, effectiveMonth: period });
    groupBudgetId = result.id;
    expect(result.cardIds).toEqual([cardA, cardB].sort());
    expect(result.scopeRefId).toBeNull();
    expect(result.spent).toBe(28000);
    expect(result.threeMonthAverageSpent).toBe(Math.round(34000 / 3));
    const other = await service.list(memberUserId, { householdId, month: period });
    expect(other.items[0]?.spent).toBe(90000);
  });

  it('순서가 다른 같은 카드 묶음도 중복 생성할 수 없다', async () => {
    await expect(service.create(userId, { householdId, scopeType: 'card_group', cardIds: [cardA, cardB], amount: 100_000, effectiveMonth: period })).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    ['공용', sharedCard], ['다른 소유자', otherOwnerCard], ['비활성', inactiveCard], ['다른 가구', outsideCard], ['누락', randomUUID()], ['중복', cardA],
  ])('%s 카드는 묶음에 포함할 수 없다', async (_name, invalidCard) => {
    await expect(service.create(userId, { householdId, scopeType: 'card_group', cardIds: [cardA, invalidCard], amount: 100_000 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('일반 구성원은 생성·정정할 수 없다', async () => {
    await expect(service.create(memberUserId, { householdId, scopeType: 'card_group', cardIds: [cardA, cardB], amount: 100_000 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.update(memberUserId, oldBudgetId, { scopeType: 'card_group', cardIds: [cardA, cardB], expectedCardIds: [cardA] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('과거월은 범위만 정정하고 ID·한도·이름·월과 감사 이력을 보존한다', async () => {
    const before = (await service.list(userId, { householdId, month: previousMonth })).items[0];
    const result = await service.update(userId, oldBudgetId, { scopeType: 'card_group', cardIds: [cardB, cardA], expectedCardIds: [cardA] });
    expect(result).toMatchObject({ id: oldBudgetId, amount: 100_000, name: '기존 용돈', effectiveMonth: previousMonth, spent: 6000, scopeType: 'card_group' });
    expect(before?.spent).toBe(2000);
    const history = await db.select().from(schema.budgetScopeCorrections).where(eq(schema.budgetScopeCorrections.budgetId, oldBudgetId));
    expect(history).toHaveLength(1);
    expect(history[0]?.previousCardIds).toEqual([cardA]);
    expect(history[0]?.cardIds).toEqual([cardA, cardB].sort());
  });

  it('과거월 한도·이름 변경과 오래된 범위 비교값은 거절하고 이력을 추가하지 않는다', async () => {
    await expect(service.update(userId, oldBudgetId, { scopeType: 'card_group', cardIds: [cardA, cardB], expectedCardIds: [cardA, cardB], amount: 200_000 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update(userId, oldBudgetId, { name: '덮어쓰기' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update(userId, oldBudgetId, { scopeType: 'card_group', cardIds: [cardA, cardC], expectedCardIds: [cardA] })).rejects.toBeInstanceOf(ConflictException);
    const history = await db.select().from(schema.budgetScopeCorrections).where(eq(schema.budgetScopeCorrections.budgetId, oldBudgetId));
    expect(history).toHaveLength(1);
  });

  it('새달 복사는 범위를 보존하며 같은 멱등 키는 같은 ID를 반환한다', async () => {
    const input = { householdId, sourceMonth: period, targetMonth: addBudgetMonths(period, 1), idempotencyKey: randomUUID() };
    const result = await service.copy(userId, input);
    expect(await service.copy(userId, input)).toEqual(result);
    const next = await service.list(userId, { householdId, month: input.targetMonth });
    expect(next.items[0]).toMatchObject({ scopeType: 'card_group', cardIds: [cardA, cardB].sort(), amount: 100_000, name: '합산 용돈' });
  });

  it('동시 범위 정정은 한 요청만 성공하고 다른 요청은 409로 중단한다', async () => {
    if (!DATABASE_URL) throw new Error('격리 DB가 필요합니다.');
    const concurrentBudgetId = randomUUID();
    await db.insert(schema.budgets).values({ id: concurrentBudgetId, householdId, scopeType: 'card', scopeRefId: cardA, amount: 100_000, effectiveMonth: toEffectiveMonth(addBudgetMonths(period, 3)), createdBy: userId });
    const secondClient = postgres(DATABASE_URL, { max: 1, prepare: false });
    try {
      const secondService = new BudgetService(drizzle(secondClient, { schema }));
      const results = await Promise.allSettled([
        service.update(userId, concurrentBudgetId, { scopeType: 'card_group', cardIds: [cardA, cardB], expectedCardIds: [cardA] }),
        secondService.update(userId, concurrentBudgetId, { scopeType: 'card_group', cardIds: [cardA, cardC], expectedCardIds: [cardA] }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(ConflictException);
      const history = await db.select().from(schema.budgetScopeCorrections).where(eq(schema.budgetScopeCorrections.budgetId, concurrentBudgetId));
      expect(history).toHaveLength(1);
    } finally {
      await secondClient.end();
    }
  });

  it('기존 묶음과 충돌한 정정은 원래 예산과 감사 이력을 함께 롤백한다', async () => {
    const conflictBudgetId = randomUUID();
    await db.insert(schema.budgets).values({ id: conflictBudgetId, householdId, scopeType: 'card', scopeRefId: cardC, amount: 50_000, effectiveMonth: toEffectiveMonth(period), createdBy: userId });
    await expect(service.update(userId, conflictBudgetId, { scopeType: 'card_group', cardIds: [cardA, cardB], expectedCardIds: [cardC] })).rejects.toBeInstanceOf(ConflictException);
    const [unchanged] = await db.select().from(schema.budgets).where(eq(schema.budgets.id, conflictBudgetId));
    expect(unchanged).toMatchObject({ scopeType: 'card', scopeRefId: cardC, amount: 50_000, cardIds: [] });
    expect(await db.select().from(schema.budgetScopeCorrections).where(eq(schema.budgetScopeCorrections.budgetId, conflictBudgetId))).toHaveLength(0);
  });

  it('카드 상태 변경은 과거 집계 범위를 바꾸지 않고 새달 복사는 거절한다', async () => {
    await db.update(schema.paymentCards).set({ isShared: true, status: 'inactive' }).where(eq(schema.paymentCards.id, cardB));
    expect((await service.list(userId, { householdId, month: previousMonth })).items[0]?.spent).toBe(6000);
    await expect(service.copy(userId, { householdId, sourceMonth: addBudgetMonths(period, 1), targetMonth: addBudgetMonths(period, 2), idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(BadRequestException);
    await db.update(schema.paymentCards).set({ isShared: false, status: 'active' }).where(eq(schema.paymentCards.id, cardB));
  });

  it('DB는 정렬되지 않은 배열·중복 카드와 단일 범위의 카드 배열을 거절한다', async () => {
    await expect(db.update(schema.budgets).set({ cardIds: [cardA, cardA] }).where(eq(schema.budgets.id, groupBudgetId))).rejects.toThrow();
    await expect(db.update(schema.budgets).set({ cardIds: [cardA, cardB].sort().reverse() }).where(eq(schema.budgets.id, groupBudgetId))).rejects.toThrow();
    await expect(db.update(schema.budgets).set({ scopeType: 'card', scopeRefId: cardA }).where(eq(schema.budgets.id, groupBudgetId))).rejects.toThrow();
  });
});
