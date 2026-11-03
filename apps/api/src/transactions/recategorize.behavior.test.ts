import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import type { RecategorizeRequest } from '@family/contracts';
import { schema } from '@family/database';

import { RecategorizeService } from './recategorize.service';

const HOUSEHOLD = '00000000-0000-4000-8000-000000000001';
const MEMBER = '00000000-0000-4000-8000-000000000002';
const USER = '00000000-0000-4000-8000-000000000003';
const OTHER_USER = '00000000-0000-4000-8000-000000000004';
const CATEGORY = '00000000-0000-4000-8000-000000000005';
const PREVIOUS_CATEGORY = '00000000-0000-4000-8000-000000000006';
const LATER_CATEGORY = '00000000-0000-4000-8000-000000000007';
const BATCH = '00000000-0000-4000-8000-000000000008';
const MERCHANT = '합성상호';
const NOW = '2026-10-28T00:00:00.000Z';

interface CapturedQuery {
  sql: string;
  params: unknown[];
}

interface FixtureTransaction {
  id: string;
  categoryId: string | null;
  merchant: string;
}

interface AuditItem {
  transactionId: string;
  previousCategoryId: string | null;
}

interface FixtureOptions {
  transactions?: FixtureTransaction[];
  role?: 'owner' | 'member' | null;
  updateFailure?: boolean;
  batchAppliedBy?: string;
  revertItems?: AuditItem[];
}

