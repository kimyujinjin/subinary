/**
 * 홈의 달 이동은 소비 카드에만 적용한다(2026-11-06 결정 ②).
 * 지난 달을 골라도 아래 섹션(누가 썼나·예산·다가오는 지출·지난주)은 이번 달·오늘 기준으로 읽고 그대로 보인다 —
 * 섹션 제목에 달이 없어, 지난 달 예산이 이번 달 예산처럼 읽혔다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOUSEHOLD = "00000000-0000-4000-8000-000000000001";

const nav = vi.hoisted(() => ({ search: "" }));
const calls = vi.hoisted(() => ({
  monthly: [] as unknown[],
  budgets: [] as unknown[],
  members: [] as unknown[],
  ranges: [] as unknown[],
  categoryRanges: [] as unknown[],
  cards: [] as unknown[][],
  queries: [] as Array<{ enabled?: boolean }>,
}));

function ok<T>(data: T) {
  return {
    data,
    isLoading: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch: () => Promise.resolve(),
  };
}

const meta = {
  period: {
    from: "2026-10-31T15:00:00Z",
    to: "2026-11-30T15:00:00Z",
    timezone: "Asia/Seoul",
  },
  cancellationApplied: true,
  includedMemberIds: [],
  excludedByPermission: 0,
  excludedManual: { count: 0, net: 0 },
  excludedTransfer: { count: 0, net: 0 },
};
const analytics = {
  meta,
  totalNet: 210_000,
  totalApproved: 210_000,
  totalCancelled: 0,
  transactionCount: 12,
  previousNet: 180_000,
  deltaNet: 30_000,
  deltaRate: 0.17,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/dashboard",
}));
vi.mock("@/lib/household-context", () => ({
  useHousehold: () => ({ householdId: HOUSEHOLD }),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: vi.fn() }),
}));
vi.mock("@/lib/review-requests", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReviewRequests: () => ok({ items: [] }),
}));
vi.mock("@/lib/manual-finance-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useManualHousingPlans: () => ({
    data: undefined,
    isSuccess: false,
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/components/widgets", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTodoCounts: () => ({
    declines: [],
    declinesLoading: false,
    declinesError: false,
    reviews: [],
    reviewsLoading: false,
    reviewsError: false,
    reviewsTruncated: false,
    sms: [],
    smsLoading: false,
    smsError: false,
    smsTruncated: false,
    unpostedNeedsReview: [],
    unpostedLoading: false,
    unpostedError: false,
    unpostedTruncated: false,
    processing: [],
    processingLoading: false,
    processingError: false,
    processingTruncated: false,
  }),
}));
// 이 화면에서 useQuery를 직접 부르는 곳은 정기 결제 예정 하나다.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQuery: (options: { enabled?: boolean }) => {
    calls.queries.push(options);
    return ok({
      enabled: true,
      until: "2026-11-12T14:59:59.999Z",
      items: [
        {
          id: "r1",
          merchant: "넷플릭스",
          amount: 17_000,
          currency: "KRW",
          amountForecastable: true,
          nextExpectedAt: "2026-11-06T00:00:00Z",
          nextExpectedPhase: "upcoming",
          overdueDays: 0,
        },
      ],
      totalAmount: 17_000,
      totalCurrency: "KRW",
      forecastableCount: 1,
      excludedCount: 0,
      otherCurrencyCount: 0,
    });
  },
}));
vi.mock("@/lib/queries", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAnalyticsMonths: () =>
    ok({
      items: [{ month: "2026-09" }, { month: "2026-10" }, { month: "2026-11" }],
    }),
  useMonthly: (month: unknown) => {
    calls.monthly.push(month);
    return ok(analytics);
  },
  useMonthlyRange: (range: unknown) => {
    calls.ranges.push(range);
    return ok(analytics);
  },
  useCategoriesRange: (range: unknown) => {
    calls.categoryRanges.push(range);
    return ok({
      meta,
      items: [
        {
          categoryId: "food",
          categorySlug: null,
          categoryName: "식비",
          net: 80_000,
          ratio: 0,
          count: 1,
        },
      ],
    });
  },
  useBudgets: (month: unknown) => {
    calls.budgets.push(month);
    return ok({
      items: [
        {
          id: "b1",
          householdId: HOUSEHOLD,
          name: "생활비 예산",
          scopeType: "category",
          scopeRefId: null,
          cardIds: [],
          scopeLabel: "생활비 예산",
          effectiveMonth: "2026-11",
          amount: 300_000,
          spent: 120_000,
          threeMonthAverageSpent: 0,
          remaining: 180_000,
          usageRate: 0.4,
          period: "monthly",
          currency: "KRW",
        },
      ],
    });
  },
  useMembers: (month: unknown) => {
    calls.members.push(month);
    return ok({
      meta,
      items: [
        { memberId: "m1", name: "수빈", net: 60_000, ratio: 0, count: 1 },
        { memberId: "m2", name: "배우자", net: 40_000, ratio: 0, count: 1 },
      ],
    });
  },
  useHouseholdMembers: () => ok([]),
  // 11월 7일 결제 카드 — 오늘(11월 5일)부터 7일 안이라 다가오는 지출에 나온다.
  useCardList: () =>
    ok([{ id: "card-1", alias: "생활비", status: "active", billingDay: 7 }]),
  useCards: (...args: unknown[]) => {
    calls.cards.push(args);
    return ok({ items: [{ cardId: "card-1", net: 512_300 }] });
  },
}));

import DashboardPage from "./page";

function render(search: string): string {
  nav.search = search;
  for (const list of Object.values(calls)) list.length = 0;
  return renderToStaticMarkup(<DashboardPage />);
}

describe("홈 달 이동의 범위", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 서울 2026-11-05(목) 낮 — 이번 달은 2026-11.
    vi.setSystemTime(new Date("2026-11-05T03:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("지난 달을 고르면 소비 카드만 그 달을 읽는다", () => {
    const html = render("month=2026-09");
    expect(calls.monthly).toEqual(["2026-09"]);
    expect(html).toContain("2026년 9월");
    // 아래 섹션은 고른 달이 아니라 이번 달이다.
    expect(calls.budgets).toEqual(["2026-11"]);
    expect(calls.members).toEqual(["2026-11"]);
    expect(html).toContain('href="/budgets?month=2026-11"');
    expect(html).not.toContain("/budgets?month=2026-09");
  });

  it("지난 달을 골라도 다가오는 지출·지난주를 숨기지 않는다", () => {
    const html = render("month=2026-09");
    expect(calls.queries.map((options) => options.enabled)).toEqual([true]);
    // 결제일 줄의 '지난달 사용'은 오늘 기준 지난달(10월)이다.
    expect(calls.cards).toEqual([["2026-10", { enabled: true }]]);
    expect(calls.ranges.some((range) => range !== null)).toBe(true);
    expect(calls.categoryRanges.every((range) => range !== null)).toBe(true);
    expect(html).toContain("누가 썼나");
    expect(html).toContain("다가오는 지출");
    expect(html).toContain("넷플릭스");
    expect(html).toContain("생활비 결제일");
    expect(html).toContain('aria-label="지난주"');
  });

  it("이번 달 화면도 같은 섹션을 같은 기준으로 그린다", () => {
    const current = render("");
    expect(calls.monthly).toEqual(["2026-11"]);
    expect(calls.budgets).toEqual(["2026-11"]);
    expect(calls.members).toEqual(["2026-11"]);
    const past = render("month=2026-09");
    for (const section of [
      'aria-label="가족별 사용"',
      'aria-label="예산"',
      'aria-label="다가오는 지출"',
      'aria-label="지난주"',
    ]) {
      expect(current).toContain(section);
      expect(past).toContain(section);
    }
    // 섹션 부분은 달 선택과 상관없이 같다 — 첫 섹션부터 끝까지 비교한다.
    const sections = (html: string) =>
      html.slice(html.indexOf('aria-label="가족별 사용"'));
    expect(sections(past)).toBe(sections(current));
  });
});
