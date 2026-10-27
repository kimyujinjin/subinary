import { describe, expect, it } from "vitest";

import { cardIdentityLabel, cardOwnerLabel, type CardIdentity } from "./card-identity-label";

const names = new Map([["member-a", "가족 A"], ["member-b", "가족 B"]]);
const base: CardIdentity = {
  alias: "네이버 현대카드",
  issuer: "현대카드",
  maskedNumber: "1234",
  ownerMemberId: "member-a",
  isShared: false,
};

describe("가족 카드 식별 라벨", () => {
  it("상품명과 끝 번호가 같아도 소유자로 구분한다", () => {
    const other = { ...base, ownerMemberId: "member-b" };
    expect(cardIdentityLabel(base, names)).toContain("소유자 가족 A");
    expect(cardIdentityLabel(other, names)).toContain("소유자 가족 B");
    expect(cardIdentityLabel(base, names)).not.toBe(cardIdentityLabel(other, names));
  });

  it("공용 카드는 소유자 이름과 별도로 공동사용 여부를 표시한다", () => {
    expect(cardOwnerLabel({ ...base, isShared: true }, names)).toBe("공용 · 소유자 가족 A");
  });

  it("숫자가 많이 들어와도 뒤 네 자리만 표시한다", () => {
    const label = cardIdentityLabel({ ...base, maskedNumber: "1234-5678-9012-3456" }, names);
    expect(label).toContain("•••• 3456");
    expect(label).not.toContain("1234");
  });

  it("없는 소유자와 불완전한 번호는 다른 가족으로 추정하지 않는다", () => {
    const label = cardIdentityLabel({ ...base, ownerMemberId: "missing", maskedNumber: "12" }, names);
    expect(label).toContain("소유자 확인 필요");
    expect(label).toContain("번호 미등록");
  });
});