/** 운영 식별자를 사용하지 않는 합성 거래다. */
function transaction(index: number, categoryId: string | null, merchant = MERCHANT): FixtureTransaction {
  return { id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`, categoryId, merchant };
}

/** 기본 요청은 실제 변경이 필요한 분류·미분류 거래 두 건을 승인한다. */
function request(expectedCount = 2): RecategorizeRequest {
  return { householdId: HOUSEHOLD, merchant: MERCHANT, categoryId: CATEGORY, expectedCount };
}

/** 네트워크 없이 실제 서비스와 Drizzle을 실행하고 트랜잭션의 성공·실패 분기를 관찰한다. */
function setup(options: FixtureOptions = {}) {
  const queries: CapturedQuery[] = [];
  const rows = (options.transactions ?? [transaction(1, PREVIOUS_CATEGORY), transaction(2, null),
    transaction(3, CATEGORY), transaction(4, PREVIOUS_CATEGORY, '다른 가맹점')]).map((row) => ({ ...row }));
  const transactionState = { commits: 0, rollbacks: 0 };
  const failure = new Error('검증용 소급 분류 갱신 실패');
  const batch: Record<string, unknown> = {
    id: BATCH, householdId: HOUSEHOLD, merchantCanonical: MERCHANT, toCategoryId: CATEGORY,
    appliedCount: options.revertItems?.length ?? 2, appliedBy: options.batchAppliedBy ?? USER,
    appliedAt: NOW, revertedAt: null, revertedBy: null, revertedCount: null,
  };

  function execute(query: string, params: unknown[]): unknown[][] {
    // 소급 적용·되돌리기는 미래 규칙이나 학습 계보를 읽을 필요도 없다.
    if (/"(?:merchant_category_rules|feedback_events|dataset_[^"]*|model_aliases|training_[^"]*)"/.test(query)) {
      throw new Error('소급 분류에서 미래 규칙·학습 계보에 접근했습니다.');
    }
    if (query.startsWith('update "card_transactions"')) {
      if (options.updateFailure) throw failure;
      const nextCategory = params[0] as string | null;
      if (query.includes(' returning ')) {
        const target = rows.find((row) => row.id === params.at(-2));
        if (!target || target.categoryId !== params.at(-1)) return [];
        target.categoryId = nextCategory;
        return [[target.id]];
      }
      for (const row of rows) if (params.slice(2).includes(row.id)) row.categoryId = nextCategory;
      return [];
    }
    if (query.startsWith('insert into "category_recategorize_batches"')) return [[BATCH]];
    if (query.startsWith('insert into "category_recategorize_items"')) return [];
    if (query.startsWith('update "category_recategorize_batches"')) return [];
    if (query.includes('from "household_members"')) return options.role === null ? [] : [[MEMBER, options.role ?? 'owner']];
    if (query.includes('from "expense_categories"')) return [[CATEGORY, '식비', false, null]];
    if (query.includes('from "merchant_aliases"')) return [];
    if (query.includes('from "card_transactions"')) {
      return rows.map((row) => [row.id, row.categoryId, 1000, NOW, NOW, row.merchant, row.merchant]);
    }
    if (query.includes('from "category_recategorize_batches"')) {
      return [Object.keys(getTableColumns(schema.categoryRecategorizeBatches)).map((key) => batch[key])];
    }
    if (query.includes('from "category_recategorize_items"')) {
      return (options.revertItems ?? []).map((item) => [item.transactionId, item.previousCategoryId]);
    }
    throw new Error('예상하지 않은 검증용 SQL입니다.');
  }

  const driver = {
    options: { parsers: {}, serializers: {} },
    unsafe(query: string, params: unknown[]) {
      queries.push({ sql: query, params });
      const response = Promise.resolve().then(() => execute(query, params));
      return Object.assign(response, { values: () => response });
    },
    async begin<T>(run: (client: unknown) => Promise<T>): Promise<T> {
      try {
        const result = await run(driver);
        transactionState.commits += 1;
        return result;
      } catch (error: unknown) {
        transactionState.rollbacks += 1;
        throw error;
      }
    },
  };
  const service = new RecategorizeService(drizzle(driver as unknown as postgres.Sql, { schema }));
  return { service, queries, rows, transactionState, failure };
}

/** 미래 규칙과 학습 테이블의 조회·쓰기가 모두 없음을 확인한다. */
function expectNoFutureRuleAccess(queries: CapturedQuery[]): void {
  for (const query of queries) {
    expect(query.sql).not.toMatch(/"(?:merchant_category_rules|feedback_events|dataset_[^"]*|model_aliases|training_[^"]*)"/);
  }
}

/** 사전 거절은 거래·감사 기록 쓰기와 트랜잭션 시작까지 막아야 한다. */
function expectNoWrites(queries: CapturedQuery[]): void {
  expect(queries.some((query) => /^(?:insert into|update|delete from) /.test(query.sql))).toBe(false);
}

describe('소급 재분류는 과거 거래와 배치 감사만 변경한다', () => {
  it('이미 목표 분류인 거래를 제외하고 행별 이전 분류와 NULL을 보존한다', async () => {
    const { service, queries, rows, transactionState } = setup();
    expect(await service.apply(USER, request())).toEqual({ batchId: BATCH, appliedCount: 2 });
    expect(rows.map((row) => row.categoryId)).toEqual([CATEGORY, CATEGORY, CATEGORY, PREVIOUS_CATEGORY]);

    const batchInsert = queries.find((query) => query.sql.startsWith('insert into "category_recategorize_batches"'));
    expect(batchInsert?.params.slice(0, 5)).toEqual([HOUSEHOLD, MERCHANT, CATEGORY, 2, USER]);
    const itemsInsert = queries.find((query) => query.sql.startsWith('insert into "category_recategorize_items"'));
    expect(itemsInsert?.params).toEqual([BATCH, transaction(1, null).id, PREVIOUS_CATEGORY, BATCH, transaction(2, null).id, null]);
    const update = queries.find((query) => query.sql.startsWith('update "card_transactions"'));
    expect(update?.params.slice(2)).toEqual([transaction(1, null).id, transaction(2, null).id]);
    expect(queries.filter((query) => /^(?:insert into|update|delete from) /.test(query.sql))).toHaveLength(3);
    expectNoFutureRuleAccess(queries);
    expect(transactionState).toEqual({ commits: 1, rollbacks: 0 });
  });

  it('사용자가 확인한 건수와 달라지면 감사 기록도 쓰지 않는다', async () => {
    const { service, queries, transactionState } = setup();
    await expect(service.apply(USER, request(3))).rejects.toBeInstanceOf(ConflictException);
    expectNoWrites(queries);
    expect(transactionState).toEqual({ commits: 0, rollbacks: 0 });
  });

  it('이미 목표 분류뿐인 0건 적용은 거부한다', async () => {
    const { service, queries } = setup({ transactions: [transaction(1, CATEGORY)] });
    await expect(service.apply(USER, request(0))).rejects.toBeInstanceOf(BadRequestException);
    expectNoWrites(queries);
  });

  it('한 번에 500건을 넘는 적용은 거부한다', async () => {
    const { service, queries } = setup({ transactions: Array.from({ length: 501 }, (_, index) => transaction(index, null)) });
    await expect(service.apply(USER, request(501))).rejects.toBeInstanceOf(BadRequestException);
    expectNoWrites(queries);
  });

  it('가구 구성원이 아니면 거래·분류·감사 정보를 조회하지 않는다', async () => {
    const { service, queries } = setup({ role: null });
    await expect(service.apply(USER, request())).rejects.toBeInstanceOf(ForbiddenException);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toContain('from "household_members"');
    expectNoWrites(queries);
  });

  it('거래 갱신 실패를 성공 응답으로 만들지 않고 감사 트랜잭션을 실패시킨다', async () => {
    const { service, queries, transactionState, failure } = setup({ updateFailure: true });
    await expect(service.apply(USER, request())).rejects.toMatchObject({ cause: failure });
    expect(transactionState).toEqual({ commits: 0, rollbacks: 1 });
    expect(queries.at(-1)?.sql).toMatch(/^update "card_transactions"/);
    expectNoFutureRuleAccess(queries);
  });
});

describe('소급 분류 되돌리기는 현재 분류와 이전 NULL을 보존한다', () => {
  it('이후 수정된 거래는 건너뛰고 나머지만 원복하며 미래 규칙에 접근하지 않는다', async () => {
    const rows = [transaction(1, CATEGORY), transaction(2, CATEGORY), transaction(3, LATER_CATEGORY)];
    const { service, queries, rows: actual, transactionState } = setup({ transactions: rows,
      revertItems: rows.map((row, index) => ({ transactionId: row.id, previousCategoryId: index === 1 ? null : PREVIOUS_CATEGORY })) });

    expect(await service.revert(USER, BATCH)).toEqual({ batchId: BATCH, revertedCount: 2, skippedCount: 1 });
    expect(actual.map((row) => row.categoryId)).toEqual([PREVIOUS_CATEGORY, null, LATER_CATEGORY]);
    const updates = queries.filter((query) => query.sql.startsWith('update "card_transactions"'));
    expect(updates).toHaveLength(3);
    for (const update of updates) {
      expect(update.sql).toMatch(/and "card_transactions"\."category_id" = \$\d+\) returning "id"/);
      expect(update.params.at(-1)).toBe(CATEGORY);
    }
    const auditUpdate = queries.find((query) => query.sql.startsWith('update "category_recategorize_batches"'));
    expect(auditUpdate?.params.slice(1)).toEqual([USER, 2, BATCH]);
    expectNoFutureRuleAccess(queries);
    expect(transactionState).toEqual({ commits: 1, rollbacks: 0 });
  });

  it('일반 구성원이 다른 사용자의 배치를 되돌리는 요청은 거부한다', async () => {
    const { service, queries, transactionState } = setup({ role: 'member', batchAppliedBy: OTHER_USER });
    await expect(service.revert(USER, BATCH)).rejects.toBeInstanceOf(ForbiddenException);
    expect(queries.some((query) => query.sql.includes('from "category_recategorize_items"'))).toBe(false);
    expectNoWrites(queries);
    expect(transactionState).toEqual({ commits: 0, rollbacks: 0 });
  });
});
