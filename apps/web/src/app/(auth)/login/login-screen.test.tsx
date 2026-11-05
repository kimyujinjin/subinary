import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    login: vi.fn(),
    biometricLogin: vi.fn(),
    status: "unauthenticated",
  }),
}));

import LoginPage from "./page";

const NO_INVITE_CAPTION = "가입은 가족 초대 링크로 해요";

beforeEach(() => {
  state.search = "";
});

describe("로그인 화면 — 초대 전용 가입", () => {
  it("초대 없이 열면 회원가입 링크 대신 초대 링크로 가입한다고 알린다", () => {
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).toContain(NO_INVITE_CAPTION);
    expect(html).not.toContain("회원가입하기");
    expect(html).not.toContain('href="/register');
  });

  it("초대 수락으로 돌아가는 길이면 같은 토큰을 실은 회원가입 링크를 보인다", () => {
    const token = "a/b+c=d";
    const returnTo = `/join?token=${encodeURIComponent(token)}`;
    state.search = `returnTo=${encodeURIComponent(returnTo)}`;
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).toContain("회원가입하기");
    expect(html).toContain(
      `href="/register?invite=${encodeURIComponent(token)}"`
    );
    expect(html).not.toContain(NO_INVITE_CAPTION);
  });

  it("초대가 아닌 복귀 경로는 가입 링크를 열지 않는다", () => {
    state.search = `returnTo=${encodeURIComponent("/more")}`;
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).toContain(NO_INVITE_CAPTION);
    expect(html).not.toContain("회원가입하기");
  });

  it("외부 주소로 꾸민 초대 복귀 경로는 무시한다", () => {
    state.search = `returnTo=${encodeURIComponent(
      "//evil.example/join?token=abc"
    )}`;
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).toContain(NO_INVITE_CAPTION);
    expect(html).not.toContain("invite=abc");
  });

  it("회원가입 링크는 누르는 영역이 44px 이상이다", () => {
    state.search = `returnTo=${encodeURIComponent("/join?token=abc")}`;
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).toMatch(
      /<a[^>]*class="[^"]*min-h-11[^"]*"[^>]*>회원가입하기<\/a>/
    );
  });
});
