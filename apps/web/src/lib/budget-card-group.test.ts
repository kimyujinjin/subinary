import type { CardSummary } from "@family/contracts";
import { describe, expect, it } from "vitest";

import { budgetCardGroupError, budgetCardGroupUpdate, budgetCardGroupUpdateError, budgetCardIds } from "./budget-card-group";

const samsung: CardSummary = {
  id: "samsung", householdId: "family", ownerMemberId: "owner", issuer: "삼성",
  alias: "삼성카드", maskedNumber: null, visibility: "household", isShared: false,
  status: "active", createdAt: "2026-10-28T00:00:00Z",
};
const hyundai: CardSummary = { ...samsung, id: "hyundai", issuer: "현대", alias: "네이버 현대카드" };
const cards = [samsung, hyundai];

describe("카드 묶음 예산 선택", () => {
  it("서로 다른 개인 카드 두 장을 한 범위로 선택한다", () => {
    expect(budgetCardGroupError([samsung.id, hyundai.id], cards)).toBeNull();
  });

  it("카드가 한 장뿐이거나 같은 카드를 중복 선택하면 막는다", () => {
    expect(budgetCardGroupError([samsung.id], cards)).toContain("2장 이상");
    expect(budgetCardGroupError([samsung.id, samsung.id], cards)).toContain("중복");
  });

  it("공용 생활비 카드와 사용 중지 카드를 포함하지 않는다", () => {
    expect(budgetCardGroupError([samsung.id, "toss"], [...cards, { ...samsung, id: "toss", isShared: true }])).toContain("공용");
    expect(budgetCardGroupError([samsung.id, hyundai.id], [samsung, { ...hyundai, status: "inactive" }])).toContain("사용 중");
  });

  it("본인 카드와 배우자 카드를 같은 묶음으로 만들지 않는다", () => {
    expect(budgetCardGroupError([samsung.id, hyundai.id], [samsung, { ...hyundai, ownerMemberId: "spouse" }])).toContain("같은 가족 구성원");
  });

  it("삭제되었거나 조회할 수 없는 카드를 정상으로 간주하지 않는다", () => {
    expect(budgetCardGroupError([samsung.id, "missing"], cards)).toContain("확인할 수 없어요");
    expect(budgetCardGroupError([samsung.id, hyundai.id], [])).toContain("다시 불러와");
  });

  it("20장보다 많은 카드는 거절한다", () => {
    expect(budgetCardGroupError(Array.from({ length: 21 }, (_, i) => String(i)), cards)).toContain("최대 20장");
  });
});

describe("기존 예산의 카드 범위 정정", () => {
  const single = { scopeType: "card" as const, scopeRefId: samsung.id, cardIds: [] };
  const group = { scopeType: "card_group" as const, scopeRefId: null, cardIds: [samsung.id, hyundai.id] };

  it("기존 단일 카드와 묶음의 범위를 동일한 자료형으로 읽는다", () => {
    expect(budgetCardIds(single)).toEqual([samsung.id]);
    expect(budgetCardIds(group)).toEqual([samsung.id, hyundai.id]);
    expect(budgetCardIds({ scopeType: "household", scopeRefId: null, cardIds: [] })).toEqual([]);
  });

  it("단일 예산을 묶을 때 기존 카드 조건을 보내되 이름과 금액은 보내지 않는다", () => {
    expect(budgetCardGroupUpdate(single, [samsung.id, hyundai.id])).toEqual({
      scopeType: "card_group", cardIds: [hyundai.id, samsung.id], expectedCardIds: [samsung.id],
    });
  });

  it("같은 카드 묶음은 순서가 달라져도 수정하지 않는다", () => {
    expect(budgetCardGroupUpdate(group, [hyundai.id, samsung.id])).toEqual({});
    expect(group.cardIds).toEqual([samsung.id, hyundai.id]);
  });

  it("묶음 변경에는 이전 목록을 넣어 동시 수정 충돌을 확인한다", () => {
    expect(budgetCardGroupUpdate(group, [samsung.id, "new-card"]).expectedCardIds).toEqual([hyundai.id, samsung.id]);
  });

  it("이미 저장된 카드가 나중에 공용·중지되어도 범위 유지 수정은 막지 않는다", () => {
    const changedCards = [{ ...samsung, isShared: true }, { ...hyundai, status: "inactive" as const }];
    expect(budgetCardGroupUpdateError(group, group.cardIds, changedCards)).toBeNull();
    expect(budgetCardGroupUpdateError(group, group.cardIds, [])).toBeNull();
    expect(budgetCardGroupUpdateError(single, group.cardIds, changedCards)).toContain("공용");
  });
});
