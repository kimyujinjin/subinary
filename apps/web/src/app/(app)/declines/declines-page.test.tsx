import type {
  CardSmsDeclineGroup,
  CardSmsDeclineListResponse,
} from "@family/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * 실패한 결제 화면 정적 렌더 — 2026-11-05 HIG 검수 4단계:
 * 빨강은 '결제 실패' 칩 하나에만, 글자 크기는 토큰, '확인했어요'는 44px, 오류에는 다시 불러오기.
 * 데이터는 모두 합성값이다.
 */

const state: {
  list: {
    data?: CardSmsDeclineListResponse;
    isLoading: boolean;
    isError: boolean;
    isFetching: boolean;
    refetch: () => void;
  };
} = {
  list: {
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/declines",
}));
vi.mock("@/lib/queries", () => ({
  useDeclineList: () => state.list,
  useSetDeclineDismissed: () => ({ mutate: vi.fn(), isPending: false }),
}));

import DeclinesPage from "./page";

function group(over: Partial<CardSmsDeclineGroup>): CardSmsDeclineGroup {
  return {
    merchant: "합성피트니스",
    amount: 1000,
    attempts: 3,
    reason: "lost_or_stolen",
    issuer: "합성카드",
    maskedCardNumber: null,
    lastAttemptAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    resolvedAt: null,
    dismissedAt: null,
    ...over,
  } as unknown as CardSmsDeclineGroup;
}

function render(): string {
  return renderToStaticMarkup(createElement(DeclinesPage));
}

beforeEach(() => {
  state.list = {
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
});

describe("실패한 결제 화면", () => {
  it("빨강은 미해결 줄의 '결제 실패' 칩 하나에만 쓴다(아이콘·안내는 기본색)", () => {
    state.list.data = {
      items: [group({})],
    } as unknown as CardSmsDeclineListResponse;
    const html = render();
    expect(html).toContain("결제 실패");
    expect(html.match(/text-destructive/g)).toHaveLength(1);
    expect(html).toContain("분실 신고된 카드예요");
    expect(html).toContain("3번 실패");
    expect(html).not.toContain("번 거절");
  });

  it("옛 글자 크기(text-[11px]·xs·sm)를 쓰지 않는다", () => {
    state.list.data = {
      items: [
        group({}),
        group({ merchant: "합성상점", resolvedAt: "2026-11-03T05:00:00.000Z" }),
      ],
    } as unknown as CardSmsDeclineListResponse;
    const html = render();
    expect(html).not.toMatch(/text-\[\d+px\]|text-xs|text-sm\b/);
    expect(html).toContain("해결됨");
    expect(html).toContain("11월 3일에 결제됐어요");
  });

  it("'확인했어요'는 44px 버튼이다", () => {
    state.list.data = {
      items: [group({})],
    } as unknown as CardSmsDeclineListResponse;
    const button = render().match(/<button[^>]*>확인했어요<\/button>/)?.[0];
    expect(button).toBeDefined();
    expect(button).toContain("h-11");
    expect(button).not.toContain("h-8");
  });

  it("불러오지 못하면 원인과 '다시 불러오기'를 보여 준다", () => {
    state.list.isError = true;
    const html = render();
    expect(html).toContain("실패한 결제를 불러오지 못했어요");
    expect(html).toContain("다시 불러오기");
  });

  it("비어 있으면 공용 빈 상태, 읽는 중이면 공용 스켈레톤을 쓴다", () => {
    state.list.data = { items: [] } as unknown as CardSmsDeclineListResponse;
    expect(render()).toContain("실패한 결제가 없어요");
    state.list = { ...state.list, data: undefined, isLoading: true };
    const loading = render();
    expect(loading).toContain('aria-busy="true"');
    expect(loading).not.toContain("rounded-2xl");
  });
});
