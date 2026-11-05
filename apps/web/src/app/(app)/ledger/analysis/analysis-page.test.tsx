/**
 * 가계부 분석 탭(2026-11-05 HIG 검수 3·4단계).
 * - 달 이동은 거래 탭과 같은 MonthNav(`2026년 11월 ▾` + 44px ‹ ›), 고를 수 있는 달은 거래가 있는 달.
 * - 첫 화면의 큰 금액은 '이번 달 소비' 하나.
 * - 고른 달과 상관없던 '최근 거래'와 브라우저 기본 접기(details)를 없애고, 그 달 거래로 가는 줄 하나를 둔다.
 * - '이 달의 특징 보기'는 텍스트 버튼, 카드 오류는 '다시 불러오기', 로딩은 글자 대신 스켈레톤.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOUSEHOLD = "00000000-0000-4000-8000-000000000001";

const nav = vi.hoisted(() => ({ search: "" }));
const hooks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  transactionArgs: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/ledger/analysis",
}));
vi.mock("@/lib/household-context", () => ({
  useHousehold: () => ({
    householdId: HOUSEHOLD,
    activeMembership: { role: "owner", name: "우리집" },
  }),
}));
vi.mock("@/lib/queries", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const hook = (name: string) => (arg?: unknown) => {
    if (name === "useTransactions") hooks.transactionArgs.push(arg);
    return hooks.state[name];
  };
  return {
    ...actual,
    useAnalyticsMonths: hook("useAnalyticsMonths"),
    useBudgets: hook("useBudgets"),
    useCardList: hook("useCardList"),
    useCards: hook("useCards"),
    useCategories: hook("useCategories"),
    useDevices: hook("useDevices"),
    useHouseholdMembers: hook("useHouseholdMembers"),
    useHouseholdSummary: hook("useHouseholdSummary"),
    useMembers: hook("useMembers"),
    useMerchants: hook("useMerchants"),
    useMonthly: hook("useMonthly"),
    useTransactions: hook("useTransactions"),
  };
});
// 화면 머리·다른 카드·입력 폼은 각자 테스트가 있다 — 여기서는 분석 화면의 배치만 본다.
vi.mock("@/components/ledger-header", () => ({ LedgerHeader: () => null }));
vi.mock("../../dashboard/upcoming-card", () => ({
  UpcomingSpendCard: () => null,
}));
vi.mock("@/components/monthly-insights-card", () => ({
  MonthlyInsightsCard: () => null,
}));
vi.mock("../../transactions/add-transaction-dialog", () => ({
  AddTransactionDialog: () => null,
}));

import LedgerAnalysisPage from "./page";

function ok<T>(data: T) {
  return {
    data,
    isLoading: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch: vi.fn(),
  };
}
const loading = () => ({
  data: undefined,
  isLoading: true,
  isError: false,
  isSuccess: false,
  isFetching: true,
  refetch: vi.fn(),
});
const failed = () => ({
  data: undefined,
  isLoading: false,
  isError: true,
  isSuccess: false,
  isFetching: false,
  error: new Error("network"),
  refetch: vi.fn(),
});

function defaults(): Record<string, unknown> {
  return {
    useAnalyticsMonths: ok({
      items: [{ month: "2026-09" }, { month: "2026-10" }],
    }),
    useBudgets: ok({ items: [] }),
    useCardList: ok([{ id: "card-1", ownerMemberId: "m-1", isShared: false }]),
    useCards: ok({
      items: [
        {
          cardId: "card-1",
          alias: "생활비",
          issuer: "현대",
          net: 30_000,
          ratio: 0.9,
          count: 2,
        },
        {
          cardId: null,
          alias: "카드 미연결",
          issuer: null,
          net: 3_000,
          ratio: 0.1,
          count: 1,
        },
      ],
    }),
    useCategories: ok({ items: [] }),
    useDevices: ok([{ id: "d-1" }]),
    useHouseholdMembers: ok([{ memberId: "m-1", name: "수빈", color: null }]),
    useHouseholdSummary: ok({ sharedColor: null }),
    useMembers: ok({
      items: [
        { memberId: "m-1", name: "수빈", net: 33_000, ratio: 1, count: 3 },
      ],
    }),
    useMerchants: ok({ items: [] }),
    useMonthly: ok({
      meta: {
        excludedManual: { count: 2, net: 10_000 },
        excludedTransfer: { count: 0, net: 0 },
      },
      totalNet: 33_000,
      totalApproved: 35_000,
      totalCancelled: 2_000,
      transactionCount: 3,
      previousNet: 50_000,
      deltaNet: -17_000,
      deltaRate: -0.34,
    }),
    useTransactions: ok({ items: [{ id: "t-1" }] }),
  };
}

function render(overrides: Record<string, unknown> = {}): string {
  hooks.state = { ...defaults(), ...overrides };
  hooks.transactionArgs = [];
  return renderToStaticMarkup(<LedgerAnalysisPage />);
}

/** 여는 태그부터 닫는 태그까지, 주어진 글자를 담은 가장 짧은 요소. */
function element(html: string, tag: "a" | "button", text: string): string {
  const pattern = new RegExp(
    `<${tag}\\b(?:(?!<${tag}\\b|</${tag}>).)*?${text}.*?</${tag}>`,
    "s"
  );
  const match = html.match(pattern);
  if (!match) throw new Error(`${tag} '${text}' 없음`);
  return match[0];
}

