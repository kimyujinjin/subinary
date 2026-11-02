import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { financeConnectionRegisterSchema, financeConnectionSelectAccountSchema, financeConnectionSnapshotSchema,
  financeConnectionSchema, financeConnectionRefreshSchema } from '../dist/index.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const input = { householdId: id, connectionId: id, clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
  consent: { ownAccount: true, storeCredentials: true, refreshOnOpen: true } };
const snapshot = { observedAt: '2026-01-01T00:00:00Z', valuationAt: null,
  totals: [{ currency: 'KRW', marketValue: '9007199254740993.01', afterCostValue: '-0.05' }],
  items: [{ symbol: 'x'.repeat(128), name: '가'.repeat(512), currency: 'KRW', quantity: '0.00001', marketValue: '1', afterCostValue: '-0.05' }] };

describe('owner-only Toss connection contract', () => {
  it('requires separate own-account, storage and on-open refresh confirmations', () => {
    assert.equal(financeConnectionRegisterSchema.safeParse(input).success, true);
    for (const field of Object.keys(input.consent)) {
      assert.equal(financeConnectionRegisterSchema.safeParse({ ...input, consent: { ...input.consent, [field]: false } }).success, false);
    }
    for (const field of ['ownerUserId', 'visibility', 'sharedWith', 'token', 'baseUrl', 'schedule']) {
      assert.equal(financeConnectionRegisterSchema.safeParse({ ...input, [field]: 'unexpected' }).success, false);
    }
  });
  it('does not accept provider account IDs or client-selected provider URLs', () => {
    assert.equal(financeConnectionSelectAccountSchema.safeParse({ householdId: id, expectedVersion: 1, accountId: '9007199254740993' }).success, false);
    assert.equal(financeConnectionRefreshSchema.safeParse({ householdId: id, requestId: id, expectedVersion: 1, url: 'https://invalid.test' }).success, false);
  });
  it('preserves signed official decimals and exact values beyond Number safe range', () => {
    assert.deepEqual(financeConnectionSnapshotSchema.parse(snapshot), snapshot);
    for (const value of [1, '', '1e6', '01', ' 1', '1\n', '1'.repeat(31)]) {
      assert.equal(financeConnectionSnapshotSchema.safeParse({ ...snapshot, totals: [{ ...snapshot.totals[0], marketValue: value }] }).success, false);
    }
  });
  it('keeps currencies separate, rejects duplicate totals and invented valuation instants', () => {
    assert.equal(financeConnectionSnapshotSchema.safeParse({ ...snapshot, totals: [...snapshot.totals, { currency: 'USD', marketValue: '4', afterCostValue: '3.98' }] }).success, true);
    assert.equal(financeConnectionSnapshotSchema.safeParse({ ...snapshot, totals: [...snapshot.totals, ...snapshot.totals] }).success, false);
    assert.equal(financeConnectionSnapshotSchema.safeParse({ ...snapshot, valuationAt: snapshot.observedAt }).success, false);
  });
  it('rejects secrets and household sharing in connection response envelopes', () => {
    const row = { id, householdId: id, ownerUserId: id, provider: 'toss_securities', version: 1, status: 'ready',
      visibility: 'owner_only', includedInTotals: false, refreshOnOpen: true, consentedAt: snapshot.observedAt,
      accountOptions: [], selectedAccountId: null, lastSuccessAt: snapshot.observedAt, lastAttemptAt: snapshot.observedAt,
      errorCode: null, snapshot, canRefresh: false, nextRefreshAt: null, createdAt: snapshot.observedAt, updatedAt: snapshot.observedAt };
    assert.equal(financeConnectionSchema.safeParse(row).success, true);
    for (const change of [{ clientSecret: 'never' }, { accessToken: 'never' }, { visibility: 'household' }, { includedInTotals: true }]) {
      assert.equal(financeConnectionSchema.safeParse({ ...row, ...change }).success, false);
    }
  });
});
