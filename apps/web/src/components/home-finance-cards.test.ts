import type { MonthlyAnalytics } from "@family/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeConsumptionCard, monthComparison, type HomeConsumptionCardProps } from "./home-consumption-card";

const noExceptions = { count: 0, loading: false, error: false, truncated: false };
const base: HomeConsumptionCardProps = { month: "2026-10", isCurrentMonth: true, loading: false, error: false, todo: {}, processing: noExceptions };
const monthly: MonthlyAnalytics = {
  meta: { period: { from: "2026-09-30T15:00:00Z", to: "2026-10-31T15:00:00Z", timezone: "Asia/Seoul" }, cancellationApplied: true, includedMemberIds: [], excludedByPermission: 0, excludedManual: { count: 0, net: 0 }, excludedTransfer: { count: 0, net: 0 } },
  totalNet: 0, totalApproved: 0, totalCancelled: 0, transactionCount: 0, previousNet: 0, deltaNet: 0, deltaRate: null,
};
const consumption = (props: Partial<HomeConsumptionCardProps> = {}) => renderToStaticMarkup(createElement(HomeConsumptionCard, { ...base, ...props }));

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

  it("hides the refund footnote while the amount is loading or failed", () => {
    // 취소로 생긴 기록은 이름 규칙대로 '환불'이다(분석 탭 '승인 · 환불'과 같은 말).
    expect(consumption({ monthly })).toContain("환불 반영");
    expect(consumption({ monthly })).not.toContain("결제 취소");
    expect(consumption({ monthly, loading: true })).not.toContain("환불 반영");
    expect(consumption({ monthly, error: true })).not.toContain("환불 반영");
    expect(consumption({ monthly, loading: true, pace: "지난달 이맘때보다 1,000원 덜 썼어요" })).not.toContain("지난달 이맘때");
  });

  it("preserves explicit zero from a successful server response but hides failed cached values", () => {
    expect(consumption({ monthly })).toContain(">0원</p>");
    expect(consumption({ monthly: { ...monthly, totalNet: 123456 }, error: true })).not.toContain("123,456원");
    expect(consumption({ monthly, error: true })).toContain("카드 사용액을 불러오지 못했어요");
    expect(consumption({ monthly, error: true })).not.toContain(">0원</p>");
    expect(consumption({ monthly: { ...monthly, totalNet: 123456 }, loading: true })).not.toContain("123,456원");
  });

  it("names the amount by its heading instead of hiding the number behind an aria-label, on one line", () => {
    const html = consumption({ monthly: { ...monthly, totalNet: 526339 } });
    expect(html).toContain('aria-labelledby="home-consumption-heading"');
    expect(html).toContain('id="home-consumption-heading"');
    expect(html).not.toContain("기록된 카드 소비");
    expect(html).not.toContain("break-all");
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("text-display");
    // 십억 원대 금액은 줄을 바꾸지 않고 한 단계 작은 글자로 내린다.
    const huge = consumption({ monthly: { ...monthly, totalNet: 1234567890 } });
    expect(huge).toContain("1,234,567,890원");
    expect(huge).toContain("text-title");
    expect(huge).not.toContain("text-display");
  });

  it("shows a skeleton while loading and a retry under the failure line", () => {
    const loading = consumption({ loading: true });
    expect(loading).toContain('role="status"');
    expect(loading).toContain("카드 사용액을 불러오고 있어요");
    expect(loading).not.toContain("불러오지 못했어요");
    const failed = consumption({ error: true, onRetry: () => {} });
    expect(failed).toContain("카드 사용액을 불러오지 못했어요");
    expect(failed).toContain("다시 불러오기");
    expect(failed).toContain('role="alert"');
    expect(consumption({ error: true, onRetry: () => {}, retrying: true })).toContain('aria-busy="true"');
  });

  it("does not display another member's private-row existence count on the new home", () => {
    const before = consumption({ monthly });
    const after = consumption({ monthly: { ...monthly, meta: { ...monthly.meta, excludedByPermission: 98765 } } });
    expect(after).toBe(before);
  });
});

describe("home one-line summaries", () => {
  it("does not compare an unfinished month against a finished one", () => {
    expect(monthComparison({ ...monthly, totalNet: 1000, previousNet: 5000, deltaNet: -4000 }, true, "2026-11")).toBe("지난달 5,000원");
    expect(monthComparison({ ...monthly, totalNet: 1000, previousNet: 5000, deltaNet: -4000 }, false, "2026-09")).toBe("2026년 8월보다 4,000원 덜 썼어요");
    expect(monthComparison({ ...monthly, totalNet: 9000, previousNet: 5000, deltaNet: 4000 }, false, "2026-09")).toBe("2026년 8월보다 4,000원 더 썼어요");
    expect(monthComparison({ ...monthly, totalNet: 5000, previousNet: 5000, deltaNet: 0 }, false, "2026-09")).toBe("2026년 8월과 같아요");
    // 1월의 앞 달은 전년도 12월이다.
    expect(monthComparison({ ...monthly, totalNet: 1000, previousNet: 5000, deltaNet: -4000 }, false, "2026-01")).toBe("2025년 12월보다 4,000원 덜 썼어요");
    expect(monthComparison(monthly, false, "2026-09")).toBeNull();
    // 이번 달의 비교 대상은 '지난달' 한 이름이다.
    for (const text of ["전달", "지난달 전체"]) {
      expect(monthComparison({ ...monthly, totalNet: 1000, previousNet: 5000, deltaNet: -4000 }, true, "2026-11")).not.toContain(text);
      expect(monthComparison({ ...monthly, totalNet: 1000, previousNet: 5000, deltaNet: -4000 }, false, "2026-09")).not.toContain(text);
    }
  });

  it("names the actual previous month when viewing a past month", () => {
    // 지난 달 화면에서 '지난달'은 오늘 기준 지난달로 읽힌다. 막 끝난 10월을 봐도 비교 대상은 9월이다.
    for (const deltaNet of [-4000, 0, 4000]) {
      const text = monthComparison({ ...monthly, totalNet: 5000 + deltaNet, previousNet: 5000, deltaNet }, false, "2026-10");
      expect(text).toContain("2026년 9월");
      expect(text).not.toContain("지난달");
    }
    const html = consumption({
      month: "2026-09",
      isCurrentMonth: false,
      monthly: { ...monthly, totalNet: 1000, previousNet: 5000, deltaNet: -4000 },
    });
    expect(html).toContain("2026년 8월보다 4,000원 덜 썼어요");
    expect(html).not.toContain("지난달");
  });
});
