import { createHash } from 'node:crypto';
import type { FinanceConnectionError, FinanceConnectionStatus } from '@family/contracts';

export const FINANCE_REFRESH_INTERVAL_MS = 60_000;
export const FINANCE_OPERATION_TIMEOUT_MS = 90_000;
export const FINANCE_TOKEN_MARGIN_MS = 30_000;
export const financeClientFingerprint = (clientId: string): string => createHash('sha256')
  .update('toss-securities-client-v1\0').update(clientId).digest('hex');
export const financeAccountId = (connectionId: string, providerKey: string): string => createHash('sha256')
  .update('toss-securities-account-v1\0').update(connectionId).update('\0').update(providerKey).digest('hex');

export interface ConnectionState {
  status: FinanceConnectionStatus; disconnectedAt: Date | null; operationId: string | null;
  operationStartedAt: Date | null; tokenExpiresAt: Date | null; selectedAccountId: string | null;
  lastAttemptAt: Date | null; retryNotBefore: Date | null; errorCode: string | null; tokenIssuance: 'started' | 'complete' | 'uncertain';
}
/** Invalid metadata is ignored; enormous delays fail closed at the last four-digit year. */
export function financeRetryNotBefore(seconds: number | null, now: Date): Date | null {
  if (seconds === null || !Number.isFinite(seconds) || !Number.isInteger(seconds) || seconds < 0) return null;
  return new Date(Math.min(Date.parse('9999-12-31T23:59:59.999Z'), now.getTime() + seconds * 1_000));
}
/** Projection only: GET never renews a token or performs provider I/O. */
export function projectFinanceState(row: ConnectionState, configured: boolean, now = Date.now()) {
  let nextRefreshAt = row.lastAttemptAt ? new Date(row.lastAttemptAt.getTime() + FINANCE_REFRESH_INTERVAL_MS) : null;
  if (row.retryNotBefore) nextRefreshAt = new Date(Math.max(row.retryNotBefore.getTime(), nextRefreshAt?.getTime() ?? 0));
  let status = row.status;
  let errorCode = row.errorCode as FinanceConnectionError | null;
  if (row.disconnectedAt) return { status: 'disconnected' as const, errorCode: null, canRefresh: false, nextRefreshAt: null };
  if (row.operationId && row.operationStartedAt && now - row.operationStartedAt.getTime() >= FINANCE_OPERATION_TIMEOUT_MS) {
    status = row.status === 'connecting' ? 'reauth_required' : 'error';
    errorCode = row.status === 'connecting' ? 'token_uncertain' : 'operation_unknown';
  }
  // An explicitly reported 401/uncertain issuance stays reauth_required. A normal
  // documented expiry is renewable once, inside the next user-triggered claim.
  const expiresAt = row.tokenExpiresAt?.getTime();
  const knownExpired = expiresAt !== undefined && expiresAt <= now && row.tokenIssuance === 'complete';
  const usableToken = expiresAt !== undefined && expiresAt > now + FINANCE_TOKEN_MARGIN_MS;
  if (expiresAt !== undefined && expiresAt > now && !usableToken) {
    nextRefreshAt = new Date(Math.max(expiresAt, nextRefreshAt?.getTime() ?? 0));
  }
  const canRefresh = configured && Boolean(row.selectedAccountId) && !row.operationId
    && (usableToken || knownExpired)
    && ['ready', 'error'].includes(status) && (!nextRefreshAt || nextRefreshAt.getTime() <= now);
  return { status, errorCode, canRefresh, nextRefreshAt: nextRefreshAt?.toISOString() ?? null };
}
