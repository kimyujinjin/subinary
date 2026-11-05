import type { BudgetSummary } from "@family/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { budgetStatus, HomeBudgetSummary } from "./home-summary-rows";

const budget = (over: Partial<BudgetSummary> = {}): BudgetSummary => ({
  id: "b1",
  householdId: "h1",
  name: "식비",
  scopeType: "category",
  scopeRefId: null,
  cardIds: [],
  scopeLabel: "식비",
  effectiveMonth: "2026-11",
  amount: 300_000,
  spent: 120_000,
  threeMonthAverageSpent: 0,
  remaining: 180_000,
  usageRate: 0.4,
  period: "monthly",
  currency: "KRW",
  ...over,
});

const render = (props: Partial<Parameters<typeof HomeBudgetSummary>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(HomeBudgetSummary, {
      items: [budget()],
      month: "2026-11",
      onRetry: () => {},
      ...props,
    })
  );

describe("홈 예산 상태 글자", () => {
  it("초과와 80% 이상을 색만이 아니라 글자로도 말한다", () => {
    expect(budgetStatus({ amount: 300_000, spent: 312_000 }, 1.04)).toEqual({
      text: "12,000원 초과",
      tone: "over",
    });
    expect(budgetStatus({ amount: 300_000, spent: 300_000 }, 1)).toEqual({
      text: "예산을 다 썼어요",
      tone: "over",
    });
    expect(budgetStatus({ amount: 300_000, spent: 255_000 }, 0.85)).toEqual({
      text: "45,000원 남았어요",
      tone: "near",
    });
    expect(budgetStatus({ amount: 300_000, spent: 120_000 }, 0.4)).toBeNull();
  });

  it("줄 아래에 상태 글자를 붙이고, 여유 있는 예산에는 붙이지 않는다", () => {
    const html = render({
      items: [
        budget({ id: "over", name: "외식", spent: 312_000, usageRate: 1.04 }),
        budget({ id: "near", name: "장보기", spent: 255_000, usageRate: 0.85 }),
        budget({ id: "ok", name: "교통", spent: 120_000, usageRate: 0.4 }),
      ],
    });
    expect(html).toContain("12,000원 초과");
    expect(html).toContain("text-destructive");
    expect(html).toContain("45,000원 남았어요");
    expect(html).toContain("text-warning-strong");
    expect(html).not.toContain("180,000원 남았어요");
    // 막대 값은 100에서 멈추므로 실제 사용률을 글자로 읽어 준다.
    expect(html).toContain('aria-valuetext="104% 사용"');
  });
});

describe("홈 예산 불러오기", () => {
  it("예산이 없거나 불러오는 중이면 그리지 않는다", () => {
    expect(render({ items: [] })).toBe("");
    expect(render({ items: undefined })).toBe("");
  });

  it("불러오지 못하면 조용히 사라지지 않고 한 줄 오류와 다시 불러오기를 둔다", () => {
    const html = render({ error: true });
    expect(html).toContain("예산");
    expect(html).toContain("예산을 불러오지 못했어요");
    expect(html).toContain('role="alert"');
    expect(html).toContain("다시 불러오기");
    // 실패 중에는 이전 값을 보여주지 않는다.
    expect(html).not.toContain("식비");
    expect(html).not.toContain("120,000원");
    expect(render({ error: true, retrying: true })).toContain(
      'aria-busy="true"'
    );
  });
});
