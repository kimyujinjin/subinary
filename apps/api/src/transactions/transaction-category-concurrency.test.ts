import { ConflictException } from '@nestjs/common';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { transactionUpdateRequestSchema } from '@family/contracts';
import { schema } from '@family/database';

import type { MoneyShadowService } from '../money/money-shadow.service';
import type { MoneyWriteService } from '../money/money-write.service';
import type { RealtimePublisherService } from '../realtime/realtime-publisher.service';
import { TransactionService } from './transaction.service';

const TRANSACTION = '00000000-0000-4000-8000-000000000001';
const HOUSEHOLD = '00000000-0000-4000-8000-000000000002';
const MEMBER = '00000000-0000-4000-8000-000000000003';
const USER = '00000000-0000-4000-8000-000000000004';
const CATEGORY = '00000000-0000-4000-8000-000000000005';
const PREVIOUS_CATEGORY = '00000000-0000-4000-8000-000000000006';

interface CapturedQuery {
  sql: string;
  params: unknown[];
}

/** 네트워크 없이 실제 서비스와 Drizzle의 SQL·트랜잭션 분기를 실행한다. */
function setup(updateResult: 'success' | 'conflict' | 'error', initialCategory: string | null = PREVIOUS_CATEGORY) {
  const queries: CapturedQuery[] = [];
  const publish = vi.fn(async () => undefined);
  const transactionState = { commits: 0, rollbacks: 0 };
  const now = '2026-10-20T00:00:00.000Z';
  const row: Record<string, unknown> = {
    id: TRANSACTION, householdId: HOUSEHOLD, memberId: MEMBER, cardId: null,
    sourceEventId: TRANSACTION, transactionType: 'approval', status: 'approved',
    amount: 1000, cancelledAmount: 0, netAmount: 1000, currency: 'KRW',
    originalAmount: null, originalCurrency: null, exchangeRate: null,
    originalCancelledAmount: null, fxRateSnapshotId: null, moneyContractVersion: 1,
    merchantRaw: '검증 가맹점', merchantNormalized: '검증 가맹점', categoryId: initialCategory,
    approvedAt: now, cancelledAt: null, authorizationCode: null, installmentMonths: null,
    parentTransactionId: null, visibility: 'household', memo: null, excludedAt: null,
    createdAt: now, updatedAt: now,
  };
  const failure = new Error('검증용 DB 갱신 실패');

  function execute(query: string): unknown[][] {
    if (query.startsWith('update "card_transactions"')) {
      if (updateResult === 'error') throw failure;
      if (updateResult === 'conflict') return [];
      row.categoryId = CATEGORY;
      return [[TRANSACTION]];
    }
    if (query.startsWith('insert into ')) return [];
    if (query.includes('from "household_members"')) return [[MEMBER, 'owner']];
    if (query.includes('from "expense_categories"')) return [[CATEGORY, null]];
    if (query.includes('from "merchant_category_rules"')) return [];
    if (query.includes('from "card_transactions"')) {
      const values = Object.keys(getTableColumns(schema.cardTransactions)).map(key => row[key]);
      return [query.includes('left join') ? [...values, 'food'] : values];
    }
    throw new Error('예상하지 않은 검증용 SQL입니다.');
  }

  const driver = {
    options: { parsers: {}, serializers: {} },
    unsafe(query: string, params: unknown[]) {
      queries.push({ sql: query, params });
      const response = Promise.resolve().then(() => execute(query));
      return Object.assign(response, { values: () => response });
    },
    async begin<T>(run: (client: unknown) => Promise<T>): Promise<T> {
      try {
        const result = await run(driver);
        transactionState.commits += 1;
        return result;
      } catch (error) {
        transactionState.rollbacks += 1;
        throw error;
      }
    },
  };
  const service = new TransactionService(
    drizzle(driver as unknown as postgres.Sql, { schema }),
    { publish } as unknown as RealtimePublisherService,
    { observe: vi.fn() } as unknown as MoneyShadowService,
    { enforced: false } as unknown as MoneyWriteService,
  );
  return { service, queries, publish, transactionState, failure };
}

