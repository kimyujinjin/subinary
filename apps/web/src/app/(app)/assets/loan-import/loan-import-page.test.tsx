/**
 * 옛 대출 가져오기 주소(/assets/loan-import). 앱 안의 링크는 더 이상 여기를 거치지 않고,
 * 저장된 옛 링크만 신한은행 연결 화면으로 넘긴다 — 넘기는 사이 스켈레톤을 그려 깜빡이지 않는다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: navigation.replace,
    push: vi.fn(),
    back: vi.fn(),
  }),
}));
// 서버 렌더는 effect를 돌리지 않는다. 이 화면의 effect는 넘기기 하나뿐이라 그 자리에서 바로 부른다.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: ((effect: () => void) => {
      effect();
    }) as unknown as typeof actual.useEffect,
  };
});

import LoanImportPage from "./page";

beforeEach(() => {
  navigation.replace.mockClear();
});

describe("옛 대출 가져오기 주소", () => {
  it("신한은행 연결 화면으로 바로 넘기고 기록을 쌓지 않는다", () => {
    renderToStaticMarkup(<LoanImportPage />);
    expect(navigation.replace).toHaveBeenCalledOnce();
    expect(navigation.replace).toHaveBeenCalledWith(
      "/more/connections?provider=shinhan_bank"
    );
  });

  it("넘기는 사이 스켈레톤을 그리지 않고 화면 읽기에만 알린다", () => {
    const html = renderToStaticMarkup(<LoanImportPage />);
    expect(html).not.toContain('data-slot="skeleton"');
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain("sr-only");
    expect(html).toContain("신한은행 연결 관리로 이동하고 있어요");
  });
});
