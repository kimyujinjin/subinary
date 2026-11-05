import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvitationPreview } from "@family/contracts";

import type { AcceptFailure } from "./accept-failure";

const TOKEN = "a/b+c=d";

const state = vi.hoisted(() => ({
  status: "authenticated" as "authenticated" | "unauthenticated",
  preview: undefined as InvitationPreview | undefined,
  /** 정적 렌더는 누를 수 없으므로, 수락 실패 뒤 상태를 이 값으로 대신 세운다. */
  failure: null as AcceptFailure | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () =>
    new URLSearchParams(`token=${encodeURIComponent("a/b+c=d")}`),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    status: state.status,
    authedFetch: vi.fn(),
    refreshMemberships: vi.fn(),
    retryBootstrap: vi.fn(),
    logout: vi.fn(),
    user:
      state.status === "authenticated"
        ? { id: "u1", name: "홍길동", email: "gildong@example.test" }
        : null,
  }),
}));
vi.mock("@/lib/store", () => ({
  useHouseholdStore: (
    select: (value: { setSelectedId: () => void }) => unknown
  ) => select({ setSelectedId: () => {} }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({
    data: state.preview,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));
// 초대 화면에서 `useState(null)`은 수락 실패 하나뿐이다. 그 초기값만 바꿔 끼운다.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: ((initial: unknown) =>
      initial === null && state.failure !== null
        ? [state.failure, () => {}]
        : actual.useState(initial)) as unknown as typeof actual.useState,
  };
});

import { ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/household-roles";

import JoinPage from "./page";
import { DEAD_INVITE_COPY, OTHER_ACCOUNT_COPY } from "./accept-failure";

const pending: InvitationPreview = {
  status: "pending",
  expiresAt: "2099-01-01T00:00:00.000Z",
  householdName: "우리집",
  inviterName: "홍*동",
  role: "member",
  emailRestricted: true,
};

beforeEach(() => {
  state.status = "authenticated";
  state.preview = pending;
  state.failure = null;
});

describe("초대 수락 화면", () => {
  it("지금 로그인한 계정을 이름(이메일)로 보이고, 다른 계정으로 바꿀 버튼을 둔다", () => {
    const html = renderToStaticMarkup(<JoinPage />);
    expect(html).toContain("지금 계정: </span>홍길동(gildong@example.test)");
    expect(html).toMatch(
      /<button[^>]*type="button"[^>]*>다른 계정으로 로그인하기<\/button>/
    );
    expect(html).toContain("초대 수락하기");
  });

  it("'나중에 할게요'는 링크가 아니라 버튼이라 수락 중에 막을 수 있다", () => {
    const html = renderToStaticMarkup(<JoinPage />);
    expect(html).toMatch(/<button[^>]*>나중에 할게요<\/button>/);
    expect(html).not.toMatch(/<a[^>]*>나중에 할게요/);
  });

  it("다른 계정 앞 초대는 토스트가 아니라 수락 버튼 위 문장으로 알린다", () => {
    state.failure = { kind: "account", message: OTHER_ACCOUNT_COPY };
    const html = renderToStaticMarkup(<JoinPage />);
    const alertAt = html.indexOf('role="alert"');
    expect(alertAt).toBeGreaterThan(-1);
    expect(html).toContain(OTHER_ACCOUNT_COPY);
    expect(alertAt).toBeLessThan(html.indexOf("초대 수락하기"));
    expect(html).toContain("다른 계정으로 로그인하기");
  });

  it("이미 처리됐거나 만료된 초대(409·410)면 '지금은 쓸 수 없는 초대'로 바꾸고 수락 버튼을 없앤다", () => {
    state.failure = { kind: "dead", message: DEAD_INVITE_COPY.accepted };
    const html = renderToStaticMarkup(<JoinPage />);
    expect(html).toContain("지금은 쓸 수 없는 초대예요");
    expect(html).toContain(DEAD_INVITE_COPY.accepted);
    expect(html).not.toContain("초대 수락하기");
  });

  it("로그인 전이면 로그인 뒤 이 화면으로 돌아오는 링크를 둔다(invite-links의 returnTo)", () => {
    state.status = "unauthenticated";
    const html = renderToStaticMarkup(<JoinPage />);
    const returnTo = `/join?token=${encodeURIComponent(TOKEN)}`;
    expect(html).toContain(
      `href="/login?returnTo=${encodeURIComponent(returnTo)}"`
    );
    expect(html).not.toContain("지금 계정");
  });

  it("관리자 초대는 가족 화면 초대 폼과 같은 설명을 보이고, 서버가 막는 '구성원 관리'를 약속하지 않는다", () => {
    state.preview = { ...pending, role: "admin" };
    const html = renderToStaticMarkup(<JoinPage />);
    expect(html).toContain(`${ROLE_LABEL.admin} — ${ROLE_DESCRIPTION.admin}`);
    expect(html).not.toContain("구성원을 관리");
  });

  it("옛 글자 크기·모서리 값을 쓰지 않는다", () => {
    const html = renderToStaticMarkup(<JoinPage />);
    expect(html).not.toMatch(/text-\[\d+px\]|rounded-xl|\btext-(sm|xl|lg)\b/);
  });
});
