/**
 * '가족에게 물어보기'는 상세 정보 목록의 한 줄이다(2026-11-05 HIG 검수 3·4단계).
 * 예전에는 폼 라벨 아래 구성원마다 전체 폭 버튼이 붙어 '이 가맹점 최근 결제'를 아래로 밀었다.
 * 요청 목록을 받는 동안에도 같은 높이의 줄로 자리를 잡는다(2026-11-06 — 받은 뒤 줄이 끼어들어 시트가 튀었다).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewRequestAction, reviewRequestsQuery } from "./review-request-action";

type Request = {
  id: string;
  direction: "sent" | "received";
  assigneeMemberId: string;
  requesterName: string;
};

const state = vi.hoisted(() => ({
  requests: [] as Request[],
  loading: false,
  createError: null as Error | null,
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "u-me" }, authedFetch: async () => ({}) }),
}));
vi.mock("@/lib/household-context", () => ({
  useHousehold: () => ({ householdId: "h-1" }),
}));
// 요청 목록은 이 줄과 거래 상세 미리 받기가 함께 쓰는 쿼리(reviewRequestsQuery)로 받는다.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({
    data: state.loading ? undefined : { items: state.requests },
    isLoading: state.loading,
  }),
}));
vi.mock("@/lib/queries", () => ({
  useHouseholdMembers: () => ({
    data: [
      { memberId: "m-me", userId: "u-me", name: "나", status: "active" },
      { memberId: "m-1", userId: "u-1", name: "민지", status: "active" },
      { memberId: "m-2", userId: "u-2", name: "준호", status: "removed" },
    ],
  }),
}));
vi.mock("@/lib/review-requests", () => ({
  reviewRequestsKey: (householdId: string | null, transactionId: string | null) =>
    ["review-requests", householdId, transactionId] as const,
  useCreateReviewRequest: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: state.createError,
  }),
  useResolveReviewRequest: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

const shared = { id: "t-1", visibility: "household" as const, masked: false };

beforeEach(() => {
  state.requests = [];
  state.loading = false;
  state.createError = null;
});

describe("ReviewRequestAction", () => {
  it("구성원마다 버튼을 깔지 않고 메뉴를 여는 한 줄로 그린다", () => {
    const html = renderToStaticMarkup(<ReviewRequestAction txn={shared} />);
    expect(html).toContain("가족에게 물어보기");
    // 줄 하나가 메뉴 버튼이다(누르면 물어볼 사람을 고른다).
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain("민지님에게 물어보기");
  });

  it("물어본 사람은 줄 값과 아래 글자 버튼으로 보이고 '취소' 버튼은 없다", () => {
    state.requests = [
      {
        id: "r-1",
        direction: "sent",
        assigneeMemberId: "m-1",
        requesterName: "나",
      },
    ];
    const html = renderToStaticMarkup(<ReviewRequestAction txn={shared} />);
    expect(html).toContain("민지님 답을 기다려요");
    expect(html).toContain("민지님에게 그만 물어보기");
    expect(html).not.toMatch(/>취소</);
    // 더 물어볼 사람이 없으면 메뉴가 아니다.
    expect(html).not.toContain('aria-haspopup="menu"');
  });

  it("받은 요청은 그 줄 아래에서 바로 답한다", () => {
    state.requests = [
      {
        id: "r-2",
        direction: "received",
        assigneeMemberId: "m-me",
        requesterName: "민지",
      },
    ];
    const html = renderToStaticMarkup(<ReviewRequestAction txn={shared} />);
    expect(html).toContain("민지님이 이 결제를 물어봤어요");
    expect(html).toContain("확인했어요");
  });

  it("실패는 그 줄 아래 한 줄로 말한다", () => {
    state.createError = new Error("boom");
    const html = renderToStaticMarkup(<ReviewRequestAction txn={shared} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("요청을 보내지 못했어요");
  });

  it("공개 범위가 가족 공개가 아니면 그리지 않는다", () => {
    expect(
      renderToStaticMarkup(
        <ReviewRequestAction txn={{ ...shared, visibility: "private" }} />
      )
    ).toBe("");
  });

  it("요청 목록을 받는 동안은 메뉴 없이 같은 높이의 줄로 자리만 잡는다", () => {
    state.loading = true;
    const html = renderToStaticMarkup(<ReviewRequestAction txn={shared} />);
    expect(html).toContain("가족에게 물어보기");
    // 설정 줄과 같은 최소 높이(min-h-12) — 받은 뒤에도 줄 높이가 그대로다.
    expect(html).toContain("min-h-12");
    // 이미 물어봤는지 모르는 채로 고르게 하지 않는다 — 누르는 버튼·메뉴가 없다.
    expect(html).not.toContain("<button");
    expect(html).not.toContain('aria-haspopup="menu"');
    // 값 자리는 내용 없는 회색 막대뿐이다.
    expect(html).toContain('data-slot="skeleton"');
    expect(html).not.toContain("답을 기다려요");
  });
});

describe("reviewRequestsQuery", () => {
  it("lib의 확인 요청 키를 그대로 쓴다 — 보내기·풀기의 무효화가 이 줄과 미리 받은 캐시에 함께 닿는다", () => {
    const options = reviewRequestsQuery("h-1", "t-1", async () =>
      Promise.reject(new Error("부르지 않는다"))
    );
    expect(options.queryKey).toEqual(["review-requests", "h-1", "t-1"]);
  });
});
