import { createHash } from 'node:crypto';
import type { BankConnectionError } from '@family/contracts';

export const BANK_REFRESH_INTERVAL_MS = 15 * 60_000;
export const BANK_OPERATION_TIMEOUT_MS = 90_000;
export const bankLoginFingerprint = (loginId: string) => createHash('sha256').update('moa:shinhan-login:v1\0').update(loginId.toLowerCase()).digest('hex');
export function projectBankState(row: { status: string; disconnectedAt: Date | null; operationId: string | null;
  operationStartedAt: Date | null; lastAttemptAt: Date | null; credentials: unknown; errorCode: string | null; version: number }, enabled: boolean, now = Date.now()) {
  let status = row.status as 'stored' | 'refreshing' | 'ready' | 'error' | 'reauth_required' | 'disconnected';
  let errorCode = row.errorCode as BankConnectionError | null;
  const next = row.lastAttemptAt ? new Date(row.lastAttemptAt.getTime() + BANK_REFRESH_INTERVAL_MS) : null;
  if (row.disconnectedAt) return { status: 'disconnected' as const, errorCode: null, nextRefreshAt: null, canRefresh: false };
  if (row.operationId && row.operationStartedAt && now - row.operationStartedAt.getTime() >= BANK_OPERATION_TIMEOUT_MS) {
    status = 'error'; errorCode = 'operation_unknown';
  }
  const retryable = errorCode === null || errorCode === 'network_error' || errorCode === 'runtime_unavailable';
  return { status, errorCode, nextRefreshAt: next?.toISOString() ?? null,
    canRefresh: enabled && !!row.credentials && !row.operationId && row.version <= 2_147_483_645
      && ['stored', 'ready', 'error'].includes(status) && retryable && (!next || next.getTime() <= now) };
}
