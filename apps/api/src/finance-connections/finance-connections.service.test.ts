import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName, type SQL, type Table } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema, type Db } from '@family/database';
import type { FinanceConnectionRegister } from '@family/contracts';
import { FinanceConnectionsService } from './finance-connections.service';
import { financeAccountId, financeClientFingerprint } from './finance-connections.policy';
import { FinanceVault } from './finance-vault';
import { ProviderError, TossProviderClient } from './toss-provider';

const H = '11111111-1111-4111-8111-111111111111';
const U = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const M = '44444444-4444-4444-8444-444444444444';
const R = '55555555-5555-4555-8555-555555555555';
const S = '66666666-6666-4666-8666-666666666666';
const NOW = Date.parse('2026-01-01T12:00:00Z');
const KEY = '9007199254740993';
const A = financeAccountId(C, KEY);
const input: FinanceConnectionRegister = { householdId: H, connectionId: C, clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
  consent: { ownAccount: true, storeCredentials: true, refreshOnOpen: true } };
const payload = { observedAt: new Date(NOW).toISOString(), valuationAt: null,
  totals: [{ currency: 'KRW' as const, marketValue: '9007199254740993.01', afterCostValue: '-0.01' }], items: [] };
const vault = (enabled = true) => new FinanceVault({ get: () => ({ enabled, activeKeyVersion: 1, keyring: { '1': 'ab'.repeat(32) } }) } as unknown as ConfigService);
const ctx = (purpose: 'credentials' | 'token' | 'accounts') => ({ ownerUserId: U, provider: 'toss_securities' as const, connectionId: C, purpose });
type Row = typeof schema.financeConnections.$inferSelect;
function row(change: Partial<Row> = {}): Row {
  const v = vault();
  return { id: C, householdId: H, ownerUserId: U, memberId: M, memberJoinedAt: new Date(NOW - 1_000_000),
    provider: 'toss_securities', clientFingerprint: financeClientFingerprint(input.clientId), status: 'ready', version: 3,
    consentedAt: new Date(NOW), consentVersion: 1, refreshOnOpen: true,
    credentials: v.encrypt({ clientId: input.clientId, clientSecret: input.clientSecret }, ctx('credentials')),
    tokenIssuance: 'complete', token: v.encrypt({ accessToken: 'synthetic-token' }, ctx('token')), tokenExpiresAt: new Date(NOW + 3_600_000),
    accounts: v.encrypt([{ id: A, accountKey: KEY, type: 'BROKERAGE', label: '종합매매 계좌 1' }], ctx('accounts')),
    selectedAccountId: A, operationId: null, operationStartedAt: null, lastAttemptAt: null, retryNotBefore: null, lastSuccessAt: null,
    lastSnapshotId: null, errorCode: null, createdAt: new Date(NOW), updatedAt: new Date(NOW), disconnectedAt: null, ...change };
}
const membership = () => [[{ id: M, role: 'owner' }], [{ id: H }]];
type RecordedQuery = { operation: string; table?: string; values?: unknown; where?: SQL };
/** Scripted transaction boundaries test orchestration, not PostgreSQL locking. Real DB tests remain a release gate. */
function database(scripts: unknown[][][]) {
  const calls: RecordedQuery[] = [];
  const remaining = [...scripts];
  const db = { transaction: async (run: (tx: unknown) => Promise<unknown>) => {
    const next = remaining.shift();
    if (!next) throw new Error('unexpected synthetic transaction');
    const steps = next;
    function builder(operation: string, table?: Table) {
      const call: RecordedQuery = { operation, table: table ? getTableName(table) : undefined };
      const chain = {
        from(value: Table) { call.table = getTableName(value); return chain; },
        innerJoin() { return chain; }, where(value: SQL) { call.where = value; return chain; },
        for() { return chain; }, limit() { return chain; }, orderBy() { return chain; },
        values(value: unknown) { call.values = value; return chain; }, set(value: unknown) { call.values = value; return chain; },
        returning() { return chain; },
        then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) {
          calls.push(call);
          if (!steps.length) return Promise.reject(new Error('unexpected synthetic query')).then(resolve, reject);
          return Promise.resolve(steps.shift()!).then(resolve, reject);
        },
      };
      return chain;
    }
    const result = await run({ select: () => builder('select'), insert: (table: Table) => builder('insert', table), update: (table: Table) => builder('update', table) });
    if (steps.length) throw new Error('unused synthetic queries');
    return result;
  } } as unknown as Db;
  return { db, calls, remaining };
}
function provider() {
  return { issueToken: vi.fn(async () => ({ accessToken: 'renewed-token', expiresAt: new Date(NOW + 3_600_000) })),
    listAccounts: vi.fn(async () => [{ accountKey: KEY, type: 'BROKERAGE', label: 'ignored', last4: null }]),
    holdings: vi.fn(async () => payload) };
}
function setup(scripts: unknown[][][], enabled = true) {
  const d = database(scripts), p = provider();
  return { ...d, p, service: new FinanceConnectionsService(d.db, vault(enabled), p as unknown as TossProviderClient) };
}
const sqlText = (query: RecordedQuery) => query.where ? new PgDialect().sqlToQuery(query.where).sql : '';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe('owner finance connection orchestration with synthetic provider/DB boundaries', () => {
  it('GET selects only the actor and exact membership incarnation, never provider I/O/secrets', async () => {
    const current = row(), test = setup([[...membership(), [current]]]);
    const result = await test.service.list(U, H);
    expect(result.items[0]).toMatchObject({ ownerUserId: U, includedInTotals: false, visibility: 'owner_only' });
    const serialized = JSON.stringify(result);
    for (const value of ['synthetic-token', input.clientId, input.clientSecret, KEY, 'ciphertext']) expect(serialized).not.toContain(value);
    const query = test.calls.find(call => call.table === 'finance_connections')!;
    expect(sqlText(query)).toContain('"owner_user_id"');
    expect(sqlText(query)).toContain('"joined_at" = "finance_connections"."member_joined_at"');
    expect(test.p.issueToken).not.toHaveBeenCalled(); expect(test.p.holdings).not.toHaveBeenCalled();
  });
  it('disabled vault still presents a consistent opaque selection for disconnection', async () => {
    const test = setup([[...membership(), [row()]]], false);
    const result = await test.service.list(U, H);
    expect(result.enabled).toBe(false);
    expect(result.items[0]).toMatchObject({ selectedAccountId: A, accountOptions: [{ id: A, type: 'BROKERAGE', label: '선택한 계좌' }], canRefresh: false });
  });
  it('rejects viewer registration before issuing a token', async () => {
    const test = setup([[[{ id: M, role: 'viewer' }]]]);
    await expect(test.service.register(U, input)).rejects.toBeInstanceOf(ForbiddenException);
    expect(test.p.issueToken).not.toHaveBeenCalled();
  });
  it('does not reveal a foreign or expired-membership connection', async () => {
    const test = setup([[...membership(), []]]);
    await expect(test.service.disconnect(U, C, { householdId: H, expectedVersion: 3 })).rejects.toBeInstanceOf(NotFoundException);
    expect(test.p.issueToken).not.toHaveBeenCalled();
  });
  it('same registration ID and same key reconcile without another token issuance', async () => {
    const current = row(), test = setup([[...membership(), [current], [current]], [...membership(), [current]]]);
    expect((await test.service.register(U, input)).item.id).toBe(C);
    expect(test.p.issueToken).not.toHaveBeenCalled();
  });
  it('same registration ID with a different secret conflicts, never validates the new secret', async () => {
    const current = row(), test = setup([[...membership(), [current], [current]]]);
    await expect(test.service.register(U, { ...input, clientSecret: 'different-synthetic-secret' })).rejects.toBeInstanceOf(ConflictException);
    expect(test.p.issueToken).not.toHaveBeenCalled();
  });
  it('a disconnected registration ID is a tombstone and cannot reconnect', async () => {
    const current = row({ status: 'disconnected', disconnectedAt: new Date(NOW), credentials: null, token: null, accounts: null });
    const test = setup([[...membership(), [current], [current]]]);
    await expect(test.service.register(U, input)).rejects.toBeInstanceOf(ConflictException);
    expect(test.p.issueToken).not.toHaveBeenCalled();
  });
  it('explicit selection stores only the verified chosen account and never calls holdings', async () => {
    const current = row({ status: 'select_account', selectedAccountId: null });
    const selected = row({ version: 4 });
    const test = setup([[...membership(), [current], [selected]]]);
    const result = await test.service.selectAccount(U, C, { householdId: H, expectedVersion: 3, accountId: A });
    expect(result.item.selectedAccountId).toBe(A);
    const change = test.calls.find(call => call.operation === 'update')!.values as { accounts: Row['accounts'] };
    expect(vault().decrypt<unknown[]>(change.accounts!, ctx('accounts'))).toHaveLength(1);
    expect(test.p.holdings).not.toHaveBeenCalled();
  });
  it('rejects a caller-invented selection outside the provider-verified list', async () => {
    const current = row({ status: 'select_account', selectedAccountId: null }), test = setup([[...membership(), [current]]]);
    await expect(test.service.selectAccount(U, C, { householdId: H, expectedVersion: 3, accountId: 'b'.repeat(64) })).rejects.toThrow();
    expect(test.calls.some(call => call.operation === 'update')).toBe(false);
  });
  it('accepts the provider token upper boundary without truncation and saves exact signed amounts', async () => {
    const token = 'T'.repeat(32_768), current = row({ token: vault().encrypt({ accessToken: token }, ctx('token')) });
    const busy = { ...current, version: 4, status: 'refreshing' as const, operationId: R, operationStartedAt: new Date(NOW), lastAttemptAt: new Date(NOW) };
    const done = { ...busy, version: 5, status: 'ready' as const, operationId: null, operationStartedAt: null, lastSnapshotId: R, lastSuccessAt: new Date(NOW) };
    const test = setup([[...membership(), [current], [], [], [busy]], [...membership(), [busy]], [...membership(), [busy]],
      [...membership(), [busy], [{ id: R }], [done], [{ payload }]]]);
    const result = await test.service.refresh(U, C, { householdId: H, expectedVersion: 3, requestId: R });
    expect(test.p.holdings).toHaveBeenCalledWith(token, KEY);
    expect(test.p.issueToken).not.toHaveBeenCalled();
    expect(result.item.snapshot).toEqual(payload); expect(test.remaining).toHaveLength(0);
  });
  it('same refresh request reconciles without a second external read', async () => {
    const current = row(), test = setup([[...membership(), [current], [{ id: R }]], [...membership(), [current]]]);
    await test.service.refresh(U, C, { householdId: H, expectedVersion: 1, requestId: R });
    expect(test.p.holdings).not.toHaveBeenCalled(); expect(test.p.issueToken).not.toHaveBeenCalled();
  });
  it('a second simultaneous request sees the existing operation and cannot issue/read', async () => {
    const busy = row({ status: 'refreshing', operationId: S, operationStartedAt: new Date(NOW) });
    const test = setup([[...membership(), [busy], []], [...membership(), [busy]]]);
    expect((await test.service.refresh(U, C, { householdId: H, expectedVersion: 3, requestId: R })).item.status).toBe('refreshing');
    expect(test.p.holdings).not.toHaveBeenCalled();
  });
  it('401 preserves the last good snapshot and requires reauthorization, with no renewal loop', async () => {
    const current = row({ lastSnapshotId: S, lastSuccessAt: new Date(NOW - 120_000) });
    const busy = { ...current, version: 4, status: 'refreshing' as const, operationId: R, operationStartedAt: new Date(NOW), lastAttemptAt: new Date(NOW) };
    const failed = { ...busy, version: 5, status: 'reauth_required' as const, operationId: null, operationStartedAt: null, errorCode: 'token_expired' };
    const test = setup([[...membership(), [current], [], [], [busy]], [...membership(), [busy]], [...membership(), [busy]],
      [...membership(), [busy], [], [failed], [{ payload }]]]);
    test.p.holdings.mockRejectedValueOnce(new ProviderError('token_expired', 401));
    const result = await test.service.refresh(U, C, { householdId: H, expectedVersion: 3, requestId: R });
    expect(result.item).toMatchObject({ status: 'reauth_required', canRefresh: false, errorCode: 'token_expired', snapshot: payload });
    expect(test.p.issueToken).not.toHaveBeenCalled();
  });
  it.each([[429, 'rate_limited'], [503, 'provider_unavailable']] as const)('persists provider %s Retry-After without falsifying lastAttemptAt', async (status, code) => {
    const current = row({ lastSnapshotId: S, lastSuccessAt: new Date(NOW - 120_000) });
    const busy = { ...current, version: 4, status: 'refreshing' as const, operationId: R, operationStartedAt: new Date(NOW), lastAttemptAt: new Date(NOW) };
    const failed = { ...busy, version: 5, status: 'error' as const, operationId: null, operationStartedAt: null, errorCode: code, retryNotBefore: new Date(NOW + 120_000) };
    const test = setup([[...membership(), [current], [], [], [busy]], [...membership(), [busy]], [...membership(), [busy]],
      [...membership(), [busy], [], [failed], [{ payload }]]]);
    test.p.holdings.mockRejectedValueOnce(new ProviderError(code, status, 120));
    const result = await test.service.refresh(U, C, { householdId: H, expectedVersion: 3, requestId: R });
    expect(result.item).toMatchObject({ status: 'error', canRefresh: false, errorCode: code,
      lastAttemptAt: new Date(NOW).toISOString(), nextRefreshAt: new Date(NOW + 120_000).toISOString(), snapshot: payload });
    const updates = test.calls.filter(call => call.operation === 'update' && call.table === 'finance_connections');
    expect(updates.at(-1)?.values).toMatchObject({ retryNotBefore: new Date(NOW + 120_000) });
    expect(updates.at(-1)?.values).not.toHaveProperty('lastAttemptAt');
  });
  it('a new open after 60 seconds still performs no I/O before provider Retry-After', async () => {
    vi.setSystemTime(NOW + 61_000);
    const waiting = row({ status: 'error', errorCode: 'rate_limited', lastAttemptAt: new Date(NOW), retryNotBefore: new Date(NOW + 120_000) });
    const test = setup([[...membership(), [waiting], []], [...membership(), [waiting]]]);
    const result = await test.service.refresh(U, C, { householdId: H, requestId: R, expectedVersion: 3 });
    expect(result.item).toMatchObject({ canRefresh: false, nextRefreshAt: new Date(NOW + 120_000).toISOString() });
    expect(test.p.holdings).not.toHaveBeenCalled(); expect(test.p.issueToken).not.toHaveBeenCalled();
    expect(test.calls.every(call => call.operation === 'select')).toBe(true);
  });
  it('late holdings after disconnect cannot resurrect keys or create a snapshot', async () => {
    const current = row(), busy = row({ version: 4, status: 'refreshing', operationId: R, operationStartedAt: new Date(NOW) });
    const disconnected = row({ version: 5, status: 'disconnected', disconnectedAt: new Date(NOW), credentials: null, token: null,
      accounts: null, selectedAccountId: null, refreshOnOpen: false });
    const test = setup([[...membership(), [current], [], [], [busy]], [...membership(), [busy]], [...membership(), [busy]], [...membership(), [disconnected]]]);
    const result = await test.service.refresh(U, C, { householdId: H, expectedVersion: 3, requestId: R });
    expect(test.p.holdings).toHaveBeenCalledOnce();
    expect(result.item).toMatchObject({ status: 'disconnected', snapshot: null });
    expect(test.calls.filter(call => call.operation === 'update')).toHaveLength(1);
  });
  it('disconnect before expired-token issuance settles the unused authority without any provider call', async () => {
    const current = row({ tokenExpiresAt: new Date(NOW - 1) });
    const busy = row({ version: 4, status: 'refreshing', operationId: R, operationStartedAt: new Date(NOW) });
    const renewing = { ...busy, tokenIssuance: 'started' as const, token: null, tokenExpiresAt: null };
    const disconnected = { ...renewing, status: 'disconnected' as const, disconnectedAt: new Date(NOW), credentials: null,
      accounts: null, selectedAccountId: null, operationId: null, refreshOnOpen: false, version: 5 };
    const test = setup([[...membership(), [current], [], [], [busy], [renewing]], [...membership(), [disconnected]], [[]], [...membership(), [disconnected]]]);
    expect((await test.service.refresh(U, C, { householdId: H, expectedVersion: 3, requestId: R })).item.status).toBe('disconnected');
    expect(test.p.issueToken).not.toHaveBeenCalled(); expect(test.p.holdings).not.toHaveBeenCalled();
    expect(test.calls.some(call => (call.values as { tokenIssuance?: string } | undefined)?.tokenIssuance === 'complete')).toBe(true);
  });
  it('known token expiry renews exactly once under the durable claim before reading', async () => {
    const current = row({ tokenExpiresAt: new Date(NOW - 1) });
    const busy = row({ version: 4, status: 'refreshing', operationId: R, operationStartedAt: new Date(NOW), lastAttemptAt: new Date(NOW) });
    const renewing = { ...busy, tokenIssuance: 'started' as const, token: null, tokenExpiresAt: null };
    const marked = { ...renewing, tokenIssuance: 'complete' as const };
    const refreshed = { ...marked, token: vault().encrypt({ accessToken: 'renewed-token' }, ctx('token')), tokenExpiresAt: new Date(NOW + 3_600_000) };
    const done = { ...refreshed, version: 5, status: 'ready' as const, operationId: null, operationStartedAt: null, lastSnapshotId: R, lastSuccessAt: new Date(NOW) };
    const test = setup([[...membership(), [current], [], [], [busy], [renewing]], [...membership(), [renewing]],
      [...membership(), [renewing]], [[]], [...membership(), [marked], [{ id: C }]], [...membership(), [refreshed]],
      [...membership(), [refreshed], [{ id: R }], [done], [{ payload }]]]);
    const result = await test.service.refresh(U, C, { householdId: H, expectedVersion: 3, requestId: R });
    expect(test.p.issueToken).toHaveBeenCalledOnce(); expect(test.p.issueToken).toHaveBeenCalledWith(input.clientId, input.clientSecret);
    expect(test.p.holdings).toHaveBeenCalledOnce(); expect(test.p.holdings).toHaveBeenCalledWith('renewed-token', KEY);
    expect(result.item).toMatchObject({ status: 'ready', snapshot: payload });
    expect(test.remaining).toHaveLength(0);
  });
  it('uncertain renewal keeps the issuance lock and last good snapshot, without retrying', async () => {
    const current = row({ tokenExpiresAt: new Date(NOW - 1), lastSnapshotId: S, lastSuccessAt: new Date(NOW - 120_000) });
    const busy = { ...current, version: 4, status: 'refreshing' as const, operationId: R, operationStartedAt: new Date(NOW), lastAttemptAt: new Date(NOW) };
    const renewing = { ...busy, tokenIssuance: 'started' as const, token: null, tokenExpiresAt: null };
    const uncertain = { ...renewing, tokenIssuance: 'uncertain' as const };
    const failed = { ...uncertain, version: 5, status: 'reauth_required' as const, operationId: null, operationStartedAt: null, errorCode: 'token_uncertain' };
    const test = setup([[...membership(), [current], [], [], [busy], [renewing]], [...membership(), [renewing]],
      [...membership(), [renewing]], [[]], [...membership(), [uncertain], [], [failed], [{ payload }]]]);
    test.p.issueToken.mockRejectedValueOnce(new ProviderError('provider_unavailable', null, null, true));
    const result = await test.service.refresh(U, C, { householdId: H, expectedVersion: 3, requestId: R });
    expect(test.p.issueToken).toHaveBeenCalledOnce(); expect(test.p.holdings).not.toHaveBeenCalled();
    expect(result.item).toMatchObject({ status: 'reauth_required', errorCode: 'token_uncertain', canRefresh: false, snapshot: payload });
    expect(test.calls.some(call => (call.values as { tokenIssuance?: string } | undefined)?.tokenIssuance === 'uncertain')).toBe(true);
  });
  it('revoked membership before a renewal network call releases only the unused issuance marker', async () => {
    const current = row({ tokenExpiresAt: new Date(NOW - 1) });
    const busy = row({ version: 4, status: 'refreshing', operationId: R, operationStartedAt: new Date(NOW) });
    const renewing = { ...busy, tokenIssuance: 'started' as const, token: null, tokenExpiresAt: null };
    const test = setup([[...membership(), [current], [], [], [busy], [renewing]], [[]], [[]]]);
    await expect(test.service.refresh(U, C, { householdId: H, expectedVersion: 3, requestId: R })).rejects.toBeInstanceOf(ForbiddenException);
    expect(test.p.issueToken).not.toHaveBeenCalled(); expect(test.p.holdings).not.toHaveBeenCalled();
    expect(test.calls.at(-1)?.values).toEqual({ tokenIssuance: 'complete' });
  });
  it('multiple supported accounts remain unselected until the owner chooses', async () => {
    const connecting = row({ status: 'connecting', version: 1, selectedAccountId: null, accounts: null, token: null,
      tokenExpiresAt: null, operationId: C, operationStartedAt: new Date(NOW), tokenIssuance: 'started' });
    const marked = { ...connecting, tokenIssuance: 'complete' as const };
    const options = [{ id: A, accountKey: KEY, type: 'BROKERAGE', label: '종합매매 계좌 1' },
      { id: financeAccountId(C, '7'), accountKey: '7', type: 'BROKERAGE', label: '종합매매 계좌 2' }];
    const complete = { ...marked, version: 2, status: 'select_account' as const, operationId: null, operationStartedAt: null,
      accounts: vault().encrypt(options, ctx('accounts')), token: vault().encrypt({ accessToken: 'renewed-token' }, ctx('token')),
      tokenExpiresAt: new Date(NOW + 3_600_000) };
    const test = setup([[...membership(), [], [connecting]], [...membership(), [connecting]], [[]], [...membership(), [marked]],
      [...membership(), [marked], [complete]]]);
    test.p.listAccounts.mockResolvedValueOnce([{ accountKey: KEY, type: 'BROKERAGE', label: 'ignored', last4: null },
      { accountKey: '7', type: 'BROKERAGE', label: 'ignored', last4: null }]);
    const result = await test.service.register(U, input);
    expect(result.item).toMatchObject({ status: 'select_account', selectedAccountId: null, canRefresh: false });
    expect(result.item.accountOptions).toHaveLength(2); expect(test.p.holdings).not.toHaveBeenCalled();
  });
  it('a token completing after disconnect only settles its marker and does not fetch accounts', async () => {
    const connecting = row({ status: 'connecting', version: 1, selectedAccountId: null, accounts: null, token: null,
      tokenExpiresAt: null, operationId: C, operationStartedAt: new Date(NOW), tokenIssuance: 'started' });
    const disconnected = row({ status: 'disconnected', version: 2, disconnectedAt: new Date(NOW), credentials: null,
      token: null, accounts: null, selectedAccountId: null, refreshOnOpen: false });
    const test = setup([[...membership(), [], [connecting]], [...membership(), [connecting]], [[]], [...membership(), [disconnected]], [...membership(), [disconnected]]]);
    expect((await test.service.register(U, input)).item.status).toBe('disconnected');
    expect(test.p.issueToken).toHaveBeenCalledOnce(); expect(test.p.listAccounts).not.toHaveBeenCalled();
    const writes = test.calls.filter(call => call.operation === 'update');
    expect(writes).toHaveLength(1); expect(writes[0]!.values).toEqual({ tokenIssuance: 'complete' });
  });
  it('disconnect purges all encrypted access material even while provider is disabled', async () => {
    const current = row(), disconnected = row({ status: 'disconnected', disconnectedAt: new Date(NOW), credentials: null, token: null,
      accounts: null, selectedAccountId: null, refreshOnOpen: false, version: 4 });
    const test = setup([[...membership(), [current], [], [disconnected]]], false);
    expect((await test.service.disconnect(U, C, { householdId: H, expectedVersion: 3 })).item.status).toBe('disconnected');
    expect(test.calls.filter(call => call.table === 'finance_connections' && call.operation === 'update')[0]!.values)
      .toMatchObject({ credentials: null, token: null, accounts: null, selectedAccountId: null, operationId: null, refreshOnOpen: false });
    expect(test.p.issueToken).not.toHaveBeenCalled();
  });
  it('withdrawal still purges keys at the maximum version', async () => {
    const current = row({ version: 2_147_483_647 });
    const disconnected = { ...current, status: 'disconnected' as const, disconnectedAt: new Date(NOW), credentials: null, token: null,
      accounts: null, selectedAccountId: null, refreshOnOpen: false };
    const test = setup([[...membership(), [current], [], [disconnected]]]);
    const result = await test.service.disconnect(U, C, { householdId: H, expectedVersion: 2_147_483_647 });
    expect(result.item.status).toBe('disconnected');
    expect(test.calls.find(call => call.operation === 'update' && call.table === 'finance_connections')?.values)
      .toMatchObject({ version: 2_147_483_647, credentials: null, token: null, accounts: null });
  });
  it.each([2_147_483_646, 2_147_483_647])('reserves claim plus completion versions before any provider I/O at %s', async version => {
    const current = row({ version, tokenExpiresAt: new Date(NOW - 1) }), test = setup([[...membership(), [current], []]]);
    await expect(test.service.refresh(U, C, { householdId: H, requestId: R, expectedVersion: version })).rejects.toBeInstanceOf(ConflictException);
    expect(test.calls.some(call => call.operation !== 'select')).toBe(false);
    expect(test.p.issueToken).not.toHaveBeenCalled(); expect(test.p.holdings).not.toHaveBeenCalled();
  });
});
