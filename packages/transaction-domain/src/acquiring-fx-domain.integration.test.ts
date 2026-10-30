import { describe, expect, it, vi } from 'vitest';
import { schema, type Db } from '@family/database';

import { AcquiringFxSnapshotResolver, type FxSnapshotWritableStore } from './acquiring-fx-snapshot-resolver.js';
import { EcbHistoricalFxProvider } from './historical-fx-provider.js';
import type { FxSnapshotRef } from './plan.js';
import { TransactionMoneyService, type TransactionMetadata } from './transaction-money.service.js';

// Entirely synthetic HTTP and persistence ports. No live ECB or database access.
const HEADER = 'FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS,UNIT,UNIT_MULT';
const CSV = `${HEADER}\nD,USD,EUR,SP00,A,2026-10-22,1.1205,A,USD,0\nD,KRW,EUR,SP00,A,2026-10-22,1484.25,A,KRW,0\n`;
const metadata: TransactionMetadata = {
  householdId: 'synthetic-household', memberId: 'synthetic-member', cardId: null,
  sourceEventId: 'synthetic-event', merchantRaw: null, merchantNormalized: null,
  categoryId: null, authorizationCode: null, installmentMonths: null,
  visibility: 'private', memo: null,
};

function harness(body = CSV, fail = false) {
  const snapshots = new Map<string, FxSnapshotRef>();
  const ledger = new Map<string, Record<string, unknown>>();
  const origins: unknown[] = [];
  const keyOf = (key: { baseCurrency: string; asOfDate: string; moneyContractVersion?: number }) =>
    `${key.baseCurrency}|${key.asOfDate}|${key.moneyContractVersion ?? 2}`;
  const store: FxSnapshotWritableStore = {
    find: async (key) => snapshots.get(keyOf(key)) ?? null,
    findById: async (id) => [...snapshots.values()].find((row) => row.id === id) ?? null,
    fixate: async (key, rate, origin) => {
      const existing = snapshots.get(keyOf(key));
      if (existing) return existing;
      const row = { id: 'synthetic-snapshot', baseCurrency: key.baseCurrency,
        asOfDate: key.asOfDate, moneyContractVersion: key.moneyContractVersion ?? 2, rate };
      snapshots.set(keyOf(key), row); origins.push(origin);
      return row;
    },
  };
  const fetcher = vi.fn(async () => {
    if (fail) throw new Error('synthetic network failure');
    return new Response(body);
  });
  const provider = new EcbHistoricalFxProvider({ fetch: fetcher, now: () => new Date('2026-10-30T00:00:00Z') });
  const reportUnavailable = vi.fn();
  const resolver = new AcquiringFxSnapshotResolver(store, provider, { reportUnavailable });
  const transaction = vi.fn(async (fn: (tx: Db) => unknown) => fn(db));
  const insert = vi.fn((table: unknown) => {
    expect(table).toBe(schema.cardTransactions);
    return { values: (value: Record<string, unknown>) => ({
      onConflictDoNothing: () => ({ returning: async () => {
        const source = value.sourceEventId as string;
        if (ledger.has(source)) return [];
        const row = { id: 'synthetic-transaction', ...value };
        ledger.set(source, row);
        return [{ id: row.id }];
      } }),
    }) };
  });
  const db = { transaction, insert,
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [...ledger.values()].slice(0, 1) }) }) }),
  } as unknown as Db;
  const service = new TransactionMoneyService(db, resolver);
  const command = { metadata, minorUnits: 10_000, currency: 'USD',
    occurredAt: new Date('2026-10-21T16:00:00Z'), receivedAt: new Date('2026-10-23T00:00:00Z') };
  return { service, command, snapshots, ledger, origins, fetcher, reportUnavailable, insert, transaction };
}

describe('synthetic provider → snapshot resolver → actual money-domain command', () => {
  it('acquires an exact-day snapshot and creates a v2 approval using its integer arithmetic', async () => {
    const h = harness();
    const result = await h.service.createApproval(h.command);
    expect(result.ok).toBe(true);
    expect(h.snapshots.size).toBe(1);
    expect(h.ledger.get(metadata.sourceEventId)).toMatchObject({
      amount: 132_463, currency: 'KRW', originalAmount: 10_000, originalCurrency: 'USD',
      moneyContractVersion: 2, fxRateSnapshotId: 'synthetic-snapshot',
    });
    expect(h.origins[0]).toMatchObject({ provider: 'ecb-reference-cross' });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });

  it('missing observations do not create a snapshot or start a ledger transaction', async () => {
    const h = harness(`${HEADER}\n`);
    expect(await h.service.createApproval(h.command)).toEqual({ ok: false, reason: 'fx_snapshot_missing' });
    expect(h.snapshots.size).toBe(0);
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.reportUnavailable).toHaveBeenCalledWith(expect.objectContaining({ reason: 'observation_missing' }));
  });

  it('a network failure stays pending with an explicit diagnostic and no fallback write', async () => {
    const h = harness(CSV, true);
    expect(await h.service.createApproval(h.command)).toEqual({ ok: false, reason: 'fx_snapshot_missing' });
    expect(h.snapshots.size).toBe(0);
    expect(h.ledger.size).toBe(0);
    expect(h.reportUnavailable).toHaveBeenCalledWith(expect.objectContaining({ reason: 'network_error' }));
  });

  it('concurrent repeated commands preserve one snapshot and one source-event ledger row', async () => {
    const h = harness();
    const results = await Promise.all([h.service.createApproval(h.command), h.service.createApproval(h.command)]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(h.snapshots.size).toBe(1);
    expect(h.ledger.size).toBe(1);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.ok && result.value.alreadyPromoted)).toHaveLength(1);
  });

  it('an operator snapshot for a non-ECB currency remains usable without contacting ECB', async () => {
    const h = harness();
    h.snapshots.set('MOP|2026-10-22|2', { id: 'operator-snapshot', baseCurrency: 'MOP',
      asOfDate: '2026-10-22', moneyContractVersion: 2, rate: '171.000000000000' });
    expect((await h.service.createApproval({ ...h.command, currency: 'MOP' })).ok).toBe(true);
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.ledger.get(metadata.sourceEventId)).toMatchObject({ fxRateSnapshotId: 'operator-snapshot' });
  });
});
