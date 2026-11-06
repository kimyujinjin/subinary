import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PRIMARY_TABS } from "@/lib/nav-tabs";

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

// 시트는 포털이라 서버 렌더에 나오지 않는다. 껍데기만 단순한 상자로 바꿔 열림 여부와 내용을 읽는다
// ('닫기' 버튼은 BottomSheet 위젯이 늘 단다).
vi.mock("@/components/widgets/bottom-sheet", () => ({
  BottomSheet: ({
    open,
    title,
    children,
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
  }) => (
    <section data-sheet={title} data-open={String(open)}>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));

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

describe("로그인 화면 — 비밀번호를 잊었을 때", () => {
  it("비밀번호 칸 아래, 로그인 버튼 위에 '비밀번호를 잊었어요' 글자 버튼(44px)이 있다", () => {
    const html = renderToStaticMarkup(<LoginPage />);
    const button =
      html.match(/<button[^>]*>비밀번호를 잊었어요<\/button>/)?.[0] ?? "";
    expect(button).toContain('type="button"');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toMatch(/class="[^"]*\bmin-h-11\b/);
    expect(button).toMatch(/class="[^"]*\bactive:/);
    const at = html.indexOf(">비밀번호를 잊었어요<");
    expect(at).toBeGreaterThan(html.indexOf('type="password"'));
    expect(at).toBeLessThan(html.indexOf("로그인하기"));
  });

  it("안내 시트는 닫힌 채 시작하고, 메일 재설정이 없으니 가족에게 임시 비밀번호를 받아 바꾸라고 알린다", () => {
    const html = renderToStaticMarkup(<LoginPage />);
    const sheet =
      html.match(
        /<section data-sheet="비밀번호를 잊었나요\?"[^>]*>[\s\S]*?<\/section>/
      )?.[0] ?? "";
    expect(sheet).toContain('data-open="false"');
    expect(sheet).toContain(
      "모아는 아직 메일로 비밀번호를 다시 설정할 수 없어요."
    );
    expect(sheet).toContain(
      "이 앱을 관리하는 가족에게 임시 비밀번호를 받아 로그인한 뒤,"
    );
    expect(sheet).toContain(
      "전체 › 비밀번호 변경</span>에서 새 비밀번호로 바꿔 주세요."
    );
    // 안내에 다른 동작을 두지 않는다 — 버튼은 위젯의 '닫기' 하나다.
    expect(sheet).not.toContain("<button");
  });

  it("안내가 가리키는 메뉴 이름은 실제 전체 탭의 비밀번호 변경 줄과 같다", () => {
    expect(PRIMARY_TABS.find((tab) => tab.href === "/more")?.label).toBe(
      "전체"
    );
    const more = readFileSync(
      join(process.cwd(), "src/app/(app)/more/page.tsx"),
      "utf8"
    );
    expect(more).toMatch(/href: "\/more\/password",[^}]*title: "비밀번호 변경"/);
  });
});