describe("가계부 분석 탭", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 서울 2026-11-05 낮 — 이번 달은 2026-11.
    vi.setSystemTime(new Date("2026-11-05T03:00:00Z"));
    nav.search = "month=2026-10";
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("달 이동은 거래 탭과 같은 MonthNav다 — 눌러서 고르는 달 이름과 44px ‹ ›", () => {
    const html = render();
    expect(html).toContain('aria-label="기간: 2026년 10월"');
    const prev = element(html, "button", 'aria-label="이전 달"');
    expect(prev).toContain("size-11");
    expect(prev).not.toMatch(/\sdisabled=""/);
    // 예전 MonthSwitcher(작은 '‹ 2026년 10월 ›', 고르기 없음)는 쓰지 않는다.
    expect(html).not.toContain("min-w-26");
  });

  it("첫 화면의 큰 금액은 '이번 달 소비' 하나다", () => {
    nav.search = "";
    const html = render();
    expect(html).toContain("이번 달 소비");
    expect(html.split("text-display").length - 1).toBe(1);
    expect(html).not.toMatch(/text-(2xl|lg)\b/);
  });

  it("고른 달과 상관없는 '최근 거래' 대신 그 달 거래로 가는 줄을 둔다", () => {
    const html = render();
    expect(html).not.toContain("최근 거래");
    expect(html).not.toContain("<details");
    const link = element(html, "a", "이 달 거래 보기");
    expect(link).toContain('href="/transactions?month=2026-10"');
    expect(link).toContain("lucide-chevron-right");
    // 거래는 '하나라도 있는지'만 묻는다(시작하기 체크리스트 판단, 거래 탭과 같은 캐시 키).
    expect(hooks.transactionArgs).toEqual([{ limit: 1 }]);
  });

  it("가맹점·구성원·카드는 접지 않고 펼쳐 둔다", () => {
    const html = render();
    expect(html).not.toContain("세부 분석");
    expect(html).toContain("자주 간 곳은 어디인가요?");
    expect(html).toContain("누가, 어떤 카드로 썼나요?");
  });

  it("구성원·카드 줄은 거래 목록으로 가면 ›가 있고, 갈 곳 없는 미연결 카드는 표시가 없다", () => {
    const html = render();
    const member = element(html, "a", "수빈");
    expect(member).toContain("memberId=m-1");
    expect(member).toContain("lucide-chevron-right");
    const card = element(html, "a", "생활비");
    expect(card).toContain("cardId=card-1");
    expect(card).toContain("lucide-chevron-right");
    expect(() => element(html, "a", "카드 미연결")).toThrow();
    expect(html).toContain("카드 미연결");
  });

  it("'이 달의 특징 보기'는 전체 폭 옅은 버튼이 아니라 텍스트 버튼이다", () => {
    const button = element(render(), "button", "이 달의 특징 보기");
    expect(button).toContain("text-primary");
    expect(button).not.toContain("w-full");
    expect(button).not.toContain("bg-primary/10");
  });

  it("합계 제외 공시는 이름 규칙대로 말하고, 목록으로 가는 글자 링크는 44px이다", () => {
    const html = render();
    expect(html).toContain("합계 제외 거래 2건");
    expect(html).not.toContain("빼놓은");
    expect(html).not.toContain("볼 수 있는 기록만");
    const link = element(html, "a", "합계 제외 거래 보기");
    expect(link).toContain(
      'href="/transactions?month=2026-10&amp;excluded=only"'
    );
    expect(link).toContain("min-h-11");
  });

  it("카드를 못 불러오면 원인과 '다시 불러오기'를 보여 준다", () => {
    const html = render({
      useCategories: failed(),
      useMerchants: failed(),
    });
    expect(html).toContain("카테고리별 지출을 불러오지 못했어요");
    expect(html).toContain("자주 간 곳을 불러오지 못했어요");
    expect(html.split("다시 불러오기").length - 1).toBe(2);
  });

  it("불러오는 동안은 카드마다 글자 대신 스켈레톤 하나다", () => {
    const html = render({
      useMonthly: loading(),
      useCategories: loading(),
      useBudgets: loading(),
      useMerchants: loading(),
      useMembers: loading(),
      useCards: loading(),
    });
    expect(html).not.toContain("불러오고 있어요");
    // 소비·카테고리·예산·가맹점 각 1개 + 구성원·카드를 함께 그리는 카드 1개.
    expect(html.split('aria-busy="true"').length - 1).toBe(5);
  });

  it("거래가 하나도 없고 설정이 남았으면 시작하기를 보여 주고, 버튼은 동사형이다", () => {
    const html = render({
      useDevices: ok([]),
      useTransactions: ok({ items: [] }),
    });
    expect(html).toContain("시작하기");
    expect(html).toContain(">연결하기</a>");
    // 거래가 없으면 달을 옮길 이유가 없다 — 달 머리를 감춘다.
    expect(html).not.toContain('aria-label="기간:');
    expect(html).not.toMatch(/text-\[\d+px\]/);
  });
});
