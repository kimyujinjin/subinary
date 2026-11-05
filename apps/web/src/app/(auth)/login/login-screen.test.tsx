import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  search: "",
  /** 정적 렌더는 제출을 못 하므로, 폼 위 실패 문구를 이 값으로 대신 세운다. */
  formError: null as string | null,
}));

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

// 로그인 화면에서 `useState(null)`은 폼 위 실패 문구 하나뿐이다. 그 초기값만 바꿔 끼운다.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: ((initial: unknown) =>
      initial === null && state.formError !== null
        ? [state.formError, () => {}]
        : actual.useState(initial)) as unknown as typeof actual.useState,
  };
});

import LoginPage from "./page";

const NO_INVITE_CAPTION = "가입은 가족 초대 링크로 해요";

beforeEach(() => {
  state.search = "";
  state.formError = null;
});

describe("로그인 화면 — 문구와 모양", () => {
  it("신용카드 아이콘 대신 앱 이름 '모아' 글자 로고, 처음 온 사람에게도 맞는 제목이다", () => {
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).toMatch(/<p class="text-primary text-display font-extrabold[^"]*">모아<\/p>/);
    expect(html).toMatch(/<h1[^>]*>로그인<\/h1>/);
    expect(html).not.toContain("다시 만나서 반가워요");
    expect(html).not.toContain("lucide-credit-card");
  });

  it("이메일 예시는 한국어이고, 비밀번호 칸에는 보기 버튼(44px)이 있다", () => {
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).toContain('placeholder="이메일 주소"');
    expect(html).not.toContain("you@example.com");
    expect(html).toMatch(/<button[^>]*class="[^"]*size-11[^"]*"[^>]*aria-label="비밀번호 보기"|<button[^>]*aria-label="비밀번호 보기"[^>]*class="[^"]*size-11/);
    expect(html).not.toContain("Face ID");
  });

  it("비밀번호와 무관한 실패(네트워크·요청 과다)는 칸 아래가 아니라 폼 위 한 줄이다", () => {
    state.formError = "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.";
    const html = renderToStaticMarkup(<LoginPage />);
    const alertAt = html.indexOf('role="alert"');
    expect(alertAt).toBeGreaterThan(-1);
    expect(html.indexOf("요청이 너무 많아요")).toBeGreaterThan(alertAt);
    expect(alertAt).toBeLessThan(html.indexOf('type="email"'));
    expect(html).not.toContain('aria-invalid="true"');
  });

  it("옛 글자 크기·모서리 값을 쓰지 않는다", () => {
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).not.toMatch(/text-\[\d+px\]|rounded-xl|\btext-(xl|2xl)\b/);
  });
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
