import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { transactionReviewScope } from './review-filter';

const memberId = '11111111-1111-4111-8111-111111111111';
const dialect = new PgDialect();
describe('actionable transaction review filter', () => {
  it('leaves existing list queries unchanged when absent', () => {
    expect(transactionReviewScope(undefined, { memberId, role: 'member' })).toBeUndefined();
  });
  it('rejects an invalid filter instead of silently displaying an unfiltered queue', () => {
    for (const raw of ['', '0', 'true', 'pending', 'all']) {
      expect(() => transactionReviewScope(raw, { memberId, role: 'member' })).toThrow('review must be 1');
    }
  });
  it('includes both unresolved statuses and limits ordinary members to their actionable rows', () => {
    const q = dialect.sqlToQuery(transactionReviewScope('1', { memberId, role: 'member' })!);
    expect(q.params).toEqual(['pending_review', 'duplicate_suspected', memberId]);
    expect(q.sql).toContain('"excluded_at" is null');
    expect(q.sql).toContain('"member_id" =');
  });
  it('limits owner/admin reviews to detail-readable rows, excluding masked summary-only rows', () => {
    for (const role of ['owner', 'admin'] as const) {
      const q = dialect.sqlToQuery(transactionReviewScope('1', { memberId, role })!);
      expect(q.params).toEqual(['pending_review', 'duplicate_suspected', memberId, 'household']);
      expect(q.sql).toContain('"excluded_at" is null');
    }
  });
});
