import { describe, expect, it } from "vitest";

import {
  budgetDisplayName,
  budgetEditDescription,
  budgetRemainingLine,
} from "./budget-text";

describe("예산 수정 창 설명", () => {
  it("카드 문구는 카드·카드 묶음 예산에서만 쓴다", () => {
    expect(budgetEditDescription("card", false)).toBe(
      "이 카드로 결제한 지출만 합산해요."
    );
    expect(budgetEditDescription("card_group", false)).toBe(
      "선택한 카드로 결제한 지출만 합산해요."
    );
    for (const scope of ["household", "member", "category"] as const) {
      expect(budgetEditDescription(scope, false)).not.toContain("카드");
    }
  });

  it("가족 전체·구성원·카테고리 예산은 각각 맞는 말을 한다", () => {
    expect(budgetEditDescription("household", false)).toBe(
      "가족 모두가 쓴 돈을 합산해요."
    );
    expect(budgetEditDescription("member", false)).toBe(
      "이 구성원이 쓴 돈만 합산해요."
    );
    expect(budgetEditDescription("category", false)).toBe(
      "이 카테고리로 분류된 지출만 합산해요."
    );
  });

  it("지난 달은 포함 카드만 바로잡는다고 한 문장으로 말한다", () => {
    const text = budgetEditDescription("card_group", true);
    expect(text).toContain("카드만 바로잡으면");
    expect(text.split(". ")).toHaveLength(1);
  });
});

describe("남은 금액 한 줄", () => {
  const base = { amount: 500_000, currency: "KRW" };

  it("넘었으면 그리지 않는다 — 막대 아래 '12,000원 초과'가 이미 말한다", () => {
    expect(
      budgetRemainingLine({ ...base, spent: 512_000, usageRate: 1.024 })
    ).toBeNull();
  });

  it("딱 다 썼으면 다 썼다고 말한다", () => {
    expect(
      budgetRemainingLine({ ...base, spent: 500_000, usageRate: 1 })
    ).toEqual({ text: "예산을 다 썼어요", tone: "over" });
  });

  it("80% 이상은 경고 색과 함께 남은 금액을 말한다(홈 예산 줄과 같은 말)", () => {
    expect(
      budgetRemainingLine({ ...base, spent: 410_000, usageRate: 0.82 })
    ).toEqual({ text: "90,000원 남았어요", tone: "warn" });
  });

  it("그 아래는 더 쓸 수 있는 금액을 말한다", () => {
    expect(
      budgetRemainingLine({ ...base, spent: 100_000, usageRate: 0.2 })
    ).toEqual({ text: "400,000원 더 쓸 수 있어요", tone: "ok" });
  });
});

describe("예산 이름", () => {
  it("이름이 없으면 범위 이름, 카드 묶음은 '카드 묶음 예산'", () => {
    expect(
      budgetDisplayName({
        name: null,
        scopeType: "category",
        scopeLabel: "식비",
      })
    ).toBe("식비");
    expect(
      budgetDisplayName({
        name: null,
        scopeType: "card_group",
        scopeLabel: "카드 A · 카드 B",
      })
    ).toBe("카드 묶음 예산");
    expect(
      budgetDisplayName({
        name: "외식",
        scopeType: "category",
        scopeLabel: "식비",
      })
    ).toBe("외식");
  });
});
