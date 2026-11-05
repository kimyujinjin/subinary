import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationItem } from "@family/contracts";

const state = vi.hoisted(() => ({
  items: [] as NotificationItem[],
  hasNextPage: false,
  isError: false,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/notifications",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/queries", () => ({
  useNotifications: () => ({
    data: { pages: [{ items: state.items, nextCursor: null }] },
    isLoading: false,
    isError: state.isError,
    isFetching: false,
    hasNextPage: state.hasNextPage,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  useUnreadCount: () => ({ data: { count: 1 } }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn() }),
}));

import NotificationsPage from "./page";

const item = (over: Partial<NotificationItem>): NotificationItem => ({
  id: "00000000-0000-4000-8000-000000000001",
  kind: "transaction",
  title: "새 결제",
  body: "스타벅스 5,600원",
  deepLink: "/transactions?txn=1",
  readAt: null,
  createdAt: new Date().toISOString(),
  ...over,
});

/** 제목 텍스트를 감싼 span의 class. */
function titleClass(html: string, title: string): string {
  const match = html.match(
    new RegExp(`<span class="([^"]*)" title="${title}">${title}</span>`)
  );
  if (!match?.[1]) throw new Error(`title ${title} not rendered`);
  return match[1];
}

beforeEach(() => {
  state.items = [];
  state.hasNextPage = false;
  state.isError = false;
});

describe("알림함", () => {
  it("뒤로 가기 헤더와 알림 설정 톱니 링크가 있다", () => {
    const html = renderToStaticMarkup(<NotificationsPage />);
    expect(html).toContain('aria-label="뒤로"');
    const gear = html.match(/<a[^>]*href="\/more\/notifications"[^>]*>/)?.[0];
    expect(gear).toContain('aria-label="알림 설정"');
  });

  it("안읽음은 굵게, 읽은 것은 보통 굵기로 나눠 보여 준다", () => {
    state.items = [
      item({ id: "00000000-0000-4000-8000-000000000001", title: "새 결제" }),
      item({
        id: "00000000-0000-4000-8000-000000000002",
        title: "예산 주의",
        kind: "budget",
        readAt: new Date().toISOString(),
      }),
    ];
    const html = renderToStaticMarkup(<NotificationsPage />);
    expect(html).toContain("새 알림");
    expect(html).toContain("지난 알림");
    expect(titleClass(html, "새 결제")).toContain("font-semibold");
    expect(titleClass(html, "예산 주의")).toContain("font-normal");
    expect(titleClass(html, "예산 주의")).not.toContain("font-semibold");
  });

  it("갈 곳이 없는 알림은 링크로 만들지 않고, 더 보기는 글자 버튼이다", () => {
    state.items = [
      item({ deepLink: null, title: "소비 요약", kind: "summary" }),
    ];
    state.hasNextPage = true;
    const html = renderToStaticMarkup(<NotificationsPage />);
    expect(html).not.toContain('href="/transactions?txn=1"');
    expect(html).toMatch(/<button[^>]*>더 보기<\/button>/);
    expect(html).not.toContain("bg-primary/10");
  });

  it("갈 곳이 있는 줄만 폰에서도 ›를 단다", () => {
    state.items = [item({ title: "새 결제" })];
    expect(renderToStaticMarkup(<NotificationsPage />)).toContain(
      "lucide-chevron-right"
    );

    state.items = [item({ deepLink: null, title: "소비 요약", kind: "summary" })];
    expect(renderToStaticMarkup(<NotificationsPage />)).not.toContain(
      "lucide-chevron-right"
    );
  });

  it("불러오지 못하면 공용 오류 상태로 원인 한 줄과 '다시 불러오기'를 보여 준다", () => {
    state.isError = true;
    const html = renderToStaticMarkup(<NotificationsPage />);
    expect(html).toMatch(/<p role="alert"[^>]*>알림을 불러오지 못했어요<\/p>/);
    expect(html).toMatch(/<button[^>]*>다시 불러오기<\/button>/);
    expect(html).not.toContain("잠시 후 다시 시도해 주세요");
  });

  it("비어 있으면 공용 빈 상태를 쓴다(이모지 없음)", () => {
    const html = renderToStaticMarkup(<NotificationsPage />);
    expect(html).toContain("최근 30일 동안 온 알림이 없어요");
    expect(html).not.toContain("🔔");
  });
});
