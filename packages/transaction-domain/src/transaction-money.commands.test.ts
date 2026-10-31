import { describe, expect, it, vi } from 'vitest';
import { schema, type Db, type DbExecutor } from '@family/database';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { planChain, type FxSnapshotRef } from './plan.js';
import { TransactionMoneyService, type MoneyRow, type TransactionMetadata } from './transaction-money.service.js';

const USD: FxSnapshotRef = { id: 'usd-snapshot', baseCurrency: 'USD', asOfDate: '2026-10-22',
  rate: '50.000000000000', moneyContractVersion: 2 };
const EUR: FxSnapshotRef = { ...USD, id: 'eur-snapshot', baseCurrency: 'EUR', rate: '1500.000000000000' };
const DATE = new Date('2026-10-22T01:00:00Z');

function row(id: string, changes: Partial<MoneyRow> = {}): MoneyRow {
  return { id, householdId: 'household', memberId: 'member', cardId: 'card',
    transactionType: 'approval', status: 'approved', amount: 10000, currency: 'KRW',
    originalAmount: null, originalCurrency: null, exchangeRate: null, fxRateSnapshotId: null,
    cancelledAmount: 0, originalCancelledAmount: null, netAmount: 10000,
    parentTransactionId: null, approvedAt: DATE, cancelledAt: null, authorizationCode: null,
    merchantNormalized: null, moneyContractVersion: 2, sourceEventId: `source-${id}`, ...changes };
}

function chain(children: Array<{ id: string; minorUnits: number; status?: string }> = [
  { id: 'c1', minorUnits: 1 }, { id: 'c2', minorUnits: 1 },
], approvalId = 'approval'): MoneyRow[] {
  const plan = planChain({ minorUnits: 3, currency: 'USD', snapshot: USD },
    children.map((child) => ({ ...child, currency: 'USD' })));
  if (!plan.ok) throw new Error('synthetic-plan-rejected');
  return [row(approvalId, { ...plan.value.approval }), ...plan.value.cancellations.map((child) => row(child.id, {
    ...child.columns, transactionType: 'cancellation', parentTransactionId: approvalId,
    approvedAt: null, cancelledAt: DATE, status: children.find((item) => item.id === child.id)?.status ?? child.columns.status,
  }))];
}

/**
 * Synthetic protocol fake for the actual service. SQL predicates are compiled by
 * Drizzle rather than guessed from input arguments. Transaction rejection rolls
 * state back; real lock interleavings are independently covered by isolated PG.
 */
