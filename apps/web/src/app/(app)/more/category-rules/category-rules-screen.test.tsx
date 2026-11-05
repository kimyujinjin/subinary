import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CategoryRuleList,
  RecategorizeBatchList,
} from "@family/contracts";

/** 쿼리 키 첫 칸별 결과 — 세 목록(규칙·바꾼 기록·검토 후보)을 따로 실패시킨다. */
const state = vi.hoisted(() => ({
  rules: undefined as CategoryRuleList | undefined,
  rulesError: false,
  batches: undefined as RecategorizeBatchList | undefined,
  batchesError: false,
  candidatesError: false,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/more/category-rules",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: vi.fn() }),
}));
vi.mock("@/lib/household-context", () => ({
  useHousehold: () => ({ householdId: "00000000-0000-4000-8000-000000000001" }),
}));
vi.mock("@/lib/queries", () => ({
  invalidateTransactionScope: vi.fn(),
  useCategoryList: () => ({ data: [] }),
  useConfirmMerchantLabel: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMerchantLabelCandidates: () => ({
    data: state.candidatesError ? undefined : { items: [], hasMore: false },
    isLoading: false,
    isError: state.candidatesError,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const base = {
      isPending: false,
      isSuccess: false,
      isFetching: false,
      refetch: vi.fn(),
    };
    if (queryKey[0] === "category-rules") {
      return { ...base, data: state.rules, isError: state.rulesError };
    }
    if (queryKey[0] === "recategorize-batches") {
      return { ...base, data: state.batches, isError: state.batchesError };
    }
    return { ...base, data: undefined, isError: false };
  },
}));

import CategoryRulesPage from "./page";

beforeEach(() => {
  state.rules = { items: [] } as unknown as CategoryRuleList;
  state.rulesError = false;
  state.batches = { items: [] } as unknown as RecategorizeBatchList;
  state.batchesError = false;
  state.candidatesError = false;
});

describe("자동 분류 규칙", () => {
  it("규칙 목록을 못 불러오면 공용 오류 상태로 원인 한 줄과 '다시 불러오기'를 보여 준다", () => {
    state.rules = undefined;
    state.rulesError = true;
    const html = renderToStaticMarkup(<CategoryRulesPage />);
    expect(html).toMatch(/<p role="alert"[^>]*>규칙을 불러오지 못했어요<\/p>/);
    expect(html).toMatch(/<button[^>]*>다시 불러오기<\/button>/);
    expect(html).not.toContain("다시 시도");
  });

  it("검토할 가맹점을 못 불러오면 빨간 글자만이 아니라 다시 불러올 길을 준다", () => {
    state.candidatesError = true;
    const html = renderToStaticMarkup(<CategoryRulesPage />);
    expect(html).toMatch(
      /<p role="alert"[^>]*>검토할 가맹점을 불러오지 못했어요<\/p>/
    );
    expect(html.match(/>다시 불러오기<\/button>/g)?.length).toBe(1);
  });

  it("바꾼 기록을 못 불러오면 비워 두지 않고 알린다", () => {
    state.batches = undefined;
    state.batchesError = true;
    const html = renderToStaticMarkup(<CategoryRulesPage />);
    expect(html).toContain("바꾼 기록");
    expect(html).toMatch(
      /<p role="alert"[^>]*>바꾼 기록을 불러오지 못했어요<\/p>/
    );
  });

  it("바꾼 기록의 시각은 '11월 5일 오후 2:31' 꼴이고 연월일 숫자 표기를 쓰지 않는다", () => {
    const year = new Date().getFullYear();
    state.batches = {
      items: [
        {
          id: "b1",
          merchantCanonical: "테스트상점",
          toCategoryName: "식비",
          appliedCount: 2,
          appliedAt: `${year}-03-02T05:31:00.000Z`,
          revertedAt: null,
          revertedCount: null,
          revertable: true,
        },
      ],
    } as unknown as RecategorizeBatchList;
    const html = renderToStaticMarkup(<CategoryRulesPage />);
    expect(html).toContain("3월 2일 오후 2:31 · 2건");
    expect(html).not.toContain(`${year}.`);
  });

  it("빈 규칙 안내는 거래 상세의 실제 버튼 이름을 쓴다", () => {
    const html = renderToStaticMarkup(<CategoryRulesPage />);
    expect(html).toContain("‘앞으로도 이렇게 분류하기’");
  });
});
