import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MacBankJob } from "@family/contracts";
import { BankMacJob, BankStartPanel } from "./bank-start-panel";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ authedFetch: vi.fn() }) }));
const fixture: MacBankJob = {
  id: "00000000-0000-4000-8000-000000000001", householdId: "00000000-0000-4000-8000-000000000002",
  ownerUserId: "00000000-0000-4000-8000-000000000003", runnerId: "00000000-0000-4000-8000-000000000004",
  state: "queued", claimId: null, continueVersion: 0, errorCode: null, logoutConfirmed: false, observations: [],
  createdAt: "2026-11-03T00:00:00Z", updatedAt: "2026-11-03T00:00:00Z", expiresAt: "2026-11-03T00:10:00Z", claimedAt: null, completedAt: null,
};
describe("모아 버튼에서 Mac 자동 실행 상태 표시", () => {
  it("연결 상태를 받기 전에는 조회 버튼을 비활성화하고 복사·초안 링크를 제공하지 않는다", () => {
    const html = renderToStaticMarkup(<BankStartPanel householdId={fixture.householdId} userId={fixture.ownerUserId} />);
    expect(html).toContain("신한은행 조회 시작"); expect(html).toMatch(/<button[^>]*disabled[^>]*>신한은행 조회 시작/);
    expect(html).not.toContain("codex://"); expect(html).not.toContain("요청문 복사"); expect(html).not.toContain("textarea");
    expect(html).toContain("로그인 정보 저장·이체·상환·정기 조회는 허용하지 않아요");
  });
  it("대기·실행·인증 요청은 저장 완료로 보이지 않는다", () => {
    for (const state of ["queued", "claimed", "running", "authentication_required", "reading", "logging_out"] as const) {
      const html = renderToStaticMarkup(<BankMacJob job={{ ...fixture, state }} />);
      expect(html).not.toContain("모아에 저장 완료"); expect(html).not.toContain("원</p>");
    }
  });
  it("추가 인증은 정상 은행 화면에서 진행하고 완료 후 이어갈 수 있음을 설명한다", () => {
    const html = renderToStaticMarkup(<BankMacJob job={{ ...fixture, state: "authentication_required" }} />);
    expect(html).toContain("정상 로그인·추가 인증"); expect(html).toContain("인증 완료, 계속 조회");
  });
  it("결과 불명은 재로그인하거나 새 금액으로 표시하지 않는다", () => {
    const html = renderToStaticMarkup(<BankMacJob job={{ ...fixture, state: "failed", errorCode: "operation_unknown" }} />);
    expect(html).toContain("다시 로그인하지 않아요"); expect(html).toContain("로그아웃 상태"); expect(html).not.toContain("모아에 저장 완료");
  });
  it("정상 저장한 0원 장부 잔액을 누락하지 않는다", () => {
    const job: MacBankJob = { ...fixture, state: "succeeded", logoutConfirmed: true, observations: [{ formatVersion: 1, provider: "shinhan", source: "browser_assisted", origin: "https://bank.shinhan.com", pageKind: "deposit_account_list", capturedAt: fixture.createdAt, accountFingerprint: "a".repeat(64), accountLast4: "1234", currency: "KRW", balanceKind: "ledger", balanceKrw: "0", bankAsOfDate: null }] };
    const html = renderToStaticMarkup(<BankMacJob job={job} />);
    expect(html).toContain("모아에 저장 완료"); expect(html).toContain("0원"); expect(html).toContain("끝 1234"); expect(html).toContain("가족 자산 합계에는 자동으로 더하지 않아요"); expect(html).not.toContain("a".repeat(64));
  });
});