function harness(initial: MoneyRow[]) {
  let rows = new Map(initial.map((item) => [item.id, structuredClone(item)]));
  const locks: string[] = [];
  const writes: Array<{ kind: string; ids: string[] }> = [];
  const dialect = new PgDialect();
  const names = Object.fromEntries(Object.entries(schema.cardTransactions)
    .filter(([, value]) => value && typeof value === 'object' && 'name' in value)
    .map(([key, value]) => [(value as { name: string }).name, key]));
  let onLock: ((id: string, data: Map<string, MoneyRow>) => void) | undefined;
  let serial = 0;
  let rollbacks = 0;

  function matches(value: MoneyRow, condition?: SQL): boolean {
    if (!condition) return true;
    const query = dialect.sqlToQuery(condition);
    const data = value as unknown as Record<string, unknown>;
    for (const match of query.sql.matchAll(/"card_transactions"\."([^"]+)"\s*(=|<>)\s*\$(\d+)/g)) {
      const actual = data[names[match[1]]];
      const expected = query.params[Number(match[3]) - 1];
      if (match[2] === '=' ? actual !== expected : actual === expected) return false;
    }
    for (const match of query.sql.matchAll(/"card_transactions"\."([^"]+)"\s+is null/gi)) {
      if (data[names[match[1]]] !== null) return false;
    }
    return true;
  }

  function project(value: MoneyRow, fields?: Record<string, { name?: string }>) {
    if (!fields) return { ...value };
    const data = value as unknown as Record<string, unknown>;
    return Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, data[names[column.name ?? '']]]));
  }

  function query(kind: 'select' | 'update' | 'delete', fields?: Record<string, { name?: string }>, patch?: object) {
    let condition: SQL | undefined;
    let limit: number | undefined;
    let locking = false;
    let returning: Record<string, { name?: string }> | undefined;
    const builder = {
      from: (table: unknown) => { expect(table).toBe(schema.cardTransactions); return builder; },
      where: (value: SQL) => { condition = value; return builder; },
      limit: (value: number) => { limit = value; return builder; },
      orderBy: () => builder,
      for: (mode: string) => { expect(mode).toBe('update'); locking = true; return builder; },
      returning: (value: Record<string, { name?: string }>) => { returning = value; return builder; },
      then: (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve().then(() => {
        let selected = [...rows.values()].filter((value) => matches(value, condition));
        if (limit !== undefined) selected = selected.slice(0, limit);
        if (locking) {
          for (const value of selected) { locks.push(value.id); onLock?.(value.id, rows); }
          selected = [...rows.values()].filter((value) => matches(value, condition));
          if (limit !== undefined) selected = selected.slice(0, limit);
        }
        if (kind === 'update') {
          writes.push({ kind, ids: selected.map((value) => value.id) });
          selected = selected.map((value) => { const next = { ...value, ...patch }; rows.set(value.id, next); return next; });
        } else if (kind === 'delete') {
          writes.push({ kind, ids: selected.map((value) => value.id) });
          for (const value of selected) rows.delete(value.id);
        }
        return selected.map((value) => project(value, kind === 'select' ? fields : returning));
      }).then(resolve, reject),
    };
    return builder;
  }

  const tx = {
    select: (fields?: Record<string, { name?: string }>) => query('select', fields),
    update: (table: unknown) => { expect(table).toBe(schema.cardTransactions);
      return { set: (patch: object) => query('update', undefined, patch) }; },
    delete: (table: unknown) => { expect(table).toBe(schema.cardTransactions); return query('delete'); },
    insert: (table: unknown) => { expect(table).toBe(schema.cardTransactions); return {
      values: (values: Partial<MoneyRow>) => ({ onConflictDoNothing: () => ({ returning: async () => {
        if ([...rows.values()].some((value) => value.sourceEventId === values.sourceEventId)) return [];
        const inserted = row(`inserted-${++serial}`, values);
        rows.set(inserted.id, inserted); writes.push({ kind: 'insert', ids: [inserted.id] });
        return [{ id: inserted.id }];
      } }) }),
    }; },
  };
  const db = { ...tx, transaction: async <T>(callback: (transaction: DbExecutor) => Promise<T>) => {
    const before = structuredClone(rows);
    try { return await callback(tx as unknown as DbExecutor); }
    catch (error) { rows = before; rollbacks += 1; throw error; }
  } } as unknown as Db;
  const snapshots = new Map([[USD.id, USD], [EUR.id, EUR]]);
  const resolver = {
    find: vi.fn(async (key: { baseCurrency: string }) => [...snapshots.values()].find((value) => value.baseCurrency === key.baseCurrency) ?? null),
    findById: vi.fn(async (id: string) => snapshots.get(id) ?? null),
  };
  return { db, service: new TransactionMoneyService(db, resolver), locks, writes, snapshots, resolver,
    rows: () => rows, rollbacks: () => rollbacks,
    beforeLock: (hook: typeof onLock) => { onLock = hook; } };
}

