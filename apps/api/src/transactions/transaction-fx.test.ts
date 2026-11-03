import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { transactionFxSchema } from '@family/contracts';
import { schema } from '@family/database';
import type { MoneyShadowService } from '../money/money-shadow.service';
import type { MoneyWriteService } from '../money/money-write.service';
import type { RealtimePublisherService } from '../realtime/realtime-publisher.service';
import { transactionFx, type TransactionFxSnapshot } from './transaction-fx';
import { TransactionService } from './transaction.service';
import { TransactionController } from './transaction.controller';

const H = '11111111-1111-4111-8111-111111111111';
const M = '22222222-2222-4222-8222-222222222222';
const T = '33333333-3333-4333-8333-333333333333';
const S = '44444444-4444-4444-8444-444444444444';
const U = '55555555-5555-4555-8555-555555555555';
const D = '2026-10-28';
const referenceUrl = new URL('https://data-api.ecb.europa.eu/service/data/EXR/D.USD+KRW.EUR.SP00.A');
for (const [key, value] of Object.entries({ startPeriod: D, endPeriod: D, format: 'csvdata', detail: 'full' })) {
  referenceUrl.searchParams.set(key, value);
}
const provenance = { url: referenceUrl.toString(), asOfDate: D, baseCurrency: 'USD', quoteCurrency: 'KRW',
  basePerEur: '1.1', krwPerEur: '1540', observationStatus: 'A', unitMultiplier: 0, rounding: 'HALF_UP', scale: 12 };
const snapshot: TransactionFxSnapshot = { id: S, baseCurrency: 'USD', quoteCurrency: 'KRW', asOfDate: D,
  rate: '1400.000000000000', provider: 'ecb-reference-cross', providerVersion: 'ecb-sdmx-daily-eur-cross-half-up-12-v1',
  providerReference: JSON.stringify(provenance), moneyContractVersion: 2, isManual: false };
const txn = { originalCurrency: 'USD', moneyContractVersion: 2, fxRateSnapshotId: S };
const unknown = { basis: 'unknown', source: null, asOfDate: null, rate: null, isReference: null };

describe('actual bound FX provenance', () => {
  it('uses the exact decimal and date rather than a rounded display rate or approval timestamp', () => {
    expect(transactionFx(txn, snapshot, false)).toEqual({ basis: 'daily_reference', source: 'ecb',
      asOfDate: D, rate: '1400.000000000000', isReference: true });
  });
  it('operator snapshots expose their kind without claiming an ECB reference rate', () => {
    expect(transactionFx(txn, { ...snapshot, isManual: true, providerReference: 'private operator note' }, false))
      .toEqual({ basis: 'manual_reference', source: 'manual', asOfDate: D, rate: snapshot.rate, isReference: null });
  });
  it.each([
    { provider: 'ecb-reference-cross-copy' }, { providerVersion: 'unrecognized' }, { providerReference: 'invalid JSON' },
    { providerReference: JSON.stringify({ ...provenance, asOfDate: '2026-10-27' }) },
    { providerReference: JSON.stringify({ ...provenance, observationStatus: 'P' }) },
    { providerReference: JSON.stringify({ ...provenance, url: 'https://untrusted.invalid/quote' }) },
    { providerReference: JSON.stringify({ ...provenance, baseCurrency: 'JPY' }) },
    { providerReference: JSON.stringify({ ...provenance, krwPerEur: '1541' }) },
  ])('does not infer official daily provenance from incomplete or mismatched attributes: %j', change => {
    expect(transactionFx(txn, { ...snapshot, ...change }, false))
      .toMatchObject({ basis: 'snapshot_reference', source: 'other', asOfDate: D, isReference: null });
  });
  it.each([null, undefined])('a missing v2 snapshot remains unknown: %s', value => {
    expect(transactionFx(txn, value, false)).toEqual(unknown);
  });
  it('does not invent dates or provenance for legacy rows, even if an unrelated snapshot is supplied', () => {
    expect(transactionFx({ ...txn, moneyContractVersion: 1 }, snapshot, false)).toEqual(unknown);
  });
  it.each([{ id: 'different' }, { baseCurrency: 'JPY' }, { quoteCurrency: 'USD' },
    { moneyContractVersion: 3 }, { rate: '0' }])('rejects a snapshot that is not validly bound to this v2 row: %j', change => {
    expect(transactionFx(txn, { ...snapshot, ...change }, false)).toEqual(unknown);
  });
  it('KRW and masked rows add no new provenance disclosure', () => {
    expect(transactionFx({ ...txn, originalCurrency: null }, snapshot, false)).toBeNull();
    expect(transactionFx(txn, snapshot, true)).toBeNull();
  });
  it('serializes only the agreed safe fields and never arbitrary provider reference data', () => {
    const fx = transactionFx(txn, { ...snapshot, provider: 'private-provider-marker', providerReference: 'private-reference-marker' }, false);
    expect(transactionFxSchema.parse(fx)).toEqual(fx);
    expect(Object.keys(fx!).sort()).toEqual(['asOfDate', 'basis', 'isReference', 'rate', 'source']);
    expect(JSON.stringify(fx)).not.toMatch(/private-|providerReference|createdBy|note/);
  });
});

