import type {
  RecurringSeriesItem,
  RecurringSeriesListResponse,
  RecurringUpcomingResponse,
} from "@family/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  endOfMonthKst,
  recurringQueryKey,
  recurringUpcomingQueryKey,
} from "@/lib/recurring-api";

const HOUSEHOLD = "00000000-0000-4000-8000-000000000001";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/more/recurring",
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: vi.fn() }),
}));
vi.mock("@/lib/household-context", () => ({
  useHousehold: () => ({ householdId: HOUSEHOLD }),
}));

import RecurringPage from "./page";

const base: RecurringSeriesItem = {
  id: "s-0",
  merchant: "넷플릭스",
  amount: 13_500,
  amountMin: 13_500,
  amountMax: 13_500,
  currency: "KRW",
  cadence: "monthly",
  intervalDays: 30,
  occurrenceCount: 5,
  firstSeenAt: "2026-06-03T01:00:00.000Z",
  lastSeenAt: "2026-10-03T01:00:00.000Z",
  status: "confirmed",
  needsReviewReason: null,
  mine: true,
  moneyContractVersion: 2,
  nextExpectedAt: "2026-11-03T01:00:00.000Z",
  nextExpectedWindowDays: 2,
  nextExpectedPhase: "upcoming",
  overdueDays: 0,
  stoppedCandidate: false,
  recentDeclineReason: null,
  recentDeclineAttempts: 0,
};

const items: RecurringSeriesItem[] = [
  { ...base, id: "s-1", merchant: "멜론", status: "candidate", nextExpectedAt: null, nextExpectedPhase: null, nextExpectedWindowDays: null },
  { ...base, id: "s-2", merchant: "넷플릭스" },
  { ...base, id: "s-3", merchant: "헬스장", nextExpectedPhase: "overdue", overdueDays: 9, stoppedCandidate: true },
  { ...base, id: "s-4", merchant: "(비공개)", mine: false },
  { ...base, id: "s-5", merchant: "쿠팡와우", status: "rejected" },
];

function render(list: Partial<RecurringSeriesListResponse> = {}): string {
  const client = new QueryClient();
  client.setQueryData<RecurringSeriesListResponse>(recurringQueryKey(HOUSEHOLD), {
    enabled: true,
    provisional: false,
    items,
    computedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    calculationStatus: "computed",
    ...list,
  });
  client.setQueryData<RecurringUpcomingResponse>(
    recurringUpcomingQueryKey(HOUSEHOLD, endOfMonthKst()),
    {
      enabled: true,
      until: endOfMonthKst(),
      items: [
        {
          id: "s-2",
          merchant: "넷플릭스",
          amount: 13_500,
          amountMin: 13_500,
          amountMax: 13_500,
          currency: "KRW",
          cadence: "monthly",
          nextExpectedAt: "2026-11-03T01:00:00.000Z",
          nextExpectedWindowDays: 2,
          nextExpectedPhase: "upcoming",
          overdueDays: 0,
          mine: true,
          amountForecastable: true,
          amountVaries: false,
          cardId: null,
        },
      ],
      totalAmount: 13_500,
      totalCurrency: "KRW",
      forecastableCount: 1,
      excludedCount: 0,
      otherCurrencyCount: 1,
    },
  );
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(RecurringPage)),
  );
}

const count = (html: string, text: string) => html.split(text).length - 1;

describe("정기 지출 화면", () => {
  it("손으로 다시 찾는 버튼 대신 마지막으로 찾은 시각을 말한다", () => {
    const html = render();
    expect(html).not.toContain("다시 찾기");
    expect(html).toContain("12분 전 확인");
  });

  it("이번 달 남은 합계를 대표 금액으로, 합계에서 뺀 것을 한 줄로 말한다", () => {
    const html = render();
    expect(html).toMatch(/text-display[^>]*>.*13,500원/);
    expect(html).toContain("1건은 외화라 합계에서 뺐어요.");
  });

  it("상태별로 묶고, 답 버튼은 답이 필요한 행에만 둔다", () => {
    const html = render();
    expect(html).toContain("확인 필요");
    expect(html).toContain(">정기 결제<");
    // 후보 1건에만 답 버튼이 있다 — 확정된 행의 "맞아요"는 다시 그리지 않는다.
    expect(count(html, "정기 결제 맞아요")).toBe(1);
    // 확정된 행은 ⋯ 메뉴로 답을 바꾼다.
    expect(html).toContain('aria-label="넷플릭스 답 바꾸기"');
    // 해지 질문은 그 행에만.
    expect(count(html, "해지하셨나요?")).toBe(1);
    expect(html).toContain("계속 써요");
  });

  it("아님·해지는 접혀 있다", () => {
    const html = render();
    expect(html).toContain("아님·해지");
    expect(html).toContain("1건 보기");
    expect(html).not.toContain("쿠팡와우");
  });

  it("행을 누르면 그 가맹점의 전체 기간 결제 내역으로 가고, 가려진 이름에는 링크가 없다", () => {
    const html = render();
    expect(html).toContain(
      `href="/transactions?month=all&amp;q=${encodeURIComponent("넷플릭스")}"`,
    );
    expect(html).not.toContain(`q=${encodeURIComponent("(비공개)")}`);
  });

  it("후보 0건과 아직 계산 전을 구분한다", () => {
    expect(render({ items: [] })).toContain("아직 찾은 정기 결제가 없어요");
    expect(
      render({ items: [], computedAt: null, calculationStatus: "not_computed" }),
    ).toContain("정기 결제를 찾고 있어요");
  });

  it("불러오지 못하면 공용 오류 상태로 원인 한 줄과 '다시 불러오기'만 보여 준다", async () => {
    // retryOnMount: false — 실패한 쿼리를 그리는 순간 다시 불러오기로 바꾸지 않게 해 오류 화면을 그대로 본다.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } },
    });
    await client.prefetchQuery({
      queryKey: recurringQueryKey(HOUSEHOLD),
      queryFn: () => Promise.reject(new Error("offline")),
    });
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(RecurringPage)),
    );
    expect(html).toMatch(/<p role="alert"[^>]*>정기 지출을 불러오지 못했어요<\/p>/);
    expect(html).toMatch(/<button[^>]*>다시 불러오기<\/button>/);
    expect(html).not.toContain("아직 준비 중이에요");
  });

  it("기능이 꺼져 있으면 한 문장으로 준비 중이라고 말한다", () => {
    const html = render({ enabled: false, items: [], computedAt: null });
    expect(html).toContain("아직 준비 중이에요");
    expect(html).toContain("정기 지출 찾기는 아직 켜지 않았어요.");
  });
});

