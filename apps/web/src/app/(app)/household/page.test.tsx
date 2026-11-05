import type {
  HouseholdRole,
  InvitationSummary,
  MemberSummary,
} from "@family/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HouseholdPage from "./page";

const state = vi.hoisted(() => ({
  role: "owner" as HouseholdRole,
  members: [] as MemberSummary[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }),
  usePathname: () => "/household",
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    authedFetch: vi.fn(),
    user: { id: "u-me" },
    refreshMemberships: vi.fn(),
  }),
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
  useHouseholdMembers: () => ({
    data: state.members,
    isLoading: false,
    isError: false,
  }),
  useHouseholdSummary: () => ({
    data: {
      id: "h-1",
      name: "우리집",
      createdAt: "2026-01-01T00:00:00.000Z",
      myRole: state.role,
      sharedColor: null,
    },
  }),
}));

function member(changes: Partial<MemberSummary>): MemberSummary {
  return {
    memberId: "m-me",
    userId: "u-me",
    name: "수빈",
    email: "me@example.com",
    role: "owner",
    status: "active",
    color: null,
    joinedAt: "2026-01-01T00:00:00.000Z",
    ...changes,
  };
}

function invitation(changes: Partial<InvitationSummary>): InvitationSummary {
  return {
    id: "inv",
    email: null,
    role: "member",
    status: "pending",
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-11-01T00:00:00.000Z",
    ...changes,
  };
}

function render(invitations: InvitationSummary[] = []): string {
  const client = new QueryClient();
  client.setQueryData(["household-invitations", "h-1"], invitations);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <HouseholdPage />
    </QueryClientProvider>
  );
}

const INVITES = [
  invitation({ id: "a", email: "future@example.com" }),
  // 서버는 아직 pending으로 주지만 만료 시각이 지났다.
  invitation({
    id: "b",
    email: "stale@example.com",
    expiresAt: "2020-01-01T00:00:00.000Z",
  }),
  invitation({ id: "c", email: "joined@example.com", status: "accepted" }),
];

beforeEach(() => {
  state.role = "owner";
  state.members = [
    member({}),
    member({
      memberId: "m-2",
      userId: "u-2",
      name: "민수",
      email: "minsu@example.com",
      role: "member",
    }),
    member({
      memberId: "m-3",
      userId: "u-3",
      name: "지은",
      email: "jieun@example.com",
      role: "member",
      status: "removed",
    }),
  ];
});

describe("가족 화면 — 소유자", () => {
  it("keeps the role select on the shared gray fill (no card-colored override)", () => {
    const html = render(INVITES);
    const trigger = html.match(
      /<button[^>]*aria-label="민수 역할 변경"[^>]*>/
    )?.[0];
    expect(trigger).toBeDefined();
    expect(trigger).toContain("bg-muted");
    expect(trigger).not.toContain("bg-card");
  });

  it("puts leave/remove/revoke only behind ⋯ menus", () => {
    const html = render(INVITES);
    expect(html).toContain('aria-label="민수 메뉴"');
    expect(html).toContain('aria-label="future@example.com 초대 메뉴"');
    for (const label of ["내보내기", "나가기", "초대 취소"]) {
      expect(html).not.toContain(`>${label}</button>`);
    }
  });

  it("opens only usable invites and folds expired/accepted ones under 지난 초대", () => {
    const html = render(INVITES);
    const fold = html.indexOf("지난 초대 2개");
    expect(fold).toBeGreaterThan(-1);
    expect(html.indexOf("future@example.com")).toBeLessThan(fold);
    expect(html.indexOf("stale@example.com")).toBeGreaterThan(fold);
    expect(html.indexOf("joined@example.com")).toBeGreaterThan(fold);
    expect(html).not.toContain('aria-label="stale@example.com 초대 메뉴"');
    expect(html).toContain("만료");
    expect(html).toContain("수락됨");
  });

  it("shows the household name with rename, the 나 chip, folded former members and the invite CTA", () => {
    const html = render();
    expect(html).toContain("우리집");
    expect(html).toContain("이름 바꾸기");
    expect(html).toMatch(/>나<\/span>/);
    expect(html).toContain("나간 구성원 1명");
    expect(html).toContain("초대하기를 누르면 수락 링크를 만들 수 있어요");
    expect(html).toMatch(/초대하기<\/button>/);
  });
});

describe("가족 화면 — 역할별 문구", () => {
  it("tells an admin that only the owner can invite, without an invite button", () => {
    state.role = "admin";
    state.members = [
      member({ memberId: "m-o", userId: "u-o", name: "민수", role: "owner" }),
      member({ role: "admin" }),
    ];
    const html = render([
      invitation({
        email: "stale@example.com",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    ]);
    expect(html).toContain("대기 중인 초대가 없어요");
    expect(html).toContain("초대는 소유자만 만들 수 있어요");
    expect(html).not.toContain("초대하기를 누르면");
    expect(html).not.toMatch(/초대하기<\/button>/);
    expect(html).toContain("이름 바꾸기");
  });

  it("gives a member neither rename nor the invite section, only their own ⋯ menu", () => {
    state.role = "member";
    state.members = [
      member({ memberId: "m-o", userId: "u-o", name: "민수", role: "owner" }),
      member({ role: "member" }),
    ];
    const html = render();
    expect(html).not.toContain("이름 바꾸기");
    expect(html).not.toContain('aria-label="초대"');
    expect(html).toContain('aria-label="수빈 메뉴"');
    expect(html).not.toContain('aria-label="민수 메뉴"');
  });
});