/** No DB/network: execute the real query builder and decoder over synthetic rows. */
function setup() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const state = { member: true, snapshot: { ...snapshot } as TransactionFxSnapshot | null,
    transaction: { id: T, householdId: H, memberId: M, sourceEventId: T, transactionType: 'approval', status: 'approved',
      amount: 1400, cancelledAmount: 0, netAmount: 1400, currency: 'KRW', originalAmount: 100,
      originalCurrency: 'USD', originalCancelledAmount: 0, exchangeRate: 1400, moneyContractVersion: 2, fxRateSnapshotId: S,
      merchantRaw: 'synthetic-merchant', merchantNormalized: 'synthetic-merchant', visibility: 'household', memo: 'synthetic-memo',
      approvedAt: '2026-10-28T16:00:00.000Z', createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z',
    } as Record<string, unknown> };
  const unsafe = (sql: string, params: unknown[]) => {
    queries.push({ sql, params });
    const result = Promise.resolve().then(() => {
      if (sql.includes('from "household_members"')) return state.member ? [[M, 'member']] : [];
      if (!sql.includes('from "card_transactions"')) throw new Error('unexpected synthetic query');
      const fx = state.snapshot;
      return [[...Object.keys(getTableColumns(schema.cardTransactions)).map(key => state.transaction[key] ?? null), null,
        ...(fx ? [fx.id, fx.baseCurrency, fx.quoteCurrency, fx.asOfDate, fx.rate, fx.provider, fx.providerVersion,
          fx.providerReference, fx.moneyContractVersion, fx.isManual] : Array(10).fill(null))]];
    });
    return Object.assign(result, { values: () => result });
  };
  const db = drizzle({ options: { parsers: {}, serializers: {} }, unsafe } as unknown as postgres.Sql, { schema });
  const service = new TransactionService(db, {} as RealtimePublisherService, {} as MoneyShadowService, {} as MoneyWriteService);
  return { service, controller: new TransactionController(service), state, queries };
}

describe('FX provenance is reachable through existing API reads', () => {
  it('GET detail and list join the bound snapshot, without provider calls or writes', async () => {
    const { controller, service, queries } = setup();
    const detail = await controller.get({ userId: U } as never, T);
    expect(detail.fx).toMatchObject({ asOfDate: D, source: 'ecb', isReference: true });
    expect((await service.list(U, { householdId: H })).items[0]?.fx).toEqual(detail.fx);
    const reads = queries.filter(query => query.sql.includes('from "card_transactions"'));
    expect(reads).toHaveLength(2);
    expect(reads.every(query => query.sql.includes('"card_transactions"."fx_rate_snapshot_id" = "fx_rate_snapshots"."id"'))).toBe(true);
    expect(queries.every(query => query.sql.startsWith('select '))).toBe(true);
    expect(reads.every(query => !query.sql.includes('"note"'))).toBe(true);
    expect(reads.every(query => query.sql.includes('"fx_rate_snapshots"."created_by" is not null'))).toBe(true);
  });
  it('a linked cancellation shows its parent snapshot date, not its own cancellation date', async () => {
    const { service, state } = setup();
    state.transaction.transactionType = 'cancellation';
    state.transaction.approvedAt = null;
    state.transaction.cancelledAt = '2026-10-31T01:00:00.000Z';
    state.transaction.parentTransactionId = U;
    expect((await service.get(U, T)).fx?.asOfDate).toBe(D);
  });
  it('a later read observes snapshot removal in the test double without retaining invented provenance', async () => {
    const { service, state } = setup();
    expect((await service.get(U, T)).fx?.source).toBe('ecb');
    state.snapshot = null;
    expect((await service.get(U, T)).fx).toEqual(unknown);
    state.transaction.moneyContractVersion = 1;
    expect((await service.get(U, T)).fx).toEqual(unknown);
  });
  it('summary_only masking still hides merchant/memo and now hides provenance', async () => {
    const { service, state } = setup();
    state.transaction.memberId = 'other'; state.transaction.visibility = 'summary_only';
    expect(await service.get(U, T)).toMatchObject({ masked: true, merchantRaw: null, merchantNormalized: null, memo: null, fx: null });
  });
  it('private rows remain not-found and inactive membership receives no projection', async () => {
    const { service, state } = setup();
    state.transaction.memberId = 'other'; state.transaction.visibility = 'private';
    await expect(service.get(U, T)).rejects.toBeInstanceOf(NotFoundException);
    state.member = false;
    await expect(service.get(U, T)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
