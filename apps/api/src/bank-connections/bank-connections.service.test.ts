import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName, type SQL, type Table } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema, type Db } from '@family/database';
import type { BankConnectionRegister, ShinhanLoanCapture, BankObservation } from '@family/contracts';
import { FinanceVault } from '../finance-connections/finance-vault';
import { BankBrowserClient, BankBrowserError } from './bank-browser';
import { BankConnectionsService } from './bank-connections.service';
import { bankLoginFingerprint } from './bank-connections.policy';

const H = '11111111-1111-4111-8111-111111111111', U = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333', M = '44444444-4444-4444-8444-444444444444';
const R = '55555555-5555-4555-8555-555555555555', S = '66666666-6666-4666-8666-666666666666';
const NOW = Date.parse('2026-11-02T00:00:00Z');
const input = (): BankConnectionRegister => ({ householdId: H, connectionId: C, provider: 'shinhan_bank',
  loginId: 'synthetic-id', password: 'Synthetic!123', selector: { accountLast4: '1234', loanType: 'interim' },
  consentVersion: 1,
  consent: { ownAccount: true, storeCredentials: true, automaticLogin: true, refreshOnOpen: true } });
const vault = () => new FinanceVault({ get: () => ({ enabled: true, activeKeyVersion: 1,
  keyring: { '1': 'ab'.repeat(32) } }) } as unknown as ConfigService);
const context = { ownerUserId: U, provider: 'shinhan_bank' as const, connectionId: C, purpose: 'credentials' as const };
const capture: ShinhanLoanCapture = { formatVersion: 1, provider: 'shinhan', source: 'browser_assisted',
  origin: 'https://bank.shinhan.com', pageKind: 'loan_account_list', capturedAt: new Date(NOW).toISOString(),
  accountFingerprint: 'a'.repeat(64), accountLast4: '1234', loanType: 'interim',
  outstandingPrincipalKrw: '9007199254740993', maturityDate: null, bankAsOfDate: null };
