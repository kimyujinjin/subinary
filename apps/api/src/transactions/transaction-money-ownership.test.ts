/**
 * Actual API service methods with synthetic command/transaction ports. Domain
 * arithmetic and PostgreSQL locking have their own tests; these cases protect
 * ownership dispatch, authorization, masking, metadata CAS and side effects.
 */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { schema } from '@family/database';
import type { HouseholdRole } from '@family/contracts';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { TransactionService } from './transaction.service';

const USER = '00000000-0000-4000-8000-000000000001';
const HOUSEHOLD = '00000000-0000-4000-8000-000000000002';
const MEMBER = '00000000-0000-4000-8000-000000000003';
const OTHER_MEMBER = '00000000-0000-4000-8000-000000000004';
const TRANSACTION = '00000000-0000-4000-8000-000000000005';
const APPROVAL = '00000000-0000-4000-8000-000000000006';
const CATEGORY = '00000000-0000-4000-8000-000000000007';
const NOW = new Date('2026-10-30T00:00:00Z');
type Outcome = { ok: true; value: Record<string, unknown> } | { ok: false; reason: string };

function transaction(overrides: Partial<schema.CardTransaction> = {}): schema.CardTransaction {
  return {
    id: TRANSACTION, householdId: HOUSEHOLD, memberId: MEMBER, cardId: null,
    sourceEventId: '00000000-0000-4000-8000-000000000008',
    transactionType: 'approval', status: 'pending_review', amount: 10_000,
    cancelledAmount: 0, netAmount: 10_000, currency: 'KRW',
    originalAmount: null, originalCurrency: null, exchangeRate: null,
    originalCancelledAmount: null, fxRateSnapshotId: null, moneyContractVersion: 2,
    merchantRaw: 'synthetic merchant', merchantNormalized: 'synthetic merchant',
    categoryId: null, approvedAt: NOW, cancelledAt: null, authorizationCode: null,
    installmentMonths: null, parentTransactionId: null, visibility: 'private',
    memo: 'synthetic memo', excludedAt: null, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}

function setup(options: {
  enforced?: boolean;
  row?: Partial<schema.CardTransaction>;
  approval?: Partial<schema.CardTransaction>;
  role?: HouseholdRole;
  casConflict?: boolean;
} = {}) {
  const state = {
    row: transaction(options.row),
    approval: transaction({ id: APPROVAL, status: 'approved', ...options.approval }),
    commits: 0, rollbacks: 0, moneyApplied: false, deleted: false,
    metadataSets: [] as Array<Record<string, unknown>>,
    metadataWhere: null as SQL | null,
    inserts: [] as Array<{ table: unknown; value: Record<string, unknown> }>,
    upserts: [] as Array<Record<string, unknown>>,
    approvalLocks: [] as string[],
  };

  const commands = () => ({
    amendApproval: vi.fn(async (input: Record<string, unknown>, _options?: unknown): Promise<Outcome> => {
      state.moneyApplied = true;
      if (typeof input.minorUnits === 'number') {
        state.row.amount = input.minorUnits;
        state.row.netAmount = input.minorUnits;
      }
      return { ok: true, value: { approvalId: TRANSACTION } };
    }),
    amendTransaction: vi.fn(async (input: Record<string, unknown>, _options?: unknown): Promise<Outcome> => {
      state.moneyApplied = true;
      if (typeof input.amount === 'number') {
        state.row.amount = input.amount;
        state.row.netAmount = input.amount;
      }
      return { ok: true, value: { transactionId: TRANSACTION } };
    }),
    linkCancellation: vi.fn(async (_input: Record<string, unknown>, _options?: unknown): Promise<Outcome> =>
      ({ ok: true, value: { approvalId: APPROVAL } })),
    setReviewFlag: vi.fn(async (input: Record<string, unknown>, _options?: unknown): Promise<Outcome> => {
      state.row.status = input.flag === null ? 'approved' : 'duplicate_suspected';
      return { ok: true, value: { transactionId: TRANSACTION } };
    }),
    removeTransaction: vi.fn(async (_input: Record<string, unknown>, _options?: unknown): Promise<Outcome> => {
      state.deleted = true;
      return { ok: true, value: { deleted: true } };
    }),
  });
  const v2 = commands();
  const legacy = commands();
  const tx = {
    select: () => {
      let table: unknown;
      const query = {
        from(value: unknown) { table = value; return query; },
        where(_value: SQL) { return query; },
        for(mode: string) { state.approvalLocks.push(mode); return query; },
        limit: async (_count: number) => table === schema.cardTransactions ? [state.approval] : [],
      };
      return query;
    },
    update: (table: unknown) => {
      expect(table).toBe(schema.cardTransactions);
      const query = {
        set(value: Record<string, unknown>) { state.metadataSets.push(value); return query; },
        where(value: SQL) { state.metadataWhere = value; return query; },
        returning: async (_fields: unknown) => {
          if (options.casConflict) return [];
          const values = state.metadataSets[state.metadataSets.length - 1];
          Object.assign(state.row, Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)));
          return [{ id: TRANSACTION }];
        },
      };
      return query;
    },
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown>) => {
        state.inserts.push({ table, value });
        return Object.assign(Promise.resolve([]), {
          onConflictDoUpdate: (input: Record<string, unknown>) => {
            state.upserts.push(input);
            return Promise.resolve([]);
          },
        });
      },
    }),
  };
  const db = {
    transaction: vi.fn(async (callback: (executor: typeof tx) => Promise<unknown>) => {
      const before = { row: { ...state.row }, moneyApplied: state.moneyApplied };
      try {
        const result = await callback(tx);
        state.commits += 1;
        return result;
      } catch (error) {
        state.row = before.row;
        state.moneyApplied = before.moneyApplied;
        state.rollbacks += 1;
        throw error;
      }
    }),
    update: () => { throw new Error('API must not perform a direct money mutation'); },
    delete: () => { throw new Error('API must not perform a direct deletion'); },
  };
  const realtime = { publish: vi.fn(async (_household: string) => undefined) };
  const shadow = { observe: vi.fn(async (_id: string, _path: string) => undefined) };
  const loadTransaction = vi.fn(async (_id: string) => ({ ...state.row }));
  const membership = vi.fn(async (_household: string, _user: string) =>
    ({ memberId: MEMBER, role: options.role ?? 'owner' as HouseholdRole }));
  const loadSummaryRow = vi.fn(async (id: string) =>
    ({ txn: id === APPROVAL ? state.approval : state.row, categorySlug: null }));
  const service = Object.assign(Object.create(TransactionService.prototype), {
    db, realtimePublisher: realtime, moneyShadow: shadow,
    moneyWrite: { enforced: options.enforced ?? true, commands: v2, legacy },
    loadTransaction, requireMembership: membership, loadSummaryRow,
    assertCategoryUsable: vi.fn(async () => undefined),
    assertMemberInHousehold: vi.fn(async () => undefined),
    loadCard: vi.fn(async (id: string) => ({ id, visibility: 'summary_only' })),
  }) as TransactionService;
  return { service, state, db, tx, v2, legacy, realtime, shadow, membership, loadSummaryRow };
}

