import type { TransactionSummary } from "@family/contracts";
import { describe, expect, it } from "vitest";

import {
  DUPLICATE_PAIR_WINDOW_MS,
  duplicatePairWindow,
  findDuplicatePair,
} from "./duplicate-pair";

const at = "2026-08-03T05:31:00.000Z";
const shift = (ms: number) => new Date(Date.parse(at) + ms).toISOString();

function txn(overrides: Partial<TransactionSummary>): TransactionSummary {
  return {
    id: "self",
    householdId: "h",
    memberId: "m1",
    cardId: "c1",
    transactionType: "approval",
    status: "duplicate_suspected",
    amount: 12_500,
    cancelledAmount: 0,
    netAmount: 12_500,
    currency: "KRW",
    originalAmount: null,
    originalCurrency: null,
    exchangeRate: null,
    merchantRaw: "스타벅스 강남점",
    merchantNormalized: "스타벅스",
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

const self = txn({});

describe("duplicatePairWindow", () => {
  it("승인 시각 앞뒤 5분을 부른다(목록 API의 to는 미만이라 1ms 늘린다)", () => {
    expect(duplicatePairWindow(self)).toEqual({
      from: shift(-DUPLICATE_PAIR_WINDOW_MS),
      to: shift(DUPLICATE_PAIR_WINDOW_MS + 1),
    });
  });

  it("중복 의심 승인이 아니거나, 뺐거나, 승인 시각이 없거나, 비공개면 찾지 않는다", () => {
    expect(duplicatePairWindow(txn({ status: "approved" }))).toBeNull();
    expect(duplicatePairWindow(txn({ status: "pending_review" }))).toBeNull();
    expect(
      duplicatePairWindow(txn({ transactionType: "cancellation" }))
    ).toBeNull();
    expect(duplicatePairWindow(txn({ excludedAt: at }))).toBeNull();
    expect(duplicatePairWindow(txn({ approvedAt: null }))).toBeNull();
    expect(duplicatePairWindow(txn({ masked: true }))).toBeNull();
  });
});

describe("findDuplicatePair — 서버 판정과 같은 조건", () => {
  const pair = txn({
    id: "pair",
    status: "approved",
    approvedAt: shift(-90_000),
  });

  it("같은 카드·금액·통화·가맹점이 5분 안에 있으면 그 결제를 고른다", () => {
    expect(findDuplicatePair([self, pair], self)?.id).toBe("pair");
  });

  it("5분 끝은 포함하고 넘으면 뺀다", () => {
    const edge = txn({
      id: "edge",
      approvedAt: shift(DUPLICATE_PAIR_WINDOW_MS),
    });
    const over = txn({
      id: "over",
      approvedAt: shift(DUPLICATE_PAIR_WINDOW_MS + 1),
    });
    expect(findDuplicatePair([edge], self)?.id).toBe("edge");
    expect(findDuplicatePair([over], self)).toBeNull();
  });

  it("자기 자신만 있으면 짝이 없다", () => {
    expect(findDuplicatePair([self], self)).toBeNull();
  });

  it("금액·통화·카드·가맹점·유형 중 하나라도 다르면 짝이 아니다", () => {
    const others = [
      txn({ id: "a", amount: 12_000 }),
      txn({ id: "b", currency: "USD" }),
      txn({ id: "c", cardId: "c2" }),
      txn({ id: "d", merchantNormalized: "스타벅스 역삼" }),
      txn({ id: "e", transactionType: "cancellation" }),
      txn({ id: "f", approvedAt: null }),
      txn({ id: "g", masked: true, merchantNormalized: null }),
    ];
    expect(findDuplicatePair(others, self)).toBeNull();
  });

  it("카드가 없으면 카드 없는 같은 구성원의 결제만 짝이다", () => {
    const noCard = txn({ cardId: null });
    const sameMember = txn({ id: "same", cardId: null });
    const otherMember = txn({ id: "other", cardId: null, memberId: "m2" });
    const withCard = txn({ id: "card", cardId: "c1" });
    expect(findDuplicatePair([otherMember, withCard], noCard)).toBeNull();
    expect(
      findDuplicatePair([otherMember, withCard, sameMember], noCard)?.id
    ).toBe("same");
  });

  it("가맹점을 모르면(서버처럼) 가맹점은 비교하지 않는다", () => {
    const unknownMerchant = txn({ merchantNormalized: null });
    const other = txn({ id: "x", merchantNormalized: "다른 가게" });
    expect(findDuplicatePair([other], unknownMerchant)?.id).toBe("x");
  });

  it("여럿이면 시각이 가장 가까운 결제를 고른다", () => {
    const far = txn({ id: "far", approvedAt: shift(-240_000) });
    const near = txn({ id: "near", approvedAt: shift(60_000) });
    expect(findDuplicatePair([far, near], self)?.id).toBe("near");
  });

  it("오래된 거래도 같은 가맹점 최근 5건과 상관없이 시각 창 안에서 찾는다", () => {
    const old = txn({ approvedAt: "2025-01-10T03:00:00.000Z" });
    const oldPair = txn({
      id: "old-pair",
      status: "approved",
      approvedAt: "2025-01-10T03:02:30.000Z",
    });
    expect(findDuplicatePair([oldPair], old)?.id).toBe("old-pair");
  });
});
