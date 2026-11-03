import { describe, expect, it } from 'vitest';

import { parseCardSms } from '../dispatch.js';

const receivedAt = new Date('2026-10-01T16:57:00+09:00');
const savingsNotice = [
  '토스뱅크 [모임통장 안내]',
  '가족통장 모임통장 모임금고에 123,456원이 저금됐어요.',
  '10/01 16:56',
  '비상금',
  '거래한 모임원: 김*수',
].join('\n');

describe('거래를 만들지 않는 안내와 거절', () => {
  it('모임금고 저금 안내를 결제 파싱 실패와 구분한다', () => {
    const result = parseCardSms({ sender: 'bank-test', content: savingsNotice, receivedAt });

    expect(result).toMatchObject({
      transactionType: 'unknown',
      nonTransactionReason: 'savings_transfer',
    });
    expect(result.amount).toBeUndefined();
    expect(result.currency).toBeUndefined();
  });

  it('금액 없는 원화결제 차단 통지를 승인거절로 식별하고 금액을 만들지 않는다', () => {
    const result = parseCardSms({
      sender: 'card-test',
      content: '[Web발신]\n[현대카드]해외원화결제차단신청으로 승인거절되었습니다.\nhttps://example.com/card',
      receivedAt,
    });

    expect(result).toMatchObject({ issuer: '현대카드', transactionType: 'declined' });
    expect(result.amount).toBeUndefined();
    expect(result.currency).toBeUndefined();
    expect(result.merchantRaw).toBeUndefined();
  });

  it('카드 승인과 저금 안내가 섞인 메시지는 자동 제외하지 않는다', () => {
    const content = `${savingsNotice}\n토스뱅크 카드 승인 3,000원`;
    const result = parseCardSms({ sender: 'bank-test', content, receivedAt });

    expect(result).not.toHaveProperty('nonTransactionReason');
  });

  it('일반 안내의 거절 단어만으로 카드 거절을 만들지 않는다', () => {
    const result = parseCardSms({
      sender: 'notice-test',
      content: '예약 신청이 거절되었습니다. https://example.com/booking',
      receivedAt,
    });

    expect(result.transactionType).toBe('unknown');
    expect(result).not.toHaveProperty('nonTransactionReason');
  });
});
