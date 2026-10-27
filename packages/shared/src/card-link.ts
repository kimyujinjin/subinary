/** 카드 자동 연결에서 사용하는 공개 범위. */
export type PaymentCardVisibility = 'private' | 'household' | 'summary_only';

/** 같은 가구의 활성 카드 중 식별에 필요한 최소 정보. */
export interface PaymentCardLinkCandidate {
  readonly id: string;
  readonly ownerMemberId: string;
  readonly isShared: boolean;
  readonly maskedNumber: string | null;
  readonly issuer: string;
  readonly visibility: PaymentCardVisibility;
}

/** 수집 원본의 구성원과 파싱된 카드 식별 정보. */
export interface PaymentCardLinkSource {
  readonly memberId: string;
  readonly maskedCardNumber: string | null;
  readonly issuer: string | null;
}

/** 카드 연결 결과. 불명확한 연결은 거래 검토 대상으로 남긴다. */
export interface PaymentCardLink {
  readonly cardId: string | null;
  readonly visibility: PaymentCardVisibility;
  readonly ambiguous: boolean;
}

/** 마스킹 형식 차이를 제거하되 네 자리 미만의 번호는 식별자로 쓰지 않는다. */
function lastFourDigits(value: string | null): string | null {
  const digits = value?.replace(/\D/g, '') ?? '';
  return digits.length < 4 ? null : digits.slice(-4);
}

/** 발급사의 공백과 카드 접미사만 정규화한다. 상품명에서 발급사를 추정하지 않는다. */
function normalizeIssuer(value: string | null): string | null {
  const key = value?.replace(/\s+/g, '').replace(/카드$/, '') ?? '';
  return key.length > 0 ? key : null;
}

/**
 * 같은 가구의 활성 카드 목록에서 원본 구성원의 카드 또는 공용 카드만 연결한다.
 * 카드번호가 없는 문자도 발급사만으로 다른 구성원의 개인 카드에 연결하지 않는다.
 * 번호가 있으면 발급사와 함께 확인하며, 후보가 모호하면 가장 제한적인 공개범위로
 * 검토 상태를 반환한다. 이 함수는 실제 결제자를 추정하거나 원본 구성원을 바꾸지 않는다.
 */
export function resolvePaymentCardLink(
  source: PaymentCardLinkSource,
  cards: readonly PaymentCardLinkCandidate[],
): PaymentCardLink {
  const tail = lastFourDigits(source.maskedCardNumber);
  const issuer = normalizeIssuer(source.issuer);
  const identifiedCards = cards.filter((card) => {
    if (issuer !== null && normalizeIssuer(card.issuer) !== issuer) return false;
    return tail
      ? lastFourDigits(card.maskedNumber) === tail
      : issuer !== null;
  });
  const matches = identifiedCards.filter(
    (card) => card.ownerMemberId === source.memberId || card.isShared,
  );
  if (matches.length === 1) {
    return { cardId: matches[0].id, visibility: matches[0].visibility, ambiguous: false };
  }
  const unresolved = matches.length > 0 ? matches : identifiedCards;
  if (unresolved.length > 0) {
    const rank: Record<PaymentCardVisibility, number> = {
      household: 0,
      summary_only: 1,
      private: 2,
    };
    const visibility = unresolved.reduce<PaymentCardVisibility>(
      (current, card) => rank[card.visibility] > rank[current] ? card.visibility : current,
      'household',
    );
    return { cardId: null, visibility, ambiguous: true };
  }
  return { cardId: null, visibility: 'household', ambiguous: false };
}
