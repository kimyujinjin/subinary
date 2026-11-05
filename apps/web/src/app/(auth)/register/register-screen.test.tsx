import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvitationPreview } from "@family/contracts";

import { ApiError } from "@/lib/api-client";

const state = vi.hoisted(() => ({
  search: "",
  preview: undefined as InvitationPreview | undefined,
  error: null as Error | null,
  /** 정적 렌더는 제출을 못 하므로, 서버 거절 뒤 상태를 이 값으로 대신 세운다. */
  serverError: null as string | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ register: vi.fn(), status: "unauthenticated" }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: state.preview, error: state.error }),
}));
// 가입 화면에서 `useState(null)`은 서버 거절 문구 하나뿐이다. 그 초기값만 바꿔 끼운다.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: ((initial: unknown) =>
      initial === null && state.serverError !== null
        ? [state.serverError, () => {}]
        : actual.useState(initial)) as unknown as typeof actual.useState,
  };
});

import RegisterPage from "./page";

const pendingPreview: InvitationPreview = {
  status: "pending",
  expiresAt: "2099-01-01T00:00:00.000Z",
  householdName: "우리집",
  inviterName: "홍*동",
  role: "member",
  emailRestricted: false,
};

beforeEach(() => {
  state.search = "";
  state.preview = undefined;
  state.error = null;
  state.serverError = null;
});

describe("가입 화면 — 초대 전용 가입", () => {
  it("초대 없이 열면 폼 위에 초대 링크로 가입한다고 안내하고 폼은 그대로 둔다", () => {
    const html = renderToStaticMarkup(<RegisterPage />);
    expect(html).toContain(
      "모아는 가족 초대 링크로 가입해요. 받은 초대 링크를 열어 주세요."
    );
    expect(html.indexOf("받은 초대 링크를 열어 주세요")).toBeLessThan(
      html.indexOf('name="email"')
    );
    expect(html).toContain('name="name"');
    expect(html).toContain('name="password"');
    expect(html).toContain("가입하고 시작하기");
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('role="alert"');
  });

  it("초대로 오면 가족 이름과 함께 초대로 가입한다고 말한다", () => {
    state.search = "invite=tok123";
    state.preview = pendingPreview;
    const html = renderToStaticMarkup(<RegisterPage />);
    expect(html).toContain("&#x27;우리집&#x27; 가족 초대로 가입해요");
    expect(html).not.toContain("받은 초대 링크를 열어 주세요");
  });

  it("초대 정보를 아직 못 받았으면 이름 없이 말한다", () => {
    state.search = "invite=tok123";
    const html = renderToStaticMarkup(<RegisterPage />);
    expect(html).toContain("가족 초대로 가입해요");
  });

  it("만료됐거나 없는 초대면 쓸 수 없는 링크라고 말한다", () => {
    state.search = "invite=tok123";
    state.preview = {
      ...pendingPreview,
      status: "expired",
      householdName: null,
    };
    expect(renderToStaticMarkup(<RegisterPage />)).toContain(
      "이 초대 링크는 지금 쓸 수 없어요"
    );

    state.preview = undefined;
    state.error = new ApiError(404, "초대를 찾을 수 없어요");
    expect(renderToStaticMarkup(<RegisterPage />)).toContain(
      "이 초대 링크는 지금 쓸 수 없어요"
    );
  });

  it("초대로 왔으면 로그인 링크가 초대를 놓치지 않는다(로그인 뒤 수락 화면으로)", () => {
    const token = "a/b+c=d";
    state.search = `invite=${encodeURIComponent(token)}`;
    const html = renderToStaticMarkup(<RegisterPage />);
    const returnTo = `/join?token=${encodeURIComponent(token)}`;
    expect(html).toContain(
      `href="/login?returnTo=${encodeURIComponent(returnTo)}"`
    );
    expect(html).toMatch(
      /<a[^>]*class="[^"]*min-h-11[^"]*"[^>]*>로그인하기<\/a>/
    );
  });

  it("서버 거절은 이메일 칸 아래가 아니라 폼 위 한 줄로 알린다", () => {
    state.serverError = "가입하려면 초대 링크가 필요해요";
    const html = renderToStaticMarkup(<RegisterPage />);
    const alertAt = html.indexOf('role="alert"');
    expect(alertAt).toBeGreaterThan(-1);
    expect(html.indexOf("가입하려면 초대 링크가 필요해요")).toBeGreaterThan(alertAt);
    expect(alertAt).toBeLessThan(html.indexOf('name="name"'));
    // 칸에는 오류 표시가 붙지 않는다(이메일이 틀린 것처럼 읽히지 않게).
    expect(html).not.toContain('aria-invalid="true"');
  });

  it("앱 이름 글자 로고를 쓰고, 확인 칸 대신 비밀번호 보기 버튼으로 오타를 막는다", () => {
    const html = renderToStaticMarkup(<RegisterPage />);
    expect(html).toMatch(/<p class="text-primary text-display font-extrabold[^"]*">모아<\/p>/);
    expect(html).not.toContain("lucide-credit-card");
    expect(html).toContain('aria-label="비밀번호 보기"');
    expect(html).toContain('placeholder="이메일 주소"');
    expect(html).not.toContain("you@example.com");
  });
});