describe('거래 분류 변경의 원자적 비교', () => {
  it('직전 분류를 WHERE에서 비교하고 성공한 변경만 규칙과 라벨로 기록한다', async () => {
    const { service, queries, transactionState, publish } = setup('success');
    const result = await service.update(USER, TRANSACTION, {
      categoryId: CATEGORY, expectedCategoryId: PREVIOUS_CATEGORY, applyRule: true,
    });
    expect(result.categoryId).toBe(CATEGORY);
    const update = queries.find(query => query.sql.startsWith('update "card_transactions"'));
    expect(update?.sql).toMatch(/where \("card_transactions"\."id" = \$\d+ and "card_transactions"\."category_id" = \$\d+\) returning "id"/);
    expect(update?.params.slice(-2)).toEqual([TRANSACTION, PREVIOUS_CATEGORY]);
    expect(queries.filter(query => query.sql.startsWith('insert into "feedback_events"'))).toHaveLength(2);
    expect(queries.filter(query => query.sql.startsWith('insert into "merchant_category_rules"'))).toHaveLength(1);
    expect(transactionState).toEqual({ commits: 1, rollbacks: 0 });
    expect(publish).toHaveBeenCalledWith(HOUSEHOLD);
  });

  it('미분류 기대값은 SQL NULL 비교로 처리한다', async () => {
    const { service, queries } = setup('success', null);
    await service.update(USER, TRANSACTION, { categoryId: CATEGORY, expectedCategoryId: null });
    const update = queries.find(query => query.sql.startsWith('update "card_transactions"'));
    expect(update?.sql).toContain('and "card_transactions"."category_id" is null');
    expect(update?.params.at(-1)).toBe(TRANSACTION);
  });

  it.each([PREVIOUS_CATEGORY, null])('조회 이후 분류가 달라지면 409이며 규칙·라벨·알림을 남기지 않는다 (%s)', async (expectedCategoryId) => {
    const { service, queries, transactionState, publish } = setup('conflict', expectedCategoryId);
    await expect(service.update(USER, TRANSACTION, {
      categoryId: CATEGORY, expectedCategoryId, applyRule: true,
    })).rejects.toBeInstanceOf(ConflictException);
    expect(queries.some(query => query.sql.startsWith('insert into '))).toBe(false);
    expect(transactionState).toEqual({ commits: 0, rollbacks: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it('기대값을 생략한 기존 UI 요청은 분류 비교 조건 없이 동작한다', async () => {
    const input = transactionUpdateRequestSchema.parse({ categoryId: CATEGORY });
    const { service, queries } = setup('success');
    await service.update(USER, TRANSACTION, input);
    const update = queries.find(query => query.sql.startsWith('update "card_transactions"'));
    expect(update?.sql.split(' where ')[1]).toMatch(/^"card_transactions"\."id" = \$\d+ returning "id"$/);
    expect(input.expectedCategoryId).toBeUndefined();
    expect(transactionUpdateRequestSchema.parse({ categoryId: CATEGORY, expectedCategoryId: null }).expectedCategoryId).toBeNull();
    expect(transactionUpdateRequestSchema.safeParse({ expectedCategoryId: '잘못된 ID' }).success).toBe(false);
  });

  it('DB 갱신 실패를 성공으로 처리하거나 규칙·라벨 쓰기로 진행하지 않는다', async () => {
    const { service, queries, transactionState, publish, failure } = setup('error');
    await expect(service.update(USER, TRANSACTION, {
      categoryId: CATEGORY, expectedCategoryId: PREVIOUS_CATEGORY, applyRule: true,
    })).rejects.toMatchObject({ cause: failure });
    expect(queries.some(query => query.sql.startsWith('insert into '))).toBe(false);
    expect(transactionState).toEqual({ commits: 0, rollbacks: 1 });
    expect(publish).not.toHaveBeenCalled();
  });
});
