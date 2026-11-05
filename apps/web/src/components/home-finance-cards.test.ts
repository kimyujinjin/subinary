import type { ManualAssetSummary, MonthlyAnalytics } from "@family/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeConsumptionCard, monthComparison, type HomeConsumptionCardProps } from "./home-consumption-card";
import { ManualAssetsSummary } from "./manual-finance/asset-summary";

const noExceptions = { count: 0, loading: false, error: false, truncated: false };
const base: HomeConsumptionCardProps = { month: "2026-10", isCurrentMonth: true, loading: false, error: false, todo: {}, processing: noExceptions };
const monthly: MonthlyAnalytics = {
  meta: { period: { from: "2026-09-30T15:00:00Z", to: "2026-10-31T15:00:00Z", timezone: "Asia/Seoul" }, cancellationApplied: true, includedMemberIds: [], excludedByPermission: 0, excludedManual: { count: 0, net: 0 }, excludedTransfer: { count: 0, net: 0 } },
  totalNet: 0, totalApproved: 0, totalCancelled: 0, transactionCount: 0, previousNet: 0, deltaNet: 0, deltaRate: null,
};
const consumption = (props: Partial<HomeConsumptionCardProps> = {}) => renderToStaticMarkup(createElement(HomeConsumptionCard, { ...base, ...props }));

describe("asset summary empty and partial states", () => {
  const empty: ManualAssetSummary = { currency: "KRW", grossAssets: null, debt: null, netAssets: null, assetsCompleteness: "empty", debtCompleteness: "empty", completeness: "empty", asOfDate: null, oldestAsOfDate: null, newestAsOfDate: null, mixedAsOfDates: false };
  it("shows an invitation to add assets instead of empty financial totals", () => {
    const html = renderToStaticMarkup(createElement(ManualAssetsSummary, { summary: empty }));
    expect(html).toContain("등록된 자산이 없어요");
    expect(html).not.toContain("— 원");
    expect(html).not.toContain("0원");
  });
  it("computes net worth from entered values only and keeps blanks as 미입력", () => {
    const html = renderToStaticMarkup(createElement(ManualAssetsSummary, { summary: { ...empty, grossAssets: "100000", assetsCompleteness: "partial", completeness: "partial" }, scope: "private" }));
    expect(html).toContain("100,000원");
    expect(html).toContain("자산 (일부 입력)");
    expect(html).toContain("미입력");
    expect(html).not.toContain("순자산은 아직 계산하지 않았어요");
    expect(html).not.toContain("— 원");
    expect(html).toContain("나만 보는 자산");
    expect(html).not.toContain("등록된 자산이 없어요");
  });
  it("shows a debt-only household as a negative net worth while keeping assets 미입력 (user decision §8)", () => {
    const html = renderToStaticMarkup(createElement(ManualAssetsSummary, {
      summary: { ...empty, debt: "90071992547409931234", debtCompleteness: "complete", completeness: "partial" },
    }));
    expect(html).toContain("90,071,992,547,409,931,234원");
    expect(html).toContain("남은 대출");
    expect(html).toContain("미입력");
    expect(html).toContain("-90,071,992,547,409,931,234원");
    expect(html).not.toContain(">0원<");
    expect(html).not.toContain("— 원");
  });
  const mixedDates: ManualAssetSummary = {
    ...empty,
    grossAssets: "200000",
    debt: "100000",
    netAssets: "100000",
    assetsCompleteness: "complete",
    debtCompleteness: "complete",
    completeness: "complete",
    oldestAsOfDate: "2020-01-01",
    newestAsOfDate: "2020-01-03",
    mixedAsOfDates: true,
  };
  it("preserves an explicitly calculated zero net worth", () => {
    const html = renderToStaticMarkup(createElement(ManualAssetsSummary, {
      summary: { ...mixedDates, grossAssets: "100000", netAssets: "0" },
    }));
    expect(html).toContain(">0원</p>");
    expect(html).not.toContain("순자산은 아직 계산하지 않았어요");
  });
  it("does not present manual dates as bank balance dates when imported debt is included", () => {
    const html = renderToStaticMarkup(createElement(ManualAssetsSummary, {
      summary: mixedDates,
      hasImportedBalance: true,
      sourceLabel: "직접 입력·신한 브라우저 확인",
    }));
    expect(html).toContain("100,000원");
    expect(html).toContain("은행 잔액 기준일 미확인");
    expect(html).toContain("직접 입력·신한 브라우저 확인");
    expect(html).not.toContain("항목별 기준일");
    expect(html).not.toContain("2020-01-01");
    expect(html).not.toContain("2020-01-03");
  });
  it.each([undefined, false])("preserves the manual date range when hasImportedBalance is %s", (hasImportedBalance) => {
    const html = renderToStaticMarkup(createElement(ManualAssetsSummary, { summary: mixedDates, hasImportedBalance }));
    expect(html).toContain("항목별 기준일 2020-01-01 ~ 2020-01-03");
    expect(html).toContain("직접 입력");
    expect(html).not.toContain("은행 잔액 기준일 미확인");
  });
});