describe("정기 지출 화면 — 합계 자리·문구(2026-11-05 HIG 검수)", () => {
  function seriesOnly(): QueryClient {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } },
    });
    client.setQueryData<RecurringSeriesListResponse>(recurringQueryKey(HOUSEHOLD), {
      enabled: true,
      provisional: false,
      items,
      computedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      calculationStatus: "computed",
    });
    return client;
  }
  const html = (client: QueryClient) =>
    renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(RecurringPage)),
    );

  it("합계가 목록보다 늦게 와도 목록을 밀어내지 않게 자리를 스켈레톤으로 잡아 둔다", () => {
    const out = html(seriesOnly());
    expect(out).toContain("이번 달 남은 정기 결제를 불러오는 중이에요.");
    expect(out).toMatch(/<section role="status" aria-busy="true"/);
    // 화면에 보이는 '불러오는 중' 글자는 없다(읽기 프로그램 전용).
    expect(out).not.toContain(">불러오고 있어요");
  });

  it("예정 0건 응답에서도 확정된 정기 결제가 있으면 합계 자리가 남는다(월말 레이아웃 이동 방지)", () => {
    const client = seriesOnly();
    client.setQueryData<RecurringUpcomingResponse>(
      recurringUpcomingQueryKey(HOUSEHOLD, endOfMonthKst()),
      {
        enabled: true,
        until: endOfMonthKst(),
        items: [],
        totalAmount: 0,
        totalCurrency: "KRW",
        forecastableCount: 0,
        excludedCount: 0,
        otherCurrencyCount: 0,
      },
    );
    const out = html(client);
    expect(out).toContain("이번 달 남은 정기 결제");
    expect(out).toContain("이번 달에 더 나갈 정기 결제는 없어요.");
    // 빈 합계를 금액(0원)으로 말하지 않는다 — '정기 결제가 없다'로 읽히지 않게 남은 것이 없다는 사실만.
    expect(out).not.toMatch(/text-display[^>]*>/);
    expect(out).not.toContain("불러오는 중이에요");
  });

  it("확정된 정기 결제가 없으면(예정은 확정만 센다) 합계 자리를 잡지 않는다", () => {
    const client = seriesOnly();
    client.setQueryData<RecurringSeriesListResponse>(recurringQueryKey(HOUSEHOLD), {
      enabled: true,
      provisional: false,
      items: items.filter((item) => item.status !== "confirmed"),
      computedAt: new Date().toISOString(),
      calculationStatus: "computed",
    });
    const before = html(client);
    expect(before).not.toContain("이번 달 남은 정기 결제를 불러오는 중이에요.");
    expect(before).not.toContain("이번 달 남은 정기 결제");

    client.setQueryData<RecurringUpcomingResponse>(
      recurringUpcomingQueryKey(HOUSEHOLD, endOfMonthKst()),
      {
        enabled: true,
        until: endOfMonthKst(),
        items: [],
        totalAmount: 0,
        totalCurrency: "KRW",
        forecastableCount: 0,
        excludedCount: 0,
        otherCurrencyCount: 0,
      },
    );
    expect(html(client)).not.toContain("이번 달 남은 정기 결제");
  });

  it("합계를 못 불러오면 조용히 빼지 않고 '다시 불러오기'를 준다", async () => {
    const client = seriesOnly();
    await client.prefetchQuery({
      queryKey: recurringUpcomingQueryKey(HOUSEHOLD, endOfMonthKst()),
      queryFn: () => Promise.reject(new Error("offline")),
    });
    const out = html(client);
    expect(out).toMatch(/<p role="alert"[^>]*>이번 달 남은 정기 결제를 불러오지 못했어요<\/p>/);
    expect(out).toMatch(/<button[^>]*>다시 불러오기<\/button>/);
  });

  it("예상일 범위는 기호(±) 대신 말로 쓴다", () => {
    const out = render();
    expect(out).toMatch(/다음 결제 (\d{4}년 )?11월 3일쯤\(2일 앞뒤\)/);
    expect(out).not.toContain("±");
  });

  it("링크가 걸린 줄은 폰에서도 ›를 보인다", () => {
    expect(render()).toContain("lucide-chevron-right");
  });

  it("결제 실패 링크는 손가락 영역 44px이다", () => {
    const client = seriesOnly();
    client.setQueryData<RecurringSeriesListResponse>(recurringQueryKey(HOUSEHOLD), {
      enabled: true,
      provisional: false,
      items: [{ ...base, recentDeclineAttempts: 3 }],
      computedAt: new Date().toISOString(),
      calculationStatus: "computed",
    });
    expect(html(client)).toMatch(/class="[^"]*min-h-11[^"]*" href="\/declines"/);
  });
});
