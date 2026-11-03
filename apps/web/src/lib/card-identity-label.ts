/** 같은 상품·별칭의 카드를 구분하는 데 필요한 표시 정보. */
export interface CardIdentity {
  alias: string;
  issuer: string;
  maskedNumber: string | null;
  ownerMemberId: string;
  isShared: boolean;
}

/** 카드 소유자와 공동사용 여부를 색상에 의존하지 않고 표시한다. */
export function cardOwnerLabel(
  card: Pick<CardIdentity, "ownerMemberId" | "isShared">,
  memberNames: ReadonlyMap<string, string>,
): string {
  const owner = memberNames.get(card.ownerMemberId) ?? "확인 필요";
  return `${card.isShared ? "공용 · " : ""}소유자 ${owner}`;
}

/** 카드 선택·상세에서 별칭이 같은 가족 카드를 구분한다. 전체 번호는 표시하지 않는다. */
export function cardIdentityLabel(
  card: CardIdentity,
  memberNames: ReadonlyMap<string, string>,
): string {
  const digits = card.maskedNumber?.replace(/\D/g, "") ?? "";
  const tail = digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "번호 미등록";
  return `${card.alias} · ${cardOwnerLabel(card, memberNames)} · ${tail}`;
}