describe('v2 review commands', () => {
  it('preserves approval money-derived status, original units and snapshot without rewriting a child review flag', async () => {
    const h = harness(chain([{ id: 'c1', minorUnits: 1, status: 'duplicate_suspected' }]));
    const before = structuredClone(h.rows().get('approval')!);
    const childBefore = structuredClone(h.rows().get('c1')!);
    expect(await h.service.setReviewFlag({ transactionId: 'approval', flag: 'duplicate_suspected' }))
      .toEqual({ ok: true, value: { transactionId: 'approval' } });
    expect(h.rows().get('approval')).toMatchObject({ status: 'partially_cancelled',
      amount: before.amount, netAmount: before.netAmount, originalAmount: 3,
      originalCancelledAmount: 1, fxRateSnapshotId: USD.id });
    expect(h.rows().get('c1')).toEqual(childBefore);
    expect(h.writes.every((write) => write.ids.every((id) => id === 'approval'))).toBe(true);
  });

  it('keeps a fully cancelled approval cancelled when flagged', async () => {
    const h = harness(chain([{ id: 'c1', minorUnits: 3 }]));
    expect((await h.service.setReviewFlag({ transactionId: 'approval', flag: 'duplicate_suspected' })).ok).toBe(true);
    expect(h.rows().get('approval')).toMatchObject({ status: 'cancelled', netAmount: 0, originalCancelledAmount: 3 });
  });

  it('flags and clears an approval with no children using its existing snapshot', async () => {
    const h = harness(chain([]));
    expect((await h.service.setReviewFlag({ transactionId: 'approval', flag: 'duplicate_suspected' })).ok).toBe(true);
    expect(h.rows().get('approval')?.status).toBe('duplicate_suspected');
    expect((await h.service.setReviewFlag({ transactionId: 'approval', flag: null })).ok).toBe(true);
    expect(h.rows().get('approval')).toMatchObject({ status: 'approved', fxRateSnapshotId: USD.id, originalAmount: 3 });
    expect(h.resolver.find).not.toHaveBeenCalled();
  });

  it.each([false, true])('cancellation review keeps zero net and canonical clear status (linked=%s)', async (linked) => {
    const input = linked ? chain([{ id: 'cancel', minorUnits: 1 }])
      : [row('cancel', { transactionType: 'cancellation', status: 'pending_review', netAmount: 0 })];
    const h = harness(input);
    const parentBefore = h.rows().get('approval') && structuredClone(h.rows().get('approval'));
    expect((await h.service.setReviewFlag({ transactionId: 'cancel', flag: 'duplicate_suspected' })).ok).toBe(true);
    expect(h.rows().get('cancel')).toMatchObject({ status: 'duplicate_suspected', netAmount: 0 });
    expect((await h.service.setReviewFlag({ transactionId: 'cancel', flag: null })).ok).toBe(true);
    expect(h.rows().get('cancel')).toMatchObject({ status: linked ? 'approved' : 'pending_review', netAmount: 0 });
    if (linked) expect(h.rows().get('approval')).toEqual(parentBefore);
  });

  it('rechecks the clear precondition after obtaining the row lock', async () => {
    const h = harness([row('approval', { status: 'duplicate_suspected' })]);
    h.beforeLock((id, rows) => { if (id === 'approval') rows.get(id)!.status = 'approved'; });
    expect(await h.service.setReviewFlag({ transactionId: 'approval', flag: null }))
      .toEqual({ ok: false, reason: 'transaction_not_pending_review' });
    expect(h.writes).toHaveLength(0);
  });

  it('never fabricates an approval snapshot while changing review state', async () => {
    const h = harness(chain([])); h.snapshots.clear();
    expect(await h.service.setReviewFlag({ transactionId: 'approval', flag: 'duplicate_suspected' }))
      .toEqual({ ok: false, reason: 'fx_snapshot_missing' });
    expect(h.writes).toHaveLength(0);
  });

  it.each([1, 3])('refuses review mutations for contract version %s', async (moneyContractVersion) => {
    const h = harness([row('approval', { moneyContractVersion })]);
    expect(await h.service.setReviewFlag({ transactionId: 'approval', flag: 'duplicate_suspected' }))
      .toEqual({ ok: false, reason: 'money_contract_version_mismatch' });
    expect(h.writes).toHaveLength(0);
  });
});

describe('v2 deletion and lock revalidation', () => {
  it('restores original-unit cancellation totals using the approval snapshot rather than reversing rounded KRW', async () => {
    const h = harness(chain([{ id: 'c1', minorUnits: 1 }, { id: 'c2', minorUnits: 1, status: 'duplicate_suspected' }]));
    expect(h.rows().get('approval')).toMatchObject({ amount: 2, cancelledAmount: 1, originalCancelledAmount: 2, netAmount: 1 });
    expect(await h.service.removeTransaction({ transactionId: 'c1' })).toEqual({ ok: true, value: { deleted: true } });
    expect(h.rows().get('approval')).toMatchObject({ amount: 2, cancelledAmount: 1,
      originalCancelledAmount: 1, netAmount: 1, fxRateSnapshotId: USD.id });
    expect(h.rows().get('c2')).toMatchObject({ status: 'duplicate_suspected', originalAmount: 1, netAmount: 0, fxRateSnapshotId: USD.id });
    expect(await h.service.removeTransaction({ transactionId: 'c1' })).toEqual({ ok: true, value: { deleted: false } });
    expect(h.rows().get('approval')?.originalCancelledAmount).toBe(1);
    await h.service.removeTransaction({ transactionId: 'c2' });
    expect(h.rows().get('approval')).toMatchObject({ netAmount: 2, cancelledAmount: 0, originalCancelledAmount: 0, status: 'approved' });
  });

  it('locks approval before cancellation even when the cancellation id sorts first', async () => {
    const h = harness(chain([{ id: 'a-cancel', minorUnits: 1 }], 'z-approval'));
    expect((await h.service.removeTransaction({ transactionId: 'a-cancel' })).ok).toBe(true);
    expect(h.locks.slice(0, 2)).toEqual(['z-approval', 'a-cancel']);
  });

  it('rejects a parent-pointer race after waiting without deleting or adjusting any row', async () => {
    const h = harness([...chain([{ id: 'cancel', minorUnits: 1 }]), row('other-approval')]);
    h.beforeLock((id, rows) => { if (id === 'approval') rows.get('cancel')!.parentTransactionId = 'other-approval'; });
    expect(await h.service.removeTransaction({ transactionId: 'cancel' })).toEqual({ ok: false, reason: 'transaction_changed' });
    expect(h.writes).toHaveLength(0);
    expect(h.locks.slice(0, 2)).toEqual(['approval', 'cancel']);
  });

  it('does not delete an approval with linked cancellations', async () => {
    const h = harness(chain());
    expect(await h.service.removeTransaction({ transactionId: 'approval' })).toEqual({ ok: false, reason: 'transaction_has_cancellations' });
    expect(h.rows().has('approval')).toBe(true); expect(h.writes).toHaveLength(0);
  });

  it('deletes an unlinked approval or cancellation once and treats missing rows as no-op', async () => {
    const h = harness([row('approval'), row('cancel', { transactionType: 'cancellation', status: 'pending_review', netAmount: 0 })]);
    for (const transactionId of ['approval', 'cancel']) {
      expect(await h.service.removeTransaction({ transactionId })).toEqual({ ok: true, value: { deleted: true } });
      expect(await h.service.removeTransaction({ transactionId })).toEqual({ ok: true, value: { deleted: false } });
    }
    expect(h.rows().size).toBe(0);
  });

  it.each([1, 3])('refuses deletion of a contract version %s row', async (moneyContractVersion) => {
    const h = harness([row('approval', { moneyContractVersion })]);
    expect(await h.service.removeTransaction({ transactionId: 'approval' }))
      .toEqual({ ok: false, reason: 'money_contract_version_mismatch' });
    expect(h.writes).toHaveLength(0);
  });
});

