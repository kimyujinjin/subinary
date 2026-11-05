import type {
  HouseholdRole,
  InvitationSummary,
  MemberSummary,
} from "@family/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HouseholdPage from "./page";

const state = vi.hoisted(() => ({
  role: "owner" as HouseholdRole,
  members: [] as MemberSummary[],
  membersError: false,
  sharedColor: null as MemberSummary["color"],
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
    data: state.membersError ? undefined : state.members,
    isLoading: false,
    isError: state.membersError,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useHouseholdSummary: () => ({
    data: {
      id: "h-1",
      name: "우리집",
      createdAt: "2026-01-01T00:00:00.000Z",
      myRole: state.role,
      sharedColor: state.sharedColor,
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
  state.membersError = false;
  state.sharedColor = null;
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
  it("shows the role as a value-picker (gray value · ⌃⌄, 44px), not a gray Select box", () => {
    const html = render(INVITES);
    const trigger = html.match(
      /<button[^>]*aria-label="민수 역할: 구성원"[^>]*>/
    )?.[0];
    expect(trigger).toBeDefined();
    expect(trigger).toContain('aria-haspopup="menu"');
    expect(trigger).toContain("min-h-11");
    expect(trigger).toContain("text-muted-foreground");
    // 예전 회색 상자(SelectTrigger)는 입력 양식처럼 보였다.
    expect(trigger).not.toMatch(/(?<![\w:-])bg-muted(?![\w/-])/);
    expect(html).not.toContain('data-slot="select-trigger"');
    // 소유자 줄은 바꿀 수 없다.
    expect(html).not.toContain('aria-label="수빈 역할: 소유자"');
  });

  it("calls the read-only role '보기 전용' (same word as the bank connection screen), never '뷰어'", () => {
    state.members = [
      member({}),
      member({
        memberId: "m-v",
        userId: "u-v",
        name: "할머니",
        email: "grandma@example.com",
        role: "viewer",
      }),
    ];
    const html = render([invitation({ id: "v", email: "aunt@example.com", role: "viewer" })]);
    expect(html).toContain("보기 전용");
    expect(html).not.toContain("뷰어");
  });

  it("shows expiry dates as '11월 5일' style, not ISO/dotted dates", () => {
    const html = render([
      invitation({ id: "d", email: "date@example.com", expiresAt: "2099-01-01T00:00:00.000Z" }),
    ]);
    expect(html).toContain("2099년 1월 1일까지");
    expect(html).not.toMatch(/2099[-.]\s?0?1[-.]/);
  });

  it("puts my color and the shared card color on visible picker rows (⌃⌄) instead of hidden avatar taps", () => {
    state.sharedColor = "sky";
    const html = render();
    const section = html.slice(html.indexOf('aria-label="색상"'));
    expect(section).toContain("내 색상");
    expect(section).toContain("자동");
    expect(section).toContain("공용 카드 색상");
    expect(section).toContain("하늘");
    expect(section.match(/aria-haspopup="menu"/g)?.length).toBe(2);
    // 공용 색이 붙는 카드는 결제 카드에서 정한다 — 두 설정을 잇는다. 이름은 '공용 카드' 하나로 부른다.
    expect(section).toContain('href="/cards"');
    expect(section).toContain("공용 카드 정하기");
    expect(html).not.toContain("함께 쓰는 카드");
    // 예전 28px 견본 줄과 '회색으로' 버튼은 없다 — 견본은 메뉴 안(44px)에서 고른다.
    expect(html).not.toContain("회색으로");
    expect(html).not.toContain("색상 선택");
  });

  it("gives the avatar color shortcut a 44px touch area", () => {
    const html = render();
    const avatar = html.match(
      /<button[^>]*aria-label="민수 색상 바꾸기"[^>]*>/
    )?.[0];
    expect(avatar).toBeDefined();
    expect(avatar).toContain("before:-inset-1");
  });

  it("shows a retryable error state when members fail to load", () => {
    state.membersError = true;
    const html = render();
    expect(html).toContain("구성원을 불러오지 못했어요.");
    expect(html).toContain("다시 불러오기");
    expect(html).not.toContain("내 색상");
  });

  it("puts leave/remove/revoke only behind ⋯ menus", () => {
    const html = render(INVITES);
    expect(html).toContain('aria-label="민수 메뉴"');
    expect(html).toContain('aria-label="future@example.com 초대 메뉴"');
    for (const label of ["내보내기", "나가기", "초대 취소하기"]) {
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

  it("lets a member change only their own color — no shared card color row, no role pickers", () => {
    state.role = "member";
    state.members = [
      member({ memberId: "m-o", userId: "u-o", name: "민수", role: "owner" }),
      member({ role: "member" }),
    ];
    const html = render();
    expect(html).toContain("내 색상");
    expect(html).not.toContain("공용 카드 색상");
    expect(html).not.toContain('href="/cards"');
    expect(html).not.toContain('aria-label="민수 색상 바꾸기"');
    expect(html).not.toMatch(/aria-label="[^"]+ 역할: /);
  });
});

describe("가족 화면 — 초대 창(포털 안이라 소스로 확인)", () => {
  // 입력 창·결과 창은 포털 안이라 정적 렌더로 그릴 수 없다(sheet-layout.test.ts와 같은 방식).
  const source = readFileSync(
    join(process.cwd(), "src/app/(app)/household/page.tsx"),
    "utf8"
  );
  const resultDialog = source.slice(
    source.indexOf("{/* 초대 생성 결과"),
    source.indexOf("{/* 위험 동작 확인")
  );

  it("링크 유효 기간은 숫자 칸이 아니라 값 고르기 줄이다(서버에는 시간으로 보낸다)", () => {
    expect(source).not.toMatch(/<FormLabel>만료/);
    expect(source).not.toContain("사이로 입력");
    expect(source).not.toMatch(/type="number"/);
    expect(source).toMatch(/label="링크 유효 기간"[\s\S]*?options: INVITE_EXPIRY_OPTIONS/);
    expect(source).toContain("expiresInHours: Number(values.expiresInHours)");
  });

  it("링크를 복사·공유하기 전에는 결과 창 바깥을 눌러도 닫히지 않는다", () => {
    expect(resultDialog).toMatch(
      /onInteractOutside=\{\(event\) => \{\s*if \(!handedOff\) event\.preventDefault\(\);/
    );
    // 복사·공유에 성공했을 때만 넘긴 것으로 친다.
    expect(source.match(/setHandedOff\(true\)/g)).toHaveLength(2);
  });

  it("결과 창이 열린 동안 안드로이드 뒤로를 먼저 받는다 — 보내기 전에는 무시, 보낸 뒤에는 창만 닫는다", () => {
    expect(source).toMatch(
      /if \(!inviteResultOpen\) return;\s*return registerTransactionDetailBack\(window, \(source\) => \{\s*if \(source === "native"\) onInviteResultBack\.current\(\);/
    );
    expect(source).toContain(
      'if (inviteResultBackAction(handedOff) === "close") setCreated(null);'
    );
  });

  it("저장 중에는 역할·색 메뉴 자체를 잠근다(꺼진 트리거 버튼만으로는 Android 탭에 열린다)", () => {
    const menus = source.match(/<(?:ColorMenu|RoleMenu)\b[\s\S]*?trigger=/g) ?? [];
    // 구성원 색(이니셜)·구성원 역할·내 색상·공용 카드 색상 + 초대 폼 역할.
    expect(menus).toHaveLength(5);
    // 초대 폼 역할은 폼 값만 바꾸고 서버에 보내지 않아 잠글 일이 없다.
    const saving = menus.filter((menu) => !menu.includes('label="역할"'));
    expect(saving).toHaveLength(4);
    for (const menu of saving) {
      expect(menu).toMatch(/disabled=\{\w+Mutation\.isPending\}/);
    }
  });

  it("주 버튼은 공유 시트가 있으면 '공유하기', 없으면 '링크 복사하기'이고 '닫기'는 글자 버튼이다", () => {
    expect(resultDialog.length).toBeGreaterThan(0);
    expect(resultDialog).toMatch(/\{canShare \? \([\s\S]*?공유하기[\s\S]*?\) : null\}/);
    expect(resultDialog).toContain('variant={canShare ? "weak" : "default"}');
    expect(resultDialog).toMatch(/variant="ghost"[\s\S]*?닫기/);
  });
});
