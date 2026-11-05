import type { DeviceSummary, HouseholdRole } from "@family/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DevicesPage from "./page";

/*
 * 문자 연동 화면 정적 렌더 — 2026-11-05 HIG 검수 3·4단계: 목록 실패는 ErrorState(원인 + '다시 불러오기'),
 * 버튼은 동사형, 기기 종류는 'iPhone'(예전 'iOS'), sm 버튼에 덧댄 min-h-11 정리(Button sm이 이미 44px).
 * 기기 이름·시각은 합성값이다.
 */

type DevicesQuery = {
  data?: DeviceSummary[];
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
};

const state = vi.hoisted(() => ({
  role: "owner" as HouseholdRole,
  query: null as unknown as DevicesQuery,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }),
  usePathname: () => "/devices",
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
  useDevices: () => state.query,
  useHouseholdMembers: () => ({
    data: [
      {
        memberId: "m-me",
        userId: "u-me",
        name: "수빈",
        email: "me@example.com",
        role: "owner",
        status: "active",
        color: null,
        joinedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    isLoading: false,
    isError: false,
  }),
}));

function loaded(data: DeviceSummary[]): DevicesQuery {
  return {
    data,
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

function device(changes: Partial<DeviceSummary> = {}): DeviceSummary {
  return {
    id: "d-1",
    householdId: "h-1",
    memberId: "m-me",
    name: "엄마 휴대폰",
    platform: "ios",
    status: "active",
    lastSeenAt: null,
    firstEventAt: null,
    lastEventAt: null,
    createdAt: "2026-11-05T00:00:00.000Z",
    ...changes,
  };
}

function render(): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <DevicesPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  state.role = "owner";
  state.query = loaded([device()]);
});

describe("문자 연동 화면", () => {
  it("목록을 못 불러오면 원인과 '다시 불러오기'를 보인다", () => {
    state.query = {
      ...loaded([]),
      data: undefined,
      isError: true,
      error: new Error("network"),
    };
    const html = render();
    expect(html).toContain("기기를 불러오지 못했어요.");
    expect(html).toContain("다시 불러오기");
  });

  it("기기 종류를 'iPhone'으로 쓰고, 설정 계속하기 버튼에 덧댄 높이가 없다", () => {
    const html = render();
    expect(html).toContain("엄마 휴대폰");
    expect(html).toContain(" · iPhone · ");
    expect(html).not.toContain(" · iOS · ");
    const cont = html.match(/<button[^>]*>설정 계속하기<\/button>/)?.[0] ?? "";
    expect(cont).not.toBe("");
    expect(cont).not.toContain("min-h-11");
  });

  it("섹션 머리는 다른 메뉴 화면과 같은 heading이고, 주 버튼은 동사형이다", () => {
    const html = render();
    expect(html).toMatch(/<h2 class="text-heading[^"]*">등록한 기기<\/h2>/);
    expect(html).toContain("기기 등록하기");
  });

  it("빈 상태의 주 버튼도 동사형이다", () => {
    state.query = loaded([]);
    const html = render();
    expect(html).toContain("아직 등록한 기기가 없어요");
    expect(html).toContain("기기 등록하기");
  });
});
