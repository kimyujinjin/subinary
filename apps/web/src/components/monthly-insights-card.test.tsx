/**
 * '이 달의 특징' 카드(2026-11-05 HIG 검수 3·4단계).
 * 여는 버튼('이 달의 특징 보기')과 같은 이름을 쓰고, 로딩은 스켈레톤·실패는 '다시 불러오기'·없음은 그렇다고 말한다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({ result: {} as Record<string, unknown> }));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQuery: () => query.result,
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: vi.fn() }),
}));
vi.mock("@/lib/household-context", () => ({
  useHousehold: () => ({ householdId: "h-1" }),
}));

import { MonthlyInsightsCard } from "./monthly-insights-card";

const base = {
  data: undefined,
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
};

function render(result: Record<string, unknown>): string {
  query.result = { ...base, ...result };
  return renderToStaticMarkup(<MonthlyInsightsCard month="2026-10" />);
}

describe("이 달의 특징 카드", () => {
  beforeEach(() => {
    query.result = { ...base };
  });

  it("카드 이름은 여는 버튼과 같은 '이 달의 특징'이다", () => {
    const html = render({
      data: {
        insights: [{ kind: "trend", message: "식비가 지난달보다 늘었어요" }],
      },
    });
    expect(html).toContain("이 달의 특징");
    expect(html).toContain("식비가 지난달보다 늘었어요");
    expect(html).not.toContain("AI 인사이트");
    expect(html).not.toContain("인사이트");
    expect(html).not.toMatch(/text-(sm|xs|\[15px\])/);
  });

  it("불러오는 동안은 글자 대신 스켈레톤이다", () => {
    const html = render({ isLoading: true, isFetching: true });
    expect(html).toContain("이 달의 특징");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("확인하고 있어요");
  });

  it("찾은 것이 없으면 그렇다고 말한다", () => {
    const html = render({ data: { insights: [] } });
    expect(html).toContain("이 달에는 눈에 띄는 특징이 없어요");
  });

  it("못 불러오면 원인과 '다시 불러오기'를 보여 준다", () => {
    const html = render({ isError: true });
    expect(html).toContain("이 달의 특징을 불러오지 못했어요");
    expect(html).toContain("다시 불러오기");
  });
});
