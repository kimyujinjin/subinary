import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ shared: null as boolean | null }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/more/connections",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: () => new Promise(() => {}) }),
}));
vi.mock("@/lib/connected-accounts-client", () => ({
  useConnectedAccounts: () => ({
    data:
      state.shared === null
        ? undefined
        : { sharing: { shared: state.shared }, holdings: [] },
  }),
  useSetConnectedAccountSharing: () => ({
    isError: false,
    isPending: false,
    reset: vi.fn(),
    mutate: vi.fn(),
  }),
}));

import { AssetConnectionHub } from "./provider-hub";
import { UPCOMING_PROVIDERS } from "./providers";

const hub = () =>
  renderToStaticMarkup(
    <AssetConnectionHub householdId="h1" userId="u1" canManage />
  );

beforeEach(() => {
  state.shared = null;
});

describe("은행·증권 연결 목록", () => {
  it("준비 중인 이유를 툴팁이 아니라 줄 아래 글자로 보인다(폰에는 툴팁이 없다)", () => {
    const html = hub();
    for (const provider of UPCOMING_PROVIDERS) {
      expect(html).toMatch(
        new RegExp(
          `<span class="text-caption text-muted-foreground block">${provider.reason}</span>`
        )
      );
    }
    expect(html).not.toMatch(/\stitle="/);
  });

  it("대출 기록 링크 이름은 '가져온 대출 기록'이다(자산 화면과 같은 이름)", () => {
    const html = hub();
    expect(html).toMatch(
      /<a[^>]*href="\/assets\/loan-records"[^>]*>가져온 대출 기록<\/a>/
    );
    expect(html).not.toContain("이전에 가져온");
  });

  it("가족 공유는 상태를 한 번만 말하는 스위치 줄이다(칩·켜기/끄기 버튼 없음)", () => {
    state.shared = true;
    const html = hub();
    expect(html).toMatch(/<button[^>]*role="switch"[^>]*aria-checked="true"/);
    expect(html).toMatch(/<label for="[^"]+"[^>]*>.*가족과 공유/);
    expect(html).not.toContain("공유 중");
    expect(html).not.toMatch(/>(켜기|끄기)<\/button>/);
  });
});
