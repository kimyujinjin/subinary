import { z } from 'zod';

/**
 * `GET /v1/fx/reference?base=USD` — 가장 최근 영업일의 ECB 기준환율(1 base = rate KRW).
 *
 * 화면 표시용 참고 환율이다. 카드 결제 시점 환율이나 증권사 평가 환율이 아니므로 화면은
 * 기준일을 함께 보여준다. 최근 7일 안에 값이 없으면 `rate`가 null이다(0으로 바꾸지 않는다).
 */
export const fxReferenceSchema = z.object({
  baseCurrency: z.enum(['USD']),
  quoteCurrency: z.literal('KRW'),
  rate: z.string().regex(/^\d+(?:\.\d+)?$/).nullable(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  source: z.literal('ecb-reference'),
});
export type FxReference = z.infer<typeof fxReferenceSchema>;
