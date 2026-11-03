import { schema, type Db, type Sql } from '@family/database';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it } from 'vitest';

import { LegacyTransactionMoneyService, type LegacyConvertedMoney } from './legacy-money.service.js';
import type { TransactionMetadata } from './transaction-money.service.js';

const NOW = new Date('2026-10-22T00:00:00Z');
const columns = getTableColumns(schema.cardTransactions);
const keyByColumn = new Map(Object.entries(columns).map(([key, column]) => [column.name, key]));
type Row = Record<string, unknown>;
const metadata = (sourceEventId: string): TransactionMetadata => ({
  householdId: 'synthetic-household', memberId: 'synthetic-member', cardId: null, sourceEventId,
  merchantRaw: null, merchantNormalized: null, categoryId: null, authorizationCode: null,
  installmentMonths: null, visibility: 'private', memo: null,
});
const money = (amount: number, currency = 'KRW'): LegacyConvertedMoney => ({
  amount, currency, originalAmount: null, originalCurrency: null, exchangeRate: null,
});

/** Actual Drizzle query generation over a synthetic SQL port, never a real DB. */
function harness() {
  let rows = new Map<string, Row>();
  let nextId = 0;
  let beforeQuery: ((sql: string, params: unknown[]) => void) | undefined;
  const queries: { sql: string; params: unknown[] }[] = [];
  const transactions = { begun: 0, rolledBack: 0 };
  const key = (column: string) => keyByColumn.get(column)!;
  const project = (row: Row, selection: string) => [...selection.matchAll(/"([a-z_]+)"/g)].map((match) => {
    const value = row[key(match[1]!)];
    return value instanceof Date ? value.toISOString() : value ?? null;
  });
  const matches = (row: Row, sql: string, params: unknown[]) => {
    const where = sql.split(' where ')[1]?.split(' order by ')[0] ?? '';
    for (const match of where.matchAll(/(?:"card_transactions"\.)?"([a-z_]+)"\s*=\s*\$(\d+)/g)) {
      if (row[key(match[1]!)] !== params[Number(match[2]) - 1]) return false;
    }
    for (const match of where.matchAll(/(?:"card_transactions"\.)?"([a-z_]+)" is null/g)) {
      if (row[key(match[1]!)] !== null) return false;
    }
    const statuses = /"status" in \(([^)]+)\)/.exec(where);
    if (statuses && ![...statuses[1]!.matchAll(/\$(\d+)/g)].some((match) => row.status === params[Number(match[1]) - 1])) return false;
    const before = /"approved_at" < \$(\d+)/.exec(where);
    if (before && (!row.approvedAt || new Date(row.approvedAt as string).getTime() >= new Date(params[Number(before[1]) - 1] as string).getTime())) return false;
    return true;
  };
  const execute = (sql: string, params: unknown[]): unknown[][] => {
    queries.push({ sql, params }); beforeQuery?.(sql, params);
    if (sql.startsWith('insert into ')) {
      const match = /\(([^)]+)\) values \(([^)]+)\)/.exec(sql)!;
      const names = [...match[1]!.matchAll(/"([a-z_]+)"/g)].map((item) => item[1]!);
      const values = match[2]!.split(',').map((value) => value.trim());
      const row: Row = Object.fromEntries(Object.keys(columns).map((name) => [name, null]));
      Object.assign(row, { id: `synthetic-${++nextId}`, createdAt: NOW, updatedAt: NOW, moneyContractVersion: 1 });
      names.forEach((name, index) => {
        const parameter = /^\$(\d+)$/.exec(values[index]!);
        if (parameter) row[key(name)] = params[Number(parameter[1]) - 1];
      });
      if ([...rows.values()].some((current) => current.sourceEventId === row.sourceEventId)) return [];
      rows.set(row.id as string, row);
      return [project(row, sql.split(' returning ')[1]!)];
    }
    const selected = [...rows.values()].filter((row) => matches(row, sql, params));
    if (sql.startsWith('select ')) {
      const limited = sql.includes(' limit ') ? selected.slice(0, 1) : selected;
      return limited.map((row) => project(row, sql.slice(7, sql.indexOf(' from '))));
    }
    if (sql.startsWith('update ')) {
      const assignments = sql.split(' set ')[1]!.split(' where ')[0]!;
      selected.forEach((row) => {
        for (const match of assignments.matchAll(/"([a-z_]+)"\s*=\s*\$(\d+)/g)) row[key(match[1]!)] = params[Number(match[2]) - 1];
      });
      return sql.includes(' returning ') ? selected.map((row) => project(row, sql.split(' returning ')[1]!)) : [];
    }
    if (sql.startsWith('delete ')) { selected.forEach((row) => rows.delete(row.id as string)); return []; }
    throw new Error('unexpected synthetic SQL');
  };
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe: (sql: string, params: unknown[] = []) => {
      const values = execute(sql, params);
      return Object.assign(Promise.resolve(values), { values: async () => values });
    },
    begin: async <T>(body: (tx: unknown) => Promise<T>) => {
      const snapshot = structuredClone(rows); transactions.begun += 1;
      try { return await body(client); }
      catch (error) { rows = snapshot; transactions.rolledBack += 1; throw error; }
    },
  };
  const db = drizzle(client as unknown as Sql, { schema }) as Db;
  const service = new LegacyTransactionMoneyService(db);
  const create = async (id: string, amount = 200, extra: Partial<LegacyConvertedMoney> = {}) => {
    const result = await service.createApproval({ metadata: metadata(id), money: { ...money(amount), ...extra }, occurredAt: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('synthetic fixture creation failed');
    return result.value.transactionId;
  };
  return { db, service, create, queries, transactions, rows: () => rows,
    before: (callback: typeof beforeQuery) => { beforeQuery = callback; } };
}

describe('legacy money commands preserve explicit v1 compatibility semantics', () => {
  it('retains display FX, money version and source-event idempotence without acquiring a snapshot', async () => {
    const h = harness();
    const id = await h.create('approval', 1300, { originalAmount: 100, originalCurrency: 'USD', exchangeRate: 1300 });
    expect(h.rows().get(id)).toMatchObject({ amount: 1300, currency: 'KRW', originalAmount: 100,
      originalCurrency: 'USD', exchangeRate: 1300, moneyContractVersion: 1, fxRateSnapshotId: null, originalCancelledAmount: null });
    expect(await h.service.createApproval({ metadata: metadata('approval'), money: money(9000), occurredAt: NOW }))
      .toEqual({ ok: true, value: { transactionId: id, alreadyPromoted: true } });
    expect(h.rows().size).toBe(1);
    expect(h.rows().get(id)!.amount).toBe(1300);
  });

  it('keeps reviewed foreign cancellations unlinked, cancelled and net zero', async () => {
    const h = harness(); await h.create('approval');
    const result = await h.service.createReviewedTransaction({ metadata: metadata('review'),
      minorUnits: 100, currency: 'USD', transactionType: 'cancellation', occurredAt: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) expect(h.rows().get(result.value.transactionId)).toMatchObject({ transactionType: 'cancellation',
      status: 'cancelled', amount: 100, netAmount: 0, currency: 'USD', originalAmount: null, parentTransactionId: null });
  });

  it('links unique legacy cancellations cumulatively and never double-applies a source retry', async () => {
    const h = harness(); const id = await h.create('approval');
    const command = { metadata: metadata('cancel'), money: money(50), occurredAt: new Date(NOW.getTime() + 1000) };
    const first = await h.service.createCancellation(command);
    expect(first).toMatchObject({ ok: true, value: { status: 'partially_cancelled', linked: true, alreadyPromoted: false } });
    expect(h.rows().get(id)).toMatchObject({ cancelledAmount: 50, netAmount: 150, status: 'partially_cancelled' });
    expect(await h.service.createCancellation(command)).toEqual({ ok: true, value: {
      status: 'pending_review', linked: false, alreadyPromoted: true, transactionId: null,
    } });
    expect(await h.service.createCancellation({ ...command, metadata: metadata('full'), money: money(150) }))
      .toMatchObject({ ok: true, value: { status: 'cancelled', linked: true } });
    expect(h.rows().get(id)).toMatchObject({ cancelledAmount: 200, netAmount: 0, status: 'cancelled' });
  });

  it.each(['ambiguous', 'currency', 'version'] as const)('holds an automatic cancellation when candidates are %s', async (kind) => {
    const h = harness(); const id = await h.create('approval');
    if (kind === 'ambiguous') await h.create('second');
    if (kind === 'currency') h.rows().get(id)!.currency = 'USD';
    if (kind === 'version') h.rows().get(id)!.moneyContractVersion = 2;
    expect(await h.service.createCancellation({ metadata: metadata('cancel'), money: money(100), occurredAt: new Date(NOW.getTime() + 1000) }))
      .toMatchObject({ ok: true, value: { linked: false, status: 'pending_review' } });
    expect(h.rows().get(id)!.cancelledAmount).toBe(0);
  });

  it('rejects an over-limit manual link before claiming the cancellation', async () => {
    const h = harness(); const approvalId = await h.create('approval');
    const cancellation = await h.service.createReviewedTransaction({ metadata: metadata('cancel'), minorUnits: 201,
      currency: 'KRW', transactionType: 'cancellation', occurredAt: NOW });
    if (!cancellation.ok) throw new Error('fixture failed');
    expect(await h.service.linkCancellation({ approvalId, cancellationId: cancellation.value.transactionId, householdId: 'synthetic-household' }))
      .toEqual({ ok: false, reason: 'cancellation_exceeds_approval' });
    expect(h.rows().get(cancellation.value.transactionId)!.parentTransactionId).toBeNull();
    expect(h.rows().get(approvalId)!.cancelledAmount).toBe(0);
    expect(h.transactions.rolledBack).toBe(1);
    const locks = h.queries.filter((query) => query.sql.includes('for update')).map((query) => query.params[0]);
    expect(locks).toEqual([approvalId, cancellation.value.transactionId]);
  });

  it('restores legacy review status from its current amounts while keeping cancellation net zero', async () => {
    const h = harness(); const id = await h.create('approval');
    Object.assign(h.rows().get(id)!, { cancelledAmount: 50, netAmount: 150 });
    expect((await h.service.setReviewFlag({ transactionId: id, flag: 'duplicate_suspected' })).ok).toBe(true);
    expect((await h.service.setReviewFlag({ transactionId: id, flag: null })).ok).toBe(true);
    expect(h.rows().get(id)).toMatchObject({ status: 'partially_cancelled', netAmount: 150 });
    const cancel = await h.service.createReviewedTransaction({ metadata: metadata('cancel'), minorUnits: 50,
      currency: 'KRW', transactionType: 'cancellation', occurredAt: NOW });
    if (!cancel.ok) throw new Error('fixture failed');
    await h.service.setReviewFlag({ transactionId: cancel.value.transactionId, flag: 'duplicate_suspected' });
    await h.service.setReviewFlag({ transactionId: cancel.value.transactionId, flag: null });
    expect(h.rows().get(cancel.value.transactionId)).toMatchObject({ status: 'approved', netAmount: 0 });
  });

  it('refuses to remove an approval with children, then reverses one cancellation exactly once', async () => {
    const h = harness(); const id = await h.create('approval');
    const result = await h.service.createCancellation({ metadata: metadata('cancel'), money: money(50), occurredAt: new Date(NOW.getTime() + 1000) });
    if (!result.ok || !result.value.transactionId) throw new Error('fixture failed');
    expect(await h.service.removeTransaction({ transactionId: id })).toEqual({ ok: false, reason: 'transaction_has_cancellations' });
    await h.service.removeTransaction({ transactionId: result.value.transactionId });
    await h.service.removeTransaction({ transactionId: result.value.transactionId });
    expect(h.rows().get(id)).toMatchObject({ cancelledAmount: 0, netAmount: 200, status: 'approved', originalCancelledAmount: null });
    expect(h.rows().size).toBe(1);
  });

  it.each(['household', 'type'] as const)('does not reverse an invalid parent relation with mismatched %s', async (kind) => {
    const h = harness(); const id = await h.create('approval');
    const result = await h.service.createCancellation({ metadata: metadata('cancel'), money: money(50), occurredAt: new Date(NOW.getTime() + 1000) });
    if (!result.ok || !result.value.transactionId) throw new Error('fixture failed');
    if (kind === 'household') h.rows().get(id)!.householdId = 'other-synthetic-household';
    else h.rows().get(id)!.transactionType = 'cancellation';
    expect(await h.service.removeTransaction({ transactionId: result.value.transactionId }))
      .toEqual({ ok: false, reason: kind === 'household' ? 'household_mismatch' : 'transaction_type_mismatch' });
    expect(h.rows().get(id)!.cancelledAmount).toBe(50);
    expect(h.rows().has(result.value.transactionId)).toBe(true);
  });

  it('rejects a changed cancellation parent instead of reversing the stale approval', async () => {
    const h = harness(); const id = await h.create('approval');
    const result = await h.service.createCancellation({ metadata: metadata('cancel'), money: money(50), occurredAt: new Date(NOW.getTime() + 1000) });
    if (!result.ok || !result.value.transactionId) throw new Error('fixture failed');
    const other = await h.create('another-approval');
    const before = h.queries.length;
    h.before((sql, params) => {
      if (sql.includes('for update') && params.includes(result.value.transactionId)) {
        h.rows().get(result.value.transactionId!)!.parentTransactionId = other;
      }
    });
    expect(await h.service.removeTransaction({ transactionId: result.value.transactionId }))
      .toEqual({ ok: false, reason: 'transaction_changed' });
    expect(h.queries.slice(before).some((query) => query.sql.startsWith('update ') || query.sql.startsWith('delete '))).toBe(false);
    expect(h.rows().get(id)!.cancelledAmount).toBe(50);
  });

  it('amends only an unlinked transaction and keeps approval/cancellation date columns distinct', async () => {
    const h = harness(); const id = await h.create('approval');
    const changed = new Date('2026-10-23T00:00:00Z');
    await h.service.amendTransaction({ transactionId: id, amount: 500, occurredAt: changed });
    expect(h.rows().get(id)).toMatchObject({ amount: 500, netAmount: 500, approvedAt: changed.toISOString(), cancelledAt: null });
    Object.assign(h.rows().get(id)!, { cancelledAmount: 1 });
    expect(await h.service.amendTransaction({ transactionId: id, amount: 800 }))
      .toEqual({ ok: false, reason: 'transaction_has_cancellations' });
    expect(h.rows().get(id)!.amount).toBe(500);
  });

  it.each([2, 3])('rejects mutations of contract version %s without changing it', async (version) => {
    const h = harness(); const id = await h.create('approval'); h.rows().get(id)!.moneyContractVersion = version;
    for (const result of [await h.service.setReviewFlag({ transactionId: id, flag: 'duplicate_suspected' }),
      await h.service.amendTransaction({ transactionId: id, amount: 300 }),
      await h.service.removeTransaction({ transactionId: id })]) {
      expect(result).toEqual({ ok: false, reason: 'money_contract_version_mismatch' });
    }
    expect(h.rows().get(id)).toMatchObject({ amount: 200, status: 'approved', moneyContractVersion: version });
  });

  it('participates in a caller transaction so later failure rolls back the ledger too', async () => {
    const h = harness(); const sentinel = new Error('synthetic caller failure');
    await expect(h.db.transaction(async (tx) => {
      await h.service.createApproval({ metadata: metadata('approval'), money: money(200), occurredAt: NOW }, { tx });
      throw sentinel;
    })).rejects.toBe(sentinel);
    expect(h.rows().size).toBe(0);
    expect(h.transactions).toEqual({ begun: 1, rolledBack: 1 });
  });

  it('propagates storage failure and rolls back a claimed cancellation and parent writes', async () => {
    const h = harness(); const id = await h.create('approval'); const sentinel = new Error('synthetic storage failure');
    h.before((sql, params) => { if (sql.startsWith('update ') && sql.includes('"cancelled_amount"') && params.includes(id)) throw sentinel; });
    await expect(h.service.createCancellation({ metadata: metadata('cancel'), money: money(50), occurredAt: new Date(NOW.getTime() + 1000) }))
      .rejects.toThrow();
    expect(h.rows().size).toBe(1);
    expect(h.rows().get(id)).toMatchObject({ cancelledAmount: 0, netAmount: 200 });
    expect(h.transactions.rolledBack).toBe(1);
  });
});
