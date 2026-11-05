import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { MerchantLabelCandidateListResponse } from "@family/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ruleReviewLeftText } from "./menu-counts";
import MorePage from "./page";

const state = vi.hoisted(() => ({
  candidates: undefined as
    | Pick<MerchantLabelCandidateListResponse, "items" | "hasMore">
    | undefined,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }),
  usePathname: () => "/more",
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "u-me", name: "수빈", email: "me@example.com" },
    logout: vi.fn(),
  }),
}));
vi.mock("@/lib/biometric", () => ({
  authenticateBiometric: vi.fn(),
  getBiometricPref: vi.fn(),
  isBiometryAvailable: vi.fn(() => Promise.resolve(false)),
  setBiometricPref: vi.fn(),
}));
vi.mock("@/lib/queries", () => ({
  useMerchantLabelCandidates: () => ({ data: state.candidates }),
}));

function candidates(
  count: number,
  hasMore = false
): Pick<MerchantLabelCandidateListResponse, "items" | "hasMore"> {
  return {
    items: Array.from(
      { length: count },
      () => ({})
    ) as MerchantLabelCandidateListResponse["items"],
    hasMore,
  };
}

/** 링크 하나(`<a href=…>…</a>`)의 마크업. */
function link(html: string, href: string): string {
  return (
    html.match(new RegExp(`<a[^>]*href="${href}"[^>]*>.*?</a>`))?.[0] ?? ""
  );
}

beforeEach(() => {
  state.candidates = undefined;
});

describe("전체 메뉴", () => {
  it("메뉴 이름이 화면 제목과 같다 — '가족 관리'가 아니라 '가족'", () => {
    const html = renderToStaticMarkup(<MorePage />);
    expect(link(html, "/household")).toContain(">가족</span>");
    expect(html).not.toContain("가족 관리");
  });

  it("자동 분류 규칙 줄 오른쪽에 검토가 남은 가게 수를 회색 값으로 보인다", () => {
    state.candidates = candidates(12);
    const html = renderToStaticMarkup(<MorePage />);
    const row = link(html, "/more/category-rules");
    expect(row).toContain("12곳 남음");
    expect(row).toContain("text-muted-foreground");
    // 다른 줄에는 숫자가 붙지 않는다.
    expect(link(html, "/more/merchants")).not.toContain("남음");
  });

  it("남은 수를 모르거나 0이면 아무것도 쓰지 않는다", () => {
    expect(ruleReviewLeftText(undefined)).toBeNull();
    expect(ruleReviewLeftText(candidates(0))).toBeNull();
    expect(ruleReviewLeftText(candidates(20, true))).toBe("20곳 이상 남음");
    const html = renderToStaticMarkup(<MorePage />);
    expect(link(html, "/more/category-rules")).not.toContain("남음");
  });

  it("로그아웃 줄은 위험 색 글자다 — 회색이면 비활성처럼 보인다", () => {
    const html = renderToStaticMarkup(<MorePage />);
    const row = html.match(
      /<button[^>]*>(?:(?!<\/button>).)*로그아웃<\/span><\/button>/
    )?.[0];
    expect(row).toBeDefined();
    expect(row).toContain(
      '<span class="text-body text-destructive">로그아웃</span>'
    );
  });

  it("로그아웃 확인은 다른 확인 시트와 같은 모양이다(위험 색 확인 + 닫기)", () => {
    // 확인 시트는 포털 안이라 정적 렌더로 그릴 수 없어 소스로 확인한다(sheet-layout.test.ts와 같은 방식).
    const source = readFileSync(
      join(process.cwd(), "src/app/(app)/more/page.tsx"),
      "utf8"
    );
    const footer = source.slice(source.indexOf("<AlertDialogFooter"));
    expect(footer).toMatch(
      /<AlertDialogFooter>\s*(?:\{\/\*.*\*\/\}\s*)?<AlertDialogCancel disabled=\{busy\}>닫기<\/AlertDialogCancel>/
    );
    expect(footer).toMatch(/<AlertDialogAction\s+variant="destructive"/);
    expect(source).not.toContain("SHEET_CLOSE_CLASS");
  });

  it("화면 모드는 OS 기본 select가 아니라 값 고르기 줄이다", () => {
    const html = renderToStaticMarkup(<MorePage />);
    expect(html).not.toContain("<select");
    const row = html.match(
      /<button[^>]*aria-haspopup="menu"[^>]*>(?:(?!<\/button>).)*화면 모드(?:(?!<\/button>).)*<\/button>/
    )?.[0];
    expect(row).toBeDefined();
    expect(row).toContain("기기 설정");
  });
});
