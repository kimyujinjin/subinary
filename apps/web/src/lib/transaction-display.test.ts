import type { TransactionSummary } from "@family/contracts";
import { describe, expect, it } from "vitest";

import {
  merchantLabel,
  merchantSearchTerm,
  sameMerchantHistory,
  transactionOccurredAt,
} from "./transaction-display";

const txn = (over: Partial<TransactionSummary> = {}): TransactionSummary => ({
  id: "t0",
  householdId: "h",
  memberId: "m",
  cardId: null,
  transactionType: "approval",
  status: "approved",
  amount: 5600,
  cancelledAmount: 0,
  netAmount: 5600,
  currency: "KRW",
  originalAmount: null,
  originalCurrency: null,
  exchangeRate: null,
  merchantRaw: "STARBUCKS",
  merchantNormalized: "스타벅스",
  categoryId: null,
  categorySlug: null,
  approvedAt: "2026-11-04T03:00:00.000Z",
  cancelledAt: null,
  installmentMonths: null,
  parentTransactionId: null,
  visibility: "household",
  memo: null,
  masked: false,
  excludedAt: null,
  createdAt: "2026-11-04T03:00:05.000Z",
  ...over,
});

describe("거래 표시 규칙", () => {
  it("가맹점 이름은 정규화 → 원문 → 미확인 순이고, 비공개는 이름도 검색어도 내지 않는다", () => {
    expect(merchantLabel(txn())).toBe("스타벅스");
    expect(merchantLabel(txn({ merchantNormalized: null }))).toBe("STARBUCKS");
    expect(merchantLabel(txn({ merchantNormalized: null, merchantRaw: null }))).toBe("미확인 가맹점");
    expect(merchantLabel(txn({ masked: true }))).toBe("(비공개)");
    expect(merchantSearchTerm(txn({ masked: true }))).toBeNull();
    expect(merchantSearchTerm(txn({ merchantNormalized: null, merchantRaw: null }))).toBeNull();
  });

  it("발생 시각은 승인 → 취소 → 수신 순으로 고른다", () => {
    expect(transactionOccurredAt(txn())).toBe("2026-11-04T03:00:00.000Z");
    expect(transactionOccurredAt(txn({ approvedAt: null, cancelledAt: "2026-11-05T00:00:00.000Z" }))).toBe("2026-11-05T00:00:00.000Z");
    expect(transactionOccurredAt(txn({ approvedAt: null }))).toBe("2026-11-04T03:00:05.000Z");
  });

  it("이 가맹점 최근 결제: 같은 표시명만, 지금 거래·비공개는 빼고 최근순 5건", () => {
    const current = txn();
    const items = [
      current,
      txn({ id: "a", approvedAt: "2026-10-01T00:00:00.000Z" }),
      txn({ id: "b", approvedAt: "2026-11-01T00:00:00.000Z" }),
      // 검색은 부분 일치라 다른 가맹점(메모에 '스타벅스')도 섞여 온다 — 빼야 한다.
      txn({ id: "c", merchantNormalized: "스타벅스 기프트샵" }),
      txn({ id: "d", masked: true }),
      ...Array.from({ length: 6 }, (_, index) =>
        txn({ id: `old-${index}`, approvedAt: `2026-0${index + 1}-15T00:00:00.000Z` }),
      ),
    ];
    const history = sameMerchantHistory(items, current);
    expect(history.map((item) => item.id)).toEqual(["b", "a", "old-5", "old-4", "old-3"]);
  });
});
