/**
 * 분석 탭 '앞으로 나갈 돈'(2026-11-05 HIG 검수 3·4단계).
 * 대표 숫자는 히어로의 '이번 달 소비' 하나라, 여기 두 금액은 본문 크기 '이름 · 값' 줄로 둔다.
 * 합계에서 뺀 이유는 정기 지출 화면과 같은 문장으로 말하고, 정기 지출로 가는 글자 링크는 44px이다.
 */
import type { RecurringUpcomingResponse } from "@family/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { endOfMonthKst, recurringUpcomingQueryKey } from "@/lib/recurring-api";

const HOUSEHOLD = "00000000-0000-4000-8000-000000000001";

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: vi.fn() }),
}));
vi.mock("@/lib/household-context", () => ({
  useHousehold: () => ({ householdId: HOUSEHOLD }),
}));

import { UpcomingSpendCard, leftOutText } from "./upcoming-card";

const item: RecurringUpcomingResponse["items"][number] = {
  id: "s-1",
  merchant: "넷플릭스",
  amount: 13_500,
  amountMin: 13_500,
  amountMax: 13_500,
  currency: "KRW",
  cadence: "monthly",
  nextExpectedAt: "2026-11-20T01:00:00.000Z",
  nextExpectedWindowDays: 2,
  nextExpectedPhase: "upcoming",
  overdueDays: 0,
  mine: true,
  amountForecastable: true,
  amountVaries: false,
  cardId: null,
};

function render(
  upcoming: Partial<RecurringUpcomingResponse> = {},
  props: { isCurrentMonth?: boolean; monthlyNet?: number | null } = {}
): string {
  const client = new QueryClient();
  client.setQueryData<RecurringUpcomingResponse>(
    recurringUpcomingQueryKey(HOUSEHOLD, endOfMonthKst()),
    {
      enabled: true,
      until: endOfMonthKst(),
      items: [item, { ...item, id: "s-2", nextExpectedPhase: "overdue" }],
      totalAmount: 27_000,
      totalCurrency: "KRW",
      forecastableCount: 2,
      excludedCount: 0,
      otherCurrencyCount: 0,
      ...upcoming,
    }
  );
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <UpcomingSpendCard
        isCurrentMonth={props.isCurrentMonth ?? true}
        monthlyNet={props.monthlyNet === undefined ? 100_000 : props.monthlyNet}
      />
    </QueryClientProvider>
  );
}

describe("앞으로 나갈 돈", () => {
  it("두 금액은 큰 숫자가 아니라 본문 크기 '이름 · 값' 줄이다", () => {
    const html = render();
    expect(html).toContain("앞으로 나갈 돈");
    expect(html).toContain("이번 달 예상 총액");
    expect(html).toContain("27,000원");
    expect(html).toContain("127,000원");
    expect(html).not.toMatch(/text-(2xl|lg|xl|display|title)\b/);
    expect(html).toContain(
      "정기 결제 2건이 이번 달에 남았어요 · 1건은 예정일이 지났어요"
    );
    expect(html).toContain("이미 쓴 돈에 남은 정기 결제만 더했어요.");
  });

  it("금액을 알 수 없으면 값 자리에 '금액 확인 전'이라 쓰고 예상 총액을 만들지 않는다", () => {
    const html = render({
      forecastableCount: 0,
      totalAmount: 0,
      excludedCount: 2,
    });
    expect(html).toContain("금액 확인 전");
    expect(html).not.toContain("이번 달 예상 총액");
    expect(html).toContain("2건은 금액을 아직 확인하지 못해 합계에서 뺐어요.");
  });

  it("정기 지출로 가는 글자 링크는 누르는 영역이 44px이다", () => {
    const html = render();
    const link =
      html.match(/<a\b[^>]*href="\/more\/recurring"[^>]*>[^<]*<\/a>/)?.[0] ??
      "";
    expect(link).toContain("정기 지출 전체 보기");
    expect(link).toContain("min-h-11");
    expect(link).toContain("active:");
  });

  it("과거 달이면 아무것도 그리지 않는다", () => {
    expect(render({}, { isCurrentMonth: false })).toBe("");
  });
});

describe("합계에서 뺀 이유 — 정기 지출 화면과 같은 문장", () => {
  it("금액 확인 전·외화를 한 줄로 말한다", () => {
    expect(leftOutText(0, 0)).toBeNull();
    expect(leftOutText(2, 0)).toBe(
      "2건은 금액을 아직 확인하지 못해 합계에서 뺐어요."
    );
    expect(leftOutText(0, 1)).toBe("1건은 외화라 합계에서 뺐어요.");
    expect(leftOutText(2, 1)).toBe(
      "2건은 금액을 아직 확인하지 못했고, 1건은 외화라 합계에서 뺐어요."
    );
  });

  it("'과거 거래 기준' 같은 내부 사정은 말하지 않는다", () => {
    const html = render({ excludedCount: 1, otherCurrencyCount: 1 });
    expect(html).not.toContain("과거 거래 기준");
    expect(html).toContain(
      "1건은 금액을 아직 확인하지 못했고, 1건은 외화라 합계에서 뺐어요."
    );
  });
});