describe('transaction API money ownership', () => {
  it('v2 amount amendment and metadata CAS share one transaction', async () => {
    const h = setup();
    const response = await h.service.update(USER, TRANSACTION, {
      amount: 20_000, memo: 'updated synthetic memo', expectedCategoryId: null,
    });

    expect(h.v2.amendApproval).toHaveBeenCalledWith({ approvalId: TRANSACTION, minorUnits: 20_000 }, { tx: h.tx });
    expect(h.legacy.amendTransaction).not.toHaveBeenCalled();
    expect(h.state.moneyApplied).toBe(true);
    expect(response.amount).toBe(20_000);
    expect(response.memo).toBe('updated synthetic memo');
    expect(h.state.metadataSets).toHaveLength(1);
    expect(Object.keys(h.state.metadataSets[0]).sort()).toEqual([
      'cardId', 'categoryId', 'memberId', 'memo', 'merchantNormalized', 'updatedAt', 'visibility',
    ]);
    expect(new PgDialect().sqlToQuery(h.state.metadataWhere!).sql).toContain('"category_id" is null');
    expect(h.realtime.publish).toHaveBeenCalledWith(HOUSEHOLD);
    expect(h.shadow.observe).toHaveBeenCalledWith(TRANSACTION, 'api_transaction_update');
  });

  it('legacy amount and date use the legacy command without leaking money into metadata', async () => {
    const h = setup({ enforced: false, row: { moneyContractVersion: 1 } });
    const occurredAt = '2026-10-22T02:00:00Z';
    await h.service.update(USER, TRANSACTION, { amount: 12_000, occurredAt });

    expect(h.legacy.amendTransaction).toHaveBeenCalledWith({
      transactionId: TRANSACTION, amount: 12_000, occurredAt: new Date(occurredAt),
    }, { tx: h.tx });
    expect(h.v2.amendApproval).not.toHaveBeenCalled();
    for (const field of ['amount', 'netAmount', 'approvedAt', 'cancelledAt', 'status']) {
      expect(h.state.metadataSets[0]).not.toHaveProperty(field);
    }
    expect(h.state.commits).toBe(1);
  });

  it('category-only edits keep the CAS, human labels and rule upsert without a money command', async () => {
    const h = setup({ enforced: false });
    await h.service.update(USER, TRANSACTION, { categoryId: CATEGORY, expectedCategoryId: CATEGORY, applyRule: true });

    expect(h.v2.amendApproval).not.toHaveBeenCalled();
    expect(h.legacy.amendTransaction).not.toHaveBeenCalled();
    const predicate = new PgDialect().sqlToQuery(h.state.metadataWhere!);
    expect(predicate.sql).toContain('"category_id" =');
    expect(predicate.params).toContain(CATEGORY);
    const labels = h.state.inserts.filter((entry) => entry.table === schema.feedbackEvents);
    expect(labels.map((entry) => entry.value.targetType)).toEqual(['transaction-category', 'merchant-category']);
    expect(labels.every((entry) => entry.value.source === 'human_confirmed')).toBe(true);
    expect(h.state.upserts).toHaveLength(1);
    expect(h.realtime.publish).toHaveBeenCalledTimes(1);
    expect(h.shadow.observe).not.toHaveBeenCalled();
  });

  it.each([true, false])('a category CAS conflict rolls back the %s mode money amendment and stops labels/realtime', async (enforced) => {
    const h = setup({ enforced, casConflict: true, row: { moneyContractVersion: enforced ? 2 : 1 } });
    await expect(h.service.update(USER, TRANSACTION, { amount: 20_000, categoryId: CATEGORY, expectedCategoryId: null }))
      .rejects.toBeInstanceOf(ConflictException);

    expect(h.state.row.amount).toBe(10_000);
    expect(h.state.moneyApplied).toBe(false);
    expect(h.state.rollbacks).toBe(1);
    expect(h.state.inserts).toEqual([]);
    expect(h.realtime.publish).not.toHaveBeenCalled();
    expect(h.shadow.observe).not.toHaveBeenCalled();
  });

  it('keeps foreign v2 amount-edit rejection before either owner is invoked', async () => {
    const h = setup({ row: { originalCurrency: 'USD', originalAmount: 1000 } });
    await expect(h.service.update(USER, TRANSACTION, { amount: 20_000 })).rejects.toBeInstanceOf(BadRequestException);
    expect(h.v2.amendApproval).not.toHaveBeenCalled();
    expect(h.legacy.amendTransaction).not.toHaveBeenCalled();
    expect(h.db.transaction).not.toHaveBeenCalled();
  });

  it.each([true, false])('cannot link a private approval owned by another member in enforced=%s', async (enforced) => {
    const h = setup({ enforced, row: { transactionType: 'cancellation', netAmount: 0 },
      approval: { memberId: OTHER_MEMBER, visibility: 'private' } });
    await expect(h.service.linkCancellation(USER, TRANSACTION, { approvalTransactionId: APPROVAL }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(h.v2.linkCancellation).not.toHaveBeenCalled();
    expect(h.legacy.linkCancellation).not.toHaveBeenCalled();
    expect(h.realtime.publish).not.toHaveBeenCalled();
  });

  it.each([true, false])('links with the selected domain owner and preserves summary-only masking in enforced=%s', async (enforced) => {
    const h = setup({ enforced, row: { transactionType: 'cancellation', netAmount: 0 },
      approval: { memberId: OTHER_MEMBER, visibility: 'summary_only' } });
    const response = await h.service.linkCancellation(USER, TRANSACTION, { approvalTransactionId: APPROVAL });

    if (enforced) {
      expect(h.v2.linkCancellation).toHaveBeenCalledWith({ cancellationId: TRANSACTION, approvalId: APPROVAL }, { tx: h.tx });
      expect(h.legacy.linkCancellation).not.toHaveBeenCalled();
      expect(h.state.approvalLocks).toEqual([]);
    } else {
      expect(h.legacy.linkCancellation).toHaveBeenCalledWith({
        cancellationId: TRANSACTION, approvalId: APPROVAL, householdId: HOUSEHOLD,
      }, { tx: h.tx });
      expect(h.v2.linkCancellation).not.toHaveBeenCalled();
      expect(h.state.approvalLocks).toEqual(['update']);
    }
    expect(response).toMatchObject({ masked: true, merchantRaw: null, merchantNormalized: null, memo: null });
    expect(h.realtime.publish).toHaveBeenCalledWith(HOUSEHOLD);
    expect(h.shadow.observe).toHaveBeenCalledWith(TRANSACTION, 'api_link_cancellation');
  });

  it('preserves legacy household/type/currency validation before delegating', async () => {
    for (const approval of [
      { householdId: OTHER_MEMBER },
      { transactionType: 'cancellation' as const },
      { currency: 'USD' },
    ]) {
      const h = setup({ enforced: false, row: { transactionType: 'cancellation' }, approval });
      await expect(h.service.linkCancellation(USER, TRANSACTION, { approvalTransactionId: APPROVAL }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(h.legacy.linkCancellation).not.toHaveBeenCalled();
    }
  });

  it('retains the already-linked cancellation precondition', async () => {
    const h = setup({ row: { transactionType: 'cancellation', parentTransactionId: APPROVAL } });
    await expect(h.service.linkCancellation(USER, TRANSACTION, { approvalTransactionId: APPROVAL }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(h.db.transaction).not.toHaveBeenCalled();
    expect(h.v2.linkCancellation).not.toHaveBeenCalled();
  });

  it.each([true, false])('a rejected link rolls back before success side effects in enforced=%s', async (enforced) => {
    const h = setup({ enforced, row: { transactionType: 'cancellation', netAmount: 0 } });
    const owner = enforced ? h.v2 : h.legacy;
    owner.linkCancellation.mockResolvedValueOnce({ ok: false, reason: 'cancellation_exceeds_approval' });
    await expect(h.service.linkCancellation(USER, TRANSACTION, { approvalTransactionId: APPROVAL }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(h.state.rollbacks).toBe(1);
    expect(h.state.commits).toBe(0);
    expect(h.realtime.publish).not.toHaveBeenCalled();
    expect(h.shadow.observe).not.toHaveBeenCalled();
  });

  it.each([true, false])('keeps row v2 review/delete with v2 commands despite runtime enforced=%s', async (enforced) => {
    const h = setup({ enforced });
    await h.service.markDuplicate(USER, TRANSACTION);
    await h.service.markValid(USER, TRANSACTION);
    await h.service.remove(USER, TRANSACTION);

    expect(h.v2.setReviewFlag.mock.calls.map(([input]) => input)).toEqual([
      { transactionId: TRANSACTION, flag: 'duplicate_suspected' }, { transactionId: TRANSACTION, flag: null },
    ]);
    expect(h.v2.removeTransaction).toHaveBeenCalledWith({ transactionId: TRANSACTION });
    expect(h.legacy.setReviewFlag).not.toHaveBeenCalled();
    expect(h.legacy.removeTransaction).not.toHaveBeenCalled();
    expect(h.state.deleted).toBe(true);
  });

  it.each([true, false])('keeps row v1 review/delete with legacy commands in runtime enforced=%s', async (enforced) => {
    const h = setup({ enforced, row: { moneyContractVersion: 1 } });
    await h.service.markDuplicate(USER, TRANSACTION);
    await h.service.markValid(USER, TRANSACTION);
    expect(await h.service.remove(USER, TRANSACTION)).toEqual({ deleted: true });
    expect(h.legacy.setReviewFlag).toHaveBeenCalledTimes(2);
    expect(h.legacy.removeTransaction).toHaveBeenCalledWith({ transactionId: TRANSACTION });
    expect(h.v2.setReviewFlag).not.toHaveBeenCalled();
    expect(h.v2.removeTransaction).not.toHaveBeenCalled();
  });

  it.each(['markDuplicate', 'markValid', 'remove'] as const)('rejects unknown contract versions before %s mutation', async (method) => {
    const h = setup({ row: { moneyContractVersion: 3 } });
    await expect(h.service[method](USER, TRANSACTION)).rejects.toBeInstanceOf(ConflictException);
    expect(h.v2.setReviewFlag).not.toHaveBeenCalled();
    expect(h.legacy.setReviewFlag).not.toHaveBeenCalled();
    expect(h.v2.removeTransaction).not.toHaveBeenCalled();
    expect(h.legacy.removeTransaction).not.toHaveBeenCalled();
    expect(h.realtime.publish).not.toHaveBeenCalled();
  });

  it('preserves the pending-review prerequisite for markValid', async () => {
    const h = setup({ row: { status: 'approved' } });
    await expect(h.service.markValid(USER, TRANSACTION)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.v2.setReviewFlag).not.toHaveBeenCalled();
    expect(h.legacy.setReviewFlag).not.toHaveBeenCalled();
  });

  it('propagates a domain review-state conflict discovered after its lock', async () => {
    const h = setup();
    h.v2.setReviewFlag.mockResolvedValueOnce({ ok: false, reason: 'transaction_not_pending_review' });
    await expect(h.service.markValid(USER, TRANSACTION)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.realtime.publish).not.toHaveBeenCalled();
  });

  it('keeps summary-only review responses masked for other members', async () => {
    const h = setup({ row: { memberId: OTHER_MEMBER, visibility: 'summary_only' } });
    const response = await h.service.markDuplicate(USER, TRANSACTION);
    expect(response).toMatchObject({ masked: true, merchantRaw: null, merchantNormalized: null, memo: null });
    expect(h.realtime.publish).toHaveBeenCalledWith(HOUSEHOLD);
  });

  it.each(['markDuplicate', 'markValid', 'remove'] as const)('preserves actor ownership checks before %s', async (method) => {
    const h = setup({ role: 'member', row: { memberId: OTHER_MEMBER } });
    await expect(h.service[method](USER, TRANSACTION)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.v2.setReviewFlag).not.toHaveBeenCalled();
    expect(h.legacy.setReviewFlag).not.toHaveBeenCalled();
    expect(h.v2.removeTransaction).not.toHaveBeenCalled();
    expect(h.legacy.removeTransaction).not.toHaveBeenCalled();
    expect(h.realtime.publish).not.toHaveBeenCalled();
  });

  it('preserves membership rejection before a domain command', async () => {
    const h = setup();
    h.membership.mockRejectedValueOnce(new ForbiddenException());
    await expect(h.service.remove(USER, TRANSACTION)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.v2.removeTransaction).not.toHaveBeenCalled();
  });

  it('propagates deletion conflicts and emits no realtime success', async () => {
    const h = setup();
    h.v2.removeTransaction.mockResolvedValueOnce({ ok: false, reason: 'transaction_has_cancellations' });
    await expect(h.service.remove(USER, TRANSACTION)).rejects.toBeInstanceOf(ConflictException);
    expect(h.realtime.publish).not.toHaveBeenCalled();
    expect(h.state.deleted).toBe(false);
  });

  it('keeps deletion idempotent when the domain reports a concurrent prior removal', async () => {
    const h = setup();
    h.v2.removeTransaction.mockResolvedValueOnce({ ok: true, value: { deleted: false } });
    expect(await h.service.remove(USER, TRANSACTION)).toEqual({ deleted: true });
    expect(h.realtime.publish).toHaveBeenCalledWith(HOUSEHOLD);
  });

  it('propagates a legacy version guard when a rollback-mode edit encounters a v2 row', async () => {
    const h = setup({ enforced: false });
    h.legacy.amendTransaction.mockResolvedValueOnce({ ok: false, reason: 'money_contract_version_mismatch' });
    await expect(h.service.update(USER, TRANSACTION, { amount: 20_000 })).rejects.toBeInstanceOf(ConflictException);
    expect(h.state.metadataSets).toEqual([]);
    expect(h.realtime.publish).not.toHaveBeenCalled();
  });
});
