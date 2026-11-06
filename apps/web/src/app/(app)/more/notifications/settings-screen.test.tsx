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
// 권한 읽기는 effect에서만 돈다(정적 렌더에서는 늘 '모름'). 문구는 notification-settings.test.ts가 고정한다.
vi.mock("@/lib/native", () => ({
  getNativePlatform: () => "web",
  getPushPermissionState: async () => "unsupported",
  retryPushRegistrationIfGranted: async () => undefined,
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

/** id로 입력 칸 태그를 찾는다(속성 순서와 무관하게 검사하려고). */
function inputTag(html: string, id: string): string {
  const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
  if (!tag) throw new Error(`input ${id} not rendered`);
  return tag;
}

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
      "확인할 거래",
      "소비 요약",
      "결제 실패",
      "정기 결제 예고",
      "가족이 물어본 결제",
    ]) {
      expect(html).toContain(name);
    }
    // 이름은 할 일 화면 섹션 이름과 같고, 설명도 채널 문구 그대로다(화면에서 따로 풀어 쓰지 않는다).
    expect(html).toContain("확인 필요·중복 의심으로 남은 거래");
    expect(html).toContain("가족이 물어본 결제와 내가 물어본 결제의 답");
    expect(html).toContain("새 결제·환불 알림");
    expect(html).toContain("반복 실패한 결제 알림");
    expect(html).not.toContain("확인 리마인더");
    expect(html).not.toContain("확인 요청");
    expect(switchTag(html, "kind-summary")).toContain('aria-checked="false"');
    expect(switchTag(html, "kind-transaction")).toContain(
      'aria-checked="true"'
    );
  });

  it("최소 금액은 천 단위 쉼표와 원으로 보인다", () => {
    const html = renderToStaticMarkup(<NotificationSettingsPage />);
    expect(inputTag(html, "min-amount")).toContain('value="1,234,567"');
    expect(inputTag(html, "min-amount")).toContain('inputMode="numeric"');
    expect(html).toContain(">원</span>");
  });

  it("최소 금액이 비어 있으면 '제한 없음'만 보이고 단위는 숨긴다", () => {
    state.data = { ...prefs, minAmount: null };
    const html = renderToStaticMarkup(<NotificationSettingsPage />);
    expect(inputTag(html, "min-amount")).toContain('placeholder="제한 없음"');
    expect(html).toContain("[&amp;&gt;span]:hidden [&amp;&gt;input]:pr-4");
  });

  it("최소 금액이 있으면 단위를 보이고 단위 자리 여백을 되돌리지 않는다", () => {
    const html = renderToStaticMarkup(<NotificationSettingsPage />);
    expect(html).not.toContain("[&amp;&gt;span]:hidden");
    expect(html).not.toContain("[&amp;&gt;input]:pr-4");
  });

  it("권한을 아직 모르면(웹·정적 렌더) 휴대폰 알림 안내를 띄우지 않는다", () => {
    const html = renderToStaticMarkup(<NotificationSettingsPage />);
    expect(html).not.toContain("이 휴대폰은 알림이 꺼져 있어요");
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
    expect(inputTag(html, "min-amount")).toContain('disabled=""');
  });

  it("불러오지 못하면 공용 오류 상태로 원인 한 줄과 '다시 불러오기'를 보여 준다", () => {
    state.data = undefined;
    const html = renderToStaticMarkup(<NotificationSettingsPage />);
    expect(html).toMatch(/<p role="alert"[^>]*>알림 설정을 불러오지 못했어요<\/p>/);
    expect(html).toMatch(/<button[^>]*>다시 불러오기<\/button>/);
    expect(html).not.toContain("푸시 알림");
  });
});
