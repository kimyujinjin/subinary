import { parseCardSms, type CardSmsParseResult } from '@family/card-parsers';
import { describe, expect, it } from 'vitest';

import { isCardSmsParseResolved, resolveCardSmsParseDisposition } from './parse-disposition';

const receivedAt = new Date('2026-10-10T20:46:30+09:00');
const approval: CardSmsParseResult = {
  transactionType: 'approval',
  amount: 29000,
  currency: 'KRW',
  confidence: 100,
  warnings: [],
};

describe('문자 판정과 거래 승격 분리', () => {
  it('저금 안내는 해석 완료지만 ignored로 보존하고 거래를 만들지 않는다', () => {
    const result = parseCardSms({
      sender: 'bank-test',
      content: '토스뱅크 [모임통장 안내]\n가족통장 모임통장 모임금고에 123,456원이 저금됐어요.',
      receivedAt,
    });

    expect(isCardSmsParseResolved(result)).toBe(true);
    expect(resolveCardSmsParseDisposition(result, receivedAt, false)).toEqual({
      parseStatus: 'ignored', parseError: null, promotable: false,
    });
  });

  it('금액 없는 명시적 거절은 추가 추출이나 거래 승격이 필요하지 않다', () => {
    const result = parseCardSms({
      sender: 'card-test',
      content: '[현대카드]해외원화결제차단신청으로 승인거절되었습니다.\nhttps://example.com/card',
      receivedAt,
    });

    expect(isCardSmsParseResolved(result)).toBe(true);
    expect(resolveCardSmsParseDisposition(result, receivedAt, false)).toEqual({
      parseStatus: 'parsed', parseError: null, promotable: false,
    });
    expect(result.amount).toBeUndefined();
  });

  it.each(['approval', 'cancellation'] as const)('%s는 금액이 없으면 실패로 남긴다', (transactionType) => {
    const result: CardSmsParseResult = {
      ...approval, transactionType, amount: undefined, currency: undefined,
      warnings: ['amount not found'],
    };

    expect(isCardSmsParseResolved(result)).toBe(false);
    expect(resolveCardSmsParseDisposition(result, receivedAt, false)).toEqual({
      parseStatus: 'parse_failed', parseError: 'amount not found', promotable: false,
    });
  });

  it('알 수 없는 문자는 자동 제외하지 않는다', () => {
    const result: CardSmsParseResult = {
      transactionType: 'unknown', confidence: 0, warnings: ['no matching parser'],
    };

    expect(isCardSmsParseResolved(result)).toBe(false);
    expect(resolveCardSmsParseDisposition(result, receivedAt, false).parseStatus).toBe('parse_failed');
  });

  it('유효한 결정적 승인은 승격한다', () => {
    expect(resolveCardSmsParseDisposition(approval, receivedAt, false)).toEqual({
      parseStatus: 'parsed', parseError: null, promotable: true,
    });
  });

  it('해외 KRW 소수 표기 승인도 규칙 파싱만으로 승격 가능하다', () => {
    const result = parseCardSms({
      sender: 'card-test',
      content: '[Web발신]\n현대 네이버 해외승인\n김*수\n10/10 20:46\nKRW 29,000.00\nEXAMPLE*SUBSCRIPTION',
      receivedAt,
    });

    expect(isCardSmsParseResolved(result)).toBe(true);
    expect(resolveCardSmsParseDisposition(result, receivedAt, false)).toEqual({
      parseStatus: 'parsed', parseError: null, promotable: true,
    });
  });

  it('낮은 신뢰도의 결정적 승인에 대한 기존 검토 표시를 보존한다', () => {
    const result = resolveCardSmsParseDisposition({ ...approval, confidence: 65 }, receivedAt, false);

    expect(result.parseStatus).toBe('pending_review');
    expect(result.promotable).toBe(true);
  });

  it('LLM 결과는 완전해도 사람 확인 전 거래로 만들지 않는다', () => {
    expect(resolveCardSmsParseDisposition(approval, receivedAt, true)).toEqual({
      parseStatus: 'quarantined', parseError: null, promotable: false,
    });
  });

  it('음수 금액은 해석 결과가 있어도 실패한다', () => {
    const result = resolveCardSmsParseDisposition({ ...approval, amount: -1 }, receivedAt, false);

    expect(result.parseStatus).toBe('parse_failed');
    expect(result.parseError).toContain('amount is negative');
    expect(result.promotable).toBe(false);
  });
});
