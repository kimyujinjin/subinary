import { describe, expect, it } from 'vitest';
import { cardSmsReviewRequestSchema, type CardSmsReviewRequest } from '@family/contracts';
import { scopedTemplateFingerprint, templateFingerprint } from '@family/card-parsers';
import type { PaymentCardLinkCandidate } from '@family/shared';
import { reusableReviewRecipe } from './card-sms-review-policy';
import { groupReviewEvents } from './card-sms-review-groups';

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const EVENT = '33333333-3333-4333-8333-333333333333';
const CARD = '44444444-4444-4444-8444-444444444444';
const content = '[Web발신]\n현대카드(1234)승인\n김*수\n10/28 10:30\n12,000원 일시불\n테스트상점';
const event = { id: EVENT, householdId: HOUSEHOLD, memberId: MEMBER, sender: '1588-test', rawContent: content,
  receivedAt: new Date('2026-10-28T10:30:30+09:00'), issuer: '현대', parseStatus: 'parse_failed' as const };
const input: CardSmsReviewRequest = { transactionType: 'approval', currency: 'KRW', amount: 12000,
  merchantRaw: '테스트상점', occurredAt: '2026-10-28T01:30:00.000Z', cardId: CARD, reuseForSimilar: true };
const card: PaymentCardLinkCandidate = { id: CARD, ownerMemberId: MEMBER, isShared: false,
  maskedNumber: '1234', issuer: '현대', visibility: 'private' };

describe('사람이 선택한 동일 양식 재사용', () => {
  it('기본은 현재 한 건이며 문자열 true를 동의로 해석하지 않는다', () => {
    expect(cardSmsReviewRequestSchema.parse({ ...input, reuseForSimilar: undefined }).reuseForSimilar).toBe(false);
    expect(cardSmsReviewRequestSchema.safeParse({ ...input, reuseForSimilar: 'true' }).success).toBe(false);
  });

  it('원문에서 확정 값을 그대로 재현하고 본인 카드 하나가 일치해야 한다', () => {
    const recipe = reusableReviewRecipe(event, input, MEMBER, [card]);
    expect(recipe.fingerprint).toBe(templateFingerprint(event.sender, content));
    expect(recipe.fingerprint).not.toBe(scopedTemplateFingerprint(HOUSEHOLD, MEMBER, event.sender, content));
  });

  it.each([
    { transactionType: 'cancellation' as const }, { currency: 'USD' }, { cardId: undefined },
    { amount: 13000 }, { merchantRaw: '다른상점' }, { occurredAt: '2026-10-28T02:30:00.000Z' },
  ])('재사용할 수 없는 확정값은 거절한다: %j', (patch) => {
    expect(() => reusableReviewRecipe(event, { ...input, ...patch }, MEMBER, [card])).toThrow();
  });

  it.each(['\n누적 90,000원', '\nhttps://bank.example/verify', '\n인증번호 123456'])('위험·모호한 본문을 재사용하지 않는다', (suffix) => {
    expect(() => reusableReviewRecipe({ ...event, rawContent: content + suffix }, input, MEMBER, [card])).toThrow();
  });

  it('타인 카드·동일 식별의 복수 카드·다른 뒷자리를 지정하면 거절한다', () => {
    expect(() => reusableReviewRecipe(event, input, MEMBER, [{ ...card, ownerMemberId: 'other' }])).toThrow();
    expect(() => reusableReviewRecipe(event, input, MEMBER, [card, { ...card, id: 'other' }])).toThrow();
    expect(() => reusableReviewRecipe(event, input, MEMBER, [{ ...card, maskedNumber: '5678' }])).toThrow();
  });

  it('명확히 식별되는 공용 카드는 허용한다', () => {
    expect(() => reusableReviewRecipe(event, input, MEMBER, [{ ...card, ownerMemberId: 'other', isShared: true }])).not.toThrow();
  });

  it('생략된 일시불만 1로 맞추고 실제 할부는 확인한 개월이 일치해야 한다', () => {
    expect(reusableReviewRecipe(event, input, MEMBER, [card]).fields.installment).toBeDefined();
    const installmentEvent = { ...event, rawContent: content.replace('일시불', '3개월') };
    expect(() => reusableReviewRecipe(installmentEvent, input, MEMBER, [card])).toThrow();
    expect(() => reusableReviewRecipe(installmentEvent, { ...input, installmentMonths: 2 }, MEMBER, [card])).toThrow();
    expect(() => reusableReviewRecipe(installmentEvent, { ...input, installmentMonths: 3 }, MEMBER, [card])).not.toThrow();
  });
});

describe('원문 없는 본인 문자 묶음', () => {
  it('금액이 다른 같은 양식은 묶고 각 상태와 최신 대표를 보존한다', () => {
    const later = { ...event, id: CARD, rawContent: content.replace('12,000', '23,000'), parseStatus: 'quarantined' as const,
      receivedAt: new Date('2026-10-29T01:30:00Z') };
    const result = groupReviewEvents([event, later], HOUSEHOLD, MEMBER, true);
    expect(result.truncated).toBe(true);
    expect(result.scannedCount).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ count: 2, parseFailed: 1, quarantined: 1, representativeEventId: CARD, reviewPath: `/todo?reviewSms=${CARD}` });
    expect(JSON.stringify(result)).not.toContain('테스트상점');
    expect(JSON.stringify(result)).not.toContain('rawContent');
  });

  it('다른 가구·다른 수신자·이미 승격된 pending_review는 제외한다', () => {
    const result = groupReviewEvents([
      event, { ...event, householdId: 'other' }, { ...event, memberId: 'other' }, { ...event, parseStatus: 'pending_review' },
    ], HOUSEHOLD, MEMBER, false);
    expect(result.scannedCount).toBe(1);
    expect(groupReviewEvents([], HOUSEHOLD, MEMBER, false)).toMatchObject({ items: [], policies: [], scannedCount: 0, truncated: false });
  });
});
