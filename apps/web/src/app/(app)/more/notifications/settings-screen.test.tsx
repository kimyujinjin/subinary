import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationPreferences } from "@family/contracts";

const state = vi.hoisted(() => ({
  data: undefined as NotificationPreferences | undefined,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/more/notifications",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/queries", () => ({
  useNotificationPreferences: () => ({
    data: state.data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateNotificationPreferences: () => ({ mutateAsync: vi.fn() }),
}));

import NotificationSettingsPage from "./page";

const prefs: NotificationPreferences = {
  pushEnabled: true,
  minAmount: 1_234_567,
  quietStartMinute: null,
  quietEndMinute: null,
  notifyOwnCollected: false,
  disabledKinds: ["summary"],
};

/** id로 스위치 버튼 태그를 찾는다(Radix Switch는 role="switch" 버튼). */
function switchTag(html: string, id: string): string {
  const tag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0];
  if (!tag) throw new Error(`switch ${id} not rendered`);
  return tag;
}

beforeEach(() => {
  state.data = prefs;
});

describe("알림 설정 화면", () => {
  it("저장 버튼 없이 바로 저장하고, 푸시 설명은 모든 기기·알림함 기준이다", () => {
    const html = renderToStaticMarkup(<NotificationSettingsPage />);
    expect(html).not.toMatch(/>저장<\/button>/);
    expect(html).toContain(
      "끄면 내 모든 기기로 푸시가 가지 않고, 알림함에는 그대로 남아요"
    );
    expect(html).not.toContain("이 기기로");
  });

  it("일곱 종류를 채널 이름으로 보여 주고, 끈 종류만 꺼져 있다", () => {
    const html = renderToStaticMarkup(<NotificationSettingsPage />);
    for (const name of [
      "결제 알림",
      "예산 알림",
      "확인 리마인더",
      "소비 요약",
      "결제 실패",
      "정기 결제 예고",
      "확인 요청",
    ]) {
      expect(html).toContain(name);
    }
    expect(switchTag(html, "kind-summary")).toContain('aria-checked="false"');
    expect(switchTag(html, "kind-transaction")).toContain(
      'aria-checked="true"'
    );
  });

  it("최소 금액은 천 단위 쉼표와 원으로 보인다", () => {
    const html = renderToStaticMarkup(<NotificationSettingsPage />);
    expect(html).toMatch(/<input[^>]*id="min-amount"[^>]*value="1,234,567"/);
    expect(html).toContain(">원</span>");
  });

  it("푸시를 끄면 내 결제도 알림·종류·무음 시간대가 함께 잠긴다", () => {
    state.data = { ...prefs, pushEnabled: false };
    const html = renderToStaticMarkup(<NotificationSettingsPage />);
    for (const id of ["notify-own", "kind-budget", "quiet-enabled"]) {
      expect(switchTag(html, id)).toContain('disabled=""');
    }
    expect(switchTag(html, "push-enabled")).not.toContain('disabled=""');
  });

  it("결제 알림을 끄면 그 아래 내 결제도 알림·최소 금액이 잠긴다", () => {
    state.data = { ...prefs, disabledKinds: ["transaction"] };
    const html = renderToStaticMarkup(<NotificationSettingsPage />);
    expect(switchTag(html, "notify-own")).toContain('disabled=""');
    expect(html).toMatch(/<input[^>]*id="min-amount"[^>]*disabled=""/);
  });

  it("불러오지 못하면 공용 오류 상태로 원인 한 줄과 '다시 불러오기'를 보여 준다", () => {
    state.data = undefined;
    const html = renderToStaticMarkup(<NotificationSettingsPage />);
    expect(html).toMatch(/<p role="alert"[^>]*>알림 설정을 불러오지 못했어요<\/p>/);
    expect(html).toMatch(/<button[^>]*>다시 불러오기<\/button>/);
    expect(html).not.toContain("푸시 알림");
  });
});
