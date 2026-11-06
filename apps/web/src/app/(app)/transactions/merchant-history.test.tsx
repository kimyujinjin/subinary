/**
 * '이 가맹점 최근 결제'는 불러오는 동안 같은 높이의 자리를 잡는다(2026-11-06 사용자 지적 — 예전에는 null을
 * 그리다가 결과가 오면 머리와 줄이 한꺼번에 생겨 내용만큼 아래에 붙는 시트의 윗변이 튀었다).
 * 조회 결과만 바꿔 가며 정적으로 그린다. 픽스처 값은 모두 지어낸 것이다.
 */
import type { TransactionSummary } from "@family/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MERCHANT_HISTORY_ROWS,
  MERCHANT_HISTORY_SKELETON_ROWS,
  MerchantHistory,
  merchantHistoryQuery,
} from "./merchant-history";

const state = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => state.result,
}));
vi.mock("@/lib/household-context", () => ({
  useHousehold: () => ({ householdId: "hh-test" }),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: async () => ({ items: [] }) }),
}));

const at = "2026-08-03T05:31:00.000Z";

function txn(overrides: Partial<TransactionSummary> = {}): TransactionSummary {
  return {
    id: "self",
    householdId: "hh-test",
    memberId: "m1",
    cardId: "c1",
    transactionType: "approval",
    status: "approved",
    amount: 4_500,
    cancelledAmount: 0,
    netAmount: 4_500,
    currency: "KRW",
    originalAmount: null,
    originalCurrency: null,
    exchangeRate: null,
    merchantRaw: "가상카페 본점",
    merchantNormalized: "가상카페",
    categoryId: null,
    categorySlug: null,
    approvedAt: at,
    cancelledAt: null,
    installmentMonths: null,
    parentTransactionId: null,
    visibility: "household",
    memo: null,
    masked: false,
    excludedAt: null,
    createdAt: at,
    ...overrides,
  };
}

const self = txn();

function render(openingId: string | null = null): string {
  return renderToStaticMarkup(
    <MerchantHistory
      txn={self}
      searchTerm="가상카페"
      disabled={false}
      openingId={openingId}
      onOpen={() => undefined}
      onPrefetch={() => undefined}
    />
  );
}

beforeEach(() => {
  state.result = {};
});

describe("MerchantHistory", () => {
  it("불러오는 동안 섹션 머리와 실제 줄과 같은 높이의 회색 막대 줄을 그린다", () => {
    state.result = { isSuccess: false, isLoading: true };
    const html = render();
    expect(html).toContain("이 가맹점 최근 결제");
    expect(html).toContain('aria-busy="true"');
    // 줄 수는 보일 수 있는 최대(5)보다 작은 3줄 — 폰에서는 3줄로도 시트가 85%에 닿는다.
    expect(MERCHANT_HISTORY_ROWS).toBe(5);
    expect(MERCHANT_HISTORY_SKELETON_ROWS).toBe(3);
    expect(html.match(/<li /g)).toHaveLength(MERCHANT_HISTORY_SKELETON_ROWS);
    // 실제 줄 버튼과 같은 최소 높이(min-h-12)와 구분선.
    expect(html.match(/<li class="[^"]*\bmin-h-12\b/g)).toHaveLength(
      MERCHANT_HISTORY_SKELETON_ROWS
    );
    expect(html).toContain("divide-y");
    // 없는 정보를 있는 것처럼 보이지 않는다 — 눌리는 줄도, 날짜·금액 글자도 없다.
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/원</);
  });

  it("결과가 0건이면 그때 섹션을 지운다", () => {
    state.result = {
      isSuccess: true,
      isLoading: false,
      data: { items: [self] },
    };
    expect(render()).toBe("");
  });

  it("실패하면 아무것도 그리지 않는다", () => {
    state.result = { isSuccess: false, isLoading: false, isError: true };
    expect(render()).toBe("");
  });

  it("결과가 오면 줄을 그리고, 열려고 기다리는 줄은 손을 뗀 뒤에도 눌린 모양이다", () => {
    state.result = {
      isSuccess: true,
      isLoading: false,
      data: {
        items: [
          self,
          txn({ id: "older-1", approvedAt: "2026-07-30T05:31:00.000Z" }),
          txn({ id: "older-2", approvedAt: "2026-07-20T05:31:00.000Z" }),
        ],
      },
    };
    const html = render("older-1");
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    const pressed = (tag: string) =>
      /class="[^"]*(?<![\w:/-])bg-muted(?![\w/-])/.test(tag);
    expect(buttons.filter(pressed)).toHaveLength(1);
  });
});

describe("merchantHistoryQuery", () => {
  it("useTransactions({ q, limit: 30 })와 같은 키라 캐시를 함께 쓴다", () => {
    const options = merchantHistoryQuery("hh-test", "가상카페", async () =>
      Promise.reject(new Error("부르지 않는다"))
    );
    expect(options.queryKey).toEqual([
      "transactions",
      "hh-test",
      { q: "가상카페", limit: 30 },
    ]);
  });
});
