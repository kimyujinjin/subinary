import type { ManualHousingSummary, MonthlyAnalytics } from "@family/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeConsumptionCard, type HomeConsumptionCardProps } from "./home-consumption-card";
import { HomeHousingCard } from "./home-housing-card";

const noExceptions = { count: 0, loading: false, error: false, truncated: false };
const base: HomeConsumptionCardProps = { month: "2026-10", isCurrentMonth: true, loading: false, error: false, reviews: noExceptions, processing: noExceptions };
const monthly: MonthlyAnalytics = {
  meta: { period: { from: "2026-09-30T15:00:00Z", to: "2026-10-31T15:00:00Z", timezone: "Asia/Seoul" }, cancellationApplied: true, includedMemberIds: [], excludedByPermission: 0, excludedManual: { count: 0, net: 0 }, excludedTransfer: { count: 0, net: 0 } },
  totalNet: 0, totalApproved: 0, totalCancelled: 0, transactionCount: 0, previousNet: 0, deltaNet: 0, deltaRate: null,
};
const consumption = (props: Partial<HomeConsumptionCardProps> = {}) => renderToStaticMarkup(createElement(HomeConsumptionCard, { ...base, ...props }));
const housing = (summary?: ManualHousingSummary, props: { loading?: boolean; error?: boolean } = {}) => renderToStaticMarkup(createElement(HomeHousingCard, { summary, loading: false, error: false, scope: "household", ...props }));

describe("quiet home transaction exceptions", () => {
  it("has no standing review card, empty count or synthetic financial values", () => {
    const html = consumption();
    expect(html).not.toContain("확인 필요한 거래");
    expect(html).not.toContain("거래 검토함");
    expect(html).not.toContain("가상");
    expect(html).toContain("— 원");
  });

  it("shows a small all-time review link only after the count is known", () => {
    const props = { reviews: { ...noExceptions, count: 2, truncated: true } };
    expect(consumption(props)).toContain('href="/transactions?review=1"');
    expect(consumption(props)).toContain("확인 필요한 거래 2+건");
    expect(consumption({ reviews: { ...props.reviews, loading: true } })).not.toContain("확인 필요한 거래");
    expect(consumption({ reviews: { ...props.reviews, error: true } })).not.toContain("확인 필요한 거래");
  });

  it("keeps processing as a neutral state instead of a user judgment notice", () => {
    const html = consumption({ processing: { ...noExceptions, count: 3 } });
    expect(html).toContain("문자 정리·환율 확인 대기 3건");
    expect(html).toContain('role="status"');
    expect(html).toContain('href="/todo?section=processing"');
    expect(html).not.toContain("확인 필요한 거래");
    expect(html).not.toContain("재처리");
  });

  it("preserves explicit zero from a successful server response but hides failed cached values", () => {
    expect(consumption({ monthly })).toContain(">0원</p>");
    expect(consumption({ monthly: { ...monthly, totalNet: 123456 }, error: true })).not.toContain("123,456원");
    expect(consumption({ monthly, error: true })).toContain(">— 원</p>");
  });

  it("does not display another member's private-row existence count on the new home", () => {
    const before = consumption({ monthly });
    const after = consumption({ monthly: { ...monthly, meta: { ...monthly.meta, excludedByPermission: 98765 } } });
    expect(after).toBe(before);
  });
});

describe("home housing summary evidence", () => {
  it("does not turn absent payment or occupancy information into zero or a claimed date", () => {
    const html = housing({ nextPayment: null, hasIncompletePayments: true });
    expect(html).toContain("— 원");
    expect(html).toContain("미입력 정보");
    expect(html).not.toContain("2029");
    expect(html).not.toContain("0원</p>");
  });

  it("shows only the server-selected payment and its exact stored amount and date", () => {
    const html = housing({ nextPayment: { planId: "00000000-0000-4000-8000-000000000001", paymentId: "00000000-0000-4000-8000-000000000002", label: "합성 테스트 주택", kind: "interim", installment: 2, dueDate: "2026-11-01", remainingAmountKrw: "90071992547409931234" }, hasIncompletePayments: false });
    expect(html).toContain("합성 테스트 주택");
    expect(html).toContain("중도금 2회차");
    expect(html).toContain("2026-11-01");
    expect(html).toContain("90,071,992,547,409,931,234원");
  });

  it("hides cached payment evidence while the query has failed or the scope is loading", () => {
    const summary: ManualHousingSummary = { nextPayment: { planId: "00000000-0000-4000-8000-000000000001", paymentId: "00000000-0000-4000-8000-000000000002", label: "합성 테스트 주택", kind: "balance", installment: null, dueDate: "2026-11-01", remainingAmountKrw: "7000000" }, hasIncompletePayments: false };
    for (const state of [{ error: true }, { loading: true }]) {
      const html = housing(summary, state);
      expect(html).not.toContain("합성 테스트 주택");
      expect(html).not.toContain("7,000,000원");
      expect(html).toContain("— 원");
    }
  });
});
