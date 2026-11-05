/**
 * 주택 납부 일정 화면(2026-11-05 HIG 검수 4단계): 대표 금액 text-display, 'M월 D일', 줄은 ListRow(›),
 * 줄마다 붙던 '가족 공개 · 직접 입력'과 '보기 →'는 없다.
 */
import type { ManualHousingPlanListResponse } from "@family/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const year = new Date().getFullYear();
const planId = "c6a5d4e3-2b1a-4f9e-8d7c-6b5a4e3d2c1b";
const data: ManualHousingPlanListResponse = {
  items: [
    {
      id: planId,
      householdId: "4d1f3c22-1e6b-4b5f-8a3e-2a9b6c7d8e90",
      ownerUserId: "me",
      version: 1,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
      canEdit: true,
      label: "합성 아파트 59",
      visibility: "household",
      occupancyYear: 2028,
      contractStage: "중도금 내는 중",
      fundingNote: null,
    },
  ],
  summary: {
    nextPayment: {
      planId,
      paymentId: "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
      label: "합성 아파트 59",
      kind: "interim",
      installment: 2,
      dueDate: `${year}-11-20`,
      remainingAmountKrw: "30000000",
    },
    hasIncompletePayments: false,
  },
};

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/plan",
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: vi.fn(), user: { id: "me" } }),
}));
vi.mock("@/lib/household-context", () => ({
  useHousehold: () => ({
    householdId: "4d1f3c22-1e6b-4b5f-8a3e-2a9b6c7d8e90",
    activeMembership: { role: "member" },
  }),
}));
vi.mock("@/lib/queries", () => ({ useHouseholdMembers: () => ({ data: [] }) }));
vi.mock("@/lib/manual-finance-client", () => ({
  manualFinanceApi: {},
  useManualFinanceRefresh: () => vi.fn(),
  useManualHousingPlans: () => ({
    data,
    error: null,
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

const { default: PlanPage } = await import("./page");

describe("주택 납부 일정", () => {
  const html = renderToStaticMarkup(<PlanPage />);

  it("대표 금액은 text-display, 날짜는 'M월 D일'", () => {
    expect(html).toMatch(/class="text-display[^"]*"[^>]*>30,000,000원/);
    expect(html).not.toContain("text-3xl");
    expect(html).toContain("11월 20일 납부");
    expect(html).not.toContain(`${year}-11-20`);
  });

  it("줄은 › 하나로 눌림을 알리고, 반복 문구가 없다", () => {
    expect(html).toContain("2028년 입주 · 중도금 내는 중");
    expect(html).toContain("lucide-chevron-right");
    expect(html).not.toContain("보기 →");
    expect(html).not.toContain("가족 공개");
    expect(html).not.toContain("직접 입력");
  });

  it("줄과 '다음 납부' 버튼은 aria-label로 글자를 덮지 않고, 처음부터 꺼져 있지 않다", () => {
    const rows = html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const row = rows.find((item) => item.includes("2028년 입주 · 중도금 내는 중"));
    expect(row).toBeDefined();
    expect(row).toContain("합성 아파트 59");
    expect(row).not.toContain("aria-label");
    const nextButton = rows.find((item) => item.includes("이 주택의 납부 일정 보기"));
    expect(nextButton).toBeDefined();
    expect(nextButton).not.toContain("aria-label");
    expect(nextButton).not.toContain("disabled");
  });

  it("여는 중 문구를 화면 맨 아래에 따로 띄우지 않는다", () => {
    expect(html).not.toContain("납부 일정을 불러오는 중이에요.");
  });
});