describe("quiet home transaction exceptions", () => {
  it("has no standing review card, empty count or synthetic financial values", () => {
    const html = consumption();
    expect(html).not.toContain("확인할 거래");
    expect(html).not.toContain("거래 검토함");
    expect(html).not.toContain("가상");
    expect(html).not.toContain("— 원");
    expect(html).not.toContain(">0원</p>");
    expect(html).toContain("카드 사용액을 불러오지 못했어요");
  });

  it("shows a small review link to the to-do section only after the count is known", () => {
    const reviews = { ...noExceptions, count: 2, truncated: true };
    expect(consumption({ todo: { reviews } })).toContain('href="/todo?section=reviews"');
    expect(consumption({ todo: { reviews } })).toContain("확인할 거래 2+건");
    expect(consumption({ todo: { reviews: { ...reviews, loading: true } } })).not.toContain("확인할 거래");
    expect(consumption({ todo: { reviews: { ...reviews, error: true } } })).not.toContain("확인할 거래");
  });

  it("lists to-do rows in the to-do screen order, each linking to its section", () => {
    const one = { ...noExceptions, count: 1 };
    const html = consumption({ todo: { reviews: one, sms: { ...one, count: 4 }, requests: one, declines: { ...one, count: 2 } } });
    const order = ["결제 실패 2건", "가족이 물어본 결제 1건", "확인할 거래 1건", "확인할 문자 4건"].map((text) => html.indexOf(text));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const section of ["declines", "requests", "sms", "reviews"]) {
      expect(html).toContain(`href="/todo?section=${section}"`);
    }
  });

  it("keeps processing as a gray status line, not a link the user must act on", () => {
    const html = consumption({ processing: { ...noExceptions, count: 3 } });
    expect(html).toContain("문자 3건을 거래에 반영하는 중이에요");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("section=processing");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("확인할 거래");
    expect(html).not.toContain("재처리");
    expect(consumption({ processing: { ...noExceptions, count: 3, truncated: true } })).toContain("문자 3+건을");
    expect(consumption({ processing: { ...noExceptions, count: 3, loading: true } })).not.toContain("반영하는 중");
    expect(consumption({ processing: { ...noExceptions, count: 3, error: true } })).not.toContain("반영하는 중");
  });

  it("states FX-stalled SMS as stalled, with a row to the processing section, after the to-do rows", () => {
    const html = consumption({
      todo: { reviews: { ...noExceptions, count: 1 } },
      processing: { ...noExceptions, count: 2, fxMissing: 3 },
    });
    expect(html).toContain("문자 2건을 거래에 반영하는 중이에요");
    expect(html).toContain("문자 3건은 그날 환율이 없어 아직 반영하지 못했어요");
    expect(html).toContain('href="/todo?section=processing"');
    expect(html.indexOf("확인할 거래 1건")).toBeLessThan(html.indexOf("그날 환율이 없어"));
    // 환율 대기만 있으면 '반영하는 중'이라고 말하지 않는다.
    const fxOnly = consumption({ processing: { ...noExceptions, fxMissing: 1 } });
    expect(fxOnly).toContain("문자 1건은 그날 환율이 없어 아직 반영하지 못했어요");
    expect(fxOnly).not.toContain("반영하는 중");
    expect(fxOnly).not.toContain("section=reviews");
    expect(consumption({ processing: { ...noExceptions, fxMissing: 1, truncated: true } })).toContain("문자 1+건은");
    for (const unknown of [{ ...noExceptions, loading: true }, { ...noExceptions, error: true }]) {
      const hidden = consumption({ processing: { ...unknown, fxMissing: 1 } });
      expect(hidden).not.toContain("환율");
      expect(hidden).not.toContain("section=processing");
    }
  });

  it("hides the cancellation footnote while the amount is loading or failed", () => {
    expect(consumption({ monthly })).toContain("결제 취소 반영");
    expect(consumption({ monthly, loading: true })).not.toContain("결제 취소 반영");
    expect(consumption({ monthly, error: true })).not.toContain("결제 취소 반영");
    expect(consumption({ monthly, loading: true, pace: "지난달 이맘때보다 1,000원 덜 썼어요" })).not.toContain("지난달 이맘때");
  });

  it("preserves explicit zero from a successful server response but hides failed cached values", () => {
    expect(consumption({ monthly })).toContain(">0원</p>");
    expect(consumption({ monthly: { ...monthly, totalNet: 123456 }, error: true })).not.toContain("123,456원");
    expect(consumption({ monthly, error: true })).toContain("카드 사용액을 불러오지 못했어요");
    expect(consumption({ monthly, error: true })).not.toContain(">0원</p>");
    expect(consumption({ monthly: { ...monthly, totalNet: 123456 }, loading: true })).not.toContain("123,456원");
  });

  it("does not display another member's private-row existence count on the new home", () => {
    const before = consumption({ monthly });
    const after = consumption({ monthly: { ...monthly, meta: { ...monthly.meta, excludedByPermission: 98765 } } });
    expect(after).toBe(before);
  });
});

describe("home one-line summaries", () => {
  it("does not compare an unfinished month against a finished one", () => {
    expect(monthComparison({ ...monthly, totalNet: 1000, previousNet: 5000, deltaNet: -4000 }, true)).toBe("지난달 전체 5,000원");
    expect(monthComparison({ ...monthly, totalNet: 1000, previousNet: 5000, deltaNet: -4000 }, false)).toBe("전달보다 4,000원 덜 썼어요");
    expect(monthComparison({ ...monthly, totalNet: 9000, previousNet: 5000, deltaNet: 4000 }, false)).toBe("전달보다 4,000원 더 썼어요");
    expect(monthComparison(monthly, false)).toBeNull();
  });
});
