import type {
  AnalyticsMonths,
  BudgetListResponse,
  BudgetSummary,
} from "@family/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { currentMonth } from "@/lib/format";
import { queryKeys } from "@/lib/queries";

const HOUSEHOLD = "00000000-0000-4000-8000-000000000001";

// 보고 있는 달은 URL(`?month=`)이 정한다 — 시험마다 바꿀 수 있게 둔다.
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/budgets",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: vi.fn() }),
}));
vi.mock("@/lib/household-context", () => ({
  useHousehold: () => ({
    householdId: HOUSEHOLD,
    activeMembership: { role: "owner" },
  }),
}));
// 가계부 머리는 할 일 건수를 따로 불러온다 — 이 화면의 시험과 상관없다.
vi.mock("@/components/ledger-header", () => ({ LedgerHeader: () => null }));

import BudgetsPage from "./page";

const MONTH = currentMonth();

const base: BudgetSummary = {
  id: "b-1",
  householdId: HOUSEHOLD,
  name: null,
  scopeType: "category",
  scopeRefId: "00000000-0000-4000-8000-0000000000c1",
  cardIds: [],
  scopeLabel: "식비",
  effectiveMonth: MONTH,
  amount: 500_000,
  spent: 512_000,
  threeMonthAverageSpent: 480_000,
  remaining: -12_000,
  usageRate: 1.024,
  period: "monthly",
  currency: "KRW",
};

const budgets: BudgetSummary[] = [
  base,
  {
    ...base,
    id: "b-2",
    scopeType: "household",
    scopeRefId: null,
    scopeLabel: "가족 전체",
    spent: 410_000,
    remaining: 90_000,
    usageRate: 0.82,
  },
];

function client(): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData<BudgetListResponse>(queryKeys.budgets(HOUSEHOLD, MONTH), {
    items: budgets,
    month: MONTH,
  });
  qc.setQueryData<AnalyticsMonths>(queryKeys.analytics("months", HOUSEHOLD), {
    timezone: "Asia/Seoul",
    items: [{ month: MONTH, net: 922_000, count: 12 }],
  });
  qc.setQueryData(queryKeys.householdMembers(HOUSEHOLD), []);
  qc.setQueryData(queryKeys.categories(HOUSEHOLD), []);
  qc.setQueryData(queryKeys.cards(HOUSEHOLD), []);
  return qc;
}

function render(qc: QueryClient = client()): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <BudgetsPage />
    </QueryClientProvider>
  );
}

describe("예산 화면", () => {
  it("달 이동은 가계부 공용 MonthNav(눌러서 고르기 + 44px ‹ ›)다", () => {
    const html = render();
    expect(html).toMatch(/aria-label="기간: \d{4}년 \d{1,2}월"/);
    expect(html).toContain('aria-label="이전 달"');
    expect(html).toContain('aria-label="다음 달"');
  });

  it("초과·80%를 색만이 아니라 글자로도 말하고, 넘은 금액은 한 번만 말한다", () => {
    const html = render();
    expect(html).toContain("12,000원 초과");
    expect(html).not.toContain("넘었어요");
    expect(html).toContain("82.0% 사용");
    expect(html).toContain("90,000원 남았어요");
  });

  it("막대 전체가 '어디서 썼는지 보기' 링크이고, 수정·삭제는 공용 ⋯ 메뉴에 있다", () => {
    const html = render();
    expect(html).toContain(
      `href="/transactions?month=${MONTH}&amp;categoryId=${base.scopeRefId}"`
    );
    expect(html).toContain('<span class="sr-only">어디서 썼는지 보기</span>');
    expect(html).not.toContain("어디서 썼는지 보기 ›");
    expect(html).toContain('aria-label="식비 예산 관리 메뉴"');
    expect(html).toContain('aria-label="가족 전체 예산 관리 메뉴"');
  });

  it("지난 달에 예산이 없으면 내부 용어 없이 그 사실만 말한다", () => {
    const [y, m] = MONTH.split("-").map(Number);
    const past = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    const qc = client();
    qc.setQueryData<BudgetListResponse>(queryKeys.budgets(HOUSEHOLD, past), {
      items: [],
      month: past,
    });
    nav.search = `month=${past}`;
    try {
      const html = render(qc);
      expect(html).toContain("예산 기록이 없어요");
      expect(html).toContain("그 달에는 만든 예산이 없어요");
      expect(html).not.toContain("원장");
      // 지난 달에는 만들기 버튼을 두지 않는다 — 지금 만들 수 있는 건 이번 달 예산이다.
      expect(html).not.toContain(">예산 만들기<");
    } finally {
      nav.search = "";
    }
  });

  it("불러오지 못하면 원인 한 줄과 '다시 불러오기'를 보여 준다", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } },
    });
    await qc.prefetchQuery({
      queryKey: queryKeys.budgets(HOUSEHOLD, MONTH),
      queryFn: () => Promise.reject(new Error("offline")),
    });
    const html = render(qc);
    expect(html).toMatch(/<p role="alert"[^>]*>예산을 불러오지 못했어요<\/p>/);
    expect(html).toMatch(/<button[^>]*>다시 불러오기<\/button>/);
  });
});
