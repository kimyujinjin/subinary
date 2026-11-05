import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MerchantListResponse, MerchantSummary } from "@family/contracts";

const state = vi.hoisted(() => ({
  data: undefined as MerchantListResponse | undefined,
  isError: false,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/more/merchants",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: vi.fn() }),
}));
vi.mock("@/lib/household-context", () => ({
  useHousehold: () => ({
    householdId: "00000000-0000-4000-8000-000000000001",
    activeMembership: { role: "owner" },
  }),
}));
vi.mock("@/lib/merchant-cleanup-client", () => ({
  recomputeRecurringAfterMerchantChange: vi.fn(),
  rejectTruncationSuggestion: vi.fn(),
}));
vi.mock("@/lib/queries", () => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    queryKeys: { merchants: () => ["merchants"] },
    useMerchantList: () => ({
      data: state.data,
      isLoading: false,
      isError: state.isError,
      isFetching: false,
      refetch: vi.fn(),
    }),
    useCreateMerchantAliases: mutation,
    useDeleteMerchantAlias: mutation,
    useRejectMerchantIdentity: mutation,
  };
});
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

import MerchantsPage from "./page";

const merchant = (over: Partial<MerchantSummary>): MerchantSummary => ({
  name: "우아한형제들",
  transactionCount: 3,
  netTotal: 30_000,
  lastTransactionAt: null,
  firstTransactionAt: null,
  aliasOf: null,
  aliasId: null,
  aliases: [],
  categoryId: null,
  categoryName: null,
  ...over,
});

beforeEach(() => {
  state.isError = false;
  state.data = {
    items: [
      merchant({ name: "우아한형제들" }),
      merchant({ name: "우아한형", netTotal: 10_000 }),
    ],
    identityCandidates: [],
    truncationCandidates: [
      {
        canonical: "우아한형제들",
        aliases: ["우아한형"],
        transactionCount: 4,
        netTotal: 40_000,
      },
    ],
  };
});

describe("가맹점 정리", () => {
  it("이름 제안은 판정 이름('잘린 이름') 대신 사용자가 보는 사실로 말한다", () => {
    const html = renderToStaticMarkup(<MerchantsPage />);
    expect(html).toContain("같은 가게로 보이는 이름");
    expect(html).toContain("앞부분이 같은 이름 · 우아한형 · 합치면 4건");
    expect(html).not.toContain("잘린");
  });

  it("불러오지 못하면 공용 오류 상태로 원인 한 줄과 '다시 불러오기'를 보여 준다", () => {
    state.isError = true;
    state.data = undefined;
    const html = renderToStaticMarkup(<MerchantsPage />);
    expect(html).toMatch(
      /<p role="alert"[^>]*>가맹점을 불러오지 못했어요<\/p>/
    );
    expect(html).toMatch(/<button[^>]*>다시 불러오기<\/button>/);
    expect(html).not.toContain("다시 시도");
  });
});
