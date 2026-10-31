import type { CardSmsPosting } from '@family/contracts';
import type { schema } from '@family/database';

type PostingEvent = Pick<schema.CardSmsEvent, 'householdId' | 'parseStatus' | 'transactionType' | 'currency'>;
export type PostedTransaction = Pick<schema.CardTransaction, 'id' | 'householdId' | 'memberId' | 'visibility' | 'status'>;

/** Read-only projection. A missing snapshot is today's observable condition, not a job diagnosis. */
export function cardSmsPosting(
  event: PostingEvent,
  transaction: PostedTransaction | null,
  snapshotExists: boolean,
  mode: string | undefined,
  actorMemberId: string,
): CardSmsPosting {
  if (transaction) {
    const visible = transaction.householdId === event.householdId && (
      transaction.memberId === actorMemberId || transaction.visibility !== 'private'
    );
    return { status: 'posted', transactionId: visible ? transaction.id : null,
      transactionStatus: visible ? transaction.status : null, reason: null };
  }
  const empty = { transactionId: null, transactionStatus: null } as const;
  if (event.parseStatus === 'pending') return { ...empty, status: 'pending', reason: 'parsing' };
  if (event.parseStatus === 'parse_failed' || event.parseStatus === 'quarantined') {
    return { ...empty, status: 'needs_review', reason: event.parseStatus };
  }
  if (event.parseStatus === 'ignored') return { ...empty, status: 'not_applicable', reason: 'ignored' };
  if (event.transactionType === 'declined') return { ...empty, status: 'not_applicable', reason: 'declined' };
  if (event.transactionType !== 'approval' && event.transactionType !== 'cancellation') {
    return { ...empty, status: 'not_applicable', reason: 'unsupported_message' };
  }
  const needsSnapshot = mode === 'v2' && (event.currency ?? 'KRW').toUpperCase() !== 'KRW';
  return { ...empty, status: 'pending', reason: needsSnapshot && !snapshotExists ? 'fx_snapshot_missing' : 'processing' };
}
