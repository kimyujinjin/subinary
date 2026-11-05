/**
 * 가져온 대출 기록 화면(2026-11-05 HIG 검수 4단계).
 * 본문을 감싸던 접힘이 없고, 줄을 눌러 수정(›), 기준일 안내는 목록 아래 한 번, 이름은 '가져온 대출 기록' 하나.
 */
import type { ImportedLoanRecord } from "@family/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const base: ImportedLoanRecord = {
  id: "8f3c2b8e-7a51-4f0e-9a51-0c9e2f1b7d10",
  householdId: "4d1f3c22-1e6b-4b5f-8a3e-2a9b6c7d8e90",
  ownerUserId: "me",
  version: 1,
  label: "합성 전세 대출",
  visibility: "household",
  totalMode: "distinct",
  replacesManualAssetId: null,
  manualExpectedVersion: null,
  accountLast4: "0000",
  loanType: "jeonse",
  outstandingPrincipalKrw: "100000000",
  maturityDate: "2030-03-02",
  capturedAt: "2026-11-01T05:31:00Z",
  bankAsOfDate: null,
  source: "shinhan_browser",
  canEdit: true,
  includedInTotals: true,
  exclusionReason: null,
  createdAt: "2026-11-01T05:31:00Z",
  updatedAt: "2026-11-01T05:31:00Z",
};
const items: ImportedLoanRecord[] = [
  base,
  {
    ...base,
    id: "c6a5d4e3-2b1a-4f9e-8d7c-6b5a4e3d2c1b",
    label: "합성 중도금 대출",
    loanType: "interim",
    canEdit: false,
    includedInTotals: false,
    exclusionReason: "duplicate_visible_loan",
  },
  {
    ...base,
    id: "5e4d3c2b-1a0f-4e9d-8c7b-6a5f4e3d2c1b",
    label: "합성 보관 대출",
    totalMode: "reference",
    includedInTotals: false,
    exclusionReason: "reference",
  },
];

/** 정적 마크업의 <button>…</button> 덩어리들(줄 버튼 안에 무엇이 들어가는지 본다). */
function buttons(markup: string): string[] {
  return markup.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/assets/loan-records",
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: vi.fn(), user: { id: "me" } }),
}));
vi.mock("@/lib/manual-finance-client", () => ({
  manualFinanceApi: {},
  useManualFinanceRefresh: () => vi.fn(),
}));
vi.mock("@/lib/loan-import-client", () => ({
  loanImportApi: {},
  useOwnedLoanImports: () => ({
    data: { items },
    error: null,
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

const { LoanImportScreen } = await import("./import-screen");

describe("가져온 대출 기록", () => {
  const html = renderToStaticMarkup(
    <LoanImportScreen
      recordsOnly
      householdId={base.householdId}
      userId="me"
      canCreate
    />
  );

  it("제목은 '가져온 대출 기록', 본문을 접어 두지 않는다", () => {
    expect(html).toContain(">가져온 대출 기록</h1>");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("이전에 저장한 대출");
    expect(html).not.toContain(">가져온 기록<");
  });

  it("고칠 수 있는 줄만 눌러 수정한다(›) — 줄마다 '기록 수정' 버튼을 달지 않는다", () => {
    const rows = buttons(html);
    expect(rows.some((row) => row.includes("합성 전세 대출"))).toBe(true);
    expect(rows.some((row) => row.includes("합성 보관 대출"))).toBe(true);
    expect(rows.some((row) => row.includes("합성 중도금 대출"))).toBe(false);
    expect(html.match(/lucide-chevron-right/g)?.length).toBe(2);
    expect(html).not.toContain(">기록 수정</button>");
  });

  it("줄 버튼에 aria-label을 덮지 않아 남은 원금과 칩까지 읽힌다", () => {
    expect(html).not.toContain("기록 수정\"");
    const row = buttons(html).find((item) => item.includes("합성 보관 대출"));
    expect(row).toBeDefined();
    expect(row).not.toContain("aria-label");
    expect(row).toContain("100,000,000원");
    expect(row).toContain("합계 제외 · 기록만 보관");
  });

  it("'합계 제외' 칩은 자산 탭과 같은 말·색 — 고른 '기록만 보관'은 회색, 확인할 일은 주의 색", () => {
    expect(html).toMatch(/class="[^"]*bg-muted text-muted-foreground[^"]*">합계 제외 · 기록만 보관</);
    expect(html).toMatch(/class="[^"]*text-warning-strong[^"]*">합계 제외 · 중복 확인 필요</);
    expect(html).not.toContain("참고용");
  });

  it("기준일 안내는 한 번", () => {
    expect(html.match(/잔액 기준일/g)?.length).toBe(1);
    expect(html).toContain("만기 2030년 3월 2일");
    expect(html).not.toContain("2030-03-02");
  });
});
