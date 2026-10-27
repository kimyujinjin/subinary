import { z } from 'zod';

/** Budget scope (PRD §7.2; mirrors DB `budgetScopeType`). */
export const budgetScopeTypeSchema = z.enum([
  'household',
  'member',
  'category',
  'card',
  'card_group',
]);
export type BudgetScopeType = z.infer<typeof budgetScopeTypeSchema>;

/** Budget recurrence (mirrors DB `budgetPeriod`). Only monthly budgets in Phase 5. */
const budgetPeriodSchema = z.enum(['monthly']);

/** 서울 기준 회계월 키. DB에는 이 달의 1일을 `date`로 저장한다. */
export const budgetMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format');
export type BudgetMonth = z.infer<typeof budgetMonthSchema>;

// --- Requests ---

/** 중복 없는 개인 카드 묶음. 서버에서 같은 가구·소유자·활성 상태도 검증한다. */
const budgetCardIdsSchema = z.array(z.string().uuid()).min(2).max(20).refine(
  (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
  '카드를 중복해서 선택할 수 없습니다.',
);

/**
 * `POST /v1/budgets` — create a monthly budget under a household (Phase 5 §5.2).
 * `scopeRefId` targets the member/category/card the budget applies to and is
 * omitted for `household`-wide budgets. Only owners/admins may create (PRD §7.2).
 * `amount` is a positive KRW integer.
 */
export const budgetCreateRequestSchema = z.object({
  householdId: z.string().uuid(),
  name: z.string().max(100).optional(),
  scopeType: budgetScopeTypeSchema,
  scopeRefId: z.string().uuid().optional(),
  cardIds: budgetCardIdsSchema.optional(),
  amount: z.number().int().positive(),
  /** 생략하면 서울 기준 현재월. 과거월 생성은 서버가 거부한다. */
  effectiveMonth: budgetMonthSchema.optional(),
}).superRefine((input, ctx) => {
  if (input.scopeType === 'card_group') {
    if (!input.cardIds) ctx.addIssue({ code: 'custom', path: ['cardIds'], message: '합산할 카드를 2개 이상 선택해 주세요.' });
    if (input.scopeRefId) ctx.addIssue({ code: 'custom', path: ['scopeRefId'], message: '카드 묶음은 cardIds를 사용합니다.' });
  } else if (input.cardIds !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['cardIds'], message: '카드 묶음 예산에서만 사용할 수 있습니다.' });
  }
});
export type BudgetCreateRequest = z.infer<typeof budgetCreateRequestSchema>;

/** 이름·한도 수정 또는 카드 범위 정정. 과거월은 범위만 정정할 수 있다. */
export const budgetUpdateRequestSchema = z.object({
  name: z.string().max(100).optional(),
  amount: z.number().int().positive().optional(),
  scopeType: z.literal('card_group').optional(),
  cardIds: budgetCardIdsSchema.optional(),
  /** 직전에 조회한 카드 범위. 단일 카드 예산은 [scopeRefId]를 보낸다. */
  expectedCardIds: z.array(z.string().uuid()).min(1).max(20).optional(),
}).superRefine((input, ctx) => {
  if (input.scopeType !== undefined || input.cardIds !== undefined || input.expectedCardIds !== undefined) {
    if (input.scopeType !== 'card_group' || !input.cardIds || !input.expectedCardIds) {
      ctx.addIssue({ code: 'custom', path: ['cardIds'], message: '범위 정정에는 scopeType, cardIds, expectedCardIds가 모두 필요합니다.' });
    }
  }
});
export type BudgetUpdateRequest = z.infer<typeof budgetUpdateRequestSchema>;

/**
 * `POST /v1/budgets/copy` — 한 달의 계획을 바로 다음 달로 명시적으로 복사한다.
 * 같은 사용자 동작의 네트워크 재시도는 HTTP `Idempotency-Key` 헤더로 식별한다.
 */
export const budgetCopyRequestSchema = z.object({
  householdId: z.string().uuid(),
  sourceMonth: budgetMonthSchema,
  targetMonth: budgetMonthSchema,
});
export type BudgetCopyRequest = z.infer<typeof budgetCopyRequestSchema>;

/** 성공한 복사의 안정 응답. 같은 `Idempotency-Key` 재시도에도 같은 ID 집합을 돌려준다. */
export const budgetCopyResponseSchema = z.object({
  sourceMonth: budgetMonthSchema,
  targetMonth: budgetMonthSchema,
  copiedCount: z.number().int().nonnegative(),
  copiedBudgetIds: z.array(z.string().uuid()),
});
export type BudgetCopyResponse = z.infer<typeof budgetCopyResponseSchema>;

// --- Responses ---

/**
 * Budget projection with the selected month's usage (Phase 5 §1.4).
 * `spent` sums `netAmount` over approval transactions within the budget scope,
 * honoring the analytics visibility rules; `remaining = amount - spent` and
 * `usageRate = spent / amount`. `scopeLabel` is the display name for the scope
 * ('가족 전체' / member name / category name / card alias). Amounts are KRW integers.
 */
export const budgetSummarySchema = z.object({
  id: z.string(),
  householdId: z.string(),
  name: z.string().nullable(),
  scopeType: budgetScopeTypeSchema,
  scopeRefId: z.string().nullable(),
  /** 카드 묶음의 고정 범위. 기존 단일 범위 예산은 빈 배열이다. */
  cardIds: z.array(z.string().uuid()).default([]),
  scopeLabel: z.string(),
  effectiveMonth: budgetMonthSchema,
  amount: z.number().int(),
  spent: z.number().int(),
  /** 선택월을 포함한 최근 3개 회계월 실지출 평균. 저장값이 아닌 파생값이다. */
  threeMonthAverageSpent: z.number().int(),
  remaining: z.number().int(),
  usageRate: z.number(),
  period: budgetPeriodSchema,
  currency: z.string(),
});
export type BudgetSummary = z.infer<typeof budgetSummarySchema>;

/** `GET /v1/budgets` — budgets for a household with `month=YYYY-MM` usage. */
export const budgetListResponseSchema = z.object({
  items: z.array(budgetSummarySchema),
  month: budgetMonthSchema,
});
export type BudgetListResponse = z.infer<typeof budgetListResponseSchema>;
