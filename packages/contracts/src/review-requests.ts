import { z } from 'zod';

/**
 * 가족에게 결제 물어보기(확인 요청, 2026-11-04 홈 개편).
 *
 * 한 사람이 가족 공개 결제 하나를 골라 다른 구성원에게 "이거 뭐였어?"를 묻는다. 받은
 * 사람이 '확인했어요'를 누르면 닫히고 물어본 사람에게 알린다. 금액·분류·공개 범위는
 * 바꾸지 않는다 — 대화의 시작점일 뿐 거래 편집이 아니다.
 *
 * 가족 공개(`household`) 결제만 물어볼 수 있다. 나만 보기·요약만 공개 결제를 남에게
 * 물어보면 공개 범위가 무의미해진다.
 */
const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });

/** `POST /v1/review-requests` */
export const reviewRequestCreateSchema = z
  .object({ householdId: uuid, transactionId: uuid, assigneeMemberId: uuid })
  .strict();
export type ReviewRequestCreate = z.infer<typeof reviewRequestCreateSchema>;

/** `POST /v1/review-requests/:id/resolve` — 받은 사람은 '확인했어요', 물어본 사람은 취소. */
export const reviewRequestResolveSchema = z.object({ householdId: uuid }).strict();
export type ReviewRequestResolve = z.infer<typeof reviewRequestResolveSchema>;

/** 열린 요청 한 건. 나를 기준으로 받은 것(`received`)과 보낸 것(`sent`)을 가른다. */
export const reviewRequestSummarySchema = z
  .object({
    id: uuid,
    householdId: uuid,
    transactionId: uuid,
    requesterMemberId: uuid,
    requesterName: z.string(),
    assigneeMemberId: uuid,
    assigneeName: z.string(),
    direction: z.enum(['received', 'sent']),
    /** 표시용 가맹점명(정규화 우선). 없으면 null. */
    merchant: z.string().nullable(),
    /** 결제 금액(minor units). */
    amount: z.number().int(),
    currency: z.string(),
    occurredAt: instant,
    createdAt: instant,
  })
  .strict();
export type ReviewRequestSummary = z.infer<typeof reviewRequestSummarySchema>;

/** `GET /v1/review-requests?householdId=&transactionId=` — 나와 관련된 열린 요청(최신순). */
export const reviewRequestListResponseSchema = z
  .object({ items: z.array(reviewRequestSummarySchema) })
  .strict();
export type ReviewRequestListResponse = z.infer<typeof reviewRequestListResponseSchema>;

export const reviewRequestResolveResponseSchema = z.object({ resolved: z.literal(true) }).strict();
export type ReviewRequestResolveResponse = z.infer<typeof reviewRequestResolveResponseSchema>;
