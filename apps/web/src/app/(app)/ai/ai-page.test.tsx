import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/ai",
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: vi.fn() }),
}));
vi.mock("@/lib/household-context", () => ({
  useHousehold: () => ({ householdId: "00000000-0000-4000-8000-000000000001" }),
}));

import AiPage from "./page";

function render(): string {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(AiPage),
    ),
  );
}

describe("AI 도우미 화면", () => {
  it("가계부 질문만 받는다 — 업무 기억(Slack) 범위가 없다", () => {
    const html = render();
    expect(html).toContain("AI 도우미");
    expect(html).toContain("가계부에 대해 물어보세요");
    expect(html).toContain("이번 달 식비 얼마 썼어?");
    expect(html).not.toContain("업무 기억");
    expect(html).not.toContain("Slack");
    expect(html).not.toContain('role="tablist"');
  });

  it("대화가 없으면 머리에 '새 대화'를 두지 않는다(지울 것이 없다)", () => {
    const html = render();
    expect(html).not.toContain("새 대화");
    expect(html).toContain("이번 달 총 지출 얼마야?");
  });
});
