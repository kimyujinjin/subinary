import { describe, expect, it } from 'vitest';

import { extractActionGroundedAmount } from '../action-amount.js';
import { parseCardSms } from '../dispatch.js';
import { applyRecipe, deriveRecipe } from '../recipe.js';
import type { CardSmsInput } from '../types.js';

const receivedAt = new Date('2026-10-10T20:46:30+09:00');

/** 운영 실패 형식을 유지하되 이름·금액·가맹점은 합성값으로 만든다. */
function overseasKrw(amountLine: string, footer?: string): CardSmsInput {
  return {
    sender: 'card-test',
    content: [
      '[Web발신]',
      '현대 네이버 해외승인',
      '김*수',
      '10/10 20:46',
      amountLine,
      'EXAMPLE*SUBSCRIPTION',
      ...(footer ? [footer] : []),
    ].join('\n'),
    receivedAt,
  };
}

describe('해외 원화 결제의 ISO 통화 표기', () => {
  it.each(['KRW 29,000.00', '29,000.00 KRW', 'KRW 29000'])(
    '%s를 29,000원 승인으로 읽고 가맹점과 거래 시각을 보존한다',
    (amountLine: string) => {
      const result = parseCardSms(overseasKrw(amountLine));

      expect(result).toMatchObject({
        issuer: '현대카드',
        transactionType: 'approval',
        amount: 29000,
        currency: 'KRW',
        merchantRaw: 'EXAMPLE*SUBSCRIPTION',
        occurredAt: new Date('2026-10-10T20:46:00+09:00'),
      });
    },
  );

  it('누적 원화 금액이 함께 있어도 실제 ISO 원화 승인 금액만 선택한다', () => {
    const input = overseasKrw('KRW 29,000.00', '누적 123,456원');

    expect(parseCardSms(input).amount).toBe(29000);
    expect(extractActionGroundedAmount(input.content)).toMatchObject({
      status: 'resolved',
      amount: 29000,
      currency: 'KRW',
    });
  });

  it('사람이 확정한 ISO 원화 레시피도 같은 금액 후보를 사용한다', () => {
    const input = overseasKrw('KRW 29,000.00');
    const recipe = deriveRecipe(
      input,
      { transactionType: 'approval', issuer: '현대카드', amount: 29000, currency: 'KRW' },
      'synthetic-krw-layout',
    );
    const result = applyRecipe(overseasKrw('KRW 31,000.00'), recipe).result;

    expect(result.amount).toBe(31000);
    expect(result.currency).toBe('KRW');
  });

  it('지원하지 않는 통화 코드를 원화로 추측하지 않는다', () => {
    const result = parseCardSms(overseasKrw('ABC 29,000.00'));

    expect(result.amount).toBeUndefined();
    expect(result.currency).toBeUndefined();
  });

  it('안전 정수 범위를 넘은 원화 금액은 거래 금액으로 채택하지 않는다', () => {
    const result = parseCardSms(overseasKrw('KRW 9,007,199,254,740,992.00'));

    expect(result.amount).toBeUndefined();
    expect(result.currency).toBeUndefined();
  });
});
