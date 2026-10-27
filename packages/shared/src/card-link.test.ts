import { describe, expect, it } from 'vitest';

import {
  resolvePaymentCardLink,
  type PaymentCardLinkCandidate,
  type PaymentCardLinkSource,
} from './card-link.js';

const source: PaymentCardLinkSource = {
  memberId: 'member-self',
  issuer: '현대카드',
  maskedCardNumber: null,
};

function card(
  id: string,
  overrides: Partial<PaymentCardLinkCandidate> = {},
): PaymentCardLinkCandidate {
  return {
    id,
    ownerMemberId: 'member-self',
    issuer: '현대',
    isShared: false,
    maskedNumber: null,
    visibility: 'household',
    ...overrides,
  };
}

describe('카드 자동 연결 — 구성원 식별', () => {
  it('번호 없는 현대 문자에 다른 구성원 카드 한 장만 있어도 연결하지 않는다', () => {
    const other = card('other-card', { ownerMemberId: 'member-other' });
    expect(resolvePaymentCardLink(source, [other])).toEqual({
      cardId: null, visibility: 'household', ambiguous: true,
    });
  });

  it('부부가 같은 발급사의 개인 카드를 등록하면 원본 구성원 카드에 연결한다', () => {
    const cards = [
      card('other-card', { ownerMemberId: 'member-other' }),
      card('self-card'),
    ];
    expect(resolvePaymentCardLink(source, cards).cardId).toBe('self-card');
    expect(resolvePaymentCardLink({ ...source, memberId: 'member-other' }, cards).cardId)
      .toBe('other-card');
  });

  it('조회 순서가 달라도 결과가 같다', () => {
    const cards = [card('self-card'), card('other-card', { ownerMemberId: 'member-other' })];
    expect(resolvePaymentCardLink(source, cards))
      .toEqual(resolvePaymentCardLink(source, [...cards].reverse()));
  });

  it('다른 구성원 소유라도 명시적 공용 카드이면 연결할 수 있다', () => {
    const shared = card('shared-card', { ownerMemberId: 'member-other', isShared: true });
    expect(resolvePaymentCardLink(source, [shared]).cardId).toBe('shared-card');
  });

  it('본인 개인 카드와 공용 카드가 구분되지 않으면 검토한다', () => {
    const cards = [
      card('self-card'),
      card('shared-card', { ownerMemberId: 'member-other', isShared: true, visibility: 'summary_only' }),
    ];
    expect(resolvePaymentCardLink(source, cards)).toEqual({
      cardId: null, visibility: 'summary_only', ambiguous: true,
    });
  });

  it('같은 구성원의 후보가 둘이면 가장 제한적인 공개범위를 유지한다', () => {
    expect(resolvePaymentCardLink(source, [card('one'), card('two', { visibility: 'private' })]))
      .toEqual({ cardId: null, visibility: 'private', ambiguous: true });
  });

  it('다른 구성원의 비공개 카드만 일치하면 가족 공개로 낮추지 않는다', () => {
    const other = card('other-card', { ownerMemberId: 'member-other', visibility: 'private' });
    expect(resolvePaymentCardLink(source, [other]))
      .toEqual({ cardId: null, visibility: 'private', ambiguous: true });
  });
});

describe('카드 자동 연결 — 식별 근거 경계', () => {
  it('발급사 공백과 접미사를 정규화한다', () => {
    expect(resolvePaymentCardLink({ ...source, issuer: '현대 카드' }, [card('self-card')]).cardId)
      .toBe('self-card');
  });

  it('마스킹 형식이 달라도 본인 카드 뒤 네 자리를 비교한다', () => {
    expect(resolvePaymentCardLink(
      { ...source, maskedCardNumber: '****1234' },
      [card('self-card', { maskedNumber: '1234' })],
    ).cardId).toBe('self-card');
  });

  it('뒤 네 자리가 같아도 다른 발급사에는 연결하지 않는다', () => {
    expect(resolvePaymentCardLink(
      { ...source, maskedCardNumber: '****1234' },
      [card('different-issuer', { issuer: '삼성', maskedNumber: '1234' })],
    ).cardId).toBeNull();
  });

  it('서로 다른 구성원의 뒤 네 자리 중복은 원본 구성원으로 구분한다', () => {
    expect(resolvePaymentCardLink(
      { ...source, maskedCardNumber: '****1234' },
      [card('other', { ownerMemberId: 'member-other', maskedNumber: '1234' }), card('self', { maskedNumber: '1234' })],
    ).cardId).toBe('self');
  });

  it('뒤 네 자리도 다른 구성원의 개인 카드를 연결하는 근거로 쓰지 않는다', () => {
    expect(resolvePaymentCardLink(
      { ...source, maskedCardNumber: '****1234' },
      [card('other', { ownerMemberId: 'member-other', maskedNumber: '1234' })],
    )).toMatchObject({ cardId: null, ambiguous: true });
  });

  it('번호가 있는데 일치하지 않으면 발급사만으로 대체 연결하지 않는다', () => {
    expect(resolvePaymentCardLink(
      { ...source, maskedCardNumber: '****1234' },
      [card('different-number', { maskedNumber: '5678' })],
    ).cardId).toBeNull();
  });

  it('발급사를 모르면 고유한 본인 카드 번호로만 연결한다', () => {
    expect(resolvePaymentCardLink(
      { ...source, issuer: '카드', maskedCardNumber: '****1234' },
      [card('self', { maskedNumber: '1234' })],
    ).cardId).toBe('self');
  });

  it.each([null, '', '카드', '  카드 '])('번호·발급사 근거가 없으면 연결하지 않는다: %s', (issuer) => {
    expect(resolvePaymentCardLink({ ...source, issuer, maskedCardNumber: '12' }, [card('self')]))
      .toEqual({ cardId: null, visibility: 'household', ambiguous: false });
  });

  it('카드가 없어도 오류 없이 미연결을 반환한다', () => {
    expect(resolvePaymentCardLink(source, []))
      .toEqual({ cardId: null, visibility: 'household', ambiguous: false });
  });
});
