import { BadRequestException } from '@nestjs/common';
import type { HouseholdRole } from '@family/contracts';
import { schema } from '@family/database';
import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';

/** The review inbox is an actionable subset, never an automatic posting queue. */
export function transactionReviewScope(
  raw: string | undefined,
  actor: { memberId: string; role: HouseholdRole },
): SQL | undefined {
  if (raw === undefined) return undefined;
  if (raw !== '1') throw new BadRequestException('review must be 1');
  return and(
    inArray(schema.cardTransactions.status, ['pending_review', 'duplicate_suspected']),
    isNull(schema.cardTransactions.excludedAt),
    // Match the existing mutation authority while retaining the list's separate
    // household/visibility conditions. A member cannot resolve someone else's row.
    actor.role === 'owner' || actor.role === 'admin'
      ? or(eq(schema.cardTransactions.memberId, actor.memberId), eq(schema.cardTransactions.visibility, 'household'))
      : eq(schema.cardTransactions.memberId, actor.memberId),
  );
}