type Row = typeof schema.bankConnections.$inferSelect;
function row(change: Partial<Row> = {}): Row {
  return { id: C, householdId: H, ownerUserId: U, memberId: M, memberJoinedAt: new Date(NOW - 1000),
    provider: 'shinhan_bank', loginFingerprint: bankLoginFingerprint(input().loginId), accountLast4: '1234', accountType: 'loan', loanType: 'interim',
    credentials: vault().encrypt({ loginId: input().loginId, password: input().password }, context),
    consentedAt: new Date(NOW), consentVersion: 1, refreshOnOpen: true, status: 'stored', version: 3, operationId: null,
    operationStartedAt: null, lastAttemptAt: null, lastSuccessAt: null, lastSnapshotId: null,
    selectedFingerprint: null, errorCode: null, createdAt: new Date(NOW), updatedAt: new Date(NOW), disconnectedAt: null, ...change };
}
const membership = () => [[{ id: M, role: 'owner' }], [{ id: H }]];
const storage = () => [{ available: true }];
type Query = { operation: string; table?: string; values?: unknown; where?: SQL };
/** Scripted DB/provider boundaries verify orchestration only, never PostgreSQL locks or HTTP auth. */
function setup(scripts: unknown[][][], available = true) {
  const calls: Query[] = [], remaining = [...scripts];
  const db = { transaction: async (run: (tx: unknown) => Promise<unknown>) => {
    const steps = remaining.shift();
    if (!steps) throw new Error('unexpected synthetic transaction');
    function builder(operation: string, table?: Table) {
      const call: Query = { operation, table: table && getTableName(table) };
      const chain = {
        from(value: Table) { call.table = getTableName(value); return chain; }, innerJoin() { return chain; },
        where(value: SQL) { call.where = value; return chain; }, for() { return chain; }, limit() { return chain; },
        orderBy() { return chain; }, returning() { return chain; },
        values(value: unknown) { call.values = value; return chain; }, set(value: unknown) { call.values = value; return chain; },
        then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) {
          calls.push(call);
          if (!steps!.length) return Promise.reject(new Error('unexpected synthetic query')).then(resolve, reject);
          return Promise.resolve(steps!.shift()!).then(resolve, reject);
        },
      };
      return chain;
    }
    const result = await run({ select: () => builder('select'), insert: (table: Table) => builder('insert', table),
      update: (table: Table) => builder('update', table), execute: () => builder('execute') });
    if (steps.length) throw new Error('unused synthetic query');
    return result;
  } } as unknown as Db;
  const browser = { available, configured: available, read: vi.fn(async (): Promise<BankObservation> => capture) };
  return { calls, remaining, browser, service: new BankConnectionsService(db, vault(), browser as unknown as BankBrowserClient) };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe('bank connection authorization and durable read boundaries', () => {
  it('GET checks exact membership and owner scope without bank I/O or credential disclosure', async () => {
    const test = setup([[...membership(), storage(), [row()]]]);
    const result = await test.service.list(U, H);
    expect(result.items[0]).toMatchObject({ ownerUserId: U, visibility: 'owner_only', includedInTotals: false });
    const query = test.calls.find(item => item.table === 'bank_connections')!;
    const sql = new PgDialect().sqlToQuery(query.where!).sql;
    expect(sql).toContain('"owner_user_id"');
    expect(sql).toContain('"joined_at" = "bank_connections"."member_joined_at"');
    for (const value of [input().loginId, input().password, 'ciphertext', 'loginFingerprint']) expect(JSON.stringify(result)).not.toContain(value);
    expect(test.browser.read).not.toHaveBeenCalled();
  });
  it('missing tables or revocation triggers leave storage disabled without asking for credentials', async () => {
    const test = setup([[...membership(), [{ available: false }]]]);
    expect(await test.service.list(U, H)).toEqual({ enabled: false, disabledReason: 'not_configured', items: [] });
    expect(test.browser.read).not.toHaveBeenCalled();
  });
  it('does not present a stored observation for a different account as a successful read', async () => {
    const test = setup([[...membership(), storage(), [row({ status: 'ready', lastSnapshotId: S })],
      [{ payload: { ...capture, accountLast4: '5678' } }]]]);
    const result = await test.service.list(U, H);
    expect(result.items[0]).toMatchObject({ status: 'error', errorCode: 'unsupported_layout', canRefresh: false, snapshot: null });
    expect(test.browser.read).not.toHaveBeenCalled();
  });
  it('viewer cannot register and input credentials are discarded on rejection', async () => {
    const test = setup([[[{ id: M, role: 'viewer' }]]]), body = input();
    await expect(test.service.register(U, body)).rejects.toBeInstanceOf(ForbiddenException);
    expect(body.loginId).toBe(''); expect(body.password).toBe(''); expect(test.browser.read).not.toHaveBeenCalled();
  });
  it('unconfigured runtime rejects registration before storing or sending credentials', async () => {
    const test = setup([[...membership()]], false), body = input();
    await expect(test.service.register(U, body)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(test.calls.some(call => call.operation === 'insert')).toBe(false);
    expect(test.browser.read).not.toHaveBeenCalled(); expect(body.password).toBe('');
  });
  it('a foreign or expired membership connection is absent and cannot be disconnected', async () => {
    const test = setup([[...membership(), []]]);
    await expect(test.service.disconnect(U, C, { householdId: H, expectedVersion: 3 })).rejects.toBeInstanceOf(NotFoundException);
    expect(test.browser.read).not.toHaveBeenCalled();
  });
  it('registration stores a provider-bound encrypted credential and does not log into the bank', async () => {
    const test = setup([[...membership(), storage(), [], []], [...membership(), [row()]]]), body = input();
    await test.service.register(U, body);
    const values = test.calls.find(call => call.operation === 'insert')!.values as Row;
    expect(vault().decrypt(values.credentials!, context)).toEqual({ loginId: 'synthetic-id', password: 'Synthetic!123' });
    const { memberJoinedAt, ...persistedFields } = values;
    expect(JSON.stringify(persistedFields)).not.toContain('Synthetic!123');
    expect(JSON.stringify(new PgDialect().sqlToQuery(memberJoinedAt as unknown as SQL).params)).not.toContain('Synthetic!123');
    expect(test.browser.read).not.toHaveBeenCalled(); expect(body.password).toBe('');
  });
  it('a repeated refresh request returns its existing state without another bank login', async () => {
    const current = row({ status: 'refreshing', operationId: R, operationStartedAt: new Date(NOW), version: 4 });
    const test = setup([[...membership(), storage(), [current], [{ id: R }]], [...membership(), [current]]]);
    expect((await test.service.refresh(U, C, { householdId: H, expectedVersion: 3, requestId: R })).item.status).toBe('refreshing');
    expect(test.browser.read).not.toHaveBeenCalled();
  });
  it('commits one successful observation without converting large KRW integers', async () => {
    const busy = row({ status: 'refreshing', operationId: R, operationStartedAt: new Date(NOW), version: 4 });
    const done = row({ status: 'ready', version: 5, lastSnapshotId: R, selectedFingerprint: capture.accountFingerprint });
    const test = setup([[...membership(), storage(), [row()], [], [], [], [], [], [busy]],
      [...membership(), [busy]], [...membership(), [busy], [], []], [...membership(), [done], [{ payload: capture }]]]);
    const result = await test.service.refresh(U, C, { householdId: H, expectedVersion: 3, requestId: R });
    expect(result.item.snapshot).toMatchObject({outstandingPrincipalKrw:'9007199254740993'});
    expect(test.browser.read).toHaveBeenCalledTimes(1); expect(test.remaining).toHaveLength(0);
  });
  it('failed layout retains the last successful snapshot rather than setting the debt to zero', async () => {
    const current = row({ status: 'ready', lastSnapshotId: S }), busy = { ...current, status: 'refreshing' as const,
      operationId: R, operationStartedAt: new Date(NOW), version: 4 };
    const failed = { ...current, status: 'error' as const, errorCode: 'unsupported_layout', version: 5 };
    const test = setup([[...membership(), storage(), [current], [], [], [], [], [], [busy]],
      [...membership(), [busy]], [...membership(), [busy], [], []], [...membership(), [failed], [{ payload: capture }]]]);
    test.browser.read.mockRejectedValueOnce(new BankBrowserError('unsupported_layout'));
    const result = await test.service.refresh(U, C, { householdId: H, expectedVersion: 3, requestId: R });
    expect(result.item).toMatchObject({ canRefresh: false, errorCode: 'unsupported_layout', snapshot: capture });
    const update = test.calls.find(call => call.operation === 'update' && call.table === 'bank_connections' && (call.values as Row).status === 'error');
    expect(update?.values).not.toHaveProperty('lastSnapshotId');
  });
  it('does not save a late bank response after disconnection invalidates the grant', async () => {
    const busy = row({ status: 'refreshing', operationId: R, operationStartedAt: new Date(NOW), version: 4 });
    const disconnected = row({ status: 'disconnected', version: 5, disconnectedAt: new Date(NOW), credentials: null, refreshOnOpen: false });
    const test = setup([[...membership(), storage(), [row()], [], [], [], [], [], [busy]],
      [...membership(), [busy]], [...membership(), [disconnected]], [...membership(), [disconnected]]]);
    expect((await test.service.refresh(U, C, { householdId: H, expectedVersion: 3, requestId: R })).item.status).toBe('disconnected');
    expect(test.calls.some(call => call.operation === 'update' && call.table === 'bank_connection_snapshots')).toBe(false);
  });
  it('registers deposits with separate explicit consent and no invented loan subtype', async () => {
    const deposit=row({accountType:'deposit',loanType:null,consentVersion:2});
    const test=setup([[...membership(),storage(),[],[]],[...membership(),[deposit]]]);
    const body:BankConnectionRegister={...input(),consentVersion:2,selector:{accountType:'deposit',accountLast4:'1234'}};
    const result=await test.service.register(U,body);
    expect(test.calls.find(call=>call.operation==='insert')?.values).toMatchObject({accountType:'deposit',loanType:null,consentVersion:2});
    expect(result.item.selector).toEqual({accountType:'deposit',accountLast4:'1234'});
    expect(test.browser.read).not.toHaveBeenCalled();expect(body.password).toBe('');
  });
  it('stores a selected deposit balance without adding it to family totals',async()=>{
    const observation:BankObservation={formatVersion:1,provider:'shinhan',source:'browser_assisted',origin:'https://bank.shinhan.com',pageKind:'deposit_account_list',capturedAt:new Date(NOW).toISOString(),accountFingerprint:'b'.repeat(64),accountLast4:'1234',currency:'KRW',balanceKind:'ledger',balanceKrw:'0',bankAsOfDate:null};
    const current=row({accountType:'deposit',loanType:null,consentVersion:2});
    const busy={...current,status:'refreshing' as const,operationId:R,operationStartedAt:new Date(NOW),version:4};
    const done={...current,status:'ready' as const,version:5,lastSnapshotId:R,selectedFingerprint:observation.accountFingerprint};
    const test=setup([[...membership(),storage(),[current],[],[],[],[],[],[busy]],[...membership(),[busy]],[...membership(),[busy],[],[]],[...membership(),[done],[{payload:observation}]]]);
    test.browser.read.mockResolvedValueOnce(observation);
    const result=await test.service.refresh(U,C,{householdId:H,expectedVersion:3,requestId:R});
    expect(result.item).toMatchObject({visibility:'owner_only',includedInTotals:false,snapshot:{pageKind:'deposit_account_list',balanceKrw:'0'}});
    expect(test.browser.read).toHaveBeenCalledWith(expect.anything(),{accountLast4:'1234',accountType:'deposit'},expect.any(AbortSignal));
  });
  it('a deposit connection never displays a loan snapshot with the same last four digits',async()=>{
    const test=setup([[...membership(),storage(),[row({accountType:'deposit',loanType:null,consentVersion:2,status:'ready',lastSnapshotId:S})],[{payload:capture}]]]);
    expect((await test.service.list(U,H)).items[0]).toMatchObject({snapshot:null,status:'error',errorCode:'unsupported_layout'});
  });
});
