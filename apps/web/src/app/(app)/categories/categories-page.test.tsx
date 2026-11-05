/**
 * 카테고리 화면(2026-11-05 HIG 검수 3·4단계).
 * - 메뉴·확인 창·버튼이 같은 동사 '삭제'를 쓴다('지울까요? / 지우기'가 아니라 '삭제할까요? / 삭제하기 / 닫기').
 * - 이름만 있는 줄도 누르면 그 카테고리의 거래 목록으로 가므로 ›를 단다.
 * - 못 불러오면 원인과 '다시 불러오기'(ErrorState).
 */
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ list: {} as Record<string, unknown> }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/categories",
}));
vi.mock("@/lib/queries", async (importOriginal) => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useCategoryList: () => hooks.list,
    useCreateCategory: mutation,
    useUpdateCategory: mutation,
    useDeleteCategory: mutation,
  };
});
// 확인 창은 열려 있을 때만 그려진다 — 문구를 보려고 열고 닫는 껍데기를 걷어 낸다.
vi.mock("@/components/ui/alert-dialog", async () => {
  const { createElement, Fragment } = await import("react");
  type Props = { children?: ReactNode; variant?: string };
  const pass = ({ children }: Props) => createElement(Fragment, null, children);
  const tag =
    (name: string) =>
    ({ children, variant }: Props) =>
      createElement(
        name,
        variant ? { "data-variant": variant } : null,
        children
      );
  return {
    AlertDialog: pass,
    AlertDialogContent: pass,
    AlertDialogHeader: pass,
    AlertDialogFooter: pass,
    AlertDialogTitle: tag("h2"),
    AlertDialogDescription: tag("p"),
    AlertDialogAction: tag("button"),
    AlertDialogCancel: tag("button"),
  };
});

import CategoriesPage from "./page";

const categories = [
  { id: "c-sys", name: "식비", slug: "food", isSystem: true },
  { id: "c-own", name: "간식", slug: null, isSystem: false },
];

function render(list: Record<string, unknown>): string {
  hooks.list = {
    data: undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    ...list,
  };
  return renderToStaticMarkup(<CategoriesPage />);
}

describe("카테고리 화면", () => {
  it("삭제 확인은 메뉴와 같은 동사 — '삭제할까요?' / 위험 색 '삭제하기' / '닫기'", () => {
    const html = render({ data: categories });
    expect(html).toContain("카테고리를 삭제할까요?");
    expect(html).toMatch(
      /<button data-variant="destructive">삭제하기<\/button>/
    );
    expect(html).toContain("<button>닫기</button>");
    expect(html).not.toMatch(/지우기|지울까요|지워지며|지울 수/);
  });

  it("이름만 있는 줄도 그 카테고리 거래 목록으로 가므로 ›가 있다", () => {
    const html = render({ data: categories });
    for (const id of ["c-sys", "c-own"]) {
      const row =
        html.match(
          new RegExp(
            `<a\\b[^>]*href="/transactions\\?categoryId=${id}"[^>]*>.*?</a>`,
            "s"
          )
        )?.[0] ?? "";
      expect(row).toContain("lucide-chevron-right");
    }
  });

  it("추가 버튼은 동사형이다", () => {
    expect(render({ data: categories })).toContain("추가하기");
  });

  it("못 불러오면 원인과 '다시 불러오기'를 보여 준다", () => {
    const html = render({ isError: true });
    expect(html).toContain("카테고리를 불러오지 못했어요");
    expect(html).toContain("다시 불러오기");
    expect(html).not.toContain("다시 시도");
    expect(html).not.toContain("아직 만든 카테고리가 없어요");
  });
});
