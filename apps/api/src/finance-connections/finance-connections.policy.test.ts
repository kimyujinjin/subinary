import { describe, expect, it } from 'vitest';
import { financeAccountId, financeClientFingerprint, financeRetryNotBefore, projectFinanceState, type ConnectionState } from './finance-connections.policy';

const now = Date.parse('2026-01-01T12:00:00Z');
const base: ConnectionState = { status: 'ready', disconnectedAt: null, operationId: null, operationStartedAt: null,
  tokenExpiresAt: new Date(now + 600_000), selectedAccountId: 'a'.repeat(64), lastAttemptAt: null,
  errorCode: null, tokenIssuance: 'complete', retryNotBefore: null };
describe('owner finance connection state policy', () => {
  it('binds opaque choices to the connection and separates the client fingerprint domain', () => {
    expect(financeAccountId('one', '9007199254740993')).not.toBe(financeAccountId('two', '9007199254740993'));
    expect(financeAccountId('one', '12')).not.toBe(financeAccountId('one1', '2'));
    expect(financeClientFingerprint('synthetic')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('permits only configured, selected, idle connections', () => {
    expect(projectFinanceState(base, true, now).canRefresh).toBe(true);
    for (const change of [{ selectedAccountId: null }, { status: 'select_account' as const },
      { operationId: 'read', operationStartedAt: new Date(now) }, { status: 'reauth_required' as const }]) {
      expect(projectFinanceState({ ...base, ...change }, true, now).canRefresh).toBe(false);
    }
    expect(projectFinanceState(base, false, now).canRefresh).toBe(false);
  });
  it('allows exactly known expiry to enter the durable renewal path, never early renewal', () => {
    expect(projectFinanceState({ ...base, tokenExpiresAt: new Date(now) }, true, now)).toMatchObject({ status: 'ready', canRefresh: true });
    expect(projectFinanceState({ ...base, tokenExpiresAt: new Date(now + 20_000) }, true, now))
      .toMatchObject({ status: 'ready', canRefresh: false, nextRefreshAt: new Date(now + 20_000).toISOString() });
    for (const tokenIssuance of ['started', 'uncertain'] as const) {
      expect(projectFinanceState({ ...base, tokenIssuance, tokenExpiresAt: new Date(now - 1) }, true, now).canRefresh).toBe(false);
    }
  });
  it('does not retry externally invalidated credentials even after expiry', () => {
    expect(projectFinanceState({ ...base, status: 'reauth_required', errorCode: 'token_expired', tokenExpiresAt: new Date(now - 1) }, true, now))
      .toMatchObject({ status: 'reauth_required', errorCode: 'token_expired', canRefresh: false });
  });
  it('throttles opens/refresh clicks and preserves failure state', () => {
    expect(projectFinanceState({ ...base, status: 'error', errorCode: 'provider_unavailable', lastAttemptAt: new Date(now - 1_000) }, true, now))
      .toMatchObject({ status: 'error', canRefresh: false, nextRefreshAt: new Date(now + 59_000).toISOString() });
    expect(projectFinanceState({ ...base, lastAttemptAt: new Date(now - 60_000) }, true, now).canRefresh).toBe(true);
  });
  it('marks abandoned operations unknown without making another issuance eligible', () => {
    expect(projectFinanceState({ ...base, status: 'connecting', operationId: 'connect', operationStartedAt: new Date(now - 90_000), tokenIssuance: 'started' }, true, now))
      .toMatchObject({ status: 'reauth_required', errorCode: 'token_uncertain', canRefresh: false });
    expect(projectFinanceState({ ...base, status: 'refreshing', operationId: 'read', operationStartedAt: new Date(now - 90_000) }, true, now))
      .toMatchObject({ status: 'error', errorCode: 'operation_unknown', canRefresh: false });
  });
  it('disconnect always wins over stale status/token and a late response', () => {
    expect(projectFinanceState({ ...base, disconnectedAt: new Date(now), operationId: 'late' }, true, now))
      .toEqual({ status: 'disconnected', errorCode: null, canRefresh: false, nextRefreshAt: null });
  });
  it('waits for the longer provider deadline after the default 60-second interval passes', () => {
    const row = { ...base, status: 'error' as const, errorCode: 'rate_limited', lastAttemptAt: new Date(now), retryNotBefore: new Date(now + 120_000) };
    expect(projectFinanceState(row, true, now + 61_000)).toMatchObject({ canRefresh: false, nextRefreshAt: new Date(now + 120_000).toISOString() });
    expect(projectFinanceState(row, true, now + 120_000).canRefresh).toBe(true);
    expect(row.lastAttemptAt.getTime()).toBe(now);
  });
  it('a shorter provider deadline cannot reduce the normal refresh interval', () => {
    expect(projectFinanceState({ ...base, lastAttemptAt: new Date(now), retryNotBefore: new Date(now + 17_000) }, true, now))
      .toMatchObject({ canRefresh: false, nextRefreshAt: new Date(now + 60_000).toISOString() });
  });
  it('bounds extreme retry metadata without converting it into an early retry', () => {
    for (const seconds of [null, -1, NaN, Infinity, 0.5]) expect(financeRetryNotBefore(seconds, new Date(now))).toBeNull();
    expect(financeRetryNotBefore(120, new Date(now))?.toISOString()).toBe(new Date(now + 120_000).toISOString());
    expect(financeRetryNotBefore(Number.MAX_SAFE_INTEGER, new Date(now))?.toISOString()).toBe('9999-12-31T23:59:59.999Z');
  });
});
