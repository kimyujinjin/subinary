import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MacBankJob, MacBankRunnerState } from "@family/contracts";
import { APPROVE_LABEL, BankConsentDetails, BankMacJob, BankStartPanel, bankMenuActions, firstConnectionSteps } from "./bank-start-panel";

const search = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search.value) }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ authedFetch: vi.fn() }) }));
afterEach(() => { search.value = ""; });
const fixture: MacBankJob = {
  id: "00000000-0000-4000-8000-000000000001", householdId: "00000000-0000-4000-8000-000000000002",
  ownerUserId: "00000000-0000-4000-8000-000000000003", runnerId: "00000000-0000-4000-8000-000000000004",
  state: "queued", claimId: null, credentialVersion: null, consentVersion: 1, continueVersion: 0, errorCode: null, logoutConfirmed: false, observations: [],
  createdAt: "2026-11-03T00:00:00Z", updatedAt: "2026-11-03T00:00:00Z", expiresAt: "2026-11-03T00:10:00Z", claimedAt: null, completedAt: null,
};
describe("모아 버튼에서 Mac 자동 실행 상태 표시", () => {
  it("최초 연결 화면은 동사로 시작하는 허용 버튼과 유지 기간·철회 방법을 표시한다", () => {
    search.value = "macPair=00000000-0000-4000-8000-000000000004&macCode=" + "a".repeat(32);
    const html = renderToStaticMarkup(<BankStartPanel householdId={fixture.householdId} userId={fixture.ownerUserId} />);
    // '연결 해제 전까지 허용'은 '해제'가 먼저 읽혔다 — 버튼은 동사, 기한은 버튼 아래 한 줄.
    expect(html).toMatch(/<button[^>]*>이 Mac 허용하기<\/button>/);
    expect(html.indexOf("이 Mac 허용하기")).toBeLessThan(html.indexOf("연결을 해제할 때까지 유지돼요"));
    expect(html).toContain("모아에서 언제든 연결을 해제");
    expect(html).not.toContain("연결 해제 전까지 허용");
    expect(html).not.toContain("7일 동안"); expect(html).not.toContain('type="password"');
  });
  it("연결 상태를 받기 전에는 자리만 잡고, 꺼진 조회 버튼·복사·초안 링크를 보이지 않는다", () => {
    const html = renderToStaticMarkup(<BankStartPanel householdId={fixture.householdId} userId={fixture.ownerUserId} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("지금 조회하기");
    expect(html).not.toContain("codex://"); expect(html).not.toContain("요청문 복사"); expect(html).not.toContain("textarea");
  });
  it("조회 버튼 아래 동의 내용은 별도 동의와 이체 불가를 말한다", () => {
    const html = renderToStaticMarkup(<BankConsentDetails />);
    expect(html).toContain("조회하면 동의하는 내용"); expect(html).toContain("별도"); expect(html).toContain("이체");
  });
  it("대기·실행·인증 요청은 저장 완료로 보이지 않는다", () => {
    for (const state of ["queued", "claimed", "running", "authentication_required", "reading", "logging_out"] as const) {
      const html = renderToStaticMarkup(<BankMacJob job={{ ...fixture, state }} />);
      expect(html).not.toContain("모아에 저장 완료"); expect(html).not.toContain("원</p>");
    }
  });
  it("추가 인증은 정상 은행 화면에서 진행하고 완료 후 이어갈 수 있음을 설명한다", () => {
    const html = renderToStaticMarkup(<BankMacJob job={{ ...fixture, state: "authentication_required" }} />);
    expect(html).toContain("은행이 추가 인증"); expect(html).toContain("‘계속 조회하기’를 눌러");
  });
  it("결과 불명은 재로그인하거나 새 금액으로 표시하지 않는다", () => {
    const html = renderToStaticMarkup(<BankMacJob job={{ ...fixture, state: "failed", errorCode: "operation_unknown" }} />);
    expect(html).toContain("다시 로그인하지 않아요"); expect(html).toContain("로그아웃 상태"); expect(html).not.toContain("모아에 저장 완료");
  });
  it("실패 이유는 회색 안내 줄이 아니라 오류 알림(role=alert)이고, 성공 안내는 오류로 읽히지 않는다", () => {
    const failed = renderToStaticMarkup(<BankMacJob job={{ ...fixture, state: "failed", errorCode: "timeout" }} />);
    expect(failed).toMatch(/<div[^>]*role="alert"[^>]*>[\s\S]*제때 응답하지 않아/);
    const succeeded = renderToStaticMarkup(<BankMacJob job={{ ...fixture, state: "succeeded", logoutConfirmed: true }} />);
    expect(succeeded).not.toContain('role="alert"');
  });
  it("로그인 실패·시간 초과·화면 변경을 서로 다른 문구로 알린다", () => {
    const text = (errorCode: MacBankJob["errorCode"]) => renderToStaticMarkup(<BankMacJob job={{ ...fixture, state: "failed", errorCode }} />);
    expect(text("credentials_invalid")).toContain("다시 시도하지 않았어요"); expect(text("timeout")).toContain("제때 응답하지 않아");
    expect(text("unsupported_layout")).toContain("화면 구성이 달라져");
    expect(new Set([text("credentials_invalid"), text("timeout"), text("unsupported_layout")]).size).toBe(3);
  });
  it("정상 저장한 0원 장부 잔액을 누락하지 않는다", () => {
    const job: MacBankJob = { ...fixture, state: "succeeded", logoutConfirmed: true, observations: [{ formatVersion: 1, provider: "shinhan", source: "browser_assisted", origin: "https://bank.shinhan.com", pageKind: "deposit_account_list", capturedAt: fixture.createdAt, accountFingerprint: "a".repeat(64), accountLast4: "1234", currency: "KRW", balanceKind: "ledger", balanceKrw: "0", bankAsOfDate: null }] };
    const html = renderToStaticMarkup(<BankMacJob job={job} />);
    expect(html).toContain("모아에 저장 완료"); expect(html).toContain("0원"); expect(html).toContain("끝 1234"); expect(html).toContain("자산 합계에 반영돼요"); expect(html).not.toContain("a".repeat(64));
  });
});

describe("처음 연결 3단계 안내", () => {
  const none: MacBankRunnerState = { runner: null, job: null, previousResult: null, credentials: null, credentialStorageAvailable: true };
  const runner = { id: fixture.runnerId, label: "이 Mac", online: true, lastSeenAt: fixture.createdAt, expiresAt: null };
  const stored = { stored: true, runnerId: fixture.runnerId, version: 1, updatedAt: fixture.createdAt };
  const current = (state: MacBankRunnerState) => firstConnectionSteps(state)?.findIndex((step) => !step.done);
  it("Mac이 없으면 막다른 안내 대신 1) Mac 연결 2) 로그인 정보 3) 첫 조회를 보여 준다", () => {
    expect(firstConnectionSteps(none)?.map((step) => step.label)).toEqual(["Mac 연결", "로그인 정보", "첫 조회"]);
    expect(current(none)).toBe(0);
  });
  it("서버 상태만으로 다음 단계로 넘어간다", () => {
    expect(current({ ...none, runner })).toBe(1);
    expect(current({ ...none, runner, credentials: stored })).toBe(2);
    expect(current({ ...none, runner, credentials: stored, job: { ...fixture, state: "running" } })).toBe(2);
  });
  it("한 번이라도 조회에 성공했으면 안내를 그리지 않는다", () => {
    expect(firstConnectionSteps({ ...none, runner, credentials: stored, job: { ...fixture, state: "succeeded" } })).toBeNull();
  });
  it("Mac 연결을 해제했으면 이전 조회가 있어도 다시 1단계부터 안내한다", () => {
    const previousResult = { jobId: fixture.id, completedAt: fixture.createdAt, observations: [{ formatVersion: 1 as const, provider: "shinhan" as const, source: "browser_assisted" as const, origin: "https://bank.shinhan.com" as const, pageKind: "deposit_account_list" as const, capturedAt: fixture.createdAt, accountFingerprint: "a".repeat(64), accountLast4: "1234", currency: "KRW" as const, balanceKind: "ledger" as const, balanceKrw: "0", bankAsOfDate: null }] };
    expect(current({ ...none, previousResult })).toBe(0);
  });
  it("단계 설명은 한 문장이고 내부 용어를 쓰지 않는다", () => {
    for (const step of firstConnectionSteps(none) ?? []) {
      expect(step.detail.split(/(?<=[.?!])\s+/)).toHaveLength(1);
      expect(step.detail).not.toMatch(/실행기|Codex|토큰|HMAC|secret|운영자/);
      for (const line of step.howTo ?? []) expect(line).not.toMatch(/실행기|Codex|토큰|HMAC|secret|운영자/);
    }
  });
  it("이 화면에 누를 것이 없는 Mac 연결 단계는 할 일을 번호 순서로 알리고, 승인 버튼 이름을 그대로 부른다", () => {
    const [mac, credentials, firstRun] = firstConnectionSteps(none) ?? [];
    expect(mac.howTo).toHaveLength(3);
    expect(mac.howTo?.[2]).toContain(`‘${APPROVE_LABEL}’`);
    // 2·3단계는 Mac이 아니라 모아에 로그인한 브라우저에서 하는 일이라 'Mac에서'로 묶지 않는다.
    expect(mac.detail).toBe("아래 순서로 이 Mac을 허용해 주세요.");
    expect(credentials.howTo).toBeUndefined(); expect(firstRun.howTo).toBeUndefined();
  });
});

describe("신한 연결 ⋯ 메뉴", () => {
  const open = { credentials: vi.fn(), forget: vi.fn(), revoke: vi.fn() };
  const idle = { stored: true, active: false, busy: false, storageAvailable: true };
  it("저장한 로그인 정보 삭제는 시트가 아니라 ⋯ 메뉴의 위험 행동이다(시트 위에 확인 창을 겹치지 않는다)", () => {
    const actions = bankMenuActions(idle, open);
    expect(actions.map((action) => action.label)).toEqual(["로그인 정보 변경", "로그인 정보 삭제", "Mac 연결 해제"]);
    expect(actions[1]).toMatchObject({ destructive: true, disabled: false });
    actions[1].onSelect(); expect(open.forget).toHaveBeenCalledOnce();
  });
  it("저장한 정보가 없으면 삭제를 두지 않고, 조회 중이거나 암호화 저장을 못 쓰면 막는다", () => {
    expect(bankMenuActions({ ...idle, stored: false }, open).map((action) => action.label)).toEqual(["로그인 정보 입력", "Mac 연결 해제"]);
    expect(bankMenuActions({ ...idle, active: true }, open)[1].disabled).toBe(true);
    expect(bankMenuActions({ ...idle, storageAvailable: false }, open)[1].disabled).toBe(true);
  });
});
