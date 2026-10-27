import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CardSummary } from "@family/contracts";
import { describe, expect, it } from "vitest";

import { BudgetCardPicker } from "./budget-card-picker";

const card: CardSummary = {
  id: "samsung", householdId: "family", ownerMemberId: "me", issuer: "삼성",
  alias: "삼성카드", maskedNumber: "1234", visibility: "household", isShared: false,
  status: "active", createdAt: "2026-10-28T00:00:00Z",
};
const memberNames = new Map([["me", "본인"], ["spouse", "배우자"]]);

/** 사용자 카드 정보 대신 합성 카드로 접근성 이름과 선택 제외 표시를 검증한다. */
function renderPicker(cards: CardSummary[], selectedIds: string[] = []): string {
  return renderToStaticMarkup(createElement(BudgetCardPicker, { cards, selectedIds, memberNames, onChange: () => undefined }));
}

describe("카드 묶음 선택 화면", () => {
  it("동일 상품이라도 소유자가 다른 카드를 구분해 표시한다", () => {
    const markup = renderPicker([card, { ...card, id: "other", ownerMemberId: "spouse" }], [card.id]);
    expect(markup).toContain("소유자 본인");
    expect(markup).toContain("소유자 배우자");
    expect(markup).toContain("1장 선택");
    expect(markup).toContain('checked=""');
    expect(markup).toContain("다른 소유자 · 선택 제외");
  });

  it("공용 카드와 중지 카드는 체크박스를 비활성화한다", () => {
    const markup = renderPicker([{ ...card, isShared: true }, { ...card, id: "inactive", status: "inactive" }]);
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).toContain("공용 카드 · 선택 제외");
    expect(markup).toContain("사용 중지 · 선택 제외");
  });

  it("기존에 선택된 카드가 공용으로 바뀌었다면 선택 해제는 가능하다", () => {
    expect(renderPicker([{ ...card, isShared: true }], [card.id])).not.toContain('disabled=""');
  });

  it("카드가 없으면 등록 경로를 설명한다", () => {
    expect(renderPicker([])).toContain("카드 관리에서 먼저 등록해 주세요");
  });

  it("조회 중이거나 실패한 상태를 카드 미등록으로 표시하지 않는다", () => {
    const base = { cards: [], selectedIds: [], memberNames, onChange: () => undefined };
    const loading = renderToStaticMarkup(createElement(BudgetCardPicker, { ...base, isLoading: true }));
    const failed = renderToStaticMarkup(createElement(BudgetCardPicker, { ...base, loadError: true }));
    expect(loading).toContain("불러오는 중");
    expect(failed).toContain("불러오지 못했어요");
    expect(loading).not.toContain("등록된 카드가 없어요");
    expect(failed).not.toContain("등록된 카드가 없어요");
  });
});
