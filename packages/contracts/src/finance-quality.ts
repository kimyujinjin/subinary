import { z } from 'zod';

/** 금융 품질 조회는 로그인 사용자의 가구 하나를 명시해야 한다. */
export const financeQualityQuerySchema = z.object({
  householdId: z.string().uuid(),
});

/**
 * 금융 요약의 완전성을 판단할 검토 건수. 월 지출과 달리 전 기간 적체를 센다.
 * 거래는 기존 공개범위를 따르고, SMS는 원문·가맹점 없이 본인의 건수만 돌려준다.
 * 항목이 겹칠 수 있으므로 카운트 합계를 서로 다른 문제의 개수로 사용하지 않는다.
 */
export const financeQualitySchema = z.object({
  asOf: z.string().datetime(),
  scope: z.object({
    period: z.literal('all_time'),
    transactions: z.literal('visible_non_excluded'),
    sms: z.literal('own_member'),
  }),
  transactions: z.object({
    uncategorized: z.number().int().nonnegative(),
    duplicateSuspected: z.number().int().nonnegative(),
    unlinkedCancellations: z.number().int().nonnegative(),
    /** 공용 카드 제외. 소유자 불일치는 확인 후보이며 오류 확정이 아니다. */
    cardOwnerMismatches: z.number().int().nonnegative(),
  }),
  sms: z.object({
    pending: z.number().int().nonnegative(),
    parseFailed: z.number().int().nonnegative(),
    pendingReview: z.number().int().nonnegative(),
    quarantined: z.number().int().nonnegative(),
    ignored: z.number().int().nonnegative(),
    lastReceivedAt: z.string().datetime().nullable(),
  }),
});

export type FinanceQuality = z.infer<typeof financeQualitySchema>;
