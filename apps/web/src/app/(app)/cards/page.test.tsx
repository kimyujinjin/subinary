import type {
  CardBreakdown,
  CardSummary,
  HouseholdRole,
  MemberSummary,
} from "@family/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CardsPage from "./page";

const state = vi.hoisted(() => ({
  role: "member" as HouseholdRole,
  cards: [] as CardSummary[],
  members: [] as MemberSummary[],
  spend: null as CardBreakdown | null,
  cardsError: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }),
  usePathname: () => "/cards",
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: vi.fn(), user: { id: "u-me" } }),
}));
vi.mock("@/lib/household-context", () => ({
  useHousehold: () => ({
    householdId: "h-1",
    activeMembership: {
      householdId: "h-1",
      name: "우리집",
      role: state.role,
      status: "active",
    },
    memberships: [],
    setHouseholdId: vi.fn(),
  }),
}));
vi.mock("@/lib/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries")>()),
  useCardList: () => ({
    data: state.cardsError ? undefined : state.cards,
    isLoading: false,
    isError: state.cardsError,
    error: state.cardsError ? new Error("network") : null,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useHouseholdMembers: () => ({
    data: state.members,
    isLoading: false,
    isError: false,
  }),
  useCards: () => ({ data: state.spend ?? undefined }),
  useCardLast4Correction: () => ({
    isPending: false,
    cardPending: () => false,
    requiresRead: () => false,
    mutateAsync: vi.fn(),
    refresh: vi.fn(),
  }),
}));

function member(changes: Partial<MemberSummary>): MemberSummary {
  return {
    memberId: "m-me",
    userId: "u-me",
    name: "수빈",
    email: "me@example.com",
    role: "member",
    status: "active",
    color: null,
    joinedAt: "2026-01-01T00:00:00.000Z",
    ...changes,
  };
}

function card(changes: Partial<CardSummary>): CardSummary {
  return {
    id: "c-1",
    householdId: "h-1",
    ownerMemberId: "m-me",
    issuer: "신한",
    alias: "생활비카드",
    maskedNumber: "1234",
    visibility: "household",
    isShared: false,
    status: "active",
    billingDay: 15,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...changes,
  };
}

function render(): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <CardsPage />
    </QueryClientProvider>
  );
}

/** 카드 행 하나(링크 + 그 뒤 메뉴 자리)의 마크업. */
function rowOf(html: string, cardId: string): string {
  const start = html.indexOf(`href="/transactions?cardId=${cardId}"`);
  expect(start).toBeGreaterThan(-1);
  const next = html.indexOf('href="/transactions?cardId=', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

beforeEach(() => {
  state.role = "member";
  state.cardsError = false;
  state.members = [
    member({}),
    member({
      memberId: "m-left",
      userId: "u-left",
      name: "민수",
      status: "removed",
    }),
    member({ memberId: "m-other", userId: "u-other", name: "지은" }),
  ];
  state.cards = [
    card({}),
    card({
      id: "c-2",
      alias: "공용카드",
      isShared: true,
      status: "inactive",
      billingDay: null,
      issuer: "KB국민",
      maskedNumber: null,
      ownerMemberId: "m-left",
    }),
    card({
      id: "c-3",
      alias: "지은카드",
      ownerMemberId: "m-other",
      visibility: "private",
      billingDay: null,
    }),
  ];
  state.spend = {
    meta: {
      period: { from: "", to: "", timezone: "Asia/Seoul" },
      cancellationApplied: true,
      includedMemberIds: [],
      excludedByPermission: 0,
      excludedManual: { count: 0, net: 0 },
      excludedTransfer: { count: 0, net: 0 },
    },
    items: [
      {
        cardId: "c-1",
        alias: "생활비카드",
        issuer: "신한",
        net: 120000,
        ratio: 1,
        count: 3,
      },
    ],
  };
});

describe("결제 카드 행", () => {
  it("shows owner · issuer · last four on one line, this month's spend and the billing day", () => {
    const html = render();
    const row = rowOf(html, "c-1");
    expect(row).toContain("수빈 · 신한 •••• 1234");
    expect(row).toContain("120,000원");
    expect(row).toContain("매월 15일 결제");
    expect(html).toContain("이번 달 사용");
    expect(html).not.toContain("사용 내역 ›");
  });

  it("shows inactive/shared as chips and keeps a departed owner's name", () => {
    const row = rowOf(render(), "c-2");
    expect(row).toContain("민수 · KB국민 · 뒤 4자리 미등록");
    expect(row).toMatch(/>비활성<\/span>/);
    expect(row).toMatch(/>공용<\/span>/);
    expect(row).toContain("0원");
    expect(row).not.toContain("결제</span>");
  });

  it("never writes 0원 for someone else's 나만 보기 card", () => {
    const row = rowOf(render(), "c-3");
    expect(row).toMatch(/>나만 보기<\/span>/);
    expect(row).not.toContain("원</span>");
  });

  it("gives the ⋯ menu only to cards I may manage and keeps deactivate inside it", () => {
    const html = render();
    expect(html).toContain(
      'aria-label="생활비카드 수빈 · 신한 •••• 1234 관리 메뉴"'
    );
    expect(html).not.toContain(
      "공용카드 민수 · KB국민 · 뒤 4자리 미등록 관리 메뉴"
    );
    expect(html).not.toContain(">비활성화</");
  });

  it("lets an admin manage every card", () => {
    state.role = "admin";
    const html = render();
    expect(html).toContain(
      'aria-label="공용카드 민수 · KB국민 · 뒤 4자리 미등록 관리 메뉴"'
    );
    expect(html).toContain(
      'aria-label="지은카드 지은 · 신한 •••• 1234 관리 메뉴"'
    );
  });

  it("drops the stray title padding wrapper", () => {
    expect(render()).not.toContain("pl-2.5");
  });
});

describe("결제 카드 화면 — HIG 검수 3·4단계", () => {
  it("카드 줄은 그 카드의 사용 내역으로 가므로 폰에서도 ›를 보인다", () => {
    const row = rowOf(render(), "c-1");
    expect(row).toContain("lucide-chevron-right");
  });

  it("목록을 못 불러오면 원인과 '다시 불러오기'를 보인다(빨간 한 줄만 두지 않는다)", () => {
    state.cardsError = true;
    const html = render();
    expect(html).toContain("카드를 불러오지 못했어요.");
    expect(html).toContain("다시 불러오기");
  });

  it("주 버튼은 동사형이다", () => {
    const html = render();
    expect(html).toContain("카드 등록하기");
    expect(html).not.toMatch(/> 카드 등록<\/button>/);
  });
});
