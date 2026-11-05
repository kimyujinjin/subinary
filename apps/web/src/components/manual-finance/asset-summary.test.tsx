import type { ManualAssetSummary } from "@family/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConnectedHolding } from "@/lib/net-worth";
import { ManualAssetsSummary, netWorthSources } from "./asset-summary";

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
  // 예전에는 가져온 대출이 있으면 직접 입력 기준일을 통째로 지웠다. 지금은 출처마다 자기 시각을 붙여 은행 날짜로 읽히지 않는다.
  it("attributes manual dates to 직접 입력 and marks the imported bank balance date unknown", () => {
    const html = renderToStaticMarkup(createElement(ManualAssetsSummary, {
      summary: mixedDates,
      hasImportedBalance: true,
    }));
    expect(html).toContain("100,000원");
    expect(html).toContain("직접 입력 항목별 기준일 2020년 1월 1일 ~ 2020년 1월 3일 · 가져온 신한 대출(은행 잔액 기준일 미확인)");
    expect(html).not.toContain("2020-01-01");
    expect(html).not.toContain("2020-01-03");
  });
  it.each([undefined, false])("preserves the manual date range when hasImportedBalance is %s", (hasImportedBalance) => {
    const html = renderToStaticMarkup(createElement(ManualAssetsSummary, { summary: mixedDates, hasImportedBalance }));
    expect(html).toContain("직접 입력 항목별 기준일 2020년 1월 1일 ~ 2020년 1월 3일");
    expect(html).not.toContain("은행 잔액 기준일 미확인");
  });
  it("shows only net worth and the two total rows — the per-kind breakdown belongs to the list", () => {
    const html = renderToStaticMarkup(createElement(ManualAssetsSummary, { summary: mixedDates, holdings: [holding()] }));
    expect(html.match(/<dt/g)).toHaveLength(2);
    expect(html).not.toContain("%");
    expect(html).not.toContain("통장");
  });
  it("says the total has no amounts yet instead of 'no assets' when only blank entries exist", () => {
    const html = renderToStaticMarkup(createElement(ManualAssetsSummary, { summary: { ...empty, assetsCompleteness: "partial", completeness: "partial" } }));
    expect(html).toContain("합계에 넣을 금액이 아직 없어요");
    expect(html).not.toContain("등록된 자산이 없어요");
  });
  // 서버는 '기록만 보관' 대출만 있으면 completeness를 'empty'로 둔다 — 아래 목록에는 그 대출이 보인다.
  it("does not say 'no assets' when only reference-only imported loans are listed", () => {
    const html = renderToStaticMarkup(createElement(ManualAssetsSummary, { summary: empty, hasUncountedRecords: true }));
    expect(html).toContain("합계에 넣을 금액이 아직 없어요");
    expect(html).not.toContain("등록된 자산이 없어요");
  });
  it("always names the debt row 남은 대출 and says why it is partial", () => {
    const debtPartial: ManualAssetSummary = { ...mixedDates, debtCompleteness: "partial", completeness: "partial", netAssets: null };
    const unresolved = renderToStaticMarkup(createElement(ManualAssetsSummary, { summary: debtPartial, unresolvedLoans: 2 }));
    expect(unresolved).toContain(">남은 대출 (일부만 합산)<");
    expect(unresolved).not.toContain("일부 입력");
    const blanks = renderToStaticMarkup(createElement(ManualAssetsSummary, { summary: debtPartial }));
    expect(blanks).toContain(">남은 대출 (일부 입력)<");
    const complete = renderToStaticMarkup(createElement(ManualAssetsSummary, { summary: mixedDates, unresolvedLoans: 0 }));
    expect(complete).toContain(">남은 대출<");
  });
});

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
function holding(overrides: Partial<ConnectedHolding> = {}): ConnectedHolding {
  return {
    id: "h1", kind: "stock", provider: "toss_securities", label: "합성 증권", ownerName: "가족", own: true,
    observedAt: minutesAgo(3), krw: "1000", usd: null, usdInKrw: null, totalKrw: 1000n, stale: false,
    ...overrides,
  };
}

describe("순자산 출처 한 줄", () => {
  const base: ManualAssetSummary = { currency: "KRW", grossAssets: "1000", debt: null, netAssets: null, assetsCompleteness: "complete", debtCompleteness: "empty", completeness: "partial", asOfDate: "2026-11-01", oldestAsOfDate: "2026-11-01", newestAsOfDate: "2026-11-01", mixedAsOfDates: false };
  const now = new Date("2026-11-05T03:00:00Z");
  it("직접 입력은 기준일을 'M월 D일'로 붙인다", () => {
    expect(netWorthSources({ summary: base, now })).toEqual(["직접 입력 기준일 11월 1일"]);
  });
  it("연결 계좌는 금융사별로 가장 오래된 조회 시각을 붙인다", () => {
    const sources = netWorthSources({
      summary: base,
      now,
      holdings: [
        holding(),
        holding({ id: "s1", provider: "shinhan_bank", kind: "account", observedAt: minutesAgo(5) }),
        holding({ id: "s2", provider: "shinhan_bank", kind: "loan", observedAt: minutesAgo(180) }),
      ],
    });
    expect(sources).toEqual(["직접 입력 기준일 11월 1일", "신한은행 3시간 전", "토스증권 3분 전"]);
  });
  it("금액이 없어 합계에 들어가지 않은 연결 계좌는 출처로 적지 않는다", () => {
    expect(netWorthSources({ summary: base, now, holdings: [holding({ totalKrw: null, krw: null })] })).toEqual(["직접 입력 기준일 11월 1일"]);
  });
  it("직접 입력이 없으면 연결 계좌와 가져온 대출만 적는다", () => {
    const summary = { ...base, grossAssets: null, oldestAsOfDate: null, newestAsOfDate: null, asOfDate: null };
    expect(netWorthSources({ summary, now, holdings: [holding()], hasImportedBalance: true })).toEqual([
      "토스증권 3분 전",
      "가져온 신한 대출(은행 잔액 기준일 미확인)",
    ]);
  });
  it("요약 화면에 출처를 ' · '로 이어 한 줄로 보인다", () => {
    const html = renderToStaticMarkup(createElement(ManualAssetsSummary, { summary: base, holdings: [holding()] }));
    expect(html).toContain("토스증권 3분 전");
    expect(html).toContain("2,000원");
  });
});