describe('rejected money commands never partially commit their own transaction', () => {
  it.each(['removeTransaction', 'removeCancellation'] as const)('rolls back deletion if %s cannot restore the parent snapshot', async (method) => {
    const h = harness(chain([{ id: 'cancel', minorUnits: 1 }])); h.snapshots.clear();
    const result = method === 'removeTransaction'
      ? await h.service.removeTransaction({ transactionId: 'cancel' })
      : await h.service.removeCancellation({ cancellationId: 'cancel' });
    expect(result).toEqual({ ok: false, reason: 'fx_snapshot_missing' });
    expect(h.rows().has('cancel')).toBe(true);
    expect(h.rows().get('approval')?.originalCancelledAmount).toBe(1);
    expect(h.rollbacks()).toBe(1);
  });

  it('rolls back an unlink when the parent cannot be recalculated', async () => {
    const h = harness(chain([{ id: 'cancel', minorUnits: 1 }])); h.snapshots.clear();
    expect(await h.service.unlinkCancellation({ cancellationId: 'cancel' }))
      .toEqual({ ok: false, reason: 'fx_snapshot_missing' });
    expect(h.rows().get('cancel')).toMatchObject({ parentTransactionId: 'approval', status: 'approved' });
    expect(h.rollbacks()).toBe(1);
  });

  function incompatibleRelink() {
    return harness([...chain([{ id: 'cancel', minorUnits: 1 }]), row('other-approval', {
      currency: 'KRW', originalCurrency: 'EUR', originalAmount: 100, amount: 1500,
      netAmount: 1500, originalCancelledAmount: 0, fxRateSnapshotId: EUR.id,
    })]);
  }

  it('rolls back both a relink claim and the previous-parent restoration when the new chain rejects', async () => {
    const h = incompatibleRelink();
    expect(await h.service.linkCancellation({ cancellationId: 'cancel', approvalId: 'other-approval' }))
      .toEqual({ ok: false, reason: 'currency_mismatch' });
    expect(h.rows().get('cancel')?.parentTransactionId).toBe('approval');
    expect(h.rows().get('approval')?.originalCancelledAmount).toBe(1);
    expect(h.rollbacks()).toBe(1);
  });

  it('keeps caller-owned transaction rejection handling explicit so related writes roll back together', async () => {
    const h = incompatibleRelink();
    await expect(h.db.transaction(async (tx) => {
      const result = await h.service.linkCancellation({ cancellationId: 'cancel', approvalId: 'other-approval' }, { tx });
      if (!result.ok) throw new Error('caller-rejected-command');
    })).rejects.toThrow('caller-rejected-command');
    expect(h.rows().get('cancel')?.parentTransactionId).toBe('approval');
    expect(h.rows().get('approval')?.originalCancelledAmount).toBe(1);
    expect(h.rollbacks()).toBe(1);
  });

  it('rolls back a newly inserted cancellation when its explicit parent belongs to another household', async () => {
    const h = harness([row('foreign-parent', { householdId: 'another-household' })]);
    const metadata: TransactionMetadata = { householdId: 'household', memberId: 'member', cardId: null,
      sourceEventId: 'new-cancel-source', merchantRaw: null, merchantNormalized: null, categoryId: null,
      authorizationCode: null, installmentMonths: null, visibility: 'private', memo: null };
    expect(await h.service.createCancellation({ metadata, minorUnits: 100, currency: 'KRW',
      occurredAt: DATE, receivedAt: DATE, parentTransactionId: 'foreign-parent' }))
      .toEqual({ ok: false, reason: 'household_mismatch' });
    expect([...h.rows().keys()]).toEqual(['foreign-parent']);
    expect(h.rollbacks()).toBe(1);
  });
});
