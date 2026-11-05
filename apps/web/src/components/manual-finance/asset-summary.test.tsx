import type { ManualAssetSummary } from "@family/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ManualAssetsSummary } from "./asset-summary";

// home-finance-cards.test.ts 에서 옮겼다(2026-11-05) — 자산 요약은 자산 탭 담당이 고친다.
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
