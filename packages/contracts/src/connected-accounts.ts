import { z } from 'zod';

/** 가족 공유 동의 문구. 문구를 바꾸면 버전을 올린다(동의 이력과 함께 저장). */
export const CONNECTED_ACCOUNT_SHARING_CONSENT_TEXT =
  '내가 연결한 계좌(토스증권 보유 주식, 신한은행 통장 잔액·대출 원금)의 최근 조회 금액을 가족 구성원에게 보여주고 가족 자산 합계에 포함하는 데 동의해요. 로그인 정보·API 키·계좌 번호는 공유하지 않으며, 언제든 공유를 끌 수 있어요.';
export const CONNECTED_ACCOUNT_SHARING_CONSENT_VERSION = 1 as const;

const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/);

/**
 * 자산 목록·합계에 들어가는 연결 계좌 한 건. 금액만 담는다 — 자격 증명·계좌 식별자·원 응답은 담지 않는다.
 * `kind`는 자산 화면의 묶음(account=통장·현금, stock=주식, loan=대출)이다.
 */
export const connectedAccountHoldingSchema = z.object({
  id: z.string().min(1).max(200),
  ownerUserId: z.string().uuid(),
  ownerName: z.string().max(100),
  own: z.boolean(),
  provider: z.enum(['toss_securities', 'shinhan_bank']),
  kind: z.enum(['account', 'stock', 'loan']),
  label: z.string().max(100),
  /** 원화 금액(원 단위, 10진). 없으면 null. */
  krw: decimal.nullable(),
  /** 달러 금액(10진). 주식에만 있다. */
  usd: decimal.nullable(),
  observedAt: z.string().datetime(),
  /** 마지막 성공 이후 실패·서비스 중지로 이전 값을 보여주는 중. */
  stale: z.boolean(),
}).strict();
export type ConnectedAccountHolding = z.infer<typeof connectedAccountHoldingSchema>;

export const connectedAccountsResponseSchema = z.object({
  sharing: z.object({ shared: z.boolean(), consentedAt: z.string().datetime().nullable() }).strict(),
  holdings: z.array(connectedAccountHoldingSchema),
}).strict();
export type ConnectedAccountsResponse = z.infer<typeof connectedAccountsResponseSchema>;

export const connectedAccountSharingRequestSchema = z.object({
  householdId: z.string().uuid(),
  share: z.boolean(),
  consentVersion: z.literal(CONNECTED_ACCOUNT_SHARING_CONSENT_VERSION).optional(),
}).strict().refine((value) => !value.share || value.consentVersion !== undefined, { message: '공유에는 동의 버전이 필요합니다.' });
export type ConnectedAccountSharingRequest = z.infer<typeof connectedAccountSharingRequestSchema>;
