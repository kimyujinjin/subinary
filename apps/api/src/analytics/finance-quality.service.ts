import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';

import { financeQualityQuerySchema, financeQualitySchema, type FinanceQuality } from '@family/contracts';
import { schema, visibilityScope, type Db } from '@family/database';

import { DB } from '../database/database.constants';

/** 제외 거래와 다른 구성원의 비공개 거래는 품질 집계에서도 제외한다. */
export function financeQualityTransactionScope(householdId: string, actorMemberId: string): SQL {
  return and(
    eq(schema.cardTransactions.householdId, householdId),
    isNull(schema.cardTransactions.excludedAt),
    visibilityScope(actorMemberId),
  ) as SQL;
}

/** SMS에는 거래 공개범위가 없으므로 반드시 수신 구성원 본인만 센다. */
export function financeQualitySmsScope(householdId: string, actorMemberId: string): SQL {
  return and(
    eq(schema.cardSmsEvents.householdId, householdId),
    eq(schema.cardSmsEvents.memberId, actorMemberId),
  ) as SQL;
}

@Injectable()
export class FinanceQualityService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** 활동 중인 가구 구성원에게 원문 없는 전 기간 검토 상태를 반환한다. */
  async read(userId: string, householdId: string | undefined): Promise<FinanceQuality> {
    const query = financeQualityQuerySchema.safeParse({ householdId });
    if (!query.success) {
      throw new BadRequestException('유효한 householdId가 필요합니다.');
    }
    const hh = query.data.householdId;
    const [member] = await this.db
      .select({ id: schema.householdMembers.id })
      .from(schema.householdMembers)
      .innerJoin(schema.households, eq(schema.households.id, schema.householdMembers.householdId))
      .where(and(
        eq(schema.householdMembers.householdId, hh),
        eq(schema.householdMembers.userId, userId),
        eq(schema.householdMembers.status, 'active'),
        isNull(schema.households.deletedAt),
      ))
      .limit(1);
    if (!member) throw new ForbiddenException('가구 구성원 권한이 없습니다.');

    const transaction = schema.cardTransactions;
    const card = schema.paymentCards;
    const sms = schema.cardSmsEvents;
    const asOf = new Date().toISOString();
    const [transactionRows, smsRows] = await Promise.all([
      this.db.select({
        uncategorized: sql<number>`count(*) filter (where ${transaction.transactionType} = 'approval' and ${transaction.categoryId} is null)`.mapWith(Number),
        duplicateSuspected: sql<number>`count(*) filter (where ${transaction.transactionType} = 'approval' and ${transaction.status} = 'duplicate_suspected')`.mapWith(Number),
        unlinkedCancellations: sql<number>`count(*) filter (where ${transaction.transactionType} = 'cancellation' and ${transaction.parentTransactionId} is null)`.mapWith(Number),
        cardOwnerMismatches: sql<number>`count(*) filter (where ${card.isShared} = false and ${card.ownerMemberId} <> ${transaction.memberId})`.mapWith(Number),
      })
        .from(transaction)
        .leftJoin(card, and(eq(card.id, transaction.cardId), eq(card.householdId, hh)))
        .where(financeQualityTransactionScope(hh, member.id)),
      this.db.select({
        pending: sql<number>`count(*) filter (where ${sms.parseStatus} = 'pending')`.mapWith(Number),
        parseFailed: sql<number>`count(*) filter (where ${sms.parseStatus} = 'parse_failed')`.mapWith(Number),
        pendingReview: sql<number>`count(*) filter (where ${sms.parseStatus} = 'pending_review')`.mapWith(Number),
        quarantined: sql<number>`count(*) filter (where ${sms.parseStatus} = 'quarantined')`.mapWith(Number),
        ignored: sql<number>`count(*) filter (where ${sms.parseStatus} = 'ignored')`.mapWith(Number),
        lastReceivedAt: sql<string | null>`max(${sms.receivedAt})::text`,
      })
        .from(sms)
        .where(financeQualitySmsScope(hh, member.id)),
    ]);

    const transactions = transactionRows[0] ?? {
      uncategorized: 0, duplicateSuspected: 0, unlinkedCancellations: 0, cardOwnerMismatches: 0,
    };
    const ownSms = smsRows[0] ?? {
      pending: 0, parseFailed: 0, pendingReview: 0, quarantined: 0, ignored: 0, lastReceivedAt: null,
    };
    return financeQualitySchema.parse({
      asOf,
      scope: { period: 'all_time', transactions: 'visible_non_excluded', sms: 'own_member' },
      transactions,
      sms: {
        ...ownSms,
        lastReceivedAt: ownSms.lastReceivedAt === null
          ? null
          : new Date(ownSms.lastReceivedAt).toISOString(),
      },
    });
  }
}
